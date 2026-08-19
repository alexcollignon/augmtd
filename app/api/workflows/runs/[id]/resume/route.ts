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
//
// PHASE B — THE GATE MAY BELONG TO A TEAMMATE: authorization is no longer "the run is mine" but
// `canResumeRun` (lib/workflows/handoffs.ts), THE ONE authorization read — the owner always, an
// assignee only for THEIR parked handoff. Still ONE DOOR: same route, same response contract,
// same after() resume; a handoff decision additionally settles (closes the assignee's commitment,
// logs the waited time, narrates both sides), best-effort.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { approve?: boolean; note?: string };
    const approve = body.approve === true;

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { canResumeRun, settleHandoffDecision } = await import('@/lib/workflows/handoffs');
    const auth = await canResumeRun(admin, runId, user.id);
    // A refusal is indistinguishable from a missing run — a stranger learns nothing.
    if (!auth.ok || !auth.run || !auth.workflow) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 });
    }
    const run = auth.run;
    if (run.status !== 'awaiting_approval') {
      return NextResponse.json({ error: `run is ${String(run.status)} — nothing to approve` }, { status: 409 });
    }
    const wf = auth.workflow;
    // The handoff half settles only when the gate the run is parked at IS a handoff.
    const handoffGate = Boolean(auth.step);
    const settle = async () => {
      if (!handoffGate || !wf) return;
      try {
        await settleHandoffDecision(admin, {
          runId,
          workflow: { id: wf.id, user_id: wf.user_id, name: wf.name, agent_id: wf.agent_id ?? null },
          callerId: user.id,
          approved: approve,
        });
      } catch { /* the run row already carries the decision */ }
    };

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
      await settle();
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // Mark running NOW (the exactly-once claim), resume in after() — the send it was guarding
    // fires through the normal step path with the full completion machinery behind it.
    await admin.from('workflow_runs').update({ status: 'running' }).eq('id', runId);
    await settle();
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
