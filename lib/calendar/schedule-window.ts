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

export type WindowBusy = { start: string; end: string; title: string; allDay: boolean };
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
  const events: Array<{ startMs: number; endMs: number; title: string; allDay: boolean }> = [];
  let hasCalendar = false;
  try {
    const { data } = await supabase.from('calendar_events')
      // EXPLICIT select (the silent-column law: a bad column returns data:null and no error).
      .select('title, start_time, end_time, is_all_day, status')
      .eq('user_id', userId)
      // Cancelled/declined events are NOT busy — parity with today-schedule.ts.
      .eq('status', 'confirmed')
      // THE OVERLAP LAW: the query bounds only the START (bounded lookback so it stays cheap); the
      // real candidacy test is the overlap below, which is what catches an in-progress block.
      .gte('start_time', new Date(winStart - LOOKBACK_DAYS * DAY_MS).toISOString())
      .lte('start_time', new Date(winEnd).toISOString())
      .order('start_time', { ascending: true }).limit(400);
    for (const e of (data ?? []) as Array<{ title: string | null; start_time: string; end_time: string | null; is_all_day: boolean | null }>) {
      const s = Date.parse(String(e.start_time));
      if (Number.isNaN(s)) continue;
      const parsedEnd = e.end_time ? Date.parse(String(e.end_time)) : NaN;
      const en = Number.isNaN(parsedEnd) ? s + DEFAULT_MINUTES * 60_000 : parsedEnd;
      if (en <= winStart || s >= winEnd) continue;   // no overlap with the asked window
      events.push({ startMs: s, endMs: en, title: clipTitle(String(e.title || '')), allDay: e.is_all_day === true });
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
      .filter((e) => e.startMs < dayEnd && e.endMs > dayStart)
      .map((e) => ({
        // Clamped to the day, so a multi-day block reads honestly on each of its days.
        start: clockIn(Math.max(e.startMs, dayStart), tz),
        end: clockIn(Math.min(e.endMs, dayEnd), tz),
        title: e.title,
        // A block spanning the whole day IS an all-day block for the reader, whatever the flag says.
        allDay: e.allDay || (e.startMs <= dayStart && e.endMs >= dayEnd),
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
    `The weekday of every date below is COMPUTED — use these labels verbatim and never derive a weekday yourself. ` +
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
