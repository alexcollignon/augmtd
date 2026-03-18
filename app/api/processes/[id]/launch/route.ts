import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ProcessPlan } from '@/lib/types/process';

// POST /api/processes/[id]/launch — draft → active, creates process_steps
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: process, error: pErr } = await supabase
    .from('processes')
    .select('*')
    .eq('id', id)
    .single();

  if (pErr || !process) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (process.status !== 'draft') {
    return NextResponse.json({ error: 'Process is not in draft status' }, { status: 400 });
  }

  const plan = process.plan as ProcessPlan | null;
  if (!plan?.steps?.length) {
    return NextResponse.json({ error: 'No plan defined — add a plan before launching' }, { status: 400 });
  }

  // Validate all steps have assignee or department
  for (const step of plan.steps) {
    if (!step.assignee_id && !step.department) {
      return NextResponse.json({
        error: `Step ${step.step_index + 1} "${step.title}" has no assignee or department`,
      }, { status: 400 });
    }
  }

  const now = new Date().toISOString();

  // Create process_steps rows
  const stepRows = plan.steps.map((step, i) => ({
    process_id: id,
    step_index: step.step_index ?? i,
    title: step.title,
    description: step.description || null,
    step_type: step.step_type ?? 'human',
    assignee_id: step.assignee_id || null,
    department: step.department || null,
    status: i === 0 ? 'in_progress' : 'pending',
    input_type: step.input_type || null,
    input_label: step.input_label || null,
    cta_label: step.cta_label || null,
    tool: step.tool || null,
    tool_parameters: step.tool_parameters || null,
    estimated_days: step.estimated_days ? Math.round(step.estimated_days) : null,
    started_at: i === 0 ? now : null,
  }));

  const { error: stepsErr } = await supabase
    .from('process_steps')
    .insert(stepRows);

  if (stepsErr) {
    console.error('[launch] process_steps insert error:', stepsErr);
    return NextResponse.json({ error: 'Failed to create steps', detail: stepsErr.message }, { status: 500 });
  }

  // Update process to active
  const { data: updated, error: upErr } = await supabase
    .from('processes')
    .update({
      status: 'active',
      started_at: now,
      current_step: 0,
    })
    .eq('id', id)
    .select()
    .single();

  if (upErr) return NextResponse.json({ error: 'Failed to activate process' }, { status: 500 });

  return NextResponse.json({ process: updated });
}
