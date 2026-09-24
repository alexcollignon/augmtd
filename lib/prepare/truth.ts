// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRUTH OF PREPARED CONTENT (stabilization W5a · invariants 8 A CLAIM RENDERS · 14 TIME TRUTH).
//
// Two classes found on the owner's real account (Sep 23):
//
//   • THE PROPOSAL OUTSIDE THE STATED WINDOW — "Schedule meeting with Sam — September 30 or
//     October 1" carried a prepared invite proposing Sep 23, labelled "our proposal — inside what
//     they stated". The counterparty stated a window; the calendar fallback ignored it, and the
//     card's label claimed a verification that never happened.
//   • THE FABRICATED DEED — a paste pack for an OPEN obligation read "I've finished the
//     redistribution… here's the updated breakdown… everything is balanced now" while nothing was
//     done. Words that claim work finished, sent, attached or delivered are a DEED CLAIM, and a deed
//     claim with no deed behind it is a lie in the user's own voice.
//
// This module is the ZERO-IO home of both floors — pure functions the ONE reader (lib/prepare/read),
// the evaluator (lib/prepare/evaluate), the producers, the repair sweeps and the unit tests all
// call. One implementation, so a reader and a sweep can never disagree about what is false.
//
// THE FLOOR DOCTRINE (evaluate.ts's own words): a machine floor must FAIL SAFE — a missed catch
// costs one honest flag downstream; a false catch destroys finished work and makes the system lie
// about its own work. So: the window check speaks only when the item's own text STATES a window
// (code-verified by `statedWindow`), and the completion-claim net is deliberately NARROW (first-
// person done-verbs and "here's the updated…" shapes; negations excluded) and fires only when the
// obligation is OPEN and nothing is staged.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { statedWindow, type StatedWindow } from '@/lib/commitments/extraction-truth';

/** The provenance of a proposed slot — WHO vouches for it. The card's annotation renders from
 *  this, never from `proposed` alone: `stated_window` = code-verified inside the window the item's
 *  own words state; `calendar` = the user's own free/busy, in code, with no stated window to
 *  honor. Absent on legacy invites → the card says "our proposal" and claims nothing more. */
export type ProposedFrom = 'stated_window' | 'calendar';

/** The one label table for a proposed slot's annotation — the presentation reads it, never
 *  authors its own. */
export const PROPOSAL_ANNOTATION: Record<ProposedFrom | 'unknown', string> = {
  stated_window: 'our proposal — inside what they stated',
  calendar: 'our proposal — free on your calendar',
  unknown: 'our proposal',
};

export function proposalAnnotation(from: ProposedFrom | null | undefined): string {
  return PROPOSAL_ANNOTATION[from ?? 'unknown'];
}

// ── THE WINDOW ─────────────────────────────────────────────────────────────────────────────────

/** An ISO instant's calendar day in a zone (YYYY-MM-DD); null when unparseable. */
export function localDateOf(iso: string | null | undefined, tz: string | null | undefined): string | null {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** Does a slot's local day sit inside the window (inclusive, calendar days)? */
export function slotInsideWindow(startISO: string, win: Pick<StatedWindow, 'start' | 'end'>, tz: string | null | undefined): boolean {
  const day = localDateOf(startISO, tz);
  return !!day && day >= win.start && day <= win.end;
}

/** THE STATED WINDOW of an item's own words — the ONE parser (extraction-truth), anchored on the
 *  item's own date. null = the item states no window (then no window claim can be made either way). */
export function windowOfItemText(text: string | null | undefined, anchorIso?: string | null): StatedWindow | null {
  try { return statedWindow(text, anchorIso ?? null); } catch { return null; }
}

/**
 * THE WINDOW FLOOR: true when the invite proposes a time OUTSIDE the window the item itself
 * states. Conservative: no start, no stated window, or an unparseable slot → false (no claim).
 * Applies to every proposed slot regardless of who proposed it — a model's in-window guess and the
 * calendar fallback are held to the same code-verified fact.
 */
export function inviteOutsideStatedWindow(
  invite: { startISO?: string | null; timezone?: string | null } | null | undefined,
  itemText: string | null | undefined,
  anchorIso?: string | null,
): boolean {
  if (!invite?.startISO) return false;
  const win = windowOfItemText(itemText, anchorIso);
  if (!win) return false;
  const day = localDateOf(invite.startISO, invite.timezone);
  if (!day) return false;
  return !(day >= win.start && day <= win.end);
}

/** TIME TRUTH's other half for a proposal: a slot must never be behind the clock. */
export function slotInPast(startISO: string | null | undefined, now: number = Date.now()): boolean {
  const t = Date.parse(String(startISO ?? ''));
  return Number.isFinite(t) && t < now;
}

/**
 * W5c · THE WINDOW CONFINEMENT — the ONE implementation both invite builders run (the pass's lane AND
 * the card's on-demand build, which was window-blind: the same item could get an in-window invite
 * from the pass and an out-of-window one from the summoned stage). Mutates the invite in place:
 *   · a proposed start that is PAST, or OUTSIDE the window the item's own words state, is dropped
 *     (with its alternatives filtered by the same two tests) — the card then asks for a time;
 *   · an in-window model proposal is stamped `proposedFrom: 'stated_window'` (the only provenance
 *     the card's "inside what they stated" label may read).
 * The narrow text (the item's own title/description) is read first; the wider grounding only when
 * the narrow text states nothing. Returns the stated window (the calendar fallback confines to it).
 */
export function confineInviteToStatedWindow(
  invite: { startISO: string; endISO: string; proposed?: boolean; proposedFrom?: ProposedFrom; timezone?: string | null; alternatives?: Array<{ startISO: string; endISO: string; note?: string }> },
  texts: { narrow?: string | null; wide?: string | null },
  anchorIso: string | null,
  now: number = Date.now(),
): StatedWindow | null {
  const narrowWin = windowOfItemText(texts.narrow, anchorIso);
  const statedWin = narrowWin ?? windowOfItemText(texts.wide, anchorIso);
  const windowText = narrowWin ? texts.narrow : texts.wide;
  const outside = (startISO: string) => !!statedWin && inviteOutsideStatedWindow({ startISO, timezone: invite.timezone }, windowText, anchorIso);
  if (invite.startISO && (slotInPast(invite.startISO, now) || outside(invite.startISO))) {
    invite.startISO = '';
    invite.endISO = '';
    invite.proposed = false;
    invite.alternatives = (invite.alternatives ?? []).filter((a) => !slotInPast(a.startISO, now) && !outside(a.startISO));
  } else if (invite.startISO && invite.proposed) {
    invite.proposedFrom = statedWin ? 'stated_window' : undefined;
  }
  return statedWin;
}

// ── THE COMPLETION CLAIM ───────────────────────────────────────────────────────────────────────

/**
 * THE VOCABULARY — narrow by design (the fail-safe doctrine). First-person done-verbs, the
 * "here's/please find the updated…" hand-over shape, and "X is now done/sent" — in the four corpus
 * languages. Negations ("I have not finished", "je n'ai pas envoyé") are excluded by construction;
 * futures ("I will send") never match because the verbs are past participles/preterites only.
 */
export const COMPLETION_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  // EN
  /\bI(?:'ve| have)\s+(?!not\b|never\b|yet\b)(?:now\s+|just\s+|already\s+)?(?:finished|completed|sent|attached|delivered|submitted|uploaded|shared|forwarded|processed)\b/i,
  /\b(?:here(?:'s| is| are)|please find|you(?:'ll| will) find)\s+(?:the\s+|my\s+|an?\s+)?(?:updated|finished|completed|final|finalised|finalized|revised|attached)\b/i,
  /\battached\s+(?:is|are|you(?:'ll| will) find|please find)\b/i,
  /\b(?:everything|it|this|that|the (?:\w+\s){0,3}\w+)\s+(?:is|has been|was)\s+(?:now\s+|all\s+)?(?:done|completed|finished|sent|delivered|submitted|uploaded|finalised|finalized)\b(?!\s+(?:yet|once|when|after|as soon)\b)/i,
  // PT · DE · FR — `\b` is ASCII-only in JS, so an accented verb ("terminé", "concluí") never ends
  // on a word boundary; the non-EN nets bound themselves with letter lookarounds under the `u` flag.
  /(?<!\p{L})(?:já\s+)?(?:enviei|conclui|concluí|terminei|anexei|entreguei|finalizei|submeti|partilhei)(?!\p{L})/iu,
  /(?<!\p{L})(?:segue|seguem)\s+(?:em\s+anexo|anexo|abaixo)(?!\p{L})/iu,
  /(?<!\p{L})(?:está|estão|foi|foram|ficou|ficaram)\s+(?:agora\s+)?(?:concluíd[oa]s?|finalizad[oa]s?|enviad[oa]s?|entregues?|feit[oa]s?|terminad[oa]s?)(?!\p{L})/iu,
  /(?<!\p{L})ich habe\s+(?!nicht(?!\p{L})|noch(?!\p{L}))(?:\S+\s+){0,4}?(?:abgeschlossen|erledigt|gesendet|geschickt|angehängt|übermittelt|fertiggestellt|hochgeladen|geliefert)(?!\p{L})/iu,
  /(?<!\p{L})(?:anbei|im anhang)(?!\p{L})/iu,
  /(?<!\p{L})ist\s+(?:nun\s+|jetzt\s+)?(?:erledigt|abgeschlossen|fertig|versendet|geliefert)(?!\p{L})/iu,
  /(?<!\p{L})j'ai\s+(?!pas(?!\p{L}))(?:\S+\s+){0,3}?(?:terminé|finalisé|envoyé|joint|livré|transmis|soumis|téléchargé|partagé)(?!\p{L})/iu,
  /(?<!\p{L})(?:ci-joint|en pièce jointe|vous trouverez ci-joint)(?!\p{L})/iu,
  /(?<!\p{L})(?:c'est|est)\s+(?:maintenant\s+|désormais\s+)?(?:terminé|fait|finalisé|envoyé|livré)(?!\p{L})/iu,
];

/** The first completion claim a text makes (the matched phrase), or null. Pure. */
export function completionClaimIn(text: string | null | undefined): string | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  for (const re of COMPLETION_CLAIM_PATTERNS) {
    const m = re.exec(t);
    if (m) return m[0].trim();
  }
  return null;
}

/** THE FACTS the floor judges against — code's, never the model's. */
export type CompletionFacts = {
  /** The obligation these words are about is STILL OPEN (the user owes it; nothing settled it). */
  obligationOpen: boolean;
  /** Something real is staged with the words (an attachment, a deliverable) — then "attached" and
   *  "here's the updated…" can be true, and the floor stays silent. */
  staged: boolean;
};

/**
 * THE COMPLETION FLOOR: the claim these words make that the facts do not support, or null.
 * Speaks ONLY when the obligation is open AND nothing is staged — every other case is either
 * plausibly true or not ours to judge (fail-safe).
 */
export function claimsUndoneWork(text: string | null | undefined, facts: CompletionFacts): string | null {
  if (!facts.obligationOpen || facts.staged) return null;
  return completionClaimIn(text);
}

/** THE PRODUCER RULE — one copy, imported by every drafter that writes on the user's behalf. */
export const COMPLETION_HONESTY_RULE =
  'NEVER claim that work is finished, completed, sent, attached, delivered, submitted or uploaded ' +
  'unless the facts above say it IS — a message about an obligation that is still open speaks its ' +
  'STATUS and NEXT STEP honestly, or asks what is needed; it never announces a deed that has not ' +
  'happened, and never hands over "the updated X" that does not exist.';

/** The evaluator's objection for a tripped floor — one wording, so the regenerate prompt and the
 *  stored review agree. */
export function completionObjection(claim: string): string {
  return `The message claims work already done ("${claim.slice(0, 80)}") but the obligation is still open and nothing is attached or staged — ` +
    `rewrite it to state where things actually stand and the next step (or ask what is needed); never announce a deed that has not happened.`;
}

// ── THE CHASE DIRECTION (stabilization W11.1 · ONE COHERENT ITEM) ─────────────────────────────────

/**
 * Does a CHASE on this item invert the obligation? A nudge asks the other side for what THEY owe;
 * on work the USER owes (a you_owe commitment, an inbox item whose understanding says you_owe) it
 * chases the counterparty for the user's own debt. Found live (owner walk, Sep 23): "Just a quick
 * nudge on the small edit we discussed …" addressed to the CLIENT on a commitment the user owed.
 * The judge coerces the verb (lib/work/judge.ts directionFloor); the nudge lane REFUSES on this
 * predicate, so a cached or hand-routed chase can never write one either. Pure.
 */
export function chaseInvertsObligation(facts: { direction?: string | null; ownership?: string | null }): boolean {
  return String(facts.direction ?? '') === 'you_owe' || String(facts.ownership ?? '') === 'you_owe';
}

/**
 * THE CHASE WORDS — narrow (the floor doctrine): the nudge/reminder shapes that ask the OTHER side to
 * move ("just a quick nudge", "gentle reminder", "any update on", "have you had a chance",
 * "let me know when you've had a chance"). On an OPEN obligation the USER owes, words of this shape
 * chase the counterparty for the user's own debt — the reader withdraws them (never live). Pure.
 */
export const CHASE_WORD_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:quick|gentle|friendly|small|little|polite)\s+(?:nudge|reminder)\b/i,
  /\bjust\s+(?:a\s+)?(?:quick\s+)?(?:nudge|reminder|nudging|following up|checking in)\b/i,
  /\bany\s+(?:updates?|news|progress)\s+on\b/i,
  /\bhave you\s+(?:had a chance|managed|been able)\b/i,
  /\blet me know (?:when|once|if) you(?:'ve| have)\s+had a chance\b/i,
];

/** The first chase shape a text makes, or null. Pure. */
export function chaseWordsIn(text: string | null | undefined): string | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  for (const re of CHASE_WORD_PATTERNS) {
    const m = re.exec(t);
    if (m) return m[0].trim();
  }
  return null;
}

/** The nudge lane's refusal reason — one wording, spoken into the prep_outcome ledger. */
export const CHASE_INVERSION_REFUSAL = 'the user owes this — a nudge to the counterparty would invert the obligation; nothing written';

// ── THE ATTACHMENT CLAIM (stabilization W11.1) ───────────────────────────────────────────────────

/**
 * THE ATTACHMENT VOCABULARY — words that say something RIDES WITH THIS MESSAGE ("the attached interim
 * report", "please find attached", "I've attached", "attaching", "enclosed is", "in the attachment").
 * Found live: a prepared draft read "…in the second tab of the attached interim report…" with
 * nothing attached. The completion net above catches "attached is" / "I've attached"; this net is
 * the wider class — ANY claim that a file rides along — and it is independent of who owes what: a
 * message may never say "attached" unless an attachment is STAGED with it.
 *
 * Fail-safe (the floor doctrine): the COUNTERPARTY's attachment is excluded by construction —
 * "your attached …", "the attached … you sent/shared", "thanks for the attached …" — a reply may
 * truthfully speak about the document they sent. Four corpus languages, like the completion net.
 */
export const ATTACHMENT_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  // EN — "the/my/our attached X" (not "your attached", not "…you sent"), "attached (is|are|please…)",
  // "please find/see attached", "I('ve| have)? attached", "I am/I'm attaching", "enclosed (is|are)",
  // "in/see the attachment", "attaching (the|a|my|our)".
  /(?<!\b(?:for|thanks|thank you for|received)\s)\b(?:the|my|our|this)\s+attached\s+(?!(?:\w+\s+){0,4}(?:you|they|he|she)\s+(?:sent|shared|attached|forwarded|provided)\b)\w+/i,
  /\b(?:please\s+)?(?:find|see)\s+(?:attached|enclosed)\b/i,
  /\bI(?:'ve| have)?\s+(?:now\s+|just\s+|also\s+)?(?:attached|enclosed)\b(?!\s+(?:yet|once|when|after)\b)/i,
  /\bI(?:'m| am)\s+(?:also\s+)?(?:attaching|enclosing)\b/i,
  /(?:^|[.!?]\s+|\n)\s*(?:attaching|attached|enclosed)\s+(?:is|are|the|a|my|our|you(?:'ll| will) find)\b/i,
  /\b(?:in|see)\s+the\s+attach(?:ment|ed file)\b(?!\s+(?:you|they)\s+sent)/i,
  // PT · DE · FR (letter-bounded under `u`, as above).
  /(?<!\p{L})(?:em\s+anexo|segue\s+(?:em\s+)?anexo|anexei|anexo\s+(?:o|a|os|as)\s)(?!\p{L})/iu,
  /(?<!\p{L})(?:anbei|im\s+anhang\s+(?:finden|sende|schicke)|angehängt\s+(?:ist|sind|finden))(?!\p{L})/iu,
  /(?<!\p{L})(?:ci-joint|en\s+pièce\s+jointe|je\s+joins|vous\s+trouverez\s+ci-joint)(?!\p{L})/iu,
];

/** The first claim that a file rides with this message (the matched phrase), or null. Pure. */
export function attachmentClaimIn(text: string | null | undefined): string | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  for (const re of ATTACHMENT_CLAIM_PATTERNS) {
    const m = re.exec(t);
    if (m) return m[0].trim();
  }
  return null;
}

/**
 * THE ATTACHMENT FLOOR: the attachment claim these words make with NOTHING staged, or null. Speaks
 * regardless of who owes what — an attachment either rides with the message or it does not.
 */
export function claimsUnstagedAttachment(text: string | null | undefined, facts: { staged: boolean }): string | null {
  if (facts.staged) return null;
  return attachmentClaimIn(text);
}

/** The evaluator's objection for a tripped attachment floor — one wording. */
export function attachmentObjection(claim: string): string {
  return `The message says a file is attached ("${claim.slice(0, 80)}") but nothing is attached to it — ` +
    `rewrite it without claiming an attachment (say what will be sent, or ask for what is missing).`;
}

// ── THE MAILBOX SIGNS (stabilization W11.1 · the targeted re-draft, coordinator decision Sep 23) ──
// W11.1 scoped every NEW draft's voice + signature to the mailbox its thread lives in. The drafts
// already STORED under the old global voice keep another identity's sign-off until their ground
// moves — and DRAFT_LAW_VERSION is deliberately NOT bumped (that would re-draft every stored draft at
// the conversation tier). So the reader detects exactly the wrong ones: a MACHINE-written draft whose
// sign-off block names ANOTHER of the user's mailboxes (its address, or its organisation's domain
// label) and does NOT name the thread's own mailbox is withdrawn as untrue — the pass's existing
// re-prepare trip (decideRegeneration honours `nonLive`) re-drafts only those. The user's own edit
// is never judged (the hand wins). Pure, zero AI, FAIL-SAFE: both named, or neither, → no claim.

/** Public mail providers — a shared or matching domain here names no organisation. ONE list
 *  (lib/prepare/addressee.ts reads it too). */
export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.de', 'mail.com']);

/** One of the user's mailboxes as the signature floor sees it. */
export type MailboxIdentity = { address: string; domainLabel: string | null };

/** A mailbox address → its identity forms: the address + the organisation's domain label ("acme"
 *  from sam@mail.acme.co.uk); a public provider carries no label. null for a non-address. Pure. */
export function mailboxIdentityOf(address: string | null | undefined): MailboxIdentity | null {
  const a = String(address ?? '').trim().toLowerCase();
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(a);
  if (!m) return null;
  const domain = m[1];
  if (PUBLIC_MAIL_DOMAINS.has(domain)) return { address: a, domainLabel: null };
  const labels = domain.split('.');
  const n = labels.length;
  const label = n >= 3 && labels[n - 2].length <= 3 && labels[n - 1].length === 2 ? labels[n - 3] : labels[n - 2];
  return { address: a, domainLabel: label && label.length >= 3 ? label : null };
}

const SIGN_OFF_CUE = /^(?:best(?: regards| wishes)?|kind regards|warm regards|regards|many thanks|thanks(?: again)?|thank you|cheers|sincerely|all the best|obrigad[oa]|cumprimentos|melhores cumprimentos|atenciosamente|abraço|mit freundlichen grüßen|viele grüße|beste grüße|lg|cordialement|bien à vous|bien cordialement)\b[,.!]?\s*$/iu;

/** The sign-off block: from the last sign-off cue line to the end, else the last 4 non-empty lines. */
export function signOffBlockOf(text: string | null | undefined): string {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    if (SIGN_OFF_CUE.test(lines[i])) return lines.slice(i).join('\n');
  }
  return lines.slice(-4).join('\n');
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namesIdentity = (block: string, id: MailboxIdentity): boolean =>
  block.toLowerCase().includes(id.address)
  || (!!id.domainLabel && new RegExp(`(?<![\\p{L}\\p{N}])${escRe(id.domainLabel)}(?![\\p{L}\\p{N}])`, 'iu').test(block));

/**
 * THE SIGNATURE FLOOR: the other identity these words sign as (its address or domain label), or
 * null. Speaks only when the sign-off names ANOTHER mailbox and NOT the thread's own — anything
 * ambiguous (both, neither, a label shared by both mailboxes) is left alone.
 */
export function signsAsOtherIdentity(
  text: string | null | undefined,
  mailboxes: { own: MailboxIdentity; others: MailboxIdentity[] },
): string | null {
  const block = signOffBlockOf(text);
  if (!block) return null;
  if (namesIdentity(block, mailboxes.own)) return null;
  for (const o of mailboxes.others) {
    if (o.address === mailboxes.own.address) continue;
    const shared = !!o.domainLabel && o.domainLabel === mailboxes.own.domainLabel;
    const other: MailboxIdentity = { address: o.address, domainLabel: shared ? null : o.domainLabel };
    if (namesIdentity(block, other)) return block.toLowerCase().includes(o.address) ? o.address : other.domainLabel;
  }
  return null;
}

// ── EVERY DRAFT PASSES THE SAME TRUTH (stabilization W12.1 · owner live walk Sep 23, after W11) ──
// W11.1 put the chase-inversion floor, the attachment floor and the completion floor on the pass's
// artifacts (THE ONE READER's stampTruth + the evaluator). The COMPOSE door (/api/compose/draft) was
// a second door: with nothing pooled for a you_owe commitment it generated a FRESH conversation-tier
// draft on every open — "Just a quick nudge on the small edit … in the second tab of the attached
// interim report … let me know when you've had a chance" — addressed to the client, served with NO
// floor at all. The floors are ONE function now: `vetDraft`, called by the reader (stampTruth), the
// evaluator (evaluateDeliverable) and the compose door alike. Pure, zero IO, the floor doctrine
// (fail-safe: each floor speaks only with its facts in hand).

/** The facts every draft is vetted against — code's, never the model's. */
export type DraftVetFacts = {
  /** The user OWES what these words are about and it is still open (a you_owe commitment · an inbox
   *  item whose understanding says you_owe). A completion claim or a chase is false only here. */
  obligationOpen: boolean;
  /** Something real rides with the words (an attachment, a staged deliverable). */
  staged: boolean;
  /** The attachment floor speaks (default true). Off for a PASTE PACK (its destination may carry
   *  the file) and for an evaluator caller that stated no `staged` fact. */
  attachmentFloor?: boolean;
};

/** Which floor a draft failed, the words that tripped it, and the ONE objection a regeneration is
 *  handed (the same wording the evaluator stores). */
export type DraftVetFailure = { floor: 'completion' | 'attachment' | 'chase'; claim: string; objection: string };

/** The objection for a tripped chase floor — one wording. */
export function chaseObjection(claim: string): string {
  return `The message chases the recipient ("${claim.slice(0, 80)}") but the USER owes this — ` +
    `rewrite it to DELIVER what was committed (or state honestly where it stands and when it will arrive); ` +
    `never ask them for an update, never nudge or remind them about the user's own obligation.`;
}

/**
 * THE ONE VET — the first floor these words fail, or null (they pass). Order: the completion claim
 * (a deed that did not happen), the attachment claim (a file that does not ride along), the inverted
 * chase (chasing the counterparty for the user's own debt). Pure.
 */
export function vetDraft(text: string | null | undefined, facts: DraftVetFacts): DraftVetFailure | null {
  const done = claimsUndoneWork(text, { obligationOpen: facts.obligationOpen, staged: facts.staged });
  if (done) return { floor: 'completion', claim: done, objection: completionObjection(done) };
  if (facts.attachmentFloor !== false) {
    const att = claimsUnstagedAttachment(text, { staged: facts.staged });
    if (att) return { floor: 'attachment', claim: att, objection: attachmentObjection(att) };
  }
  if (facts.obligationOpen && !facts.staged) {
    const chase = chaseWordsIn(text);
    if (chase) return { floor: 'chase', claim: chase, objection: chaseObjection(chase) };
  }
  return null;
}

/**
 * THE COMPOSE TASK FOR A COMMITMENT — the direction decides the frame. On work the USER owes
 * (`you_owe`) the message DELIVERS (or honestly schedules) what the user committed to — it is never a
 * request to the counterparty; on work THEY owe (`awaiting`) a polite chase is the valid message. The
 * honesty rule and the no-attachment fact ride both. Pure — the compose door's prompt reads it.
 */
export function commitmentComposeTask(c: { direction?: string | null; description?: string | null }, recipientName: string | null): string {
  const what = String(c.description ?? '').trim();
  const who = recipientName || 'the recipient';
  const noFile = 'NOTHING is attached to this message — never say anything is attached, enclosed or "please find".';
  if (String(c.direction ?? '') === 'you_owe') {
    return `THE USER OWES THIS: "${what}". Write a short email FROM the user TO ${who} that DELIVERS it — ` +
      `state the change or the answer itself when the context gives it; otherwise state honestly where it ` +
      `stands and WHEN it will arrive. This is the user's own obligation: NEVER ask ${who} for an update, ` +
      `never nudge, remind or "follow up" with them, never write "let me know when you've had a chance". ` +
      `${noFile} ${COMPLETION_HONESTY_RULE}`;
  }
  return `${who} OWES the user this: "${what}". Write a short, polite follow-up asking ${who} for it ` +
    `(where it stands, and when the user can expect it). Address ${who} directly. ${noFile}`;
}

/**
 * THE VETTED GENERATION — generate, vet, and on a failure regenerate ONCE with the failure named;
 * a second failure is NOT served (`body: ''`, the card shows the honest empty state — write it
 * yourself, or the ask). The generator is the caller's (the compose door's model call); this owns
 * only the loop, so the gate can hold it with a fake generator. An empty generation is not a
 * failure of truth — it is returned empty, with no retry.
 */
export async function draftThroughVet(
  generate: (objection: string | null) => Promise<string>,
  facts: DraftVetFacts,
): Promise<{ body: string; failed: DraftVetFailure | null; attempts: number }> {
  const first = String(await generate(null) ?? '').trim();
  if (!first) return { body: '', failed: null, attempts: 1 };
  const f1 = vetDraft(first, facts);
  if (!f1) return { body: first, failed: null, attempts: 1 };
  const second = String(await generate(f1.objection).catch(() => '') ?? '').trim();
  const f2 = second ? vetDraft(second, facts) : f1;
  if (second && !f2) return { body: second, failed: null, attempts: 2 };
  return { body: '', failed: f2 ?? f1, attempts: 2 };
}

/** The honest words the compose door returns when a draft failed the vet twice — the card's empty
 *  state reads it (never a draft that says what is not true). */
export function withheldLine(failed: DraftVetFailure): string {
  return failed.floor === 'chase'
    ? 'I held back a draft that chased them for something you owe — write it yourself, or tell me what to say.'
    : failed.floor === 'attachment'
      ? 'I held back a draft that said a file was attached when none is — write it yourself, or attach the file first.'
      : 'I held back a draft that claimed work that is not done yet — write it yourself, or tell me where it stands.';
}

/**
 * THE COMPOSE DOOR'S POOL ROW — a generated commitment draft is written ONCE as the commitment's
 * prepared artifact (the same `item_deliverables` shape + `prepared_from` ground stamp + addressee
 * stamp the pass writes), so the next open serves it through THE ONE READER at zero AI — and from then
 * on it obeys the-users-hand-wins and regenerates only on a ground move, like every pass artifact.
 * A chase (they owe) is titled "Nudge — …" (the reader's nudge_draft); a delivery (the user owes) is
 * "Message — …" (reply_draft). Pure.
 */
export function composeDraftRow(args: {
  userId: string; commitmentId: string; direction: string | null | undefined; body: string;
  recipientLabel: string | null; preparedFrom: { emailId: string | null; receivedAt: string | null } | null;
  addresseeStamp: Record<string, unknown>;
}): { user_id: string; kind: 'commitment'; entity_id: string; type: 'draft'; title: string; content: string; ref: null; metadata: Record<string, unknown> } {
  const name = args.recipientLabel ? args.recipientLabel.split('<')[0].trim() : '';
  const lead = String(args.direction ?? '') === 'you_owe' ? 'Message' : 'Nudge';
  return {
    user_id: args.userId, kind: 'commitment', entity_id: args.commitmentId, type: 'draft',
    title: `${lead} — ${name || 'recipient to confirm'}`.slice(0, 100), content: args.body, ref: null,
    metadata: { source: 'compose', prepared: 'compose', prepared_from: args.preparedFrom, ...args.addresseeStamp },
  };
}
