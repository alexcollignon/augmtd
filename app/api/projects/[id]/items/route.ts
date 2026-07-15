import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';

export const maxDuration = 20;

// GET /api/projects/[id]/items — the project's slice of the unified spine (WorkItems where projectId ===
// this project). Powers the project-detail Overview (scoped timeline) + Work tab. Read-only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const todayStr = new Date().toISOString().slice(0, 10);
    const all = await buildWorkItems(supabase, user.id, { todayStr, includeDoneWithinDays: 30, includeOutbound: true });
    const items = all.filter((w) => w.projectId === id);

    // The project's MEETINGS — first-class context (the deal's notes), not tasks. Tagged by the grounded
    // initiative + adopted by the magnet (meeting_transcripts.project_id). Read-only; empty pre-migration.
    let meetings: Array<{ id: string; title: string; date: string | null }> = [];
    try {
      const { data: mtgs } = await supabase.from('meeting_transcripts')
        .select('id, title, created_at').eq('user_id', user.id).eq('project_id', id)
        .order('created_at', { ascending: false }).limit(50);
      meetings = (mtgs ?? []).map((m: { id: string; title: string | null; created_at: string | null }) => ({ id: m.id, title: m.title || 'Untitled meeting', date: m.created_at }));
    } catch { /* pre-migration → no project_id column on meeting_transcripts */ }

    // Loose meetings (no project) — the pool the user can manually ADD to this project (the tail the strict
    // auto-assign deliberately left alone). Read-only; empty pre-migration.
    let looseMeetings: Array<{ id: string; title: string; date: string | null }> = [];
    try {
      const { data: loose } = await supabase.from('meeting_transcripts')
        .select('id, title, created_at').eq('user_id', user.id).is('project_id', null)
        .order('created_at', { ascending: false }).limit(50);
      looseMeetings = (loose ?? []).map((m: { id: string; title: string | null; created_at: string | null }) => ({ id: m.id, title: m.title || 'Untitled meeting', date: m.created_at }));
    } catch { /* pre-migration */ }

    return NextResponse.json({ items, meetings, looseMeetings });
  } catch (e) {
    console.error('[projects/items] error:', e);
    return NextResponse.json({ items: [] });
  }
}
