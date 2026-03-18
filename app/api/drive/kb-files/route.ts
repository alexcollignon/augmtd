import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/drive/kb-files
// Returns knowledge_files for this user including folder_id and storage_path (if columns exist)
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('knowledge_files')
      .select('id, filename, mime_type, size_bytes, indexed_at, folder_id, storage_path, source_id')
      .eq('user_id', user.id)
      .order('indexed_at', { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('[Drive/KbFiles] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }
}
