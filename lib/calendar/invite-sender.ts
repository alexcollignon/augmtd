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
