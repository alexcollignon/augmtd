// ════════════════════════════════════════════════════════════════════════════════════════════════
// MANUAL TASKS (projecthood Phase 4 R3a) — the ONE write path for a user-declared task. A manual task
// IS a commitment (`source: 'manual'`) so EVERYTHING downstream is automatic: the spine (deck +
// timeline + room board), the deal's LEDGER (the brain reasons over it; sig → re-judge), the
// day-cleared ring, undo/restore. Room-scoped creation links `via='user', locked` — recognition never
// second-guesses a human's placement. Used by POST /api/tasks AND the create_task_item chat
// capability (one substrate, every surface).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { validDate } from '@/lib/commitments/extract';

export async function createManualTask(
  client: SupabaseClient, userId: string,
  args: { description: string; dueDate?: string | null; entityId?: string | null },
  opts: { inline?: boolean } = {},
): Promise<{ ok: boolean; id?: string; entityName?: string | null; error?: string; runTails?: () => Promise<void> }> {
  const description = String(args.description ?? '').trim().slice(0, 500);
  if (!description) return { ok: false, error: 'description required' };
  const due = validDate(args.dueDate); // absolute-or-null — a task never gets an invented date

  const { data: created, error } = await client.from('commitments').insert({
    user_id: userId, direction: 'you_owe', description,
    counterparty: null, due_date: due, source: 'manual', source_id: null, thread_id: null, status: 'open',
  }).select('id').single();
  if (error || !created) return { ok: false, error: 'insert failed' };
  const id = created.id as string;

  let entityName: string | null = null;
  let runTails: (() => Promise<void>) | undefined;
  if (args.entityId) {
    // THE ONE membership write — locked human placement; the reconcile tails run inline for chat
    // callers (latency already conversational) or ride the route's after() (creation stays instant).
    const { setItemMembership } = await import('@/lib/entities/membership');
    const r = await setItemMembership(client, userId, { kind: 'commitment', id, entityId: args.entityId }, { inline: !!opts.inline });
    entityName = r.destName ?? null;
    runTails = r.runTails;
  }
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      type: 'task_created', title: `Task: ${description.slice(0, 60)}`,
      entityType: 'commitment', entityId: id, metadata: { manual: true, entity: args.entityId ?? null },
    });
  } catch { /* non-fatal */ }
  import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
  return { ok: true, id, entityName, runTails };
}
