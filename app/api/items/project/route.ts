import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/items/project — set (or clear) an item's project membership. Powers "remove from project"
// (projectId: null) — the essential undo for the auto-attach magnet — and manual add (projectId: <id>).
// Body: { kind: 'inbox' | 'commitment', id, projectId: string | null }
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, id, projectId } = (await request.json()) as { kind?: string; id?: string; projectId?: string | null };
    if (!id || (kind !== 'inbox' && kind !== 'commitment')) return NextResponse.json({ error: 'kind and id required' }, { status: 400 });
    const table = kind === 'commitment' ? 'commitments' : 'inbox_items';

    const { error: uErr } = await supabase.from(table).update({ project_id: projectId ?? null }).eq('id', id).eq('user_id', user.id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[items/project] error:', e);
    return NextResponse.json({ error: 'Could not update the item.' }, { status: 500 });
  }
}
