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
    const { data: originalEmail, error: emailError } = await supabase
      .from('emails')
      .select('thread_id, provider')
      .eq('id', sourceData.email_id)
      .single();

    if (emailError || !originalEmail) {
      return NextResponse.json(
        { error: 'Original email not found' },
        { status: 404 }
      );
    }

    // Get user's email connection
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', sourceData.provider || originalEmail.provider)
      .eq('status', 'active')
      .single();

    if (connError || !connection) {
      return NextResponse.json(
        { error: `${sourceData.provider || originalEmail.provider} connection not found` },
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

        // Decode and set credentials
        const tokens = JSON.parse(
          Buffer.from(connection.encrypted_tokens, 'base64').toString()
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
          Buffer.from(connection.encrypted_tokens, 'base64').toString()
        );

        const response = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${originalEmail.thread_id}/reply`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
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
    return NextResponse.json(
      {
        error: 'Failed to modify and send email',
        details: error instanceof Error ? error.message : 'Unknown',
      },
      { status: 500 }
    );
  }
}
