// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DIRECTION FLOOR (W7.4 — EXTRACTION DIRECTION, docs/stabilization-plan.md).
//
// THE INCIDENT (production, Sep 23): on one thread the user's OWN deeds — "Contact <counterparty> to
// schedule demo", "Send <counterparty> educational material" — were stored `awaiting`, as if the
// counterparty owed them. Root cause: the from-user backstop in lib/commitments/extract.ts tested
// the DESCRIPTION for a first-person promise ("I'll…"). But THE TITLE LAW makes every description an
// imperative ("Contact X…") — so the test failed on EVERY user-sent commitment and flipped all of
// them to `awaiting`. A keyword test on text the prompt forces into one shape is a coin that always
// lands the same way.
//
// THE LAW: direction is WHO DOES IT. `you_owe` ⇔ the USER performs the act; `awaiting` ⇔ the
// counterparty does. Decided structurally, in this order:
//   1. THE DOER — the extraction now names the actor (`doer`). It is trusted and CODE-VERIFIED
//      against the user's identity (`denotesUser` — the self-party law's own predicate): the user's
//      name/address → `you_owe`; the counterparty (or anyone else) → `awaiting`; the literal "user"
//      / "counterparty" roles are honoured as said.
//   2. THE OBJECT POSITION — with no usable doer: an imperative whose direct object (the word right
//      after its leading verb) IS the counterparty ("Contact Sam…", "Send Sam the deck") is an act
//      done TO the counterparty, so the counterparty is not its doer → `you_owe`. Word-bounded, the
//      counterparty's own distinctive name tokens — a position fact, not a verb list.
//   3. Otherwise the model's direction stands.
//
// PURE, zero AI, zero IO. One implementation — the writer, the email path and the repair census
// all call it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { denotesUser, type UserForms } from '@/lib/commitments/extraction-truth';
import { sameAttendee } from '@/lib/projects/identity';

export type Direction = 'you_owe' | 'awaiting';

const USER_ROLE = /^(user|the user|me|myself|i|self)$/i;
const OTHER_ROLE = /^(counterparty|the counterparty|other|other party|them|they|sender|recipient)$/i;

const wordsOf = (s: string): string[] =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);

/** The name tokens that identify a counterparty string ("Sam Rivera <sam.rivera@acme.test>" →
 *  sam, rivera). Short/generic fragments are dropped — two letters prove nothing. */
function partyTokens(who: string | null | undefined): string[] {
  const s = String(who ?? '');
  const display = s.replace(/<[^>]*>/g, ' ').trim();
  const addr = /<([^>]+)>/.exec(s)?.[1] ?? (display.includes('@') ? display : '');
  const fromName = display && !display.includes('@') ? wordsOf(display) : [];
  const fromAddr = addr ? wordsOf(addr.split('@')[0].replace(/[._\-+\d]+/g, ' ')) : [];
  return [...new Set([...fromName, ...fromAddr])].filter((t) => t.length >= 3);
}

/**
 * Is the counterparty the DIRECT OBJECT of the description's leading verb? ("Contact Sam to…",
 * "Send Sam Rivera the deck", "Email sam about…"). Only the slot immediately after the first word
 * counts — "Receive the contract from Sam" names Sam as the source, not the object. Pure.
 */
export function counterpartyIsObject(description: string, counterparty: string | null | undefined): boolean {
  const toks = partyTokens(counterparty);
  if (!toks.length) return false;
  const w = wordsOf(description);
  if (w.length < 2) return false;
  return toks.includes(w[1]);
}

export type DirectionInput = {
  direction: string | null | undefined;
  description: string;
  counterparty?: string | null;
  /** The actor the extraction named. Absent on legacy rows and older model output. */
  doer?: string | null;
};

/**
 * THE FLOOR. Returns the direction the facts demand, and why (for the census + the logs). Pure.
 */
export function directionFloor(
  c: DirectionInput, user: UserForms, other?: string | null,
): { direction: Direction; basis: 'doer-user' | 'doer-other' | 'object' | 'model' } {
  const model: Direction = c.direction === 'awaiting' ? 'awaiting' : 'you_owe';
  const doer = String(c.doer ?? '').trim();
  if (doer) {
    if (USER_ROLE.test(doer) || denotesUser(doer, user, other ?? null)) return { direction: 'you_owe', basis: 'doer-user' };
    const cp = c.counterparty ?? other ?? null;
    // A doer naming the counterparty is theirs to do — unless the counterparty is also the verb's
    // object, a contradiction the position fact wins (you do not "Send Sam X" when Sam is the sender).
    const contradicted = !!cp && counterpartyIsObject(c.description, cp)
      && (OTHER_ROLE.test(doer) || sameAttendee(doer, cp));
    if (!contradicted) return { direction: 'awaiting', basis: 'doer-other' };
  }
  if (counterpartyIsObject(c.description, c.counterparty ?? other ?? null)) return { direction: 'you_owe', basis: 'object' };
  return { direction: model, basis: 'model' };
}
