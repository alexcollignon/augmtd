// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NO-MUTATION LAW (docs/threads-plan.md — "The no-mutation law")
//
//   "A served surface never changes in place while the reader is looking at it. Composed prose
//    (briefs, summaries), inventory counts, and verdict-bearing chrome are frozen for the open
//    view; a recompute lands on the NEXT open, or arrives as an APPENDED message."
//
// Allowed live behaviour, exhaustively: appending new timeline items · filling a skeleton that
// never showed content · streaming an in-flight reply · explicitly-live run status the user is
// watching (the workflow drawer's "step N/M") · changes the user's own action just caused.
//
// This module is the ONE mechanism every loader consults before letting a landing payload replace
// what is already painted. The sig-gated `after()` recompose pattern is untouched and correct —
// the violation was never the recompute, only the hot-swap into an OPEN view. So a held payload is
// never a lost one: every loader still writes it to its localStorage cache, which IS the next
// open's first paint.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Why a payload landed. `open` = the mount's own fetch · `user` = the reader's own action caused
 *  it (a membership move, an approve, a preparation they asked for) · `background` = a poll, a
 *  focus/visibility refresh, a realtime nudge — nobody asked, so nothing on screen may move. */
export type ArrivalReason = 'open' | 'user' | 'background';

/** May this arrival replace what the reader is looking at?
 *  `painted` = something real (not a skeleton) is already on screen for this view. */
export function mayReplaceInPlace(reason: ArrivalReason, painted: boolean): boolean {
  if (!painted) return true; // filling a skeleton that never showed content
  return reason === 'user'; // the reader's own action just caused it
}

// ── THE SHARED FREEZE (lifted Sep 6 from the Home deck, which authored them) ────────────────────
// Every surface that holds a background arrival needs the same three moves: rows keep their seat and
// new ones append · id-keyed chrome keeps its painted value · composed prose keeps the words it
// opened with. They live HERE so the law can't drift between the deck, the portfolio, the timeline
// and the report — a private copy is exactly how a law dies.
// ⚠️ components/home/home-view.tsx still carries the pre-lift local copies (it was off-limits in the
// change that lifted them); folding it onto these imports is a mechanical follow-up.

/** Rows already on screen keep their painted text AND their seat; genuinely new rows append at the
 *  end; a row the server has dropped stays until the next open (it leaves by the reader's own
 *  action). A row with no id can't be told apart from one already rendered, so it is never appended
 *  (a duplicate is a mutation too). */
export function freezeRows<T>(
  prevRows: T[] | null | undefined,
  nextRows: T[] | null | undefined,
  idOf: (r: T) => string | undefined,
): T[] {
  if (!prevRows?.length) return nextRows ?? [];
  if (!nextRows?.length) return prevRows;
  const painted = new Set(prevRows.map(idOf).filter(Boolean) as string[]);
  const added = nextRows.filter((r) => { const k = idOf(r); return !!k && !painted.has(k); });
  return added.length ? [...prevRows, ...added] : prevRows;
}

/** Maps keyed by an id (row tags, project tags, cues, weights): a key already rendered keeps its
 *  painted value; new keys ride in for the new rows. */
export function freezeMap<V>(
  prevMap: Record<string, V> | undefined,
  nextMap: Record<string, V> | undefined,
): Record<string, V> | undefined {
  if (!prevMap) return nextMap;
  if (!nextMap) return prevMap;
  return { ...nextMap, ...prevMap };
}

/** Composed prose (a brief, a summary, an authored line): the version this open painted is the
 *  version this open keeps. A recompose is the NEXT open's opening. */
export function freezeProse<T>(prev: T | null | undefined, next: T | null | undefined): T | null {
  return prev ?? next ?? null;
}

/** THE EMPTY-PAINT RULE (found live, Sep 7 — the walk): a painted EMPTY view is a skeleton
 *  wearing words, not content the reader is attached to. A stale empty cache painted "Your work
 *  is being mapped" over a full portfolio, and the hold then served the lie for the whole visit.
 *  Every hold site computes `painted` as CONTENT painted: `hasContent(rowCount) && state`,
 *  never state-present alone. An empty view filling with truth is a skeleton fill (allowed);
 *  a full view emptying under the reader stays outlawed (the payload lands on the next open). */
export function hasContent(count: number | null | undefined): boolean {
  return (count ?? 0) > 0;
}

/** THE FRESHNESS FLOOR, paired with the law (the stamped-cache doctrine, July 30): a room is an
 *  ACTION surface, so it must not paint from a cache too old to trust. Too old → the honest
 *  skeleton, which the landing fetch then FILLS (allowed) instead of swapping content under the
 *  reader. Younger than this → paint it and hold the recompute for the next open. */
export const ROOM_CACHE_MAX_AGE_MS = 15 * 60_000;
