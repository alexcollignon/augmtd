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
import { quoteActor } from '@/lib/commitments/quote-actor';
import { denotesUser, type UserForms } from '@/lib/commitments/extraction-truth';

export async function createManualTask(
  client: SupabaseClient, userId: string,
  args: { description: string; dueDate?: string | null; entityId?: string | null },
  opts: { inline?: boolean } = {},
): Promise<{ ok: boolean; id?: string; entityName?: string | null; error?: string; runTails?: () => Promise<void>; direction?: 'you_owe' | 'awaiting'; counterparty?: string | null }> {
  const description = String(args.description ?? '').trim().slice(0, 500);
  if (!description) return { ok: false, error: 'description required' };
  const due = validDate(args.dueDate); // absolute-or-null — a task never gets an invented date

  // W42 · ONE DIRECTION RULE ON EVERY PATH: a declared task is the user's own unless its words name another
  // doer ("Sam to send the deck", "Waiting on Sam: the signed SOW") — then it is awaited from them.
  const { loadUserForms } = await import('@/lib/prepare/addressee');
  const forms = await loadUserForms(client as never, userId).catch(() => ({ name: null, aliases: [] as string[] }));
  const dir = manualTaskDirection(description, forms);
  const { data: created, error } = await client.from('commitments').insert({
    user_id: userId, direction: dir.direction, description,
    counterparty: dir.counterparty, due_date: due, source: 'manual', source_id: null, thread_id: null, status: 'open',
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
  return { ok: true, id, entityName, runTails, direction: dir.direction, counterparty: dir.counterparty };
}

/**
 * W42 · WHO DOES A DECLARED TASK (pure): 'you_owe' by default — the user's own task; 'awaiting' when the words
 * name someone else as the doer: a "Waiting on <X>:" lead, or a named subject with an assignment/future marker
 * read by the one actor reader (lib/commitments/quote-actor). The named party becomes the counterparty.
 */
export function manualTaskDirection(description: string, user: UserForms): { direction: 'you_owe' | 'awaiting'; counterparty: string | null } {
  const d = String(description ?? '').trim();
  const lead = /^(?:waiting (?:on|for)|awaiting|en attente de|warten auf|aguardando|esperando a?)\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)\s*[:,\-—–]/iu.exec(d);
  if (lead && !denotesUser(lead[1], user)) return { direction: 'awaiting', counterparty: lead[1] };
  // "<Name> to send…" in the user's OWN task list names the doer (a note-taker's ambiguity does not apply here).
  const assigned = /^(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)\s+to\s+\p{L}/u.exec(d);
  if (assigned && !denotesUser(assigned[1], user)) return { direction: 'awaiting', counterparty: assigned[1] };
  const actor = quoteActor(d, { user });
  if (actor === 'other' || actor === 'delegated') {
    const name = /^(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)\s/u.exec(d)?.[1] ?? null;
    return { direction: 'awaiting', counterparty: name };
  }
  return { direction: 'you_owe', counterparty: null };
}
