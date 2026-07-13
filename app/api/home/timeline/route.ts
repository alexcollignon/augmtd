import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems, partitionByTime } from '@/lib/work-items/model';

export const maxDuration = 20;

// GET /api/home/timeline — the unified work-item spine for the Home timeline view. Returns the flat
// WorkItem[] (the client groups into bucket lanes) + the history/upcoming split + today's date. Read-only
// over the live tables (cheap); no cache for v1 — the timeline is a "zoom out", not a hot path.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const todayStr = new Date().toISOString().slice(0, 10);
    const items = await buildWorkItems(supabase, user.id, { todayStr, includeCalendar: true, includeOutbound: true });
    const { history, upcoming } = partitionByTime(items);

    // Project name/color map so items can show a subtle "part of <initiative>" tag (loose items get none).
    const { data: projects } = await supabase.from('projects').select('id, name, color').eq('user_id', user.id).eq('status', 'active');
    const projectsById: Record<string, { name: string; color: string | null }> = {};
    for (const p of projects ?? []) projectsById[p.id as string] = { name: p.name as string, color: (p.color as string) ?? null };

    return NextResponse.json({ todayStr, items, projectsById, counts: { total: items.length, history: history.length, upcoming: upcoming.length } });
  } catch (e) {
    console.error('[home/timeline] error:', e);
    return NextResponse.json({ error: 'Could not build the timeline.' }, { status: 500 });
  }
}
