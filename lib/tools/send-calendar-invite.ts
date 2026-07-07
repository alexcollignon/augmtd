// ─── send_calendar_invite — real create/send a calendar invite ────────────────
// Wraps the (previously siloed) `lib/calendar/invite-sender.ts` — real Google
// Calendar `events.insert` / Graph `/me/calendar/events`, notifying attendees.
// Reached before ONLY via `/api/meetings/create`; now a registered tool so
// workflow `tool` steps + coworkers can call it, and the item-plan classifier
// can grade it (an atomic, IRREVERSIBLE capability — a real send).
//
// Connection resolution mirrors `/api/meetings/create`: the user's active
// gmail/outlook connection provides the encrypted tokens + provider.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendGmailInvite, sendOutlookInvite } from '@/lib/calendar/invite-sender';

export interface SendCalendarInviteConfig {
  title: string;
  startISO: string;             // ISO 8601 start datetime
  endISO: string;               // ISO 8601 end datetime
  attendees: string[];          // attendee email addresses
  description?: string;         // optional notes / agenda
  location?: string;            // optional (folded into notes — provider event has no plain location field here)
  timezone?: string;            // IANA tz; defaults to UTC
  includeMeetLink?: boolean;    // default true
}

export const sendCalendarInviteDefinition = {
  name: 'send_calendar_invite',
  description:
    "Create a real calendar event and send an invite to attendees (Google Calendar / Outlook). " +
    "This sends real notifications — it is a commit action, use it only when a meeting time and " +
    "attendees are confirmed. Provide ISO start/end, attendee emails, and an optional description.",
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Meeting title.' },
      startISO: { type: 'string', description: 'Start datetime in ISO 8601 (e.g. 2026-07-08T10:00:00).' },
      endISO: { type: 'string', description: 'End datetime in ISO 8601.' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses.' },
      description: { type: 'string', description: 'Optional notes / agenda for the invite.' },
      location: { type: 'string', description: 'Optional location (appended to the notes).' },
      timezone: { type: 'string', description: 'IANA timezone, e.g. Europe/Lisbon. Defaults to UTC.' },
      includeMeetLink: { type: 'boolean', description: 'Attach a Google Meet / Teams link. Default true.' },
    },
    required: ['title', 'startISO', 'endISO', 'attendees'],
  },
};

/**
 * executeSendCalendarInvite — resolves the user's active email connection and sends a real invite.
 * Non-fatal: returns a human-readable status string (never throws) so a workflow step reports cleanly.
 */
export async function executeSendCalendarInvite(
  config: SendCalendarInviteConfig,
  userId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const title = (config.title || '').trim();
  const startISO = (config.startISO || '').trim();
  const endISO = (config.endISO || '').trim();
  const attendees = Array.isArray(config.attendees) ? config.attendees.filter((a) => typeof a === 'string' && a.includes('@')) : [];
  const timezone = (config.timezone || '').trim() || 'UTC';

  if (!title || !startISO || !endISO) return 'Cannot send invite: title, startISO and endISO are all required.';
  if (attendees.length === 0) return 'Cannot send invite: at least one valid attendee email is required.';

  let notes = (config.description || '').trim();
  if (config.location?.trim()) notes = notes ? `${notes}\n\nLocation: ${config.location.trim()}` : `Location: ${config.location.trim()}`;

  // Resolve the user's active gmail/outlook connection (same pattern as /api/meetings/create).
  const { data: connection, error: connError } = await supabase
    .from('connections')
    .select('id, provider, metadata')
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('provider', ['gmail', 'outlook'])
    .limit(1)
    .maybeSingle();

  if (connError || !connection) return 'Cannot send invite: no active Google or Outlook connection found.';

  const encryptedTokens: string | undefined = connection.metadata?.tokens;
  if (!encryptedTokens) return 'Cannot send invite: no tokens found for the email connection.';

  const onGoogleTokenRefresh = async (newEncrypted: string) => {
    await supabase.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
  };
  const onOutlookTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
    const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
    await supabase.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
  };

  try {
    if (connection.provider === 'gmail') {
      const { eventId, meetLink } = await sendGmailInvite({
        encryptedTokens, onTokenRefresh: onGoogleTokenRefresh,
        title, startTime: startISO, endTime: endISO, timezone, notes,
        attendees, includeMeetLink: config.includeMeetLink !== false,
      });
      return `Sent calendar invite "${title}" to ${attendees.join(', ')} (event ${eventId})${meetLink ? ` — Meet: ${meetLink}` : ''}.`;
    } else {
      const { eventId } = await sendOutlookInvite({
        encryptedTokens, onTokenRefresh: onOutlookTokenRefresh,
        title, startTime: startISO, endTime: endISO, timezone, notes,
        attendees, includeMeetLink: config.includeMeetLink !== false,
      });
      return `Sent calendar invite "${title}" to ${attendees.join(', ')} (event ${eventId}).`;
    }
  } catch (err: any) {
    if (err?.code === 'calendar_scope_required') {
      return `Cannot send invite: calendar access not granted for the ${connection.provider} connection (re-authorize with calendar scope).`;
    }
    console.error('[send_calendar_invite] failed:', err);
    return `Failed to send calendar invite: ${err instanceof Error ? err.message : String(err)}`;
  }
}
