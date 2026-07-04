import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/activity — the user's own activity events, most-recent first. RLS-safe (cookie session).
// Query: ?limit=200 (cap 500), ?before=<ISO timestamp> for "load more" cursor pagination.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 500);
    const before = url.searchParams.get('before');

    let query = supabase
      .from('activity_events')
      .select('id, type, title, entity_type, entity_id, metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit + 1); // fetch one extra to detect hasMore

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error) {
      // Table may not exist yet (migration not applied) — degrade gracefully to empty.
      console.error('[activity] fetch failed:', error.message);
      return NextResponse.json({ events: [], hasMore: false });
    }

    const rows = data || [];
    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({ events, hasMore });
  } catch (error) {
    console.error('[activity] route error:', error);
    return NextResponse.json({ events: [], hasMore: false });
  }
}
