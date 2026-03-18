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

    // Exclude augmtd-sourced files — those are already shown via the AUGMTD Files tab
    const { data: augmtdSource } = await supabase
      .from('knowledge_sources')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'augmtd')
      .maybeSingle();

    let query = supabase
      .from('knowledge_files')
      .select('id, filename, mime_type, size_bytes, indexed_at, folder_id, storage_path, source_id, knowledge_chunks(count)')
      .eq('user_id', user.id)
      .order('indexed_at', { ascending: false })
      .limit(200);

    if (augmtdSource) {
      query = query.neq('source_id', augmtdSource.id);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const files = (data ?? []).map((f) => ({
      ...f,
      chunk_count: (f.knowledge_chunks as unknown as { count: number }[])?.[0]?.count ?? 0,
      knowledge_chunks: undefined,
    }));

    return NextResponse.json(files);
  } catch (error) {
    console.error('[Drive/KbFiles] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }
}
