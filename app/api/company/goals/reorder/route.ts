import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';

// Persists the full drag-and-drop order across ALL active goals (including the North
// Star). Position is the single source of truth for `kind` — whichever id is first
// becomes 'north_star', everything else becomes 'goal'. This is what lets dragging a
// regular goal into the first slot promote it (and demote the previous North Star).
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyWorkspace(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : null;
  if (!ids || ids.length === 0) return NextResponse.json({ error: 'ids array is required' }, { status: 400 });

  const results = await Promise.all(
    ids.map((id: string, index: number) =>
      supabase
        .from('company_goals')
        .update({ kind: index === 0 ? 'north_star' : 'goal', sort_order: index })
        .eq('id', id)
        .eq('company_id', company.id),
    ),
  );
  const failed = results.find(r => r.error);
  if (failed) {
    console.error('[company/goals/reorder] update error:', failed.error);
    return NextResponse.json({ error: 'Failed to save order' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
