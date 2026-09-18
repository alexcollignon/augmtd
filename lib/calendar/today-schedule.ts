// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE TODAY-SCHEDULE READ (single-source: the schedule had TWO truths — the brief queried from
// now−30min ("no meetings today" at 4pm) while the ask queried from midnight ("three meetings today",
// all already past). One helper, user-timezone-aware, past/next/upcoming split + a NOW anchor — every
// consumer (ask, brief, report) reads the same day the same way.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
// ONE DERIVATION of the user's day boundary: the tz helper that used to live here now lives beside
// the windowed read, so today and the next fourteen days are cut on the same clock.
import { userTimezone } from '@/lib/calendar/schedule-window';

export type TodaySchedule = {
  userTz: string;
  nowLocal: string;          // "16:23" — the anchor every prompt needs to reason about the day honestly
  dayStr: string;            // "2026-09-18" — today in the user's zone
  todayLabel: string;        // "Friday, 18 September 2026" — CODE's weekday, never the model's
  past: Array<{ time: string; title: string }>;
  upcoming: Array<{ time: string; title: string }>;
};

export async function getTodaySchedule(supabase: SupabaseClient, userId: string): Promise<TodaySchedule> {
  const userTz = await userTimezone(supabase, userId);
  const now = new Date();
  const fmt = (d: Date | string) => {
    try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz }).format(typeof d === 'string' ? new Date(d) : d); }
    catch { return String(d).slice(11, 16); }
  };
  const dayStr = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(now); } catch { return now.toISOString().slice(0, 10); } })();
  // THE CLOCK, spelled out: weekday + date computed by Intl on the calendar date itself (a date's
  // weekday is zone-independent, so it is read at UTC noon, away from every boundary).
  const todayLabel = (() => {
    try { return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dayStr}T12:00:00Z`)); }
    catch { return dayStr; }
  })();
  const past: TodaySchedule['past'] = [];
  const upcoming: TodaySchedule['upcoming'] = [];
  try {
    const { data } = await supabase.from('calendar_events')
      .select('title, start_time, is_all_day, status')
      .eq('user_id', userId).eq('status', 'confirmed')
      .gte('start_time', `${dayStr}T00:00:00`).lte('start_time', `${dayStr}T23:59:59`)
      .order('start_time', { ascending: true }).limit(16);
    for (const e of (data ?? []) as Array<{ title: string | null; start_time: string; is_all_day: boolean | null }>) {
      const entry = { time: e.is_all_day ? 'all day' : fmt(e.start_time), title: String(e.title || '(untitled)') };
      (Date.parse(e.start_time) < now.getTime() ? past : upcoming).push(entry);
    }
  } catch { /* empty day on failure */ }
  return { userTz, nowLocal: fmt(now), dayStr, todayLabel, past, upcoming };
}

/** The one prompt block — how any AI surface should describe today. Honest about what already happened.
 *
 *  THE CLOCK REACHES THE CHAT LANE (Wave 1, Sep 18): this line ran DATELESS while every other lane
 *  carried the date (lib/workflows/execute-step.ts's dateLine is the idiom). A dateless model
 *  coin-flips every weekday↔date pair it writes — the pilot chat said "Tuesday, September 24" for a
 *  Thursday, three proposals out of three. The date is stated here so nothing downstream derives it. */
export function renderScheduleBlock(s: TodaySchedule): string {
  const lines = [
    `TODAY is ${s.todayLabel} — IT IS NOW ${s.nowLocal} (the user's local time) — reason about the day accordingly: earlier events already HAPPENED.`,
  ];
  if (s.past.length) lines.push(`Already happened today: ${s.past.map((e) => `${e.time} ${e.title.slice(0, 40)}`).join(' · ')}`);
  lines.push(s.upcoming.length
    ? `Still ahead today: ${s.upcoming.map((e) => `${e.time} ${e.title.slice(0, 40)}`).join(' · ')}`
    : 'Nothing left on the calendar today.');
  return lines.join('\n');
}
