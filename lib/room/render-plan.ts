// ─── THE ONE RENDERER (experience-spec Part "THE MACHINE" — the placement table in code) ─────
// Every door — deep-dive, project room (embedded item), Home chat inline — consumes THIS plan.
// Doors provide scope and chrome; the plan provides placement. A component that renders left on
// one door renders left on all of them, by construction (the owner's find: the decision card sat
// left on the deep-dive and RIGHT on the project room's stage, while the brief said "below").
//
// The table (from the spec):
//   CONVERSATION (left) — brief · decision card · ask checklist · document artifact cards ·
//                          MOVE + offers · composer. Every exchange component.
//   STAGE (right)       — filed truth (the message, files) + send-shaped drafts in the composer
//                          + the item verb row. NEVER an exchange component.
//
// Pure and deterministic — no model, no reads. Callers pass what they hold; the plan says what
// renders where and what is suppressed.

export type PanelSlot = 'brief' | 'decision' | 'ask' | 'artifacts' | 'move' | 'composer';

export type PanelPlan = {
  /** The conversation pane's slot order (render what you have, in this order, skip absent). */
  order: PanelSlot[];
  /** Offer chips render only when no decision card is primary (the card owns the choices). */
  showOffers: boolean;
  /** THE MOVE yields to a rendered decision (owner, Aug 14 — the card said "1/2/3" and a purple
   *  "Decide: …?" button restated it directly beneath: two CTAs for one choice, law 7 broken).
   *  While a decision card renders, it IS the primary — the room shows no competing CTA row;
   *  the move returns the moment the decision is made or dismissed. */
  showMove: boolean;
  /** The merged artifact-card action variant must NOT carry decision chips when the full card
   *  renders (one component, one render). */
  mergedCardDecisionChips: false;
  /** The stage NEVER hosts the decision card — on every door, embedded included. */
  stageHostsDecision: false;
};

export function panelPlan(input: { hasDecision: boolean }): PanelPlan {
  return {
    // The spec's seat order: the brief opens; the decision (when present) is the primary and sits
    // directly under it; a surviving ask follows (the editor reconciles coexistence); document
    // cards at the stream edge; the MOVE after components; the composer closes.
    order: input.hasDecision
      ? ['brief', 'decision', 'ask', 'artifacts', 'move', 'composer']
      : ['brief', 'ask', 'artifacts', 'move', 'composer'],
    showOffers: !input.hasDecision,
    showMove: !input.hasDecision,
    mergedCardDecisionChips: false,
    stageHostsDecision: false,
  };
}
