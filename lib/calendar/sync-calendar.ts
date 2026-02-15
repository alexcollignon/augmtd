/**
 * Calendar Sync
 *
 * Syncs calendar events from Gmail and Outlook using the same OAuth connections as email.
 * Events are stored in the calendar_events table.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';

interface Connection {
  id: string;
  user_id: string;
  provider: 'gmail' | 'outlook';
  provider_account_id: string;
  metadata: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
  };
}

interface CalendarEvent {
  user_id: string;
  connection_id: string;
  event_id: string;
  calendar_id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  meeting_link?: string | null;
  start_time: string;
  end_time: string;
  timezone?: string | null;
  is_all_day: boolean;
  organizer?: string | null;
  attendees: Array<{
    email: string;
    name?: string | null;
    status?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  }>;
  status: 'confirmed' | 'cancelled' | 'tentative';
  provider: 'gmail' | 'outlook';
  metadata: any;
}

/**
 * Sync calendar events for a connection
 */
export async function syncCalendarForConnection(
  connection: Connection,
  supabase: SupabaseClient,
  options: {
    daysAhead?: number;
    daysBehind?: number;
  } = {}
): Promise<{ synced: number; errors: string[] }> {
  const daysAhead = options.daysAhead || 14; // Next 2 weeks
  const daysBehind = options.daysBehind || 7; // Past week (for updates)

  console.log(`[CalendarSync] Starting sync for ${connection.provider} (${connection.provider_account_id})`);

  try {
    if (connection.provider === 'gmail') {
      return await syncGmailCalendar(connection, supabase, daysAhead, daysBehind);
    } else if (connection.provider === 'outlook') {
      return await syncOutlookCalendar(connection, supabase, daysAhead, daysBehind);
    } else {
      return { synced: 0, errors: [`Unsupported provider: ${connection.provider}`] };
    }
  } catch (error: any) {
    console.error(`[CalendarSync] Error syncing ${connection.provider}:`, error);
    return { synced: 0, errors: [error.message] };
  }
}

/**
 * Sync Gmail calendar events
 */
async function syncGmailCalendar(
  connection: Connection,
  supabase: SupabaseClient,
  daysAhead: number,
  daysBehind: number
): Promise<{ synced: number; errors: string[] }> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: connection.metadata.access_token,
    refresh_token: connection.metadata.refresh_token,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const timeMin = new Date(Date.now() - daysBehind * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: 100,
      singleEvents: true, // Expand recurring events
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    console.log(`[CalendarSync] Found ${events.length} Gmail events`);

    const errors: string[] = [];
    let synced = 0;

    for (const event of events) {
      try {
        // Skip events without start/end times
        if (!event.start || !event.end) {
          continue;
        }

        const calendarEvent: CalendarEvent = {
          user_id: connection.user_id,
          connection_id: connection.id,
          event_id: event.id!,
          calendar_id: 'primary',
          title: event.summary || '(No title)',
          description: event.description || null,
          location: event.location || null,
          meeting_link: extractMeetingLink(event.description, event.hangoutLink, event.location),
          start_time: event.start.dateTime || event.start.date!,
          end_time: event.end.dateTime || event.end.date!,
          timezone: event.start.timeZone,
          is_all_day: !event.start.dateTime, // All-day if no dateTime
          organizer: event.organizer?.email,
          attendees: (event.attendees || []).map(a => ({
            email: a.email!,
            name: a.displayName,
            status: a.responseStatus as any,
          })),
          status: event.status as any || 'confirmed',
          provider: 'gmail',
          metadata: event,
        };

        const { error } = await supabase
          .from('calendar_events')
          .upsert(calendarEvent, {
            onConflict: 'user_id,event_id,provider',
          });

        if (error) {
          errors.push(`Failed to save event ${event.id}: ${error.message}`);
        } else {
          synced++;
        }
      } catch (error: any) {
        errors.push(`Error processing event ${event.id}: ${error.message}`);
      }
    }

    return { synced, errors };
  } catch (error: any) {
    console.error('[CalendarSync] Gmail API error:', error);
    return { synced: 0, errors: [error.message] };
  }
}

/**
 * Sync Outlook calendar events
 */
async function syncOutlookCalendar(
  connection: Connection,
  supabase: SupabaseClient,
  daysAhead: number,
  daysBehind: number
): Promise<{ synced: number; errors: string[] }> {
  const client = Client.init({
    authProvider: (done) => {
      done(null, connection.metadata.access_token);
    },
  });

  const timeMin = new Date(Date.now() - daysBehind * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  try {
    const response = await client
      .api('/me/calendar/events')
      .select([
        'id',
        'subject',
        'bodyPreview',
        'body',
        'start',
        'end',
        'location',
        'attendees',
        'organizer',
        'isAllDay',
        'isCancelled',
        'onlineMeeting',
      ])
      .filter(`start/dateTime ge '${timeMin}' and start/dateTime le '${timeMax}'`)
      .orderby('start/dateTime')
      .top(100)
      .get();

    const events = response.value || [];
    console.log(`[CalendarSync] Found ${events.length} Outlook events`);

    const errors: string[] = [];
    let synced = 0;

    for (const event of events) {
      try {
        const calendarEvent: CalendarEvent = {
          user_id: connection.user_id,
          connection_id: connection.id,
          event_id: event.id,
          calendar_id: 'primary',
          title: event.subject || '(No title)',
          description: event.body?.content || event.bodyPreview || null,
          location: event.location?.displayName || null,
          meeting_link: event.onlineMeeting?.joinUrl || extractMeetingLink(event.body?.content, null, event.location?.displayName),
          start_time: event.start.dateTime,
          end_time: event.end.dateTime,
          timezone: event.start.timeZone,
          is_all_day: event.isAllDay || false,
          organizer: event.organizer?.emailAddress?.address,
          attendees: (event.attendees || []).map((a: any) => ({
            email: a.emailAddress.address,
            name: a.emailAddress.name,
            status: a.status?.response?.toLowerCase(),
          })),
          status: event.isCancelled ? 'cancelled' : 'confirmed',
          provider: 'outlook',
          metadata: event,
        };

        const { error } = await supabase
          .from('calendar_events')
          .upsert(calendarEvent, {
            onConflict: 'user_id,event_id,provider',
          });

        if (error) {
          errors.push(`Failed to save event ${event.id}: ${error.message}`);
        } else {
          synced++;
        }
      } catch (error: any) {
        errors.push(`Error processing event ${event.id}: ${error.message}`);
      }
    }

    return { synced, errors };
  } catch (error: any) {
    console.error('[CalendarSync] Outlook API error:', error);
    return { synced: 0, errors: [error.message] };
  }
}

/**
 * Extract meeting link from various sources
 */
function extractMeetingLink(description?: string | null, hangoutLink?: string | null, location?: string | null): string | null {
  // Google Meet link
  if (hangoutLink) {
    return hangoutLink;
  }

  // Check description for links
  if (description) {
    // Zoom
    const zoomMatch = description.match(/https:\/\/[\w-]+\.zoom\.us\/j\/[\d\w?=&]+/i);
    if (zoomMatch) return zoomMatch[0];

    // Google Meet
    const meetMatch = description.match(/https:\/\/meet\.google\.com\/[\w-]+/i);
    if (meetMatch) return meetMatch[0];

    // Microsoft Teams
    const teamsMatch = description.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[\w\-\.%]+/i);
    if (teamsMatch) return teamsMatch[0];
  }

  // Check location for links
  if (location) {
    const urlMatch = location.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) return urlMatch[0];
  }

  return null;
}
