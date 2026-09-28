// lib/core/relative-time.ts — TIME TRUTH FOR STORED PROSE (tier-1 #14 `time-truth`, W18.D).
//
// Owner walk, Sep 26: the item page's one opening sentence is COMPOSED once and SERVED from cache
// for days. It carried relative time words that were true at composition and false at serve time:
// a commitment born Aug 10 read "<Contact> asked you nine days ago to fix …" on Sep 26, and a mail
// of Sep 24 read "<Vendor> sent an invoice yesterday." on Sep 26. The words were not wrong when
// written — the SERVING of them was. The class: any composed sentence that reaches a surface from a
// cache and speaks time relative to the day it was written.
//
// THE LAW, as structure (three halves, one module):
//   1. ABSOLUTE_DATES_RULE — the one prompt rule every composer of stored prose carries: write
//      dates, never deltas.
//   2. absolutizeTimeWords — the compose-time belt: an EXACT relative word the model wrote anyway
//      ("yesterday", "ontem", "vor 3 Tagen") is rewritten to its absolute date against the
//      composition day before the text is stored.
//   3. serveTimeWords — the zero-AI serve floor, run on the server BEFORE the first paint (so the
//      NO-MUTATION law holds: the first paint is already true, nothing swaps after). A stored
//      sentence served on a later day than it was composed:
//        · EXACT relative words (a known day offset) are rewritten to the absolute date, anchored
//          on the composition's own timestamp (briefAt/at/composedAt) — "yesterday" written on
//          Sep 25 serves as "on Sep 24";
//        · a VAGUE relative expression ("last week", "a few days ago", "next Tuesday", a bare
//          weekday) has no single date to rewrite to, so the sentence is WITHHELD — the door's
//          fallback line stands and the recompose (the day rides the brief's sig) arrives as an
//          append. A withheld sentence costs a paint of the fallback; a false one costs trust.
//        · an unknown anchor (a pre-timestamp cached row) cannot prove its relative words true —
//          withheld.
//
// Languages: EN · PT · DE · FR — the corpus languages the deixis table (lib/inbox/deixis) already
// serves; the composer writes in the user's language. That table is the LABEL guard (it strips
// day-words from titles); this one carries each phrase's day OFFSET, which a stripper does not need.
//
// Pure, zero IO, zero AI, client-safe (imports nothing).

export type TimeLang = 'en' | 'pt' | 'de' | 'fr';

/** The prompt rule — ONE copy, imported by every composer whose output is stored and re-served. */
export const ABSOLUTE_DATES_RULE =
  `WRITE DATES, NEVER DELTAS: what you write is STORED and read again on later days, so a relative ` +
  `time word turns false overnight. Name a day by its DATE, taken from the dates the grounding gives ` +
  `you — "on Aug 10", "since Sep 24", "by Oct 2" — and never by its distance from today: no "today", ` +
  `"tonight", "this morning", "yesterday", "tomorrow", "N days ago", "last week", "next week", "earlier ` +
  `this week", "a few days ago", and no weekday on its own ("on Monday"). The same holds in every ` +
  `language you write in (never "hoje", "ontem", "amanhã", "há N dias", "semana passada"; never ` +
  `"heute", "gestern", "morgen", "vor N Tagen"; never "aujourd'hui", "hier", "demain", "il y a N ` +
  `jours"). When the grounding gives no date for a fact, say it without a time at all — never do ` +
  `date arithmetic in prose.`;

// ── NUMBERS ─────────────────────────────────────────────────────────────────────────────────────
const NUMS: Record<TimeLang, Record<string, number>> = {
  en: {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30,
  },
  pt: {
    um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
    nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16,
    dezasseis: 16, dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19, vinte: 20, trinta: 30,
  },
  de: {
    ein: 1, einem: 1, einen: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8,
    neun: 9, zehn: 10, elf: 11, 'zwölf': 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15,
    zwanzig: 20, 'dreißig': 30,
  },
  fr: {
    un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11,
    douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30,
  },
};
const byLength = (a: string, b: string) => b.length - a.length;
const numAlt = (l: TimeLang) => `(\\d{1,3}|${Object.keys(NUMS[l]).sort(byLength).join('|')}${l === 'en' ? '|twenty[- ](?:one|two|three|four|five|six|seven|eight|nine)' : ''})`;
function numOf(tok: string, l: TimeLang): number | null {
  const t = tok.toLowerCase().replace(/-/g, ' ').trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (NUMS[l][t] !== undefined) return NUMS[l][t];
  const m = /^twenty (\w+)$/.exec(t);
  return l === 'en' && m && NUMS.en[m[1]] !== undefined ? 20 + NUMS.en[m[1]] : null;
}

// ── WEEKDAYS + MONTHS (a weekday next to an absolute date is not relative) ─────────────────────
const WEEKDAYS: Record<TimeLang, string[]> = {
  en: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  // Only the unambiguous "-feira" forms (bare "segunda"/"quinta" are also ordinals) — the deixis rule.
  pt: ['segunda-feira', 'terça-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'sabado', 'domingo'],
  de: ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonnabend', 'sonntag'],
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
};
const MONTH_WORDS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'janeiro', 'fevereiro', 'março', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  'januar', 'februar', 'märz', 'maerz', 'mai', 'juni', 'juli', 'oktober', 'dezember',
  'janvier', 'février', 'fevrier', 'mars', 'avril', 'juin', 'juillet', 'août', 'aout', 'septembre', 'octobre', 'novembre', 'décembre', 'decembre',
];
const MONTH_ALT = MONTH_WORDS.sort(byLength).join('|');
const DATE_AFTER = new RegExp(`^\\s*[,(]?\\s*(?:the\\s+|le\\s+|den\\s+|dia\\s+)?(?:\\d{1,2}(?![\\d:])|(?:${MONTH_ALT})(?![\\p{L}]))`, 'iu');
const DATE_BEFORE = new RegExp(`(?:\\d{1,2}\\.?|(?:${MONTH_ALT}))\\s*[,(]?\\s*$`, 'iu');

// ── THE TABLE ───────────────────────────────────────────────────────────────────────────────────
// Each entry: a pattern (case-insensitive, Unicode word boundaries added around it) and what it
// means — a day OFFSET from the composition day (exact → rewritable), or 'vague' (no single date).
type Meaning = number | 'vague' | ((m: RegExpExecArray) => number | 'vague' | null);
/** `overdue` (W19.A): the phrase is a DURATION PAST A DEADLINE ("nine days overdue") — its offset is
 *  the DEADLINE's day (composition day − N), and it is rewritten whole to "overdue since <date>". */
type Entry = { lang: TimeLang; re: string; mean: Meaning; frenchOnly?: boolean; overdue?: boolean };

const WD = (l: TimeLang) => WEEKDAYS[l].sort(byLength).join('|');
const NUM = { en: numAlt('en'), pt: numAlt('pt'), de: numAlt('de'), fr: numAlt('fr') };
const EN_QUAL = '(?:about|around|roughly|nearly|almost|over|more than|less than|under|just over|just under|some)';

const TABLE: Entry[] = [
  // ── EN · exact
  { lang: 'en', re: 'the day before yesterday', mean: -2 },
  { lang: 'en', re: 'the day after tomorrow', mean: 2 },
  { lang: 'en', re: '(?:yesterday|today|tonight|tomorrow)[\'’]s', mean: 'vague' },
  { lang: 'en', re: 'yesterday(?:\\s+(?:morning|afternoon|evening|night))?', mean: -1 },
  { lang: 'en', re: 'last night', mean: -1 },
  { lang: 'en', re: 'tomorrow(?:\\s+(?:morning|afternoon|evening|night))?', mean: 1 },
  { lang: 'en', re: '(?:earlier|later)\\s+today|today|tonight|this\\s+(?:morning|afternoon|evening)', mean: 0 },
  { lang: 'en', re: 'a day ago', mean: -1 },
  { lang: 'en', re: `${NUM.en}\\s+days?\\s+ago`, mean: (m) => { const n = numOf(m[1], 'en'); return n === null ? null : -n; } },
  { lang: 'en', re: `in\\s+${NUM.en}\\s+days`, mean: (m) => numOf(m[1], 'en') },
  // ── EN · vague
  { lang: 'en', re: `${EN_QUAL}\\s+(?:\\d{1,3}|[a-z-]+)\\s+days?\\s+ago`, mean: 'vague' },
  { lang: 'en', re: '(?:a couple of|a few|several|some|many)\\s+days\\s+ago', mean: 'vague' },
  { lang: 'en', re: `(?:${EN_QUAL}\\s+)?(?:a|an|${NUM.en.slice(1, -1)})\\s+(?:weeks?|months?|years?)\\s+ago|a fortnight ago`, mean: 'vague' },
  { lang: 'en', re: '(?:earlier|later)\\s+this\\s+(?:week|month|year)', mean: 'vague' },
  { lang: 'en', re: '(?:last|this|next|coming|past)\\s+(?:week|weekend|month|year)|over the weekend|the other day', mean: 'vague' },
  { lang: 'en', re: `in\\s+(?:a few|a couple of|${NUM.en.slice(1, -1)})\\s+(?:weeks|months)|in a week`, mean: 'vague' },
  { lang: 'en', re: `(?:last|this|next|coming)\\s+(?:${WD('en')})`, mean: 'vague' },
  { lang: 'en', re: `(?:${WD('en')})`, mean: 'vague' },

  // ── PT · exact
  { lang: 'pt', re: 'anteontem', mean: -2 },
  { lang: 'pt', re: 'depois de amanh[ãa]', mean: 2 },
  { lang: 'pt', re: 'ontem(?:\\s+(?:de manh[ãa]|[àa] tarde|[àa] noite))?', mean: -1 },
  { lang: 'pt', re: 'amanh[ãa](?:\\s+(?:de manh[ãa]|[àa] tarde|[àa] noite))?', mean: 1 },
  { lang: 'pt', re: 'hoje(?:\\s+(?:de manh[ãa]|[àa] tarde|[àa] noite))?|(?:esta|nesta)\\s+(?:manh[ãa]|tarde|noite)|logo [àa] noite', mean: 0 },
  { lang: 'pt', re: `(?:h[áa]|faz)\\s+${NUM.pt}\\s+dias?`, mean: (m) => { const n = numOf(m[1], 'pt'); return n === null ? null : -n; } },
  { lang: 'pt', re: `${NUM.pt}\\s+dias?\\s+atr[áa]s`, mean: (m) => { const n = numOf(m[1], 'pt'); return n === null ? null : -n; } },
  { lang: 'pt', re: `(?:daqui a|dentro de)\\s+${NUM.pt}\\s+dias?`, mean: (m) => numOf(m[1], 'pt') },
  // ── PT · vague
  { lang: 'pt', re: '(?:h[áa]|faz)\\s+(?:alguns|uns|poucos|v[áa]rios)\\s+dias|h[áa] dias|(?:no )?outro dia', mean: 'vague' },
  { lang: 'pt', re: `(?:h[áa]|faz)\\s+(?:uma|um|${NUM.pt.slice(1, -1)})\\s+(?:semanas?|m[eê]s(?:es)?|anos?)`, mean: 'vague' },
  { lang: 'pt', re: '(?:na |nesta |n?a )?semana (?:passada|que vem)|(?:na )?pr[óo]xima semana|(?:n)?esta semana', mean: 'vague' },
  { lang: 'pt', re: '(?:no |neste |este |n?o )?fim de semana|(?:no )?(?:m[êe]s|ano) passado|(?:n)?este (?:m[êe]s|ano)|(?:no )?pr[óo]ximo (?:m[êe]s|ano)|m[êe]s que vem', mean: 'vague' },
  { lang: 'pt', re: `(?:na |nesta |esta |na pr[óo]xima |pr[óo]xima |no pr[óo]ximo |pr[óo]ximo )(?:${WD('pt')})|(?:${WD('pt')})\\s+(?:passada|passado|que vem)`, mean: 'vague' },
  { lang: 'pt', re: `(?:${WD('pt')})`, mean: 'vague' },

  // ── DE · exact
  { lang: 'de', re: 'vorgestern', mean: -2 },
  { lang: 'de', re: '[üu]bermorgen|uebermorgen', mean: 2 },
  { lang: 'de', re: 'gestern(?:\\s+(?:morgen|fr[üu]h|vormittag|nachmittag|abend|nacht))?', mean: -1 },
  { lang: 'de', re: 'heute(?:\\s+(?:morgen|fr[üu]h|vormittag|nachmittag|abend|nacht))?', mean: 0 },
  // "morgen" = tomorrow; "(der|am|jeden|guten) Morgen" = the morning — the article decides.
  { lang: 'de', re: '(?<!(?:der|den|dem|am|jeden|jeder|guten|einen|einem|diesen|heute|gestern)\\s)morgen(?:\\s+(?:fr[üu]h|vormittag|nachmittag|abend))?', mean: 1 },
  { lang: 'de', re: `vor\\s+${NUM.de}\\s+tag(?:en)?`, mean: (m) => { const n = numOf(m[1], 'de'); return n === null ? null : -n; } },
  { lang: 'de', re: `in\\s+${NUM.de}\\s+tagen`, mean: (m) => numOf(m[1], 'de') },
  // ── DE · vague
  { lang: 'de', re: 'vor\\s+(?:ein paar|einigen|wenigen|mehreren)\\s+tagen|neulich|k[üu]rzlich', mean: 'vague' },
  { lang: 'de', re: `vor\\s+(?:einer|einem|${NUM.de.slice(1, -1)})\\s+(?:wochen?|monaten?|jahren?)`, mean: 'vague' },
  { lang: 'de', re: '(?:letzte|letzten|letzter|vergangene|vergangenen|diese|dieser|diesen|n[äa]chste|n[äa]chsten|naechste|naechsten|kommende|kommenden)\\s+(?:woche|monat|jahr|wochenende)|am wochenende', mean: 'vague' },
  { lang: 'de', re: `(?:letzten|n[äa]chsten|naechsten|diesen|kommenden|am)\\s+(?:${WD('de')})`, mean: 'vague' },
  { lang: 'de', re: `(?:${WD('de')})`, mean: 'vague' },

  // ── FR · exact
  { lang: 'fr', re: 'avant-hier', mean: -2 },
  { lang: 'fr', re: 'apr[èe]s-demain', mean: 2 },
  // "hier" is also German for "here" — French only when the text reads French.
  { lang: 'fr', re: 'hier(?:\\s+(?:matin|soir|apr[èe]s-midi))?', mean: -1, frenchOnly: true },
  { lang: 'fr', re: 'demain(?:\\s+(?:matin|soir|apr[èe]s-midi))?', mean: 1 },
  { lang: 'fr', re: 'aujourd[\'’]hui|ce matin|ce soir|cet apr[èe]s-midi|cette nuit', mean: 0 },
  { lang: 'fr', re: `il y a\\s+${NUM.fr}\\s+jours?`, mean: (m) => { const n = numOf(m[1], 'fr'); return n === null ? null : -n; } },
  { lang: 'fr', re: `dans\\s+${NUM.fr}\\s+jours`, mean: (m) => numOf(m[1], 'fr') },
  // ── FR · vague
  { lang: 'fr', re: 'il y a\\s+(?:quelques|plusieurs)\\s+jours|l[\'’]autre jour|r[ée]cemment', mean: 'vague' },
  { lang: 'fr', re: `il y a\\s+(?:une|un|${NUM.fr.slice(1, -1)})\\s+(?:semaines?|mois|ans?)`, mean: 'vague' },
  { lang: 'fr', re: 'la semaine (?:derni[èe]re|prochaine)|cette semaine|le mois (?:dernier|prochain)|ce mois-ci|(?:ce|le) week-end|l[\'’]ann[ée]e (?:derni[èe]re|prochaine)|cette ann[ée]e', mean: 'vague' },
  { lang: 'fr', re: `(?:${WD('fr')})\\s+(?:dernier|prochain)|ce\\s+(?:${WD('fr')})`, mean: 'vague' },
  { lang: 'fr', re: `(?:${WD('fr')})`, mean: 'vague', frenchOnly: true },

  // ── W19.A · OVERDUE COUNTS (TIME TRUTH, owner walk Sep 28). "Nine days overdue" is a DURATION computed
  // on the composition day — true that day, false every day after ("nine days past the deadline" was
  // still served ten days on). Exact counts are rewritten to the deadline's date ("overdue since
  // Sep 18"); a vague count ("several days late", "two weeks overdue") has no one date → withheld.
  // Longest-at-earliest wins (findRelativeTime), so a qualified count ("about 9 days late") reads vague.
  // ── EN · exact
  { lang: 'en', re: `(?:a|one)\\s+day\\s+(?:overdue|late|behind|past\\s+(?:the\\s+|its\\s+|their\\s+)?(?:deadline|due\\s+date)|past\\s+due)`, mean: -1, overdue: true },
  { lang: 'en', re: `${NUM.en}[- ]days?[- ](?:overdue|late|behind(?:\\s+schedule)?|past\\s+(?:the\\s+|its\\s+|their\\s+)?(?:deadline|due\\s+date)|past\\s+due)`, mean: (m) => { const n = numOf(m[1], 'en'); return n === null ? null : -n; }, overdue: true },
  { lang: 'en', re: `(?:overdue|late|behind)\\s+by\\s+${NUM.en}\\s+days?`, mean: (m) => { const n = numOf(m[1], 'en'); return n === null ? null : -n; }, overdue: true },
  // ── EN · vague
  { lang: 'en', re: `${EN_QUAL}\\s+(?:\\d{1,3}|[a-z-]+)\\s+days?\\s+(?:overdue|late|behind|past\\s+(?:the\\s+|its\\s+)?(?:deadline|due\\s+date)|past\\s+due)`, mean: 'vague', overdue: true },
  { lang: 'en', re: `(?:(?:a couple of|a few|several|some|many)\\s+days|(?:a|an|${NUM.en.slice(1, -1)})\\s+(?:weeks?|months?))\\s+(?:overdue|late|behind|past\\s+(?:the\\s+|its\\s+)?(?:deadline|due\\s+date)|past\\s+due)`, mean: 'vague', overdue: true },
  { lang: 'en', re: `(?:overdue|late|behind)\\s+by\\s+(?:(?:a couple of|a few|several|some|many)\\s+days|(?:a|an|${NUM.en.slice(1, -1)})\\s+(?:weeks?|months?))`, mean: 'vague', overdue: true },
  // ── PT · exact
  { lang: 'pt', re: `(?:com\\s+)?${NUM.pt}\\s+dias?\\s+(?:de\\s+atraso|em\\s+atraso|atrasad[oa]s?|(?:ap[óo]s|depois\\s+d)[oa]?\\s+(?:o\\s+)?prazo)`, mean: (m) => { const n = numOf(m[1], 'pt'); return n === null ? null : -n; }, overdue: true },
  { lang: 'pt', re: `(?:atrasad[oa]s?|em\\s+atraso)\\s+(?:h[áa]|por|faz)\\s+${NUM.pt}\\s+dias?`, mean: (m) => { const n = numOf(m[1], 'pt'); return n === null ? null : -n; }, overdue: true },
  // ── PT · vague
  { lang: 'pt', re: `(?:com\\s+)?(?:(?:v[áa]rios|alguns|uns|poucos|muitos)\\s+dias|(?:uma|um|${NUM.pt.slice(1, -1)})\\s+(?:semanas?|m[eê]s(?:es)?))\\s+(?:de\\s+atraso|em\\s+atraso|atrasad[oa]s?)`, mean: 'vague', overdue: true },
  // ── DE · exact
  { lang: 'de', re: `(?:seit\\s+|um\\s+)?${NUM.de}\\s+tag(?:e|en)?\\s+(?:[üu]berf[äa]llig|ueberfaellig|zu\\s+sp[äa]t|zu\\s+spaet|im\\s+verzug|in\\s+verzug|versp[äa]tet|nach\\s+(?:der|dem)\\s+(?:frist|termin|f[äa]lligkeit))`, mean: (m) => { const n = numOf(m[1], 'de'); return n === null ? null : -n; }, overdue: true },
  // ── DE · vague
  { lang: 'de', re: `(?:seit\\s+)?(?:(?:einige|einigen|ein paar|mehrere|mehreren|wenige|wenigen)\\s+tag(?:e|en)?|(?:einer|einem|${NUM.de.slice(1, -1)})\\s+(?:wochen?|monaten?))\\s+(?:[üu]berf[äa]llig|ueberfaellig|zu\\s+sp[äa]t|im\\s+verzug|versp[äa]tet)`, mean: 'vague', overdue: true },
  // ── FR · exact
  { lang: 'fr', re: `(?:avec\\s+)?${NUM.fr}\\s+jours?\\s+(?:de\\s+retard|en\\s+retard|apr[èe]s\\s+(?:l['’]\\s*[ée]ch[ée]ance|la\\s+date\\s+limite))`, mean: (m) => { const n = numOf(m[1], 'fr'); return n === null ? null : -n; }, overdue: true },
  { lang: 'fr', re: `(?:en\\s+)?retard\\s+de\\s+${NUM.fr}\\s+jours?`, mean: (m) => { const n = numOf(m[1], 'fr'); return n === null ? null : -n; }, overdue: true },
  // ── FR · vague
  { lang: 'fr', re: `(?:avec\\s+)?(?:(?:plusieurs|quelques)\\s+jours|(?:une|un|${NUM.fr.slice(1, -1)})\\s+(?:semaines?|mois))\\s+(?:de\\s+retard|en\\s+retard)`, mean: 'vague', overdue: true },
];

const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])(?!\\.[\\p{L}])';
const COMPILED = TABLE.map((e) => ({ ...e, rx: new RegExp(`${L}(?:${e.re})${R}`, 'giu') }));
const WEEKDAY_TAIL = new RegExp(`(?:^|\\s)(?:${Object.values(WEEKDAYS).flat().sort(byLength).join('|')})$`, 'iu');

/** A light language read — only to keep ambiguous words ("hier": French "yesterday", German "here")
 *  in their own language. Counts function words; ties read as not-French. */
export function readsFrench(text: string): boolean {
  const t = ` ${String(text).toLowerCase()} `;
  const count = (ws: string[]) => ws.reduce((n, w) => n + (t.split(` ${w} `).length - 1), 0);
  const fr = count(['le', 'la', 'les', 'des', 'est', 'vous', 'une', 'pour', 'avec', 'que', 'du', 'et', 'il', 'elle', 'a', 'envoyé', 'demandé']);
  const de = count(['der', 'die', 'das', 'und', 'ist', 'sie', 'nicht', 'mit', 'ein', 'eine', 'hat', 'ich', 'wir', 'zu']);
  return fr > de && fr >= 2;
}

export type RelativeSpan = {
  phrase: string; index: number; lang: TimeLang;
  /** Day offset from the composition day (exact → rewritable), or 'vague'. */
  offset: number | 'vague';
  /** W19.A — a count past a deadline ("nine days overdue"): `offset` is the DEADLINE's day. */
  overdue?: boolean;
};

/** Every relative-time expression in `text`, non-overlapping, left to right (longest wins). */
export function findRelativeTime(text: string | null | undefined): RelativeSpan[] {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  const french = readsFrench(s);
  const all: RelativeSpan[] = [];
  for (const e of COMPILED) {
    if (e.frenchOnly && !french) continue;
    e.rx.lastIndex = 0;
    for (let m = e.rx.exec(s); m; m = e.rx.exec(s)) {
      const phrase = m[0];
      const index = m.index;
      // A weekday standing beside an absolute date ("Thursday, Sep 24") is a label, not deixis.
      if (WEEKDAY_TAIL.test(phrase) && (DATE_AFTER.test(s.slice(index + phrase.length)) || DATE_BEFORE.test(s.slice(Math.max(0, index - 16), index)))) continue;
      const mean = typeof e.mean === 'function' ? e.mean(m) : e.mean;
      if (mean === null) continue;
      all.push({ phrase, index, lang: e.lang, offset: mean, ...(e.overdue ? { overdue: true } : {}) });
    }
  }
  all.sort((a, b) => a.index - b.index || b.phrase.length - a.phrase.length);
  const out: RelativeSpan[] = [];
  let end = -1;
  for (const sp of all) {
    if (sp.index < end) continue;
    out.push(sp);
    end = sp.index + sp.phrase.length;
  }
  return out;
}

/** Does the text carry any relative-time expression? (The gate's predicate.) */
export function hasRelativeTime(text: string | null | undefined): boolean {
  return findRelativeTime(text).length > 0;
}

// ── DAYS ────────────────────────────────────────────────────────────────────────────────────────

/** The LOCAL day (YYYY-MM-DD) of an instant in a zone — UTC when the zone is unknown or junk. */
export function localDayOf(at: Date | string | number, tz?: string | null): string | null {
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T12:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The absolute date in the phrase's own language ("Sep 24" · "24 de setembro" · "24. September" ·
 *  "24 septembre"); the year only when it is not the serving year. */
export function dateWords(day: string, lang: TimeLang, servingDay: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === servingDay.slice(0, 4);
  const y = day.slice(0, 4);
  const fmt = (locale: string, month: 'short' | 'long') => d.toLocaleDateString(locale, { day: 'numeric', month, timeZone: 'UTC' });
  if (lang === 'pt') return sameYear ? fmt('pt-PT', 'long') : `${fmt('pt-PT', 'long')} de ${y}`;
  if (lang === 'de') return sameYear ? fmt('de-DE', 'long') : `${fmt('de-DE', 'long')} ${y}`;
  if (lang === 'fr') return sameYear ? fmt('fr-FR', 'long') : `${fmt('fr-FR', 'long')} ${y}`;
  return sameYear ? fmt('en-US', 'short') : `${fmt('en-US', 'short')}, ${y}`;
}

/** The replacement for one exact span, fitted to the word before it ("since yesterday" → "since
 *  Sep 24", "yesterday" → "on Sep 24", "seit gestern" → "seit dem 24. September"). Returns the new
 *  head (the text before the span, possibly with its preposition adjusted) and the insert. */
function fitted(head: string, sp: RelativeSpan, day: string, servingDay: string): { head: string; insert: string } {
  const words = dateWords(day, sp.lang, servingDay);
  const prev = (/([\p{L}'’]+)\s+$/u.exec(head)?.[1] ?? '').toLowerCase();
  const starts = !head.trim() || /[.!?:]\s*$/.test(head);
  let insert: string;
  switch (sp.lang) {
    case 'pt':
      insert = ['desde', 'até', 'ate', 'de', 'para', 'a', 'em', 'no', 'na', 'antes', 'após', 'apos'].includes(prev) ? words : `em ${words}`;
      break;
    case 'de':
      if (['seit', 'ab', 'vor', 'nach'].includes(prev)) insert = `dem ${words}`;
      else if (prev === 'bis') insert = `zum ${words}`;
      else if (['am', 'zum', 'dem'].includes(prev)) insert = words;
      else insert = `am ${words}`;
      break;
    case 'fr':
      if (/jusqu['’]à$/.test(prev) || /jusqu['’]à\s+$/.test(head)) { head = head.replace(/jusqu(['’])à\s+$/i, 'jusqu$1au '); insert = words; }
      else insert = ['le', 'au', 'du'].includes(prev) ? words : `le ${words}`;
      break;
    default:
      insert = ['since', 'until', 'till', 'by', 'before', 'after', 'from', 'through', 'on', 'of'].includes(prev) ? words : `on ${words}`;
  }
  if (starts) insert = insert.charAt(0).toUpperCase() + insert.slice(1);
  return { head, insert };
}

/** W19.A — an overdue count, rewritten whole to the deadline's date in the phrase's own language
 *  ("nine days overdue" → "overdue since Sep 18" · "em atraso desde 18 de setembro" · "überfällig seit
 *  dem 18. September" · "en retard depuis le 18 septembre"). */
function overdueWords(head: string, sp: RelativeSpan, day: string, servingDay: string): { head: string; insert: string } {
  const words = dateWords(day, sp.lang, servingDay);
  const starts = !head.trim() || /[.!?:]\s*$/.test(head);
  // The count's own verb ("a 4 jours de retard", "tem 9 dias de atraso") becomes the state verb.
  if (sp.lang === 'fr') head = head.replace(/(^|\s)(a|ont|avait|avaient)\s+$/iu, (_m, pre: string, v: string) => `${pre}${({ a: 'est', ont: 'sont', avait: 'était', avaient: 'étaient' } as Record<string, string>)[v.toLowerCase()]} `);
  if (sp.lang === 'pt') head = head.replace(/(^|\s)(tem|têm|tinha)\s+$/iu, (_m, pre: string, v: string) => `${pre}${({ tem: 'está', 'têm': 'estão', tinha: 'estava' } as Record<string, string>)[v.toLowerCase()]} `);
  const insert = sp.lang === 'pt' ? `em atraso desde ${words}`
    : sp.lang === 'de' ? `überfällig seit dem ${words}`
      : sp.lang === 'fr' ? `en retard depuis le ${words}`
        : `overdue since ${words}`;
  return { head, insert: starts ? insert.charAt(0).toUpperCase() + insert.slice(1) : insert };
}

function rewriteExact(text: string, spans: RelativeSpan[], composeDay: string, servingDay: string): { text: string; rewritten: string[] } {
  let out = text;
  const rewritten: string[] = [];
  for (const sp of [...spans].reverse()) {
    if (sp.offset === 'vague') continue;
    const day = addDays(composeDay, sp.offset);
    if (sp.overdue) {
      const { head, insert } = overdueWords(out.slice(0, sp.index), sp, day, servingDay);
      out = head + insert + out.slice(sp.index + sp.phrase.length);
      rewritten.push(`${sp.phrase} → ${insert}`);
      continue;
    }
    const { head, insert } = fitted(out.slice(0, sp.index), sp, day, servingDay);
    out = head + insert + out.slice(sp.index + sp.phrase.length);
    rewritten.push(`${sp.phrase} → ${insert}`);
  }
  return { text: out, rewritten: rewritten.reverse() };
}

export type TimeWordsVerdict = {
  /** What may be served: the text (exact relative words rewritten to dates), or the original when withheld. */
  text: string;
  /** True → do NOT serve this sentence (a vague relative expression, or no known composition day). */
  withheld: boolean;
  rewritten: string[];
  /** The phrases that forced the withhold. */
  vague: string[];
};

/**
 * THE SERVE FLOOR (zero AI, pure). `composedAt` is the stored composition's own timestamp; `now`
 * and `tz` fix the serving day in the user's zone. Same local day → unchanged (the words are true).
 */
export function serveTimeWords(
  text: string | null | undefined,
  anchor: { composedAt: string | null | undefined; now?: Date; tz?: string | null },
): TimeWordsVerdict {
  const s = String(text ?? '');
  const spans = findRelativeTime(s);
  if (!spans.length) return { text: s, withheld: false, rewritten: [], vague: [] };
  const servingDay = localDayOf(anchor.now ?? new Date(), anchor.tz) ?? new Date().toISOString().slice(0, 10);
  const composeDay = anchor.composedAt ? localDayOf(anchor.composedAt, anchor.tz) : null;
  if (!composeDay) return { text: s, withheld: true, rewritten: [], vague: spans.map((x) => x.phrase) };
  if (composeDay >= servingDay) return { text: s, withheld: false, rewritten: [], vague: [] };
  const vague = spans.filter((x) => x.offset === 'vague').map((x) => x.phrase);
  if (vague.length) return { text: s, withheld: true, rewritten: [], vague };
  const r = rewriteExact(s, spans, composeDay, servingDay);
  return { text: r.text, withheld: false, rewritten: r.rewritten, vague: [] };
}

/**
 * THE COMPOSE-TIME BELT: rewrite every EXACT relative word to its absolute date against the
 * composition day, so the stored text is already stable. Vague expressions are left standing (there
 * is no one date to write) — the serve floor withholds them once their day has passed.
 */
export function absolutizeTimeWords(
  text: string | null | undefined, anchor: { now?: Date; tz?: string | null },
): { text: string; rewritten: string[] } {
  const s = String(text ?? '');
  const spans = findRelativeTime(s);
  if (!spans.some((x) => x.offset !== 'vague')) return { text: s, rewritten: [] };
  const day = localDayOf(anchor.now ?? new Date(), anchor.tz) ?? new Date().toISOString().slice(0, 10);
  return rewriteExact(s, spans, day, day);
}
