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
    if (sourceData?.draftReply) {
      // Get user's Gmail connection
      const { data: connection, error: connError } = await supabase
        .from('connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('provider', 'gmail')
        .eq('status', 'active')
        .single();

      if (connError || !connection) {
        return NextResponse.json(
          { error: 'Gmail connection not found' },
          { status: 400 }
        );
      }

      try {
        // Initialize OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );

        // Decode and set credentials
        const tokens = connection.metadata.tokens;
        oauth2Client.setCredentials(tokens);

        // Initialize Gmail API
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Create email
        const email = [
          `To: ${sourceData.from}`,
          `Subject: ${sourceData.draftReply.subject}`,
          'Content-Type: text/plain; charset=utf-8',
          'MIME-Version: 1.0',
          '',
          sourceData.draftReply.body,
        ].join('\n');

        // Encode email
        const encodedEmail = Buffer.from(email)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        // Send email
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedEmail,
            threadId: sourceData.message_id, // Reply to the same thread
          },
        });

        emailSent = true;
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
