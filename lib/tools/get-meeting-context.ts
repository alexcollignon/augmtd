// ─── Meeting context fetcher ──────────────────────────────────────────────────
// Pulls recent processed meeting transcripts with summaries, attendees, action
// items, and notes — gives workflows a personal context signal.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface GetMeetingContextConfig {
  /** Lookback window. Default: '30d' */
  since?: '7d' | '14d' | '30d' | '90d' | string;
  /** What to include per meeting. Default: 'summaries' */
  include?: 'summaries' | 'notes' | 'both';
  /** Filter by attendee name or email (partial, case-insensitive) */
  with_person?: string;
  /** Max meetings to return. Default 10, max 30 */
  limit?: number;
  /** Include upcoming/future meetings from calendar. Default: false */
  include_upcoming?: boolean;
}

function parseSince(since: string): Date {
  if (since === '7d')  return new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  if (since === '14d') return new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  if (since === '30d') return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (since === '90d') return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const d = new Date(since);
  return isNaN(d.getTime()) ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : d;
}

export async function executeGetMeetingContext(
  config: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const since          = parseSince((config.since as string) || '30d');
  const include        = (config.include as string) || 'summaries';
  const withPerson     = typeof config.with_person === 'string' ? config.with_person.toLowerCase().trim() : null;
  const limit          = Math.min(Math.max(typeof config.limit === 'number' ? config.limit : 10, 1), 30);
  const includeUpcoming = config.include_upcoming === true;

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

  if (meetings.length === 0 && !includeUpcoming) {
    return 'No processed meetings found in the specified period.';
  }

  if (meetings.length > 0) {
    parts.push(`## Recent meetings (${meetings.length})\n`);

    for (const m of meetings) {
      const date = new Date(m.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
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

      if (wantNotes && m.notes_structured) {
        const ns = m.notes_structured;
        const actionItems: string[] = Array.isArray(ns.action_items)
          ? ns.action_items.map((a: any) => (typeof a === 'string' ? a : a.text ?? JSON.stringify(a)))
          : [];
        if (actionItems.length > 0) {
          lines.push(`Action items: ${actionItems.slice(0, 5).join(' · ')}`);
        }
        if (ns.live_notes?.trim()) {
          lines.push(`Notes: ${ns.live_notes.trim().slice(0, 300)}`);
        }
      }

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
      for (const ev of upcoming as Array<{ title: string; start_time: string; end_time: string; attendees?: Array<{ email: string; displayName?: string }> }>) {
        const date = new Date(ev.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const time = new Date(ev.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const attendeeNames = (ev.attendees ?? [])
          .map(a => a.displayName ?? a.email)
          .filter(n => n)
          .join(', ');
        const line = attendeeNames
          ? `**${ev.title}** — ${date} ${time} · with ${attendeeNames}`
          : `**${ev.title}** — ${date} ${time}`;
        parts.push(line);
      }
    }
  }

  return parts.join('\n\n');
}
