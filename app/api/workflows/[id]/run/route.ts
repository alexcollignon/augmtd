// ─── POST /api/workflows/[id]/run — trigger a manual run ──────────────────────
// Creates a queued run, fires the executor. Returns the run id immediately.
// For template-mode workflows, auto-clones for the runner first.

import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { runWorkflow } from '@/lib/workflows/run-workflow';

export const maxDuration = 800; // Vercel Pro + Fluid Compute (was 300; heavy briefing tasks ran ~150-300s, too close to the cap)

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let { id: workflowId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const body = await request.json().catch(() => ({})) as { test?: boolean };
  const isTest = body.test === true;

  // Allow owner OR any company member if shared — RLS handles the access check
  const { data: wf, error: wfErr } = await supabase
    .from('workflows')
    .select('id, user_id, steps')
    .eq('id', workflowId)
    .single();

  if (wfErr || !wf) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const steps = ((wf as { steps: unknown[] }).steps) ?? [];
  if (steps.length === 0) {
    return NextResponse.json({ error: 'Workflow has no steps' }, { status: 400 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

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

  // Fire the executor after the response is sent
  after(async () => {
    await runWorkflow({ workflowId, runId, triggerSource: 'manual', runnerId: user.id, isTest });
  });

  return NextResponse.json({ run_id: runId, status: 'queued' });
}
