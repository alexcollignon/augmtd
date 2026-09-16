// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEIXIS SEAM — proactive-reach LAW 3 (THE SERVED-WORDS LAW, docs/proactive-reach-plan.md).
//
// Stored text must stay TRUE as time passes. A title that says "tomorrow" is true for one day and a
// lie every day after; a deck that speaks it costs more trust than ten true rows earn (THE STANDING
// SENTENCE). The law has existed since the T-class arc — but it lived as a SITE LIST: one resolver
// call, wired at exactly one of three write seams (commitment descriptions), while `understanding.ask`
// and `work_title` — the two fields the deck actually leads with — were frozen ingest snapshots
// rendered verbatim. That is the site-list decay class, fourth occurrence. This module is the law as
// a STRUCTURE:
//
//   1. ONE TABLE of day-words (EN · PT · DE · FR — the corpus languages; THE AGNOSTIC CLAUSE forbids
//      an English-only law), from which every regex in the house is derived. Adding a language is one
//      row, never four copies.
//   2. ONE RESOLVER (`resolveDeixisInDescriptions`) applied at EVERY write seam: commitment
//      descriptions, `understanding.ask`, `work_title` (email + meeting action items). Detection is
//      LEXICAL and deterministic; the rewrite is REASONED (one capped cheap-tier call, offenders
//      only), anchored to THE SOURCE'S OWN DATE — never processing day.
//   3. ONE SERVE GUARD (`stripDeixis`) at the label-serving seam: deterministic, ZERO AI, never on
//      the critical path, never blocking. A legacy row frozen before the law heals AS IT SERVES.
//
// PURE + client-safe below the resolver: `stripDeixis` and the tables import nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── THE ONE TABLE ───────────────────────────────────────────────────────────────────────────────
// Per language: the relative day-phrases, the weekday names, and the qualifiers/prepositions that
// glue a day-word to its sentence ("on Thursday", "am Donnerstag", "na quinta-feira", "ce jeudi").
// Everything downstream — the write-seam detector AND the serve guard — is built from THIS.
type DeixisLang = { relative: string[]; weekdays: string[]; qualifiers: string[]; preps: string[] };

export const DAY_WORDS: Record<'en' | 'pt' | 'de' | 'fr', DeixisLang> = {
  en: {
    relative: ['today', 'tonight', 'tomorrow', 'yesterday', 'this morning', 'this afternoon', 'this evening',
      'this week', 'next week', 'this month', 'next month'],
    weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    qualifiers: ['this', 'next', 'coming'],
    preps: ['on', 'by', 'for', 'until', 'till', 'before', 'this', 'next', 'coming'],
  },
  pt: {
    relative: ['hoje', 'hoje à noite', 'hoje a noite', 'amanhã', 'amanha', 'ontem', 'esta manhã', 'esta tarde', 'esta noite',
      'esta semana', 'próxima semana', 'proxima semana', 'semana que vem',
      'este mês', 'este mes', 'próximo mês', 'proximo mes', 'mês que vem', 'mes que vem'],
    // Only the unambiguous "-feira" forms: bare "quinta"/"segunda" are ALSO ordinals in Portuguese
    // ("a segunda proposta"), and a guard that mangles a true label is worse than one that misses.
    weekdays: ['segunda-feira', 'terça-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira',
      'sábado', 'sabado', 'domingo'],
    qualifiers: ['esta', 'este', 'próxima', 'proxima', 'próximo', 'proximo'],
    preps: ['na', 'no', 'em', 'até', 'ate', 'para', 'esta', 'este', 'próxima', 'proxima', 'próximo', 'proximo'],
  },
  de: {
    relative: ['heute', 'heute abend', 'heute morgen', 'morgen', 'übermorgen', 'ubermorgen', 'gestern',
      'diese woche', 'nächste woche', 'naechste woche', 'nachste woche',
      'diesen monat', 'nächsten monat', 'naechsten monat', 'nachsten monat'],
    weekdays: ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonnabend', 'sonntag'],
    qualifiers: ['diesen', 'diese', 'nächsten', 'naechsten', 'nachsten', 'nächste', 'kommenden'],
    preps: ['am', 'bis', 'für', 'fuer', 'zum', 'diesen', 'diese', 'nächsten', 'naechsten', 'nachsten', 'kommenden'],
  },
  fr: {
    relative: ["aujourd'hui", 'aujourd’hui', 'ce soir', 'ce matin', 'cet après-midi', 'cet apres-midi',
      'demain', 'après-demain', 'apres-demain', 'hier',
      'cette semaine', 'la semaine prochaine', 'semaine prochaine',
      'ce mois-ci', 'le mois prochain', 'mois prochain'],
    weekdays: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
    qualifiers: ['ce', 'cette', 'prochain', 'prochaine'],
    preps: ['le', 'la', 'de', 'du', 'ce', 'cette', 'jusqu’à', "jusqu'à", 'avant', 'pour', 'd’ici', "d'ici"],
  },
};

const LANGS = Object.keys(DAY_WORDS) as Array<keyof typeof DAY_WORDS>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Longest-first so "next week" wins over "next", "quinta-feira" over "quinta". */
const byLength = (a: string, b: string) => b.length - a.length;

const allRelative = LANGS.flatMap((l) => DAY_WORDS[l].relative);
const allWeekdays = LANGS.flatMap((l) => DAY_WORDS[l].weekdays);
const allQualifiers = LANGS.flatMap((l) => DAY_WORDS[l].qualifiers);
const allPreps = LANGS.flatMap((l) => DAY_WORDS[l].preps);

// Unicode-safe boundaries. `\b` is ASCII-only, so `amanhã\b` NEVER matches (the trailing "ã" is not a
// \w char) — the exact reason the pre-law regex silently missed every accented Portuguese day-word.
const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])(?!\\.[\\p{L}])'; // the trailing guard also spares "Monday.com"-shaped names

/** "this Thursday" / "próxima quinta-feira" / "nächsten Donnerstag" — a qualified weekday. */
const QUALIFIED = `(?:${allQualifiers.sort(byLength).map(esc).join('|')})\\s+(?:${allWeekdays.sort(byLength).map(esc).join('|')})`;

/** Every day-word shape, longest-first. The ONE alternation both the detector and the guard use. */
const DAY_WORD_BODY = `(?:${QUALIFIED}|${[...allRelative, ...allWeekdays].sort(byLength).map(esc).join('|')})`;

/**
 * THE WRITE-SEAM DETECTOR (lexical, zero-AI). True when a stored string carries a relative day-word
 * in ANY corpus language — the trigger for the reasoned rewrite. Kept as the historical export name
 * (`DEICTIC_RE`) so every existing caller and gate keeps pointing at the one law.
 * ⚠️ Has no /g flag on purpose: callers only ever `.test()` it, and a sticky lastIndex across calls
 * is the classic shared-regex bug.
 */
export const DEICTIC_RE = new RegExp(`${L}${DAY_WORD_BODY}${R}`, 'iu');

/** The serve guard's stripper: a day-word, plus the preposition/qualifier that carried it. */
// Two refinements, both deterministic and language-agnostic:
//   • the optional POSSESSIVE tail ("Wednesday's Fed decision") rides WITH the day-word — leaving a
//     bare "'s" behind would be a worse artefact than the word it replaced;
//   • a RUN of alternatives ("Thursday or Friday", "Wednesday/Thursday", "lundi ou mardi") is ONE
//     span: stripping only the members leaves a dangling connector ("Confirm availability or"). The
//     connector is matched structurally — a separator, or a short word BETWEEN two day-words — never
//     from a list of English conjunctions.
const PREP_ALT = allPreps.sort(byLength).map(esc).join('|');
const RUN_JOIN = `(?:\\s*[,/&+–—-]\\s*|\\s+[\\p{L}]{1,4}\\s+)`;
const STRIP_RE = new RegExp(
  `${L}(?:(?:${PREP_ALT})\\s+)?${DAY_WORD_BODY}` +
  `(?:${RUN_JOIN}(?:(?:${PREP_ALT})\\s+)?${DAY_WORD_BODY})*` +
  `(?:['\u2019]s)?${R}`,
  'giu',
);

/**
 * THE SERVE-TIME GUARD (LAW 3) — deterministic, ZERO AI, never blocking.
 *
 * A served whisper label carrying an UNRESOLVED day-word is a lie about time the moment its day
 * passes ("Confirm lunch with <someone> tomorrow", served on a Sunday about a lapsed Thursday). The
 * write seams resolve deixis going forward; every row frozen BEFORE the law heals here, as it serves.
 *
 * The guard REMOVES the decaying words rather than re-deriving a date: at serve time the source's own
 * date is not in hand, and an invented date would be a worse lie than a missing one (the never-guess
 * law). The row keeps its verb and its object — "Confirm lunch with <someone>" is true on any day.
 *
 * Never destructive: if stripping would leave nothing meaningful, the original stands (showing a
 * stale word costs less than serving an empty row).
 */
export function stripDeixis(label: string | null | undefined): string {
  const original = String(label ?? '');
  if (!original.trim() || !DEICTIC_RE.test(original)) return original;
  const stripped = original
    .replace(STRIP_RE, ' ')
    // tidy the seam the removal leaves behind — doubled spaces, orphaned punctuation/dashes
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*(?:\1\s*)+/g, '$1 ')   // the removal can butt two separators together
    .replace(/[\s,;:·–—-]+$/g, '')
    .replace(/^[\s,;:·–—-]+/g, '')
    .trim();
  // A label must still say something. Require a surviving word AND real content.
  if (stripped.length < 3 || !/[\p{L}\p{N}]/u.test(stripped)) return original;
  return stripped;
}

/** True when a served label still carries a day-word (the gate's predicate — same table, no fork). */
export function carriesDayWord(label: string | null | undefined): boolean {
  return DEICTIC_RE.test(String(label ?? ''));
}

// ── THE REASONED RESOLVER (the write seams) ─────────────────────────────────────────────────────
// Detection above is lexical; the REWRITE is reasoned — one capped `classification`-tier call over
// the offending strings ONLY, anchored to the SOURCE'S own date. Failure keeps the original
// (non-fatal, honest: a belt, never a gate).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

export async function resolveDeixisInDescriptions<T extends { description: string }>(
  client: DBClient, userId: string, list: T[], anchorIso: string | null,
): Promise<T[]> {
  const offenders = list.map((c, i) => ({ c, i })).filter(({ c }) => DEICTIC_RE.test(c.description ?? ''));
  if (!offenders.length) return list;
  try {
    const { getAIClient, aiCreate } = await import('@/lib/ai/factory');
    const anchor = anchorIso && !isNaN(Date.parse(anchorIso)) ? new Date(anchorIso) : new Date();
    const anchorPretty = anchor.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, {
      model, max_tokens: 400, temperature: 0,
      messages: [{ role: 'user', content:
        `These task titles contain RELATIVE time words that decay ("tomorrow" stops being true in a day; ` +
        `a bare weekday stops saying WHICH one). They may be in any language — keep each title in ITS OWN ` +
        `language. The source they came from is dated ${anchorPretty}. Rewrite each title with the relative ` +
        `words resolved to ABSOLUTE dates forward from THAT date (keep clock times; "tomorrow" → the next ` +
        `day's "MMM D"; a bare weekday → that weekday's actual date). Change NOTHING else about the title.\n\n` +
        offenders.map(({ c }, n) => `${n}. ${c.description}`).join('\n') +
        `\n\nJSON only: {"titles":["…", …]} (same order, same count)` }],
    });
    const m = (res.choices?.[0]?.message?.content ?? '').match(/\{[\s\S]*\}/);
    const titles = m ? (JSON.parse(m[0]) as { titles?: string[] }).titles : null;
    if (Array.isArray(titles) && titles.length === offenders.length) {
      const out = [...list];
      offenders.forEach(({ i }, n) => {
        const t = String(titles[n] ?? '').trim();
        // Accept only a rewrite that actually removed the deixis — a lazy echo keeps the original.
        if (t && !DEICTIC_RE.test(t)) out[i] = { ...out[i], description: t.slice(0, 140) };
      });
      return out;
    }
  } catch { /* the scrubber is a belt — the original title stands */ }
  return list;
}

/**
 * The single-string door onto the same resolver — for the seams that carry ONE machine-authored
 * label (`understanding.ask`, an item's `work_title`). Short-circuits with ZERO AI when the text
 * carries no day-word, which is the overwhelming majority of every corpus.
 */
export async function resolveDeixisText(
  client: DBClient, userId: string, text: string | null | undefined, anchorIso: string | null,
): Promise<string> {
  const s = String(text ?? '');
  if (!s.trim() || !DEICTIC_RE.test(s)) return s;
  const [out] = await resolveDeixisInDescriptions(client, userId, [{ description: s }], anchorIso);
  return out?.description ?? s;
}
