// Shared brief context (Layer 1 of the "assemble → reconcile → synthesize" Home brief). An
// entity-centric view of the people you interact with, so the brief's sections can reconcile across
// sources instead of working in silos — e.g. drop a "confirm the meeting" email that's superseded by
// an actual meeting, or group everything about one person into a single coherent unit.
// See docs/inbox-coherence-plan.md + docs/brief-and-labeling-plan.md.
//
// B1: assembles the MEETING/CALENDAR + COMMITMENTS dimensions into a per-person map, keyed by email
// (falling back to a normalized name). It's designed to keep growing — add per-person email threads
// and a richer timeline here — and the reconciliation rules (entity grouping, resolution) + the
// eventual single synthesis pass all read from this one object.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;
const DAY = 86_400_000;

export interface PersonContext {
  /** email (preferred) or normalized name — the grouping key. */
  key: string;
  name?: string;
  meetings: Array<{ start: string; title?: string }>;
  commitments: Array<{ description: string; direction: string; dueDate?: string | null }>;
  /** most recent PAST meeting start (ISO) with this person. */
  lastMeetingAt?: string;
}

export interface BriefContext {
  /** Emails of people you have a meeting with — recently held or upcoming (for supersession). */
  meetingPeople: Set<string>;
  /** email → most recent PAST meeting start (ISO) — for resolving threads a meeting already covered. */
  lastMeetingAt: Map<string, string>;
  /** Per-person entity map (email/name → meetings + commitments) — for grouping + synthesis. */
  people: Map<string, PersonContext>;
}

const emailOf = (s?: string | null): string | null => {
  if (!s) return null;
  return (s.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || '').toLowerCase() || null;
};

export async function buildBriefContext(
  userId: string,
  self: string | undefined,
  now: Date,
  client: DBClient,
): Promise<BriefContext> {
  const [calRes, commitRes, txRes] = await Promise.all([
    client
      .from('calendar_events')
      .select('start_time, title, attendees')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('start_time', new Date(now.getTime() - 10 * DAY).toISOString())
      .lte('start_time', new Date(now.getTime() + 21 * DAY).toISOString())
      .order('start_time', { ascending: false })
      .limit(120),
    client
      .from('commitments')
      .select('description, direction, due_date, counterparty, status')
      .eq('user_id', userId)
      .eq('status', 'open')
      .limit(100),
    client
      .from('meeting_transcripts')
      .select('title, calendar_event_id, created_at')
      .eq('user_id', userId)
      .gte('created_at', new Date(now.getTime() - 14 * DAY).toISOString())
      .not('calendar_event_id', 'is', null)
      .limit(60),
  ]);

  const meetingPeople = new Set<string>();
  const lastMeetingAt = new Map<string, string>();
  const people = new Map<string, PersonContext>();
  const nameToEmail = new Map<string, string>(); // normalized attendee full name → email
  const firstTokenToEmail = new Map<string, string | null>(); // first name → email (null = ambiguous)
  const normName = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  const nowIso = now.toISOString();

  const ensure = (key: string, name?: string): PersonContext => {
    let p = people.get(key);
    if (!p) { p = { key, name, meetings: [], commitments: [] }; people.set(key, p); }
    if (name && !p.name) p.name = name;
    return p;
  };

  for (const ev of (calRes?.data ?? []) as Array<{ start_time: string; title?: string; attendees?: Array<{ email?: string; name?: string; displayName?: string }> }>) {
    for (const a of ev.attendees ?? []) {
      const e = (a?.email || '').toLowerCase();
      if (!e || e === self) continue;
      meetingPeople.add(e);
      if (ev.start_time <= nowIso && !lastMeetingAt.has(e)) lastMeetingAt.set(e, ev.start_time);
      const p = ensure(e, a?.name || a?.displayName);
      const _nm = normName(a?.name || a?.displayName || '');
      if (_nm) {
        nameToEmail.set(_nm, e);
        const _ft = _nm.split(' ')[0];
        // Track first name → email; mark null (ambiguous) if two different people share it.
        if (_ft) firstTokenToEmail.set(_ft, firstTokenToEmail.has(_ft) && firstTokenToEmail.get(_ft) !== e ? null : e);
      }
      p.meetings.push({ start: ev.start_time, title: ev.title });
      if (ev.start_time <= nowIso && (!p.lastMeetingAt || ev.start_time > p.lastMeetingAt)) p.lastMeetingAt = ev.start_time;
    }
  }

  // Data completeness: recorded meetings (transcripts) reference calendar events that may fall outside
  // the time window above — pull their attendees so a recorded meeting also counts as "met with".
  const txEventIds = [...new Set((txRes?.data ?? []).map((t: { calendar_event_id?: string }) => t.calendar_event_id).filter(Boolean))] as string[];
  if (txEventIds.length) {
    const { data: txEvents } = await client.from('calendar_events').select('id, start_time, title, attendees').in('id', txEventIds);
    const evById = new Map((txEvents ?? []).map((e: { id: string }) => [e.id, e]));
    for (const t of (txRes?.data ?? []) as Array<{ title?: string; calendar_event_id: string; created_at: string }>) {
      const ev = evById.get(t.calendar_event_id) as { start_time?: string; title?: string; attendees?: Array<{ email?: string; name?: string; displayName?: string }> } | undefined;
      if (!ev) continue;
      const start = ev.start_time || t.created_at;
      for (const a of ev.attendees ?? []) {
        const e = (a?.email || '').toLowerCase();
        if (!e || e === self) continue;
        meetingPeople.add(e);
        if (start <= nowIso && !lastMeetingAt.has(e)) lastMeetingAt.set(e, start);
        const p = ensure(e, a?.name || a?.displayName);
        const _nm = normName(a?.name || a?.displayName || '');
        if (_nm) {
          nameToEmail.set(_nm, e);
          const _ft = _nm.split(' ')[0];
          if (_ft) firstTokenToEmail.set(_ft, firstTokenToEmail.has(_ft) && firstTokenToEmail.get(_ft) !== e ? null : e);
        }
        if (!p.meetings.some((m) => m.start === start)) p.meetings.push({ start, title: t.title || ev.title });
        if (start <= nowIso && (!p.lastMeetingAt || start > p.lastMeetingAt)) p.lastMeetingAt = start;
      }
    }
  }

  for (const c of (commitRes?.data ?? []) as Array<{ description: string; direction: string; due_date?: string | null; counterparty?: string | null }>) {
    const email = emailOf(c.counterparty);
    // Resolve a name-only counterparty to a meeting attendee's email so their commitments + meetings
    // merge into ONE person (entity resolution) — conservative exact normalized-name match.
    const nm = c.counterparty ? normName(c.counterparty) : '';
    const ft = nm.split(' ')[0];
    const key = email || (nm && nameToEmail.get(nm)) || (ft ? firstTokenToEmail.get(ft) : null) || nm;
    if (!key) continue;
    const p = ensure(key, !email && c.counterparty ? c.counterparty : undefined);
    p.commitments.push({ description: c.description, direction: c.direction, dueDate: c.due_date ?? null });
  }

  return { meetingPeople, lastMeetingAt, people };
}
