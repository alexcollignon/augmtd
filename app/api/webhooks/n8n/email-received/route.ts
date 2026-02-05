import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // Parse the incoming data from n8n
    const body = await request.json();
    const { emails, userId, provider } = body;

    console.log(`Received ${emails?.length || 0} emails from n8n`);

    // Validate request
    if (!emails || !Array.isArray(emails)) {
      return NextResponse.json(
        { error: 'Invalid request: emails array required' },
        { status: 400 }
      );
    }

    if (emails.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No emails to process'
      });
    }

    // Create Supabase client
    const supabase = createClient();

    // Process each email
    const emailRecords = emails.map((email: any) => {
      // Extract email addresses
      const fromAddress = typeof email.from === 'string'
        ? email.from
        : email.from?.text || email.from?.value?.[0]?.address || '';

      const toAddresses = Array.isArray(email.to?.value)
        ? email.to.value.map((t: any) => t.address)
        : [email.to?.text || ''];

      return {
        user_id: userId || 'temp-user-id', // We'll fix this later
        message_id: email.messageId || email.id,
        from_address: fromAddress,
        from_name: email.from?.value?.[0]?.name || '',
        to_addresses: toAddresses,
        cc_addresses: email.cc?.value?.map((c: any) => c.address) || [],
        subject: email.subject || '(no subject)',
        body: email.text || email.textAsHtml || '',
        html_body: email.html || null,
        received_at: email.date ? new Date(email.date).toISOString() : new Date().toISOString(),
        thread_id: email.threadId || null,
        labels: email.labelIds || [],
        metadata: {
          sizeEstimate: email.sizeEstimate,
          headers: email.headers,
          provider: provider || 'gmail'
        }
      };
    });

    // Insert emails into Supabase
    const { data, error } = await supabase
      .from('emails')
      .insert(emailRecords)
      .select();

    if (error) {
      console.error('Error inserting emails:', error);
      return NextResponse.json(
        { error: 'Failed to store emails', details: error.message },
        { status: 500 }
      );
    }

    console.log(`Successfully stored ${data?.length || 0} emails`);

    // TODO: Trigger AI processing for each email
    // for (const email of data || []) {
    //   await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/agents/process`, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       userId: email.user_id,
    //       eventType: 'email',
    //       eventData: email
    //     })
    //   });
    // }

    return NextResponse.json({
      success: true,
      message: `Processed ${emails.length} emails`,
      stored: data?.length || 0
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
