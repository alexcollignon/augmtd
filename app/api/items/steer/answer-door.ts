// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANSWER IS SAVED — the steer door's exchange writes (stabilization W19.B, Sep 28).
//
// THE INCIDENT (owner walk, Sep 28): a project room served "Catch me up on this client…" with nothing
// under it, twice. The rail persisted the reader's question and kept the reply in client state only;
// this door wrote a turn only for a presented card. Every reload, resume or re-open showed the
// question last. The Home door had the law since Aug 26 (app/api/home/ask `persistAnswer` — THE
// ANSWER SURVIVES THE TAB); the room door never got it.
//
// THE LAW, as this door now keeps it — the SERVER writes both halves of a chat exchange:
//   1 · THE QUESTION is written at the door, keyed `ask:<answerKey>` (the client mints the key per
//       question). The unique (user_id, room_key, dedupe_key) index makes that insert THE CLAIM: exactly
//       one request per question gets 'claimed'; a retry, a double submit, a late duplicate delivery
//       collides and gets 'exists'. The key never changes afterwards, so the collision holds forever.
//       A user turn is chat whatever key it carries (lib/room/turns.ts `archiveRoomChat` — the Sep 15
//       law), so New chat / Resume still move it.
//   2 · THE ANSWER is written only by the claiming request, and only while its question is still live
//       (an answer landing after a New chat archived its question writes nothing — THE RESET WINS,
//       server-side too; the rail's own stale-drop sweeps the millisecond window).
//   3 · The answer is written in the SAME shape the Home door writes: role system, the prose as said
//       (grounding tags intact), refs carrying their tags — and NO key, NO author, NO component. That
//       is exactly the exchange boundary the room's session law reads, so a New chat archives the
//       answer with its question and a Resume brings both back. The rail renders an unhandled system
//       turn as the seat's own bubble (components/home/room-chat.ts `isAnswerTurn`).
//   4 · "ASK AGAIN" on an orphan (a question with nothing under it) RE-KEYS THAT ROW to the new key — a
//       conditional update on its current key (or on "no key", for a question written before W19), so
//       exactly one re-ask claims it and the record never holds the same question twice.
//
// A caller that sends no `answerKey` (a decision pick, a preview, the email card's redraft, a
// standing composer that writes its own turns) is untouched: the door persists nothing new for it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { tagOf } from '@/lib/home/ask-refs';
import { looseRoomKey } from '@/lib/room/turns';

export type SteerKind = 'email' | 'followup' | 'commitment' | 'awareness' | 'meeting' | 'entity';

/** WHERE this door's turns land — the SAME rule the rail's door reads (components/home/item-rail.tsx
 *  `door` → lib/room/door.ts `roomKeyForDoor`): the entity id for the project door; `<kind>:<id>`
 *  for an item door, with a followup conversing as the commitment it is. */
export function steerRoomKey(kind: SteerKind, id: string): string {
  if (kind === 'entity') return id;
  const itemKind = kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox';
  return looseRoomKey(itemKind, id);   // THE ONE loose-key producer (lib/room/turns.ts)
}

/** The client-minted per-question key: a short opaque id (a uuid in practice). */
export function validAnswerKey(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

export const askKeyOf = (k: string): string => `ask:${k}`;

const isUniqueViolation = (err: { code?: string | null; message?: string | null } | null | undefined): boolean =>
  !!err && (err.code === '23505' || /duplicate key value/i.test(String(err.message ?? '')));

/**
 * 1 · THE QUESTION = THE CLAIM. Returns 'claimed' for exactly one request per question (the insert
 * that won the unique index, or the re-ask that re-keyed its orphan), 'exists' for every other
 * delivery, 'failed' when nothing could be written (no answer will be written either).
 */
export async function writeAskTurn(
  client: SupabaseClient, userId: string, roomKey: string, answerKey: string, text: string,
  reask?: { turnId: string; priorKey: string | null } | null,
): Promise<'claimed' | 'exists' | 'failed'> {
  try {
    if (reask) {
      let q = client.from('room_turns')
        .update({ dedupe_key: askKeyOf(answerKey) })
        .eq('id', reask.turnId).eq('user_id', userId).eq('room_key', roomKey)
        .eq('role', 'user').is('archived_at', null);
      q = reask.priorKey ? q.eq('dedupe_key', askKeyOf(reask.priorKey)) : q.is('dedupe_key', null);
      const { data, error } = await q.select('id');
      if (error) return 'failed';
      return (data ?? []).length === 1 ? 'claimed' : 'exists';
    }
    const { error } = await client.from('room_turns').insert({
      user_id: userId, room_key: roomKey, role: 'user', text,
      refs: null, component: null, author: null, dedupe_key: askKeyOf(answerKey),
    });
    if (!error) return 'claimed';
    return isUniqueViolation(error) ? 'exists' : 'failed';
  } catch { return 'failed'; }
}

/** 2 · Is the claimed question still LIVE (not archived by a New chat while the reasoning ran)? */
export async function questionStillLive(
  client: SupabaseClient, userId: string, roomKey: string, answerKey: string,
): Promise<boolean> {
  try {
    const { data, error } = await client.from('room_turns').select('id')
      .eq('user_id', userId).eq('room_key', roomKey).eq('role', 'user')
      .eq('dedupe_key', askKeyOf(answerKey)).is('archived_at', null);
    if (error) return false;
    return (data ?? []).length === 1;
  } catch { return false; }
}

/** The answer's words exactly as the rail paints them live — so the live turn and the stored row are
 *  the same text (the rail's merge keys on it) and a reload shows what was read. */
export const answerTextOf = (say: string | null | undefined): string => (say && say.trim() ? say : 'Done.');

/**
 * 3 · THE ANSWER ROW — the Home door's shape (app/api/home/ask `persistAnswer`): prose as said, refs
 * with their tags, and no handle at all (the exchange boundary). Pure.
 */
export function answerTurnRow(
  userId: string, roomKey: string,
  turn: { say?: string | null; refs?: Array<{ label: string; href?: string | null }> | null },
): { user_id: string; room_key: string; role: 'system'; text: string; refs: Array<{ label: string; href: string | null; tag?: string }> | null; component: null; author: null; dedupe_key: null } {
  return {
    user_id: userId, room_key: roomKey, role: 'system', text: answerTextOf(turn.say),
    refs: answerRefsOf(turn.refs), component: null, author: null, dedupe_key: null,
  };
}

/** The answer's refs as stored — label, href and the TAG the prose placed (THE REF IS ITS TAG). One
 *  mapping for the answer row and the card turn that carries an answer (W19.2a). Pure. */
export function answerRefsOf(
  refs: Array<{ label: string; href?: string | null }> | null | undefined,
): Array<{ label: string; href: string | null; tag?: string }> | null {
  const out = (refs ?? []).map((r) => ({ label: r.label, href: r.href ?? null, ...(tagOf(r) ? { tag: tagOf(r) } : {}) }));
  return out.length ? out : null;
}

/** 3 · Write the answer — only by the claiming request, only while its question is live. Checks its
 *  error; never throws. A failed write leaves an orphan, which the rooms render with "Ask again". */
export async function writeAnswerTurn(
  client: SupabaseClient, userId: string, roomKey: string,
  turn: { say?: string | null; refs?: Array<{ label: string; href?: string | null }> | null },
): Promise<boolean> {
  try {
    const { error } = await client.from('room_turns').insert(answerTurnRow(userId, roomKey, turn));
    return !error;
  } catch { return false; }
}
