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
// THE WAVE — THE GATE MAY ASK FOR MATERIAL, NOT A YES/NO: an `input` station parks the run for
// something only the person has, and the same door takes it (`{ input: { text?, kbFileId?, pin? } }`).
// It is still ONE DOOR: one authorization read, one settle seam, one after() resume — the payload
// says which kind of answer this park could accept, and the wrong kind is refused, never guessed.
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
    const body = (await request.json().catch(() => ({}))) as {
      approve?: boolean; note?: string;
      /** THE INPUT STATION (relay canvas, THE WAVE): what the person hands the parked run —
       *  pasted text, a pinned knowledge document, or both. `pin` also keeps the document in the
       *  workflow's inputs tray so later runs read it as standing reference. */
      input?: { text?: string; kbFileId?: string; pin?: boolean };
    };
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
    // NO LYING DOOR (relay canvas W3): a ⧉ SUBPROCESS park wears the same status but holds no
    // human decision — the child's completion is what resumes it. Approving it would re-enter a
    // station already claimed; rejecting it would strand a running child. Refuse, and say why.
    const { parkedGateOf } = await import('@/lib/workflows/process-state');
    const gate = parkedGateOf(
      { step_outputs: (run.step_outputs ?? []) as never },
      (auth.workflow.steps ?? null) as never,
    );
    if (gate.kind === 'subprocess') {
      return NextResponse.json({
        error: `This run is waiting on the '${gate.label}' process, not on you — it continues by itself when that delivers.`,
      }, { status: 409 });
    }
    const wf = auth.workflow;
    // The handoff half settles only when the gate the run is parked at IS a handoff.
    const handoffGate = Boolean(auth.step);
    const settle = async () => {
      if (!wf) return;
      try {
        if (handoffGate) {
          await settleHandoffDecision(admin, {
            runId,
            workflow: { id: wf.id, user_id: wf.user_id, name: wf.name, agent_id: wf.agent_id ?? null },
            callerId: user.id,
            approved: approve,
          });
          return;
        }
        // THE OWNER'S GATE (approval · guardrail hold) — ONE DEED ONE DOOR: the same resume that
        // decides the run clears the deck ask an UNBOUND park raised (lib/workflows/standing.ts).
        // A workflow with a standing binding raised no such row, and this read finds none.
        const { settleApprovalAsk } = await import('@/lib/workflows/standing');
        await settleApprovalAsk(admin, { runId, approved: approve, supplied: gate.kind === 'input' });
      } catch { /* the run row already carries the decision */ }
    };

    // ── THE INPUT STATION (relay canvas, THE WAVE): this park asks for MATERIAL, so the door that
    // answers it takes material. NO LYING DOOR in either direction: a bare approve is refused here
    // (approving supplies nothing, and the station would resume on an empty page), while a REJECT
    // falls through to the ordinary hold-back below — declining to supply is a real answer.
    //
    // WHAT THE PERSON SUPPLIED BECOMES THE STATION'S OWN STEP OUTPUT, appended under the SAME
    // conditional claim that takes the run out of its park (a double-send can only win once). The
    // run then re-enters through `resumeSeeded`, which passes NO human gate — so a later approval
    // parks again by construction, never silently passed by an input answer. ──
    if (gate.kind === 'input' && approve !== false) {
      if (!body.input || (!String(body.input.text ?? '').trim() && !String(body.input.kbFileId ?? '').trim())) {
        return NextResponse.json({
          error: 'This run is waiting for something from you, not a yes or no — paste it, or pin a document.',
        }, { status: 409 });
      }
      // THE ONE ANSWER (THE WAVE part 2): everything a supply IS — the ownership read, the size
      // ceiling, the document's own-user rule, the exactly-once claim, the settled deck ask, the
      // tray pin — lives in `answerInputStation` and is shared BYTE-FOR-BYTE with the sayable door
      // (`supply_run_input` in lib/tools/worker-tasks.ts). A second door must not mean a second set
      // of rules. What stays HERE is only what is this door's own shape: the bare-approve refusal
      // above, and the after() re-entry below.
      const { answerInputStation } = await import('@/lib/workflows/input-station');
      const answered = await answerInputStation(admin, {
        runId, callerId: user.id, input: body.input,
      });
      if (!answered.ok) return NextResponse.json({ error: answered.error }, { status: answered.status });
      const pinned = answered.pinned;

      after(async () => {
        try {
          const { runWorkflow } = await import('@/lib/workflows/run-workflow');
          await runWorkflow({ workflowId: run.workflow_id, runId, triggerSource: 'manual', resumeSeeded: true });
        } catch (e) { console.error('[runs/resume:input]', e); }
      });
      return NextResponse.json({ ok: true, status: 'resuming', supplied: true, pinned });
    }

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
      // A HELD-BACK CHILD NEVER STRANDS ITS PARENT (relay canvas W3): a rejection is a terminal
      // end like any other — whoever parked at a ⧉ station on this run hears about it.
      try {
        const { resumeParentsOf } = await import('@/lib/workflows/subprocess');
        await resumeParentsOf(admin, runId, { ok: false });
      } catch { /* the run status is the truth */ }
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
