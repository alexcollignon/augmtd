// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LEDGER'S OWN SENTENCES (docs/attention-plan.md A3 × Q2 × Q3) — pure, client-safe, zero AI.
//
// The CoS's one-sentence intro and the receipts footer are composed BY CODE from the numbers the
// route actually served. They live here rather than in the surface for one reason: a law is only
// alive while a gate enforces it, and a gate cannot import a 'use client' component that pulls
// `next/link` into a CLI process. Same words, one home, assertable.
//
// THE FLOOR THESE OBEY: never a claim the payload did not carry. "None urgent" is spoken only when
// the served `urgent` count is zero; "filed N this month" only when the log actually counted N.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The shape these read — the ledger route's response, as the surface receives it. */
export type HeldWordsLedger = {
  total: number;
  classes: Array<{ id: string }>;
  bands?: {
    waiting: { count: number; urgent: number };
    watched: { count: number };
    handled: { count: number };
  };
  servedCount?: number;
  poolRead?: number;
  poolSaturated?: boolean;
  filedThisMonth?: number;
};

/**
 * THE CoS's ONE SENTENCE — composed from the route's OWN THREE NUMBERS, deterministically (Q2).
 *
 * It states the gradient in the order the page renders it: what is WAITING (and whether any of it
 * has actually landed), then that everything else is HANDLED rather than owed, then the standing
 * promise. It never claims a number the payload did not carry, and "none urgent" is spoken ONLY
 * when the served `urgent` count is zero — a reassurance that can be wrong is worse than none.
 */
export function heldIntro(l: HeldWordsLedger, deckHeld: number): string {
  const b = l.bands;
  const waiting = (b?.waiting.count ?? 0) + deckHeld;
  const watched = b?.watched.count ?? 0;
  const handled = b?.handled.count ?? (l.total - (b?.waiting.count ?? 0) - watched);
  const urgent = b?.waiting.urgent ?? 0;
  const served = l.servedCount ?? 0;
  if (waiting + watched + handled === 0) return 'Nothing is being held back right now.';

  const parts: string[] = [];
  if (waiting > 0) {
    const shape = urgent > 0
      ? `${urgent} of them ${urgent === 1 ? 'has' : 'have'} a deadline that has landed`
      : 'none urgent';
    parts.push(served > 0
      ? `${waiting} real thing${waiting === 1 ? '' : 's'} wait behind today's ${served} — ${shape}, all alive.`
      : `${waiting} real thing${waiting === 1 ? '' : 's'} ${waiting === 1 ? 'is' : 'are'} waiting — ${shape}, all alive.`);
  }
  if (handled > 0) {
    parts.push(`Everything else is handled: ${handled.toLocaleString()} filed quietly${watched > 0 ? `, ${watched} more being watched` : ''}.`);
  } else if (watched > 0) {
    parts.push(`${watched} more ${watched === 1 ? 'is' : 'are'} being watched — someone else owes the next move.`);
  }
  parts.push('Nothing is deleted, and anything comes back.');
  return parts.join(' ');
}

// THE CoS's ONE LINE ON THE HOME — PROPOSED AND RETIRED THE SAME MORNING (Sep 18).
//
// The owner's walk asked for the calm board's sentence back under the greeting, so it was built
// HERE and deterministically: composed by code from facts the page had already been served (seats ·
// the day's next event · what filed today · a catch-up in flight), never a model, never a claim the
// page could not show beside it. He saw it live and removed it — "the top clara line should be
// removed" — which is the same call as Sep 13 ("in home, this feels too much, remove"), now made
// about the honest version too. So the seat is settled: THE GREETING STOPS AT THE GREETING.
//
// The composer is DELETED rather than parked, per the repo's own standing lesson: an orphaned
// function is a corpse the next reader re-mounts. Gate SQ12 asserts the absence on both sides —
// no composer here, no line on the Home — so the next restoration has to be a decision, not a drift.

/** THE RECEIPTS FOOTER — the honest bound of this account, in the route's own numbers, plus Q3's
 *  one earned claim: how many rows filed THEMSELVES this month (counted from the activity log). */
export function heldReceipts(l: HeldWordsLedger): string {
  const parts: string[] = [];
  if (typeof l.poolRead === 'number') parts.push(`read from ${l.poolRead} pending item${l.poolRead === 1 ? '' : 's'}`);
  parts.push(`${l.classes.length} class${l.classes.length === 1 ? '' : 'es'}`);
  if (typeof l.filedThisMonth === 'number' && l.filedThisMonth > 0) {
    parts.push(`filed ${l.filedThisMonth.toLocaleString()} this month`);
  }
  if (l.poolSaturated) parts.push('the read hit its cap — older items are not accounted for here');
  parts.push('nothing deleted');
  return parts.join(' · ');
}
