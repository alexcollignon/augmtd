import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { searchKnowledge } from '@/lib/knowledge/indexer';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get('source_id');
  const search = searchParams.get('search');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  // Semantic search path
  if (search && search.trim().length > 0) {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const results = await searchKnowledge(user.id, search, limit, adminClient);
    return NextResponse.json({ data: results, total: results.length });
  }

  // Paginated browse path
  let query = supabase
    .from('knowledge_files')
    .select('id, user_id, source_id, provider_file_id, filename, mime_type, extracted_text, size_bytes, last_modified_at, indexed_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('indexed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceId) query = query.eq('source_id', sourceId);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0 });
}
