import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';

// POST /api/inbox/dismiss-sender — "mute sender": dismiss ALL pending awareness (fyi/noise) items
// from one sender. Powers the Home FYI digest's per-group dismiss. Matches the group's label against
// source_data.from_name and source_data.from. Scoped to awareness tiers so it never touches a
// needs_reply from the same sender.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sender } = await request.json();
    if (!sender || typeof sender !== 'string') {
      return NextResponse.json({ error: 'sender required' }, { status: 400 });
    }

    // The FYI group label is from_name (falling back to from), so match either column.
    for (const col of ['from_name', 'from'] as const) {
      await supabase.from('inbox_items')
        .update({ status: 'dismissed', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .in('work_state', ['noted', 'noise'])
        .eq(`source_data->>${col}`, sender);
    }

    // Activity timeline (non-fatal).
    await logActivity(supabase, user.id, {
      type: 'sender_muted',
      title: `Muted sender: ${sender}`,
      entityType: 'sender',
      entityId: sender,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Dismiss-sender error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
