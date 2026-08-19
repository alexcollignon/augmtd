// ─── POST /api/workflows/runs/[id]/reassign — THE GATE MOVES (processes arc Phase B2) ─────────
// A parked handoff belongs to a person; sometimes the wrong person. This is the ONE WRITER of the
// per-run assignee override (`item_plans` kind='handoff_override') — every reader (canResumeRun,
// the SLA chase, the served ledger strip) consults that store, so there is no second door and no
// surface can disagree about who holds the gate. The authored workflow step NEVER changes: a
// per-run decision is not an authoring change.
//
// Owner-only (the creator or the accountability owner — canResumeRun's one read), and the new
// assignee must be an active member of the caller's workspace: a gate can only move INSIDE the
// team that can see it.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

    const body = (await request.json().catch(() => ({}))) as { assigneeUserId?: string; assigneeName?: string };
    const assigneeUserId = String(body.assigneeUserId ?? '').trim();
    if (!assigneeUserId) return NextResponse.json({ error: 'who should hold this?' }, { status: 400 });

    // THE TEAM BOUNDARY: same active workspace, both people.
    const { data: mine } = await supabase.from('company_members')
      .select('company_id').eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!mine?.company_id) return NextResponse.json({ error: 'no workspace' }, { status: 403 });
    const { data: theirs } = await supabase.from('company_members')
      .select('user_id').eq('company_id', mine.company_id).eq('user_id', assigneeUserId)
      .eq('status', 'active').maybeSingle();
    if (!theirs) return NextResponse.json({ error: 'they are not in your workspace' }, { status: 403 });

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { reassignHandoff } = await import('@/lib/workflows/handoffs');
    const r = await reassignHandoff(admin, {
      runId, byUserId: user.id,
      newAssigneeUserId: assigneeUserId,
      newAssigneeName: body.assigneeName ?? null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 403 });
    return NextResponse.json({ ok: true, assignee: r.assignee });
  } catch (e) {
    console.error('[runs/reassign]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
