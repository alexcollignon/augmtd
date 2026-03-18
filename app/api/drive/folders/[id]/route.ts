import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/drive/folders/[id] — rename folder
// Body: { name }
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

    const body = await request.json();
    const { name } = body as { name: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('drive_folders')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, parent_id, is_system, system_key, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    return NextResponse.json(data);
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
