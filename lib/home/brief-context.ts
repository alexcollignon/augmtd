// Shared brief context (Layer 1 of the "assemble → reconcile → synthesize" Home brief). An
// entity-centric view of the people you interact with, so the brief's sections can reconcile across
// sources instead of working in silos — e.g. drop a "confirm the meeting" email that's superseded by
// an actual meeting. See docs/inbox-coherence-plan.md.
//
// v1 assembles the MEETING/CALENDAR dimension (the highest-value cross-reference). It's designed to
// grow: add per-person email threads, commitments, and a timeline here, and the reconciliation rules
// + the eventual single synthesis pass all read from this one object.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;
const DAY = 86_400_000;

export interface BriefContext {
  /** Emails of people you have a meeting with — recently held or upcoming (for supersession). */
  meetingPeople: Set<string>;
  /** email → most recent PAST meeting start (ISO) — for resolving threads a meeting already covered. */
  lastMeetingAt: Map<string, string>;
}

export async function buildBriefContext(
  userId: string,
  self: string | undefined,
  now: Date,
  client: DBClient,
): Promise<BriefContext> {
  const meetingPeople = new Set<string>();
  const lastMeetingAt = new Map<string, string>();

  const { data: events } = await client
    .from('calendar_events')
    .select('start_time, attendees')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .gte('start_time', new Date(now.getTime() - 10 * DAY).toISOString())
    .lte('start_time', new Date(now.getTime() + 21 * DAY).toISOString())
    .order('start_time', { ascending: false })
    .limit(120);

  const nowIso = now.toISOString();
  for (const ev of (events ?? []) as Array<{ start_time: string; attendees?: Array<{ email?: string }> }>) {
    for (const a of ev.attendees ?? []) {
      const e = (a?.email || '').toLowerCase();
      if (!e || e === self) continue;
      meetingPeople.add(e);
      // events are ordered start desc → the first PAST one per person is their most recent meeting.
      if (ev.start_time <= nowIso && !lastMeetingAt.has(e)) lastMeetingAt.set(e, ev.start_time);
    }
  }

  return { meetingPeople, lastMeetingAt };
}
