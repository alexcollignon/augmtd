// ─── Meeting context fetcher ──────────────────────────────────────────────────
// Pulls recent processed meeting transcripts with summaries, attendees, action
// items, and notes — gives workflows a personal context signal.

import type { SupabaseClient } from '@supabase/supabase-js';
import { userTimezone } from '@/lib/calendar/schedule-window';

export interface GetMeetingContextConfig {
  /** Lookback window. Default: '30d' */
  since?: '7d' | '14d' | '30d' | '90d' | string;
  /** What to include per meeting. Default: 'summaries' */
  include?: 'summaries' | 'notes' | 'both';
  /** Filter by attendee name or email (partial, case-insensitive) */
  with_person?: string;
  /** Max meetings to return. Default 10, max 30 */
  limit?: number;
  /** Include upcoming/future meetings from calendar. Default: true (the schema's own promise). */
  include_upcoming?: boolean;
}

export const getMeetingContextDefinition = {
  name: 'get_meeting_context',
  description: "Get recent meeting summaries, notes, action items, and upcoming calendar events. Use when the user asks about meetings, what happened in calls, follow-ups, or their calendar.",
  input_schema: {
    type: 'object' as const,
    properties: {
      since: { type: 'string', enum: ['7d', '14d', '30d'], description: 'How far back to look for past meetings. Default: 7d.' },
      include: { type: 'string', enum: ['summaries', 'notes', 'both'], description: "What to include per meeting. 'summaries' = AI summary, 'notes' = live notes + action items, 'both' = everything. Default: both." },
      with_person: { type: 'string', description: 'Filter to meetings involving this person (name or email).' },
      include_upcoming: { type: 'boolean', description: 'Also include upcoming calendar events for the next 7 days. Default: true.' },
    },
    required: [],
  },
};

function parseSince(since: string): Date {
  if (since === '7d')  return new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  if (since === '14d') return new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  if (since === '30d') return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (since === '90d') return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const d = new Date(since);
  return isNaN(d.getTime()) ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : d;
}

/** ONE READ, TWO RENDERINGS (Wave 1, Sep 22 — the collection card). `readMeetingContext` owns the
 *  QUERIES and hands back both halves: the block written for the model, and the typed rows the
 *  kit's `recordings` collection renders. The executor is a thin wrapper over it, so the card and
 *  the model can never be looking at different meetings. */
export type MeetingRow = {
  id: string;
  title: string;
  start_time: string;
  duration_minutes: number | null;
  summary: string | null;
  actionItems: string[];
  attendees: Array<{ email: string; name?: string }>;
  /** Already rendered in the USER's zone (code's output, never the model's arithmetic). */
  dateLabel: string;
};
export type UpcomingEventRow = {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  dateLabel: string;
  timeLabel: string;
  attendeeNames: string[];
};

export async function readMeetingContext(
  config: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<{ text: string; meetings: MeetingRow[]; upcoming: UpcomingEventRow[]; tz: string }> {
  const since          = parseSince((config.since as string) || '30d');
  const include        = (config.include as string) || 'summaries';
  const withPerson     = typeof config.with_person === 'string' ? config.with_person.toLowerCase().trim() : null;
  const limit          = Math.min(Math.max(typeof config.limit === 'number' ? config.limit : 10, 1), 30);
  // THE LYING DEFAULT (Wave 1, Sep 18): the schema told the model "Default: true" while the code
  // read `=== true` — so every call that trusted the documented default silently got NO upcoming
  // meetings. The schema is the promise; the code keeps it.
  const includeUpcoming = config.include_upcoming !== false;
  // Dates render in the USER'S zone, not the server's — a meeting at 23:30 Lisbon was printing as
  // the following day for anyone reading a UTC box (the same class as every other weekday miss).
  const tz = await userTimezone(supabase, userId);

  const parts: string[] = [];

  // ── Past processed meetings ─────────────────────────────────────────────────
  const { data: rows } = await supabase
    .from('meeting_transcripts')
    .select('id, title, start_time, duration_minutes, source, summary, notes_structured, attendees')
    .eq('user_id', userId)
    .eq('processed', true)
    .neq('bot_state', 'failed')
    .gte('start_time', since.toISOString())
    .order('start_time', { ascending: false })
    .limit(100); // fetch more, filter client-side for with_person

  let meetings = (rows ?? []) as Array<{
    id: string;
    title: string;
    start_time: string;
    duration_minutes: number;
    source: string;
    summary?: string | null;
    notes_structured?: Record<string, any> | null;
    attendees?: Array<{ email: string; name?: string }> | null;
  }>;

  // Attendee filter
  if (withPerson) {
    meetings = meetings.filter(m =>
      (m.attendees ?? []).some(a =>
        (a.name ?? '').toLowerCase().includes(withPerson) ||
        a.email.toLowerCase().includes(withPerson)
      )
    );
  }

  meetings = meetings.slice(0, limit);

  const meetingRows: MeetingRow[] = [];
  const upcomingRows: UpcomingEventRow[] = [];

  if (meetings.length === 0 && !includeUpcoming) {
    return { text: 'No processed meetings found in the specified period.', meetings: [], upcoming: [], tz };
  }

  if (meetings.length > 0) {
    parts.push(`## Recent meetings (${meetings.length})\n`);

    for (const m of meetings) {
      const date = new Date(m.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });
      const dur  = m.duration_minutes ? ` · ${m.duration_minutes} min` : '';
      const attendeeNames = (m.attendees ?? [])
        .map(a => a.name ? `${a.name} (${a.email})` : a.email)
        .join(', ');

      const lines: string[] = [`**${m.title}** — ${date}${dur}`];
      if (attendeeNames) lines.push(`Attendees: ${attendeeNames}`);

      const wantSummary = include === 'summaries' || include === 'both';
      const wantNotes   = include === 'notes'     || include === 'both';

      if (wantSummary && m.summary?.trim()) {
        lines.push(`Summary: ${m.summary.trim().slice(0, 500)}`);
      }

      const ns = m.notes_structured;
      const actionItems: string[] = ns && Array.isArray(ns.action_items)
        ? ns.action_items.map((a: any) => (typeof a === 'string' ? a : a.text ?? JSON.stringify(a)))
        : [];
      if (wantNotes && ns) {
        if (actionItems.length > 0) {
          lines.push(`Action items: ${actionItems.slice(0, 5).join(' · ')}`);
        }
        if (ns.live_notes?.trim()) {
          lines.push(`Notes: ${ns.live_notes.trim().slice(0, 300)}`);
        }
      }

      meetingRows.push({
        id: m.id, title: m.title, start_time: m.start_time,
        duration_minutes: m.duration_minutes ?? null,
        summary: m.summary?.trim() || null,
        // The action-item COUNT is a fact of the meeting, not of the `include` mode the model asked
        // for — a card saying "2 action items" must not depend on which block the prompt wanted.
        actionItems,
        attendees: m.attendees ?? [],
        dateLabel: date,
      });

      parts.push(lines.join('\n'));
    }
  }

  // ── Upcoming meetings from calendar ────────────────────────────────────────
  if (includeUpcoming) {
    const now = new Date().toISOString();
    const oneWeekOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: upcoming } = await supabase
      .from('calendar_events')
      .select('id, title, start_time, end_time, attendees')
      .eq('user_id', userId)
      .gte('start_time', now)
      .lte('start_time', oneWeekOut)
      .order('start_time', { ascending: true })
      .limit(10);

    if (upcoming && upcoming.length > 0) {
      parts.push(`\n## Upcoming meetings (next 7 days)\n`);
      for (const ev of upcoming as Array<{ id: string; title: string; start_time: string; end_time: string; attendees?: Array<{ email: string; displayName?: string }> }>) {
        const date = new Date(ev.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
        const time = new Date(ev.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
        const attendeeNames = (ev.attendees ?? [])
          .map(a => a.displayName ?? a.email)
          .filter((n): n is string => !!n);
        const line = attendeeNames.length
          ? `**${ev.title}** — ${date} ${time} · with ${attendeeNames.join(', ')}`
          : `**${ev.title}** — ${date} ${time}`;
        upcomingRows.push({
          id: String(ev.id), title: ev.title, start_time: ev.start_time, end_time: ev.end_time ?? null,
          dateLabel: date, timeLabel: time, attendeeNames,
        });
        parts.push(line);
      }
    }
  }

  return { text: parts.join('\n\n'), meetings: meetingRows, upcoming: upcomingRows, tz };
}

export async function executeGetMeetingContext(
  config: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<string> {
  return (await readMeetingContext(config, userId, supabase)).text;
}
