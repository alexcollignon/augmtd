import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGmailMessageDetail, moveGmailThreadToLabel } from '@/lib/google/gmail';
import { getOutlookMessageDetail, moveOutlookMessageToFolder, persistOutlookTokens } from '@/lib/microsoft/outlook';

// GET /api/inbox/folder-email-detail?connectionId=xxx&messageId=xxx
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const messageId = searchParams.get('messageId');

    if (!connectionId || !messageId) {
      return NextResponse.json({ error: 'connectionId and messageId are required' }, { status: 400 });
    }

    const { data: connection } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const detail =
      connection.provider === 'gmail'
        ? await getGmailMessageDetail(connection.metadata.tokens, messageId)
        : connection.provider === 'outlook'
        ? await getOutlookMessageDetail(connection.metadata.tokens, messageId, persistOutlookTokens(supabase, connection))
        : null;

    if (!detail) return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });

    return NextResponse.json(detail);
  } catch (error) {
    console.error('[FolderEmailDetail] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch email detail' }, { status: 500 });
  }
}

// POST /api/inbox/folder-email-detail — move a folder email to a different folder
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { connectionId, messageId, folderId } = await request.json();
    if (!connectionId || !messageId || !folderId) {
      return NextResponse.json({ error: 'connectionId, messageId, and folderId are required' }, { status: 400 });
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
      await moveGmailThreadToLabel(connection.metadata.tokens, messageId, folderId);
    } else if (connection.provider === 'outlook') {
      await moveOutlookMessageToFolder(connection.metadata.tokens, messageId, folderId, persistOutlookTokens(supabase, connection));
    } else {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[FolderEmailDetail] POST error:', error);
    return NextResponse.json({ error: 'Failed to move email' }, { status: 500 });
  }
}
