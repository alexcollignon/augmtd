import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renameKnowledgeFolder } from '@/lib/knowledge/rename-folder';

// PATCH /api/drive/folders/[id] — rename a folder, AND EVERYTHING THAT NAMES IT.
// Body: { name } → { ...folder, repointedSteps, repointedWorkflows, manifestMoved }
//
// The whole deed lives in lib/knowledge/rename-folder.ts (THE RENAME HEAL) — the validation, the
// pointer re-pointing, the order of operations and the rollback. This route is the door; a script
// driving a rename calls the SAME function, so no caller can rename a folder without the heal.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name } = await request.json() as { name: string };
    const res = await renameKnowledgeFolder(supabase, user.id, id, name);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

    return NextResponse.json({
      ...res.folder,
      repointedSteps: res.repointedSteps,
      repointedWorkflows: res.repointedWorkflows,
      manifestMoved: res.manifestMoved,
    });
  } catch (error) {
    console.error('[Drive/Folders PATCH] Error:', error);
    return NextResponse.json({ error: 'Failed to rename folder' }, { status: 500 });
  }
}

// DELETE /api/drive/folders/[id]
// knowledge_files.folder_id → NULL via ON DELETE SET NULL
// Also clears folder_id from matching work_threads.artifacts JSONB entries
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── DELETE IS OFFERED ONLY ON AN EMPTY FOLDER (the knowledge-folders surface, Sep 2) ────────
    // Simplicity over cascade semantics: there is no "what happens to the files?" question to
    // answer if a folder can only die empty. The panel hides the affordance on a non-empty folder;
    // this is the floor underneath that — a refusal, never a silent orphaning of indexed work.
    const { data: folder } = await supabase
      .from('drive_folders').select('id, is_system').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    if ((folder as { is_system: boolean }).is_system) {
      return NextResponse.json({ error: 'This folder is managed by the system.' }, { status: 409 });
    }

    const { count: fileCount } = await supabase
      .from('knowledge_files').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('folder_id', id);
    if ((fileCount ?? 0) > 0) {
      return NextResponse.json(
        { error: `This folder still holds ${fileCount} file${fileCount === 1 ? '' : 's'}. Move them out first.` },
        { status: 409 },
      );
    }

    const { count: childCount } = await supabase
      .from('drive_folders').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('parent_id', id);
    if ((childCount ?? 0) > 0) {
      return NextResponse.json({ error: 'This folder still holds other folders.' }, { status: 409 });
    }

    // Clear folder_id from work_threads.artifacts JSONB for this user
    // We use a raw SQL approach via adminClient
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Find all work_threads for this user that have artifacts with this folder_id
    const { data: threads } = await adminClient
      .from('work_threads')
      .select('id, artifacts')
      .eq('user_id', user.id);

    if (threads) {
      for (const thread of threads) {
        const artifacts = (thread.artifacts as Array<{ id?: string; folder_id?: string }>) || [];
        const hasMatch = artifacts.some((a) => a.folder_id === id);
        if (hasMatch) {
          const updated = artifacts.map((a) =>
            a.folder_id === id ? { ...a, folder_id: undefined } : a
          );
          await adminClient
            .from('work_threads')
            .update({ artifacts: updated })
            .eq('id', thread.id);
        }
      }
    }

    // Delete the folder row — ON DELETE SET NULL handles knowledge_files.folder_id
    const { error } = await supabase
      .from('drive_folders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Drive/Folders DELETE] Error:', error);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 });
  }
}
