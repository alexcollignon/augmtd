import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DocumentArtifact } from '@/lib/types/inbox';

// DELETE /api/work/threads/[id]/artifacts/[artifactId]
// Removes a specific artifact version from the thread.
// Deletes the storage file, removes it from the artifacts array, and keeps singular artifact in sync.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { id: threadId, artifactId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, artifact, artifacts')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const artifactsArray = ((thread as any).artifacts as DocumentArtifact[]) || [];
    const target = artifactsArray.find((a) => a.id === artifactId);

    if (!target) {
      return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
    }

    // Delete the storage file
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    if (target.storage_path) {
      await adminClient.storage.from('work-artifacts').remove([target.storage_path]);
    }

    // Remove from array
    const remaining = artifactsArray.filter((a) => a.id !== artifactId);
    const newLatest = remaining.length > 0 ? remaining[remaining.length - 1] : null;

    await adminClient
      .from('work_threads')
      .update({
        artifacts: remaining,
        artifact: newLatest,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({ artifacts: remaining });
  } catch (error) {
    console.error('[ArtifactDelete] Error:', error);
    return NextResponse.json({ error: 'Failed to delete artifact' }, { status: 500 });
  }
}
