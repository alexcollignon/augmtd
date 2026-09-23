// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CALENDAR WRITE PATH (Wave 2, Sep 22 — docs/component-map.md §4 + §6).
//
// Provider write code for RSVP / reschedule / cancel has existed for months (lib/calendar/rsvp.ts +
// invite-sender.ts) and was reachable from exactly TWO buttons: `/api/meetings/[id]/rsvp` and
// `/api/meetings/[id]`. Each of those routes carried its own copy of the same forty lines — load the
// event, load the connection, read `metadata.tokens`, build a provider-shaped token-refresh
// callback, branch gmail/outlook, translate a 403 into `calendar_scope_required`.
//
// Wave 2 adds a THIRD caller (the event card's deeds door). A third copy is how three callers start
// disagreeing about which provider to write to, or which error means "reconnect your calendar", so
// the copies collapse HERE and all three doors call these functions.
//
// WHAT THIS MODULE IS AND IS NOT:
//   • It is the TRANSPORT. It loads the write target, refreshes tokens, and fires the provider call.
//   • It is NOT the permission. Whether a verb is allowed on an event is `validEventVerbs`
//     (lib/present/event.ts) and it is enforced at the door, over facts the server re-derives.
//   • It is NOT the ledger. The commit-door claim, the activity log and the local-row update belong
//     to the caller, because only the caller knows what it is committing.
//
// Behaviour is byte-for-byte the behaviour the two existing routes had: same selects, same token
// callbacks, same 403 translation, same "already gone is success" on delete.
//
// W0.4 DEED CORRECTNESS (Sep 22) narrowed three things, each a class: a MOVE patches the window only
// (never the guest list, never an all-day event into a timed one); a NOTE rides the provider's own
// channel or is not offered (`noteVerbsFor` in lib/present/event.ts); an Outlook SERIES MASTER is
// refused for cancel/move rather than hitting every occurrence.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuth2Client } from '@/lib/google/oauth';
import { getGraphClient } from '@/lib/microsoft/outlook';
import { rsvpGmail, rsvpOutlook } from '@/lib/calendar/rsvp';
import {
  updateGmailEvent, updateOutlookEvent, deleteGmailEvent, deleteOutlookEvent,
} from '@/lib/calendar/invite-sender';

export type CalendarProvider = 'gmail' | 'outlook';
export type RsvpResponse = 'accepted' | 'tentative' | 'declined';

/** The columns every write needs. EXPLICIT (the silent-column law: a select naming a column that
 *  does not exist returns `data: null` with no error, and the whole write reads as "not found"). */
export const EVENT_WRITE_COLUMNS =
  'id, event_id, connection_id, provider, title, start_time, end_time, timezone, is_all_day, status, location, organizer, attendees';

export type EventWriteRow = {
  id: string;
  event_id: string | null;
  connection_id: string | null;
  provider: string | null;
  title: string | null;
  start_time: string;
  end_time: string | null;
  timezone: string | null;
  is_all_day: boolean | null;
  status: string | null;
  location: string | null;
  organizer: string | null;
  attendees: Array<Record<string, unknown>> | null;
};

export type EventWriteTarget = {
  row: EventWriteRow;
  provider: CalendarProvider;
  /** The mailbox this connection speaks as — the "self" attendee on a Google RSVP patch. */
  selfEmail: string;
  encryptedTokens: string;
  onGoogleTokenRefresh: (encrypted: string) => Promise<void>;
  onOutlookTokenRefresh: (tokens: { accessToken: string; refreshToken: string; expiresOn: string }) => Promise<void>;
};

/** Why a write cannot happen — NAMED, never a bare null (the caller has to say which). */
export type WriteTargetError = { error: 'event_not_found' | 'connection_not_found' | 'no_tokens'; status: 404 | 400 };

export const isWriteTargetError = (v: EventWriteTarget | WriteTargetError): v is WriteTargetError =>
  typeof (v as WriteTargetError).error === 'string';

/**
 * Load everything a provider write needs for ONE of the user's calendar events. User-scoped on both
 * reads (the event AND the connection), so a stranger's id is indistinguishable from a missing one.
 */
export async function loadEventWriteTarget(
  client: SupabaseClient, userId: string, calendarEventId: string,
): Promise<EventWriteTarget | WriteTargetError> {
  const { data: row } = await client.from('calendar_events')
    .select(EVENT_WRITE_COLUMNS)
    .eq('id', calendarEventId).eq('user_id', userId).maybeSingle();
  if (!row) return { error: 'event_not_found', status: 404 };
  const ev = row as unknown as EventWriteRow;
  if (!ev.connection_id || !ev.event_id) return { error: 'connection_not_found', status: 404 };

  const { data: connection } = await client.from('connections')
    .select('id, provider, metadata, provider_account_id')
    .eq('id', ev.connection_id).eq('user_id', userId).maybeSingle();
  if (!connection) return { error: 'connection_not_found', status: 404 };

  const conn = connection as unknown as {
    id: string; provider: string | null; metadata: Record<string, unknown> | null; provider_account_id: string | null;
  };
  const encryptedTokens = String((conn.metadata as { tokens?: string } | null)?.tokens ?? '');
  if (!encryptedTokens) return { error: 'no_tokens', status: 400 };

  const provider: CalendarProvider = (ev.provider ?? conn.provider) === 'gmail' ? 'gmail' : 'outlook';
  return {
    row: ev,
    provider,
    selfEmail: String(conn.provider_account_id ?? ''),
    encryptedTokens,
    onGoogleTokenRefresh: async (newEncrypted: string) => {
      await client.from('connections')
        .update({ metadata: { ...(conn.metadata ?? {}), tokens: newEncrypted } })
        .eq('id', conn.id);
    },
    onOutlookTokenRefresh: async (newTokens) => {
      const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
      await client.from('connections')
        .update({ metadata: { ...(conn.metadata ?? {}), tokens: newEncrypted } })
        .eq('id', conn.id);
    },
  };
}

/** RSVP as the user, on their own connection. Throws `{code:'calendar_scope_required'}` upward
 *  exactly as the underlying senders do — the caller decides what to say about it.
 *
 *  THE NOTE IS DELIVERED OR NOT OFFERED (W0.4): a `comment` rides the provider's own RSVP channel —
 *  Graph's `comment` on accept/tentativelyAccept/decline, Google's self-attendee `comment`. With no
 *  note the call is the unchanged one the meetings RSVP door has always made. */
export async function applyRsvp(t: EventWriteTarget, response: RsvpResponse, opts: { comment?: string } = {}): Promise<void> {
  const comment = (opts.comment ?? '').trim();
  if (t.provider === 'gmail') {
    if (!comment) {
      await rsvpGmail({
        encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onGoogleTokenRefresh,
        eventId: String(t.row.event_id), response, userEmail: t.selfEmail,
      });
      return;
    }
    const calendar = await googleCalendarOf(t);
    await asScopeError(async () => {
      const { data } = await calendar.events.get({ calendarId: 'primary', eventId: String(t.row.event_id) });
      const self = t.selfEmail.trim().toLowerCase();
      const attendees = (data.attendees ?? []).map((a) => (
        (a.email ?? '').toLowerCase() === self || a.self ? { ...a, responseStatus: response, comment } : a
      ));
      await calendar.events.patch({
        calendarId: 'primary', eventId: String(t.row.event_id), sendUpdates: 'all',
        requestBody: { attendees },
      });
    });
    return;
  }
  if (!comment) {
    await rsvpOutlook({
      encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onOutlookTokenRefresh,
      eventId: String(t.row.event_id), response,
    });
    return;
  }
  const graph = await graphOf(t);
  const action = response === 'accepted' ? 'accept' : response === 'tentative' ? 'tentativelyAccept' : 'decline';
  await asScopeError(() => graph.api(`/me/calendar/events/${String(t.row.event_id)}/${action}`)
    .post({ sendResponse: true, comment }));
}

/**
 * Move the event — START AND END ONLY (W0.4: THE GUEST LIST IS NOT OURS TO REWRITE).
 *
 * This used to route through the editor's full-shape patch, which rebuilt the attendee list from
 * the local row: Google lost optional flags and any guest added since the last sync, Graph forced
 * every guest to `required` with their address as their name, and an all-day event came back timed.
 * A move now PATCHES THE WINDOW and nothing else — the provider keeps every guest exactly as it
 * holds them — and an all-day event stays all-day (a `date`, never a `dateTime`).
 *
 * An Outlook SERIES MASTER is refused (`recurring_series`): the calendar sync reads
 * `/me/calendar/events`, which returns masters, not occurrences, so moving the row would move the
 * whole series.
 */
export async function applyReschedule(
  t: EventWriteTarget, args: { startISO: string; endISO: string; tz: string },
): Promise<void> {
  const allDay = t.row.is_all_day === true;
  const zone = t.row.timezone || args.tz || 'UTC';
  if (t.provider === 'gmail') {
    const calendar = await googleCalendarOf(t);
    const win = allDay
      ? allDayWindow(args.startISO, args.endISO, zone)
      : null;
    await asScopeError(() => calendar.events.patch({
      calendarId: 'primary', eventId: String(t.row.event_id), sendUpdates: 'all',
      requestBody: win
        ? { start: { date: win.startDate }, end: { date: win.endDate } }
        : {
          start: { dateTime: args.startISO, ...(t.row.timezone ? { timeZone: t.row.timezone } : {}) },
          end: { dateTime: args.endISO, ...(t.row.timezone ? { timeZone: t.row.timezone } : {}) },
        },
    }));
    return;
  }
  await refuseOutlookSeriesMaster(t);
  const graph = await graphOf(t);
  const win = allDay ? allDayWindow(args.startISO, args.endISO, zone) : null;
  await asScopeError(() => graph.api(`/me/calendar/events/${String(t.row.event_id)}`).patch(
    win
      ? {
        start: { dateTime: `${win.startDate}T00:00:00`, timeZone: zone },
        end: { dateTime: `${win.endDate}T00:00:00`, timeZone: zone },
      }
      : {
        // Graph reads `dateTime` as wall time IN `timeZone` — an instant is stated in UTC.
        start: { dateTime: utcWall(args.startISO), timeZone: 'UTC' },
        end: { dateTime: utcWall(args.endISO), timeZone: 'UTC' },
      },
  ));
}

/** An all-day move keeps its shape: the picked start's calendar date in the event's zone, and a
 *  whole-day span (end-exclusive, the convention both providers use). Pure. */
export function allDayWindow(startISO: string, endISO: string, zone: string): { startDate: string; endDate: string } {
  const s = Date.parse(startISO);
  const e = Date.parse(endISO);
  const days = Number.isFinite(s) && Number.isFinite(e) ? Math.max(1, Math.round((e - s) / 86_400_000)) : 1;
  const startDate = dateIn(s, zone);
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return { startDate, endDate: d.toISOString().slice(0, 10) };
}

function dateIn(ms: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** "2026-09-25T09:00:00.000Z" → "2026-09-25T09:00:00" — the wall clock of an instant in UTC. */
function utcWall(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19);
}

/** THE SERIES REFUSAL (W0.4). A cancel or a move addressed to an Outlook series master would hit
 *  every occurrence. Until the sync stores occurrence ids, we ASK the provider what the row is and
 *  refuse a master, honestly — never guess. A probe that cannot answer refuses too (nothing fired). */
export async function refuseOutlookSeriesMaster(t: EventWriteTarget): Promise<void> {
  if (t.provider !== 'outlook') return;
  const graph = await graphOf(t);
  const probe = await asScopeError(() => graph.api(`/me/calendar/events/${String(t.row.event_id)}`)
    .select(['type', 'recurrence']).get()) as { type?: string; recurrence?: unknown } | null;
  if (probe?.type === 'seriesMaster' || (probe?.recurrence && probe?.type !== 'occurrence' && probe?.type !== 'exception')) {
    throw { code: 'recurring_series' };
  }
}

/** The full provider patch — the shape the meeting EDITOR sends (title/attendees/zone may all
 *  change) and the shape `applyReschedule` narrows to a time-only move. ONE call site per provider. */
export async function applyEventUpdate(
  t: EventWriteTarget,
  args: { title: string; startISO: string; endISO: string; timezone: string; attendees: string[]; notes?: string },
): Promise<void> {
  const shape = {
    encryptedTokens: t.encryptedTokens,
    eventId: String(t.row.event_id),
    title: args.title, startTime: args.startISO, endTime: args.endISO,
    timezone: args.timezone, attendees: args.attendees,
    ...(args.notes !== undefined ? { notes: args.notes } : {}),
  };
  if (t.provider === 'gmail') {
    await updateGmailEvent({ ...shape, onTokenRefresh: t.onGoogleTokenRefresh });
    return;
  }
  await updateOutlookEvent({ ...shape, onTokenRefresh: t.onOutlookTokenRefresh });
}

/** Cancel the event with the provider (Google/Graph both notify the guests).
 *
 *  THE NOTE IS DELIVERED OR NOT OFFERED (W0.4): on Outlook a note rides Graph's organizer `cancel`
 *  action as its `comment`; Google's delete carries no message, so the card never offers one there
 *  (`noteVerbsFor`) and a stray one is ignored rather than claimed. An Outlook series master is
 *  refused (`recurring_series`) — cancelling the row would cancel the whole series. */
export async function applyCancel(t: EventWriteTarget, opts: { comment?: string } = {}): Promise<void> {
  if (t.provider === 'gmail') {
    await deleteGmailEvent({
      encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onGoogleTokenRefresh,
      eventId: String(t.row.event_id),
    });
    return;
  }
  await refuseOutlookSeriesMaster(t);
  const comment = (opts.comment ?? '').trim();
  if (comment) {
    const graph = await graphOf(t);
    try {
      await asScopeError(() => graph.api(`/me/calendar/events/${String(t.row.event_id)}/cancel`).post({ comment }));
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) return; // already gone — the delete path's own rule
      throw err;
    }
    return;
  }
  await deleteOutlookEvent({
    encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onOutlookTokenRefresh,
    eventId: String(t.row.event_id),
  });
}

/** One Google calendar client for this target, token-refreshed the way the senders do it. */
async function googleCalendarOf(t: EventWriteTarget) {
  const tokens = JSON.parse(Buffer.from(t.encryptedTokens, 'base64').toString());
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    await t.onGoogleTokenRefresh(Buffer.from(JSON.stringify(credentials)).toString('base64'));
  }
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/** One Graph client for this target (the shared client handles decrypt + refresh). */
async function graphOf(t: EventWriteTarget) {
  return asScopeError(() => getGraphClient(t.encryptedTokens, t.onOutlookTokenRefresh));
}

/** The one 403 translation every sender in this family makes. */
async function asScopeError<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err: unknown) {
    const e = err as { code?: unknown; status?: unknown; statusCode?: unknown };
    if (e?.code === 403 || e?.status === 403 || e?.statusCode === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }
}

/** The addresses on the row, in order, de-duped. Reads BOTH shapes the sync has written over time
 *  (`email` today; `emailAddress.address` on legacy Graph rows). */
export function attendeeAddressesOf(row: Pick<EventWriteRow, 'attendees'>): string[] {
  const out: string[] = [];
  for (const a of (row.attendees ?? [])) {
    const addr = attendeeAddress(a);
    if (addr && !out.includes(addr)) out.push(addr);
  }
  return out;
}

export function attendeeAddress(a: Record<string, unknown> | null | undefined): string {
  if (!a) return '';
  const direct = typeof a.email === 'string' ? a.email
    : typeof a.address === 'string' ? a.address
      : typeof (a.emailAddress as { address?: string } | undefined)?.address === 'string'
        ? String((a.emailAddress as { address?: string }).address) : '';
  return direct.trim().toLowerCase();
}

export function attendeeDisplayName(a: Record<string, unknown> | null | undefined): string {
  if (!a) return '';
  const name = typeof a.name === 'string' ? a.name
    : typeof a.displayName === 'string' ? a.displayName
      : typeof (a.emailAddress as { name?: string } | undefined)?.name === 'string'
        ? String((a.emailAddress as { name?: string }).name) : '';
  return name.trim();
}

/** THE LOCAL ROW FOLLOWS THE PROVIDER (parity with `/api/meetings/[id]/rsvp`): stamp BOTH keys —
 *  the sync writes `status`, the Google API speaks `responseStatus`, and a reader may hold either. */
export function attendeesWithResponse(
  row: Pick<EventWriteRow, 'attendees'>, selfEmail: string, response: RsvpResponse,
): Array<Record<string, unknown>> {
  const self = selfEmail.trim().toLowerCase();
  return (row.attendees ?? []).map((a) => (
    attendeeAddress(a) === self || a?.self === true
      ? { ...a, status: response, responseStatus: response }
      : a
  ));
}
