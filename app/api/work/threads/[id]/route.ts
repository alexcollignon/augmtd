import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/work/threads/[id] — lightweight poll for generating state + latest artifacts
export async function GET(
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

    const { data: thread, error } = await supabase
      .from('work_threads')
      .select('id, title, plan, artifact, artifacts, status, auto_generated, saved_workflow_id, is_generating, created_at, updated_at, agent_id, workflow_id')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (error || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({ thread });
  } catch (error) {
    console.error('[WorkThread] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 500 });
  }
}

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

    // Load artifact(s) before deleting so we can clean up storage
    const { data: thread } = await supabase
      .from('work_threads')
      .select('artifact, artifacts, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    const { error } = await supabase
      .from('work_threads')
      .delete()
      .eq('id', threadId)
      .eq('user_id', user.id);

    if (error) throw error;

    // Collect all artifact IDs + storage paths from artifacts array + legacy singular artifact (deduped)
    const allPaths = new Set<string>();
    const allArtifactIds = new Set<string>();
    const artifactsArray = ((thread as any)?.artifacts as Array<{ id?: string; storage_path?: string }>) || [];
    for (const a of artifactsArray) {
      if (a.storage_path) allPaths.add(a.storage_path);
      if (a.id) allArtifactIds.add(a.id);
    }
    const legacyArtifact = (thread as any)?.artifact as { id?: string; storage_path?: string } | null;
    if (legacyArtifact?.storage_path) allPaths.add(legacyArtifact.storage_path);
    if (legacyArtifact?.id) allArtifactIds.add(legacyArtifact.id);

    // Collect chat-attachment storage paths (email-attachments bucket)
    const userAttachments = ((thread as any)?.user_attachments as Array<{ storagePath?: string }>) || [];
    const attachmentPaths = userAttachments.map(a => a.storagePath).filter(Boolean) as string[];

    if (allPaths.size > 0 || allArtifactIds.size > 0 || attachmentPaths.length > 0) {
      const adminClient = (await import('@supabase/supabase-js')).createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      if (allPaths.size > 0) {
        await adminClient.storage.from('work-artifacts').remove([...allPaths]);
      }

      if (attachmentPaths.length > 0) {
        await adminClient.storage.from('email-attachments').remove(attachmentPaths);
      }

      // Clean up KB entries — look up by artifact IDs, artifact storage paths,
      // and chat-attachment storage paths
      const kbFileIdSet = new Set<string>();

      if (allArtifactIds.size > 0) {
        const { data } = await adminClient
          .from('knowledge_files')
          .select('id')
          .in('provider_file_id', [...allArtifactIds])
          .eq('user_id', user.id);
        data?.forEach((f: { id: string }) => kbFileIdSet.add(f.id));
      }

      const allKBPaths = [...allPaths, ...attachmentPaths];
      if (allKBPaths.length > 0) {
        const { data } = await adminClient
          .from('knowledge_files')
          .select('id')
          .in('storage_path', allKBPaths)
          .eq('user_id', user.id);
        data?.forEach((f: { id: string }) => kbFileIdSet.add(f.id));
      }

      if (kbFileIdSet.size > 0) {
        const kbFileIds = [...kbFileIdSet];
        await adminClient.from('knowledge_chunks').delete().in('file_id', kbFileIds);
        await adminClient.from('knowledge_files').delete().in('id', kbFileIds);
      }
    }

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
