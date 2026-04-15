// ─── Workflow dispatcher — runs every minute via Vercel Cron ──────────────────
// Finds active scheduled workflows whose next_run_at has passed, enqueues a
// workflow_runs row, and triggers the executor. The executor is invoked via
// fetch-and-forget so this endpoint returns fast and doesn't block the cron.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { nextRunFromTrigger } from '@/lib/workflows/schedule';

export const maxDuration = 60;

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

  // Fetch due workflows
  const { data: due, error } = await supabase
    .from('workflows')
    .select('id, user_id, name, trigger, next_run_at')
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
  }>;

  const enqueued: string[] = [];
  const skipped: string[] = [];

  for (const wf of dueList) {
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

    // Fire-and-forget executor invocation. We don't await — the executor runs
    // asynchronously and we return from the cron dispatcher quickly.
    const runId = (run as { id: string }).id;
    enqueued.push(runId);

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');

    fetch(`${baseUrl}/api/workflows/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ run_id: runId, workflow_id: wf.id }),
    }).catch(err => console.error(`[workflows-dispatch] executor fire failed for ${runId}:`, err));
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    due_count: dueList.length,
    enqueued: enqueued.length,
    skipped: skipped.length,
  });
}
