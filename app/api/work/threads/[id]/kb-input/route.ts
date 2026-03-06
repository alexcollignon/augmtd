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
      action: 'accept' | 'dismiss' | 'add' | 'link' | 'confirm';
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
          fromKB: true,    // keeps generation pipeline injection working
          fromContext: true, // UI routes to "additional context" section
          kbFileId,
        }];
      }
    } else if (action === 'accept') {
      if (!inputId || !kbFileId) {
        return NextResponse.json({ error: 'inputId and kbFileId are required for accept' }, { status: 400 });
      }
      plan.inputs = plan.inputs.map((input: any) => {
        if (input.id !== inputId) return input;
        if (input.kbSuggestions) {
          const suggestion = (input.kbSuggestions as any[]).find((s: any) => s.fileId === kbFileId);
          const remaining = (input.kbSuggestions as any[]).filter((s: any) => s.fileId !== kbFileId);
          const accepted = [...(input.kbAccepted ?? []), ...(suggestion ? [suggestion] : [])];
          // Mark as provided immediately on first Use — remaining suggestions stay for additional picks
          const base = { ...input, status: 'provided', source_type: 'kb_found', fromKB: true, kbAccepted: accepted };
          if (remaining.length === 0) {
            const { kbSuggestions: _s, dismissedKbFileIds: _d, ...rest } = base;
            return rest;
          }
          return { ...base, kbSuggestions: remaining };
        }
        // Standalone global KB card
        return { ...input, status: 'provided', source_type: 'kb_found' };
      });
    } else if (action === 'confirm') {
      // User explicitly finalizes their accepted KB files
      if (!inputId) {
        return NextResponse.json({ error: 'inputId is required for confirm' }, { status: 400 });
      }
      plan.inputs = plan.inputs.map((input: any) => {
        if (input.id !== inputId) return input;
        if (!input.kbAccepted?.length) return input;
        const { kbSuggestions: _s, dismissedKbFileIds: _d, ...rest } = input;
        return { ...rest, status: 'provided', source_type: 'kb_found', fromKB: true };
      });
    } else if (action === 'dismiss') {
      if (!inputId || !kbFileId) {
        return NextResponse.json({ error: 'inputId and kbFileId are required for dismiss' }, { status: 400 });
      }
      plan.inputs = plan.inputs.map((input: any) => {
        if (input.id !== inputId) return input;
        if (input.kbSuggestions) {
          const remaining = (input.kbSuggestions as any[]).filter((s: any) => s.fileId !== kbFileId);
          const dismissed = [...(input.dismissedKbFileIds ?? []), kbFileId];
          if (remaining.length === 0) {
            const { kbSuggestions: _s, kbAccepted: _a, dismissedKbFileIds: _d, ...rest } = input;
            if (input.kbAccepted?.length) {
              // Some were accepted before — auto-finalize with those
              return { ...rest, status: 'provided', source_type: 'kb_found', fromKB: true, kbAccepted: input.kbAccepted, dismissedKbFileIds: dismissed };
            }
            // All dismissed — revert to upload state
            return { ...rest, source_type: 'user_upload', dismissedKbFileIds: dismissed };
          }
          return { ...input, kbSuggestions: remaining, dismissedKbFileIds: dismissed };
        }
        return input;
      }).filter((input: any) => {
        // Remove standalone KB cards (global or manual context) when dismissed
        if (input.id !== inputId) return true;
        return !input.id.startsWith('kb_');
      });
    } else if (action === 'link') {
      // Directly bind a KB file to a named input slot (user manually selected from per-input search)
      if (!inputId || !kbFileId || !filename) {
        return NextResponse.json({ error: 'inputId, kbFileId and filename are required for link' }, { status: 400 });
      }
      plan.inputs = plan.inputs.map((input: any) => {
        if (input.id !== inputId) return input;
        const { kbSuggestion: _ks, ...rest } = input;
        return { ...rest, status: 'provided', source_type: 'kb_found', fromKB: true, kbFileId, providedFilename: filename };
      });
    } else {
      return NextResponse.json({ error: 'action must be accept, dismiss, add, link, or confirm' }, { status: 400 });
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
