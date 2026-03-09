import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/work/threads/[id]/approve-step
// Confirms a requires_approval step and resumes pipeline execution from that step.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { stepNumber } = body;
    if (typeof stepNumber !== 'number') {
      return NextResponse.json({ error: 'stepNumber is required' }, { status: 400 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, plan, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const plan = (thread as any).plan;
    if (!plan) {
      return NextResponse.json({ error: 'Thread has no plan' }, { status: 400 });
    }

    // Verify the step exists and requires approval
    const step = (plan.steps ?? []).find((s: any) => s.number === stepNumber);
    if (!step) {
      return NextResponse.json({ error: `Step ${stepNumber} not found in plan` }, { status: 404 });
    }
    if (!step.requires_approval) {
      return NextResponse.json({ error: `Step ${stepNumber} does not require approval` }, { status: 400 });
    }

    // Verify thread is actually paused at this step
    const { data: threadStatus } = await supabase
      .from('work_threads')
      .select('execution_status')
      .eq('id', threadId)
      .single();

    if (threadStatus?.execution_status !== 'awaiting_approval') {
      return NextResponse.json({ error: 'Thread is not awaiting approval' }, { status: 409 });
    }

    // Mark step as approved (remove requires_approval flag so pipeline skips the gate on re-run)
    const updatedSteps = (plan.steps ?? []).map((s: any) =>
      s.number === stepNumber ? { ...s, requires_approval: false, approved: true } : s
    );
    const updatedPlan = { ...plan, steps: updatedSteps, pending_approval_step: null };

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await adminClient.from('work_threads').update({
      plan: updatedPlan,
      execution_status: 'running',
      updated_at: new Date().toISOString(),
    }).eq('id', threadId);

    // Resume pipeline — delegate to generate route logic by calling it directly
    // The client should re-call POST /api/work/threads/[id]/generate after this returns
    return NextResponse.json({ approved: true, stepNumber, resumeGeneration: true });
  } catch (error) {
    console.error('[ApproveStep] Error:', error);
    return NextResponse.json({ error: 'Failed to approve step' }, { status: 500 });
  }
}
