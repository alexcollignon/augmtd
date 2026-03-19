/**
 * Self-Hosted Meeting Bot Client — screenappai/meeting-bot
 *
 * Auth: Authorization: Bearer {MEETING_BOT_SECRET}
 * Base: MEETING_BOT_SERVICE_URL
 */

export interface SelfHostedBot {
  botId: string;
  state: 'scheduled' | 'joining' | 'joined' | 'recording' | 'ended' | 'failed';
  audioStoragePath?: string;
}

/**
 * Check if a URL is a supported meeting platform.
 * Reuses the same patterns as the Attendee.dev client.
 */
export function isSupportedMeetingUrl(url: string): boolean {
  if (!url) return false;

  const meetingPatterns = [
    /zoom\.us\/j\//i,
    /meet\.google\.com\//i,
    /teams\.microsoft\.com\//i,
    /teams\.live\.com\//i,
  ];

  return meetingPatterns.some((pattern) => pattern.test(url));
}

function getBotServiceBase(): string {
  const url = process.env.MEETING_BOT_SERVICE_URL;
  if (!url) throw new Error('MEETING_BOT_SERVICE_URL not configured');
  return url.replace(/\/$/, '');
}

function getBotAuthHeaders(): HeadersInit {
  const secret = process.env.MEETING_BOT_SECRET;
  if (!secret) throw new Error('MEETING_BOT_SECRET not configured');
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
}

/**
 * Ask the self-hosted bot service to join a meeting URL.
 */
export async function createMeetingBot(
  meetingUrl: string,
  joinAt: Date
): Promise<{ botId: string }> {
  const base = getBotServiceBase();
  const response = await fetch(`${base}/join`, {
    method: 'POST',
    headers: getBotAuthHeaders(),
    body: JSON.stringify({ meetingUrl, joinAt: joinAt.toISOString(), botName: 'AUGMTD Assistant' }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to create self-hosted bot: ${body}`);
  }

  return response.json();
}

/**
 * Get the current state (and optional audio path) of a self-hosted bot.
 */
export async function getMeetingBot(botId: string): Promise<SelfHostedBot> {
  const base = getBotServiceBase();
  const response = await fetch(`${base}/bots/${botId}`, {
    headers: getBotAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bot status: ${response.statusText}`);
  }

  return response.json();
}
