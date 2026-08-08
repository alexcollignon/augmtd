import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 300;

// POST /api/workflows/runs/[id]/resume — THE APPROVAL DOOR (production arc step 2, the
// Executor-validated pause/resume shape). A run parked `awaiting_approval` either RESUMES past
// its approval step (approve: the remaining steps — including the send it was guarding — run in
// after(), landing through the normal completion path: materialise, narrate, advance the
// binding) or ends honestly (reject: status 'rejected', the room narrates, the standing debt
// stays visible until a run lands). Exactly-once: only an `awaiting_approval` run resumes — a
// double-click finds it already 'running'/'rejected' and refuses.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { approve?: boolean; note?: string };
    const approve = body.approve === true;

    const { data: run } = await supabase.from('workflow_runs')
      .select('id, workflow_id, user_id, status')
      .eq('id', runId).eq('user_id', user.id).maybeSingle();
    if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
    if (run.status !== 'awaiting_approval') {
      return NextResponse.json({ error: `run is ${String(run.status)} — nothing to approve` }, { status: 409 });
    }

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: wf } = await admin.from('workflows').select('id, user_id, name, agent_id').eq('id', run.workflow_id).maybeSingle();

    if (!approve) {
      const { error: rejErr } = await admin.from('workflow_runs').update({
        status: 'rejected', completed_at: new Date().toISOString(),
        error: body.note ? `Rejected by the user: ${String(body.note).slice(0, 200)}` : 'Rejected by the user',
      }).eq('id', runId);
      if (rejErr) return NextResponse.json({ error: `could not record the rejection: ${rejErr.message}` }, { status: 500 });
      if (wf) {
        try {
          const { data: c } = await admin.from('commitments').select('id')
            .eq('user_id', user.id).eq('source', 'workflow').eq('source_id', wf.id).eq('status', 'open').limit(1).maybeSingle();
          if (c) {
            const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
            const roomKey = await roomKeyForItem(admin, user.id, 'commitment', String(c.id));
            await writeRoomTurn(admin, user.id, roomKey, {
              role: 'system',
              text: `You held back this run of "${wf.name}"${body.note ? ` — ${String(body.note).slice(0, 140)}` : ''}. Nothing was delivered; it stays owed until a run lands.`,
              dedupeKey: `approval-rejected:${runId}`,
            });
          }
        } catch { /* the run status is the truth */ }
      }
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // Mark running NOW (the exactly-once claim), resume in after() — the send it was guarding
    // fires through the normal step path with the full completion machinery behind it.
    await admin.from('workflow_runs').update({ status: 'running' }).eq('id', runId);
    after(async () => {
      try {
        const { runWorkflow } = await import('@/lib/workflows/run-workflow');
        await runWorkflow({ workflowId: run.workflow_id, runId, triggerSource: 'manual', resumeFromApproval: true });
      } catch (e) { console.error('[runs/resume]', e); }
    });
    return NextResponse.json({ ok: true, status: 'resuming' });
  } catch (e) {
    console.error('[runs/resume]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
