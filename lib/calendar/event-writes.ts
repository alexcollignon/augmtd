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
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
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
 *  exactly as the underlying senders do — the caller decides what to say about it. */
export async function applyRsvp(t: EventWriteTarget, response: RsvpResponse): Promise<void> {
  if (t.provider === 'gmail') {
    await rsvpGmail({
      encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onGoogleTokenRefresh,
      eventId: String(t.row.event_id), response, userEmail: t.selfEmail,
    });
    return;
  }
  await rsvpOutlook({
    encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onOutlookTokenRefresh,
    eventId: String(t.row.event_id), response,
  });
}

/** Move the event. The provider patch takes the WHOLE shape, so the unchanged halves (title,
 *  attendees, timezone) come from the stored row — never from a caller's guess. */
export async function applyReschedule(
  t: EventWriteTarget, args: { startISO: string; endISO: string; notes?: string },
): Promise<void> {
  await applyEventUpdate(t, {
    title: t.row.title || 'Meeting',
    startISO: args.startISO, endISO: args.endISO,
    timezone: t.row.timezone || 'UTC',
    attendees: attendeeAddressesOf(t.row),
    ...(args.notes ? { notes: args.notes } : {}),
  });
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

/** Cancel the event with the provider (Google/Graph both notify the guests). */
export async function applyCancel(t: EventWriteTarget): Promise<void> {
  if (t.provider === 'gmail') {
    await deleteGmailEvent({
      encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onGoogleTokenRefresh,
      eventId: String(t.row.event_id),
    });
    return;
  }
  await deleteOutlookEvent({
    encryptedTokens: t.encryptedTokens, onTokenRefresh: t.onOutlookTokenRefresh,
    eventId: String(t.row.event_id),
  });
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
