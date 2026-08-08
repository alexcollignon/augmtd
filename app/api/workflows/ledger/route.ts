// ─── GET /api/workflows/ledger — THE PRODUCTION LEDGER in one read ────────────
// The Workflows surface is LEDGER-LED (the production arc): what stands, what ran, what waits
// on you — before any builder chrome. One payload: the standing workflows (with their entity
// scope, worker, schedule, deliverable home), runs awaiting approval (the debt, first), and
// the recent run trail. Studio stays one click deep as the method editor.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeOutput } from '@/lib/workflows/types';
import type { OutputConfig, WorkflowStep, WorkflowTrigger } from '@/lib/workflows/types';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const [wfRes, scopeRes, runRes, workerRes] = await Promise.all([
    supabase.from('workflows')
      .select('id, name, description, status, trigger, steps, output_config, last_run_at, next_run_at, auto_paused_at, agent_id')
      .eq('user_id', user.id)
      .order('next_run_at', { ascending: true, nullsFirst: false }),
    supabase.from('item_plans')
      .select('entity_id, tasks')
      .eq('user_id', user.id).eq('kind', 'workflow_scope'),
    supabase.from('workflow_runs')
      .select('id, workflow_id, status, triggered_by, step_outputs, error, created_at, completed_at, thread_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase.from('custom_agents')
      .select('id, name, worker_role')
      .eq('user_id', user.id).eq('is_worker', true).eq('is_active', true),
  ]);

  const wfs = (wfRes.data ?? []) as Array<{
    id: string; name: string; description: string | null; status: string;
    trigger: WorkflowTrigger | null; steps: WorkflowStep[] | null; output_config: OutputConfig | null;
    last_run_at: string | null; next_run_at: string | null; auto_paused_at: string | null; agent_id: string | null;
  }>;

  // Worker names (the presenter, never the owner — workflows are system-owned).
  const agentIds = [...new Set(wfs.map(w => w.agent_id).filter(Boolean))] as string[];
  const agentNames = new Map<string, string>();
  if (agentIds.length) {
    const { data: agents } = await supabase.from('custom_agents').select('id, name').in('id', agentIds);
    for (const a of (agents ?? []) as Array<{ id: string; name: string }>) agentNames.set(a.id, a.name);
  }

  const scopeByWf = new Map<string, { entityId: string; entityName: string }>();
  for (const s of (scopeRes.data ?? []) as Array<{ entity_id: string; tasks: { entityId?: string; entityName?: string } }>) {
    if (s.tasks?.entityId && s.tasks?.entityName) scopeByWf.set(s.entity_id, { entityId: s.tasks.entityId, entityName: s.tasks.entityName });
  }

  const runs = (runRes.data ?? []) as Array<{
    id: string; workflow_id: string; status: string; triggered_by: string;
    step_outputs: Array<{ label?: string; step_type?: string }> | null;
    error: string | null; created_at: string; completed_at: string | null; thread_id: string | null;
  }>;
  const wfById = new Map(wfs.map(w => [w.id, w]));

  // Awaiting approval — the debt leads. The gate's instruction comes from the workflow's own
  // approval step at the parked boundary (step_outputs.length = the index it parked at).
  const awaiting = runs.filter(r => r.status === 'awaiting_approval').map(r => {
    const wf = wfById.get(r.workflow_id);
    const steps = (wf?.steps ?? []) as Array<{ type?: string; instruction?: string; label?: string }>;
    const gate = steps[(r.step_outputs ?? []).length];
    const prev = (r.step_outputs ?? [])[(r.step_outputs ?? []).length - 1];
    return {
      runId: r.id, workflowId: r.workflow_id, workflowName: wf?.name ?? 'Workflow',
      since: r.created_at,
      instruction: gate?.type === 'approval' ? (gate.instruction ?? gate.label ?? null) : null,
      lastStepLabel: prev?.label ?? null,
    };
  });

  const ledger = wfs.map(w => {
    const out = normalizeOutput(w.output_config);
    const trig = w.trigger as { type?: string; label?: string; cron?: string } | null;
    const lastRun = runs.find(r => r.workflow_id === w.id && r.status !== 'awaiting_approval');
    const running = runs.find(r => r.workflow_id === w.id && r.status === 'running');
    return {
      id: w.id, name: w.name, description: w.description, status: w.status,
      scheduleLabel: trig?.type === 'schedule' ? (trig.label ?? (trig.cron ? `cron ${trig.cron}` : null)) : 'On demand',
      home: out.home,
      stepCount: (w.steps ?? []).length,
      hasApproval: (w.steps ?? []).some(s => (s as { type?: string }).type === 'approval'),
      hasVerify: (w.steps ?? []).some(s => (s as { type?: string }).type === 'verify'),
      workerName: w.agent_id ? (agentNames.get(w.agent_id) ?? null) : null,
      agentId: w.agent_id,
      project: scopeByWf.get(w.id) ?? null,
      lastRunAt: w.last_run_at, nextRunAt: w.next_run_at,
      autoPaused: !!w.auto_paused_at,
      lastRunStatus: lastRun?.status ?? null,
      lastRunError: lastRun?.error ?? null,
      runningProgress: running ? `${(running.step_outputs ?? []).length}/${(w.steps ?? []).length}` : null,
    };
  });

  const recent = runs.filter(r => r.status !== 'awaiting_approval').slice(0, 12).map(r => ({
    id: r.id, workflowId: r.workflow_id,
    workflowName: wfById.get(r.workflow_id)?.name ?? 'Workflow',
    status: r.status, triggeredBy: r.triggered_by,
    at: r.completed_at ?? r.created_at, error: r.error,
    agentId: wfById.get(r.workflow_id)?.agent_id ?? null,
    threadId: r.thread_id,
  }));

  // The presenter roster (coworker = presenter only; the workflow stays system-owned).
  const workers = ((workerRes.data ?? []) as Array<{ id: string; name: string; worker_role: string }>)
    .sort((a, b) => (a.worker_role === 'personal_assistant' ? -1 : b.worker_role === 'personal_assistant' ? 1 : a.name.localeCompare(b.name)));

  return NextResponse.json({ ledger, awaiting, recent, workers });
}
