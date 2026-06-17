import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workerId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify worker belongs to user
  const { data: worker } = await supabase
    .from('custom_agents')
    .select('id')
    .eq('id', workerId)
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .single();
  if (!worker) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Fetch all tasks for this worker
  const { data: workflows } = await supabase
    .from('workflows')
    .select('id, name, next_run_at, status')
    .eq('user_id', user.id)
    .eq('agent_id', workerId);

  const workflowIds = (workflows ?? []).map(w => w.id);

  // Fetch recent runs across all worker tasks (last 5)
  const recentRuns: {
    runId: string;
    workflowId: string;
    workflowName: string;
    status: string;
    triggeredBy: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    stepOutputs: { label: string; output: string; error?: string }[];
    artifacts: { id: string; title: string }[];
  }[] = [];

  if (workflowIds.length > 0) {
    const { data: runs } = await supabase
      .from('workflow_runs')
      .select('id, workflow_id, status, triggered_by, step_outputs, error, started_at, completed_at, thread_id')
      .in('workflow_id', workflowIds)
      .in('status', ['succeeded', 'failed'])
      .order('completed_at', { ascending: false })
      .limit(5);

    const workflowMap = new Map((workflows ?? []).map(w => [w.id, w.name]));

    for (const run of (runs ?? [])) {
      const steps = (run.step_outputs as { label?: string; output?: unknown; error?: string }[] ?? [])
        .map(s => ({
          label: s.label ?? '',
          output: typeof s.output === 'string' ? s.output.slice(0, 120) : '',
          ...(s.error ? { error: s.error.slice(0, 80) } : {}),
        }));

      // Calculate duration
      let durationMs: number | null = null;
      if (run.started_at && run.completed_at) {
        durationMs = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
      }

      // Fetch artifacts from linked thread if available
      let artifacts: { id: string; title: string }[] = [];
      if (run.thread_id) {
        const { data: threadData } = await supabase
          .from('work_threads')
          .select('artifacts')
          .eq('id', run.thread_id)
          .single();
        const arts = (threadData?.artifacts as { id: string; title: string }[] | null) ?? [];
        artifacts = arts.slice(0, 3);
      }

      recentRuns.push({
        runId: run.id,
        workflowId: run.workflow_id,
        workflowName: workflowMap.get(run.workflow_id) ?? 'Task',
        status: run.status,
        triggeredBy: run.triggered_by,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        durationMs,
        stepOutputs: steps,
        artifacts,
      });
    }
  }

  // Upcoming runs (next 7 days)
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const upcomingRuns = (workflows ?? [])
    .filter(w => w.next_run_at && w.next_run_at > new Date().toISOString() && w.next_run_at < in7Days && w.status !== 'paused')
    .map(w => ({ workflowId: w.id, workflowName: w.name, nextRunAt: w.next_run_at }))
    .slice(0, 5);

  // Thread stats
  const { count: threadCount } = await supabase
    .from('work_threads')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', workerId)
    .eq('user_id', user.id)
    .is('workflow_id', null);

  const { data: recentThreads } = await supabase
    .from('work_threads')
    .select('title')
    .eq('agent_id', workerId)
    .eq('user_id', user.id)
    .is('workflow_id', null)
    .order('updated_at', { ascending: false })
    .limit(3);

  return NextResponse.json({
    recentRuns,
    upcomingRuns,
    threadCount: threadCount ?? 0,
    recentThreadTitles: (recentThreads ?? []).map(t => t.title).filter(Boolean),
  });
}
