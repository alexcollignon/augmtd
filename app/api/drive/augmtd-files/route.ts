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

    // 2. Process steps — generator type with artifact
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get user's company memberships
    const { data: memberships } = await adminClient
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (memberships && memberships.length > 0) {
      const companyIds = memberships.map((m) => m.company_id);

      const { data: steps } = await adminClient
        .from('process_steps')
        .select('id, process_id, step_index, artifact, tool')
        .in('process_id', (
          await adminClient
            .from('processes')
            .select('id')
            .in('company_id', companyIds)
        ).data?.map((p) => p.id) ?? [])
        .eq('step_type', 'generator')
        .not('artifact', 'is', null);

      if (steps) {
        for (const step of steps) {
          const art = step.artifact as DocumentArtifact | null;
          if (!art?.storage_path) continue;

          const artId = art.id ?? art.storage_path;
          files.push({
            id: artId,
            title: art.title,
            type: art.type,
            source: 'process',
            folder_id: art.folder_id,
            generated_at: art.generated_at,
            process_id: step.process_id,
            process_step_index: step.step_index,
            storage_path: art.storage_path,
          });
        }
      }
    }

    // Sort by generated_at DESC
    files.sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());

    return NextResponse.json(files);
  } catch (error) {
    console.error('[Drive/AugmtdFiles] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }
}
