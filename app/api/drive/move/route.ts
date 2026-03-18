import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/drive/move
// Body: { type: 'kb_file' | 'artifact', id, folderId: string | null, workThreadId?: string }
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, id, folderId, workThreadId } = body as {
      type: 'kb_file' | 'artifact';
      id: string;
      folderId: string | null;
      workThreadId?: string;
    };

    if (!type || !id) {
      return NextResponse.json({ error: 'type and id are required' }, { status: 400 });
    }

    if (type === 'kb_file') {
      const { error } = await supabase
        .from('knowledge_files')
        .update({ folder_id: folderId })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    if (type === 'artifact') {
      if (!workThreadId) {
        return NextResponse.json({ error: 'workThreadId is required for artifact move' }, { status: 400 });
      }

      const { data: thread, error: threadError } = await supabase
        .from('work_threads')
        .select('id, artifacts, artifact')
        .eq('id', workThreadId)
        .eq('user_id', user.id)
        .single();

      if (threadError || !thread) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }

      const artifacts = ((thread as any).artifacts as Array<{ id?: string; folder_id?: string }>) || [];
      const updatedArtifacts = artifacts.map((a) =>
        a.id === id ? { ...a, folder_id: folderId ?? undefined } : a
      );

      // Also update singular artifact if it matches (legacy compat)
      const singularArtifact = (thread as any).artifact as { id?: string; folder_id?: string } | null;
      const updatedSingular = singularArtifact?.id === id
        ? { ...singularArtifact, folder_id: folderId ?? undefined }
        : singularArtifact;

      const { error: updateError } = await supabase
        .from('work_threads')
        .update({
          artifacts: updatedArtifacts,
          ...(updatedSingular !== singularArtifact ? { artifact: updatedSingular } : {}),
        })
        .eq('id', workThreadId)
        .eq('user_id', user.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    console.error('[Drive/Move] Error:', error);
    return NextResponse.json({ error: 'Failed to move file' }, { status: 500 });
  }
}
