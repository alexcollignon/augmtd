import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/commitments/[id] — set a commitment's status (done | dismissed) for the user's own
// commitment. Powers the Home's per-item Done/Dismiss on On-your-plate + Ball-in-your-court.
// `done` = fulfilled/handled; `dismissed` = not pursuing. Both drop it from the Home (the brief
// reads only status='open') and never resurface it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { status } = await request.json();
    if (status !== 'done' && status !== 'dismissed') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const { error } = await supabase
      .from('commitments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Clean up any inbox item the aging sweep surfaced for this commitment — it's handled now.
    await supabase.from('inbox_items').delete()
      .eq('user_id', user.id).eq('source', 'commitment').eq('source_id', id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Commitment status update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
