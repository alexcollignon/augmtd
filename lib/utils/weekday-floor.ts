// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WEEKDAY FLOOR (Wave 1, Sep 18 — the arithmetic-floor doctrine reaching the chat lane).
//
// THE INCIDENT: the chat proposed three meeting slots and got the weekday↔date pair wrong on ALL
// THREE ("Tuesday, September 24" — that date is a Thursday). A weekday is not an opinion; it is
// arithmetic over a date, which means it is CODE's answer and never the model's. lib/prepare/
// verify-claims.ts already owns this law for produced documents (one reasoned extraction + a code
// recompute); the chat lane had no such door, so the same class shipped straight to the user.
//
// THE LAWS HERE:
//   • THE DATE IS THE ANCHOR, the weekday the derived fact. When they disagree, the WEEKDAY WORD is
//     replaced — never the date (the date is what the rest of the sentence, and the calendar, hangs on).
//   • ZERO AI, and ONLY fully-parsed unambiguous pairs. Anything uncertain — an unknown month, an
//     impossible day, a bare weekday with no date — passes through untouched. A floor that guesses
//     is a floor that corrupts; a missed catch is survivable, a false rewrite is not.
//   • THE ANSWER STAYS IN ITS OWN LANGUAGE: a wrong Portuguese weekday is corrected to the right
//     PORTUGUESE weekday. The floor fixes a fact, it never translates the user's chat.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { WEEKDAYS } from '@/lib/prepare/verify-claims';

/** The correct name to WRITE, per language. Recognition rides verify-claims' shared table; only
 *  the output vocabulary lives here (a name we emit must be spelled properly, accents included). */
const DAY_NAMES: Record<string, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  pt: ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
};

/** Month names the floor will parse — EN only by design: a date it cannot read with certainty is a
 *  date it must not touch, and mixed-language month vocabularies are exactly where certainty ends. */
const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
  june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

/** A date more than this far in the past, written with no year, is read as NEXT year — people write
 *  "Tuesday, 24 September" about the coming one, not the one that already went by. */
const PAST_TOLERANCE_DAYS = 45;
const DAY_MS = 86_400_000;

const deaccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Which language did the WRITER use? Matched against the output vocabulary, so the correction is
 *  emitted in the same tongue (falls back to English — the platform's own default voice). */
function langOf(matchedWeekday: string): string {
  const k = deaccent(matchedWeekday);
  for (const [lang, names] of Object.entries(DAY_NAMES)) {
    if (names.some((n) => { const d = deaccent(n); return d === k || d.startsWith(k) || k.startsWith(d); })) return lang;
  }
  return 'en';
}

// Longest-first so "segunda-feira" is never matched as the bare "segunda" with a dangling tail.
const WEEKDAY_ALT = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
// "Weekday[,] D Month[ Year]" · "Weekday[,] Month D[, Year]" — the two shapes chat actually writes.
const PAIR_RE = new RegExp(
  `\\b(${WEEKDAY_ALT})\\b(,?\\s+)(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?|(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?)` +
  `(\\s*,?\\s*(\\d{4}))?\\b`,
  'gi',
);

/** Casing style of the word we are replacing — a capitalized weekday stays capitalized, a lowercase
 *  one (the normal register in PT/FR) stays lowercase. */
const matchCase = (original: string, replacement: string) =>
  /^[A-ZÀ-Þ]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement.toLowerCase();

/**
 * Correct every fully-parsed weekday↔date pair in `text`. Pure, deterministic, zero-AI.
 * `opts.now` anchors the unstated-year resolution (defaults to the real clock).
 */
export function enforceWeekdayDatePairs(text: string, opts: { now?: Date } = {}): string {
  if (!text || !/\d/.test(text)) return text;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const currentYear = Number(new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'UTC' }).format(now));
  return text.replace(PAIR_RE, (whole, wd: string, sep: string, dA: string, mA: string, mB: string, dB: string, _yTail: string, yr: string) => {
    const monthKey = String(mA || mB || '').toLowerCase();
    const month = MONTHS[monthKey];
    const dayNum = Number(dA || dB);
    if (month === undefined || !Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return whole;
    // Year: as stated, else the current one — rolled forward when that reading already went by.
    let year = yr ? Number(yr) : currentYear;
    if (!yr) {
      const probe = Date.UTC(year, month, dayNum, 12);
      if (probe < nowMs - PAST_TOLERANCE_DAYS * DAY_MS) year += 1;
    }
    // UTC noon: a calendar date's weekday is timezone-independent, and noon is far from every boundary.
    const d = new Date(Date.UTC(year, month, dayNum, 12));
    // Round-trip: a day the month does not have (31 September, 30 February) is NOT a parsed pair.
    if (d.getUTCMonth() !== month || d.getUTCDate() !== dayNum) return whole;
    const statedIdx = WEEKDAYS[deaccent(wd)] ?? WEEKDAYS[wd.toLowerCase()];
    if (statedIdx === undefined) return whole;
    const trueIdx = d.getUTCDay();
    if (statedIdx === trueIdx) return whole;          // already true — never touched
    const correct = DAY_NAMES[langOf(wd)][trueIdx];
    return matchCase(wd, correct) + whole.slice(wd.length);
  });
}
