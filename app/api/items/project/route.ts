import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/items/project — set (or clear) an atom's project membership MANUALLY. Powers "remove from
// project" (projectId: null) and "add to project" (projectId: <id>). A manual change sets project_locked =
// true so the magnet won't auto-touch it again — a human decision outranks the machine, permanently (so a
// detach STICKS instead of the magnet bouncing it right back on the next auto-run).
// Body: { kind: 'inbox' | 'commitment' | 'meeting', id, projectId: string | null }
const TABLE: Record<string, string> = { inbox: 'inbox_items', commitment: 'commitments', meeting: 'meeting_transcripts' };

// GET /api/items/project?kind=meeting&id=X → { projectId } — the atom's current project (so a control can
// be self-contained: pass just the id, resolve its own membership).
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind') || '';
    const id = searchParams.get('id') || '';
    const table = TABLE[kind];
    if (!id || !table) return NextResponse.json({ error: 'kind and id required' }, { status: 400 });
    const { data } = await supabase.from(table).select('project_id').eq('id', id).eq('user_id', user.id).maybeSingle();
    return NextResponse.json({ projectId: (data as { project_id?: string | null } | null)?.project_id ?? null });
  } catch {
    return NextResponse.json({ projectId: null });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, id, projectId } = (await request.json()) as { kind?: string; id?: string; projectId?: string | null };
    const table = kind ? TABLE[kind] : null;
    if (!id || !table) return NextResponse.json({ error: 'kind and id required' }, { status: 400 });

    const { error: uErr } = await supabase.from(table).update({ project_id: projectId ?? null, project_locked: true }).eq('id', id).eq('user_id', user.id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    // A meeting's context also lives in its knowledge_file — keep project scoping in sync so project-scoped
    // KB retrieval matches the manual decision (link = provider_file_id transcript::<id>).
    if (kind === 'meeting') {
      await supabase.from('knowledge_files').update({ project_id: projectId ?? null }).eq('user_id', user.id).eq('provider_file_id', `transcript::${id}`).then(() => {}, () => {});
    }
    // Bust the Home brief so In-motion / activeInitiatives recompute with the new membership.
    await supabase.from('profiles').update({ home_brief: null }).eq('id', user.id).then(() => {}, () => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[items/project] error:', e);
    return NextResponse.json({ error: 'Could not update the item.' }, { status: 500 });
  }
}
