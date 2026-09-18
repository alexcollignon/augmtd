// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROPOSED SLOTS — the propose tier's last mile (docs/attention-plan.md PART III, law Q8:
// "proposed slots from real free/busy for schedule asks").
//
// THE GAP THIS CLOSES, measured on the reference account: eleven standing `schedule` verdicts; NINE
// had no invite staged at all and two had an invite with NO TIME. The grounding pass is not at
// fault — it is forbidden to propose when the item states no day or window ("schedule a 15-minute
// call with Alex" states neither), which is exactly right: a time nobody mentioned is not a fact
// about the thread. But the pass then stored a timeless shell and the row sat CTA-only, asking the
// user to do the one thing a calendar can answer for itself.
//
// So the proposal comes from a DIFFERENT AUTHORITY: not the thread's words (the model's job) but
// the user's OWN CALENDAR (code's job). Free/busy is arithmetic — deterministic, zero-AI, quoting
// nobody. The card already carries the vocabulary for this: `proposed: true` says in the user's own
// interface that the time is ours, not theirs, and the approve gate is untouched — nothing books.
//
// THE FLOORS: business days only, working hours only, never today (a proposal for two hours from
// now is not a courtesy), never a slot that collides with something already on the calendar, and
// at most three. A slot we cannot prove is free is simply not offered.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** The working-hour anchors a proposal may land on, in the user's own zone. */
export const PROPOSAL_HOURS = ['10:00', '14:00', '16:00'] as const;
/** At most this many proposals ever (the card renders one + two alternatives). */
export const MAX_PROPOSALS = 3;
/** How far ahead the search may look for free room. */
export const PROPOSAL_HORIZON_DAYS = 10;
const DEFAULT_MINUTES = 30;
const DAY_MS = 86_400_000;

/** A busy block on the user's calendar (ms epoch). */
export type BusyBlock = { startMs: number; endMs: number };
export type ProposedSlot = { startISO: string; endISO: string };

/** The zone's offset at a given instant — the one conversion both directions use. */
function tzOffsetMs(tz: string, ms: number): number {
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(ms));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
    const hh = g('hour') === '24' ? '00' : g('hour');
    return Date.parse(`${g('year')}-${g('month')}-${g('day')}T${hh}:${g('minute')}:${g('second')}Z`) - ms;
  } catch { return 0; }
}

/** "2026-09-21" + "10:00" in `tz` → the UTC instant. Two passes so a DST boundary resolves. */
export function zonedTimeToUtc(dateStr: string, hhmm: string, tz: string): number {
  const naive = Date.parse(`${dateStr}T${hhmm}:00Z`);
  if (Number.isNaN(naive)) return NaN;
  let ms = naive;
  for (let i = 0; i < 2; i++) ms = naive - tzOffsetMs(tz, ms);
  return ms;
}

/** Add whole days to a YYYY-MM-DD (calendar arithmetic only). */
function addDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
/** 0 = Sunday … 6 = Saturday, on the calendar day itself. */
const dow = (dateStr: string): number => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

/**
 * THE PICKER — pure, deterministic, zero-IO: the next `count` working-hour slots, on business days
 * inside the horizon, that collide with nothing on the calendar. Never today.
 */
export function pickFreeSlots(opts: {
  todayStr: string;
  tz: string;
  busy: BusyBlock[];
  count?: number;
  days?: number;
  hours?: readonly string[];
  minutes?: number;
}): ProposedSlot[] {
  const count = Math.max(0, opts.count ?? MAX_PROPOSALS);
  const days = opts.days ?? PROPOSAL_HORIZON_DAYS;
  const hours = opts.hours ?? PROPOSAL_HOURS;
  const minutes = opts.minutes ?? DEFAULT_MINUTES;
  const out: ProposedSlot[] = [];
  for (let d = 1; d <= days && out.length < count; d++) {
    const day = addDays(opts.todayStr, d);
    const wd = dow(day);
    if (wd === 0 || wd === 6) continue;               // business days only
    for (const hh of hours) {
      if (out.length >= count) break;
      const start = zonedTimeToUtc(day, hh, opts.tz);
      if (Number.isNaN(start)) continue;
      const end = start + minutes * 60_000;
      const clash = opts.busy.some((b) => b.startMs < end && b.endMs > start);
      if (clash) continue;
      out.push({ startISO: new Date(start).toISOString(), endISO: new Date(end).toISOString() });
    }
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Read the user's real bookings inside the horizon and pick the free room. Non-fatal: an
 *  unreadable calendar yields NO proposals (we never propose a time we cannot prove is free).
 *
 *  TWO LATENT BUGS FIXED before this became load-bearing in chat (Wave 1, Sep 18 — the pilot
 *  incident where two of three proposed slots sat inside a four-day away block):
 *    • THE OVERLAP LAW — `.gte('start_time', floor)` cannot see a block ALREADY IN PROGRESS at the
 *      floor: its start_time predates it. Candidacy is now start ≤ ceil AND (end ≥ floor), with the
 *      start bound kept as a bounded lookback so the query stays cheap.
 *    • A CANCELLED EVENT IS NOT BUSY — the status filter was simply missing here while every other
 *      calendar read carries it, so a declined meeting silently blocked an honestly free hour.
 *  Plus an optional window, so the chat's check_calendar can propose inside the range the user
 *  actually asked about. Defaults are byte-compatible with the existing caller (lib/prepare/pass). */
export async function proposeFreeSlots(
  client: SupabaseClient, userId: string,
  opts: { tz: string; todayStr: string; count?: number; minutes?: number; fromDayStr?: string; toDayStr?: string },
): Promise<ProposedSlot[]> {
  try {
    // The search anchor: proposals start the day AFTER `todayStr` (never today), so an explicit
    // window shifts the anchor back one day to make its own first day eligible.
    const anchor = opts.fromDayStr ? new Date(Date.parse(`${opts.fromDayStr}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10) : opts.todayStr;
    const days = opts.fromDayStr && opts.toDayStr
      ? Math.max(1, Math.round((Date.parse(`${opts.toDayStr}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / DAY_MS))
      : PROPOSAL_HORIZON_DAYS;
    const floorMs = opts.fromDayStr ? Date.parse(`${opts.fromDayStr}T00:00:00Z`) : Date.now();
    const ceil = new Date(Date.parse(`${anchor}T00:00:00Z`) + (days + 2) * DAY_MS).toISOString();
    const { data } = await client.from('calendar_events').select('start_time, end_time, status')
      .eq('user_id', userId).eq('status', 'confirmed')
      .gte('start_time', new Date(floorMs - 14 * DAY_MS).toISOString()).lte('start_time', ceil).limit(300);
    const busy: BusyBlock[] = [];
    for (const e of (data ?? []) as Array<{ start_time: string; end_time: string | null }>) {
      const s = Date.parse(String(e.start_time));
      if (Number.isNaN(s)) continue;
      const en = e.end_time ? Date.parse(String(e.end_time)) : NaN;
      const endMs = Number.isNaN(en) ? s + DEFAULT_MINUTES * 60_000 : en;
      if (endMs < floorMs) continue;                  // over before the window opens — not busy for us
      busy.push({ startMs: s, endMs });
    }
    return pickFreeSlots({ todayStr: anchor, tz: opts.tz, busy, count: opts.count, minutes: opts.minutes, days });
  } catch { return []; }
}
