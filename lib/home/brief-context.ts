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
  const [calRes, commitRes] = await Promise.all([
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
  ]);

  const meetingPeople = new Set<string>();
  const lastMeetingAt = new Map<string, string>();
  const people = new Map<string, PersonContext>();
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
      p.meetings.push({ start: ev.start_time, title: ev.title });
      if (ev.start_time <= nowIso && (!p.lastMeetingAt || ev.start_time > p.lastMeetingAt)) p.lastMeetingAt = ev.start_time;
    }
  }

  for (const c of (commitRes?.data ?? []) as Array<{ description: string; direction: string; due_date?: string | null; counterparty?: string | null }>) {
    const email = emailOf(c.counterparty);
    const key = email || (c.counterparty || '').trim().toLowerCase();
    if (!key) continue;
    const p = ensure(key, !email && c.counterparty ? c.counterparty : undefined);
    p.commitments.push({ description: c.description, direction: c.direction, dueDate: c.due_date ?? null });
  }

  return { meetingPeople, lastMeetingAt, people };
}
