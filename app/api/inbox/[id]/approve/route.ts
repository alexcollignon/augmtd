import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { google } from 'googleapis';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch inbox item
    const { data: item, error: itemError } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.status !== 'pending') {
      return NextResponse.json(
        { error: 'Item already processed' },
        { status: 400 }
      );
    }

    const sourceData = item.source_data;

    // Send email if draft reply exists
    let emailSent = false;
    if (sourceData?.draft) {
      // Get the original email to get thread_id
      // Use source_data.email_id if available, otherwise fall back to source_id
      const emailId = sourceData.email_id || item.source_id;

      const { data: originalEmail, error: emailError } = await supabase
        .from('emails')
        .select('thread_id, metadata')
        .eq('id', emailId)
        .single();

      if (emailError || !originalEmail) {
        return NextResponse.json(
          {
            error: 'Original email not found',
            details: emailError?.message,
            emailId,
          },
          { status: 404 }
        );
      }

      // Get provider from source_data or email metadata
      const provider = sourceData.provider || originalEmail.metadata?.provider || 'gmail';

      // Get user's email connection (Gmail or Outlook)
      const { data: connection, error: connError } = await supabase
        .from('connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('provider', provider)
        .eq('status', 'active')
        .single();

      if (connError || !connection) {
        return NextResponse.json(
          { error: `${provider} connection not found` },
          { status: 400 }
        );
      }

      try {
        if (connection.provider === 'gmail') {
          // Gmail - Send via Gmail API
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail/callback`
          );

          // Decode and set credentials (tokens stored in metadata.tokens)
          const tokens = JSON.parse(
            Buffer.from(connection.metadata.tokens, 'base64').toString()
          );
          oauth2Client.setCredentials(tokens);

          // Initialize Gmail API
          const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

          // Create email in RFC 2822 format
          const email = [
            `To: ${sourceData.from}`,
            `Subject: ${sourceData.draft.subject}`,
            'Content-Type: text/plain; charset=utf-8',
            'MIME-Version: 1.0',
            '',
            sourceData.draft.body,
          ].join('\n');

          // Encode email
          const encodedEmail = Buffer.from(email)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

          // Send email as reply in the thread
          await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              raw: encodedEmail,
              threadId: originalEmail.thread_id, // Reply in the same thread
            },
          });

          emailSent = true;
        } else if (connection.provider === 'outlook') {
          // Outlook - Send via Microsoft Graph API
          const tokens = JSON.parse(
            Buffer.from(connection.metadata.tokens, 'base64').toString()
          );

          // Outlook tokens use 'accessToken' (camelCase)
          const accessToken = tokens.accessToken;

          const response = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages/${originalEmail.thread_id}/reply`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: {
                  toRecipients: [
                    {
                      emailAddress: {
                        address: sourceData.from,
                      },
                    },
                  ],
                  subject: sourceData.draft.subject,
                  body: {
                    contentType: 'Text',
                    content: sourceData.draft.body,
                  },
                },
              }),
            }
          );

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to send via Outlook');
          }

          emailSent = true;
        }
      } catch (emailError) {
        console.error('Error sending email:', emailError);
        return NextResponse.json(
          {
            error: 'Failed to send email',
            details: emailError instanceof Error ? emailError.message : 'Unknown',
          },
          { status: 500 }
        );
      }
    }

    // Update inbox item status
    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update item status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      emailSent,
      message: emailSent
        ? 'Email sent and item approved'
        : 'Item approved (no email to send)',
    });
  } catch (error) {
    console.error('Error approving item:', error);
    return NextResponse.json(
      {
        error: 'Failed to approve item',
        details: error instanceof Error ? error.message : 'Unknown',
      },
      { status: 500 }
    );
  }
}
