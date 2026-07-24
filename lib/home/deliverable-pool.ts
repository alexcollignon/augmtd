import type { SupabaseClient } from '@supabase/supabase-js';
import type { ItemPlanKind } from './item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DELIVERABLE POOL (task-workflows S1) — the per-item shared context mechanism. Every step that RUNS
// and produces something writes a typed `item_deliverables` row scoped to (user, item). Later steps
// READ the pool and fold it into their context so they build on prior steps instead of running in
// isolation. This is NOT a dependency graph — just a shared, growing context each run reads.
//
// A `text` deliverable lives inline in `content` (the cheapest, most common). A `document`/`file`
// deliverable points at the heavy store via `ref`. A `sent_record` records an irreversible commit.
//
// Non-fatal by design: a missing table (migration not applied) or any write failure is caught and
// logged — the run still succeeds, the pool just no-ops.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type DeliverableType = 'text' | 'document' | 'file' | 'sent_record' | 'draft';

export interface Deliverable {
  id: string;
  task_id: string | null;
  type: DeliverableType;
  title: string | null;
  content: string | null;   // inline text body (analysis / draft / research)
  ref: string | null;       // heavy-store id (artifact / knowledge_file / storage path)
  gist: string | null;      // one-line summary (from metadata) for the pool index
  metadata: Record<string, unknown>;
  created_at: string;
}

type DeliverableRow = {
  id: string;
  task_id: string | null;
  type: string;
  title: string | null;
  content: string | null;
  ref: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function toDeliverable(row: DeliverableRow): Deliverable {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    task_id: row.task_id,
    type: (row.type as DeliverableType) ?? 'text',
    title: row.title,
    content: row.content,
    ref: row.ref,
    gist: typeof meta.gist === 'string' ? (meta.gist as string) : null,
    metadata: meta,
    created_at: row.created_at,
  };
}

/**
 * readPool — the item's deliverables, oldest → newest (so the pool index reads in production order).
 * Non-fatal: returns [] on any failure (incl. a missing table). RLS-safe with a cookie client; a
 * service-role caller must pass user_id explicitly (we always filter on it here).
 */
export async function readPool(
  client: SupabaseClient,
  userId: string,
  kind: ItemPlanKind,
  entityId: string,
): Promise<Deliverable[]> {
  try {
    const { data, error } = await client
      .from('item_deliverables')
      .select('id, task_id, type, title, content, ref, metadata, created_at')
      .eq('user_id', userId)
      .eq('kind', kind)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[deliverable-pool] readPool failed (non-fatal):', error.message);
      return [];
    }
    return (data as DeliverableRow[] | null ?? []).map(toDeliverable);
  } catch (e) {
    console.error('[deliverable-pool] readPool threw (non-fatal):', e);
    return [];
  }
}

export interface WriteDeliverableInput {
  /** The pool scope — an item plan kind, or 'entity' for a file dropped on the deal itself (P7c). */
  kind: ItemPlanKind | 'entity';
  entityId: string;
  taskId?: string | null;   // the step that produced it — dedup key (a re-run REPLACES its prior entry)
  type: DeliverableType;
  title?: string | null;
  content?: string | null;
  ref?: string | null;
  gist?: string | null;     // stored in metadata.gist for the compact pool index
  metadata?: Record<string, unknown>;
}

/**
 * writeDeliverable — insert (or, for a re-run of the same step, REPLACE) a pool entry.
 *
 * Dedup: keyed on `task_id` per item. Re-running a step deletes its prior deliverable first (latest
 * wins — §12 of the plan) rather than piling up versions. A `sent_record` is a committed side effect;
 * the caller never re-runs it, so dedup never removes one in practice.
 *
 * Non-fatal: any failure returns null and is logged. The caller must not treat a null as a run failure.
 */
export async function writeDeliverable(
  client: SupabaseClient,
  userId: string,
  input: WriteDeliverableInput,
): Promise<Deliverable | null> {
  try {
    // Dedup: a re-run of the SAME step replaces its own prior deliverable (task_id + item scope).
    if (input.taskId) {
      await client
        .from('item_deliverables')
        .delete()
        .eq('user_id', userId)
        .eq('kind', input.kind)
        .eq('entity_id', input.entityId)
        .eq('task_id', input.taskId);
    }

    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (input.gist) metadata.gist = input.gist;

    const { data, error } = await client
      .from('item_deliverables')
      .insert({
        user_id: userId,
        kind: input.kind,
        entity_id: input.entityId,
        task_id: input.taskId ?? null,
        type: input.type,
        title: input.title ?? null,
        content: input.content ?? null,
        ref: input.ref ?? null,
        metadata,
      })
      .select('id, task_id, type, title, content, ref, metadata, created_at')
      .single();

    if (error) {
      console.error('[deliverable-pool] writeDeliverable failed (non-fatal):', error.message);
      return null;
    }
    return toDeliverable(data as DeliverableRow);
  } catch (e) {
    console.error('[deliverable-pool] writeDeliverable threw (non-fatal):', e);
    return null;
  }
}

/**
 * renderPoolForContext — a compact text block a step can reason over ("Already produced: …").
 * Skips the deliverable currently being (re)produced (`excludeTaskId`) so a step's own prior output
 * doesn't leak in as if it were an upstream input. Empty pool → ''.
 */
export function renderPoolForContext(deliverables: Deliverable[], excludeTaskId?: string | null): string {
  const relevant = deliverables.filter((d) => !excludeTaskId || d.task_id !== excludeTaskId);
  if (relevant.length === 0) return '';

  const lines = relevant.map((d, i) => {
    const label = d.title || d.gist || d.type;
    const head = `[Deliverable ${i + 1} · ${d.type}] ${label}`;
    // Inline the body for text/draft (the poolable content) AND for a `file` whose extracted TEXT is in
    // `content` (a user-uploaded doc — S3; the extracted text is exactly what a downstream step/coworker
    // reads — note the AgentOS path is text-only, so a scanned-image file with no extractable text falls
    // through to the pointer line). For a document/sent record with no inline body, a pointer line.
    if (d.type === 'text' || d.type === 'draft' || (d.type === 'file' && (d.content || '').trim())) {
      const body = (d.content || '').trim().slice(0, 3000);
      return body ? `${head}\n${body}` : head;
    }
    const gist = d.gist ? ` — ${d.gist}` : d.content ? ` — ${d.content.slice(0, 200)}` : '';
    return `${head}${gist}`;
  });

  return [
    `ALREADY PRODUCED for this item (build on these — do not re-derive what a prior step already produced):`,
    lines.join('\n\n'),
  ].join('\n\n');
}

/**
 * buildPoolIndex — the terse title/type/gist list handed to the assembler's reasoning call (so it can
 * decide whether a needed input already exists in the pool, instance-honestly). No bodies.
 */
export function buildPoolIndex(deliverables: Deliverable[]): string {
  if (deliverables.length === 0) return '(the pool is empty — nothing has been produced for this item yet)';
  return deliverables
    .map((d) => `- ${d.type}: ${d.title || d.gist || '(untitled)'}${d.gist && d.title ? ` — ${d.gist}` : ''}`)
    .join('\n');
}
