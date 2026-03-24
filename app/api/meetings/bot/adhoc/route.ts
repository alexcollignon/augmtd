import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createMeetingBot } from '@/lib/integrations/meeting-bot/client';
import { getOAuth2Client } from '@/lib/google/oauth';

// POST /api/meetings/bot/adhoc
// Schedule a bot for an ad-hoc meeting URL (no calendar event required).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.MEETING_BOT_SERVICE_URL) {
    return NextResponse.json({ error: 'Bot service not configured' }, { status: 500 });
  }

  const { meetingUrl } = await request.json() as { meetingUrl: string };
  if (!meetingUrl?.includes('meet.google.com')) {
    return NextResponse.json({ error: 'Only Google Meet URLs are supported' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const firstName = profile?.full_name?.split(' ')[0] ?? 'Your';
  const botName = `${firstName}'s Assistant`;

  let googleAccessToken: string | undefined;
  try {
    const { data: conn } = await supabase
      .from('connections')
      .select('metadata')
      .eq('user_id', user.id)
      .eq('provider', 'gmail')
      .eq('status', 'active')
      .single();
    if (conn?.metadata?.tokens) {
      const tokens = JSON.parse(Buffer.from(conn.metadata.tokens, 'base64').toString());
      const oauth2 = getOAuth2Client();
      oauth2.setCredentials(tokens);
      const { credentials } = await oauth2.refreshAccessToken();
      googleAccessToken = credentials.access_token ?? undefined;
    }
  } catch {}

  // Join in 30 seconds (gives user time to start the call)
  const joinAt = new Date(Date.now() + 30 * 1000);

  const result = await createMeetingBot(meetingUrl, joinAt, '', user.id, botName, googleAccessToken);

  return NextResponse.json({ success: true, botId: result.botId });
}
