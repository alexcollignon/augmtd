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
  joinAt: Date,
  calendarEventId: string,
  userId: string,
  botName: string = 'AUGMTD Assistant',
  googleAccessToken?: string
): Promise<{ botId: string }> {
  const base = getBotServiceBase();
  const response = await fetch(`${base}/join`, {
    method: 'POST',
    headers: getBotAuthHeaders(),
    body: JSON.stringify({ meetingUrl, joinAt: joinAt.toISOString(), botName, calendarEventId, userId, googleAccessToken }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to create self-hosted bot: ${body}`);
  }

  return response.json();
}

/**
 * Cancel a scheduled bot (fire-and-forget — ignores non-2xx).
 */
export async function cancelMeetingBot(botId: string): Promise<void> {
  try {
    const base = getBotServiceBase();
    await fetch(`${base}/bots/${botId}`, {
      method: 'DELETE',
      headers: getBotAuthHeaders(),
    });
  } catch {
    // Non-fatal — DB state is cleared by the caller regardless
  }
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

/**
 * Check whether a bot job still exists on the Hetzner service.
 * Returns true if found (200), false if not found (404).
 * Throws for any other non-2xx status (server error).
 */
export async function checkMeetingBotExists(botId: string): Promise<boolean> {
  const base = getBotServiceBase();
  const response = await fetch(`${base}/bots/${botId}`, {
    headers: getBotAuthHeaders(),
  });

  if (response.ok) return true;
  if (response.status === 404) return false;

  const body = await response.text().catch(() => response.statusText);
  throw new Error(`Bot status check failed (${response.status}): ${body}`);
}
