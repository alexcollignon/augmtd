import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { createMeetingBot } from '@/lib/integrations/meeting-bot/client';
import { getOAuth2Client } from '@/lib/google/oauth';

// POST /api/meetings/[id]/enable-bot
// Re-enable the meeting assistant for an event the user previously cancelled.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.MEETING_BOT_SERVICE_URL) {
    return NextResponse.json({ error: 'Bot service not configured' }, { status: 500 });
  }

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: event } = await adminClient
    .from('calendar_events')
    .select('id, title, meeting_link, start_time, attendee_bot_id, attendee_bot_state')
    .eq('id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if (!event.meeting_link) return NextResponse.json({ error: 'No meeting link' }, { status: 400 });
  if (!event.meeting_link.includes('meet.google.com')) {
    return NextResponse.json({ error: 'Only Google Meet is supported' }, { status: 400 });
  }

  // Block if a bot is already active (not cancelled, not absent)
  if (event.attendee_bot_id || (event.attendee_bot_state && event.attendee_bot_state !== 'cancelled')) {
    return NextResponse.json({ error: 'Assistant already scheduled or active' }, { status: 400 });
  }

  // Get user's name for bot display
  const { data: profile } = await adminClient
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const firstName = profile?.full_name?.split(' ')[0] ?? 'Your';
  const botName = `${firstName}'s Assistant`;

  // Get Google OAuth token
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

  const now = new Date();
  const meetingStart = new Date(event.start_time);
  const minJoinTime = new Date(now.getTime() + 2 * 60 * 1000);
  const joinAt = meetingStart > minJoinTime ? meetingStart : minJoinTime;

  const result = await createMeetingBot(event.meeting_link, joinAt, event.id, user.id, botName, googleAccessToken);

  await adminClient
    .from('calendar_events')
    .update({
      attendee_bot_id: result.botId,
      attendee_bot_state: 'scheduled',
      attendee_bot_created_at: new Date().toISOString(),
    })
    .eq('id', event.id);

  return NextResponse.json({ success: true, botId: result.botId });
}
