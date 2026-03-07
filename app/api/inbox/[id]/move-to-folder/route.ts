import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { moveGmailThreadToLabel } from '@/lib/google/gmail';
import { moveOutlookMessageToFolder } from '@/lib/microsoft/outlook';

// POST /api/inbox/[id]/move-to-folder — move email to a folder/label and dismiss inbox item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { folderId, folderName } = await request.json() as { folderId: string; folderName: string };

    if (!folderId) return NextResponse.json({ error: 'folderId is required' }, { status: 400 });

    const { data: item, error: fetchError } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });

    const sourceData = item.source_data;
    const provider = sourceData?.provider;
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

    const encryptedTokens = connection.metadata.tokens;

    if (provider === 'gmail') {
      const threadId = sourceData.thread_id;
      if (!threadId) return NextResponse.json({ error: 'Missing thread_id' }, { status: 400 });
      await moveGmailThreadToLabel(encryptedTokens, threadId, folderId);
    } else if (provider === 'outlook') {
      let outlookMessageId: string | null = null;
      if (sourceData.email_id) {
        const { data: email } = await supabase.from('emails').select('metadata').eq('id', sourceData.email_id).single();
        outlookMessageId = email?.metadata?.outlook_id ?? null;
      }
      if (!outlookMessageId) return NextResponse.json({ error: 'Could not resolve Outlook message ID' }, { status: 400 });
      await moveOutlookMessageToFolder(encryptedTokens, outlookMessageId, folderId);
    } else {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    await supabase
      .from('inbox_items')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);

    await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: 'item_dismissed',
      signal_data: {
        reason: 'moved_to_folder',
        folder_name: folderName,
        provider,
        work_state: item.work_state,
        visual_section: item.visual_section,
        suggestion_level: item.recipient_context?.suggestionLevel,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[MoveToFolder] POST error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to move email' }, { status: 502 });
  }
}
