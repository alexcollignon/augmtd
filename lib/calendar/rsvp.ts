import { google } from 'googleapis';
import { getOAuth2Client } from '@/lib/google/oauth';
import { getGraphClient } from '@/lib/microsoft/outlook';

interface OutlookTokens {
  accessToken: string;
  refreshToken: string;
  expiresOn: string;
}

type RsvpResponse = 'accepted' | 'tentative' | 'declined';

interface GoogleRsvpParams {
  encryptedTokens: string;
  onTokenRefresh: (tokens: string) => Promise<void>;
  eventId: string;
  response: RsvpResponse;
  userEmail: string;
}

interface OutlookRsvpParams {
  encryptedTokens: string;
  onTokenRefresh: (tokens: OutlookTokens) => Promise<void>;
  eventId: string;
  response: RsvpResponse;
}

const GOOGLE_TO_GCal: Record<RsvpResponse, string> = {
  accepted: 'accepted',
  tentative: 'tentative',
  declined: 'declined',
};

export async function rsvpGmail(params: GoogleRsvpParams): Promise<void> {
  const { encryptedTokens, onTokenRefresh, eventId, response, userEmail } = params;

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
      console.error('[RSVP] Google token refresh failed:', err);
      throw err;
    }
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Fetch the event to get the full attendees list
  let existingEvent: any;
  try {
    const { data } = await calendar.events.get({ calendarId: 'primary', eventId });
    existingEvent = data;
  } catch (err: any) {
    if (err?.code === 403 || err?.status === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }

  const attendees = (existingEvent.attendees ?? []).map((a: any) => {
    if (a.email === userEmail || a.self) {
      return { ...a, responseStatus: GOOGLE_TO_GCal[response] };
    }
    return a;
  });

  try {
    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
      requestBody: { attendees },
    });
  } catch (err: any) {
    if (err?.code === 403 || err?.status === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }
}

const OUTLOOK_ACTION: Record<RsvpResponse, string> = {
  accepted: 'accept',
  tentative: 'tentativelyAccept',
  declined: 'decline',
};

export async function rsvpOutlook(params: OutlookRsvpParams): Promise<void> {
  const { encryptedTokens, onTokenRefresh, eventId, response } = params;

  let graphClient: any;
  try {
    graphClient = await getGraphClient(encryptedTokens, onTokenRefresh);
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }

  const action = OUTLOOK_ACTION[response];
  try {
    await graphClient.api(`/me/calendar/events/${eventId}/${action}`).post({ sendResponse: true });
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.code === 403) throw { code: 'calendar_scope_required' };
    throw err;
  }
}
