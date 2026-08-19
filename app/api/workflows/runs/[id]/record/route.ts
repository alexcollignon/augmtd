// ─── GET /api/workflows/runs/[id]/record — THE RUN RECORD (mockup-fidelity wave) ──────────────
// The read-only story of one run: its decisions, what drifted since the workflow last ran, and
// the arithmetic delta against that previous run. ONE derivation module behind it
// (`lib/workflows/run-record.ts`) — the History chips and the drawer's tabs are the same numbers.
//
// VISIBILITY: `canReadRunRecord` — the creator, the accountability owner, or anyone who has ever
// held a gate on THIS run. A stranger gets 404, identical to a run that does not exist: a refusal
// must never confirm that a run exists.
//
// HONESTY: nothing here is authored. `subject` rides the ONE subject ladder (deriveProcessRows),
// `ownerChangedBetween` is a real ledger read (an unreadable ledger is `false`, never a guess),
// and a decision whose timestamp the system never stored stays null.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import type { RunLike } from '@/lib/workflows/process-state';

export const maxDuration = 30;

type RunRow = RunLike & { user_id: string; thread_id?: string | null };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { canReadRunRecord, summarizeRun, driftChipsOf, vsPrevious } =
      await import('@/lib/workflows/run-record');
    const access = await canReadRunRecord(admin, runId, user.id);
    if (!access.ok || !access.run || !access.workflow) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 });
    }
    const run = access.run as RunRow;
    const workflow = access.workflow;

    // ── THE PREVIOUS COMPLETED RUN of the SAME workflow (succeeded · failed · rejected —
    //    a still-running or parked run is not a comparison, it's a work in progress). ──
    const { data: prevRows } = await admin.from('workflow_runs')
      .select('id, workflow_id, user_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
      .eq('workflow_id', workflow.id)
      .in('status', ['succeeded', 'failed', 'rejected'])
      .lt('created_at', run.created_at)
      .order('created_at', { ascending: false }).limit(1);
    const prevRun = ((prevRows ?? [])[0] ?? null) as RunRow | null;

    const current = await summarizeRun(admin, run, workflow);
    const previous = prevRun ? await summarizeRun(admin, prevRun, workflow) : null;

    // ── OWNER CHANGED BETWEEN THE TWO RUNS — a real ledger read, keyed under the CREATOR (the
    //    ledger row setWorkflowOwner writes). No previous run, or an unreadable ledger → false. ──
    let ownerChangedBetween = false;
    if (previous) {
      try {
        const from = previous.endedAt ?? previous.startedAt;
        const to = current.startedAt;
        if (from && to) {
          const { data: ev } = await admin.from('activity_events').select('id')
            .eq('user_id', access.creatorUserId!)
            .eq('type', 'workflow_owner_changed')
            .eq('entity_id', workflow.id)
            .gt('created_at', from).lte('created_at', to)
            .limit(1);
          ownerChangedBetween = Boolean((ev ?? []).length);
        }
      } catch { /* an unknown is never a chip */ }
    }

    // ── THE SUBJECT LADDER — the ONE derivation every other surface reads. ──
    let subject: string | undefined;
    try {
      const { deriveProcessRows } = await import('@/lib/workflows/process-state');
      const artTitleByRun = new Map<string, string>();
      if (run.thread_id) {
        const { data: th } = await admin.from('work_threads')
          .select('artifacts').eq('id', run.thread_id).maybeSingle();
        const arts = (Array.isArray((th as { artifacts?: unknown } | null)?.artifacts)
          ? (th as { artifacts: Array<{ title?: string; generated_at?: string }> }).artifacts : []);
        const latest = [...arts].sort((a, b) =>
          String(b.generated_at ?? '').localeCompare(String(a.generated_at ?? '')))[0];
        if (latest?.title) artTitleByRun.set(run.id, String(latest.title).slice(0, 120));
      }
      const rows = await deriveProcessRows(
        admin, workflow.user_id, [run],
        new Map([[workflow.id, { name: workflow.name, steps: workflow.steps ?? null }]]),
        artTitleByRun,
      );
      subject = rows[0]?.subject;
    } catch { /* the record stands without its subject line */ }

    // The presenting coworker (attribution: "delivered by <worker>").
    let workerName: string | null = null;
    if (workflow.agent_id) {
      try {
        const { data: a } = await admin.from('custom_agents')
          .select('name').eq('id', workflow.agent_id).maybeSingle();
        workerName = String((a as { name?: string } | null)?.name ?? '').trim() || null;
      } catch { /* attribution is a surface */ }
    }

    return NextResponse.json({
      run: {
        id: current.runId,
        status: current.status,
        ...(subject ? { subject } : {}),
        startedAt: current.startedAt,
        endedAt: current.endedAt,
        durationMs: current.durationMs,
      },
      decisions: current.decisions,
      driftChips: driftChipsOf(current, previous, { ownerChangedBetween }),
      vsPrevious: vsPrevious(current, previous),
      workflowName: workflow.name,
      workerName,
    });
  } catch (e) {
    console.error('[runs/record]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
