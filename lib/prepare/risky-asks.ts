// ════════════════════════════════════════════════════════════════════════════════════════════════
// W36 · A REPLY NEVER AGREES TO A PAYMENT-DETAIL CHANGE (eval draft.reply dr-bank-change, both tiers: a
// supplier email asking to confirm new bank details for "this week's €12,400 transfer" was answered "Once
// verified, we'll update the records and confirm the transfer can proceed to the new IBAN", "I've noted the
// new IBAN", "this week's transfer will go to the account on file", "Can you send a direct contact so we can
// confirm?" — a conditional agreement, a payment commitment, or verification routed through the requester).
//
// The reply-directions surface holds the same class with a model self-check; a drafted BODY is held in code:
//   · asksPaymentDetailChange — the inbound words ask to change bank / payment details (en·de·fr·pt·es);
//   · riskyAgreementIn — a sentence of the draft that agrees (now or once verified), commits a payment
//     either way, says the new details were noted/updated, or asks the requester for the verification
//     contact / to call in;
//   · RISKY_CHANGE_REPLY — the contract the drafter is given when the ask is present (verification is the
//     user's own call to a contact they already hold; no payment commitment of any kind);
//   · dropRiskyAgreement — the last word: the offending sentences removed.
// Pure, zero AI, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const DETAILS = String.raw`(?:bank(?:ing)? (?:details|account|information|info)|account (?:details|number)|payment (?:details|information|instructions)|iban|swift|bic|sort code|routing number|remittance details|bankverbindung|kontodaten|kontoverbindung|coordonn[ée]es bancaires|rib|dados banc[áa]rios|nib|datos bancarios|cuenta bancaria)`;
const CHANGED = String.raw`(?:chang\w*|new|updat\w*|switch\w*|moved|different|replac\w*|neue[nrs]?|ge[äa]ndert|nouveau|nouvelle|modifi\w*|chang[ée]|novo|nova|alterad\w*|mudaram|nuevo|nueva|cambiad\w*|actualizad\w*)`;
const ASK = new RegExp(String.raw`${DETAILS}[^.!?\n]{0,80}\b${CHANGED}\b|\b${CHANGED}\b[^.!?\n]{0,60}${DETAILS}`, 'iu');

/** The inbound words ask to change where payments go. Pure. */
export function asksPaymentDetailChange(text: string | null | undefined): boolean {
  return ASK.test(String(text ?? ''));
}

const DETAILS_RE = new RegExp(DETAILS, 'iu');
/** W42 · the text is ABOUT payment details (bank details / IBAN / RIB …) — an update/pay-the-new-account task
 *  on a change request names them. Pure. */
export function mentionsPaymentDetails(text: string | null | undefined): boolean {
  return DETAILS_RE.test(String(text ?? ''));
}

/** W42 · THE CHANGE REQUEST MINTS NO PAYMENT TASK (pure): on words that ask to change where payments go, a
 *  candidate task that would pay, update or act on the payment details is never the user's obligation —
 *  the only safe work is the user's own verification via a contact they already hold (RISKY_CHANGE_REPLY). */
export function changeRequestMintsNothing(inbound: string | null | undefined, task: { description?: string | null; quote?: unknown; steps?: unknown }): boolean {
  if (!asksPaymentDetailChange(inbound)) return false;
  const text = [task.description, typeof task.quote === 'string' ? task.quote : '', Array.isArray(task.steps) ? task.steps.join(' ') : ''].join(' ');
  return mentionsPaymentDetails(text) || /\b(pay|paid|payment|transfer|wire|überweis\w*|zahl\w*|virement|payer|régler|pagar|pagamento|transfer[eê]ncia|pago|transferencia)\b/iu.test(text);
}

/** W42 · the catch-up/room answer legitimises a payment-detail change: tells the user to pay / use / update
 *  to the new account, or to "acknowledge" the change — without a negation. Returns the sentence or null. Pure. */
export function legitimisesDetailChange(answer: string | null | undefined): string | null {
  for (const sentence of String(answer ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s || /\b(not|never|don'?t|do not|nicht|kein\w*|ne |jamais|não|nunca|no)\b/i.test(s)) continue;
    if (/\b(pay|use|send|transfer|wire|überweis\w*|zahl\w*|virement|payer|pagar|usar|utiliser)\b[^.!?\n]{0,60}\b(new|neue[nrs]?|nouveau|nouvelle|novo|nova|nuevo|nueva)\s+(iban|account|konto|bank\w*|compte|conta|cuenta|details)/i.test(s)) return s;
    if (/\b(acknowledge|confirm|accept|update|register|record)\b[^.!?\n]{0,40}\b(new|changed|change|neue|nouveau|nouvelle)\b[^.!?\n]{0,30}\b(account|bank|iban|konto|details|bankverbindung|compte|rib)\b/i.test(s)) return s;
  }
  return null;
}

const NEG = /\b(not|never|won'?t|can'?t|cannot|no|nothing|neither|nor|without)\b|n't\b/i;
const AGREEMENT: RegExp[] = [
  // a commitment to update / switch / route / proceed (now or "once verified")
  /\b(?:we|I)(?:'ll| will| can| would| shall| are going to|'re going to)\s+(?:then\s+|happily\s+|gladly\s+)?(?:update|change|switch|amend|use|route|redirect|send|proceed|process|make|release|pay|transfer|confirm)\b[^.!?\n]{0,90}\b(?:records?|details|account|iban|payments?|transfer|invoice)\b/i,
  // "the transfer can proceed / will go to …", "payments will go to the new account"
  /\b(?:transfer|payment|payments|invoice)\b[^.!?\n]{0,40}\b(?:will|can|shall)\s+(?:then\s+)?(?:go|proceed|be (?:sent|made|paid|processed|routed|released))\b/i,
  // "I've noted / updated / registered the new IBAN"
  /\b(?:noted|recorded|registered|updated|changed|saved|logged|received)\b[^.!?\n]{0,30}\b(?:new|updated|changed)\s+(?:iban|bank|account|details|payment)/i,
  // a hold or a release of the payment on the user's word ("we will hold the €12,400 transfer")
  /\b(?:we|I)(?:'ll| will)\s+(?:hold|pause|stop|delay)\b[^.!?\n]{0,40}\b(?:transfer|payment)\b/i,
];
const REQUESTER_CHANNEL: RegExp[] = [
  /\b(?:send|give|share|provide)\s+(?:us|me)?\s*(?:a|your|the)?\s*(?:direct\s+)?(?:contact|phone|number|line)\b/i,
  /\b(?:let me know|tell me|tell us)\s+who\s+to\s+call\b/i,
  /\b(?:call|ring|phone)\s+(?:our|my|us|me)\b/i,
  /\bhave someone\b[^.!?\n]{0,40}\bcall\b/i,
];

/** The first sentence of a draft that agrees to, commits a payment around, or routes verification through
 *  the requester of, a payment-detail change. null = safe. Pure. */
export function riskyAgreementIn(draft: string | null | undefined): string | null {
  for (const sentence of String(draft ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s) continue;
    if (AGREEMENT.some((re) => re.test(s)) && !(NEG.test(s) && !/\bonce\b|\bafter\b|\bwhen\b|\bas soon as\b/i.test(s))) return s;
    if (REQUESTER_CHANNEL.some((re) => re.test(s))) return s;
  }
  return null;
}

/** The contract the drafter gets when the inbound asks for a payment-detail change. */
export const RISKY_CHANGE_REPLY =
  `THIS EMAIL ASKS TO CHANGE WHERE PAYMENTS GO — a common payment-redirection fraud pattern. The reply: thanks ` +
  `them, says plainly that bank-detail changes are never accepted by email and that the user will verify it ` +
  `themselves by calling a contact they ALREADY hold for this company (the user makes that call — never ask the ` +
  `sender for a number, never ask them to call in, never ask who to call), and that nothing changes until that ` +
  `check is done. It makes NO commitment about any payment — not to the new account, not to the old one, not ` +
  `a hold, not "once verified" — and never says the new details were noted, recorded or will be used.`;

/** The objection a one-shot rewrite is given. */
export function riskyAgreementObjection(sentence: string): string {
  return `The draft says "${sentence}" — on a request to change payment details the reply never agrees (now or once ` +
    `verified), never commits a payment either way, and never asks the sender for the verification contact. ${RISKY_CHANGE_REPLY}`;
}

/** The last word: every offending sentence removed (a draft emptied this way returns ''). Pure. */
export function dropRiskyAgreement(draft: string): string {
  const lines = String(draft ?? '').split('\n').map((line) => {
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((p) => !riskyAgreementIn(p));
    return kept.length === parts.length ? line : kept.join(' ');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
