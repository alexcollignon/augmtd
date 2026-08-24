// ─── Workflow dispatcher — runs every minute via Vercel Cron ──────────────────
// Finds active scheduled workflows whose next_run_at has passed, enqueues a
// workflow_runs row, and triggers the executor. The executor is invoked via
// fetch-and-forget so this endpoint returns fast and doesn't block the cron.

import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { reapOrphanedRuns } from '@/lib/workflows/reap-orphans';
import { nextRunFromTrigger } from '@/lib/workflows/schedule';
import { runWorkflow } from '@/lib/workflows/run-workflow';

export const maxDuration = 800; // Vercel Pro + Fluid Compute (was 300; heavy briefing tasks ran ~150-300s, too close to the cap)

export async function GET(request: NextRequest) {
  // Auth: Vercel Cron sends Bearer CRON_SECRET
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const now = new Date();

  // Reap orphaned runs (killed mid-execution, stuck at 'running') so they don't spin forever.
  const reaped = await reapOrphanedRuns(supabase);
  if (reaped) console.log(`[workflows-dispatch] reaped ${reaped} orphaned run(s)`);

  // Fetch due workflows
  const { data: due, error } = await supabase
    .from('workflows')
    .select('id, user_id, name, trigger, next_run_at, status, steps')
    .eq('status', 'active')
    .not('next_run_at', 'is', null)
    .lte('next_run_at', now.toISOString())
    .limit(50);

  if (error) {
    console.error('[workflows-dispatch] query error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dueList = (due ?? []) as Array<{
    id: string; user_id: string; name: string;
    trigger: { type: string; cron?: string; timezone?: string };
    next_run_at: string;
    status: string;
    steps: Array<Record<string, unknown>> | null;
  }>;

  const enqueued: string[] = [];
  const skipped: string[] = [];
  const notReady: string[] = [];

  // THE READINESS WAVE at the dispatcher: a not-ready workflow never gets a doomed run row. It is
  // SKIPPED and its schedule still rolls forward — unreadiness must not wedge the clock. The
  // reason already stands on the ledger row (same derivation), so this needs no user-facing write.
  const featuresByUser = new Map<string, import('@/lib/workspace/types').WorkspaceFeatures | null>();
  const featuresFor = async (userId: string) => {
    if (featuresByUser.has(userId)) return featuresByUser.get(userId)!;
    let f: import('@/lib/workspace/types').WorkspaceFeatures | null = null;
    try {
      const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
      f = await getWorkspaceFeatures(userId, supabase);
    } catch { /* unknown features never invent unreadiness */ }
    featuresByUser.set(userId, f);
    return f;
  };
  const { readinessOf } = await import('@/lib/workflows/readiness');

  for (const wf of dueList) {
    const r = readinessOf(
      { status: wf.status, trigger: wf.trigger, steps: wf.steps ?? [] },
      await featuresFor(wf.user_id),
    );
    if (!r.ready) {
      notReady.push(wf.id);
      console.log(`[workflows-dispatch] not ready, skipped ${wf.id}: ${r.reason}`);
      // Roll the schedule forward anyway — a not-ready workflow must not wedge the clock.
      const nextRun = nextRunFromTrigger(wf.trigger, now);
      await supabase.from('workflows').update({
        next_run_at: nextRun ? nextRun.toISOString() : null,
      }).eq('id', wf.id);
      continue;
    }

    // Concurrency guard: skip if there is already a queued or running run for this workflow
    const { data: existing } = await supabase
      .from('workflow_runs')
      .select('id')
      .eq('workflow_id', wf.id)
      .in('status', ['queued', 'running'])
      .limit(1);

    if (existing && existing.length > 0) {
      skipped.push(wf.id);
      // Still roll forward next_run_at so we don't spin on the same minute next tick
      const nextRun = nextRunFromTrigger(wf.trigger, now);
      await supabase.from('workflows').update({
        next_run_at: nextRun ? nextRun.toISOString() : null,
      }).eq('id', wf.id);
      continue;
    }

    // Create queued run
    const { data: run, error: runErr } = await supabase
      .from('workflow_runs')
      .insert({
        workflow_id: wf.id,
        user_id: wf.user_id,
        status: 'queued',
        triggered_by: 'schedule',
      })
      .select('id')
      .single();

    if (runErr || !run) {
      console.error(`[workflows-dispatch] failed to enqueue ${wf.id}:`, runErr);
      continue;
    }

    // Advance next_run_at immediately so subsequent cron ticks don't re-fire
    const nextRun = nextRunFromTrigger(wf.trigger, now);
    await supabase.from('workflows').update({
      next_run_at: nextRun ? nextRun.toISOString() : null,
    }).eq('id', wf.id);

    // after() keeps the Vercel function alive past the response — a bare fetch()
    // is killed immediately when the response is sent (same bug fixed in /run route).
    const runId = (run as { id: string }).id;
    enqueued.push(runId);

    const wfId = wf.id;
    after(async () => {
      await runWorkflow({ workflowId: wfId, runId, triggerSource: 'schedule' });
    });
  }

  // THE STANDING BINDING's convergent door (Arc 2): every hourly tick re-syncs all standing
  // commitments — idempotent, self-healing. A workflow that silently died (null next_run_at,
  // stalled dispatcher) keeps its past due_date and stands as an OVERDUE DEBT on the deck.
  after(async () => {
    try {
      const { syncAllStandingCommitments } = await import('@/lib/workflows/standing');
      await syncAllStandingCommitments(supabase);
    } catch { /* bookkeeping — never breaks the dispatcher */ }
  });

  // THE SLA CHASE (processes arc Phase B — the missed-promise floor, generalized to people): a
  // handoff parked longer than its sla_hours gets chased by the coworker, ≤1/day per run, with
  // the owner's room told. A gate quietly rotting on someone's desk is the class this kills.
  after(async () => {
    try {
      const { sweepHandoffSLAs } = await import('@/lib/workflows/handoffs');
      await sweepHandoffSLAs(supabase);
    } catch { /* bookkeeping — never breaks the dispatcher */ }
  });

  // STANDING REACTIONS backstop (production arc step 6): an event-run still queued after 10
  // minutes lost its inline attempt (crashed tail, missing request scope) — re-fire it with its
  // stored trigger context. A crashed tail never silently eats an event.
  after(async () => {
    try {
      const { refireStaleEventRuns } = await import('@/lib/workflows/reactions');
      const refired = await refireStaleEventRuns(supabase);
      if (refired.length) console.log(`[workflows-dispatch] re-fired ${refired.length} stale event run(s)`);
    } catch { /* bookkeeping — never breaks the dispatcher */ }
  });

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    due_count: dueList.length,
    enqueued: enqueued.length,
    skipped: skipped.length,
    not_ready: notReady.length,
  });
}
