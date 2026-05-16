import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeError } from '@/lib/utils/api-error';

// GET /api/connections
// Returns active Gmail + Outlook connections for the current user (id, provider, email only)
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: connections, error } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook'])
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
    }

    const result = (connections ?? []).map((c) => ({
      id: c.id as string,
      provider: c.provider as string,
      email: (c.metadata as any)?.email as string | undefined,
    }));

    return NextResponse.json({ connections: result });
  } catch (err) {
    console.error('[Connections] GET error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
