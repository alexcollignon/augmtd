// ─── GET/PATCH/DELETE /api/workflows/[id] ─────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeNextRun, validateCron } from '@/lib/workflows/schedule';
import type { WorkflowTrigger, WorkflowStep, OutputConfig, WorkflowStatus } from '@/lib/workflows/types';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ workflow: { ...data, is_owned_by_me: data.user_id === user.id } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  let body: Partial<{
    name: string;
    description: string | null;
    icon: string;
    color: string;
    status: WorkflowStatus;
    trigger: WorkflowTrigger;
    steps: WorkflowStep[];
    output_config: OutputConfig;
    shared_with_company: boolean;
  }>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  // Validate cron if trigger is being updated
  if (body.trigger && body.trigger.type === 'schedule') {
    if (!body.trigger.cron) {
      return NextResponse.json({ error: 'schedule trigger requires cron' }, { status: 400 });
    }
    const cronErr = validateCron(body.trigger.cron);
    if (cronErr) return NextResponse.json({ error: cronErr }, { status: 400 });
  }

  // Load existing row to decide next_run_at (owner-only write — eq user_id enforces this)
  const { data: existing, error: loadErr } = await supabase
    .from('workflows')
    .select('status, trigger, company_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (loadErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const newStatus = body.status ?? (existing as { status: WorkflowStatus }).status;
  const newTrigger = body.trigger ?? (existing as { trigger: WorkflowTrigger }).trigger;

  let nextRunAt: string | null | undefined;
  if (newStatus === 'active' && newTrigger.type === 'schedule' && newTrigger.cron) {
    const d = computeNextRun(newTrigger.cron, newTrigger.timezone);
    nextRunAt = d ? d.toISOString() : null;
  } else {
    nextRunAt = null;
  }

  const update: Record<string, unknown> = { ...body };
  if (nextRunAt !== undefined) update.next_run_at = nextRunAt;

  // If turning on sharing, ensure company_id is set
  if (body.shared_with_company === true && !(existing as { company_id?: string | null }).company_id) {
    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();
    if (membership?.company_id) update.company_id = membership.company_id;
  }

  const { data, error } = await supabase
    .from('workflows')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workflow: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
