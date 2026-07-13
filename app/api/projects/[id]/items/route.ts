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
    return NextResponse.json({ items });
  } catch (e) {
    console.error('[projects/items] error:', e);
    return NextResponse.json({ items: [] });
  }
}
