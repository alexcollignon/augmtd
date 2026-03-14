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
          let folders;
          if (conn.provider === 'gmail') {
            folders = await listGmailAllFolders(conn.metadata.tokens);
          } else {
            // Pass token refresh callback so Outlook tokens are persisted after refresh
            folders = await listOutlookAllFolders(
              conn.metadata.tokens,
              async (newTokens) => {
                const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
                await supabase
                  .from('connections')
                  .update({ metadata: { ...conn.metadata, tokens: newEncrypted } })
                  .eq('id', conn.id);
              },
            );
          }
          return { connectionId: conn.id, provider: conn.provider, folders };
        } catch (err) {
          console.error(`[Folders] Failed to list folders for ${conn.provider} connection ${conn.id}:`, err);
          return { connectionId: conn.id, provider: conn.provider, folders: [], error: String(err) };
        }
      })
    );

    return NextResponse.json({ connections: results });
  } catch (error) {
    console.error('[Folders] GET error:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}
