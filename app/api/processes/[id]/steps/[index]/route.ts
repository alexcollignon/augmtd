import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';

// PATCH /api/processes/[id]/steps/[index] — complete a step
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  const { id, index } = await params;
  const stepIndex = parseInt(index, 10);

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });

  // Load process + step
  const [{ data: process }, { data: step }] = await Promise.all([
    supabase.from('processes').select('*').eq('id', id).single(),
    supabase.from('process_steps').select('*').eq('process_id', id).eq('step_index', stepIndex).single(),
  ]);

  if (!process || !step) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (step.status !== 'in_progress') {
    return NextResponse.json({ error: 'Step is not in progress' }, { status: 400 });
  }

  // Authorization: must be assignee OR admin/owner
  const isAdmin = company.role === 'owner' || company.role === 'admin';
  if (step.assignee_id && step.assignee_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Not authorized to complete this step' }, { status: 403 });
  }

  const body = await request.json();
  const now = new Date().toISOString();

  let artifact: unknown = null;

  // For generator steps, invoke the MCP tool
  if (step.step_type === 'generator' && step.tool) {
    try {
      const { invokeTool } = await import('@/lib/mcp/client');
      // Gather credentials from connections
      const { data: connections } = await supabase
        .from('connections')
        .select('provider, access_token, refresh_token')
        .eq('user_id', user.id);

      const credentials = {
        userId: user.id,
        connections: connections ?? [],
      };

      const toolParams = {
        ...(step.tool_parameters ?? {}),
        ...(body.tool_parameters ?? {}),
      };

      const result = await invokeTool(step.tool, toolParams as Record<string, unknown>, credentials as any);
      artifact = result;
    } catch (err) {
      console.error('[process step] generator tool error:', err);
    }
  }

  // Mark step complete
  await supabase
    .from('process_steps')
    .update({
      status: 'completed',
      completed_at: now,
      completed_by: user.id,
      input_data: body.input_data ?? null,
      artifact: artifact ?? step.artifact,
    })
    .eq('process_id', id)
    .eq('step_index', stepIndex);

  // Fetch next step
  const { data: nextStep } = await supabase
    .from('process_steps')
    .select('*')
    .eq('process_id', id)
    .eq('step_index', stepIndex + 1)
    .maybeSingle();

  if (nextStep) {
    // Advance to next step
    await supabase
      .from('process_steps')
      .update({ status: 'in_progress', started_at: now })
      .eq('process_id', id)
      .eq('step_index', stepIndex + 1);

    await supabase
      .from('processes')
      .update({ current_step: stepIndex + 1 })
      .eq('id', id);
  } else {
    // All steps done — complete process
    await supabase
      .from('processes')
      .update({ status: 'completed', completed_at: now, current_step: stepIndex + 1 })
      .eq('id', id);
  }

  // Return updated process + steps
  const [{ data: updatedProcess }, { data: updatedSteps }] = await Promise.all([
    supabase.from('processes').select('*').eq('id', id).single(),
    supabase.from('process_steps').select('*').eq('process_id', id).order('step_index'),
  ]);

  return NextResponse.json({ process: updatedProcess, steps: updatedSteps ?? [] });
}
