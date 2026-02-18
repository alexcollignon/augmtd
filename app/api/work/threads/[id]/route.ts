import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/work/threads/[id] — update thread title
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

    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const { data: thread, error } = await supabase
      .from('work_threads')
      .update({
        title: title.trim().substring(0, 200),
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({ thread });
  } catch (error) {
    console.error('[WorkThread] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update thread' }, { status: 500 });
  }
}

// DELETE /api/work/threads/[id] — delete thread and all its messages
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('work_threads')
      .delete()
      .eq('id', threadId)
      .eq('user_id', user.id);

    if (error) throw error;

    // Remove thread from work_patterns.recentWorkflows and recompute aggregates
    const { data: existingProfile } = await supabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'work_patterns')
      .single();

    if (existingProfile?.profile_data?.recentWorkflows) {
      const remaining = existingProfile.profile_data.recentWorkflows.filter(
        (w: { threadId: string }) => w.threadId !== threadId
      );

      const deliverableTypes: Record<string, number> = {};
      for (const w of remaining) {
        if (w.deliverableType) {
          deliverableTypes[w.deliverableType] = (deliverableTypes[w.deliverableType] || 0) + 1;
        }
      }

      const skillCounts: Record<string, number> = {};
      for (const w of remaining) {
        for (const skill of (w.skills || []) as string[]) {
          skillCounts[skill] = (skillCounts[skill] || 0) + 1;
        }
      }
      const commonSkills = Object.entries(skillCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([skill]) => skill);

      await supabase
        .from('context_profiles')
        .update({
          profile_data: {
            ...existingProfile.profile_data,
            recentWorkflows: remaining,
            deliverableTypes,
            commonSkills,
          },
        })
        .eq('user_id', user.id)
        .eq('profile_type', 'work_patterns');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[WorkThread] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete thread' }, { status: 500 });
  }
}
