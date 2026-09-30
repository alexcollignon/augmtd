// ════════════════════════════════════════════════════════════════════════════════════════════════
// INPUTS HAVE A KIND (W35 — owner decision, docs/laws-registry.md `inputs-have-a-kind`).
//
// The judge's `requires` used to list ATTACHABLE artifacts only, and the resolver's attachability floor
// dropped everything else — so an input only the user knows ("which price should we quote?", "the IBAN
// for the refund", "the maximum budget") never reached the ask card, and the draft went out guessing or
// hedging. Every requirement now names WHAT IT IS:
//   attach — a THING that can be retrieved and attached (a document, file, sheet, deck, link): the
//            resolver searches for it; missing → an ask row answered by attaching.
//   answer — a specific FACT only the user holds (a figure, a price to quote, their account details
//            for a payment to them, contacts): never searched for; missing → an ask row answered by
//            TYPING it (the type-it door, or the composer), or the go-ahead.
// Both kinds flow into the SAME ask card. A secret (password, login, code, card number) is neither —
// the secret floor refuses it before any of this runs. Stored in the existing JSON (the verdict's
// requires[] and the ask turn's component.state.answer[]); no migration.
//
// PURE and CLIENT-SAFE: the ask card reads `leadOfInput`, the server reads `inputOf`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type RequirementInput = 'attach' | 'answer';

/** The stated kind, or null when none was stated (an older verdict / a caller that never said). */
export function inputOf(raw: unknown): RequirementInput | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'attach' || v === 'answer' ? v : null;
}

/** The labels an ask turn's component state marks as ANSWERS (`state.answer`), or []. */
export function askAnswersOf(state: unknown): string[] {
  const a = ((state ?? {}) as { answer?: unknown }).answer;
  return Array.isArray(a) ? a.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
}

/**
 * THE RESOLVER'S SPLIT, ONCE (pure): the judge STATES a kind; the attachability check VERIFIES it.
 *   · verified attachable                   → attach (searched, staged, or asked to attach)
 *   · verified a FACT (an answer)           → answer (typed — whatever the judge stated: "RIB" is a
 *                                              fact the user types as readily as a letter they attach)
 *   · verified neither (a SIGN-OFF: a confirmation, approval, availability, a status) → dropped — the
 *                                              reply's own words carry it once the user approves (the
 *                                              Aug 4 confirmation-as-attachment floor)
 *   · no verdict (the check failed)          → the judge's stated kind stands (attach when unstated)
 * A secret never reaches this function (the secret floor runs first).
 */
export function settleInputKind(stated: RequirementInput | null, verified: 'attachable' | 'answer' | 'neither' | null): RequirementInput | null {
  if (verified === 'attachable') return 'attach';
  if (verified === 'answer') return 'answer';
  if (verified === 'neither') return null;
  return stated ?? 'attach';
}
