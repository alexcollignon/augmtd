import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { indexSource } from '@/lib/knowledge/indexer';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Find stale sources: not synced in 24h or in error state
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleSources, error } = await adminClient
    .from('knowledge_sources')
    .select('id')
    .or(`last_synced_at.lt.${staleThreshold},last_synced_at.is.null,status.eq.error`);

  if (error) {
    console.error('[KnowledgeCron] Error fetching stale sources:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!staleSources || staleSources.length === 0) {
    return NextResponse.json({ success: true, processed: 0 });
  }

  console.log(`[KnowledgeCron] Re-indexing ${staleSources.length} stale sources`);

  let totalIndexed = 0;
  let totalErrors = 0;

  for (const source of staleSources) {
    const result = await indexSource(source.id, adminClient);
    totalIndexed += result.indexed;
    totalErrors += result.errors;
  }

  return NextResponse.json({
    success: true,
    processed: staleSources.length,
    totalIndexed,
    totalErrors,
  });
}
