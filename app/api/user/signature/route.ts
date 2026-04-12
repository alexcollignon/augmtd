import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { fetchGmailSignature } from '@/lib/google/gmail';

// GET /api/user/signature?connectionId=xxx
// Returns the stored signature for a connection, auto-fetching from Gmail if not yet stored.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const connectionId = request.nextUrl.searchParams.get('connectionId');

    let query = supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook']);

    if (connectionId) query = (query as any).eq('id', connectionId);
    else query = (query as any).order('created_at', { ascending: true }).limit(1);

    const { data: connection } = await (query as any).maybeSingle();
    if (!connection) return NextResponse.json({ signature: null });

    // Return stored signature if we already have it
    if (connection.metadata?.signature !== undefined) {
      return NextResponse.json({ signature: connection.metadata.signature ?? null });
    }

    // Auto-fetch from Gmail if not yet stored
    if (connection.provider === 'gmail' && connection.metadata?.tokens) {
      const signature = await fetchGmailSignature(connection.metadata.tokens);

      // Persist to metadata so we don't re-fetch every time
      const adminSupabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      await adminSupabase
        .from('connections')
        .update({ metadata: { ...connection.metadata, signature: signature ?? '' } })
        .eq('id', connection.id);

      return NextResponse.json({ signature });
    }

    // Outlook or no tokens — return null (user configures manually)
    return NextResponse.json({ signature: null });
  } catch (err) {
    console.error('[Signature] GET error:', err);
    return NextResponse.json({ signature: null });
  }
}

// POST /api/user/signature — save signature for a connection
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { connectionId, signature } = await request.json();
    if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 });

    const { data: connection } = await supabase
      .from('connections')
      .select('id, metadata')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .single();

    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    await adminSupabase
      .from('connections')
      .update({ metadata: { ...connection.metadata, signature: signature ?? '' } })
      .eq('id', connection.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Signature] POST error:', err);
    return NextResponse.json({ error: 'Failed to save signature' }, { status: 500 });
  }
}
