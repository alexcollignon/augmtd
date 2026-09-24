// ════════════════════════════════════════════════════════════════════════════════════════════════
// W15.3 · ONE DECISION PER SCREEN — WHICH SHAPE "When you're ready" OPENS IN. Pure, client-safe.
//
// The owner's walk (Sep 24) chose the one-at-a-time card: "why not this as only option". The list
// stays as the SECONDARY "View all" — it is how a reader scans, and where the Handled bulk groups
// live — but it never becomes what the door opens into by surprise:
//   · THE HOME'S DOOR ALWAYS OPENS THE CARD. A "View all" chosen in an earlier visit does not turn
//     the next deliberate click on "When you're ready" into a list.
//   · AN ADDRESS THAT NAMES THE LENS (a refresh, a deep link) honours the reader's own last choice
//     — a per-viewer preference in this browser only, read through the try/catch cache.
//   · The key is v2: a v1 "list" stamp was made under the old contract (the list persisted and
//     reopened from the door), so it is not carried into this one.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type WaitingShape = 'deck' | 'list';

/** The per-viewer preference's key (browser storage, never shared, never read by the server). */
export const TRIAGE_VIEW_KEY = 'aug-triage-view-v2';

/** THE DEFAULT IS THE CARD. */
export const DEFAULT_WAITING_SHAPE: WaitingShape = 'deck';

export function initialWaitingShape(opts: { fromHome: boolean; stored: unknown }): WaitingShape {
  if (opts.fromHome) return DEFAULT_WAITING_SHAPE;
  return opts.stored === 'list' ? 'list' : DEFAULT_WAITING_SHAPE;
}
