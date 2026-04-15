// ─── GET /api/workflows — list user's workflows ───────────────────────────────
// ─── POST /api/workflows — create a new workflow (draft) ──────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeNextRun } from '@/lib/workflows/schedule';
import { DEFAULT_TRIGGER, DEFAULT_OUTPUT_CONFIG } from '@/lib/workflows/types';
import type { WorkflowTrigger, WorkflowStep, OutputConfig, WorkflowStatus } from '@/lib/workflows/types';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const { data, error } = await supabase
    .from('workflows')
    .select('id, name, description, icon, color, status, trigger, steps, output_config, last_run_at, next_run_at, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workflows: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  let body: {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    status?: WorkflowStatus;
    trigger?: WorkflowTrigger;
    steps?: WorkflowStep[];
    output_config?: OutputConfig;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  const trigger = body.trigger ?? DEFAULT_TRIGGER;
  const status: WorkflowStatus = body.status ?? 'draft';

  // Compute next_run_at if schedule + active
  let nextRunAt: string | null = null;
  if (status === 'active' && trigger.type === 'schedule' && trigger.cron) {
    const d = computeNextRun(trigger.cron, trigger.timezone);
    if (d) nextRunAt = d.toISOString();
  }

  const { data, error } = await supabase
    .from('workflows')
    .insert({
      user_id: user.id,
      name: body.name.trim(),
      description: body.description ?? null,
      icon: body.icon ?? 'sparkles',
      color: body.color ?? 'indigo',
      status,
      trigger,
      steps: body.steps ?? [],
      output_config: body.output_config ?? DEFAULT_OUTPUT_CONFIG,
      next_run_at: nextRunAt,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workflow: data });
}
