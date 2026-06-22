import type { SupabaseClient } from '@supabase/supabase-js';

// Mark runs stuck in 'running' past the cutoff as failed. A run is orphaned when its
// serverless function is killed (e.g. it exceeded maxDuration) — step_outputs is only
// written at the end, so the row sits at 'running' forever. maxDuration is 800s (~13min),
// so 20min is a safe cutoff: any live run has finished or been killed by then.
export async function reapOrphanedRuns(
  admin: SupabaseClient,
  opts?: { userId?: string; olderThanMin?: number },
): Promise<number> {
  const cutoff = new Date(Date.now() - (opts?.olderThanMin ?? 20) * 60_000).toISOString();
  let q = admin
    .from('workflow_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: 'Run exceeded the time limit and was terminated (auto-cleaned).',
    })
    .eq('status', 'running')
    .lt('started_at', cutoff);
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  const { data, error } = await q.select('id');
  return error ? 0 : (data?.length ?? 0);
}
