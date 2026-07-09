import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { trashGmailThread } from '@/lib/google/gmail';
import { sanitizeError } from '@/lib/utils/api-error';
import { trashOutlookMessage, persistOutlookTokens } from '@/lib/microsoft/outlook';
import { resolveConnectionForItem } from '@/lib/inbox/resolve-connection';

export async function POST(
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
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });

    const sourceData = item.source_data;
    const provider = sourceData?.provider;

    if (!provider) return NextResponse.json({ error: 'No email provider on this item' }, { status: 400 });

    const connection = await resolveConnectionForItem(supabase, user.id, item);
    if (!connection) return NextResponse.json({ error: 'Email connection not found' }, { status: 404 });

    const encryptedTokens = connection.metadata.tokens;

    if (provider === 'gmail') {
      const threadId = sourceData.thread_id;
      if (!threadId) return NextResponse.json({ error: 'Missing thread_id for Gmail trash' }, { status: 400 });
      await trashGmailThread(encryptedTokens, threadId);
    } else if (provider === 'outlook') {
      let outlookMessageId: string | null = null;
      if (sourceData.email_id) {
        const { data: email } = await supabase.from('emails').select('metadata').eq('id', sourceData.email_id).single();
        outlookMessageId = email?.metadata?.outlook_id ?? null;
      }
      if (!outlookMessageId) return NextResponse.json({ error: 'Could not resolve Outlook message ID' }, { status: 400 });
      await trashOutlookMessage(encryptedTokens, outlookMessageId, persistOutlookTokens(supabase, connection as { id: string; metadata: { tokens: string } }));
    } else {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    const deletedAt = new Date().toISOString();
    await supabase
      .from('inbox_items')
      // resolved_at = the REAL resolution timestamp the Day-cleared ring counts by (not updated_at).
      .update({ status: 'dismissed', source_data: { ...sourceData, deleted_at: deletedAt, resolved_at: deletedAt }, updated_at: deletedAt })
      .eq('id', id)
      .eq('user_id', user.id);

    await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: 'email_deleted',
      signal_data: { provider, work_state: item.work_state, work_title: item.work_title },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete source error:', error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 502 });
  }
}
