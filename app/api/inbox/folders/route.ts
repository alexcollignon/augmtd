import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listGmailAllFolders, createGmailLabel, renameGmailLabel, deleteGmailLabel } from '@/lib/google/gmail';
import { listOutlookAllFolders, createOutlookFolder, renameOutlookFolder, deleteOutlookFolder } from '@/lib/microsoft/outlook';

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
          const email = (conn.metadata as any)?.email ?? '';
          const picture = (conn.metadata as any)?.picture ?? null;
          return { connectionId: conn.id, provider: conn.provider, email, picture, folders };
        } catch (err) {
          console.error(`[Folders] Failed to list folders for ${conn.provider} connection ${conn.id}:`, err);
          const email = (conn.metadata as any)?.email ?? '';
          const picture = (conn.metadata as any)?.picture ?? null;
          return { connectionId: conn.id, provider: conn.provider, email, picture, folders: [], error: String(err) };
        }
      })
    );

    return NextResponse.json({ connections: results });
  } catch (error) {
    console.error('[Folders] GET error:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}

// POST /api/inbox/folders — create a new folder/label
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { connectionId, name } = await request.json();
    if (!connectionId || !name?.trim()) {
      return NextResponse.json({ error: 'connectionId and name are required' }, { status: 400 });
    }

    const { data: connection } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const folder =
      connection.provider === 'gmail'
        ? await createGmailLabel(connection.metadata.tokens, name.trim())
        : connection.provider === 'outlook'
        ? await createOutlookFolder(connection.metadata.tokens, name.trim())
        : null;

    if (!folder) return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });

    return NextResponse.json({ folder });
  } catch (error) {
    console.error('[Folders] POST error:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}

// PATCH /api/inbox/folders — rename a folder/label
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { connectionId, folderId, name } = await request.json();
    if (!connectionId || !folderId || !name?.trim()) {
      return NextResponse.json({ error: 'connectionId, folderId and name are required' }, { status: 400 });
    }

    const { data: connection } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    if (connection.provider === 'gmail') {
      await renameGmailLabel(connection.metadata.tokens, folderId, name.trim());
    } else if (connection.provider === 'outlook') {
      await renameOutlookFolder(connection.metadata.tokens, folderId, name.trim());
    } else {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Folders] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to rename folder' }, { status: 500 });
  }
}

// DELETE /api/inbox/folders — delete a folder/label
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const folderId = searchParams.get('folderId');
    if (!connectionId || !folderId) {
      return NextResponse.json({ error: 'connectionId and folderId are required' }, { status: 400 });
    }

    const { data: connection } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    if (connection.provider === 'gmail') {
      await deleteGmailLabel(connection.metadata.tokens, folderId);
    } else if (connection.provider === 'outlook') {
      await deleteOutlookFolder(connection.metadata.tokens, folderId);
    } else {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Folders] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 });
  }
}
