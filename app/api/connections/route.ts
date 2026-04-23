import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveWorkspaceId } from '@/lib/workspace/active-workspace';

// GET /api/connections
// Returns active Gmail + Outlook connections for the current user (id, provider, email only)
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const activeWorkspaceId = await getActiveWorkspaceId();

    let query = supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook']);
    if (activeWorkspaceId) query = query.or(`workspace_id.eq.${activeWorkspaceId},workspace_id.is.null`);

    const { data: connections, error } = await query.order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
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
