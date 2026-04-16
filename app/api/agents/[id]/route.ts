import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateStartersForAgent } from '@/lib/agents/generate-starters';

type Params = { params: Promise<{ id: string }> };

// GET /api/agents/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: agent, error } = await supabase
      .from('custom_agents')
      .select(`
        id, name, description, instructions, memory_text, color, icon, is_active, created_at, updated_at,
        conversation_starters, web_enabled,
        agent_knowledge_sources (id, name, knowledge_file_id, created_at)
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ agent });
  } catch (err) {
    console.error('[Agents/id] GET error:', err);
    return NextResponse.json({ error: 'Failed to load agent' }, { status: 500 });
  }
}

// PATCH /api/agents/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const allowed = ['name', 'description', 'instructions', 'color', 'icon', 'memory_text', 'conversation_starters', 'web_enabled'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if ('name' in updates && !String(updates.name).trim()) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }

    // Resolve starters: if provided, clean them; if null/empty, auto-generate
    if ('conversation_starters' in body) {
      const provided = body.conversation_starters as string[] | null;
      const cleaned = (provided ?? []).filter((s: string) => s.trim());
      if (cleaned.length > 0) {
        updates.conversation_starters = cleaned.slice(0, 4);
      } else {
        // Auto-generate from the latest name/description/instructions
        const name = String(updates.name ?? body.name ?? '');
        const generated = await generateStartersForAgent({
          name,
          description: body.description ?? null,
          instructions: body.instructions ?? null,
          userId: user.id,
          supabase,
        });
        updates.conversation_starters = generated;
      }
    }

    const { data: agent, error } = await supabase
      .from('custom_agents')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error || !agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ agent });
  } catch (err) {
    console.error('[Agents/id] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}

// DELETE /api/agents/[id] — hard delete: agent + all threads/artifacts/KB
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: agentId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify ownership
    const { data: agent } = await supabase
      .from('custom_agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();
    if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Load all threads for this agent so we can clean up their artifacts
    const { data: threads } = await adminClient
      .from('work_threads')
      .select('id, artifact, artifacts, user_attachments')
      .eq('agent_id', agentId)
      .eq('user_id', user.id);

    // 2. Collect all storage paths and artifact IDs across all threads
    const allStoragePaths = new Set<string>();
    const allArtifactIds = new Set<string>();
    const allAttachmentPaths = new Set<string>();

    for (const thread of threads ?? []) {
      const artifactsArr = (thread.artifacts as Array<{ id?: string; storage_path?: string }>) ?? [];
      for (const a of artifactsArr) {
        if (a.storage_path) allStoragePaths.add(a.storage_path);
        if (a.id) allArtifactIds.add(a.id);
      }
      const legacy = thread.artifact as { id?: string; storage_path?: string } | null;
      if (legacy?.storage_path) allStoragePaths.add(legacy.storage_path);
      if (legacy?.id) allArtifactIds.add(legacy.id);

      const attachments = (thread.user_attachments as Array<{ storagePath?: string }>) ?? [];
      for (const a of attachments) {
        if (a.storagePath) allAttachmentPaths.add(a.storagePath);
      }
    }

    // 3. Delete storage files
    if (allStoragePaths.size > 0) {
      await adminClient.storage.from('work-artifacts').remove([...allStoragePaths]);
    }
    if (allAttachmentPaths.size > 0) {
      await adminClient.storage.from('email-attachments').remove([...allAttachmentPaths]);
    }

    // 4. Clean up KB entries for artifacts
    const kbFileIds = new Set<string>();
    if (allArtifactIds.size > 0) {
      const { data: byArtifact } = await adminClient
        .from('knowledge_files')
        .select('id')
        .in('provider_file_id', [...allArtifactIds])
        .eq('user_id', user.id);
      byArtifact?.forEach((f: { id: string }) => kbFileIds.add(f.id));
    }
    const allKBPaths = [...allStoragePaths, ...allAttachmentPaths];
    if (allKBPaths.length > 0) {
      const { data: byPath } = await adminClient
        .from('knowledge_files')
        .select('id')
        .in('storage_path', allKBPaths)
        .eq('user_id', user.id);
      byPath?.forEach((f: { id: string }) => kbFileIds.add(f.id));
    }
    if (kbFileIds.size > 0) {
      await adminClient.from('knowledge_chunks').delete().in('file_id', [...kbFileIds]);
      await adminClient.from('knowledge_files').delete().in('id', [...kbFileIds]);
    }

    // 5. Delete all threads (cascades to work_messages via FK)
    if ((threads ?? []).length > 0) {
      await adminClient
        .from('work_threads')
        .delete()
        .eq('agent_id', agentId)
        .eq('user_id', user.id);
    }

    // 6. Delete agent_knowledge_sources (KB files attached to the agent itself)
    await adminClient
      .from('agent_knowledge_sources')
      .delete()
      .eq('agent_id', agentId);

    // 7. Hard delete the agent
    await adminClient
      .from('custom_agents')
      .delete()
      .eq('id', agentId)
      .eq('user_id', user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Agents/id] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
