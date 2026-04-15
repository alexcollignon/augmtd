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

    // 1. Work threads — flatten artifacts array
    const { data: threads } = await supabase
      .from('work_threads')
      .select('id, artifacts, artifact')
      .eq('user_id', user.id);

    if (threads) {
      for (const thread of threads) {
        const artifacts = ((thread as any).artifacts as DocumentArtifact[]) || [];
        const processed = new Set<string>();

        for (const art of artifacts) {
          if (!art.storage_path && art.type !== 'email') continue;
          const artId = art.id ?? art.storage_path ?? '';
          if (!artId || processed.has(artId)) continue;
          processed.add(artId);

          files.push({
            id: artId,
            title: art.title,
            type: art.type,
            source: 'workflow',
            folder_id: art.folder_id,
            generated_at: art.generated_at,
            work_thread_id: thread.id,
            storage_path: art.storage_path,
          });
        }

        // Legacy singular artifact
        const singular = (thread as any).artifact as DocumentArtifact | null;
        if (singular?.storage_path) {
          const singularId = singular.id ?? singular.storage_path;
          if (!processed.has(singularId)) {
            files.push({
              id: singularId,
              title: singular.title,
              type: singular.type,
              source: 'workflow',
              folder_id: singular.folder_id,
              generated_at: singular.generated_at,
              work_thread_id: thread.id,
              storage_path: singular.storage_path,
            });
          }
        }
      }
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
