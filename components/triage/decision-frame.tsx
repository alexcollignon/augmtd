// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE DECISION CARD (W15.3 · ONE DECISION PER SCREEN — owner walk, Sep 24: "we should have a
// more standardized component, so there's no expansion beyond a viewport height — I don't want the
// user to scroll for the buttons").
//
// One geometry for every decision the deck puts in front of a reader, whatever the item's kind —
// an email, a commitment, a meeting action, a notice, an invite, and any source added later. The
// frame knows NOTHING about kinds: it is handed a head (who · what · why) and a body (the evidence)
// and it gives both the same box.
//
// ── THE THREE PROMISES ──────────────────────────────────────────────────────────────────────────
// 1 · FIXED HEIGHT THAT FITS THE VIEWPORT. The card's outer height is ONE constant
//     (`DECISION_CARD_H`): the viewport less the page chrome above it and the action row below it,
//     clamped to a sane floor and ceiling. It is a HEIGHT, never a min- or max-height — a short card
//     and a long one occupy exactly the same box, so the row beneath it cannot move.
// 2 · THE CONTENT SCROLLS INSIDE. The head is bounded (its lines clamp); the body is the one scroll
//     region (`data-decision-scroll`). A long thread scrolls within the card — the page never does.
// 3 · THE ACTION ROW IS PINNED. It lives OUTSIDE the scroll region, in its own fixed-height slot
//     (`DecisionActionsSlot`, `DECISION_ACTIONS_H`), so every tail it can open (the Later whens,
//     the posture offer, a refusal) opens INSIDE the slot and never pushes anything down.
// And the skeleton (`DecisionCardSkeleton`) IS this frame — the same class, the same box — so a
// card whose evidence is still on its way already stands at its full height on first paint.
//
// Pure presentation: no fetch, no verb, no keyboard. Client-safe by construction (its one import is the
// kit's presentational placeholder primitive — W17).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from 'react';
// W17 · the ONE placeholder primitive — the evidence wait and the counting frame wear its shape and pulse.
import { PreparingShape, PREPARING_PULSE } from '@/components/thread/preparing-slot';

/** THE CARD'S ONE HEIGHT. 320px = the page's top padding + the deck's header line + the stack's
 *  shoulders + the pinned action row + breathing room at the foot. Floor 240px (a phone held
 *  sideways still gets a card), ceiling 620px (a tall monitor does not get a sheet of paper). */
export const DECISION_CARD_H = 'h-[clamp(240px,calc(100dvh_-_320px),620px)]';

/** THE ACTION ROW'S ONE HEIGHT: the big pair (44) · gap (8) · the quiet row (32) · gap (8) · the
 *  tail line (32). Whatever opens beneath the verbs opens inside this. */
export const DECISION_ACTIONS_H = 'h-[124px]';

/** THE FRAME'S SHELL — exported so a gate (and the skeleton) can prove it is one string. */
export const DECISION_CARD_SHELL =
  'flex flex-col overflow-hidden rounded-2xl border border-neutral-200/70 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]';

export function DecisionCardFrame({ head, children, loading = false }: {
  /** Who · what kind · the title · why it is here. Bounded by the caller's own line clamps. */
  head?: ReactNode;
  /** The evidence — the thing itself. This is the ONLY region that scrolls. */
  children?: ReactNode;
  /** The evidence is still on its way (the frame stands at full height regardless). */
  loading?: boolean;
}) {
  return (
    <div data-decision-card aria-busy={loading || undefined} className={`${DECISION_CARD_H} ${DECISION_CARD_SHELL}`}>
      {head != null && <div data-decision-head className="flex-shrink-0">{head}</div>}
      <div data-decision-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        {children}
      </div>
    </div>
  );
}

/** THE EVIDENCE'S OWN PLACEHOLDER — quiet bars inside the scroll region while a read is in flight. */
//  W17 · it IS the one placeholder primitive (components/thread/preparing-slot.tsx `evidence` shape — the
//  kit's urgent pulse, reduced motion honoured, no words: a read is not work being made).
export function DecisionEvidenceSkeleton() {
  return <PreparingShape shape="evidence" className="flex flex-col gap-2 px-5 pt-1" />;
}

/** THE CARD BEFORE THERE IS A CARD — the same frame, the same height, a claim of nothing. A
 *  `message` (e.g. "Counting the rest of the account…") is the only words it may carry. */
export function DecisionCardSkeleton({ message }: { message?: string | null }) {
  return (
    <DecisionCardFrame loading head={
      <div className="flex items-center gap-2.5 px-5 pt-4">
        <span aria-hidden className={`h-7 w-7 flex-shrink-0 rounded-full bg-neutral-100 ${PREPARING_PULSE}`} />
        <div aria-hidden className={`h-3 w-28 rounded bg-neutral-100 ${PREPARING_PULSE}`} />
      </div>
    }>
      {message
        ? <p className="px-5 pt-4 text-[13px] text-neutral-400">{message}</p>
        : <div className="pt-4"><DecisionEvidenceSkeleton /></div>}
    </DecisionCardFrame>
  );
}

/** THE PINNED ACTION ROW'S SLOT — fixed height, outside the card's scroll region. The verbs belong
 *  to whoever mounts this (the deck's station); the slot only guarantees they never move. */
export function DecisionActionsSlot({ children }: { children: ReactNode }) {
  return (
    <div data-decision-actions className={`${DECISION_ACTIONS_H} flex flex-shrink-0 flex-col gap-2 overflow-hidden`}>
      {children}
    </div>
  );
}
