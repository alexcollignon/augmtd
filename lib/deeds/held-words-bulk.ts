// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HELD LEDGER'S BULK WORDS + BOUNDS (stabilization W8.3 — THE LIST SAYS ONLY WHAT WAS JUDGED).
//
// Owner walk, Sep 23: a class row read "Notices · 1,223 … Archive 200" and "Newsletters · 1,815 …
// Unsubscribe 200". The number beside the verb was the DEED'S cap (a deed larger than 200 is a
// migration), printed as if it were the group. The group truth is the count; the deed truth is the
// cap; the label must carry both — "Archive the newest 200 of 1,223" — and the card must say what
// happens to the rest (they stay, and the verb offers the next newest once these are done).
//
// W8.6 · THE WHOLE GROUP: the archive/trash deed now acts on its whole group (paged through the one
// commit door), so the cap handed to `bulkVerbLabel` is the VERB'S OWN BOUND (`deedBoundFor`,
// lib/deeds/words.ts — 5,000 for archive/trash, one page for unsubscribe/expire). Within it the label
// is "Archive all 1,223"; past it, the same law still names the bound ("the newest 5,000 of 6,200").
//
// PURE, CLIENT-SAFE (no imports), gate-assertable by a CLI suite that cannot import a component.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** THE WAITING/WATCHED BANDS' DECLARED BOUND — how many rows one band serves in a response. The
 *  waiting band is judged work only, small by construction; past this `hasMore` is true and the
 *  footer names the bound (never a bare "showing N of M"). Read by the pure ledger AND the page. */
export const HELD_BAND_ROWS_BOUND = 500;

/** The class row's verb label. `picked` > 0 → exactly those; within the cap → "all N"; past the cap
 *  → the newest `cap` OF the group (the deed walks the class in the ledger's own newest-first order).
 *  `cap` is the verb's own deed bound (`deedBoundFor`), never a page size. */
export function bulkVerbLabel(verbWord: string, groupCount: number, picked: number, cap: number): string {
  if (picked > 0) return `${verbWord} ${picked.toLocaleString('en-US')}`;
  if (groupCount > cap) return `${verbWord} the newest ${cap.toLocaleString('en-US')} of ${groupCount.toLocaleString('en-US')}`;
  return `${verbWord} all ${groupCount.toLocaleString('en-US')}`;
}

/** The card's scope line when a class deed covers less than its group — what happens to the rest.
 *  Null when the deed is the whole group. */
export function bulkScopeLine(deedCount: number, groupCount: number): string | null {
  if (groupCount <= deedCount) return null;
  const rest = groupCount - deedCount;
  return `the newest ${deedCount.toLocaleString('en-US')} of ${groupCount.toLocaleString('en-US')} — the other ${rest.toLocaleString('en-US')} stay, and the verb offers the next newest once these are done`;
}
