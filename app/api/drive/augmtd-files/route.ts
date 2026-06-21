import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DriveAugmtdFile } from '@/lib/types/drive';
import { DocumentArtifact } from '@/lib/types/inbox';

// GET /api/drive/augmtd-files
// Returns DriveAugmtdFile[] from work_threads (flattened) + process_steps (generator type)
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const files: DriveAugmtdFile[] = [];

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Resolve augmtd source ID upfront (used for transcripts section + is_indexed check)
    const { data: augmtdSource } = await adminClient
      .from('knowledge_sources')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'augmtd')
      .maybeSingle();
    const augmtdSourceId = augmtdSource?.id ?? null;

    // 1. Work threads — artifact METADATA only (RPC strips the heavy `content` bodies
    //    server-side so the list query doesn't ship full documents over the wire).
    type ArtRow = {
      work_thread_id: string; workflow_id: string | null; art_id: string;
      title: string; art_type: string; folder_id: string | null;
      generated_at: string | null; storage_path: string | null;
    };
    let rows: ArtRow[] = [];
    const { data: artRows, error: rpcError } = await adminClient
      .rpc('drive_augmtd_artifacts', { p_user_id: user.id });
    if (rpcError) {
      // Fallback (migration not yet applied): flatten artifacts in JS the old way.
      const { data: threads } = await adminClient
        .from('work_threads').select('id, artifacts, artifact, workflow_id').eq('user_id', user.id);
      for (const t of (threads ?? []) as any[]) {
        for (const a of ((t.artifacts as DocumentArtifact[]) ?? [])) {
          if (!a.storage_path && a.type !== 'email') continue;
          rows.push({ work_thread_id: t.id, workflow_id: t.workflow_id, art_id: a.id ?? a.storage_path ?? '', title: a.title, art_type: a.type, folder_id: a.folder_id ?? null, generated_at: a.generated_at ?? null, storage_path: a.storage_path ?? null });
        }
        const s = t.artifact as DocumentArtifact | null;
        if (s?.storage_path) rows.push({ work_thread_id: t.id, workflow_id: t.workflow_id, art_id: s.id ?? s.storage_path, title: s.title, art_type: s.type, folder_id: s.folder_id ?? null, generated_at: s.generated_at ?? null, storage_path: s.storage_path ?? null });
      }
    } else {
      rows = (artRows ?? []) as ArtRow[];
    }

    // Resolve agent names for worker-produced files
    const agentNameByWorkflowId = new Map<string, string>();
    const workflowIds = [...new Set(rows.map(r => r.workflow_id).filter(Boolean))] as string[];
    if (workflowIds.length > 0) {
      const { data: workflowRows } = await adminClient
        .from('workflows')
        .select('id, agent_id')
        .in('id', workflowIds)
        .not('agent_id', 'is', null);
      if (workflowRows?.length) {
        const agentIds = [...new Set(workflowRows.map((w: any) => w.agent_id))];
        const { data: agentRows } = await adminClient
          .from('custom_agents')
          .select('id, name')
          .in('id', agentIds);
        const agentById = new Map(agentRows?.map((a: any) => [a.id, a.name]) ?? []);
        for (const w of workflowRows as any[]) {
          if (w.agent_id) agentNameByWorkflowId.set(w.id, agentById.get(w.agent_id) ?? '');
        }
      }
    }

    const processed = new Set<string>();
    for (const r of rows) {
      if (!r.art_id || processed.has(r.art_id)) continue;
      processed.add(r.art_id);
      files.push({
        id: r.art_id,
        title: r.title,
        type: r.art_type as DocumentArtifact['type'],
        source: 'workflow',
        folder_id: r.folder_id ?? undefined,
        generated_at: r.generated_at ?? '',
        work_thread_id: r.work_thread_id,
        storage_path: r.storage_path ?? undefined,
        agent_name: (r.workflow_id ? agentNameByWorkflowId.get(r.workflow_id) : undefined) || undefined,
      });
    }

    // 2. Meeting transcripts — indexed to KB via augmtd source
    if (augmtdSourceId) {
      const { data: transcriptFiles } = await adminClient
        .from('knowledge_files')
        .select('id, provider_file_id, filename, indexed_at, folder_id')
        .eq('source_id', augmtdSourceId)
        .eq('user_id', user.id)
        .like('provider_file_id', 'transcript::%')
        .order('indexed_at', { ascending: false });

      for (const tf of transcriptFiles ?? []) {
        const transcriptId = (tf.provider_file_id as string).replace('transcript::', '');
        files.push({
          id: tf.provider_file_id,
          title: tf.filename,
          type: 'transcript',
          source: 'meeting',
          folder_id: tf.folder_id ?? undefined,
          generated_at: tf.indexed_at,
          transcript_id: transcriptId,
          is_indexed: true,
        });
      }
    }

    // Sort by generated_at DESC
    files.sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());

    // Mark which artifacts are indexed in the KB (skip meeting transcripts — already marked)
    const artifactIds = files.filter((f) => f.source !== 'meeting').map((f) => f.id).filter(Boolean);
    if (artifactIds.length > 0) {
      const { data: indexedRows } = await adminClient
        .from('knowledge_files')
        .select('provider_file_id')
        .in('provider_file_id', artifactIds)
        .eq('user_id', user.id);
      const indexedSet = new Set(indexedRows?.map((r) => r.provider_file_id) ?? []);
      files.forEach((f) => { if (f.source !== 'meeting') f.is_indexed = indexedSet.has(f.id); });
    }

    return NextResponse.json(files);
  } catch (error) {
    console.error('[Drive/AugmtdFiles] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }
}
