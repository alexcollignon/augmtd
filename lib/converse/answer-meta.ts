// ════════════════════════════════════════════════════════════════════════════════════════════════
// W23.B — WHERE A ROOM ANSWER'S RECEIPT LIVES (ONE FACT, ONE HOME).
//
// "Worked for 12s" and the steps under it must survive a reload, and a stopped answer must stay marked
// stopped. A coworker DM message keeps these in `work_messages.metadata` (the message's own column). A
// ROOM turn (Home `chat:<uuid>` rooms, item and project rooms) has no metadata column, and a `component`
// would move the answer out of the chat boundary (lib/room/turns.ts isChatTurn). So — the W21
// turn_skills idiom exactly — ONE companion record keyed by the stored turn's own id:
//   item_plans { kind: 'turn_meta', entity_id: '<roomKey>|<room_turns.id>', tasks: { roomKey, activity,
//   durationMs, stopped } }
// written and read through THE item_plans DOOR (lib/store/item-plans.ts). No migration; the turn row is
// untouched; the room turns read (GET /api/room/turns) merges it onto the turns it serves.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { answerMetaOf, type AnswerMeta, type TurnActivity } from '@/lib/converse/conversation';

export const TURN_META_KIND = 'turn_meta' as const;
const keyOf = (roomKey: string, turnId: string) => `${roomKey}|${turnId}`;

/** Record the receipt of the answer just persisted in `roomKey` (matched by its stored text among the
 *  room's newest system turns — the same match the followed-skills record uses). Best-effort; returns
 *  whether a record was written. Nothing to record → nothing written. */
export async function recordAnswerMeta(
  client: SupabaseClient, userId: string, roomKey: string | null, answerText: string | null | undefined,
  turn: { activity?: TurnActivity[]; durationMs?: number; stopped?: boolean } | null | undefined,
): Promise<boolean> {
  try {
    const meta = answerMetaOf(turn);
    if (!roomKey || !meta || !answerText?.trim()) return false;
    const { data, error } = await client.from('room_turns').select('id, text')
      .eq('user_id', userId).eq('room_key', roomKey).eq('role', 'system')
      .order('created_at', { ascending: false }).limit(5);
    if (error) return false;
    const row = ((data ?? []) as Array<{ id: string; text: string | null }>).find((t) => (t.text ?? '').trim() === answerText.trim());
    if (!row) return false;
    const { upsertPlan } = await import('@/lib/store/item-plans');
    const { error: upErr } = await upsertPlan(client, userId, TURN_META_KIND, keyOf(roomKey, row.id), { roomKey, ...meta });
    return !upErr;
  } catch { return false; }
}

/** Every recorded answer receipt in one room, by turn id. Paged by the door (NO SILENT CAPS). */
export async function readAnswerMetaForRoom(
  client: SupabaseClient, userId: string, roomKey: string,
): Promise<Record<string, AnswerMeta>> {
  const out: Record<string, AnswerMeta> = {};
  try {
    const { readPlans } = await import('@/lib/store/item-plans');
    const rows = await readPlans(client, userId, TURN_META_KIND, { keyPrefix: `${roomKey}|` });
    for (const r of rows) {
      const t = (r.tasks ?? {}) as { roomKey?: string | null; activity?: unknown; durationMs?: number | null; stopped?: boolean | null };
      if (t.roomKey !== roomKey) continue;
      const activity = (Array.isArray(t.activity) ? t.activity : [])
        .filter((a): a is TurnActivity => !!a && typeof (a as TurnActivity).label === 'string' && typeof (a as TurnActivity).atMs === 'number');
      const meta = answerMetaOf({ activity, durationMs: t.durationMs ?? undefined, stopped: t.stopped === true });
      const turnId = r.key.slice(roomKey.length + 1);
      if (meta && turnId) out[turnId] = meta;
    }
  } catch { /* the receipt is an enhancement — the turns still serve */ }
  return out;
}

/** Merge the receipts onto the turns a read serves (by id). Pure. */
export function withAnswerMeta<T extends { id?: string }>(turns: T[], metas: Record<string, AnswerMeta>): Array<T & AnswerMeta> {
  if (!Object.keys(metas).length) return turns as Array<T & AnswerMeta>;
  return turns.map((t) => (t.id && metas[t.id] ? { ...t, ...metas[t.id] } : t)) as Array<T & AnswerMeta>;
}
