import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { google } from 'googleapis';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { subject, emailBody } = body;

    if (!subject || !emailBody) {
      return NextResponse.json(
        { error: 'Subject and email body are required' },
        { status: 400 }
      );
    }

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

    if (!sourceData?.draft) {
      return NextResponse.json(
        { error: 'No draft available for this item' },
        { status: 400 }
      );
    }

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

    // Get user's email connection
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

    // Send the modified email
    let emailSent = false;
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

        // Create email in RFC 2822 format with modified content
        const email = [
          `To: ${sourceData.from}`,
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          'MIME-Version: 1.0',
          '',
          emailBody,
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
            threadId: originalEmail.thread_id,
          },
        });

        emailSent = true;
      } else if (connection.provider === 'outlook') {
        // Outlook - Send via Microsoft Graph API
        const tokens = JSON.parse(
          Buffer.from(connection.metadata.tokens, 'base64').toString()
        );

        let accessToken = tokens.accessToken;

        // Check if token is expired and refresh if needed
        const now = new Date();
        const expiresOn = new Date(tokens.expiresOn);

        if (expiresOn <= now) {
          // Token expired, try to refresh using MSAL
          const { getMSALClient } = await import('@/lib/microsoft/oauth');

          try {
            const msalClient = getMSALClient();
            const tokenResponse = await msalClient.acquireTokenSilent({
              account: tokens.account,
              scopes: [
                'https://graph.microsoft.com/Mail.Read',
                'https://graph.microsoft.com/Mail.Send',
                'https://graph.microsoft.com/User.Read',
                'offline_access',
              ],
            });

            accessToken = tokenResponse.accessToken;

            // Update stored tokens
            const updatedTokens = Buffer.from(JSON.stringify({
              accessToken: tokenResponse.accessToken,
              expiresOn: tokenResponse.expiresOn,
              account: tokenResponse.account,
            })).toString('base64');

            await supabase
              .from('connections')
              .update({
                metadata: {
                  ...connection.metadata,
                  tokens: updatedTokens,
                },
              })
              .eq('id', connection.id);
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            return NextResponse.json(
              {
                error: 'Outlook token expired and refresh failed',
                details: 'Please reconnect your Outlook account in settings',
              },
              { status: 401 }
            );
          }
        }

        // Get Outlook message ID from metadata (NOT thread_id which is conversationId)
        const outlookMessageId = originalEmail.metadata?.outlook_id;

        if (!outlookMessageId) {
          return NextResponse.json(
            {
              error: 'Outlook message ID not found',
              details: 'This email was fetched before the Outlook integration was updated. Please trigger a manual email sync to re-fetch this email.',
            },
            { status: 400 }
          );
        }

        const response = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${outlookMessageId}/reply`,
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
                subject: subject,
                body: {
                  contentType: 'Text',
                  content: emailBody,
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
      console.error('Error sending modified email:', emailError);
      return NextResponse.json(
        {
          error: 'Failed to send email',
          details: emailError instanceof Error ? emailError.message : 'Unknown',
        },
        { status: 500 }
      );
    }

    if (!emailSent) {
      return NextResponse.json(
        { error: 'Email provider not supported' },
        { status: 400 }
      );
    }

    // Update inbox item status and store the modification
    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        source_data: {
          ...sourceData,
          draft: {
            ...sourceData.draft,
            subject,
            body: emailBody,
            modified: true,
          },
        },
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update item status' },
        { status: 500 }
      );
    }

    // TODO: Log this modification for learning (future: User Context Engine)
    // Track what changes the user made to learn their communication style

    return NextResponse.json({
      success: true,
      emailSent: true,
      message: 'Modified email sent and item approved',
    });
  } catch (error) {
    console.error('Error modifying and sending email:', error);

    // Provide specific error messages
    const errorMessage = error instanceof Error ? error.message : 'Unknown';
    let userMessage = 'Failed to send modified email. Please try again.';

    if (errorMessage.includes('Invalid Credentials') || errorMessage.includes('401')) {
      userMessage = 'Email account authentication expired. Please reconnect your account in Settings.';
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
      userMessage = 'Network error. Check your internet connection and try again.';
    } else if (errorMessage.includes('timeout')) {
      userMessage = 'Request timed out. Please try again.';
    } else if (errorMessage.includes('ConversationId')) {
      userMessage = 'Email configuration error. This email might need to be re-synced.';
    } else if (errorMessage.includes('message ID')) {
      userMessage = 'Could not find the original email to reply to. Try syncing your emails again.';
    } else if (errorMessage.includes('subject') || errorMessage.includes('body')) {
      userMessage = 'Email content is invalid. Please check your message and try again.';
    }

    return NextResponse.json(
      {
        error: 'Failed to modify and send email',
        message: userMessage,
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
