// ════════════════════════════════════════════════════════════════════════════════════════════════
// ITEM-ACTION TOOLS (P6b — one registry, for real). The deck/deep-dive doables — complete, dismiss,
// resolve a commitment, find a file, remember a fact, delegate — become REAL registry tools: ONE
// executor each, consumed by the API routes AND the conversation core AND (by exposure) any agent.
// The endpoint logic moved HERE; the routes are thin callers — never two implementations.
//
// SAFETY IS STRUCTURAL: irreversible capabilities (sending) are NOT in this module as committing
// executors — `prepare_reply_send` returns the approval payload; the only committing send remains the
// user's explicit approve on the existing send endpoints. Reversible actions (complete/dismiss) are
// undoable through the existing /api/restore path.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { logActivity } from '@/lib/activity/log';
import { noteItemAction } from '@/lib/entities/on-action';

// Derive a human title for an inbox item from its stored source_data (shared by both actions).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inboxItemTitle(item: { title?: string | null; work_title?: string | null; source_data?: Record<string, any> | null }): string {
  const sd = (item.source_data || {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return pick(item.title) || pick(item.work_title) || pick(sd.subject) || pick(sd.from_name) || pick(sd.from) || 'item';
}

type Ctx = { client: SupabaseClient; userId: string };

/** Complete OR dismiss an inbox item — the ONE implementation (was duplicated across two routes).
 *  Mutation + learning signal + activity + the brain/label tails; reversible via /api/restore. */
export async function executeResolveInboxItem(
  { client, userId }: Ctx,
  args: { itemId: string; resolution: 'complete' | 'dismiss'; reason?: string | null; resolutionReason?: string | null },
): Promise<{ ok: boolean; title?: string; error?: string }> {
  const { itemId, resolution } = args;
  const { data: item, error: fetchError } = await client.from('inbox_items')
    .select('*').eq('id', itemId).eq('user_id', userId).single();
  if (fetchError || !item) return { ok: false, error: 'Item not found' };

  const nowIso = new Date().toISOString();
  const sd = (item.source_data ?? {}) as Record<string, unknown>;
  const status = resolution === 'complete' ? 'completed' : 'dismissed';
  const resolvedReason = args.resolutionReason
    ?? (resolution === 'complete' ? 'completed' : 'dismissed');
  // D2 (work-surface): the user's free-text context ("we'll discuss it Thursday") is a LEDGER fact —
  // stored on the item so assembleLedger surfaces it and the next state synthesis reasons WITH it.
  const { error: updateError } = await client.from('inbox_items')
    .update({ status, source_data: { ...sd, resolved_at: nowIso, resolution_reason: resolvedReason, ...(args.reason?.trim() ? { dismiss_note: String(args.reason).trim().slice(0, 200) } : {}) }, updated_at: nowIso })
    .eq('id', itemId).eq('user_id', userId);
  if (updateError) return { ok: false, error: `Failed to ${resolution} item` };

  // Law 3 (experience spec): the resolved item's room asks settle with it (component strips,
  // text stays as history) — every manual Done/Dismiss flows through this ONE resolver.
  import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'inbox_item', itemId)).catch(() => {});

  // Learning signal (non-fatal) — same shape the routes wrote.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rc = (item as any).recipient_context ?? {};
  await client.from('learning_signals').insert({
    user_id: userId, inbox_item_id: itemId,
    signal_type: resolution === 'complete' ? 'item_completed' : 'item_dismissed',
    signal_data: resolution === 'complete'
      ? { action: 'marked_complete', work_state: item.work_state, visual_section: item.visual_section, suggestion_level: rc.suggestionLevel, completed_at: nowIso }
      : { reason: args.reason ?? null, work_state: item.work_state, visual_section: item.visual_section, suggestion_level: rc.suggestionLevel, detected_role: rc.detectedRole },
  }).then(() => {}, () => {});

  // Activity timeline (non-fatal, undoable via /api/restore).
  const title = inboxItemTitle(item);
  await logActivity(client, userId, {
    type: resolution === 'complete' ? 'marked_done' : 'dismissed',
    title: `${resolution === 'complete' ? 'Marked done' : 'Dismissed'}: ${title}`,
    entityType: 'inbox_item', entityId: itemId,
    metadata: { ...(args.reason ? { reason: args.reason } : {}), resolution_reason: resolvedReason },
  }).catch(() => {});

  // THE OUTCOME LOG (proactive-team R1) — resolving an item that still carried UNSENT prepared work
  // means the preparation was DISCARDED. One stamp per artifact, at the one resolver every door
  // (routes + chief-of-staff tool) already calls. Collect now; the learning arc synthesizes later.
  try {
    const { logPreparedOutcome } = await import('@/lib/prepare/outcome');
    const discards: Array<import('@/lib/prepare/outcome').PreparedArtifactKind> = [];
    if ((sd.draft as { body?: string } | undefined)?.body) discards.push('reply_draft');
    if ((sd.nudge_draft as { body?: string } | undefined)?.body) discards.push('nudge_draft');
    if (sd.prepared_invite && !(sd.prepared_invite as { sent_at?: string }).sent_at) discards.push('invite');
    if (sd.prepared_forward && !(sd.prepared_forward as { sent_at?: string }).sent_at) discards.push('forward');
    for (const artifact of discards) {
      await logPreparedOutcome(client, userId, { outcome: 'discarded', artifact, itemKind: 'inbox', itemId });
    }
  } catch { /* the outcome log never breaks the action it observes */ }

  // Brain + mailbox tails — fire-and-forget (callers may not have after()).
  void (async () => {
    await noteItemAction(client, userId, { kind: 'inbox_item', id: itemId }).catch(() => {});
    try {
      const { reconcileItemLabel } = await import('@/lib/inbox/reconcile-item-label');
      await reconcileItemLabel({ userId, itemId, item, targetLabel: 'done', client });
    } catch { /* non-fatal */ }
  })();

  return { ok: true, title };
}

/** Resolve a commitment (done / dismissed) — the PATCH /api/commitments/[id] core. Reversible. */
export async function executeResolveCommitment(
  { client, userId }: Ctx,
  args: { commitmentId: string; resolution: 'done' | 'dismissed'; reason?: string | null },
): Promise<{ ok: boolean; title?: string; error?: string }> {
  const { data: c } = await client.from('commitments').select('id, description')
    .eq('id', args.commitmentId).eq('user_id', userId).maybeSingle();
  if (!c) return { ok: false, error: 'Commitment not found' };
  const nowIso = new Date().toISOString();
  // D2: a stated reason becomes the resolved_reason (a ledger fact the synthesis reads).
  const { error } = await client.from('commitments')
    .update({ status: args.resolution, resolved_at: nowIso, resolved_reason: args.reason?.trim() ? String(args.reason).trim().slice(0, 200) : 'chat', updated_at: nowIso })
    .eq('id', args.commitmentId).eq('user_id', userId);
  if (error) return { ok: false, error: 'Failed to update commitment' };

  import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'commitment', args.commitmentId)).catch(() => {});
  await logActivity(client, userId, {
    type: args.resolution === 'done' ? 'commitment_done' : 'dismissed',
    title: `${args.resolution === 'done' ? 'Marked done' : 'Dismissed'}: ${String(c.description).slice(0, 80)}`,
    entityType: 'commitment', entityId: args.commitmentId, metadata: { via: 'chat' },
  }).catch(() => {});
  void noteItemAction(client, userId, { kind: 'commitment', id: args.commitmentId }).catch(() => {});
  return { ok: true, title: String(c.description).slice(0, 80) };
}

/** Find a file across the universal sources (pool → KB → connected drives). Read-only. */
export async function executeFindFile(
  { client, userId }: Ctx,
  args: { query: string; entityId?: string | null },
): Promise<{ ok: boolean; files: Array<{ id: string; filename: string; source: string; score: number }> }> {
  try {
    const { resolveFileUniversal } = await import('@/lib/knowledge/resolve');
    const cands = await resolveFileUniversal(client, { userId, entityId: args.entityId ?? null }, args.query, 5);
    return {
      ok: true,
      files: cands.slice(0, 5).map((c) => ({ id: c.id, filename: c.filename, source: c.source, score: c.score })),
    };
  } catch { return { ok: true, files: [] }; }
}

/** Remember a durable fact on the item's deal (the steer LEARN path, extracted — ONE implementation). */
export async function executeRememberFact(
  { client, userId }: Ctx,
  args: { fact: string; linkKind?: 'inbox_item' | 'commitment' | 'meeting'; itemId?: string; entityId?: string },
): Promise<{ ok: boolean; entityName?: string | null }> {
  const fact = args.fact.trim().slice(0, 200);
  if (!fact) return { ok: false };
  try {
    let entityId = args.entityId ?? null;
    if (!entityId && args.linkKind && args.itemId) {
      const { data: link } = await client.from('entity_links').select('entity_id')
        .eq('user_id', userId).eq('item_kind', args.linkKind).eq('item_id', args.itemId).not('entity_id', 'is', null).maybeSingle();
      entityId = (link?.entity_id as string) ?? null;
    }
    if (!entityId) return { ok: false, entityName: null };
    const { data: ent } = await client.from('work_entities').select('id, name, rules').eq('id', entityId).eq('user_id', userId).maybeSingle();
    if (!ent) return { ok: false, entityName: null };
    const cur = Array.isArray(ent.rules) ? (ent.rules as string[]) : [];
    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!cur.some((r) => norm(r) === norm(fact))) {
      await client.from('work_entities').update({ rules: [...cur, fact].slice(-12) }).eq('id', ent.id as string);
    }
    return { ok: true, entityName: String(ent.name) };
  } catch { return { ok: false }; }
}

// ── Registry DEFINITIONS (OpenAI function-calling shape — the same format every agent consumes). ──

export const resolveInboxItemDefinition = {
  name: 'resolve_inbox_item',
  description: 'Mark the current email/notice item as done (handled) or dismiss it from the Home. Reversible — the user can restore it from the activity log.',
  input_schema: {
    type: 'object',
    properties: {
      resolution: { type: 'string', enum: ['complete', 'dismiss'], description: '"complete" = handled/done; "dismiss" = not relevant, clear it' },
      reason: { type: 'string', description: 'Optional short reason (the user\'s words)' },
    },
    required: ['resolution'],
  },
};

export const resolveCommitmentDefinition = {
  name: 'resolve_commitment',
  description: 'Mark the current commitment/follow-up as done or dismissed. Reversible via the activity log.',
  input_schema: {
    type: 'object',
    properties: { resolution: { type: 'string', enum: ['done', 'dismissed'] } },
    required: ['resolution'],
  },
};

export const findFileDefinition = {
  name: 'find_file',
  description: 'Search the user\'s files (knowledge base, past email attachments, connected Google Drive/OneDrive) for a document by description or name. Read-only.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to find — a filename or a plain description' } },
    required: ['query'],
  },
};

export const rememberFactDefinition = {
  name: 'remember_fact',
  description: 'Save a durable fact/constraint/preference onto this deal\'s memory so future drafts and reasoning respect it (e.g. a price, a no-go day, a decision).',
  input_schema: {
    type: 'object',
    properties: { fact: { type: 'string', description: 'The fact, one short sentence' } },
    required: ['fact'],
  },
};
