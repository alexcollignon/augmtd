import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { archiveGmailThread } from '@/lib/google/gmail';
import { archiveOutlookMessage, persistOutlookTokens } from '@/lib/microsoft/outlook';
import { resolveConnectionForItem } from '@/lib/inbox/resolve-connection';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data: item, error: fetchError } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });
    }

    const sourceData = item.source_data;
    const provider = sourceData?.provider;

    if (!provider) {
      return NextResponse.json({ error: 'No email provider on this item' }, { status: 400 });
    }

    // Prefer connection FK if set, else recipient-aware provider resolution (disambiguates two
    // accounts of the same provider by the mailbox the mail arrived on).
    const connection = await resolveConnectionForItem(supabase, user.id, item);

    if (!connection) {
      return NextResponse.json({ error: 'Email connection not found' }, { status: 404 });
    }

    const encryptedTokens = connection.metadata.tokens;

    if (provider === 'gmail') {
      const threadId = sourceData.thread_id;
      if (!threadId) {
        return NextResponse.json({ error: 'Missing thread_id for Gmail archive' }, { status: 400 });
      }
      await archiveGmailThread(encryptedTokens, threadId);
    } else if (provider === 'outlook') {
      // Need the internal Outlook message ID from emails table
      let outlookMessageId: string | null = null;
      if (sourceData.email_id) {
        const { data: email } = await supabase
          .from('emails')
          .select('metadata')
          .eq('id', sourceData.email_id)
          .single();
        outlookMessageId = email?.metadata?.outlook_id ?? null;
      }
      if (!outlookMessageId) {
        return NextResponse.json({ error: 'Could not resolve Outlook message ID' }, { status: 400 });
      }
      await archiveOutlookMessage(encryptedTokens, outlookMessageId, persistOutlookTokens(supabase, connection as { id: string; metadata: { tokens: string } }));
    } else {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    // Mark item dismissed and stamp archived_at in source_data so activity log can show "Archived"
    const archivedAt = new Date().toISOString();
    await supabase
      .from('inbox_items')
      .update({
        status: 'dismissed',
        source_data: { ...sourceData, archived_at: archivedAt },
        updated_at: archivedAt,
      })
      .eq('id', id)
      .eq('user_id', user.id);

    // Log learning signal
    await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: 'email_archived',
      signal_data: {
        provider,
        work_state: item.work_state,
        work_title: item.work_title,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Archive source error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to archive email' },
      { status: 502 }
    );
  }
}
