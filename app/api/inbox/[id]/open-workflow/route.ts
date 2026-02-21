import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/inbox/[id]/open-workflow
// Creates (or returns existing) empty work thread from an executable inbox item.
// Returns threadId + workflowPrompt — the client sends the prompt as the first
// workflow chat message so the plan is generated live by the workflow AI.
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

    // Idempotent: if already linked, return the existing thread + its prompt
    if (item.work_thread_id) {
      const workflowPrompt = item.execution_plan?.workflow_prompt || '';
      return NextResponse.json({ threadId: item.work_thread_id, workflowPrompt });
    }

    if (!item.execution_plan?.workflow_prompt) {
      return NextResponse.json({ error: 'Item has no workflow prompt' }, { status: 400 });
    }

    const seed = item.execution_plan;
    const title = item.work_title || seed.deliverable_description || 'Untitled workflow';

    // Inject attachment text into the workflow prompt if available
    const attachments: Array<{ filename: string; extractedText: string | null }> =
      item.source_data?.attachments || [];
    const attachmentContext = attachments
      .filter(a => a.extractedText)
      .map(a => `--- Attachment: ${a.filename} ---\n${a.extractedText}`)
      .join('\n\n');

    const workflowPrompt = attachmentContext
      ? `${seed.workflow_prompt}\n\n${attachmentContext}`
      : seed.workflow_prompt;

    // Use service role client for writes that bypass RLS
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create an empty work thread — plan will be generated live by the workflow AI
    const { data: thread, error: threadError } = await adminClient
      .from('work_threads')
      .insert({
        user_id: user.id,
        title: title.substring(0, 200),
        plan: null,
        status: 'active',
      })
      .select('id')
      .single();

    if (threadError || !thread) {
      console.error('[OpenWorkflow] Failed to create thread:', threadError);
      return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 });
    }

    // Link inbox item to the new thread
    await supabase
      .from('inbox_items')
      .update({ work_thread_id: thread.id })
      .eq('id', itemId);

    return NextResponse.json({
      threadId: thread.id,
      workflowPrompt,
    });
  } catch (error) {
    console.error('[OpenWorkflow] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
