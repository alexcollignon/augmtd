// ─── GET + DELETE /api/workflows/[id]/runs/[runId] ────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: workflowId, runId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const { data: run, error } = await supabase
    .from('workflow_runs')
    .select('id, status, step_outputs, error, started_at, completed_at, created_at')
    .eq('id', runId)
    .eq('workflow_id', workflowId)
    .single();

  if (error || !run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ run });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: workflowId, runId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  // Verify ownership via the workflow (run has no direct user RLS delete policy)
  const { data: run } = await supabase
    .from('workflow_runs')
    .select('id, user_id, status')
    .eq('id', runId)
    .eq('workflow_id', workflowId)
    .eq('user_id', user.id)
    .single();

  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (run.status === 'running') {
    return NextResponse.json({ error: 'Cannot delete a run that is currently running' }, { status: 409 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error } = await admin.from('workflow_runs').delete().eq('id', runId);
  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });

  // If no runs remain, reset last_run_at so the next run fetches a full 7-day window
  const { count } = await admin
    .from('workflow_runs')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', workflowId);

  if (count === 0) {
    await admin
      .from('workflows')
      .update({ last_run_at: null })
      .eq('id', workflowId);
  }

  return NextResponse.json({ ok: true });
}
