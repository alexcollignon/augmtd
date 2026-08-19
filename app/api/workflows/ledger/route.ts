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
      .select('id, name, description, status, trigger, steps, output_config, last_run_at, next_run_at, auto_paused_at, agent_id, icon, color')
      .eq('user_id', user.id)
      .order('next_run_at', { ascending: true, nullsFirst: false }),
    supabase.from('item_plans')
      .select('entity_id, tasks')
      .eq('user_id', user.id).eq('kind', 'workflow_scope'),
    supabase.from('workflow_runs')
      .select('id, workflow_id, status, triggered_by, step_outputs, error, created_at, started_at, completed_at, thread_id')
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
    icon: string | null; color: string | null;
  }>;

  // ── THE ACCOUNTABILITY OWNER ON THE LEDGER (processes arc B2) — served ONLY when it is an
  // EXPLICIT choice (a stored owner row). Absent = the creator owns by default, and the row says
  // nothing rather than parading the reader's own name back at them. One batch read. ──
  const ownerNames = new Map<string, string>();
  try {
    const { ownersFor } = await import('@/lib/workflows/owner');
    const owners = await ownersFor(supabase, wfs.map(w => ({ id: w.id, user_id: user.id })));
    for (const [wfId, o] of owners) {
      if (o.explicit && o.name) ownerNames.set(wfId, o.name);
    }
  } catch { /* ownership attribution is additive — the ledger serves without it */ }

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
    error: string | null; created_at: string; started_at: string | null;
    completed_at: string | null; thread_id: string | null;
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
    const trig = w.trigger as { type?: string; label?: string; cron?: string; when?: string } | null;
    const lastRun = runs.find(r => r.workflow_id === w.id && r.status !== 'awaiting_approval');
    const running = runs.find(r => r.workflow_id === w.id && r.status === 'running');
    return {
      id: w.id, name: w.name, description: w.description, status: w.status,
      scheduleLabel:
        trig?.type === 'schedule' ? (trig.label ?? (trig.cron ? `cron ${trig.cron}` : null)) :
        trig?.type === 'reaction' ? (trig.label ?? (trig.when ? `When ${trig.when}` : 'On event')) :
        'On demand',
      home: out.home,
      stepCount: (w.steps ?? []).length,
      hasApproval: (w.steps ?? []).some(s => (s as { type?: string }).type === 'approval'),
      hasVerify: (w.steps ?? []).some(s => (s as { type?: string }).type === 'verify'),
      workerName: w.agent_id ? (agentNames.get(w.agent_id) ?? null) : null,
      agentId: w.agent_id,
      icon: w.icon ?? null,
      color: w.color ?? null,
      // Present only when accountability was explicitly assigned (absent = the creator owns).
      ...(ownerNames.has(w.id) ? { ownerName: ownerNames.get(w.id)! } : {}),
      project: scopeByWf.get(w.id) ?? null,
      lastRunAt: w.last_run_at, nextRunAt: w.next_run_at,
      autoPaused: !!w.auto_paused_at,
      lastRunStatus: lastRun?.status ?? null,
      lastRunError: lastRun?.error ?? null,
      runningProgress: running ? `${(running.step_outputs ?? []).length}/${(w.steps ?? []).length}` : null,
    };
  });

  // ── THE RECENT TRAIL, GROUPED (owner, Aug 9 — "a green checkmark wall is noise"): one line
  // per workflow speaking the DELTA-worthy truth (count · last run · state), failures itemized
  // individually (a failure is a delta; a repeat success is not). "Open" points at the
  // DELIVERABLE — the latest document artifact on the task thread — never at a chat page. ──
  const done = runs.filter(r => r.status !== 'awaiting_approval' && r.status !== 'queued' && r.status !== 'running');
  const threadIds = [...new Set(done.map(r => r.thread_id).filter(Boolean))] as string[];
  const artsByThread = new Map<string, Array<{ id: string; title: string; generated_at?: string }>>();
  if (threadIds.length) {
    const { data: ths } = await supabase.from('work_threads').select('id, artifacts').in('id', threadIds);
    for (const t of (ths ?? []) as Array<{ id: string; artifacts: Array<{ id: string; title: string; generated_at?: string }> | null }>) {
      artsByThread.set(t.id, Array.isArray(t.artifacts) ? t.artifacts : []);
    }
  }
  const byWf = new Map<string, typeof done>();
  for (const r of done) {
    const arr = byWf.get(r.workflow_id) ?? [];
    arr.push(r); byWf.set(r.workflow_id, arr);
  }
  // THE GATE'S DELTA (guardrails arc): the grouped trail speaks deltas, never repeat successes —
  // so the latest run's gate verdict surfaces ONLY when it changed something (corrected/blocked).
  // A clean pass stays silent here; the per-run receipts live in RunAudit.
  const gateDelta = (r: (typeof done)[number]): { status: string; fixed: number } | null => {
    const outs = Array.isArray(r.step_outputs) ? (r.step_outputs as Array<{ verdict?: { status?: string; findings?: unknown[] } }>) : [];
    let v: { status?: string; findings?: unknown[] } | undefined;
    for (const o of outs) if (o?.verdict?.status) v = o.verdict;
    if (!v || v.status === 'passed') return null;
    return { status: String(v.status), fixed: Array.isArray(v.findings) ? v.findings.length : 0 };
  };
  const recent = [...byWf.entries()].map(([wfId, rs]) => {
    const latest = rs[0]; // runs are newest-first
    const latestOk = rs.find(r => r.status === 'succeeded');
    const arts = latestOk?.thread_id ? (artsByThread.get(latestOk.thread_id) ?? []) : [];
    const latestArt = [...arts].sort((a, b) => String(b.generated_at ?? '').localeCompare(String(a.generated_at ?? '')))[0] ?? null;
    return {
      workflowId: wfId,
      workflowName: wfById.get(wfId)?.name ?? 'Workflow',
      count: rs.length,
      lastAt: latest.completed_at ?? latest.created_at,
      lastStatus: latest.status,
      gate: gateDelta(latest),
      deliverable: latestOk?.thread_id && latestArt
        ? { threadId: latestOk.thread_id, artifactId: latestArt.id, title: latestArt.title }
        : null,
      failures: rs.filter(r => r.status === 'failed').slice(0, 3)
        .map(r => ({ at: r.completed_at ?? r.created_at, error: (r.error ?? '').slice(0, 140) })),
      held: rs.filter(r => r.status === 'rejected').length,
    };
  }).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));

  // ── THE PROCESSES (processes arc, docs/processes-plan.md): every recent run wearing its human
  // state through the ONE derivation — the strip, the drawer, and the deep-dive all read THIS
  // array (the deep-dive filters by workflowId). held_back rows ride along for History surfaces;
  // attention surfaces bucket via PROCESS_BUCKETS and drop what doesn't render. ──
  const { deriveProcessRows } = await import('@/lib/workflows/process-state');
  const artTitleByRun = new Map<string, string>();
  for (const r of done) {
    if (!r.thread_id) continue;
    const arts = artsByThread.get(r.thread_id) ?? [];
    const doneAt = r.completed_at ? new Date(r.completed_at).getTime() + 60_000 : null;
    const own = doneAt
      ? arts.filter((a) => a.generated_at && new Date(a.generated_at).getTime() <= doneAt)
          .sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0]
      : arts[0];
    if (own?.title) artTitleByRun.set(r.id, String(own.title).slice(0, 120));
  }
  const stepsTotalByWf = new Map(wfs.map((w) => [w.id, (w.steps ?? []).length]));
  let processes = (await deriveProcessRows(supabase, user.id, runs, wfById, artTitleByRun))
    .map((p) => ({ ...p, stepsTotal: stepsTotalByWf.get(p.workflowId) ?? p.stepsDone }));

  // ── THE REASSIGN OVERRIDE IS SERVED TRUTH (B2): a parked handoff can have moved to another
  // person for THIS RUN ONLY (item_plans kind='handoff_override' — the reassign route is its one
  // writer; the authored step never mutates). The derivation stays pure and override-free, so the
  // route re-reads the gate WITH the override and patches the rows: the strip must speak the
  // CURRENT assignee, never the person who was originally authored into the step. ──
  const parked = runs.filter((r) => r.status === 'awaiting_approval');
  if (parked.length) {
    try {
      const { parkedGateOf } = await import('@/lib/workflows/process-state');
      const stepIdByRun = new Map<string, string>();
      for (const r of parked) {
        const steps = (wfById.get(r.workflow_id)?.steps ?? []) as WorkflowStep[];
        const cur = steps[(r.step_outputs ?? []).length];
        if (cur && (cur as { type?: string }).type === 'handoff') stepIdByRun.set(r.id, (cur as { id: string }).id);
      }
      if (stepIdByRun.size) {
        const keys = [...stepIdByRun.entries()].map(([runId, stepId]) => `${runId}:${stepId}`);
        const { data: ovs } = await supabase.from('item_plans')
          .select('entity_id, tasks')
          .eq('user_id', user.id).eq('kind', 'handoff_override').in('entity_id', keys);
        const byRun = new Map<string, { assigneeUserId: string; assigneeName?: string }>();
        for (const o of (ovs ?? []) as Array<{ entity_id: string; tasks: { assigneeUserId?: string; assigneeName?: string } | null }>) {
          const runId = String(o.entity_id).split(':')[0];
          if (o.tasks?.assigneeUserId) byRun.set(runId, { assigneeUserId: o.tasks.assigneeUserId, assigneeName: o.tasks.assigneeName });
        }
        if (byRun.size) {
          const runById = new Map(parked.map((r) => [r.id, r]));
          processes = processes.map((p) => {
            const ov = byRun.get(p.runId);
            const r = runById.get(p.runId);
            if (!ov || !r) return p;
            const gate = parkedGateOf(
              { step_outputs: (r.step_outputs ?? []) as never },
              (wfById.get(r.workflow_id)?.steps ?? null) as WorkflowStep[] | null,
              ov,
            );
            if (gate.kind !== 'handoff' || !gate.assigneeUserId) return p;
            return gate.assigneeUserId === user.id
              ? { ...p, state: 'needs_you' as const, waitingOn: null }
              : { ...p, state: 'waiting_on_others' as const, reason: undefined, waitingOn: { name: gate.assigneeName ?? 'a teammate' } };
          });
        }
      }
    } catch { /* the derivation's own attribution still serves */ }
  }

  // The presenter roster (coworker = presenter only; the workflow stays system-owned).
  const workers = ((workerRes.data ?? []) as Array<{ id: string; name: string; worker_role: string }>)
    .sort((a, b) => (a.worker_role === 'personal_assistant' ? -1 : b.worker_role === 'personal_assistant' ? 1 : a.name.localeCompare(b.name)));

  // ── TEAMMATES' SHARED WORKFLOWS (trailing item, Aug 10): read-only rows — what the team
  // runs, with owner attribution. RLS already grants read on sharing_mode='live' rows. ──
  let team: Array<{ id: string; name: string; scheduleLabel: string | null; ownerName: string }> = [];
  try {
    const { data: shared } = await supabase.from('workflows')
      .select('id, name, trigger, user_id, sharing_mode')
      .neq('user_id', user.id).eq('sharing_mode', 'live').eq('status', 'active').limit(20);
    const rows = (shared ?? []) as Array<{ id: string; name: string; trigger: { type?: string; label?: string; cron?: string; when?: string } | null; user_id: string }>;
    if (rows.length) {
      const ownerIds = [...new Set(rows.map((r) => r.user_id))];
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ownerIds);
      const nameOf = new Map(((profs ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>)
        .map((p) => [p.id, p.full_name ?? p.email?.split('@')[0] ?? 'Teammate']));
      team = rows.map((r) => ({
        id: r.id, name: r.name,
        scheduleLabel:
          r.trigger?.type === 'schedule' ? (r.trigger.label ?? (r.trigger.cron ? `cron ${r.trigger.cron}` : null)) :
          r.trigger?.type === 'reaction' ? (r.trigger.label ?? 'On event') : 'On demand',
        ownerName: nameOf.get(r.user_id) ?? 'Teammate',
      }));
    }
  } catch { /* the team section is an enhancement */ }

  // THE SOVEREIGN GALLERY (Aug 11, owner: mailbox-reading templates make no sense on the
  // corporate tier): the client hides email-sourced templates when the feature is off.
  let emailFeature = true;
  try {
    const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
    const feats = await getWorkspaceFeatures(user.id, supabase);
    emailFeature = feats?.email !== false;
  } catch { /* default: show */ }

  return NextResponse.json({ ledger, awaiting, recent, processes, workers, team, emailFeature });
}
