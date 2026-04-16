import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// DELETE /api/drive/uploads/batch
// Body: { ids: string[] }
// Deletes multiple knowledge files (chunks + rows + storage) owned by the current user.
export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json() as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch all files, filtered to this user — prevents deleting other users' files
    const { data: fileRows, error: fetchError } = await adminClient
      .from('knowledge_files')
      .select('id, storage_path')
      .in('id', ids)
      .eq('user_id', user.id);

    if (fetchError) {
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
    }

    if (!fileRows || fileRows.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    const ownedIds = fileRows.map((f) => f.id);

    // Delete chunks (cascade would handle this but let's be explicit)
    await adminClient.from('knowledge_chunks').delete().in('file_id', ownedIds);

    // Delete knowledge_files rows
    await adminClient.from('knowledge_files').delete().in('id', ownedIds);

    // Delete storage files in one batch call (non-fatal)
    const storagePaths = fileRows.map((f) => f.storage_path).filter(Boolean) as string[];
    if (storagePaths.length > 0) {
      const { error: storageError } = await adminClient.storage
        .from('drive-uploads')
        .remove(storagePaths);
      if (storageError) {
        console.error('[Drive/BatchDelete] Storage delete error:', storageError);
      }
    }

    return NextResponse.json({ deleted: ownedIds.length });
  } catch (error) {
    console.error('[Drive/BatchDelete] Error:', error);
    return NextResponse.json({ error: 'Failed to delete files' }, { status: 500 });
  }
}
