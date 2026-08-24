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

export type PanelPlanInput = {
  /** A rendered DecisionCard (the judged decision with ≥2 options) is primary in this room. */
  hasDecision: boolean;
  /** A KIND-SPECIFIC card that IS the decision — same law, different renderer. The handoff gate
   *  (a source='handoff' commitment with its ask still open) renders Approve / Hold back inside
   *  its own card; the rail's big CTA and the offer chips would restate that one choice a second
   *  and third time (owner, Aug 20: the room asked for the decision twice). Registering it here —
   *  not in the rail, not in the card — is what keeps ONE placement table: any future card that
   *  IS the room's decision sets this flag and inherits the yield by construction. */
  hasGatedDecision?: boolean;
};

export function panelPlan(raw: PanelPlanInput): PanelPlan {
  // ONE notion of "a decision is rendered here" — every kind of decision card folds into it
  // BEFORE the table reads it, so the table itself never branches on kind.
  const input = { hasDecision: raw.hasDecision || !!raw.hasGatedDecision };
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

// ── APPLYING THE TABLE AT A DOOR THAT OWNS ITS VIEW ────────────────────────────────────────────
// The rail reads its own `decision` prop and consults the table itself. A door whose decision is a
// KIND-SPECIFIC card (the handoff gate lives on the commitment deep-dive, not in the rail) has to
// hand the table's verdict to the rail through the one thing it already passes: the room view.
// This is that hand-off — pure, kind-blind, and here rather than in the door, so the suppression
// stays a property of the placement table and not of one screen.

/** The parts of a room view the MOVE/OFFERS render from (RailView-shaped, structurally typed so
 *  this module stays free of component imports). */
type MoveBearing = {
  move?: unknown;
  offers?: unknown;
  entity?: { move?: unknown; offers?: unknown; nextMove?: unknown; nextMoveHref?: unknown } | null;
};

/** Strip from a room view whatever the plan says this room does not render. Returns the SAME
 *  object when nothing is suppressed (no needless remount churn downstream). */
export function applyPanelPlan<V extends MoveBearing>(view: V, plan: PanelPlan): V {
  if (plan.showMove && plan.showOffers) return view;
  const ent = view.entity;
  return {
    ...view,
    ...(plan.showMove ? {} : { move: null }),
    ...(plan.showOffers ? {} : { offers: [] }),
    ...(ent
      ? {
          entity: {
            ...ent,
            ...(plan.showMove ? {} : { move: null, nextMove: null, nextMoveHref: null }),
            ...(plan.showOffers ? {} : { offers: [] }),
          },
        }
      : {}),
  };
}
