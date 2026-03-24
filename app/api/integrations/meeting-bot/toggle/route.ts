import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createBotsForCalendarEvents } from '@/lib/integrations/meeting-bot/bot-manager';

/**
 * POST /api/integrations/meeting-bot/toggle
 *
 * Enable or disable the Meeting Assistant for the user.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { enabled } = await request.json();

    console.log(`[MeetingBot] ${enabled ? 'Enabling' : 'Disabling'} for user ${user.id}`);

    if (enabled && !process.env.MEETING_BOT_SERVICE_URL) {
      return NextResponse.json(
        { error: 'Meeting bot service not configured' },
        { status: 500 }
      );
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ attendee_enabled: enabled })
      .eq('id', user.id);

    if (updateError) {
      console.error('[MeetingBot] Failed to update preference:', updateError);
      throw updateError;
    }

    console.log(`[MeetingBot] Successfully ${enabled ? 'enabled' : 'disabled'} for user ${user.id}`);

    // When enabling, immediately schedule bots for any existing upcoming events
    if (enabled) {
      const { createClient: createAdmin } = await import('@supabase/supabase-js');
      const adminClient = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const botResult = await createBotsForCalendarEvents(user.id, adminClient);
      console.log(`[MeetingBot] Scheduled ${botResult.created} bots on enable`);
    }

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    console.error('[MeetingBot] Toggle error:', error);
    return NextResponse.json(
      { error: 'Failed to update Meeting Assistant' },
      { status: 500 }
    );
  }
}
