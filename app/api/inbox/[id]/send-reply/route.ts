import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendGmailReply } from '@/lib/google/gmail';
import { sendOutlookReply } from '@/lib/microsoft/outlook';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { customMessage } = await request.json();

    // Get inbox item with draft
    const { data: item, error: fetchError } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Inbox item not found' },
        { status: 404 }
      );
    }

    const sourceData = item.source_data;
    if (!sourceData?.draft) {
      return NextResponse.json(
        { error: 'No draft available for this item' },
        { status: 400 }
      );
    }

    // Get user's email connection
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', sourceData.provider)
      .eq('status', 'active')
      .single();

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'Email connection not found' },
        { status: 404 }
      );
    }

    // Use custom message if provided, otherwise use AI draft body
    const messageBody = customMessage || sourceData.draft?.body || sourceData.draft;

    // Send reply based on provider
    let sentMessageId: string;

    if (sourceData.provider === 'gmail') {
      sentMessageId = await sendGmailReply({
        encryptedTokens: connection.metadata.tokens,
        threadId: sourceData.thread_id,
        messageId: sourceData.message_id,
        to: sourceData.from,
        subject: sourceData.subject,
        body: messageBody,
        inReplyTo: sourceData.message_id,
        references: sourceData.references,
      });
    } else if (sourceData.provider === 'outlook') {
      // Graph API needs the internal Outlook ID (not the RFC 2822 internet message ID).
      // Look it up from the emails table where it's stored in metadata.outlook_id.
      let outlookMessageId = sourceData.message_id;
      if (sourceData.email_id) {
        const { data: email } = await supabase
          .from('emails')
          .select('metadata')
          .eq('id', sourceData.email_id)
          .single();
        if (email?.metadata?.outlook_id) {
          outlookMessageId = email.metadata.outlook_id;
        }
      }
      sentMessageId = await sendOutlookReply({
        encryptedTokens: connection.metadata.tokens,
        messageId: outlookMessageId,
        body: messageBody,
      });
    } else {
      return NextResponse.json(
        { error: 'Unsupported provider' },
        { status: 400 }
      );
    }

    // Mark item as completed
    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({
        status: 'completed',
      })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error updating inbox item:', updateError);
      // Don't fail the request - reply was sent successfully
    }

    // Log learning signal
    const { error: signalError } = await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: 'reply_sent',
      signal_data: {
        action_taken: 'reply_sent',
        sent_message_id: sentMessageId,
        used_ai_draft: !customMessage,
        modified: !!customMessage,
        provider: sourceData.provider,
        work_state: item.work_state,
        suggestion_level: item.recipient_context?.suggestionLevel,
        completed_at: new Date().toISOString(),
      },
    });

    if (signalError) {
      console.error('Error logging learning signal:', signalError);
      // Don't fail the request, just log the error
    }

    return NextResponse.json({
      success: true,
      sentMessageId,
      usedAiDraft: !customMessage,
    });

  } catch (error) {
    console.error('Send reply error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send reply' },
      { status: 500 }
    );
  }
}
