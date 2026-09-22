// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE WINDOWED CALENDAR READ (Wave 1, Sep 18 — the chat lane gets a calendar).
//
// THE INCIDENT THIS CLOSES (census-verified on a pilot account): the Home chat was asked to check
// the calendar before replying and answered "you're free both weeks" over TWELVE confirmed events,
// then proposed three slots — two of them INSIDE a four-day all-day away block. The chat lane's only
// calendar read was today-schedule.ts, which sees TODAY and nothing else, so "free both weeks" was
// not a hallucination about the data: it was an honest report of an empty context. A prompt that
// claims reach it does not have is an instruction to confabulate.
//
// So there is ONE windowed read, and BOTH consumers (the brain snapshot and the chat's own
// check_calendar verb) drink from it — no second query, no second rendering, no drift.
//
// TWO LAWS THE INCIDENT WROTE:
//   • THE OVERLAP LAW — a block already IN PROGRESS at the window's start is busy. The four-day
//     away block's start_time predated the query floor, so a `.gte('start_time', floor)` read
//     simply did not see it. Candidacy is a code-side overlap test, never a start-time floor.
//   • WEEKDAYS ARE CODE'S OUTPUT — every weekday label and every clock time here is computed with
//     Intl in the USER'S zone. The model relays them; it never derives them (it said "Tuesday,
//     September 24" for a Thursday, three times out of three).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { zonedTimeToUtc, type BusyBlock } from '@/lib/prepare/free-slots';

const DAY_MS = 86_400_000;
/** Nothing sane spans longer; the bound keeps the lookback query cheap. */
const LOOKBACK_DAYS = 14;
/** A row with no end_time is treated as this long (same assumption the slot picker makes). */
const DEFAULT_MINUTES = 60;
/** A hard iteration ceiling so a malformed window can never walk the calendar forever. */
const MAX_DAYS = 120;

export type WindowBusy = {
  start: string; end: string; title: string; allDay: boolean;
  /** THE DOOR'S HALF (Wave 1, Sep 22 — the collection card): the row's own event id and its real
   *  instants, so a rendered day can open its event and a verb can name it. Never rendered, never
   *  read by the prompt block (which stays exactly the clamped clock labels above) — additive by
   *  construction, so nothing that reads a busy block today changes. */
  id?: string;
  startISO?: string;
  endISO?: string;
};
export type WindowDay = { dayStr: string; weekday: string; busy: WindowBusy[] };
export type ScheduleWindow = {
  days: WindowDay[];
  /** The same events as raw ms blocks — so the slot picker proposes against the SAME busy set the
   *  prompt block shows (one read, one truth: a proposal can never collide with a line we printed). */
  busyBlocks: BusyBlock[];
  tz: string;
  /** THE EMPTY-CALENDAR TRUTH: an account with NO calendar rows at all (never synced, or the read
   *  failed) must render as UNKNOWN, never as a fortnight of "free" lines — an empty table is not
   *  an empty diary. True when the user has ANY calendar event on record, in-window or not. */
  hasCalendar: boolean;
};

/** The user's home timezone = the mode of their events' zones. THE ONE DERIVATION — today-schedule
 *  imported this from here rather than keeping its own copy, so the day boundary is the same day
 *  boundary everywhere. */
export async function userTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await supabase.from('calendar_events').select('timezone').eq('user_id', userId).not('timezone', 'is', null).limit(300);
    const freq = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ timezone: string | null }>) if (r.timezone) freq.set(r.timezone, (freq.get(r.timezone) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UTC';
  } catch { return 'UTC'; }
}

/** Add whole days to a YYYY-MM-DD (calendar arithmetic only — no zone involved). */
const addDays = (dateStr: string, n: number): string =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The weekday of a calendar date — timezone-INDEPENDENT (a date's weekday is a property of the
 *  date, not of where you stand), so it is computed at UTC noon, away from every boundary. */
export const weekdayOf = (dayStr: string): string => {
  try { return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${dayStr}T12:00:00Z`)); }
  catch { return ''; }
};

/** "24 Sep" — the day label, likewise date-only and therefore zone-free. */
const dayLabel = (dayStr: string): string => {
  try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${dayStr}T12:00:00Z`)); }
  catch { return dayStr; }
};

const clockIn = (ms: number, tz: string): string => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(ms)); }
  catch { return '00:00'; }
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** All-day is the FLAG or the shape (a bare date string can be nothing else) — the flag is absent
 *  on some legacy rows, and the shape is the fact that never lies. */
const isAllDayRow = (flag: boolean | null | undefined, start: string, end: string | null): boolean =>
  flag === true || (DATE_ONLY_RE.test(String(start ?? '')) && (!end || DATE_ONLY_RE.test(String(end))));

/** THE CALENDAR DAY AN ALL-DAY BOUNDARY NAMES. A bare date says its day outright. Anything else is
 *  a midnight recorded in the EVENT'S OWN zone (Graph writes UTC midnight; a locally-zoned row
 *  writes local midnight), so it is read there — never in the viewer's zone, which is precisely the
 *  reading that slid the same away block a day earlier in New York and a day later in Lisbon. */
const allDayBoundary = (v: string | null | undefined, evTz: string): string | null => {
  const raw = String(v ?? '');
  if (!raw) return null;
  if (DATE_ONLY_RE.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: evTz }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
};

const clipTitle = (t: string) => { const s = String(t || '(untitled)').replace(/\s+/g, ' ').trim(); return s.length > 40 ? `${s.slice(0, 39)}…` : s; };

/**
 * THE READ — every day in [fromDayStr, toDayStr] with its weekday and everything busy on it.
 * A multi-day block appears on EVERY day it covers, marked allDay. Non-fatal: an unreadable
 * calendar yields days with no busy blocks, never a thrown answer (but see renderCalendarWindow —
 * the block always states its own reach, so "nothing here" can never read as "free forever").
 */
export async function getScheduleWindow(
  supabase: SupabaseClient, userId: string,
  opts: { fromDayStr: string; toDayStr: string; tz: string },
): Promise<ScheduleWindow> {
  const tz = opts.tz || 'UTC';
  const from = opts.fromDayStr;
  const to = opts.toDayStr < from ? from : opts.toDayStr;
  const winStart = zonedTimeToUtc(from, '00:00', tz);
  const winEnd = zonedTimeToUtc(addDays(to, 1), '00:00', tz);

  const busyBlocks: BusyBlock[] = [];
  const events: Array<{ id: string; startMs: number; endMs: number; title: string; allDay: boolean; dayFrom?: string; dayToExcl?: string }> = [];
  let hasCalendar = false;
  try {
    const { data } = await supabase.from('calendar_events')
      // EXPLICIT select (the silent-column law: a bad column returns data:null and no error).
      .select('id, title, start_time, end_time, is_all_day, status, timezone')
      .eq('user_id', userId)
      // Cancelled/declined events are NOT busy — parity with today-schedule.ts.
      .eq('status', 'confirmed')
      // THE OVERLAP LAW: the query bounds only the START (bounded lookback so it stays cheap); the
      // real candidacy test is the overlap below, which is what catches an in-progress block.
      .gte('start_time', new Date(winStart - LOOKBACK_DAYS * DAY_MS).toISOString())
      .lte('start_time', new Date(winEnd).toISOString())
      .order('start_time', { ascending: true }).limit(400);
    for (const e of (data ?? []) as Array<{ id: string; title: string | null; start_time: string; end_time: string | null; is_all_day: boolean | null; timezone: string | null }>) {
      const title = clipTitle(String(e.title || ''));
      const id = String(e.id ?? '');
      // ── THE ALL-DAY LAW (Sep 21) — AN ALL-DAY EVENT IS CALENDAR DAYS, NOT AN INSTANT. Both
      // providers write an all-day block as a date pair with an EXCLUSIVE end (Sep 24 → Sep 28
      // means Thu–Sun), and both anchor it at midnight. Read as instants, that midnight lands on
      // the PREVIOUS local day west of UTC and bleeds an hour into the day AFTER east of it — so
      // the same away block reported one day early in New York and one day late in Lisbon. The
      // day span is taken from the DATE STRINGS, which carry no zone and therefore cannot shift;
      // the ms block the slot picker reads is then rebuilt on the user's own midnights.
      const allDay = isAllDayRow(e.is_all_day, e.start_time, e.end_time);
      if (allDay) {
        const evTz = e.timezone || tz;
        const dayFrom = allDayBoundary(e.start_time, evTz);
        if (!dayFrom) continue;
        let dayToExcl = allDayBoundary(e.end_time, evTz) ?? '';
        // A same-day (or missing) end is an INCLUSIVE one-day block — never an empty span.
        if (!dayToExcl || dayToExcl <= dayFrom) dayToExcl = addDays(dayFrom, 1);
        const s = zonedTimeToUtc(dayFrom, '00:00', tz);
        const en = zonedTimeToUtc(dayToExcl, '00:00', tz);
        if (!Number.isFinite(s) || !Number.isFinite(en) || en <= winStart || s >= winEnd) continue;
        events.push({ id, startMs: s, endMs: en, title, allDay: true, dayFrom, dayToExcl });
        busyBlocks.push({ startMs: s, endMs: en });
        continue;
      }
      const s = Date.parse(String(e.start_time));
      if (Number.isNaN(s)) continue;
      const parsedEnd = e.end_time ? Date.parse(String(e.end_time)) : NaN;
      const en = Number.isNaN(parsedEnd) ? s + DEFAULT_MINUTES * 60_000 : parsedEnd;
      if (en <= winStart || s >= winEnd) continue;   // no overlap with the asked window
      events.push({ id, startMs: s, endMs: en, title, allDay: false });
      busyBlocks.push({ startMs: s, endMs: en });
    }
    // In-window events prove a calendar; an empty window needs the cheap existence probe — a user
    // whose fortnight is genuinely clear (but who HAS a calendar) may honestly read "free".
    if (events.length > 0) hasCalendar = true;
    else {
      const { data: any1 } = await supabase.from('calendar_events').select('id').eq('user_id', userId).limit(1);
      hasCalendar = (any1 ?? []).length > 0;
    }
  } catch { /* an unreadable calendar is an UNKNOWN one — hasCalendar stays false and the render says so */ }

  const days: WindowDay[] = [];
  let day = from;
  for (let i = 0; i < MAX_DAYS; i++) {
    const dayStart = zonedTimeToUtc(day, '00:00', tz);
    const dayEnd = zonedTimeToUtc(addDays(day, 1), '00:00', tz);
    const busy: WindowBusy[] = events
      // An all-day block covers exactly the calendar days it names (end EXCLUSIVE); everything
      // else is an overlap test in real time.
      .filter((e) => (e.dayFrom && e.dayToExcl)
        ? (day >= e.dayFrom && day < e.dayToExcl)
        : (e.startMs < dayEnd && e.endMs > dayStart))
      .map((e) => ({
        // Clamped to the day, so a multi-day block reads honestly on each of its days.
        start: clockIn(Math.max(e.startMs, dayStart), tz),
        end: clockIn(Math.min(e.endMs, dayEnd), tz),
        title: e.title,
        // A block spanning the whole day IS an all-day block for the reader, whatever the flag says.
        allDay: e.allDay || (e.startMs <= dayStart && e.endMs >= dayEnd),
        // The door's half — the event's own id and its UNCLAMPED instants (the labels above are
        // clamped to the day on purpose; a door must open the whole event).
        ...(e.id ? { id: e.id } : {}),
        startISO: new Date(e.startMs).toISOString(),
        endISO: new Date(e.endMs).toISOString(),
      }));
    days.push({ dayStr: day, weekday: weekdayOf(day), busy });
    if (day === to) break;
    day = addDays(day, 1);
  }
  return { days, busyBlocks, tz, hasCalendar };
}

/**
 * THE PROMPT BLOCK — one line per day, every weekday and clock time already computed. The header
 * states the EXACT reach, because the incident's real lie was an unstated boundary: silence about
 * day 15 read as "nothing on day 15".
 */
export function renderCalendarWindow(win: ScheduleWindow, opts: { tz: string }): string {
  const first = win.days[0], last = win.days[win.days.length - 1];
  // THE EMPTY-CALENDAR TRUTH (found by the reach gates, Sep 18): a user with NO calendar synced
  // used to render as day after day of "free" — an availability claim manufactured from an empty
  // table. Unknown renders as UNKNOWN, and the model is told what it may and may not say.
  if (!win.hasCalendar) {
    return (
      `THE CALENDAR — NO CALENDAR IS SYNCED for this account (asked window: ` +
      `${first ? `${first.weekday} ${dayLabel(first.dayStr)}` : '—'} through ${last ? `${last.weekday} ${dayLabel(last.dayStr)}` : '—'}). ` +
      `Availability is UNKNOWN: never describe any day or time as free or busy; say plainly that no ` +
      `calendar is connected here, and do not offer to check it.`
    );
  }
  const lines: string[] = [
    `THE CALENDAR — ${first ? `${first.weekday} ${dayLabel(first.dayStr)}` : '—'} through ` +
    `${last ? `${last.weekday} ${dayLabel(last.dayStr)}` : '—'} (times in ${opts.tz || win.tz}). ` +
    // THE PAIRS ARE CODE'S ANSWER (Sep 21): the model got "this Thursday and Friday" one day out
    // because it did the arithmetic itself over a date it had. Both directions are named, because
    // the failure ran weekday→date, not date→weekday.
    `Every weekday–date pair below is COMPUTED — use these pairs verbatim; never work out a date from a weekday, or a weekday from a date, yourself. ` +
    `BEYOND THIS WINDOW THE CALENDAR IS NOT VISIBLE TO YOU: say so plainly and offer to check, never state availability you cannot see here.`,
  ];
  for (const d of win.days) {
    const label = `${d.weekday.slice(0, 3)} ${dayLabel(d.dayStr)}`;
    if (!d.busy.length) { lines.push(`${label} — free`); continue; }
    const allDay = d.busy.filter((b) => b.allDay);
    const timed = d.busy.filter((b) => !b.allDay);
    const bits = [
      ...allDay.map((b) => `all day (${b.title})`),
      ...timed.map((b) => `${b.start}–${b.end} (${b.title})`),
    ];
    lines.push(`${label} — ${allDay.length ? 'BUSY ' : 'busy '}${bits.join(' · ')}`);
  }
  return lines.join('\n');
}
