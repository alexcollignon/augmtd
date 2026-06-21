import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Semantic content search over the user's knowledge base (meetings, uploads, generated
// docs). Returns matching knowledge_files ids so the Drive search can surface files by
// their *content*, not just filename. Title matching stays client-side for instant feedback.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ fileIds: [] });

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { searchKnowledgeGrouped } = await import('@/lib/knowledge/search');
    const groups = await searchKnowledgeGrouped(user.id, q, 20, adminClient, { threshold: 0.15 });

    return NextResponse.json({ fileIds: groups.map(g => g.fileId) });
  } catch (err) {
    console.error('[drive/search] error:', err);
    return NextResponse.json({ fileIds: [] });
  }
}
