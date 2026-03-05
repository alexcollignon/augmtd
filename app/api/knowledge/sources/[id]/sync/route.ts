import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { indexSource } from '@/lib/knowledge/indexer';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Allow both user-authenticated requests and internal async triggers
  const internalHeader = request.headers.get('x-internal-sync');
  const isInternal = internalHeader === process.env.CRON_SECRET;

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let userId: string;

  if (isInternal) {
    // Get user_id from the source directly
    const { data: source } = await adminClient
      .from('knowledge_sources')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    userId = source.user_id;
  } else {
    // User-authenticated request — verify ownership
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: source } = await supabase
      .from('knowledge_sources')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    userId = user.id;
  }

  // Reset status to pending before indexing
  await adminClient
    .from('knowledge_sources')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', id);

  const result = await indexSource(id, adminClient);

  return NextResponse.json({ success: true, ...result });
}
