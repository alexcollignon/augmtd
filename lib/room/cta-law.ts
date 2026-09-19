// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q6 · A CTA REVIEWS WORK DONE (docs/attention-plan.md PART III — the owner's Sep 17 walk).
//
// The find, verbatim from the walk: a primary button reading
//     "Next: Confirm Sep 14 call status, send material, lock call time"
// — a three-item to-do list wearing a button. A primary action is a promise that something was
// PREPARED and the user's part is to review it. A button that commands the user to start three
// pieces of work is the machine handing back its own job with a coat of paint on it.
//
// THE LAW: a move whose object is not staged does not render as a primary action. It renders as the
// CoS's OFFER — first person, sayable, honest about what does not exist yet ("I can draft the
// confirmation and propose a slot — say the word") — or as the needs-shaping chip (Q4's word).
//
// TWO ENFORCEMENTS, one law:
//   · AT COMPOSITION (lib/room/brief.ts): after the board validates the MOVE's target, the same
//     board says whether that target has anything PREPARED on it. Nothing prepared → the move is
//     demoted to an offer, in code, whatever the model wrote. This rides the existing
//     board-validation idiom (THE DEED IS CODE-BUILT / MEMBERSHIP IS NOT ABOUTNESS) — the model
//     picks, the code decides what it may look like.
//   · AT THE RENDER (components/home/item-rail.tsx): the pre-compose fallback ("Next: <entity's
//     stored next_move>") never went through a composer at all — it is a synthesis field from
//     weeks ago. It passes the SAME predicate against the rail's own staged facts: no staged
//     artifact, no primary button.
//
// A prompt rule is a hope; both seams carry the rule AND the floor (the house doctrine).
//
// PURE, zero-dependency, client-safe — the room, the composer and the gates read one implementation.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A move as both seams hold it: the words, and the board ref the code validated (or null). */
export type MoveLike = { label: string; ref?: string | null };

/** The one fact the law turns on: is the thing this move is about ALREADY PREPARED? */
export type StagedFacts = {
  /** The move's own validated target carries prepared work (a draft, an invite, a deliverable). */
  targetPrepared: boolean;
  /** The room mounts a prepared artifact card for this move even without a bound ref (the rail's
   *  "a move without a validated ref still has one object" case). */
  cardMounted?: boolean;
};

/** THE PREDICATE. A move may be a primary button only when its object is staged. */
export function moveIsStaged(f: StagedFacts): boolean {
  return f.targetPrepared || f.cardMounted === true;
}

// ── THE OFFER SENTENCE ──────────────────────────────────────────────────────────────────────────
// Composed DETERMINISTICALLY from the move's own words (zero AI at the floor — the floor must work
// on a cached move written by a model that is no longer running). First person, because the offer
// is the speaker's (Q1 · THE VOICE COLLAPSES), and it ends with the one thing the user has to do:
// say the word.

/** Strip an imperative's leading niceties and lower its first letter, so it reads inside a
 *  sentence ("Confirm the time" → "confirm the time"). Never touches an acronym or a name. */
export function moveAsPhrase(label: string): string {
  const t = String(label ?? '').trim().replace(/^Next:\s*/i, '').replace(/[.\s]+$/, '');
  if (!t) return '';
  const [first, ...rest] = t.split(' ');
  // A shouted/acronym first word ("RSVP", "EU") stays as written; an ordinary verb lowers.
  const lowered = /^[\p{Lu}][\p{Ll}'’-]+$/u.test(first) ? first.toLowerCase() : first;
  return [lowered, ...rest].join(' ');
}

/** THE CoS's OFFER — what the room says instead of a button it has not earned. */
export function shapingOffer(label: string): string {
  const phrase = moveAsPhrase(label);
  return phrase
    ? `I can shape this up — ${phrase} — and show you first. Say the word.`
    : 'I can shape this up and show you first — say the word.';
}

/** The sayable form of the same offer: what the click/word sends to the one conversation core,
 *  complete and self-contained (the offers contract — never a bare label to re-interpret). */
export function shapingSay(label: string): string {
  const phrase = moveAsPhrase(label);
  return phrase
    ? `Prepare what's needed to ${phrase} and show me the draft before anything is sent.`
    : 'Prepare the next step on this and show me the draft before anything is sent.';
}

export type CtaVerdict<M extends MoveLike> = {
  /** The move as it may render: `offer: true` means NEVER a primary button. */
  move: (M & { offer?: boolean }) | null;
  /** What the room says in place of the button, when the move was demoted. */
  offerText: string | null;
  demoted: boolean;
};

/**
 * THE FLOOR (pure). Hand it the move and the staged facts; it returns what may render.
 *
 * A null move passes through untouched — the absence of a CTA is already honest. A staged move
 * passes through untouched — that is the CTA this law exists to protect. An unstaged move survives
 * as an OFFER: its words are kept (they are the one true statement of what is next), but it is
 * marked so no surface can dress it as a primary action.
 */
export function enforceCtaLaw<M extends MoveLike>(move: M | null, f: StagedFacts): CtaVerdict<M> {
  if (!move?.label) return { move: null, offerText: null, demoted: false };
  if (moveIsStaged(f)) return { move, offerText: null, demoted: false };
  return { move: { ...move, offer: true }, offerText: shapingOffer(move.label), demoted: true };
}
