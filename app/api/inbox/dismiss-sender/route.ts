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

    // The FYI group label is from_name (falling back to from), so match either column. We fetch the
    // matching items first, then update each so we can merge source_data.resolved_at (the REAL
    // resolution timestamp the Day-cleared ring counts by) per row — a bulk .update() can't do a
    // per-row jsonb merge. Dedup ids across both columns so a row matched twice is stamped once.
    const nowIso = new Date().toISOString();
    const seen = new Set<string>();
    for (const col of ['from_name', 'from'] as const) {
      const { data: rows } = await supabase.from('inbox_items')
        .select('id, source_data')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .in('work_state', ['noted', 'noise'])
        .eq(`source_data->>${col}`, sender);
      for (const row of (rows ?? []) as Array<{ id: string; source_data: Record<string, unknown> | null }>) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const sd = (row.source_data ?? {}) as Record<string, unknown>;
        await supabase.from('inbox_items')
          .update({ status: 'dismissed', source_data: { ...sd, resolved_at: nowIso }, updated_at: nowIso })
          .eq('id', row.id)
          .eq('user_id', user.id)
          .eq('status', 'pending');
      }
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
