// ─── POST /api/workflows/[id]/run — trigger a manual run ──────────────────────
// Creates a queued run, fires the executor. Returns the run id immediately.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  // Ownership check
  const { data: wf, error: wfErr } = await supabase
    .from('workflows')
    .select('id, user_id, steps')
    .eq('id', workflowId)
    .eq('user_id', user.id)
    .single();

  if (wfErr || !wf) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const steps = ((wf as { steps: unknown[] }).steps) ?? [];
  if (steps.length === 0) {
    return NextResponse.json({ error: 'Workflow has no steps' }, { status: 400 });
  }

  // Concurrency guard: no overlapping manual + scheduled runs
  const { data: existing } = await supabase
    .from('workflow_runs')
    .select('id')
    .eq('workflow_id', workflowId)
    .in('status', ['queued', 'running'])
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'A run is already in progress' }, { status: 409 });
  }

  // Create queued run (use service role to bypass RLS since user_id insert policy exists but simpler here)
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: run, error: runErr } = await admin
    .from('workflow_runs')
    .insert({
      workflow_id: workflowId,
      user_id: user.id,
      status: 'queued',
      triggered_by: 'manual',
    })
    .select('id')
    .single();

  if (runErr || !run) {
    return NextResponse.json({ error: runErr?.message ?? 'Failed to create run' }, { status: 500 });
  }

  const runId = (run as { id: string }).id;

  // Fire the executor asynchronously
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');

  fetch(`${baseUrl}/api/workflows/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ run_id: runId, workflow_id: workflowId, trigger_source: 'manual' }),
  }).catch(err => console.error('[workflows/run] executor fire failed:', err));

  return NextResponse.json({ run_id: runId, status: 'queued' });
}
