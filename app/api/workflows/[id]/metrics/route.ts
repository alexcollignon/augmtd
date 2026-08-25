// ─── GET /api/workflows/[id]/metrics — THE RECEIPT for one workflow ───────────────────────────────
//
// THE METRICS TAB's one aggregation endpoint (docs/processes-plan.md). ZERO new instrumentation:
// everything here is read off substrate that already exists — `workflow_runs` (statuses, durations,
// step_outputs → the gate's verdict) and `ai_usage_events` (tokens + cost, logged by
// lib/ai/log-usage.ts with a workflow_id stamp).
//
// LAWS HONORED:
//  • THE BASELINE IS AUTHORED, NEVER GUESSED — this route serves `baselineMinutes` straight from
//    `output_config.estimated_manual_minutes` and NOTHING else. No default, no flat-15 guess; a
//    null baseline means the surface must ASK, never fabricate a time-saved number.
//  • ONE DERIVATION — the gate's intervention read reuses `gateDeltaOf` from lib/workflows/
//    process-state (a clean pass is silent there, so a non-null delta IS an intervention).
//  • HONEST DEGRADATION — ai_usage_events is an apply-manually migration (the AI-Ops precedent);
//    its absence returns a null `usage` block rather than breaking the whole receipt.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';
import { gateDeltaOf } from '@/lib/workflows/process-state';
import type { StepOutputLike } from '@/lib/workflows/process-state';

type RunRow = {
  status: string;
  step_outputs: StepOutputLike[] | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  // ── ONE FLIGHT: the baseline, the runs and the spend are three mutually independent reads over
  // the same (workflow_id, user_id) key. They used to be awaited one after another, and the Metrics
  // tab's whole paint is this route's latency. Nothing here depends on anything else here. ──
  // The baseline lives on the workflow's own output_config — one existing save path, no migration.
  const [wfRes, runsRes, usageRes] = await Promise.all([
    supabase
      .from('workflows')
      .select('id, output_config')
      .eq('id', workflowId)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('workflow_runs')
      .select('status, step_outputs, started_at, completed_at, created_at')
      .eq('workflow_id', workflowId)
      .eq('user_id', user.id),
    supabase
      .from('ai_usage_events')
      .select('prompt_tokens, completion_tokens, cost_eur')
      .eq('workflow_id', workflowId)
      .eq('user_id', user.id),
  ]);

  const { data: wf, error: wfError } = wfRes;
  if (wfError) return NextResponse.json({ error: sanitizeError(wfError) }, { status: 500 });
  if (!wf) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rawBaseline = (wf.output_config as { estimated_manual_minutes?: unknown } | null)
    ?.estimated_manual_minutes;
  const baselineMinutes =
    typeof rawBaseline === 'number' && Number.isFinite(rawBaseline) && rawBaseline > 0
      ? Math.round(rawBaseline)
      : null;

  const { data: runData, error: runError } = runsRes;
  if (runError) return NextResponse.json({ error: sanitizeError(runError) }, { status: 500 });

  const runs = (runData ?? []) as RunRow[];

  // ── runs by status ──
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const succeeded = byStatus.succeeded ?? 0;

  // ── durations: succeeded runs only (a failed run's clock says nothing about the work) ──
  const succeededRuns = runs
    .filter((r) => r.status === 'succeeded' && r.started_at && r.completed_at)
    .map((r) => ({
      ms: new Date(r.completed_at!).getTime() - new Date(r.started_at!).getTime(),
      at: new Date(r.completed_at!).getTime(),
    }))
    .filter((d) => Number.isFinite(d.ms) && d.ms >= 0)
    .sort((a, b) => a.at - b.at);

  const medianMs = median(succeededRuns.map((d) => d.ms));
  const lastMs = succeededRuns.length ? succeededRuns[succeededRuns.length - 1].ms : null;

  const allTimes = runs
    .map((r) => new Date(r.started_at ?? r.created_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  // ── the gate's quality receipt: of the runs the check actually ran on, how many did it touch ──
  let withGate = 0;
  let intervened = 0;
  for (const r of runs) {
    const outs = r.step_outputs ?? [];
    const sawVerdict = outs.some((o) => (o as { verdict?: { status?: string } })?.verdict?.status);
    if (!sawVerdict) continue;
    withGate += 1;
    if (gateDeltaOf(outs)) intervened += 1; // non-null == corrected/blocked/etc — a clean pass is silent
  }

  // ── real spend for THIS workflow (tolerant of the apply-manually migration being absent) ──
  let usage: { promptTokens: number; completionTokens: number; costEur: number; events: number } | null = null;
  const { data: usageRows, error: usageError } = usageRes;
  if (usageError) {
    console.warn('[workflow-metrics] ai_usage_events unavailable:', usageError.message);
  } else {
    const rows = (usageRows ?? []) as Array<{ prompt_tokens: number | null; completion_tokens: number | null; cost_eur: number | null }>;
    usage = {
      promptTokens: rows.reduce((a, r) => a + (r.prompt_tokens ?? 0), 0),
      completionTokens: rows.reduce((a, r) => a + (r.completion_tokens ?? 0), 0),
      costEur: rows.reduce((a, r) => a + (r.cost_eur ?? 0), 0),
      events: rows.length,
    };
  }

  return NextResponse.json({
    runs: {
      total: runs.length,
      succeeded,
      failed: byStatus.failed ?? 0,
      rejected: byStatus.rejected ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      inFlight: (byStatus.running ?? 0) + (byStatus.queued ?? 0) + (byStatus.awaiting_approval ?? 0),
      byStatus,
      firstRunAt: allTimes.length ? new Date(allTimes[0]).toISOString() : null,
      lastRunAt: allTimes.length ? new Date(allTimes[allTimes.length - 1]).toISOString() : null,
    },
    durations: { medianMs, lastMs, measuredRuns: succeededRuns.length },
    gate: { runsWithGate: withGate, intervened },
    usage,
    baselineMinutes,
  });
}
