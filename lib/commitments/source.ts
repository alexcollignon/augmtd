// ════════════════════════════════════════════════════════════════════════════════════════════════
// A COMMITMENT'S SOURCE — THE ONE READ OF `commitments.source_id` (stabilization W7.3).
//
// `source_id` is NOT an inbox item id. The extractor writes the SOURCE ROW's own id:
//   · source='email'   → `emails.id`            (probe, Sep 23: 25/25 resolve in `emails`, 0 as inbox_items.id)
//   · source='meeting' → `meeting_transcripts.id`
// Recognition's provenance read took an email commitment's `source_id` as an inbox_item id, so the
// structural parent never resolved and email-born commitments re-guessed their project on topic.
// Every reader that needs the email's INBOX ITEM asks `inboxItemForEmail` (exact: the inbox row whose
// source_id IS that email; else the newest item on the email's own thread); every reader that needs
// the MEETING as a source object asks `meetingSourceOf`. Zero AI, bounded SELECTs.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt } from '@/lib/utils/clip-for-prompt';

/** The source card's excerpt budget — clipped by THE ONE CLIPPER, the cut declared. */
export const MEETING_SOURCE_EXCERPT_CHARS = 280;

/** The inbox item an email-born commitment's source email lives on — or null. */
export async function inboxItemForEmail(
  client: SupabaseClient, userId: string, src: { emailId: string | null; threadId?: string | null },
): Promise<string | null> {
  try {
    if (src.emailId) {
      const { data: exact } = await client.from('inbox_items').select('id').eq('user_id', userId)
        .eq('source', 'email').eq('source_id', src.emailId).limit(1).maybeSingle();
      if (exact?.id) return String(exact.id);
    }
    let threadId = src.threadId ?? null;
    if (!threadId && src.emailId) {
      const { data: e } = await client.from('emails').select('thread_id').eq('id', src.emailId).eq('user_id', userId).maybeSingle();
      threadId = (e?.thread_id as string | null) ?? null;
    }
    if (threadId) {
      const { data: onThread } = await client.from('inbox_items').select('id').eq('user_id', userId)
        .eq('source_data->>thread_id', threadId)
        .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (onThread?.id) return String(onThread.id);
    }
  } catch { /* an unreadable source is no source */ }
  return null;
}

/** A meeting as a SOURCE OBJECT — what the room's compact card needs, all served, nothing composed
 *  by the kit. `attendees` are display names minus the user (who is in the room already). */
export type MeetingSource = {
  id: string;
  /** The meeting page's own address key: the calendar event when linked (THE ONE NOTE ADDRESS). */
  addressId: string;
  title: string;
  startISO: string | null;
  attendees: string[];
  excerpt: string | null;
};

const labelOf = (a: unknown): string | null => {
  if (typeof a === 'string') return a.replace(/<[^>]*>/g, '').trim() || null;
  const o = (a ?? {}) as { name?: unknown; displayName?: unknown; email?: unknown };
  return String(o.name ?? o.displayName ?? '').trim() || String(o.email ?? '').trim() || null;
};

/** Read a meeting-born commitment's source meeting (transcript row + its calendar event). */
export async function meetingSourceOf(
  client: SupabaseClient, userId: string, meetingId: string,
  isUser?: (who: string) => boolean,
): Promise<MeetingSource | null> {
  try {
    const { data: mt } = await client.from('meeting_transcripts')
      .select('id, title, start_time, created_at, attendees, calendar_event_id, summary')
      .eq('id', meetingId).eq('user_id', userId).maybeSingle();
    if (!mt) return null;
    const names: string[] = [];
    for (const a of Array.isArray(mt.attendees) ? mt.attendees as unknown[] : []) { const l = labelOf(a); if (l) names.push(l); }
    let title = String(mt.title ?? '').trim() || 'Meeting';
    let startISO = (mt.start_time as string | null) ?? (mt.created_at as string | null) ?? null;
    if (mt.calendar_event_id) {
      const { data: ev } = await client.from('calendar_events').select('title, start_time, attendees')
        .eq('id', mt.calendar_event_id as string).eq('user_id', userId).maybeSingle();
      if (ev) {
        if (ev.title) title = String(ev.title);
        if (ev.start_time) startISO = String(ev.start_time);
        for (const a of Array.isArray(ev.attendees) ? ev.attendees as unknown[] : []) { const l = labelOf(a); if (l) names.push(l); }
      }
    }
    const seen = new Set<string>();
    const attendees = names.filter((n) => {
      const k = n.toLowerCase();
      if (seen.has(k) || (isUser && isUser(n))) return false;
      seen.add(k); return true;
    });
    const summary = typeof mt.summary === 'string' ? mt.summary.replace(/\s+/g, ' ').trim() : '';
    return {
      id: String(mt.id),
      addressId: String(mt.calendar_event_id ?? mt.id),
      title, startISO, attendees,
      excerpt: summary ? clipForPrompt(summary, MEETING_SOURCE_EXCERPT_CHARS) : null,
    };
  } catch { return null; }
}
