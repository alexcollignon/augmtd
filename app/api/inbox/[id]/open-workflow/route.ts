import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { updateWorkPatternsFromThread } from '@/lib/context/work-patterns-service';

// POST /api/inbox/[id]/open-workflow
// Creates (or returns existing) work thread pre-seeded from an executable inbox item.
// Idempotent: returns the existing thread if work_thread_id is already set.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load the inbox item (must belong to user and be executable)
    const { data: item, error: itemError } = await supabase
      .from('inbox_items')
      .select('id, work_title, work_thread_id, execution_plan, source_data')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Idempotent: return existing thread if already linked
    if (item.work_thread_id) {
      return NextResponse.json({ threadId: item.work_thread_id });
    }

    if (!item.execution_plan) {
      return NextResponse.json({ error: 'Item has no execution plan' }, { status: 400 });
    }

    const plan = item.execution_plan;
    const fromName = item.source_data?.from_name || item.source_data?.from || null;

    // Use service role client for writes that bypass RLS (messages table)
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Create the work thread pre-seeded with the execution plan
    const title = item.work_title || plan.deliverable_description || 'Untitled workflow';
    const { data: thread, error: threadError } = await adminClient
      .from('work_threads')
      .insert({
        user_id: user.id,
        title: title.substring(0, 200),
        plan,
        status: 'active',
      })
      .select('id, title, plan, status, created_at, updated_at')
      .single();

    if (threadError || !thread) {
      console.error('[OpenWorkflow] Failed to create thread:', threadError);
      return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 });
    }

    // 2. Save initial assistant message with email context
    const requestedBy = fromName ? `the request from ${fromName}` : 'the email';
    const initialMessage = `I've set up this workflow based on ${requestedBy}. The plan outlines ${plan.deliverable_description || 'the deliverable'}. Feel free to refine any part of it or add more context.`;

    await adminClient.from('work_messages').insert({
      thread_id: thread.id,
      role: 'assistant',
      content: initialMessage,
    });

    // 3. Link inbox item to this thread
    await supabase
      .from('inbox_items')
      .update({ work_thread_id: thread.id })
      .eq('id', itemId);

    // 4. Update work_patterns context profile (non-fatal)
    await updateWorkPatternsFromThread(
      user.id,
      thread.id,
      thread.title,
      plan,
      adminClient
    );

    return NextResponse.json({ threadId: thread.id });
  } catch (error) {
    console.error('[OpenWorkflow] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
