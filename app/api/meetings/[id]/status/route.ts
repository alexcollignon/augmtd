import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: event }, { data: transcript }] = await Promise.all([
    supabase
      .from('calendar_events')
      .select('attendee_bot_state')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('meeting_transcripts')
      .select('bot_state, processed')
      .eq('calendar_event_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    attendeeBotState: event?.attendee_bot_state ?? null,
    botState: transcript?.bot_state ?? null,
    processed: transcript?.processed ?? false,
  });
}
