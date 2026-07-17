import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

// PATCH /api/items/project — set (or clear) an atom's project membership MANUALLY. Powers "remove from
// project" (projectId: null) and "add to project" (projectId: <id>). A manual change sets project_locked =
// true so the magnet won't auto-touch it again — a human decision outranks the machine, permanently (so a
// detach STICKS instead of the magnet bouncing it right back on the next auto-run).
//
// SHARED NOTES: for a meeting the caller does NOT own (a teammate's note shared with them), membership is the
// RECIPIENT's own filing — stored on shared_note_receipts.project_id (mirrors the per-recipient folder), NOT
// the owner's transcript row. So a user can organise a shared note into their OWN projects without touching
// the owner's data. (The owner's transcript.project_id is the owner's own filing.)
// Body: { kind: 'inbox' | 'commitment' | 'meeting', id, projectId: string | null }
const TABLE: Record<string, string> = { inbox: 'inbox_items', commitment: 'commitments', meeting: 'meeting_transcripts' };

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET /api/items/project?kind=meeting&id=X → { projectId } — the atom's current project (so a control can
// be self-contained: pass just the id, resolve its own membership). For a shared meeting, resolves the
// recipient's OWN receipt project_id.
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
    if (data) return NextResponse.json({ projectId: (data as { project_id?: string | null }).project_id ?? null });
    // Not owned — for a meeting, resolve the recipient's own receipt filing.
    if (kind === 'meeting') {
      const { data: receipt } = await admin().from('shared_note_receipts').select('project_id').eq('transcript_id', id).eq('user_id', user.id).maybeSingle();
      return NextResponse.json({ projectId: (receipt as { project_id?: string | null } | null)?.project_id ?? null });
    }
    return NextResponse.json({ projectId: null });
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

    // Try the owned row first.
    const { data: owned } = await supabase.from(table).select('id').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (owned) {
      const { error: uErr } = await supabase.from(table).update({ project_id: projectId ?? null, project_locked: true }).eq('id', id).eq('user_id', user.id);
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
      // A meeting's context also lives in its knowledge_file — keep project scoping in sync so project-scoped
      // KB retrieval matches the manual decision (link = provider_file_id transcript::<id>).
      if (kind === 'meeting') {
        await supabase.from('knowledge_files').update({ project_id: projectId ?? null }).eq('user_id', user.id).eq('provider_file_id', `transcript::${id}`).then(() => {}, () => {});
      }
    } else if (kind === 'meeting') {
      // Not owned → a shared note. File it on the recipient's own receipt (verify shared access first).
      const adminClient = admin();
      const { data: t } = await adminClient.from('meeting_transcripts').select('user_id, sharing_mode, company_id').eq('id', id).maybeSingle();
      if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      // Access: an explicit receipt already exists (specific share), OR a live company-wide share they're a member of.
      let allowed = false;
      const { data: existing } = await adminClient.from('shared_note_receipts').select('id').eq('transcript_id', id).eq('user_id', user.id).maybeSingle();
      if (existing) allowed = true;
      else if ((t as { sharing_mode?: string }).sharing_mode === 'live' && (t as { company_id?: string }).company_id) {
        const { data: m } = await supabase.from('company_members').select('company_id').eq('user_id', user.id).eq('company_id', (t as { company_id?: string }).company_id!).eq('status', 'active').maybeSingle();
        allowed = !!m;
      }
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const { error: rErr } = await adminClient.from('shared_note_receipts').upsert(
        { transcript_id: id, user_id: user.id, project_id: projectId ?? null },
        { onConflict: 'transcript_id,user_id' },
      );
      if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    } else {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Bust the Home brief so In-motion / activeInitiatives recompute with the new membership.
    await supabase.from('profiles').update({ home_brief: null }).eq('id', user.id).then(() => {}, () => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[items/project] error:', e);
    return NextResponse.json({ error: 'Could not update the item.' }, { status: 500 });
  }
}
