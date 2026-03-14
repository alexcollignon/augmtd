import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listGmailAllFolders } from '@/lib/google/gmail';
import { listOutlookAllFolders } from '@/lib/microsoft/outlook';

// GET /api/inbox/folders — list all folders across all active connections
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: connections } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook']);

    if (!connections?.length) return NextResponse.json({ connections: [] });

    const results = await Promise.all(
      connections.map(async conn => {
        try {
          const folders =
            conn.provider === 'gmail'
              ? await listGmailAllFolders(conn.metadata.tokens)
              : await listOutlookAllFolders(conn.metadata.tokens);
          return { connectionId: conn.id, provider: conn.provider, folders };
        } catch {
          return { connectionId: conn.id, provider: conn.provider, folders: [] };
        }
      })
    );

    return NextResponse.json({ connections: results });
  } catch (error) {
    console.error('[Folders] GET error:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}
