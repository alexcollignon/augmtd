import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/work/threads/[id]/kb-search?q=query — search user's knowledge base
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const q = request.nextUrl.searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify thread belongs to user and load plan to build exclusion list
    const { data: thread } = await supabase
      .from('work_threads')
      .select('id, plan')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    // Exclude files already accepted anywhere in this plan
    const usedFileIds = new Set<string>(
      ((thread as any).plan?.inputs ?? [])
        .filter((i: any) => i.kbFileId && i.status === 'provided')
        .map((i: any) => i.kbFileId as string)
    );

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { searchKnowledge } = await import('@/lib/knowledge/indexer');
    const results = await searchKnowledge(user.id, q, 8, adminClient);
    const relevant = results.filter((r) => (r.similarity ?? 0) >= 0.25 && !usedFileIds.has(r.id));

    return NextResponse.json({
      results: relevant.map((r) => ({ id: r.id, filename: r.filename })),
    });
  } catch (error) {
    console.error('[KBSearch] GET error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
