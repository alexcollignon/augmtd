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
import { getCalendarFreshness, refreshCalendarIfStale } from '@/lib/calendar/sync-calendar';

const DAY_MS = 86_400_000;
/** Older than this and the window is RE-READ before the answer is composed — "I changed my
 *  calendar" deserves a fresh read, not "my view may need a moment to refresh". */
const STALE_MS = 15 * 60_000;
/** How long the chat path will WAIT on a provider round-trip before answering from what it holds.
 *  Freshness is worth a pause, never a hang. */
const REFRESH_BUDGET_MS = 8_000;
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
  /** Force a live re-read of the provider before answering (the user says they just changed it). */
  refresh?: boolean;
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
      refresh: { type: 'boolean', description: 'Re-read the calendar from the provider first. Set this when the user says they just changed, added or deleted something.' },
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

/** "Last read 4 min ago." — one short line, because the alternative shipped once was a shrug.
 *  Silent when there is nothing honest to say (no connections at all). */
export function renderCalendarFreshness(rows: Array<{ provider: string; syncedAt: string | null }>): string {
  if (!rows.length) return '';
  const ages = rows.map((r) => {
    const ms = r.syncedAt ? Date.now() - Date.parse(r.syncedAt) : NaN;
    return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : null;
  });
  if (ages.every((a) => a === null)) {
    return 'LAST READ: unknown (this calendar has not been read since the connection was set up) — say so if the user asks whether a just-made change is visible.';
  }
  const worst = Math.max(...ages.filter((a): a is number => a !== null));
  const when = worst < 1 ? 'less than a minute ago' : worst < 60 ? `${worst} min ago` : `${Math.round(worst / 60)} h ago`;
  return `LAST READ from the calendar provider: ${when}. A change made since then is not in the lines above — say that plainly rather than guessing.`;
}

/** ONE READ, TWO RENDERINGS (Wave 1, Sep 22 — the collection card). `readCalendar` owns the read
 *  and returns BOTH halves: the block written for the model, and the struct the kit's `calendar`
 *  collection renders rows from. Everything either half shows — weekday, date, clock — is already
 *  computed HERE, so the card and the prompt cannot disagree about what day it is. */
export type CalendarRead = {
  text: string;
  win: Awaited<ReturnType<typeof getScheduleWindow>>;
  tz: string;
  fromDayStr: string;
  toDayStr: string;
  /** Only when slots were asked for AND a calendar exists — an invented slot is the class this
   *  whole tool exists to end. */
  slots: Array<{ startISO: string; endISO: string }>;
  /** THE BLOCKS `text` is joined from, by role — so a budgeted reader (THE CONTEXT BUDGET, W2.7)
   *  can keep the verified FREE SLOTS whole and shrink event detail first, instead of a raw slice
   *  eating whatever was appended last. `text === [window, freshness, clamp, slots].filter.join`. */
  blocks: { window: string; freshness: string | null; clamp: string | null; slots: string | null };
};

export async function readCalendar(
  config: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<CalendarRead | { refusal: string }> {
  const tz = await userTimezone(supabase, userId);
  const todayStr = dayOf(Date.now(), tz);

  // A malformed date gets an HONEST refusal naming the shape — never a silently substituted window
  // (the whole class this tool exists to end is a confident answer about days nobody looked at).
  const raw = { from: config.from_date, to: config.to_date };
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined && v !== null && !(typeof v === 'string' && DATE_RE.test(v))) {
      return { refusal: `I couldn't read "${k}_date" — give me a date as YYYY-MM-DD (for example ${todayStr}).` };
    }
  }
  const fromDayStr = (raw.from as string) || todayStr;
  let toDayStr = (raw.to as string) || addDays(fromDayStr, DEFAULT_DAYS);
  if (toDayStr < fromDayStr) toDayStr = fromDayStr;
  const span = Math.round((Date.parse(`${toDayStr}T00:00:00Z`) - Date.parse(`${fromDayStr}T00:00:00Z`)) / DAY_MS);
  const clamped = span > MAX_WINDOW_DAYS;
  if (clamped) toDayStr = addDays(fromDayStr, MAX_WINDOW_DAYS);

  // ── FRESHNESS FIRST (Sep 21) — a stale read is RE-READ before the answer exists, never explained
  // away after it. Best-effort by construction: what we could not refresh, we state.
  // …and TIME-BOXED: a provider round-trip sits on the chat path, and a hanging OAuth call would
  // hold the whole answer hostage. Past the budget we answer from the stored view — which already
  // states its own age — and let the refresh land for the next question.
  await Promise.race([
    refreshCalendarIfStale(supabase, userId, { maxAgeMs: config.refresh === true ? 0 : STALE_MS }).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, REFRESH_BUDGET_MS)),
  ]);

  const win = await getScheduleWindow(supabase, userId, { fromDayStr, toDayStr, tz });
  const windowBlock = renderCalendarWindow(win, { tz });
  const parts = [windowBlock];
  const freshness = renderCalendarFreshness(await getCalendarFreshness(supabase, userId));
  if (freshness) parts.push(freshness);
  const clampLine = clamped ? `(I read the first ${MAX_WINDOW_DAYS} days of the range you asked for — ask again for the rest.)` : null;
  if (clampLine) parts.push(clampLine);
  const fixed = parts.length;

  // THE EMPTY-CALENDAR TRUTH: with no calendar synced, every "free slot" would be an invention —
  // the picker over an empty busy set proposes everything. The block above already says UNKNOWN;
  // proposals are refused for the same reason, plainly.
  let proposed: Array<{ startISO: string; endISO: string }> = [];
  if (config.propose_slots === true && !win.hasCalendar) {
    parts.push('FREE SLOTS: none can be proposed — no calendar is synced for this account, so nothing can be verified free.');
  } else if (config.propose_slots === true) {
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
    proposed = slots.map((s) => ({ startISO: s.startISO, endISO: s.endISO }));
    parts.push(slots.length
      ? `FREE SLOTS (${minutes} min each, working hours, business days, ${tz} — offer these verbatim, they collide with nothing above):\n` +
        slots.map((s) => {
          const startMs = Date.parse(s.startISO);
          const d = dayOf(startMs, tz);
          return `- ${weekdayOf(d)} ${dateLabel(d)}, ${clockOf(startMs, tz)}–${clockOf(Date.parse(s.endISO), tz)}`;
        }).join('\n')
      : 'FREE SLOTS: none — there is no free working-hour slot of that length in this window. Say so plainly and offer a different range.');
  }
  return {
    text: parts.join('\n\n'), win, tz, fromDayStr, toDayStr, slots: proposed,
    blocks: { window: windowBlock, freshness: freshness || null, clamp: clampLine, slots: parts[fixed] ?? null },
  };
}

export async function executeCheckCalendar(
  config: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const out = await readCalendar(config, userId, supabase);
  return 'refusal' in out ? out.refusal : out.text;
}
