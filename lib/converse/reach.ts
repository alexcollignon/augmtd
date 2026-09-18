// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REACH VALVE (Sep 18) — no lane answers from confinement.
//
// THE DEAD END: a `question` verdict routes to a TOOLLESS single completion (the Home ask, the
// entity ask, the item ask). Wave 1 made those answers HONEST about their edge ("beyond those 14
// days I cannot see the calendar") — honest, but confined: the lane could name what it needed and
// still had no way to go and get it. Only open/instruction turns ever reached the tool-bearing loop.
//
// THE LAW: THE SYSTEM REASONS; code supplies facts. Whether a question needs a LOOKUP is a judgment
// about the answer, not about the words — so the MODEL decides, through an explicit contract, and
// code does nothing but recognise the token it agreed to emit. No keyword routing, no topic regex,
// no vocabulary list stands between a user's question and its answer. (The house sentinel idiom:
// the 'NOTHING' sentinel in intake-memory, the ===GATE_VERDICT=== sentinel in the workflow gate.)
//
// THE SENTINEL NEVER SERVES: it is a contract token between our prompt and our code. If it ever
// reaches the return — the loop was unavailable, a call errored — `sayInsteadOfSentinel` replaces
// it with an honest one-liner. A person must never read our plumbing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The one token. Emitted by the answering prompts, recognised only here. */
export const REACH_SENTINEL = 'NEEDS_REACH';

/**
 * ONE copy of the contract clause, imported by every question-path prompt so it cannot drift.
 *
 * ⚠️ IT MUST NAME THE FIELD, NOT "YOUR REPLY" (found live by the R3 gate, Sep 18): every door that
 * carries this clause also says `Return ONLY JSON`, so an instruction to make "your entire reply"
 * the token was literally unsatisfiable — the model resolved the contradiction by ignoring the
 * contract and confessing its edge in prose, which is the exact confinement the valve exists to end.
 * The clause now says where the token goes in both shapes, and OUTRANKS the say-so-plainly rules
 * around it — an honest edge is a floor, never a ceiling.
 */
export const REACH_CONTRACT =
  `REACH — THIS RULE OUTRANKS EVERY "say so plainly" / "say you don't have it" RULE ABOVE: if ` +
  `answering this well requires LOOKING SOMETHING UP beyond the context above — the calendar beyond ` +
  `its stated window, the contents of mail, documents or meetings not shown here, the record of what ` +
  `was already sent or done, or the live web — then do NOT answer, do NOT guess, and do NOT say you ` +
  `cannot see it or offer to check: a lookup will happen automatically the moment you ask for it. ` +
  `To ask, reply with the single token ${REACH_SENTINEL} and nothing else — if you are returning ` +
  `JSON, the answer field's ENTIRE value is exactly "${REACH_SENTINEL}" with no other text and an ` +
  `empty refs list. Only ask when a lookup would actually change the answer; if the context above ` +
  `covers the question, just answer.`;

/** Did the mind ask for reach? EXACT match (trimmed), or the token with nothing meaningful after it. */
export function needsReach(say: string | null | undefined): boolean {
  const s = String(say ?? '').trim();
  if (!s) return false;
  if (s === REACH_SENTINEL) return true;
  if (!s.toUpperCase().startsWith(REACH_SENTINEL)) return false;
  // "NEEDS_REACH." / "NEEDS_REACH — " and friends are the same intent; a sentence of real content
  // after the token is NOT (that answer is served, and the guard below strips the stray token).
  return s.slice(REACH_SENTINEL.length).replace(/[^a-z0-9]/gi, '').length === 0;
}

/** THE SENTINEL NEVER SERVES — the last guard before a say reaches a person. */
export function sayInsteadOfSentinel(say: string): string {
  if (needsReach(say)) return 'I need to look that up — ask me again in a moment.';
  const s = say.trim();
  if (s.toUpperCase().startsWith(REACH_SENTINEL)) {
    // Real content followed the token: keep the content, drop the plumbing.
    return s.slice(REACH_SENTINEL.length).replace(/^[\s.:—–-]+/, '').trim() || 'I need to look that up — ask me again in a moment.';
  }
  return say;
}
