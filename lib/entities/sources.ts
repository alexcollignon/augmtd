// ONE BRAIN — SOURCE MAPPERS (Phase B widening). One place that turns each raw source row into the
// RecogItem the recognition pipeline reads. Every stream (email, meeting, commitment, calendar) enters
// the memory through the SAME structural→recall→judgment pipeline — no per-source association logic
// (the locked lesson: a new context type joins by flowing through the ONE pipeline, never a bespoke path).
//
// Structural notes: a COMMITMENT carries its email thread_id → most inherit their thread's entity with
// ZERO AI. A MEETING/CALENDAR event has no thread; content + attendees carry the judgment.

import type { RecogItem } from './recognize';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const attendeeNames = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : [])
    .map((a) => (typeof a === 'string' ? a : (a?.name || a?.displayName || a?.email || '')))
    .filter(Boolean).slice(0, 8);

export function itemFromInbox(it: Row): RecogItem {
  const sd = it.source_data ?? {};
  return {
    kind: 'inbox_item', id: String(it.id), title: String(it.work_title || sd.subject || ''),
    body: typeof sd.body === 'string' ? sd.body : null,
    from: (sd.from_name as string) || (sd.from_address as string) || null,
    at: (sd.received_at as string) ?? (it.created_at as string), threadId: (sd.thread_id as string) ?? null,
  };
}

export function itemFromMeeting(m: Row): RecogItem {
  return {
    kind: 'meeting', id: String(m.id), title: String(m.title || 'Meeting'),
    body: typeof m.summary === 'string' ? m.summary.slice(0, 900) : null,
    from: null, participants: attendeeNames(m.attendees),
    at: (m.start_time as string) ?? (m.created_at as string) ?? null, threadId: null,
  };
}

export function itemFromCommitment(c: Row): RecogItem {
  // PROVENANCE — a commitment is a fragment of its SOURCE (a meeting or an email). It inherits that
  // parent's entity structurally, never re-guessed on topic. `thread_id` still short-circuits email replies.
  const src = String(c.source || '');
  const parent = c.source_id
    ? (src === 'meeting' ? { kind: 'meeting' as const, id: String(c.source_id) }
      : (src === 'email' || src === 'inbox') ? { kind: 'inbox_item' as const, id: String(c.source_id) } : null)
    : null;
  return {
    kind: 'commitment', id: String(c.id), title: String(c.description || 'Commitment'),
    body: null, from: (c.counterparty as string) || null,
    at: (c.created_at as string) ?? null, threadId: (c.thread_id as string) ?? null,
    parent,
  };
}

export function itemFromCalendar(e: Row): RecogItem {
  return {
    kind: 'calendar_event', id: String(e.id), title: String(e.title || 'Meeting'),
    body: null, from: null, participants: attendeeNames(e.attendees),
    at: (e.start_time as string) ?? (e.created_at as string) ?? null, threadId: null,
  };
}
