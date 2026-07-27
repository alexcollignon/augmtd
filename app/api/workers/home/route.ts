import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// GET /api/workers/home — team-level aggregation for the workers landing page.
// The team version of /api/workers/[id]/home: across all the user's enabled
// workers, returns recent deliverables (the "needs review" feed), recent task
// activity (attributed), and upcoming scheduled runs. v1 is a cheap feed — no
// per-item review state yet.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: workers } = await supabase
    .from('custom_agents')
    .select('id, name, color, icon, worker_role')
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .eq('is_active', true)
    .eq('is_enabled', true);

  const workerList = workers ?? [];
  const workerMap = new Map(workerList.map(w => [w.id, w]));
  const workerIds = workerList.map(w => w.id);

  if (workerIds.length === 0) {
    return NextResponse.json({ workers: [], needsReview: [], recentActivity: [], upcoming: [] });
  }

  const { data: workflows } = await supabase
    .from('workflows')
    .select('id, name, agent_id, next_run_at, status')
    .eq('user_id', user.id)
    .in('agent_id', workerIds);

  const wfMap = new Map((workflows ?? []).map(w => [w.id, w]));
  const workflowIds = (workflows ?? []).map(w => w.id);

  // ── Recent activity: last task runs across the team ──
  type Activity = { runId: string; workflowName: string; workerId: string | null; workerName: string | null; workerRole: string | null; status: string; triggeredBy: string; completedAt: string | null };
  let recentActivity: Activity[] = [];
  if (workflowIds.length > 0) {
    const { data: runs } = await supabase
      .from('workflow_runs')
      .select('id, workflow_id, status, triggered_by, completed_at')
      .in('workflow_id', workflowIds)
      .in('status', ['succeeded', 'failed'])
      .order('completed_at', { ascending: false })
      .limit(8);
    recentActivity = (runs ?? []).map(r => {
      const wf = wfMap.get(r.workflow_id);
      const w = wf ? workerMap.get(wf.agent_id) : null;
      return {
        runId: r.id,
        workflowName: wf?.name ?? 'Task',
        workerId: w?.id ?? null,
        workerName: w?.name ?? null,
        workerRole: (w as { worker_role?: string } | undefined)?.worker_role ?? null,
        status: r.status,
        triggeredBy: r.triggered_by ?? 'schedule',
        completedAt: r.completed_at,
      };
    });
  }

  // ── Upcoming: scheduled runs in the next 7 days ──
  const now = new Date().toISOString();
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const upcoming = (workflows ?? [])
    .filter(w => w.next_run_at && w.next_run_at > now && w.next_run_at < in7Days && w.status !== 'paused')
    .map(w => {
      const wk = workerMap.get(w.agent_id);
      return { workflowName: w.name, workerId: wk?.id ?? null, workerName: wk?.name ?? null, nextRunAt: w.next_run_at as string };
    })
    .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1))
    .slice(0, 6);

  // ── Needs review: recent deliverables produced by the team ──
  const { data: threads } = await supabase
    .from('work_threads')
    .select('id, agent_id, artifacts, updated_at')
    .eq('user_id', user.id)
    .in('agent_id', workerIds)
    .not('artifacts', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(20);

  type Review = { artifactId: string; title: string; type: string; workerId: string | null; workerName: string | null; workerRole: string | null; threadId: string; createdAt: string };
  const needsReview: Review[] = [];
  for (const t of (threads ?? [])) {
    const w = workerMap.get(t.agent_id as string);
    const arts = Array.isArray(t.artifacts) ? (t.artifacts as Array<{ id?: string; title?: string; type?: string; generated_at?: string }>) : [];
    for (const a of arts) {
      if (!a.id) continue;
      needsReview.push({
        artifactId: a.id,
        title: a.title ?? 'Document',
        type: a.type ?? 'document',
        workerId: w?.id ?? null,
        workerName: w?.name ?? null,
        workerRole: (w as { worker_role?: string } | undefined)?.worker_role ?? null,
        threadId: t.id as string,
        createdAt: a.generated_at ?? (t.updated_at as string),
      });
    }
  }
  needsReview.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // ── Messages from the team: report-back cards (every run, all homes) ──
  // The client groups these by workflowId ("latest + N earlier"), so fetch a
  // deeper window than the visible cap — grouping collapses them.
  type TeamMessage = { id: string; workerId: string | null; workerName: string | null; workerRole: string | null; workflowId: string | null; workflowName: string | null; text: string; threadId: string | null; createdAt: string; seen: boolean };
  let messages: TeamMessage[] = [];
  const { data: notifs } = await supabase
    .from('workflow_notifications')
    .select('id, workflow_id, workflow_run_id, summary, seen, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30);
  if (notifs?.length) {
    const runIds = notifs.map(n => n.workflow_run_id).filter(Boolean);
    const { data: runs2 } = await supabase.from('workflow_runs').select('id, thread_id').in('id', runIds);
    const threadByRun = new Map((runs2 ?? []).map(r => [r.id, r.thread_id]));
    messages = notifs.map(n => {
      const wf = wfMap.get(n.workflow_id);
      const w = wf ? workerMap.get(wf.agent_id) : null;
      return {
        id: n.id as string,
        workerId: w?.id ?? null,
        workerName: w?.name ?? null,
        workerRole: (w as { worker_role?: string } | undefined)?.worker_role ?? null,
        workflowId: (n.workflow_id as string) ?? null,
        workflowName: wf?.name ?? null,
        text: (n.summary as string) ?? '',
        threadId: (threadByRun.get(n.workflow_run_id) as string) ?? null,
        createdAt: n.created_at as string,
        seen: Boolean(n.seen),
      };
    });
  }

  return NextResponse.json({
    workers: workerList,
    needsReview: needsReview.slice(0, 10),
    recentActivity,
    upcoming,
    messages,
  });
}
