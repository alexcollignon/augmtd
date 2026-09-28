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
  /** W19.2b · the room's open required inputs (a live ask's checklist items) — a demoted move that
   *  names one asks for it instead of offering to do it. */
  openInputs?: string[];
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

// ── ASK FOR WHAT ONLY THE USER HAS (W19.2b, owner walk Sep 28) ─────────────────────────────────
// Found live: "I can shape this up — send your RIB to <counterparty> — and show you first." The seat
// cannot send the user's bank details: the next step needs an INPUT ONLY THE USER HOLDS (a document
// of theirs, a credential, bank details, a signature, a decision). The offer then ASKS for it
// ("Attach your RIB and I'll draft the email to <counterparty>") — it never offers to do it. The rule
// rides the composer's prompt (USER_INPUT_RULE) and this floor (zero AI — it also rewrites a cached
// offer at the render). The room's own required inputs (a live ask's checklist items — the input
// station's gap) are the other half of the evidence: a move naming one of them asks for it too.

/** THE PROMPT HALF (one copy). */
export const USER_INPUT_RULE =
  'ASK FOR WHAT ONLY THE USER HAS: when the next step needs something only the user holds — their own ' +
  'document, bank details (RIB/IBAN), a credential, a signature, or a decision — the move and the offers ' +
  'ASK for it ("Attach your RIB and I\'ll draft the email to …"); never offer to send, fetch or decide it yourself.';

export type UserInputKind = 'bank' | 'credential' | 'document' | 'signature' | 'decision';
/** `input` is the full noun phrase as the sentence speaks it ("your RIB", "the signed copy"). */
export type UserInputNeed = { input: string; kind: UserInputKind };

const DET = String.raw`(?:(your|my|their|his|her|its|the|a)\s+)?`;
// Acronyms are matched case-sensitively (a lowercase "pin" is a verb); the rest are case-blind.
const USER_ONLY: Array<{ re: RegExp; kind: Exclude<UserInputKind, 'decision'> }> = [
  { re: new RegExp(String.raw`\b${DET}(RIB|IBAN|BIC|SWIFT code|PIN)\b`), kind: 'bank' },
  { re: new RegExp(String.raw`\b${DET}(bank (?:details|account(?: details| number)?)|account number|sort code|routing number|bank statement)\b`, 'i'), kind: 'bank' },
  { re: new RegExp(String.raw`\b${DET}(password|passcode|credentials?|login details|verification code|access code|API key)\b`, 'i'), kind: 'credential' },
  { re: new RegExp(String.raw`\b${DET}(passport|ID card|identity document|proof of (?:identity|address)|driver'?s licen[cs]e|social security number|tax (?:number|ID)|VAT number|payslip)\b`, 'i'), kind: 'document' },
  { re: new RegExp(String.raw`\b${DET}(signature|signed (?:copy|form|contract|agreement|document|NDA|mandate))\b`, 'i'), kind: 'signature' },
];
const OTHERS = new Set(['their', 'his', 'her', 'its']);
const GIVING = /\b(send|share|provide|attach|submit|give|forward|upload|return|transfer|email)\b/i;
const ASKING = /\b(ask|request|chase|get|obtain|collect|receive|await|wait)\b/i;

/** Does this move/offer need an input only the user holds? Pure. Evidence, in order: a decision verb
 *  leading the move; a user-held thing in the words (their own — "your"/"my", or given by a giving
 *  verb and never one being asked of someone else); one of the room's open required inputs named by
 *  the words (`openInputs` — a live ask's checklist items). */
export function userOnlyInputOf(label: string, openInputs: string[] = []): UserInputNeed | null {
  const phrase = moveAsPhrase(label);
  if (!phrase) return null;
  if (/^(decide|choose|pick|settle on|make the call)\b/i.test(phrase)) return { input: phrase, kind: 'decision' };
  for (const { re, kind } of USER_ONLY) {
    const m = re.exec(phrase);
    if (!m) continue;
    const det = (m[1] ?? '').toLowerCase();
    if (OTHERS.has(det)) continue;                        // someone else's — asking for it is the team's job
    const before = phrase.slice(0, m.index);
    const theirs = det === 'your' || det === 'my';
    if (!theirs && (!GIVING.test(before) || ASKING.test(before))) continue;
    const noun = m[2];
    return { input: kind === 'signature' ? `the ${noun}` : `your ${noun}`, kind };
  }
  const toks = (s: string) => new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 4 && !MOVE_WORDS.has(t)));
  const mine = toks(phrase);
  for (const item of openInputs) {
    const it = String(item ?? '').trim();
    if (!it) continue;
    for (const t of toks(it)) if (mine.has(t)) {
      return { input: /^(your|the|a|an|my)\b/i.test(it) ? it.replace(/^my\b/i, 'your').replace(/^(\p{Lu})/u, (c) => c.toLowerCase()) : `the ${it}`, kind: 'document' };
    }
  }
  return null;
}

/** "… to <Name>" — the counterparty the move's own words address (capitalised words only). Pure. */
function recipientOf(phrase: string): string | null {
  const m = /\bto ((?:\p{Lu}[\p{L}'’.-]*)(?:[ -](?:\p{Lu}[\p{L}'’.-]*))?)/u.exec(phrase);
  return m ? m[1] : null;
}

/** What the seat will do once it has the input — the move's own verb and addressee. Pure. */
function nextDeed(phrase: string): string {
  const to = recipientOf(phrase);
  return /^(send|share|forward|email|return|submit|provide|give|transfer|reply)\b/i.test(phrase)
    ? `draft the email${to ? ` to ${to}` : ''}`
    : 'prepare the rest';
}

/** THE ASK (pure): what the room says when the next step needs the user's own input. */
export function inputAskOffer(label: string, need: UserInputNeed): string {
  const phrase = moveAsPhrase(label);
  const next = nextDeed(phrase);
  switch (need.kind) {
    case 'decision': return `That call is yours — tell me which way you want to go and I'll ${next}.`;
    case 'credential': return `This needs ${need.input}, which only you hold — enter that yourself where it's asked; I'll ${next} around it.`;
    default: return `Attach ${need.input} and I'll ${next} — nothing goes out until you approve it.`;
  }
}

/** The sayable form of the ask. Pure. */
export function inputAskSay(label: string, need: UserInputNeed): string {
  const next = nextDeed(moveAsPhrase(label));
  return need.kind === 'decision'
    ? `Lay out the options for me to decide, then ${next} once I've chosen.`
    : `${next.charAt(0).toUpperCase()}${next.slice(1)} and leave a place for ${need.input.replace(/^your\b/, 'my')} — I'll add it myself before anything is sent.`;
}

/** THE OFFER CHIP FLOOR (pure): a composer chip whose words would have the seat produce what only the
 *  user holds ("Send my RIB to …") claims a deed it cannot do — it does not render (the ask speaks). */
export function offerNeedsUserInput(offer: { label: string; say: string }, openInputs: string[] = []): boolean {
  return !!(userOnlyInputOf(offer.say, openInputs) ?? userOnlyInputOf(offer.label, openInputs));
}

/** THE CoS's OFFER — what the room says instead of a button it has not earned. When the step needs
 *  an input only the user holds, the offer ASKS for it instead. */
export function shapingOffer(label: string, openInputs: string[] = []): string {
  const need = userOnlyInputOf(label, openInputs);
  if (need) return inputAskOffer(label, need);
  const phrase = moveAsPhrase(label);
  return phrase
    ? `I can shape this up — ${phrase} — and show you first. Say the word.`
    : 'I can shape this up and show you first — say the word.';
}

/** The sayable form of the same offer: what the click/word sends to the one conversation core,
 *  complete and self-contained (the offers contract — never a bare label to re-interpret). */
export function shapingSay(label: string, openInputs: string[] = []): string {
  const need = userOnlyInputOf(label, openInputs);
  if (need) return inputAskSay(label, need);
  const phrase = moveAsPhrase(label);
  return phrase
    ? `Prepare what's needed to ${phrase} and show me the draft before anything is sent.`
    : 'Prepare the next step on this and show me the draft before anything is sent.';
}

// ── THE SOLE-ARTIFACT BINDING (stabilization W3.5 (c)) ──────────────────────────────────────────
// Found live (Sep 22 census: 20 of 23 v14 moves were offers; 9/9 null-ref moves demoted): a move with
// no ref beside a READY draft was demoted to a false "I can shape this up — … Say the word." When the
// room holds EXACTLY ONE staged entry the move may bind to it deterministically. Two staged entries
// and the move stays unbound (code never guesses between two). Pure; both the composer and the gate
// read it.
//
// ⚠️ W19.C · A VETO IS NOT AN ABSENCE (owner walk, Sep 28 — a pilot account's project room). The composer's
// relevance check (MEMBERSHIP IS NOT ABOUTNESS) nulls the ref of a move that named the WRONG object —
// and this binder, reading only `ref === null`, could not tell "rejected" from "never targeted": a
// move about the user's own RIB was re-attached to the room's only staged entry, a nudge chasing a
// counterparty for something else entirely. "With one staged object there is no wrong one" was false.
// THE RULE NOW: bind only when (1) the move was NEVER vetoed (the model named no target at all), AND
// (2) the move's words positively NAME the entry (a distinctive token of its title / counterparty —
// an all-generic label like "Review follow-up draft" is no evidence, so it stays unbound).
export type StagedEntry = { ref: string; prepared: boolean;
  /** The entry's own identity words — title + counterparty — the names test reads. */
  about?: string };

export type BindOpts = {
  /** The composer's relevance check rejected the move's own target — never re-bind it. */
  vetoed?: boolean;
  /** Words too generic to identify anything (the house GENERIC_WORK_WORDS). */
  generic?: ReadonlySet<string>;
};

/** The words EVERY move is made of — a CTA's verbs and its deliverable nouns. They say what to do,
 *  never WHICH object: "Send the reply" shares "send" with any send task on the board. */
export const MOVE_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'our', 'this', 'that', 'from', 'about', 'back', 'out',
  'send', 'reply', 'respond', 'answer', 'draft', 'drafted', 'review', 'follow', 'followup', 'chase',
  'nudge', 'email', 'mail', 'message', 'note', 'check', 'confirm', 'prepare', 'ready', 'share',
  'update', 'call', 'book', 'schedule', 'meeting', 'invite', 'forward', 'attach', 'file', 'open',
  'read', 'approve', 'decide', 'sign', 'ask', 'remind', 'reminder', 'receipt',
]);

/** THE NAMES TEST (pure, strict): does the label carry a DISTINCTIVE token (not a move word, not a
 *  generic work word) found in `about`? An all-generic label proves nothing and returns false (never
 *  "trust" — a binder must see evidence). */
export function namesMatchStrict(label: string, about: string, generic: ReadonlySet<string> = new Set()): boolean {
  const hay = String(about ?? '').toLowerCase();
  if (!hay.trim()) return false;
  const tokens = String(label ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !generic.has(t) && !MOVE_WORDS.has(t));
  return tokens.some((t) => hay.includes(t));
}

export function bindToSoleStaged<M extends MoveLike>(move: M, entries: StagedEntry[], opts: BindOpts = {}): M {
  if (!move?.label || move.ref) return move;
  if (opts.vetoed) return move;
  const staged = entries.filter((e) => e.prepared);
  if (staged.length !== 1) return move;
  return namesMatchStrict(move.label, staged[0].about ?? '', opts.generic) ? { ...move, ref: staged[0].ref } : move;
}

/** AT THE RENDER: an offer never stands beside a mounted prepared card — the card IS the deed's
 *  surface (A CLAIM RENDERS; the MOVE yields to any mounted card). Null = say nothing. */
export function offerLineFor(move: (MoveLike & { offer?: boolean; offerText?: string }) | null | undefined, f: { cardMounted: boolean }): string | null {
  if (!move?.offer) return null;
  if (f.cardMounted) return null;
  // W19.2b · the floor re-reads the move's own words, so an offer cached before the law ("I can shape
  // this up — send your RIB to …") asks for the input instead.
  const need = userOnlyInputOf(move.label);
  if (need) return inputAskOffer(move.label, need);
  return move.offerText ?? shapingOffer(move.label);
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
  return { move: { ...move, offer: true }, offerText: shapingOffer(move.label, f.openInputs ?? []), demoted: true };
}
