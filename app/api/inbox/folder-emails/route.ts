import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listGmailFolderEmails } from '@/lib/google/gmail';
import { listOutlookFolderEmails } from '@/lib/microsoft/outlook';

// GET /api/inbox/folder-emails?connectionId=xxx&folderId=xxx
export async function GET(request: NextRequest) {
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

    const emails =
      connection.provider === 'gmail'
        ? await listGmailFolderEmails(connection.metadata.tokens, folderId)
        : connection.provider === 'outlook'
        ? await listOutlookFolderEmails(connection.metadata.tokens, folderId)
        : [];

    return NextResponse.json({ emails });
  } catch (error) {
    console.error('[FolderEmails] GET error:', error);
    return NextResponse.json({ error: 'Failed to list folder emails' }, { status: 500 });
  }
}
