import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

// GET /api/calendar?from=&to= — the UNIFIED calendar feed for a date range. Everything time-bound,
// overlaid on one calendar and read LIVE from the source tables (no cache) so it always feels fresh:
//
//   • meeting     — a real calendar_events row, placed at its start_time (indigo)
//   • commitment  — an open commitments row with a due_date IN the window, placed on its due day (amber);
//                   overdue open commitments (due before the window start) are ALSO surfaced, pinned to
//                   the range's first day (usually today) with `overdue: true` (a red cue)
//   • followup    — an open `awaiting` commitment that has gone quiet (≥3 days since last activity):
//                   a suggested nudge marker, placed on the day it crossed the quiet threshold (or today
//                   if that day is before the window). Soft "nudge" cue.
//
// Each item is a flat `{ type, title, date, time?, entityId, meta }` so the client can render them
// overlaid + color-coded and wire the sensible action per type (open meeting / mark commitment done /
// draft a nudge). `from`/`to` are inclusive YYYY-MM-DD day bounds.

const DAY = 86_400_000;
const QUIET_DAYS = 3; // an awaiting commitment "gone quiet" after 3 days without movement

export type CalendarItemType = 'meeting' | 'commitment' | 'followup';

export interface CalendarItem {
  id: string;                 // stable per-item key (type-prefixed)
  type: CalendarItemType;
  title: string;
  date: string;               // YYYY-MM-DD — the day column it belongs to
  time: string | null;        // ISO start time for meetings; null for all-day markers
  endTime: string | null;     // ISO end time for meetings
  entityId: string;           // the source row id (calendar_events.id / commitments.id)
  meta: {
    overdue?: boolean;
    dueDate?: string | null;
    counterparty?: string | null;
    direction?: string | null;
    attendees?: number;
    ageDays?: number;
    location?: string | null;
    meetingLink?: string | null;
  };
}

// Local YYYY-MM-DD for a Date (calendar columns are local days, not UTC).
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const todayStr = localDay(now);
  // Default to the current week if params are missing. Bounds are inclusive day strings.
  const from = sp.get('from') || todayStr;
  const to = sp.get('to') || todayStr;
  // The first day the client is showing — where we pin overdue / already-quiet markers so they don't
  // fall off the visible grid. Clamp to today so we never pin into the past when viewing a past week.
  const anchorDay = from > todayStr ? from : todayStr;
  const inWindow = (d: string) => d >= from && d <= to;

  // Instant bounds for the meeting query (a meeting starting on `to` day, local, may be a UTC day later).
  const rangeStartIso = new Date(`${from}T00:00:00`).toISOString();
  const rangeEndIso = new Date(`${to}T23:59:59.999`).toISOString();

  const [meetingsRes, commitsRes] = await Promise.all([
    supabase.from('calendar_events')
      .select('id, title, start_time, end_time, attendees, location, meeting_link, status')
      .eq('user_id', user.id).eq('status', 'confirmed')
      .gte('start_time', rangeStartIso).lte('start_time', rangeEndIso)
      .order('start_time', { ascending: true }).limit(200),
    // All open commitments — we compute due / overdue / quiet-followup placement in JS (cheap, ≤ a few
    // hundred rows) so one query covers all three commitment-derived item types.
    supabase.from('commitments')
      .select('id, direction, description, counterparty, due_date, status, last_nudged_at, updated_at, created_at')
      .eq('user_id', user.id).eq('status', 'open').limit(500),
  ]);

  const items: CalendarItem[] = [];

  // ── Meetings ──────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (meetingsRes.data ?? []) as any[]) {
    const start = new Date(m.start_time);
    const day = localDay(start);
    if (!inWindow(day)) continue; // guard the UTC/local edge
    const attendees = Array.isArray(m.attendees)
      ? m.attendees.filter((a: { email?: string; self?: boolean }) =>
          a?.email && !a.self && a.email.toLowerCase() !== user.email?.toLowerCase()).length
      : 0;
    items.push({
      id: `meeting:${m.id}`,
      type: 'meeting',
      title: m.title || '(untitled)',
      date: day,
      time: m.start_time,
      endTime: m.end_time ?? null,
      entityId: m.id,
      meta: { attendees, location: m.location ?? null, meetingLink: m.meeting_link ?? null },
    });
  }

  // ── Commitments (due + overdue) and follow-ups (quiet awaiting) ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (commitsRes.data ?? []) as any[]) {
    const due: string | null = c.due_date || null;
    const counterparty: string | null = c.counterparty || null;
    const direction: string = c.direction || 'you_owe';

    // A commitment you OWE (you_owe) with a due date → an amber marker on its due day. If it's already
    // past due, surface it on the anchor day (today) with an overdue cue — it must not silently drop
    // off just because its due date is behind the visible window.
    if (direction !== 'awaiting' && due) {
      const overdue = due < todayStr;
      const placeDay = overdue ? anchorDay : due;
      if (inWindow(placeDay)) {
        items.push({
          id: `commitment:${c.id}`,
          type: 'commitment',
          title: c.description || 'Commitment',
          date: placeDay,
          time: null,
          endTime: null,
          entityId: c.id,
          meta: { overdue, dueDate: due, counterparty, direction },
        });
      }
      continue;
    }

    // A commitment you OWE with NO due date isn't time-bound → it belongs on the plate, not the calendar.
    // (The Home already surfaces those.) Skip.
    if (direction !== 'awaiting') continue;

    // An `awaiting` commitment (you're waiting on someone) that has gone quiet ≥ QUIET_DAYS → a
    // suggested-nudge marker on the day it crossed the threshold (clamped into the window). "Last
    // movement" = the freshest of last_nudged_at / updated_at / created_at.
    const lastMove = new Date(c.last_nudged_at || c.updated_at || c.created_at || now);
    const ageDays = Math.floor((now.getTime() - lastMove.getTime()) / DAY);
    if (ageDays < QUIET_DAYS) continue;
    const crossed = new Date(lastMove.getTime() + QUIET_DAYS * DAY);
    let markerDay = localDay(crossed);
    if (markerDay < anchorDay) markerDay = anchorDay; // pin already-quiet ones onto the anchor (today)
    if (!inWindow(markerDay)) continue;
    items.push({
      id: `followup:${c.id}`,
      type: 'followup',
      title: c.description || 'Follow up',
      date: markerDay,
      time: null,
      endTime: null,
      entityId: c.id,
      meta: { counterparty, direction, ageDays },
    });
  }

  return NextResponse.json({ from, to, today: todayStr, items });
}
