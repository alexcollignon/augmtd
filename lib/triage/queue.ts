// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRIAGE QUEUE — the deck's stack while the account is still being read (owner, Sep 18: the
// door "wasn't opening"; the deck gated on a full ~9s ledger derivation before showing card one).
//
// THE LAW OF THE MERGE. The deck is a cursor over an array, so an array that MOVES under a cursor
// moves the card a person is mid-keystroke on. Therefore:
//   1 · WHAT IS ALREADY IN THE STACK KEEPS ITS PLACE. Never reordered, never removed, never
//       re-indexed — the rows behind the cursor are the session's own record of what was decided,
//       and the row under it is the one the reader is looking at.
//   2 · WHAT ARRIVES LATER IS APPENDED, in the server's own order, and only if it is not already
//       in the stack (id identity, the same id every surface files these rows by).
//   3 · NOTHING HERE RANKS, FILTERS OR SORTS. The order is the order it was handed, twice over.
// The consequence is the instant open: the deck mounts on whatever rows the client already holds
// (the Home's own held-back rows, a warm cache) and the full ledger EXTENDS the same stack in
// place when it lands, rather than replacing it.
//
// PURE by construction — no framework, no I/O, no clock — so the law is assertable by a CLI gate.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The one thing the merge needs to know about a row: how to tell it from another one. */
export type Queued = { id: string };

/**
 * Extend `current` with the rows of `incoming` it does not already hold.
 *
 * Returns `current` BY IDENTITY when nothing new arrived — a merge that allocated a fresh array
 * every time would re-render (and re-key) a stack nobody changed.
 */
export function mergeQueue<T extends Queued>(current: readonly T[], incoming: readonly T[]): T[] {
  if (current.length === 0) return [...incoming];
  const seen = new Set(current.map((r) => r.id));
  const added = incoming.filter((r) => !seen.has(r.id));
  if (added.length === 0) return current as T[];
  return [...current, ...added];
}

/**
 * THE HONEST COUNTER. A stack that is still growing may not state a total: "23 left" over a queue
 * the account has not finished counting is a number we cannot back, and the first extension makes
 * it a visible lie. While partial the deck says what it HAS and admits the rest is still coming.
 */
export function queueCount(left: number, complete: boolean): string {
  return complete ? `${left} left` : `${left} here · counting the rest…`;
}
