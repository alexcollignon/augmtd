import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listGmailLabels } from '@/lib/google/gmail';
import { listOutlookFolders } from '@/lib/microsoft/outlook';

// GET /api/inbox/[id]/email-folders — list folders/labels for the email provider of this inbox item
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const { data: item, error: fetchError } = await supabase
      .from('inbox_items')
      .select('source_data, connection_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });

    const provider = item.source_data?.provider;
    if (!provider) return NextResponse.json({ error: 'No email provider' }, { status: 400 });

    let connection: { metadata: { tokens: string } } | null = null;
    if (item.connection_id) {
      const { data } = await supabase.from('connections').select('*').eq('id', item.connection_id).eq('user_id', user.id).single();
      connection = data;
    }
    if (!connection) {
      const { data } = await supabase.from('connections').select('*').eq('user_id', user.id).eq('provider', provider).eq('status', 'active').single();
      connection = data;
    }
    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const folders =
      provider === 'gmail'
        ? await listGmailLabels(connection.metadata.tokens)
        : provider === 'outlook'
        ? await listOutlookFolders(connection.metadata.tokens)
        : [];

    return NextResponse.json({ folders });
  } catch (error) {
    console.error('[EmailFolders] GET error:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}
