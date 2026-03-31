import { google } from 'googleapis';
import { getOAuth2Client } from '@/lib/google/oauth';
import { getGraphClient } from '@/lib/microsoft/outlook';

interface OutlookTokens {
  accessToken: string;
  refreshToken: string;
  expiresOn: string;
}

interface GoogleInviteParams {
  encryptedTokens: string;
  onTokenRefresh: (tokens: string) => Promise<void>;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  attendees: string[];
  notes?: string;
  includeMeetLink?: boolean;
}

interface OutlookInviteParams {
  encryptedTokens: string;
  onTokenRefresh: (tokens: OutlookTokens) => Promise<void>;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  attendees: string[];
  notes?: string;
  includeMeetLink?: boolean;
}

export async function sendGmailInvite(
  params: GoogleInviteParams
): Promise<{ eventId: string; meetLink?: string }> {
  const { encryptedTokens, onTokenRefresh, title, startTime, endTime, timezone, attendees, notes, includeMeetLink = true } = params;

  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      const newEncrypted = Buffer.from(JSON.stringify(credentials)).toString('base64');
      await onTokenRefresh(newEncrypted);
    } catch (err) {
      console.error('[InviteSender] Google token refresh failed:', err);
      throw err;
    }
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  let response: any;
  try {
    response = await calendar.events.insert({
      calendarId: 'primary',
      sendUpdates: 'all',
      conferenceDataVersion: includeMeetLink ? 1 : 0,
      requestBody: {
        summary: title,
        description: notes,
        start: { dateTime: startTime, timeZone: timezone },
        end: { dateTime: endTime, timeZone: timezone },
        attendees: attendees.map((email) => ({ email })),
        ...(includeMeetLink ? {
          conferenceData: {
            createRequest: {
              requestId: Math.random().toString(36).slice(2),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        } : {}),
      },
    });
  } catch (err: any) {
    if (err?.code === 403 || err?.status === 403) {
      throw { code: 'calendar_scope_required' };
    }
    throw err;
  }

  const event = response.data;
  return {
    eventId: event.id,
    meetLink: event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri,
  };
}

export async function sendOutlookInvite(
  params: OutlookInviteParams
): Promise<{ eventId: string }> {
  const { encryptedTokens, onTokenRefresh, title, startTime, endTime, timezone, attendees, notes, includeMeetLink = true } = params;

  let graphClient: any;
  try {
    graphClient = await getGraphClient(encryptedTokens, onTokenRefresh);
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) {
      throw { code: 'calendar_scope_required' };
    }
    throw err;
  }

  let event: any;
  try {
    event = await graphClient.api('/me/calendar/events').post({
      subject: title,
      ...(notes ? { body: { contentType: 'text', content: notes } } : {}),
      start: { dateTime: startTime, timeZone: timezone },
      end: { dateTime: endTime, timeZone: timezone },
      attendees: attendees.map((email) => ({
        emailAddress: { address: email, name: email },
        type: 'required',
      })),
      isOnlineMeeting: includeMeetLink,
    });
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) {
      throw { code: 'calendar_scope_required' };
    }
    throw err;
  }

  return { eventId: event.id };
}

export async function updateGmailEvent(
  params: GoogleInviteParams & { eventId: string }
): Promise<void> {
  const { encryptedTokens, onTokenRefresh, eventId, title, startTime, endTime, timezone, attendees, notes } = params;

  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      const newEncrypted = Buffer.from(JSON.stringify(credentials)).toString('base64');
      await onTokenRefresh(newEncrypted);
    } catch (err) {
      console.error('[InviteSender] Google token refresh failed:', err);
      throw err;
    }
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  try {
    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
      requestBody: {
        summary: title,
        description: notes,
        start: { dateTime: startTime, timeZone: timezone },
        end: { dateTime: endTime, timeZone: timezone },
        attendees: attendees.map((email) => ({ email })),
      },
    });
  } catch (err: any) {
    if (err?.code === 403 || err?.status === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }
}

export async function updateOutlookEvent(
  params: OutlookInviteParams & { eventId: string }
): Promise<void> {
  const { encryptedTokens, onTokenRefresh, eventId, title, startTime, endTime, timezone, attendees, notes } = params;

  let graphClient: any;
  try {
    graphClient = await getGraphClient(encryptedTokens, onTokenRefresh);
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }

  try {
    await graphClient.api(`/me/calendar/events/${eventId}`).patch({
      subject: title,
      ...(notes !== undefined ? { body: { contentType: 'text', content: notes } } : {}),
      start: { dateTime: startTime, timeZone: timezone },
      end: { dateTime: endTime, timeZone: timezone },
      attendees: attendees.map((email) => ({
        emailAddress: { address: email, name: email },
        type: 'required',
      })),
    });
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }
}

export async function deleteGmailEvent(params: {
  encryptedTokens: string;
  onTokenRefresh: (t: string) => Promise<void>;
  eventId: string;
}): Promise<void> {
  const { encryptedTokens, onTokenRefresh, eventId } = params;
  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    await onTokenRefresh(Buffer.from(JSON.stringify(credentials)).toString('base64'));
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId, sendUpdates: 'all' });
  } catch (err: any) {
    if (err?.code === 403 || err?.status === 403) throw { code: 'calendar_scope_required' };
    if (err?.code === 410 || err?.status === 410) return; // already deleted — treat as success
    throw err;
  }
}

export async function deleteOutlookEvent(params: {
  encryptedTokens: string;
  onTokenRefresh: (tokens: OutlookTokens) => Promise<void>;
  eventId: string;
}): Promise<void> {
  const { encryptedTokens, onTokenRefresh, eventId } = params;
  let graphClient: any;
  try {
    graphClient = await getGraphClient(encryptedTokens, onTokenRefresh);
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }
  try {
    await graphClient.api(`/me/calendar/events/${eventId}`).delete();
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) throw { code: 'calendar_scope_required' };
    if (err?.statusCode === 404 || err?.statusCode === 410) return; // already deleted — treat as success
    throw err;
  }
}
