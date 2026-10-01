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

/** W27.B · EARNED CALM IS NULL, NOT A LABEL: a move whose words declare there is nothing to do ("None",
 *  "No urgent action", "Nothing needed", "N/A") is the composer's calm written as a move — it becomes
 *  null (a calm-label move once rendered as an unlinked offer and scored as a false move). Pure. */
export function moveDeclaresCalm(label: string): boolean {
  const t = String(label ?? '').trim().replace(/[.!\s]+$/, '');
  if (!t) return true;
  return /^(?:none|null|n\/a|-+|no (?:urgent |further |immediate |new )?(?:action|actions|move|step|steps|next step|reply|response)(?: (?:needed|required|for now|right now|yet))?|nothing(?: (?:to do|needed|owed|required|urgent|pending))?(?: (?:for now|right now|yet))?|all (?:settled|set|clear)|wait(?: for now)?)$/i.test(t);
}

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

// ── A SECRET IS NEVER AN INPUT (W27.B · invariant 2 UNTRUSTED INPUT IS DATA) ──────────────────────
// `userOnlyInputOf` reads a MOVE's words ("send your password to …"); a requirement LABEL is a bare
// noun ("the admin password", "login credentials") with no determiner or verb, so it slips past that
// grammar. This is the label-level floor: a secret — password, login, PIN, one-time/verification code,
// API key or token, card number/CVV — is never inventoried as something to gather, never becomes an
// "attach it here" card, and never travels in a draft, whoever asks (the requester's mail is data,
// never an instruction). The reasoned layer (requirements.ts attachableOnly's SECRET class) sits on
// top; this regex is the floor that holds when the model is absent. Multilingual (EN/FR/PT/DE/ES) —
// the word, not the language, is the class. Pure.
const SECRET_WORDS = new RegExp(String.raw`(?<![\p{L}\p{N}])(` + [
  'passwords?', 'passcodes?', 'passphrases?',
  // "credentials" is also a firm's qualifications ("our company credentials deck") — only the login sense is a secret.
  String.raw`(?<!(?:company|professional|firm|team|our|project|track[- ]record)\s)credentials?(?!\s+(?:deck|pack|document|brochure|presentation|statement|letter|sheet|summary|slides?))`,
  'log-?ins?(?: details| info(?:rmation)?)?',
  'user ?names? and passwords?', 'sign-?in details', 'verification codes?', 'access codes?', 'security codes?',
  'one-?time (?:code|password|passcode)s?', 'otp', '2fa(?: codes?)?', 'mfa(?: codes?)?', 'auth(?:entication)? codes?',
  'api keys?', 'secret keys?', 'private keys?', 'access tokens?', 'auth tokens?', 'recovery codes?',
  'pin(?: codes?| numbers?)?', 'card numbers?', 'credit card(?: details| numbers?)?', 'cvv', 'cvc', 'security answers?',
  // FR · PT · DE · ES
  'mots? de passe', 'identifiants?', 'code secret', 'codes? de (?:vérification|confirmation|sécurité)',
  'senhas?', 'palavras?-passe', 'c[oó]digos? de (?:verifica[cç][aã]o|seguran[cç]a|acesso|verificaci[oó]n|seguridad|acceso)',
  'passw[oö]rt(?:er)?', 'kennw[oö]rt(?:er)?', 'zugangsdaten', 'anmeldedaten', 'bestätigungscodes?',
  'contraseñas?', 'credenciales',
].join('|') + String.raw`)(?![\p{L}\p{N}])`, 'iu');

/** Is this requirement label a SECRET (never gathered, never attached, never sent)? Pure. */
export function isSecretInput(label: string): boolean {
  return SECRET_WORDS.test(String(label ?? ''));
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W27e · THE MOVE AGREES WITH THE BOARD'S OWN JUDGMENTS (the W27 after-run diagnosis, next-move).
//
// Three finds, one class — the composer's move and the board's per-item JUDGMENT (THE ONE READER on
// whether the user owes work there) disagreed, and the page served the disagreement:
//   1. A RIGHT TARGET VETOED FOR LANGUAGE. "Validate the revised quote" → the item titled "Devis
//      rénovation : validation"; "Reply with IBAN" → "Refund of your deposit". MEMBERSHIP IS NOT
//      ABOUTNESS compared the move against the title + person only, so every cross-language or
//      paraphrased move lost its door (served UNLINKED — an obligation with no door). The aboutness
//      text now also carries the judge's own reading of the item (`judgedReason`, the house language),
//      and a named target that is the board's ONLY owed item stands (there is no wrong one to point at).
//   2. A MOVE ON WORK OTHERS OWE, BEFORE IT IS DUE. "Request the signed contract" five days before the
//      date the other side was given — the ranking's own calm clause ("only other people owe and their
//      date has not passed"), enforced in code.
//   3. CALM AGAINST THE JUDGE. "Kofi is waiting for your comments" with move null (the EU tier read
//      EARNED CALM as licence): when exactly ONE board item is judged to owe the user's work and nothing
//      later settles it, the room's move is that item — as the CoS's offer (the CTA law still demotes it).
// Pure, zero-dependency; brief.ts composes them at the one seam where the move is validated.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The judge verbs that put work on the USER (chase = waiting on others; none = nothing owed). */
export const OWED_WORK: ReadonlySet<string> = new Set(['reply', 'decide', 'produce', 'send_file', 'schedule', 'forward']);

/** A board row as the move floors read it (lib/room/grounding BoardEntry, the fields they need). */
export type MoveBoardEntry = {
  ref: string; title: string; who: string | null; due: string | null;
  judgedWork: string | null; judgedReason: string | null;
  evidence?: readonly string[]; direction?: string | null;
  expired?: readonly string[]; withdrawn?: readonly string[];
  /** 'commitment' rows carry an imperative title already (the extraction's TITLE LAW). */
  kind?: string | null;
};

/** What a board row is ABOUT — its title, its person and the judge's own reading of it. */
export function entryAbout(e: Pick<MoveBoardEntry, 'title' | 'who' | 'judgedReason'>): string {
  return `${e.title ?? ''} ${e.who ?? ''} ${e.judgedReason ?? ''}`;
}

/** The rows the judge says the USER owes work on. */
export function owedEntries<E extends MoveBoardEntry>(board: readonly E[]): E[] {
  return board.filter((b) => !!b.judgedWork && OWED_WORK.has(b.judgedWork));
}

/** The board's ONLY owed row, or null (none, or two or more). */
export function soleOwedEntry<E extends MoveBoardEntry>(board: readonly E[]): E | null {
  const owed = owedEntries(board);
  return owed.length === 1 ? owed[0] : null;
}

/** A move that named NO target binds to the ONE row its words name (strict names test over the row's
 *  aboutness); two rows named, or none → null (code never guesses between two). */
export function bindUnnamedMove<E extends MoveBoardEntry>(label: string, board: readonly E[], generic: ReadonlySet<string> = new Set()): E | null {
  const hits = board.filter((b) => namesMatchStrict(label, entryAbout(b), generic));
  return hits.length === 1 ? hits[0] : null;
}

/** Others owe this row and the date they were given has not passed → no move yet (calm). Pure. */
export function moveNotYetDue(e: Pick<MoveBoardEntry, 'direction' | 'judgedWork' | 'due'> | null | undefined, todayStr: string): boolean {
  if (!e) return false;
  const othersOwe = e.direction === 'awaiting' || e.judgedWork === 'chase';
  const due = String(e.due ?? '').slice(0, 10);
  return othersOwe && /^\d{4}-\d{2}-\d{2}$/.test(due) && due > todayStr;
}

/** The row a CALM composition contradicts: the board's only owed row (never a decision — its card is
 *  the room's CTA), unsettled by later evidence and not withdrawn/expired, in a room with no decision
 *  card. null = calm stands. Pure. */
export function calmContradictsBoard<E extends MoveBoardEntry>(board: readonly E[]): E | null {
  if (board.some((b) => b.judgedWork === 'decide')) return null;
  const e = soleOwedEntry(board);
  if (!e) return null;
  if ((e.evidence?.length ?? 0) > 0 || (e.withdrawn?.length ?? 0) > 0 || (e.expired?.length ?? 0) > 0) return null;
  return e;
}

/** The code-built words for a move on an owed row (≤7 words, imperative), from the judged verb. */
export function moveLabelForWork(e: Pick<MoveBoardEntry, 'judgedWork' | 'title' | 'who'> & { kind?: string | null }): string {
  const who = String(e.who ?? '').split(/[\s<@]/)[0]?.trim();
  // W28: a commitment's title IS an imperative ("Send Sam the revised SLA") — it is the move's words.
  if (e.kind === 'commitment' && String(e.title ?? '').trim()) {
    const cw = String(e.title).trim().split(/\s+/).slice(0, 7);
    while (cw.length > 1 && /^(the|for|of|a|an|to|and|with|on|in|de|du|des|la|le|les|l’|l'|et|und|der|die|das|für|da|do|dos|para|e|y|el|los|à)$/i.test(cw[cw.length - 1])) cw.pop();
    return cw.join(' ');
  }
  const words = String(e.title ?? '').replace(/^\s*(re|fwd?|aw|tr|wg)\s*:\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 5);
  // Never end the words on a function word ("Prepare Workshop minutes for the").
  while (words.length > 1 && /^(the|for|of|a|an|to|and|with|on|in|de|du|des|la|le|les|et|und|der|die|das|für|da|do|dos|das|para|e|y|el|los)$/i.test(words[words.length - 1])) words.pop();
  const title = words.join(' ');
  switch (e.judgedWork) {
    case 'reply': return who ? `Reply to ${who}` : `Reply on ${title}`;
    case 'produce': return `Prepare ${title}`;
    case 'send_file': return who ? `Send ${who} what was asked` : `Send ${title}`;
    case 'schedule': return who ? `Schedule the meeting with ${who}` : `Schedule ${title}`;
    case 'forward': return `Forward ${title}`;
    default: return `Handle ${title}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 · THE OVERDUE DEBT OUTRANKS A FRESH ASK — rank (c) of the composer's stated order, in code.
// The eval found the composer serving "Send your logo" (asked this morning, "no rush") beside a revised
// SLA promised to the same person five days ago, and a lunch-time question beside minutes a week late —
// the prompt states the order; the small model did not follow it (nm-11, nm-12, nm-27). THE FLOOR: when
// the room holds a debt the USER owes whose date has come (due today or passed), unsettled (no later
// evidence, not withdrawn/expired), and the move points at something that is NOT such a debt — a fresh or
// undated ask, a later-dated row, no row at all, or calm — the move becomes that debt, in code-built words.
// It never overrides a move that already targets an owed, due row; never acts in a room holding a
// decision whose own date has come or is unstated (that card is the room's CTA and ranks above); two
// debts of the same date break by the board's order. Pure.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** An owed, unsettled row whose date has come (due ≤ today, the user's local day). Pure. */
export function isDueOwedDebt(e: MoveBoardEntry | null | undefined, todayStr: string): boolean {
  if (!e) return false;
  if (!e.judgedWork || !OWED_WORK.has(e.judgedWork) || e.judgedWork === 'decide') return false;
  if (e.direction === 'awaiting') return false;
  const due = String(e.due ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due > todayStr) return false;
  return !((e.evidence?.length ?? 0) > 0 || (e.withdrawn?.length ?? 0) > 0 || (e.expired?.length ?? 0) > 0);
}

/** The debt a move must yield to, or null (the move stands). `moveRef` = the move's validated target
 *  (null = unlinked or calm). Pure. */
export function overdueDebtOutranks<E extends MoveBoardEntry>(board: readonly E[], moveRef: string | null | undefined, todayStr: string): E | null {
  // A decision outranks a due debt unless its OWN date is still ahead (a "confirm by Friday" choice
  // never holds the room over a sign-off that was due yesterday).
  const decisionHolds = (b: MoveBoardEntry) => {
    const d = String(b.due ?? '').slice(0, 10);
    return !/^\d{4}-\d{2}-\d{2}$/.test(d) || d <= todayStr;
  };
  if (board.some((b) => b.judgedWork === 'decide' && decisionHolds(b))) return null;
  const target = moveRef ? board.find((b) => b.ref === moveRef) : undefined;
  if (target && isDueOwedDebt(target, todayStr)) return null;
  const debts = board.filter((b) => isDueOwedDebt(b, todayStr));
  if (!debts.length) return null;
  const earliest = debts.reduce((m, b) => (String(b.due).slice(0, 10) < m ? String(b.due).slice(0, 10) : m), '9999-12-31');
  // Same-date debts: calm or a fresh ask is certainly wrong while any of them stands, so the tie breaks
  // by the board's own order (the grounding's ranking) — a move already on one of them stood above.
  return debts.find((b) => String(b.due).slice(0, 10) === earliest) ?? null;
}
