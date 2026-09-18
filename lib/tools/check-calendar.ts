// ════════════════════════════════════════════════════════════════════════════════════════════════
// CHECK_CALENDAR — the read-side availability verb the chat lane was missing (Wave 1, Sep 18).
//
// The chief of staff could PREPARE an invite and could read meeting transcripts, but it had no way
// to LOOK at the calendar for a date range. Asked "check my calendar and reply", it therefore
// answered from the only calendar in its prompt — today — and called two future weeks free. A verb
// that does not exist is a claim the model makes up.
//
// EVERYTHING HERE IS CODE'S OUTPUT: the busy/free lines, the weekday labels, the clock times and the
// proposed slots. The model relays this block; it never derives a weekday and never invents a slot.
// The proposals ride the SAME busy set the block prints (one read), so a proposal can never collide
// with a line the user is looking at.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getScheduleWindow, renderCalendarWindow, userTimezone, weekdayOf } from '@/lib/calendar/schedule-window';
import { pickFreeSlots } from '@/lib/prepare/free-slots';

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 14;
/** A window wider than this is not a question anyone is really asking — and it is a prompt-budget bomb. */
const MAX_WINDOW_DAYS = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CheckCalendarConfig {
  /** First day of the window, YYYY-MM-DD. Default: today (the user's zone). */
  from_date?: string;
  /** Last day of the window, YYYY-MM-DD. Default: from_date + 14 days. */
  to_date?: string;
  /** Also propose genuinely free working-hour slots inside the window. */
  propose_slots?: boolean;
  /** Length of a proposed slot. Default 30. */
  duration_minutes?: number;
  /** How many slots to propose. Default 3, max 5. */
  count?: number;
}

export const checkCalendarDefinition = {
  name: 'check_calendar',
  description:
    "Read the user's calendar for a date range — busy/free per day, and optionally propose genuinely free slots. " +
    'ALWAYS use this before any claim about availability, free time, or scheduling. Never state availability from memory.',
  input_schema: {
    type: 'object' as const,
    properties: {
      from_date: { type: 'string', description: 'First day, YYYY-MM-DD. Default: today.' },
      to_date: { type: 'string', description: 'Last day, YYYY-MM-DD. Default: 14 days after from_date. Window is capped at 60 days.' },
      propose_slots: { type: 'boolean', description: 'Also propose free working-hour slots inside the window.' },
      duration_minutes: { type: 'number', description: 'Length of a proposed slot in minutes. Default 30.' },
      count: { type: 'number', description: 'How many slots to propose. Default 3, max 5.' },
    },
    required: [],
  },
};

const addDays = (dayStr: string, n: number) => new Date(Date.parse(`${dayStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayOf = (ms: number, tz: string) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms)); } catch { return new Date(ms).toISOString().slice(0, 10); }
};
const clockOf = (ms: number, tz: string) => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(11, 16); }
};
const dateLabel = (dayStr: string) => {
  try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${dayStr}T12:00:00Z`)); }
  catch { return dayStr; }
};

export async function executeCheckCalendar(
  config: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const tz = await userTimezone(supabase, userId);
  const todayStr = dayOf(Date.now(), tz);

  // A malformed date gets an HONEST refusal naming the shape — never a silently substituted window
  // (the whole class this tool exists to end is a confident answer about days nobody looked at).
  const raw = { from: config.from_date, to: config.to_date };
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined && v !== null && !(typeof v === 'string' && DATE_RE.test(v))) {
      return `I couldn't read "${k}_date" — give me a date as YYYY-MM-DD (for example ${todayStr}).`;
    }
  }
  const fromDayStr = (raw.from as string) || todayStr;
  let toDayStr = (raw.to as string) || addDays(fromDayStr, DEFAULT_DAYS);
  if (toDayStr < fromDayStr) toDayStr = fromDayStr;
  const span = Math.round((Date.parse(`${toDayStr}T00:00:00Z`) - Date.parse(`${fromDayStr}T00:00:00Z`)) / DAY_MS);
  const clamped = span > MAX_WINDOW_DAYS;
  if (clamped) toDayStr = addDays(fromDayStr, MAX_WINDOW_DAYS);

  const win = await getScheduleWindow(supabase, userId, { fromDayStr, toDayStr, tz });
  const parts = [renderCalendarWindow(win, { tz })];
  if (clamped) parts.push(`(I read the first ${MAX_WINDOW_DAYS} days of the range you asked for — ask again for the rest.)`);

  if (config.propose_slots === true) {
    const minutes = typeof config.duration_minutes === 'number' && config.duration_minutes > 0 ? Math.min(480, Math.round(config.duration_minutes)) : 30;
    const count = typeof config.count === 'number' && config.count > 0 ? Math.min(5, Math.round(config.count)) : 3;
    // THE SAME BUSY SET the block above printed — the picker is pure, so the proposal and the
    // rendering cannot disagree about what is booked.
    const slots = pickFreeSlots({
      todayStr: addDays(fromDayStr, -1),   // the anchor is exclusive; the asked window's first day is eligible
      tz, busy: win.busyBlocks, count: count + 3, minutes,
      days: Math.max(1, Math.round((Date.parse(`${toDayStr}T00:00:00Z`) - Date.parse(`${fromDayStr}T00:00:00Z`)) / DAY_MS) + 1),
    })
      // A time that has already passed is not an offer — the picker's own "never today" floor does
      // not apply once the user names a window starting today, so the clock does the filtering here.
      .filter((s) => Date.parse(s.startISO) > Date.now())
      .slice(0, count);
    parts.push(slots.length
      ? `FREE SLOTS (${minutes} min each, working hours, business days, ${tz} — offer these verbatim, they collide with nothing above):\n` +
        slots.map((s) => {
          const startMs = Date.parse(s.startISO);
          const d = dayOf(startMs, tz);
          return `- ${weekdayOf(d)} ${dateLabel(d)}, ${clockOf(startMs, tz)}–${clockOf(Date.parse(s.endISO), tz)}`;
        }).join('\n')
      : 'FREE SLOTS: none — there is no free working-hour slot of that length in this window. Say so plainly and offer a different range.');
  }
  return parts.join('\n\n');
}
