// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WEEKDAY FLOOR (Wave 1, Sep 18 — the arithmetic-floor doctrine reaching the chat lane;
// THE ANCHOR LAW added Sep 21 after the floor LAUNDERED a wrong answer, see below).
//
// THE FIRST INCIDENT: the chat proposed three meeting slots and got the weekday↔date pair wrong on
// ALL THREE ("Tuesday, September 24" — that date is a Thursday). A weekday is not an opinion; it is
// arithmetic over a date, which means it is CODE's answer and never the model's. lib/prepare/
// verify-claims.ts already owns this law for produced documents (one reasoned extraction + a code
// recompute); the chat lane had no such door, so the same class shipped straight to the user.
//
// THE SECOND INCIDENT (Sep 21, a live pilot): the user asked for "either thursday or friday". The
// model miscounted the dates and wrote "Thursday 25 or Friday 26" — and this floor, holding the
// date sacred, dutifully rewrote the WEEKDAYS to "Friday 25 or Saturday 26". A floor built to stop
// a lie had turned a visible arithmetic error into a confident, internally consistent WRONG answer,
// about to offer a client a Saturday nobody asked for. The premise was wrong: the date is the
// anchor only when the date is the thing the user gave us.
//
// THE PRECEDENCE CHAIN (the law, in order — the first branch that applies wins):
//   1. THE USER'S STATED WEEKDAY OUTRANKS THE MODEL'S DERIVED DATE. When the user's own recent
//      words name that weekday and name no such day-number, the DATE moves to the nearest date
//      carrying the weekday the user asked for. The user said Thursday; Thursday is the fact.
//   2. ELSE THE DATE IS THE ANCHOR, the weekday the derived fact — the original law. Nothing in
//      the user's words picks a side, so the date (which the rest of the sentence and the calendar
//      hang on) stands and the WEEKDAY WORD is replaced.
//   3. ELSE UNTOUCHED. Most of all when the user stated BOTH a weekday and a disagreeing date:
//      that contradiction belongs to the user to resolve, and a floor that silently picks one half
//      of it is guessing with the user's meeting.
//
// THE STANDING LAWS:
//   • ZERO AI, pure, deterministic, and ONLY fully-resolved unambiguous pairs. Anything uncertain —
//     an unknown month, an impossible day, a bare weekday with no date, a day-number that could be
//     a clock hour — passes through untouched. A floor that guesses is a floor that corrupts; a
//     missed catch is survivable, a false rewrite is not.
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
/** The full name we WRITE when a correction moves a date across a month boundary. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A date more than this far in the past, written with no year, is read as NEXT year — people write
 *  "Tuesday, 24 September" about the coming one, not the one that already went by. */
const PAST_TOLERANCE_DAYS = 45;
const DAY_MS = 86_400_000;

/** THE MONTHLESS HORIZON — how far ahead a bare "Thursday 25" is allowed to be resolved. */
const MONTHLESS_HORIZON_DAYS = 45;
/** …and the two conditions that make such a shape UNAMBIGUOUS: its first candidate is near-term,
 *  and the next candidate carrying the same day-number is a clear month away. Otherwise the floor
 *  refuses — "Monday 20" three weeks out is a coin flip between two months, and a floor does not
 *  flip coins. */
const MONTHLESS_NEAR_DAYS = 14;
const MONTHLESS_MIN_GAP_DAYS = 14;
/** A correction that would move a date further than this is not a miscount, it is a different day —
 *  the floor leaves it alone. (The nearest date carrying a given weekday is never more than 3 days
 *  away, so this is a belt-and-braces ceiling, stated so the refusal is legible.) */
const MAX_DATE_SHIFT_DAYS = 6;

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
const WEEKDAY_ALT_FLAT = [...new Set(Object.keys(WEEKDAYS).map(deaccent))].sort((a, b) => b.length - a.length).join('|');
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
// "Weekday[,] D[ Month][ Year]" · "Weekday[,] Month D[, Year]" — the shapes chat actually writes.
// The month is OPTIONAL in the first branch: "Thursday 25 or Friday 26" is the exact shape the
// second incident shipped, and it parsed as nothing at all. `(?![:\d])` keeps a clock time out —
// "Monday 10:00" is an hour, not the tenth.
const PAIR_SRC =
  `\\b(?<wd>${WEEKDAY_ALT})\\b(?<sep>,?\\s+)` +
  `(?:(?<d1>\\d{1,2})(?<ord1>st|nd|rd|th)?(?![:\\d])(?:\\s+(?<m1>${MONTH_ALT})\\b\\.?)?` +
  `|(?<m2>${MONTH_ALT})\\b\\.?\\s+(?<d2>\\d{1,2})(?<ord2>st|nd|rd|th)?(?![:\\d]))` +
  `(?:\\s*,?\\s*(?<yr>\\d{4})\\b)?`;

/** Words that may legitimately follow a bare day-number in scheduling prose. Anything else ("Friday
 *  15 people attended") means the number was never a date, and the floor keeps its hands off. */
const MONTHLESS_TAIL_RE = new RegExp(
  `^(?:\\s*(?:$|[,.;:!?)\\]–—-]|\\b(?:or|and|at|to|ou|e|as|um|und|oder|bis|et|à|a|vers|no|na|em|de|for|from)\\b))`,
  'i',
);

/** Casing style of the word we are replacing — a capitalized weekday stays capitalized, a lowercase
 *  one (the normal register in PT/FR) stays lowercase. */
const matchCase = (original: string, replacement: string) =>
  /^[A-ZÀ-Þ]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement.toLowerCase();

/** The nearest calendar date carrying `idx` — at most three days from `fromMs` (UTC noon anchored). */
function nearestWithWeekday(fromMs: number, idx: number): number {
  const cur = new Date(fromMs).getUTCDay();
  const fwd = (idx - cur + 7) % 7;
  const delta = fwd <= 3 ? fwd : fwd - 7;
  return fromMs + delta * DAY_MS;
}

/** What the USER themselves put on the table: the weekdays they named, and the day-numbers they
 *  named. Deliberately OVER-eager about numbers (every bare 1–2 digit token counts, clock times
 *  stripped first) — an over-read number only ever makes the floor keep its hands off. */
function readUserClaims(userText: string | undefined): { weekdays: Set<number>; days: Set<number> } {
  const weekdays = new Set<number>();
  const days = new Set<number>();
  if (!userText) return { weekdays, days };
  const flat = deaccent(userText);
  for (const m of flat.matchAll(new RegExp(`\\b(${WEEKDAY_ALT_FLAT})\\b`, 'g'))) {
    const idx = WEEKDAYS[m[1]];
    if (idx !== undefined) weekdays.add(idx);
  }
  // Times are not dates: "friday at 10:00" states no day-number.
  const noTimes = flat.replace(/\b\d{1,2}[:h]\d{2}\b/g, ' ');
  // The ordinal suffix is part of the number, not a word after it — "the 25th" states the 25th.
  for (const m of noTimes.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)) days.add(Number(m[1]));
  return { weekdays, days };
}

/**
 * Correct every resolvable weekday↔date pair in `text`. Pure, deterministic, zero-AI.
 * `opts.now` anchors the unstated-year and monthless resolution (defaults to the real clock).
 * `opts.userText` is the user's OWN recent words — the current ask plus recent user turns; the
 * caller assembles it, because only the caller knows which words in the room belong to the user.
 * With no `userText` the floor behaves exactly as it did before the anchor law: date-anchored.
 */
export function enforceWeekdayDatePairs(text: string, opts: { now?: Date; userText?: string } = {}): string {
  if (!text || !/\d/.test(text)) return text;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const currentYear = Number(new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'UTC' }).format(now));
  const todayMs = Date.UTC(
    currentYear,
    Number(new Intl.DateTimeFormat('en-GB', { month: 'numeric', timeZone: 'UTC' }).format(now)) - 1,
    Number(new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' }).format(now)),
    12,
  );
  const claims = readUserClaims(opts.userText);

  const re = new RegExp(PAIR_SRC, 'gid');
  let out = '';
  let cursor = 0;

  for (const m of text.matchAll(re)) {
    const whole = m[0];
    const at = m.index ?? 0;
    const g = m.groups ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spans = ((m as any).indices?.groups ?? {}) as Record<string, [number, number] | undefined>;
    const rewritten = decide();
    out += text.slice(cursor, at) + (rewritten ?? whole);
    cursor = at + whole.length;

    function decide(): string | null {
      const wd = String(g.wd || '');
      const statedIdx = WEEKDAYS[deaccent(wd)] ?? WEEKDAYS[wd.toLowerCase()];
      if (statedIdx === undefined) return null;
      const dayTok = g.d1 ?? g.d2;
      const dayNum = Number(dayTok);
      if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return null;
      const monthTok = g.m1 ?? g.m2;
      const yr = g.yr ? Number(g.yr) : null;

      let month: number;
      let year: number;
      if (monthTok) {
        const mi = MONTHS[String(monthTok).toLowerCase()];
        if (mi === undefined) return null;
        month = mi;
        year = yr ?? currentYear;
        if (yr === null) {
          // Unstated year: this year, rolled forward when that reading already went by.
          if (Date.UTC(year, month, dayNum, 12) < nowMs - PAST_TOLERANCE_DAYS * DAY_MS) year += 1;
        }
      } else {
        // THE MONTHLESS SHAPE — "Thursday 25". Resolvable only when the prose around it reads like
        // a date and exactly one near-term calendar date carries that day-number (see the
        // horizon constants). Everything else passes through.
        if (yr !== null) return null;                      // "Thursday 25 2026" is not a shape we read
        const tail = text.slice(at + whole.length);
        if (!MONTHLESS_TAIL_RE.test(tail)) return null;
        const resolved = resolveMonthless(dayNum, todayMs);
        if (!resolved) return null;
        month = resolved.month;
        year = resolved.year;
      }

      const d = new Date(Date.UTC(year, month, dayNum, 12));
      // Round-trip: a day the month does not have (31 September, 30 February) is NOT a parsed pair.
      if (d.getUTCMonth() !== month || d.getUTCDate() !== dayNum) return null;
      const trueIdx = d.getUTCDay();
      if (statedIdx === trueIdx) return null;              // already true — never touched

      // ── THE PRECEDENCE CHAIN ────────────────────────────────────────────────────────────────
      const userSaidWeekday = claims.weekdays.has(statedIdx);
      const userSaidThisDay = claims.days.has(dayNum);
      if (userSaidWeekday && userSaidThisDay) return null;  // (3) the contradiction is the user's
      if (userSaidWeekday) {
        // (1) the user's weekday outranks the model's arithmetic — move the DATE.
        const target = nearestWithWeekday(d.getTime(), statedIdx);
        if (Math.abs(target - d.getTime()) > MAX_DATE_SHIFT_DAYS * DAY_MS) return null;
        const t = new Date(target);
        if (yr !== null && t.getUTCFullYear() !== year) return null;   // a written year we will not rewrite
        if (!monthTok && t.getUTCMonth() !== month) return null;       // a bare number cannot change months
        return rewriteDate(t);
      }
      // (2) the original law: the date stands, the weekday word is corrected.
      const correct = DAY_NAMES[langOf(wd)][trueIdx];
      const wdSpan = spans.wd;
      if (!wdSpan) return null;
      return whole.slice(0, wdSpan[0] - at) + matchCase(wd, correct) + whole.slice(wdSpan[1] - at);
    }

    /** Write `target` back into the matched text, touching only the day-number (and the month name
     *  when the correction genuinely crosses a boundary). */
    function rewriteDate(target: Date): string | null {
      const daySpan = spans.d1 ?? spans.d2;
      if (!daySpan) return null;
      const edits: Array<{ span: [number, number]; text: string }> = [
        { span: daySpan, text: String(target.getUTCDate()) },
      ];
      const monthSpan = spans.m1 ?? spans.m2;
      const monthTok = g.m1 ?? g.m2;
      if (monthSpan && monthTok) {
        const written = MONTHS[String(monthTok).toLowerCase()];
        if (written !== target.getUTCMonth()) {
          const full = MONTH_NAMES[target.getUTCMonth()];
          // An abbreviation stays an abbreviation; the casing of the original is kept.
          const name = monthTok.length <= 4 ? full.slice(0, 3) : full;
          edits.push({ span: monthSpan, text: matchCase(monthTok, name) });
        }
      }
      let res = whole;
      for (const e of edits.sort((a, b) => b.span[0] - a.span[0])) {
        res = res.slice(0, e.span[0] - at) + e.text + res.slice(e.span[1] - at);
      }
      return res;
    }
  }

  return out + text.slice(cursor);
}

/** The one near-term calendar date carrying `dayNum`, or null when the answer is not unique.
 *  Anchored at UTC noon of today. */
function resolveMonthless(dayNum: number, todayMs: number): { month: number; year: number } | null {
  const hits: Array<{ ms: number; month: number; year: number }> = [];
  for (let i = 0; i <= MONTHLESS_HORIZON_DAYS; i++) {
    const ms = todayMs + i * DAY_MS;
    const d = new Date(ms);
    if (d.getUTCDate() === dayNum) hits.push({ ms, month: d.getUTCMonth(), year: d.getUTCFullYear() });
  }
  if (!hits.length) return null;
  const first = hits[0];
  if (first.ms - todayMs > MONTHLESS_NEAR_DAYS * DAY_MS) return null;
  if (hits.length > 1 && hits[1].ms - first.ms < MONTHLESS_MIN_GAP_DAYS * DAY_MS) return null;
  return { month: first.month, year: first.year };
}
