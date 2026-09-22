// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRESENTATION SIDE-CHANNEL (W4-C, Sep 22 — the AgentOS DM's missing half).
//
// THE GAP, verbatim from the W1/W2 notes: "no base64 marker in tool results — needs a side-channel
// on the internal route." A coworker running ON THE BOX calls a Python @tool, which calls our own
// internal route, which runs the SAME executor the native loop runs — and that executor already
// produces BOTH halves: `modelText` for the model and a typed spec for the kit. Only `modelText`
// could get home, because the only channel back to the box is the tool's return STRING, and a card
// is not something a model should ever hold, echo or hand-encode (the marker idiom the email draft
// uses works for a small payload; a collection is rows, and rows in a model's context are exactly
// the leak THE PRESENTATION LAW exists to end).
//
// So the DATA half never travels through the model at all. The internal route writes it HERE, keyed
// by the DM thread; the bridge — which is the same process family, on the same Vercel side — reads
// it as the run streams and emits the SAME `{type:'collection'|'event'}` frames the native route
// emits. NOTHING MODEL-FACING CHANGES: the tool still returns only its sentence.
//
// WHY A THREAD KEY IS ENOUGH. A DM thread has one run in flight at a time, and the bridge CLEARS
// the channel before dispatching and DRAINS it as the run goes — so a stale entry from a previous
// turn is structurally impossible. `turn` is the belt to that brace: the bridge mints a turn id per
// run and passes it through `dependencies`, the Python `_call` forwards it, and the drain drops
// anything stamped for a different turn. An older box that sends no turn id stamps `null`, which
// the clear-before/drain-during discipline already makes safe — the hardening degrades, the
// correctness does not.
//
// STORAGE: `item_plans` kind `dm_present` — the `frame_share` / `workflow_owner` precedent (no
// migration). The row is a TRANSPORT, not a record: it is deleted the moment it is read, and what
// PERSISTS on the assistant message is the pointer (lib/present/pointer.ts), never the rows.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { CollectionSpec } from '@/lib/present/collection';
import type { EventSpec } from '@/lib/present/event';

/** The `item_plans.kind` this channel owns. */
export const DM_PRESENT_KIND = 'dm_present';

/** The tools whose AgentOS run can leave a present behind. The bridge drains only on these, so an
 *  ordinary tool call costs no read. Keep in step with the internal routes' present lanes. */
export const PRESENTING_TOOLS: readonly string[] = [
  'list_tasks', 'search_knowledge_base', 'get_meeting_context', 'check_calendar', 'prepare_event_action',
];

/** At most this many cards may ride one turn — a runaway loop never becomes a wall of cards. */
export const DM_PRESENT_MAX = 6;

export type DmPresentEntry = {
  /** The bridge's per-run token; `null` from a box that predates it. */
  turn: string | null;
  collection?: CollectionSpec;
  event?: EventSpec;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const isEntry = (v: unknown): v is DmPresentEntry => {
  const e = v as DmPresentEntry | null;
  return !!e && typeof e === 'object' && (!!e.collection || !!e.event);
};

/** Read the channel's current entries. Never throws — a card is an ENHANCEMENT; the answer stands. */
async function readEntries(admin: Admin, userId: string, threadId: string): Promise<DmPresentEntry[]> {
  const { data, error } = await admin
    .from('item_plans')
    .select('tasks')
    .eq('user_id', userId)
    .eq('kind', DM_PRESENT_KIND)
    .eq('entity_id', threadId)
    .maybeSingle();
  if (error || !data) return [];
  const rows = Array.isArray((data as { tasks?: unknown }).tasks) ? ((data as { tasks: unknown[] }).tasks) : [];
  return rows.filter(isEntry);
}

/** THE CLEAR BEFORE THE RUN: the bridge's first act, so a turn can only ever read its own cards. */
export async function clearDmPresents(admin: Admin, userId: string, threadId: string): Promise<void> {
  try {
    await admin.from('item_plans').delete()
      .eq('user_id', userId).eq('kind', DM_PRESENT_KIND).eq('entity_id', threadId);
  } catch { /* transport only — never breaks a chat */ }
}

/** The internal route's write: append one present for this thread. Best-effort by construction. */
export async function pushDmPresent(
  admin: Admin, userId: string, threadId: string,
  entry: { turn?: string | null; collection?: CollectionSpec; event?: EventSpec },
): Promise<void> {
  if (!userId || !threadId || (!entry.collection && !entry.event)) return;
  try {
    const existing = await readEntries(admin, userId, threadId);
    if (existing.length >= DM_PRESENT_MAX) return;
    const next: DmPresentEntry[] = [...existing, {
      turn: entry.turn ?? null,
      ...(entry.collection ? { collection: entry.collection } : {}),
      ...(entry.event ? { event: entry.event } : {}),
    }];
    await admin.from('item_plans')
      .upsert({ user_id: userId, kind: DM_PRESENT_KIND, entity_id: threadId, tasks: next,
        updated_at: new Date().toISOString() }, { onConflict: 'user_id,kind,entity_id' });
  } catch { /* transport only — never breaks a tool */ }
}

/** The bridge's read: take everything this turn may claim, and delete the row. Entries stamped for
 *  a DIFFERENT turn are dropped (never re-served — a card belongs to the sentence that made it). */
export async function drainDmPresents(
  admin: Admin, userId: string, threadId: string, opts: { turn?: string | null } = {},
): Promise<DmPresentEntry[]> {
  try {
    const all = await readEntries(admin, userId, threadId);
    if (!all.length) return [];
    await clearDmPresents(admin, userId, threadId);
    const turn = opts.turn ?? null;
    return all.filter((e) => e.turn == null || turn == null || e.turn === turn);
  } catch { return []; }
}
