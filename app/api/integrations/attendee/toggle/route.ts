import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/integrations/attendee/toggle
 *
 * Enable or disable Attendee integration for the user
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { enabled } = await request.json();

    console.log(`[Attendee] ${enabled ? 'Enabling' : 'Disabling'} for user ${user.id}`);

    // Verify API key is configured
    if (enabled && !process.env.ATTENDEE_API_KEY) {
      return NextResponse.json(
        { error: 'Attendee API key not configured' },
        { status: 500 }
      );
    }

    // Update user's Attendee preference
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ attendee_enabled: enabled })
      .eq('id', user.id);

    if (updateError) {
      console.error('[Attendee] Failed to update preference:', updateError);
      throw updateError;
    }

    console.log(`[Attendee] Successfully ${enabled ? 'enabled' : 'disabled'} for user ${user.id}`);

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    console.error('[Attendee] Toggle error:', error);
    return NextResponse.json(
      { error: 'Failed to update Attendee integration' },
      { status: 500 }
    );
  }
}
