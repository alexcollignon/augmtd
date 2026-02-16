/**
 * Attendee.dev API Client
 *
 * Simple API key-based integration for meeting bot transcription.
 */

const ATTENDEE_API_URL = 'https://app.attendee.dev/api/v1';

interface AttendeeBot {
  id: string;
  meeting_url: string;
  bot_name: string;
  state: 'scheduled' | 'joining' | 'active' | 'ended' | 'failed' | 'fatal_error';
  transcription_state: 'not_started' | 'in_progress' | 'completed' | 'failed';
}

interface AttendeeTranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;  // Seconds from start
}

interface AttendeeTranscript {
  segments: AttendeeTranscriptSegment[];
}

/**
 * Create a meeting bot for a specific meeting URL
 */
export async function createAttendeeBot(
  meetingUrl: string,
  botName: string = 'AUGMTD Assistant',
  joinAt?: string  // ISO 8601 format (e.g., "2024-01-15T10:30:00Z")
): Promise<AttendeeBot> {
  const apiKey = process.env.ATTENDEE_API_KEY;

  if (!apiKey) {
    throw new Error('ATTENDEE_API_KEY not configured');
  }

  const body: any = {
    meeting_url: meetingUrl,
    bot_name: botName,
  };

  // Add join_at for scheduled bots (must be at least 2 minutes in the future)
  if (joinAt) {
    body.join_at = joinAt;
  }

  const response = await fetch(`${ATTENDEE_API_URL}/bots`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create Attendee bot: ${error}`);
  }

  return response.json();
}

/**
 * Get bot status and state
 */
export async function getAttendeeBot(botId: string): Promise<AttendeeBot> {
  const apiKey = process.env.ATTENDEE_API_KEY;

  if (!apiKey) {
    throw new Error('ATTENDEE_API_KEY not configured');
  }

  const response = await fetch(`${ATTENDEE_API_URL}/bots/${botId}`, {
    headers: {
      'Authorization': `Token ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bot status: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get meeting transcript (only available after bot state = 'ended')
 */
export async function getAttendeeBotTranscript(botId: string): Promise<AttendeeTranscript> {
  const apiKey = process.env.ATTENDEE_API_KEY;

  if (!apiKey) {
    throw new Error('ATTENDEE_API_KEY not configured');
  }

  const response = await fetch(`${ATTENDEE_API_URL}/bots/${botId}/transcript`, {
    headers: {
      'Authorization': `Token ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch transcript: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Check if a URL is a supported meeting platform
 */
export function isSupportedMeetingUrl(url: string): boolean {
  if (!url) return false;

  const meetingPatterns = [
    /zoom\.us\/j\//i,
    /meet\.google\.com\//i,
    /teams\.microsoft\.com\//i,
    /teams\.live\.com\//i,
  ];

  return meetingPatterns.some(pattern => pattern.test(url));
}

/**
 * Extract meeting URL from various fields
 */
export function extractMeetingUrl(event: any): string | null {
  // Check location field
  if (event.location && isSupportedMeetingUrl(event.location)) {
    return event.location;
  }

  // Check description for meeting links
  if (event.description) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = event.description.match(urlRegex) || [];

    for (const url of urls) {
      if (isSupportedMeetingUrl(url)) {
        return url;
      }
    }
  }

  // Check conference data (Google Meet, etc.)
  if (event.conference_data?.entry_points) {
    for (const entry of event.conference_data.entry_points) {
      if (entry.uri && isSupportedMeetingUrl(entry.uri)) {
        return entry.uri;
      }
    }
  }

  return null;
}
