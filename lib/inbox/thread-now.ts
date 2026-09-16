// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WATERMARK READ (Aug 2's law, extracted Sep 8 — one implementation, two readers).
//
// "Where does this thread stand NOW?" is a question two different minds ask: the entity STATE
// synthesis (whose ledger lines must carry the thread's current position, not its founding
// snapshot) and — since the owner's Sep 8 walk — the ROOM's composer, which has to see the world
// the way a person does before it demands a deed. The read was written once, inline, inside
// `assembleLedger`; a second copy in the room would have been a fork of the one fact that matters
// most (a fork of THIS read is how a room ends up demanding a reply the user already sent).
//
// So it lives here, and both callers share it. The important half is that the newest message
// INCLUDES THE USER'S OWN SENT MAIL (`fromUser`): a thread whose last word is the user's is a
// thread the user has already answered — from our composer or straight from their own mailbox,
// which we cannot tell apart and must not need to.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt } from '@/lib/utils/clip-for-prompt';
import { topMessageOf } from '@/lib/inbox/top-message';
import { clip } from '@/lib/room/turns';

export type ThreadNow = {
  /** 'the user' when the last word is theirs, else the counterparty's display name. */
  who: string;
  /** TRUE when the newest message on the thread was sent BY the user (the settled-deed signal). */
  fromUser: boolean;
  /** YYYY-MM-DD (the ledger's comparison key — unchanged from the inline original). */
  at: string;
  /** ISO to the minute, for surfaces that speak a time as well as a day. */
  atFull: string;
  /** The sender's OWN words (quote-stripped), clipped under the excerpt-honesty law. */
  gist: string;
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WATERMARK SURVIVES THE CLIP (owner walk, Sep 8 — root cause C7 of the room that kept asking).
//
// The NOW clause is APPENDED to a ledger line, so on the longest lines — the ones with the most
// history, i.e. the most consequential — a fixed head-clip cut off exactly the clause that says the
// matter is settled. The served page literally read `[L8] … — NOW (20`: the state synthesis and the
// room's composer were handed a truncated watermark and went on demanding a deed already done.
//
// THE LAW: the NOW clause is STRUCTURAL TRUTH, not decoration. It survives whole; the line's HEAD
// (title/gist — recoverable context) is what yields to the budget. ONE implementation, beside the
// read that authors the clause, so no consumer can re-invent a clip that eats it again.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The clause's own opening — the marker every clipper locates it by (never a hand-typed string). */
export const NOW_CLAUSE_MARK = ' — NOW (';

/** The clause, written ONCE (the ledger's watermark half). */
export function nowClause(n: ThreadNow): string {
  return `${NOW_CLAUSE_MARK}${n.at}, ${n.who} spoke last): "${n.gist}"`;
}

/**
 * Clip a ledger line to `max` WITHOUT losing its watermark: the NOW clause rides intact and the head
 * is word-boundary clipped into whatever budget remains (never below a floor — a nameless line is
 * useless too). A line with no clause clips as before, word-boundary rather than mid-word.
 */
export function clipLedgerLine(text: string, max: number): string {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  const i = t.lastIndexOf(NOW_CLAUSE_MARK);
  if (i < 0) return clip(t, max);
  const clause = t.slice(i);
  // The clause is bounded by construction (its gist is clipped at 110 by the read above), so the
  // head keeps a real floor even when the clause is long — the line may exceed `max` by design:
  // truth about the present outranks a byte budget.
  return `${clip(t.slice(0, i), Math.max(60, max - clause.length))}${clause}`;
}

/**
 * The newest message per thread, in ONE batched query. Desc order, first-seen-wins — the same
 * mechanic the ledger has used since Aug 2; the caps (60 threads, 300 rows) are its caps too.
 */
export async function latestByThread(
  supabase: SupabaseClient, userId: string, threadIds: string[],
): Promise<Map<string, ThreadNow>> {
  const out = new Map<string, ThreadNow>();
  const tids = [...new Set(threadIds.filter(Boolean).map(String))];
  if (!tids.length) return out;
  try {
    const { data } = await supabase.from('emails')
      .select('thread_id, from_name, from_address, received_at, is_from_user, body')
      .eq('user_id', userId).in('thread_id', tids.slice(0, 60))
      .order('received_at', { ascending: false }).limit(300);
    for (const m of (data ?? []) as Array<Record<string, unknown>>) {
      const t = String(m.thread_id);
      if (out.has(t)) continue; // desc order — first seen is the newest
      const at = String(m.received_at || '');
      out.set(t, {
        who: m.is_from_user ? 'the user' : String(m.from_name || m.from_address || 'them'),
        fromUser: !!m.is_from_user,
        at: at.slice(0, 10),
        atFull: at.slice(0, 16).replace('T', ' '),
        // EXCERPT-HONESTY (Aug 4): a quoted gist declares its own clipping — a hard cut reads as
        // "the email is truncated" to whatever mind consumes it (found live on a normal email).
        gist: clipForPrompt(topMessageOf(String(m.body || '')).replace(/\s+/g, ' ').trim(), 110),
      });
    }
  } catch { /* the founding line still stands — an unreadable watermark is never fatal */ }
  return out;
}
