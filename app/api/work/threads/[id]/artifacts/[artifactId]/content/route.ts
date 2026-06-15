import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import type { DocumentArtifact } from '@/lib/types/inbox';

// GET /api/work/threads/[id]/artifacts/[artifactId]/content
// Returns the structured content of a specific artifact for in-panel preview.
// If the artifact is not found in the given thread, falls back to scanning all
// threads owned by this user — supports worker task output artifacts which live
// in a separate thread from the worker chat thread.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id: threadId, artifactId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Try the named thread first
  const { data: thread } = await admin
    .from('work_threads')
    .select('id, artifacts, user_id')
    .eq('id', threadId)
    .eq('user_id', user.id)
    .single();

  if (thread) {
    const artifacts: DocumentArtifact[] = Array.isArray(thread.artifacts) ? thread.artifacts : [];
    const artifact = artifacts.find(a => a.id === artifactId);
    if (artifact) {
      return NextResponse.json({
        content: artifact.content ?? null,
        title: artifact.title,
        type: artifact.type,
        generated_at: artifact.generated_at,
        has_file: !!artifact.storage_path,
        thread_id: thread.id,
      });
    }
  }

  // Fallback: scan user's threads for the artifact — covers worker task output threads
  // where the artifact lives in a different thread than the one passed in the URL.
  const { data: allThreads } = await admin
    .from('work_threads')
    .select('id, artifacts')
    .eq('user_id', user.id)
    .not('artifacts', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  for (const t of (allThreads ?? [])) {
    const arts: DocumentArtifact[] = Array.isArray(t.artifacts) ? t.artifacts : [];
    const artifact = arts.find(a => a.id === artifactId);
    if (artifact) {
      return NextResponse.json({
        content: artifact.content ?? null,
        title: artifact.title,
        type: artifact.type,
        generated_at: artifact.generated_at,
        has_file: !!artifact.storage_path,
        thread_id: t.id,
      });
    }
  }

  return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
}
