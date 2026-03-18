import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// DELETE /api/drive/uploads/[id]
// Deletes storage file + knowledge_chunks + knowledge_files row
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

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify file belongs to user and get storage_path
    const { data: fileRow, error: fetchError } = await adminClient
      .from('knowledge_files')
      .select('id, user_id, storage_path')
      .eq('id', id)
      .single();

    if (fetchError || !fileRow) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (fileRow.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete chunks first
    await adminClient.from('knowledge_chunks').delete().eq('file_id', id);

    // Delete knowledge_files row
    await adminClient.from('knowledge_files').delete().eq('id', id);

    // Delete from storage if uploaded file
    if (fileRow.storage_path) {
      const { error: storageError } = await adminClient.storage
        .from('drive-uploads')
        .remove([fileRow.storage_path]);
      if (storageError) {
        console.error('[Drive/Delete] Storage delete error:', storageError);
        // Non-fatal — DB records already cleaned up
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Drive/Delete] Error:', error);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}
