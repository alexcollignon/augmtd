import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/work/threads/[id]/kb-input — accept or dismiss a KB suggestion input
export async function PATCH(
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

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, plan')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const { inputId, action, kbFileId, filename } = body as {
      inputId?: string;
      action: 'accept' | 'dismiss' | 'add';
      kbFileId?: string;
      filename?: string;
    };

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    const plan = thread.plan as any;
    plan.inputs = plan.inputs ?? [];

    if (action === 'add') {
      if (!kbFileId || !filename) {
        return NextResponse.json({ error: 'kbFileId and filename are required for add' }, { status: 400 });
      }
      // Avoid duplicates
      const alreadyAdded = plan.inputs.some((i: any) => i.kbFileId === kbFileId);
      if (!alreadyAdded) {
        const newId = `kb_manual_${Date.now()}`;
        plan.inputs = [...plan.inputs, {
          id: newId,
          name: filename,
          type: 'context',
          description: 'From your knowledge base',
          required: false,
          status: 'provided',
          fromKB: true,
          kbFileId,
        }];
      }
    } else if (action === 'accept') {
      plan.inputs = plan.inputs.map((input: any) => {
        if (input.id !== inputId) return input;
        // Accept inline kbSuggestion: mark input as KB-provided, clear suggestion
        if (input.kbSuggestion) {
          const { kbSuggestion, ...rest } = input;
          return { ...rest, status: 'provided', fromKB: true, kbFileId: kbSuggestion.fileId };
        }
        return { ...input, status: 'provided' };
      });
    } else if (action === 'dismiss') {
      plan.inputs = plan.inputs.map((input: any) => {
        if (input.id !== inputId) return input;
        // Dismiss inline suggestion: just clear kbSuggestion, keep the input slot
        if (input.kbSuggestion) {
          const { kbSuggestion: _, ...rest } = input;
          return rest;
        }
        return input;
      }).filter((input: any) => {
        // Remove standalone fromKB inputs (manual adds) when dismissed
        if (input.id !== inputId) return true;
        return !input.fromKB;
      });
    } else {
      return NextResponse.json({ error: 'action must be accept, dismiss, or add' }, { status: 400 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await adminClient
      .from('work_threads')
      .update({ plan, updated_at: new Date().toISOString() })
      .eq('id', threadId);

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('[KBInput] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update KB input' }, { status: 500 });
  }
}
