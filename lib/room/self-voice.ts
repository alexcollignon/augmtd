// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE VOICE COLLAPSE + CLAIM ONLY WHAT RENDERS — the speech half of Q1 (attention-plan PART III).
//
// Two findings from the owner's Sep 17 walk, both about the room's opening paragraph:
//
//   1. THE VOICE. The room opened with "Clara is asking you to approve the shortlist" — spoken by
//      Clara, wearing Clara's face. An assistant narrating itself in the third person is the
//      machine failing to recognize its own voice; it is also how ONE ask reads as two actors.
//      THE LAW: when the narrated actor IS the speaker, speech is first person.
//
//   2. THE CLAIM. An opener said "Clara drafted a reply below" with nothing below it. A narration
//      may claim only what renders beside it.
//
// Both are enforced HERE, in code, at the one seam where the composed sentence and the render facts
// exist together — the prompts carry the rules too, but a prompt is a hope (the house doctrine: the
// promise moves into code, and the code is what a gate can assert).
//
// Deterministic, zero AI, pure — so a gate can hold a fixture against it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The rules, stated once, for the prompts that compose room speech. ONE copy (the excerpt-law
 *  lesson: a law with N hand-copies decays into a site list). */
export const SELF_VOICE_RULE =
  `SPEAK AS YOURSELF: you ARE the speaker of this brief and it renders under your own face. When ` +
  `the actor is YOU, write first person — "I'm asking you to approve the shortlist", "I've held it ` +
  `since the 19th", "my draft" — NEVER your own name in the third person ("Clara is asking you", ` +
  `"Clara drafted"), which reads as a second person standing in the room. Other coworkers are still ` +
  `named normally; only your own name collapses.`;

export const RENDERED_CLAIM_RULE =
  `CLAIM ONLY WHAT RENDERS: you may say a thing is "below" / "laid out" / "ready to review" ONLY ` +
  `when the COMPONENTS list actually carries it. With nothing prepared, offer instead ("I can draft ` +
  `a reply — say the word"); never point at something that is not on the page. Never say you ` +
  `drafted, prepared, wrote or put together a THING (notes, a document, a reply, an invite) unless ` +
  `the COMPONENTS list carries a card of THAT kind — an email draft is not "notes".`;

// ── THE NAME TEST ────────────────────────────────────────────────────────────────────────────────
// Only a STANDALONE given name is the speaker. A real counterparty can carry the same given name as
// a coworker (the reference account has one), so a token sitting inside a longer proper name —
// "<Given> Clara", "Clara <Surname>" — is a DIFFERENT person and is left alone. Naming a coworker
// once costs a sentence; rewriting a counterparty's name into "I" is a lie about who spoke.
const CAP_WORD = /[\p{Lu}][\p{L}'-]*$/u;
const CAP_START = /^[\p{Lu}]/u;

// Sentinels, so the grammar repair touches ONLY what collapsed. Fixing every "I <word>" in the
// paragraph would maul the speaker's own untouched first-person sentences ("I always" → "I alway").
const SUBJ = '\u0001';
const POSS = '\u0002';

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Adverbs that sit between a subject and its verb — the verb behind them is the one to conjugate. */
const ADVERBS = ['still', 'already', 'also', 'now', 'just', 'never', 'only', 'again', 'simply', 'then', 'always'];

/** 3rd-person singular → 1st person, for the verb that follows the collapsed name. */
const VERB_1P: Record<string, string> = {
  is: 'am', has: 'have', was: 'was', does: 'do',
  "isn't": 'am not', "hasn't": "haven't", "doesn't": "don't",
  will: 'will', can: 'can', could: 'could', would: 'would', should: 'should', may: 'may',
};

/** A regular 3rd-person-singular verb ("needs", "asks", "holds") → its bare form. Past forms
 *  ("drafted", "held", "sent") are already 1st-person-correct and pass through untouched. */
export function bareVerb(word: string): string {
  const w = word.replace(/’/g, "'");
  if (VERB_1P[w] !== undefined) return VERB_1P[w];
  if (!/^[\p{Ll}]+s$/u.test(w)) return word;
  if (/(ss|us|is)$/.test(w)) return word;          // "press", "focus", "this" — not a 3rd-person -s
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (/[^aeiou]ies$/.test(w)) return `${w.slice(0, -3)}y`;
  return w.slice(0, -1);
}

/** Does this occurrence of `name` stand alone (not part of a longer proper name)? */
function standalone(text: string, start: number, end: number): boolean {
  const lead = text.slice(0, start);
  // A capitalized word immediately before ⇒ "<Given> <Name>" — a different person, and the floor
  // is DELIBERATELY conservative here: a sentence-opening capital is ambiguous ("Review Clara's
  // draft" is a verb, "Ana Clara replied" is a given name, and nothing in the string tells
  // them apart), so we decline both. Leaving one third-person mention standing costs a sentence;
  // rewriting a counterparty's name into "I" is a lie about who spoke. The prompt-side rule
  // (SELF_VOICE_RULE) is what gets those sentences right at composition; this is the floor.
  if (/\s$/.test(lead) && CAP_WORD.test(lead.trimEnd())) return false;
  const after = text.slice(end);
  const nextWord = after.trimStart().split(/[\s,.;:!?]/)[0] ?? '';
  // A capitalized word immediately after ⇒ "<Name> <Surname>" — a different person (the word after
  // a subject in a real sentence is a verb, which is lowercase).
  if (/^\s/.test(after) && nextWord && CAP_START.test(nextWord)) return false;
  return true;
}

/**
 * THE VOICE COLLAPSE. Rewrite third-person references to the SPEAKER into first person.
 * Pure; returns the text unchanged when the speaker is unnamed or never named in it.
 */
export function collapseSelfVoice(text: string, speaker: string | null | undefined): string {
  const full = String(speaker ?? '').trim();
  if (!full || !text) return text;
  const first = full.split(/\s+/)[0];
  if (first.length < 2) return text;
  const names = [...new Set([full, first])].sort((a, b) => b.length - a.length);

  let out = text;
  for (const name of names) {
    const re = new RegExp(`\\b${escapeRe(name)}\\b(['’]s)?`, 'g');
    out = out.replace(re, (m: string, poss: string | undefined, offset: number) => {
      if (!standalone(out, offset, offset + m.length)) return m;
      return poss ? POSS : SUBJ;
    });
  }
  if (!out.includes(SUBJ) && !out.includes(POSS)) return text;

  // Object position: "to me", never "to I" — the preposition decides the case.
  out = out.replace(new RegExp(`\\b(to|with|from|for|of|about|by)\\s+${SUBJ}`, 'gi'), '$1 me');
  // Subject position: the verb that followed the name now has to agree with "I" — across an
  // intervening adverb ("Clara still needs" → "I still need"), which is where the naive fix reads
  // the adverb as the verb.
  out = out.replace(new RegExp(`${SUBJ}(\\s+)(?:(${ADVERBS.join('|')})(\\s+))?([\\p{L}'’]+)`, 'gu'),
    (_m: string, sp: string, adv: string | undefined, advSp: string | undefined, verb: string) =>
      `I${sp}${adv ? `${adv}${advSp}` : ''}${bareVerb(verb)}`);
  out = out.split(SUBJ).join('I').split(POSS).join('my');

  // Natural contractions — the CoS speaks like a person, not a grammar exercise.
  out = out.replace(/\bI am\b/g, "I'm")
    .replace(/\bI have\s+(?=[\p{L}]+(?:ed|en|t)\b)/gu, "I've ")
    .replace(/\bI will\b/g, "I'll");
  // A sentence may not open lowercase because its subject collapsed away ("my draft…").
  out = out.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m: string, pre: string, c: string) => `${pre}${c.toUpperCase()}`);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

// ── THE THIRD-PERSON REFUSAL'S NAME TEST (stabilization W8.4 — THE ROOM SPEAKS TRUE, Sep 23) ────
// The composer's belt behind the collapse used to be `\b<SpeakerFirst>\s+\p{Ll}` — any occurrence of
// the seat's given name followed by a lowercase word. Live: a real colleague's SURNAME was the seat's
// given name, so "…<Given> <Seat> messaged on September…" was refused on EVERY open (six refusals in
// one session), each one re-buying the model and serving the fallback. The refusal must fire only
// when the name DENOTES THE SPEAKER:
//   · a known person's full name (the grounding's own people — board counterparties, entity people)
//     that spans this occurrence is that person, never the speaker;
//   · a capitalized word immediately before is a name token ("<Given> <Seat>") — a different person
//     — UNLESS it is a sentence-opening adverb/conjunction ("Yesterday <Seat> drafted it"), which is
//     not a name and leaves the speaker narrated in the third person.
// Leaving one ambiguous mention standing costs a sentence; refusing a true paragraph costs the whole
// room its voice on every open. Pure; the gate holds both fixtures against it.
const SENTENCE_OPENERS = new Set([
  'yesterday', 'today', 'tomorrow', 'then', 'now', 'also', 'meanwhile', 'so', 'but', 'and', 'here',
  'there', 'once', 'after', 'before', 'when', 'while', 'since', 'earlier', 'later', 'last', 'next',
  'this', 'that', 'already', 'still', 'again', 'first', 'finally', 'otherwise', 'instead', 'however',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'overnight', 'recently',
]);

function nameTokens(s: string | null | undefined): string[] {
  return String(s ?? '').replace(/<[^>]*>/g, ' ').split(/[\s,]+/).map((t) => t.replace(/^["'“(]+|["'”).:;!?]+$/g, '')).filter(Boolean);
}

/**
 * Does `text` narrate the SPEAKER by name in the third person ("<Seat> drafted it")? `knownPeople` =
 * the full names the page is about (the grounding's people). An occurrence that is part of a longer
 * proper name — a known person's, or any "<Capitalized> <Seat>" whose first word is not a
 * sentence-opener — is someone else and never counts.
 */
export function narratesSpeakerInThirdPerson(
  text: string, speaker: string | null | undefined, knownPeople: Array<string | null | undefined> = [],
): boolean {
  const first = String(speaker ?? '').trim().split(/\s+/)[0] ?? '';
  if (first.length < 2 || !text) return false;
  const lc = first.toLowerCase();
  // Known multi-token names carrying the seat's given name as one of their tokens (the clash class).
  const clashing = knownPeople.map(nameTokens).filter((toks) => toks.length >= 2 && toks.some((t) => t.toLowerCase() === lc));
  const re = new RegExp(`\\b${escapeRe(first)}\\b(?=\\s+\\p{Ll})`, 'gu');
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    // (1) a known person's full name spans this occurrence → that person.
    const spansKnown = clashing.some((toks) => {
      const idx = toks.findIndex((t) => t.toLowerCase() === lc);
      const lead = toks.slice(0, idx).join(' ');
      const before = text.slice(0, at).trimEnd();
      return !!lead && before.toLowerCase().endsWith(lead.toLowerCase());
    });
    if (spansKnown) continue;
    // (2) a capitalized word right before → a name token, unless it is a sentence-opening word.
    const lead = text.slice(0, at);
    const prev = lead.match(/([\p{Lu}][\p{L}'’-]*)\s+$/u);
    if (prev && !SENTENCE_OPENERS.has(prev[1].toLowerCase())) continue;
    return true;
  }
  return false;
}

/** Does this text still narrate the speaker in the third person? The gate's question, and the
 *  composer's own post-check assertion. */
export function namesSelfInThirdPerson(text: string, speaker: string | null | undefined): boolean {
  return collapseSelfVoice(text, speaker) !== text;
}

// ── CLAIM ONLY WHAT RENDERS ──────────────────────────────────────────────────────────────────────

/** What the page will actually carry beneath the brief, as the composer knows it. */
export type RenderFacts = {
  /** A prepared artifact exists on the board (a draft/invite/document card renders). */
  hasPrepared: boolean;
  /** A decision card renders. */
  hasDecision: boolean;
  /** At least one ask card survives the editor. */
  hasAsk: boolean;
  /** W11.1 · WHAT renders — the board's own prepared words for this page (lib/room/grounding
   *  preparedWordsOf: "reply draft", "follow-up nudge draft", "calendar invite", "document …").
   *  With it, a claimed prepared thing must match a rendered KIND, not merely coexist with one.
   *  Absent → the coarse `hasPrepared` test alone (every caller before W11.1). */
  prepared?: string[];
};

// ── A CLAIMED PREPARED THING RENDERS (stabilization W11.1 · ONE COHERENT ITEM, owner walk Sep 23) ──
// The room's brief said "I've drafted process notes on how to make the change" — no card rendered
// any notes; the page carried an email draft (itself withdrawn later). The pointer net above only
// fires on "below"/"laid out"; a first-person PREPARATION claim with no pointer walked straight past
// it, and `hasPrepared` (any card at all) would have excused it anyway. The net now reads the claim's
// OBJECT: a sentence that says we prepared a THING of a kind the page does not render is dropped.
/** "I've drafted / we prepared / I put together …" — a first-person preparation claim (past only;
 *  "I can draft", "I haven't drafted", "I have not prepared" never match). */
const PREP_CLAIM = /\b(?:I|we)(?:'ve| have)?\s+(?:now\s+|already\s+|just\s+|also\s+)?(?:drafted|prepared|written|wrote|put together|pulled together|staged|built|created|laid out|outlined|sketched|lined up)\b/i;
type PrepKind = 'email' | 'invite' | 'forward' | 'document' | 'decision';
/** The claimed object's KIND, read from the words after the verb — null when it names none. Email
 *  first: "a note to Sam" is a message; "notes on the change" is a document. */
function claimedKindOf(after: string): PrepKind | null {
  const t = after.slice(0, 90);
  if (/\b(?:note|line|message|email|e-mail|reply|response|answer|nudge|follow-?up|reminder)\s+(?:to|for)\s+[A-Z]/.test(t)
    || /\b(?:reply|replies|response|email|e-mail|message|nudge|follow-?up)\b/i.test(t)) return 'email';
  if (/\b(?:invite|invitation|calendar|meeting slot|time slots?)\b/i.test(t)) return 'invite';
  if (/\bforward/i.test(t)) return 'forward';
  if (/\b(?:decision|choice|options|trade-?offs)\b/i.test(t)) return 'decision';
  if (/\b(?:notes?|document|doc|memo|summary|outline|brief(?:ing)?|deck|slides|report|plan|proposal|sheet|spreadsheet|analysis|steps|checklist|guide|write-?up|version|draft of|breakdown|agenda|words)\b/i.test(t)) return 'document';
  return null;
}
/** The KINDS the board's prepared words render. A paste pack is words (email-shaped and document-
 *  shaped alike); a decision brief is a decision and a document. */
export function renderedKindsOf(prepared: string[]): Set<PrepKind> {
  const out = new Set<PrepKind>();
  for (const w of prepared.map((x) => String(x ?? '').toLowerCase())) {
    if (/reply draft|nudge draft/.test(w)) out.add('email');
    if (/calendar invite/.test(w)) out.add('invite');
    if (/^forward/.test(w)) { out.add('forward'); out.add('email'); }
    if (/paste pack/.test(w)) { out.add('email'); out.add('document'); }
    if (/decision brief/.test(w)) { out.add('decision'); out.add('document'); }
    if (/^document/.test(w)) out.add('document');
  }
  return out;
}
/** Does this sentence claim a prepared thing the page does not render? (null = not a claim.) */
export function claimsUnrenderedPreparation(sentence: string, facts: Pick<RenderFacts, 'hasPrepared' | 'prepared'>): boolean | null {
  const m = PREP_CLAIM.exec(sentence);
  if (!m) return null;
  const kind = claimedKindOf(sentence.slice((m.index ?? 0) + m[0].length));
  if (!facts.prepared) return !facts.hasPrepared;
  if (!facts.prepared.length) return true;
  if (!kind) return false; // an object we cannot read ("I've drafted it") beside a real card stands
  return !renderedKindsOf(facts.prepared).has(kind);
}

/** The pointer words: a sentence claiming something is ON THE PAGE. */
const POINTS_AT_PAGE = /\b(below|beneath|laid out|shown here|attached here|right here)\b/i;
const DRAFT_SHAPED = /\b(draft|drafted|drafts|prepared|written|staged|ready to (?:review|send))\b/i;
const DECISION_SHAPED = /\b(decision|choice|options|trade-?offs)\b/i;

/** The honest replacement when the whole position was a claim about a thing that is not there. */
export const OFFER_INSTEAD = 'Nothing is staged on this yet — I can draft it, say the word.';

function sentencesOf(text: string): string[] {
  return String(text).split(/(?<=[.!?])\s+/).filter((s) => s.trim());
}

/**
 * Strip any sentence that points at something the page does not carry. Returns the corrected text
 * and what was dropped (for the gate / the log). Never invents a claim; only removes one.
 */
export function enforceRenderedClaims(
  text: string, facts: RenderFacts,
): { text: string; dropped: string[] } {
  const sents = sentencesOf(text);
  if (sents.length === 0) return { text, dropped: [] };
  const kept: string[] = [];
  const dropped: string[] = [];
  let droppedDraftClaim = false;
  for (const s of sents) {
    // W11.1 · the claimed prepared thing must be a thing the page renders (pointer or not).
    const unrendered = claimsUnrenderedPreparation(s, facts);
    if (unrendered === true) { dropped.push(s.trim()); droppedDraftClaim = true; continue; }
    if (!POINTS_AT_PAGE.test(s)) { kept.push(s); continue; }
    const needsDecision = DECISION_SHAPED.test(s);
    const needsDraft = DRAFT_SHAPED.test(s);
    const ok = needsDecision ? facts.hasDecision
      : needsDraft ? facts.hasPrepared
      : (facts.hasPrepared || facts.hasDecision || facts.hasAsk);
    if (ok) { kept.push(s); continue; }
    dropped.push(s.trim());
    if (needsDraft && !needsDecision) droppedDraftClaim = true;
  }
  if (!dropped.length) return { text, dropped };
  const rest = kept.join(' ').trim();
  if (rest) return { text: rest, dropped };
  // The claim WAS the whole position. A draft claim degrades to the honest offer; anything else
  // degrades to nothing, and the caller keeps its last-good rather than shipping a lie.
  return { text: droppedDraftClaim ? OFFER_INSTEAD : '', dropped };
}

// ── TIME TRUTH IN THE BRIEF (stabilization W12.1 · owner live walk Sep 23, after W11) ─────────────
// The room brief said "<Contact> asked us nine days ago" about an ask dated Aug 28, on Sep 23 — 26
// days. The composer does arithmetic in prose and nothing checked it. THE NET: every relative day
// claim in served prose ("N days ago", "yesterday", "the day before yesterday", "last week", "a week
// ago", "a few days ago", "earlier this week") is CODE-VERIFIED against the dated events the page
// actually carries (the user's own clock, lib/utils/user-time localNow):
//   · the phrase is ATTRIBUTED when a known person's name stands just before it in the same clause
//     ("<Contact> asked us nine days ago") — then it must match one of THAT person's dated events;
//     unattributed, it must match some dated event on the page;
//   · verified → kept; an attributed claim that fails is REWRITTEN to the absolute date of that
//     person's event when exactly one day is on record ("asked us on Aug 28"); anything else is
//     DROPPED (the phrase, never the sentence — the prose says less, never something else).
// Pure, deterministic, zero AI (the floor doctrine: a missed catch costs precision, a false catch
// must never invent a date — a rewrite only ever uses a date the page holds for that person).

/** A dated event the page carries — its LOCAL day (YYYY-MM-DD, the user's zone) and, when known,
 *  the person it is about. */
export type DatedEvent = { day: string; who?: string | null };

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, a: 1, an: 1,
};
const NUM = `(?:\\d{1,3}|${Object.keys(NUM_WORDS).filter((k) => k !== 'a' && k !== 'an').join('|')}|twenty[- ](?:one|two|three|four|five|six|seven|eight|nine))`;
const QUAL = `(?:(?:about|around|roughly|nearly|almost|over|more than|less than|under|just over|just under|some)\\s+)?`;
/** The relative-day vocabulary (EN — the composer writes the room brief in the user's language; the
 *  non-EN forms are a stated gap, never a guess). Longest forms first so "the day before yesterday"
 *  is never read as "yesterday". */
const RELATIVE_DAY = new RegExp(
  `\\b(?:the day before yesterday|day before yesterday|yesterday|earlier this week|last week|` +
  `${QUAL}(?:a couple of|a few|several) days ago|` +
  `${QUAL}${NUM} days? ago|` +
  `${QUAL}(?:a|an|${NUM}) weeks? ago)\\b`, 'gi');

function numOf(tok: string): number | null {
  const t = tok.toLowerCase().replace(/-/g, ' ');
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (NUM_WORDS[t] !== undefined) return NUM_WORDS[t];
  const m = /^twenty (\w+)$/.exec(t);
  return m && NUM_WORDS[m[1]] !== undefined ? 20 + NUM_WORDS[m[1]] : null;
}

/** Whole days between two YYYY-MM-DD local days (a − b). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** The day-offset range [lo, hi] (days before `today`) a relative phrase claims; null = unparsed. */
export function relativeDayRange(phrase: string, today: string): [number, number] | null {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/day before yesterday$/.test(p)) return [2, 2];
  if (p === 'yesterday') return [1, 1];
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  if (p === 'earlier this week') return dow >= 1 ? [1, dow] : null;
  if (p === 'last week') return [dow + 1, dow + 7];
  const q = /^(about|around|roughly|nearly|almost|over|more than|less than|under|just over|just under|some) /.exec(p)?.[1] ?? null;
  const core = q ? p.slice(q.length + 1) : p;
  let lo: number; let hi: number; let n: number;
  const vague = /^(a couple of|a few|several) days ago$/.exec(core);
  if (vague) {
    [lo, hi] = vague[1] === 'a couple of' ? [2, 3] : vague[1] === 'a few' ? [2, 6] : [3, 9];
    n = Math.round((lo + hi) / 2);
  } else {
    const d = /^(.+?) days? ago$/.exec(core);
    const w = /^(.+?) weeks? ago$/.exec(core);
    const k = d ? numOf(d[1]) : w ? numOf(w[1]) : null;
    if (k === null) return null;
    if (d) { n = k; const tol = k <= 2 ? 0 : 1; lo = k - tol; hi = k + tol; }
    else { n = 7 * k; lo = n - 3; hi = n + 3; }
  }
  if (q === 'over' || q === 'more than' || q === 'just over') return [n + 1, Number.POSITIVE_INFINITY];
  if (q === 'less than' || q === 'under' || q === 'just under') return [0, Math.max(0, n - 1)];
  if (q) { const t = Math.max(1, Math.round(n * 0.15)); return [Math.max(0, lo - t), hi + t]; }
  return [lo, hi];
}

/** A person's name tokens worth matching in prose (capitalized, ≥3 letters; the address stripped). */
function personTokens(who: string | null | undefined): string[] {
  return String(who ?? '').replace(/<[^>]*>/g, ' ').replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/)
    .filter((t) => t.length >= 3 && /^\p{Lu}/u.test(t));
}

/** The person the phrase is attributed to: a known name standing just before it in the same clause
 *  (≤ 60 chars, no other subject — I/we/you — and no clause break between). */
function attributedWho(sentence: string, phraseAt: number, people: string[]): string | null {
  let best: { who: string; at: number } | null = null;
  for (const who of people) {
    for (const tok of personTokens(who)) {
      const re = new RegExp(`(?<![\\p{L}])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu');
      for (const m of sentence.matchAll(re)) {
        const at = m.index ?? 0;
        if (at >= phraseAt) continue;
        const gap = sentence.slice(at + m[0].length, phraseAt);
        if (gap.length > 60 || /\b(?:I|we|you)\b/.test(gap) || /[;:—–()]/.test(gap)) continue;
        if (!best || at > best.at) best = { who, at };
      }
    }
  }
  return best?.who ?? null;
}

/** "Aug 28" (the year only when it is not today's). */
export function absoluteDayLabel(day: string, today: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${day.slice(0, 4)}`;
}

/**
 * THE RELATIVE-TIME NET — verify every relative day claim against the page's dated events; rewrite
 * an attributed false one to its absolute date, drop anything else unverifiable. Returns the text
 * and what changed (for the gate / the log).
 */
export function enforceRelativeTimeTruth(
  text: string, facts: { today: string; events: DatedEvent[] },
): { text: string; rewritten: string[]; dropped: string[] } {
  const rewritten: string[] = [];
  const dropped: string[] = [];
  if (!text || !facts.today) return { text, rewritten, dropped };
  const people = [...new Set(facts.events.map((e) => e.who).filter((w): w is string => !!w && personTokens(w).length > 0))];
  const sents = String(text).split(/(?<=[.!?])\s+/);
  const out = sents.map((sentence) => {
    let s = sentence;
    // Walk the matches right-to-left so earlier offsets stay valid through the edits.
    const matches = [...sentence.matchAll(RELATIVE_DAY)].reverse();
    for (const m of matches) {
      const phrase = m[0];
      const at = m.index ?? 0;
      const range = relativeDayRange(phrase, facts.today);
      if (!range) continue;
      const who = attributedWho(sentence, at, people);
      const pool = who ? facts.events.filter((e) => e.who === who) : facts.events;
      const ok = pool.some((e) => { const d = dayDiff(facts.today, e.day); return d >= range[0] && d <= range[1]; });
      if (ok) continue;
      const days = who ? [...new Set(pool.map((e) => e.day).filter((d) => dayDiff(facts.today, d) >= 0))] : [];
      if (days.length === 1) {
        const abs = `on ${absoluteDayLabel(days[0], facts.today)}`;
        const cap = /^\p{Lu}/u.test(phrase) ? abs.charAt(0).toUpperCase() + abs.slice(1) : abs;
        s = s.slice(0, at) + cap + s.slice(at + phrase.length);
        rewritten.push(`${phrase} → ${abs}`);
        continue;
      }
      // DROP the phrase (and a preposition it leaves dangling); a sentence-opening phrase takes its
      // comma with it and the next word is re-capitalized.
      let head = s.slice(0, at);
      let tail = s.slice(at + phrase.length);
      head = head.replace(/\b(?:since|from|as of|until)\s+$/i, '');
      if (!head.trim()) { tail = tail.replace(/^\s*,?\s*/, ''); tail = tail.charAt(0).toUpperCase() + tail.slice(1); }
      s = (head.replace(/\s+$/, '') + (head.trim() && tail && !/^[\s,.;:!?]/.test(tail) ? ' ' : '') + tail.replace(/^\s+(?=[,.;:!?])/, ''))
        .replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*([.!?])/g, '$1');
      dropped.push(phrase);
    }
    return s;
  });
  if (!rewritten.length && !dropped.length) return { text, rewritten, dropped };
  return { text: out.join(' ').replace(/\s{2,}/g, ' ').trim(), rewritten, dropped };
}
