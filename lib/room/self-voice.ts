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
  `a reply — say the word"); never point at something that is not on the page.`;

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
};

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
