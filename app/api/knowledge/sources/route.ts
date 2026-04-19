import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSupabase } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('knowledge_sources')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { provider, folder_id, folder_name, connection_id, file_ids } = body;

  if (!provider || !folder_name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Verify the connection belongs to this user and is active
  const connectionProvider = provider === 'google_drive' ? 'gmail' : 'outlook';
  let query = supabase
    .from('connections')
    .select('id')
    .eq('user_id', user.id)
    .eq('provider', connectionProvider)
    .eq('status', 'active');

  if (connection_id) query = query.eq('id', connection_id);

  const { data: connections } = await query.limit(1);

  if (!connections?.length) {
    return NextResponse.json(
      { error: `No active ${connectionProvider} connection. Connect ${connectionProvider === 'gmail' ? 'Gmail' : 'Outlook'} first.` },
      { status: 400 }
    );
  }

  const resolvedConnectionId = connection_id ?? connections[0].id;

  const { data: source, error } = await supabase
    .from('knowledge_sources')
    .insert({
      user_id: user.id,
      provider,
      folder_id,
      folder_name,
      connection_id: resolvedConnectionId,
      status: 'pending',
      file_ids: file_ids ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trigger indexing asynchronously (fire-and-forget)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  fetch(`${appUrl}/api/knowledge/sources/${source.id}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Pass service role key in internal header for auth bypass
      'x-internal-sync': process.env.CRON_SECRET ?? '',
    },
  }).catch((err) => console.error('[KnowledgeSources] Async index trigger failed:', err));

  return NextResponse.json(source, { status: 201 });
}
