import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { cancelMeetingBot } from '@/lib/integrations/meeting-bot/client';

// DELETE /api/meetings/[id]/cancel-bot
// Cancel a scheduled (not yet joined) meeting assistant.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: event } = await adminClient
    .from('calendar_events')
    .select('id, attendee_bot_id, attendee_bot_state')
    .eq('id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  if (event.attendee_bot_state !== 'scheduled') {
    return NextResponse.json({ error: 'Can only cancel a scheduled assistant' }, { status: 400 });
  }

  // Clear DB state first
  await adminClient
    .from('calendar_events')
    .update({ attendee_bot_id: null, attendee_bot_state: 'cancelled', attendee_bot_created_at: null })
    .eq('id', eventId);

  // Tell the bot service (fire-and-forget)
  if (event.attendee_bot_id && process.env.MEETING_BOT_SERVICE_URL) {
    cancelMeetingBot(event.attendee_bot_id).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
