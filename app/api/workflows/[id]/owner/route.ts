// ─── GET/PUT /api/workflows/[id]/owner — THE ACCOUNTABILITY OWNER (processes arc Phase B2) ────
// THE SPLIT LAW: `workflows.user_id` (the creator) stays the EXECUTION identity — whose mailbox,
// tier, coworkers and connections every run uses — and is never moved here. What moves is
// ACCOUNTABILITY: who carries the standing debt, whose approval a park defaults to, whose room
// the process speaks in. Stored via lib/workflows/owner.ts (item_plans kind='workflow_owner').
//
// Who may change it: the creator or the current owner. To whom: an active member of the caller's
// workspace only. Every change narrates (setWorkflowOwner) — a transfer is never silent.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export const maxDuration = 30;

async function loadWorkflow(id: string) {
  const { createClient: createAdmin } = await import('@supabase/supabase-js');
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await admin.from('workflows').select('id, user_id, name').eq('id', id).maybeSingle();
  return { admin, wf: data as { id: string; user_id: string; name: string } | null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

    const { admin, wf } = await loadWorkflow(id);
    if (!wf) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { ownerOf } = await import('@/lib/workflows/owner');
    const owner = await ownerOf(admin, wf.id, wf.user_id);
    // A stranger learns nothing: only the creator or the owner may read the accountability row.
    if (user.id !== wf.user_id && user.id !== owner.userId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ owner, creatorUserId: wf.user_id });
  } catch (e) {
    console.error('[workflows/owner GET]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

    const body = (await request.json().catch(() => ({}))) as { ownerUserId?: string; ownerName?: string };
    const ownerUserId = String(body.ownerUserId ?? '').trim();
    if (!ownerUserId) return NextResponse.json({ error: 'who should own this?' }, { status: 400 });

    const { admin, wf } = await loadWorkflow(id);
    if (!wf) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { ownerOf, setWorkflowOwner } = await import('@/lib/workflows/owner');
    const current = await ownerOf(admin, wf.id, wf.user_id);
    if (user.id !== wf.user_id && user.id !== current.userId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // THE TEAM BOUNDARY: ownership moves inside the workspace, never out of it.
    const { data: mine } = await supabase.from('company_members')
      .select('company_id').eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!mine?.company_id) return NextResponse.json({ error: 'no workspace' }, { status: 403 });
    const { data: theirs } = await supabase.from('company_members')
      .select('user_id').eq('company_id', mine.company_id).eq('user_id', ownerUserId)
      .eq('status', 'active').maybeSingle();
    if (!theirs) return NextResponse.json({ error: 'they are not in your workspace' }, { status: 403 });

    const r = await setWorkflowOwner(admin, {
      workflowId: wf.id, creatorUserId: wf.user_id, byUserId: user.id,
      newOwnerUserId: ownerUserId, newOwnerName: body.ownerName ?? null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    return NextResponse.json({ ok: true, owner: r.owner, creatorUserId: wf.user_id });
  } catch (e) {
    console.error('[workflows/owner PUT]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
