import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';

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

    // Create Supabase client with service role (bypasses RLS)
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Process each email
    const emailRecords = emails.map((email: any) => {
      // n8n wraps data in a 'json' property, extract it
      const emailData = email.json || email;

      // Extract email addresses
      const fromAddress = typeof emailData.from === 'string'
        ? emailData.from
        : emailData.from?.text || emailData.from?.value?.[0]?.address || '';

      const toAddresses = Array.isArray(emailData.to?.value)
        ? emailData.to.value.map((t: any) => t.address)
        : [emailData.to?.text || ''];

      return {
        user_id: userId || null, // Nullable for testing, will link to real user later
        message_id: emailData.messageId || emailData.id,
        from_address: fromAddress,
        from_name: emailData.from?.value?.[0]?.name || '',
        to_addresses: toAddresses,
        cc_addresses: emailData.cc?.value?.map((c: any) => c.address) || [],
        subject: emailData.subject || '(no subject)',
        body: emailData.text || emailData.textAsHtml || '',
        html_body: emailData.html || null,
        received_at: emailData.date ? new Date(emailData.date).toISOString() : new Date().toISOString(),
        thread_id: emailData.threadId || null,
        labels: emailData.labelIds || [],
        metadata: {
          sizeEstimate: emailData.sizeEstimate,
          headers: emailData.headers,
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
