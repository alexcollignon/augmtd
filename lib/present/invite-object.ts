// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE AS ITS OBJECT (W7.4 — INVITES ARE EVENTS; the kit's EVENT card, docs/component-map.md
// W2). An invitation email is not "a message" to the reader — it is a meeting. The room used to show
// it as raw mail ("…You have been invited… YesNoMaybeMore options… Sent by Google"), because the
// object mount only knew one kind. This module decides, server-side, WHAT the object is and hands
// the mount everything it renders:
//
//   · THE ROW EXISTS (linked by identity — lib/calendar/invite-link.ts): the event's own spec,
//     through the ONE builder (`buildEvent`) — the seat, the live response, whether it has passed.
//     RSVP verbs ride ONLY when the user is an INVITEE of a still-open meeting; any other seat shows
//     the card with no verbs (the calendar itself is where an organiser moves a meeting).
//   · NO ROW (beyond the sync horizon, or not yet synced): the invite's OWN facts — title, when,
//     where, organiser, guests — composed here in the user's zone, with NO verbs. There is no event
//     to act on, so there is no deed: never a button that pretends.
//   · A CANCELLATION: the invite's facts with no verbs and one honest line, whatever the row says.
//   · A legacy item with no parsed invite: NOT an invite object — a heuristic `calendar_event_id`
//     from before W7.4 is not trusted to name the meeting (the census found it wrong 36 times in 66).
//
// ZERO AI. Labels are CODE's (the schedule window's own day pairing — THE ANCHOR LAW).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventSpec } from '@/lib/present/event';
import { inviteIsCancelled, type InviteFacts } from '@/lib/calendar/ics';
import { dayChip } from '@/lib/present/build';
import { weekdayOf } from '@/lib/calendar/schedule-window';

/** The facts the ICS-only card prints — every string composed by code, nothing to derive. */
export type InviteCardFacts = {
  title: string;
  dayLabel: string;
  timeLabel: string;
  organizer: string | null;
  attendees: string[];
  moreAttendees: number;
  location: string | null;
  cancelled: boolean;
  passed: boolean;
  recurring: boolean;
};

/** What the thread door serves about an invite. `spec` = a live calendar row; else `card`. */
export type InviteObject = {
  cancelled: boolean;
  spec: EventSpec | null;
  card: InviteCardFacts | null;
};

const ATTENDEE_CAP = 6;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

const dayIn = (ms: number, tz: string): string => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
};
const clockIn = (ms: number, tz: string): string => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(11, 16); }
};

/** "sam.rivera" → "Sam Rivera" — an address is never printed as a person's name. */
function humanize(address: string): string {
  const local = String(address ?? '').split('@')[0] ?? '';
  const words = local.replace(/\d+/g, ' ').split(/[._\-+]+/).map((w) => w.trim()).filter((w) => w.length > 1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.join(' ') || local;
}

const personLabel = (p: { address: string; name: string | null }, names?: Map<string, string>): string =>
  (p.name && !EMAIL_SHAPE.test(p.name) ? p.name : '') || names?.get(p.address) || humanize(p.address);

/**
 * PURE: the invite's own facts → the card's labels, in the user's zone. `mine` = the user's own
 * addresses (the user is never listed as a guest of their own card).
 */
export function composeInviteCard(
  invite: InviteFacts,
  ctx: { tz: string; mine: Set<string>; now: Date; names?: Map<string, string> },
): InviteCardFacts {
  let dayLabel = '';
  let timeLabel = '';
  let endMs = NaN;
  if (invite.allDay && invite.startDate) {
    dayLabel = dayChip({ dayStr: invite.startDate, weekday: weekdayOf(invite.startDate) });
    timeLabel = 'all day';
    // The end date is EXCLUSIVE (iCalendar); a missing one is the start's own day.
    endMs = invite.endDate ? Date.parse(`${invite.endDate}T00:00:00Z`) : Date.parse(`${invite.startDate}T23:59:59Z`);
  } else if (invite.startISO) {
    const s = Date.parse(invite.startISO);
    const e = invite.endISO ? Date.parse(invite.endISO) : NaN;
    const day = dayIn(s, ctx.tz);
    dayLabel = dayChip({ dayStr: day, weekday: weekdayOf(day) });
    timeLabel = Number.isFinite(e) ? `${clockIn(s, ctx.tz)}–${clockIn(e, ctx.tz)}` : clockIn(s, ctx.tz);
    endMs = Number.isFinite(e) ? e : s;
  }
  const org = invite.organizer && !ctx.mine.has(invite.organizer.address) ? personLabel(invite.organizer, ctx.names) : null;
  const seen = new Set<string>();
  const all: string[] = [];
  for (const a of invite.attendees ?? []) {
    if (ctx.mine.has(a.address) || a.address === invite.organizer?.address) continue;
    const label = personLabel(a, ctx.names);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    all.push(label);
  }
  return {
    title: (invite.summary ?? '').replace(/\s+/g, ' ').trim() || '(untitled)',
    dayLabel, timeLabel,
    organizer: org,
    attendees: all.slice(0, ATTENDEE_CAP),
    moreAttendees: Math.max(0, all.length - ATTENDEE_CAP),
    location: invite.location ?? null,
    cancelled: inviteIsCancelled(invite),
    passed: Number.isFinite(endMs) ? endMs < ctx.now.getTime() : false,
    recurring: invite.recurring,
  };
}

/** PURE: the RSVP-only narrowing — a spec served AS AN INVITE carries verbs only for an invitee. */
export function inviteSpecOf(spec: EventSpec, invite: Pick<InviteFacts, 'method' | 'status'>): EventSpec {
  const rsvpOk = spec.facts.seat === 'invitee' && !inviteIsCancelled(invite);
  const rsvp = new Set(['accept', 'tentative', 'decline']);
  const verbs = rsvpOk ? spec.verbs.filter((v) => rsvp.has(v)) : [];
  return { ...spec, verbs, noteVerbs: (spec.noteVerbs ?? []).filter((v) => verbs.includes(v)) };
}

/** Does the item hold an invite object at all? Only a PARSED invite counts (see the header). */
export function storedInviteOf(sd: Record<string, unknown> | null | undefined): InviteFacts | null {
  const i = (sd?.invite ?? null) as InviteFacts | null;
  return i && typeof i.uid === 'string' && i.uid ? i : null;
}

/**
 * Build the object for one inbox item's stored invite. Null = not an invite object (render mail).
 * Every read is user-scoped through the caller's client; a failed read degrades to the ICS card.
 */
export async function buildInviteObject(
  client: SupabaseClient, userId: string, sd: Record<string, unknown> | null | undefined,
  opts: { now?: Date } = {},
): Promise<InviteObject | null> {
  const invite = storedInviteOf(sd);
  if (!invite) return null;
  const now = opts.now ?? new Date();
  const cancelled = inviteIsCancelled(invite);
  const { buildEvent, ownAddresses, resolveAttendeeNames } = await import('@/lib/present/event-build');
  const { userTimezone } = await import('@/lib/calendar/schedule-window');
  const [tz, mine] = await Promise.all([
    userTimezone(client, userId).catch(() => 'UTC'),
    ownAddresses(client, userId).catch(() => new Set<string>()),
  ]);
  const eventId = typeof sd?.calendar_event_id === 'string' ? sd.calendar_event_id : null;
  if (eventId && !cancelled) {
    const spec = await buildEvent(client, userId, eventId, { now, tz, mine }).catch(() => null);
    if (spec) return { cancelled, spec: inviteSpecOf(spec, invite), card: null };
  }
  const names = await resolveAttendeeNames(
    client, userId,
    [invite.organizer?.address, ...(invite.attendees ?? []).map((a) => a.address)].filter((a): a is string => !!a && !mine.has(a)),
  ).catch(() => new Map<string, string>());
  return { cancelled, spec: null, card: composeInviteCard(invite, { tz, mine, now, names }) };
}
