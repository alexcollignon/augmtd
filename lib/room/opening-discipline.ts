// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OPENING'S PROSE DISCIPLINE — SPEAK, ONCE, ABOUT ONE THING (docs/threads-plan.md, THE OPENING
// CONTRACT clauses 2 + 3; the owner's Sep 19 walk).
//
// The voice half (first person, claim-only-what-renders) lives in lib/room/self-voice.ts. This is
// the SENTENCE half — three findings from the same walk, each a class:
//
//   1. THE RESTATEMENT. One opening said the same fact in three consecutive sentences ("You owe
//      your CV…", "Your CV, profile and training offerings are outstanding…", "He's waiting on the
//      CV…"). Experience-spec law 1: one fact, one home — including inside one paragraph.
//
//   2. THE DANGLING REFERENCE. "You owe your CV, profile, and training offerings before then." —
//      with no "then" anywhere in the composed text. A comparative whose antecedent was clipped out
//      of the grounding reads as the machine remembering something the reader cannot see.
//
//   3. THE NAME, TWICE. "Sam is asking you to decide whether to engage with Sam's
//      collaboration proposal" — the counterparty introduced and then re-introduced inside one
//      sentence, which is how a single actor reads as two.
//
// Each is stated as a prompt rule AND enforced here, deterministically, at the seam where the
// composed sentence exists (the house doctrine: a prompt is a hope; the promise moves into code,
// and the code is what a gate can assert). Every net REMOVES or PRONOMINALISES — none invents a
// word, and none rewrites across a sentence boundary, so the worst case is prose that says less.
//
// Pure, zero AI, no I/O — so a gate can hold a fixture against it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The rules, stated once, for every prompt that composes room speech. ONE copy (the excerpt-law
 *  lesson: a law with N hand-copies decays into a site list). */
export const NO_RESTATEMENT_RULE =
  `SAY IT ONCE: every fact appears exactly once in the opening. Do not restate the debt, the ask or ` +
  `the consequence in a second sentence wearing different words — a paragraph that circles one fact ` +
  `three times reads as a machine padding, not a colleague reporting.`;

export const REFERENCE_RULE =
  `NO DANGLING REFERENCES: never write "before then", "by that date", "after that", "the above" or ` +
  `any other pointer whose antecedent is not IN the sentences you just wrote. If the date matters, ` +
  `state it ("before Friday"); if you cannot state it, drop the pointer. And name a person at most ` +
  `ONCE per sentence — the second mention is "they"/"their", never the name again.`;

export const ONE_MOVE_RULE =
  `ONE MOVE, OR THE CONNECTION STATED: the brief's headline deed and the MOVE are the same body of ` +
  `work. If a second deed genuinely blocks the first, the text must SAY the link in so many words ` +
  `("the reply needs the commercials — I'd chase them first"); two unconnected deeds in one opening ` +
  `is two agendas, and the reader has to guess which one you meant.`;

// ── THE TOKEN IDIOM (shared with offerEchoesMove in lib/room/brief.ts) ──────────────────────────
const words = (s: string): string[] =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Plural is the same object ("offerings" is "offering") — a hard compare would let the echo through. */
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export function sentencesOf(text: string): string[] {
  return String(text).split(/(?<=[.!?])\s+/).filter((s) => s.trim());
}

// ── 1 · THE RESTATEMENT ─────────────────────────────────────────────────────────────────────────

/**
 * Drop a LATER sentence whose distinctive content is already carried by an earlier one. The bar is
 * deliberately high (≥0.75 of the shorter distinctive set, ≥3 distinctive words) and the direction
 * is fixed — the FIRST statement of a fact survives, every echo of it dies. A sentence that adds
 * even one new distinctive object (a name, a date, a deliverable) is a new fact and stays.
 */
export function dropRestatements(text: string, generic: Set<string>): { text: string; dropped: string[] } {
  const sents = sentencesOf(text);
  if (sents.length < 2) return { text, dropped: [] };
  const distinctive = (s: string): Set<string> =>
    new Set(words(s).filter((w) => w.length > 3 && !generic.has(w)).map(stem));
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen: Array<Set<string>> = [];
  for (const s of sents) {
    const d = distinctive(s);
    if (d.size < 3) { kept.push(s); seen.push(d); continue; }
    let echo = false;
    for (const prev of seen) {
      if (prev.size < 3) continue;
      let shared = 0;
      for (const w of d) if (prev.has(w)) shared++;
      if (shared / Math.min(prev.size, d.size) >= 0.75) { echo = true; break; }
    }
    if (echo) { dropped.push(s.trim()); continue; }
    kept.push(s);
    seen.push(d);
  }
  if (!dropped.length) return { text, dropped };
  return { text: kept.join(' ').trim(), dropped };
}

// ── 2 · THE DANGLING REFERENCE ──────────────────────────────────────────────────────────────────

/** The pointers that need an antecedent the reader can SEE. Each carries what would satisfy it. */
const DANGLERS: Array<{ re: RegExp; antecedent: RegExp }> = [
  // "before then" / "by then" / "until then" / "since then" — satisfied by a stated time anywhere
  // in the composed text: a weekday, a month, a date, or an explicit clock/day word.
  {
    re: /\s*,?\s*\b(?:before|by|until|since|after)\s+then\b/gi,
    antecedent: /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|today|tomorrow|tonight|this week|next week|month-end|\d{1,2}(?:st|nd|rd|th)?\s|\d{1,2}[:/]\d{2})/i,
  },
  // "by that date" / "on that date" — the same test.
  {
    re: /\s*,?\s*\b(?:by|on|before|after)\s+that\s+(?:date|day|time|deadline)\b/gi,
    antecedent: /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|today|tomorrow|deadline|due)\b/i,
  },
  // "as above" / "the above" — the opening has no "above"; it IS the top of the page.
  { re: /\s*,?\s*\b(?:as|the|per the)\s+above\b/gi, antecedent: /$^/ },
];

/**
 * Strip pointers whose antecedent is not in the composed text. PHRASE-level (never the sentence) —
 * "You owe your CV, profile, and training offerings before then." keeps everything it actually
 * knows and loses only the word it cannot support.
 */
export function stripDanglingRefs(text: string): { text: string; dropped: string[] } {
  let out = String(text ?? '');
  const dropped: string[] = [];
  for (const { re, antecedent } of DANGLERS) {
    // The antecedent test reads the text WITHOUT the pointer itself, so "before then" can never
    // satisfy its own "then".
    const stripped = out.replace(re, ' ');
    if (stripped === out) continue;
    if (antecedent.test(stripped)) continue;              // the reader can see what it points at
    for (const m of out.match(re) ?? []) dropped.push(m.trim());
    out = stripped;
  }
  if (!dropped.length) return { text, dropped };
  // Tidy the seam the removal left — never the words around it.
  out = out.replace(/\s+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
  return { text: out, dropped };
}

// ── 3 · THE NAME, TWICE ─────────────────────────────────────────────────────────────────────────

const CAP_START = /^[\p{Lu}]/u;
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Within EACH sentence, the person is named once; later mentions become "their"/"them".
 *
 * DELIBERATELY NARROW — only the two positions whose pronoun is unambiguous:
 *   · possessive  ("…with Sam's proposal" → "…with their proposal")
 *   · object of a preposition ("…reply to Sam" → "…reply to them")
 * A second mention in SUBJECT position is left alone: "Sam sent it and Sam will chase" needs a
 * clause rewrite, and rewriting a subject is how a net starts changing who did what. Leaving one
 * repeat standing costs a sentence; a mangled subject costs the truth.
 */
export function nameOncePerSentence(text: string, names: Array<string | null | undefined>): string {
  const people = [...new Set(names.map((n) => String(n ?? '').trim()).filter((n) => n.length > 1))];
  if (!people.length || !text) return text;
  return sentencesOf(text).map((sentence) => {
    let s = sentence;
    for (const full of people) {
      // The forms a composition actually uses: the whole name and its given name.
      const first = full.split(/\s+/)[0];
      for (const name of [...new Set([full, first])].sort((a, b) => b.length - a.length)) {
        if (name.length < 2 || !CAP_START.test(name)) continue;
        const re = new RegExp(`\\b${escapeRe(name)}\\b(['’]s)?`, 'g');
        let seen = 0;
        s = s.replace(re, (m: string, poss: string | undefined, offset: number) => {
          seen++;
          if (seen === 1) return m;                                   // the introduction stays
          if (poss) return 'their';
          const lead = s.slice(0, offset);
          return /\b(to|with|from|for|of|about|by|on|at)\s+$/i.test(lead) ? 'them' : m;
        });
      }
    }
    return s;
  }).join(' ');
}
