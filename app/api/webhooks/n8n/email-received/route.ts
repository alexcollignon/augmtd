import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { checkIfActionable, processEmail } from '@/lib/ai/email-processor';

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

    // AI Processing: Filter and process actionable emails
    let actionableCount = 0;
    let processedCount = 0;
    const errors: string[] = [];

    for (const email of data || []) {
      try {
        // Step 1: Lightweight check if email is actionable (GPT-4o-mini, ~$0.0001)
        const actionableCheck = await checkIfActionable({
          id: email.id,
          user_id: email.user_id,
          message_id: email.message_id,
          from_address: email.from_address,
          from_name: email.from_name,
          subject: email.subject,
          body: email.body,
          received_at: email.received_at
        });

        if (!actionableCheck.isActionable) {
          console.log(`Skipping non-actionable email: ${email.subject} - ${actionableCheck.reasoning}`);
          continue;
        }

        actionableCount++;

        // Step 2: Full AI processing for actionable emails (GPT-4o, ~$0.01)
        const processed = await processEmail({
          id: email.id,
          user_id: email.user_id,
          message_id: email.message_id,
          from_address: email.from_address,
          from_name: email.from_name,
          subject: email.subject,
          body: email.body,
          received_at: email.received_at
        });

        // Step 3: Create inbox item
        const { error: inboxError } = await supabase
          .from('inbox_items')
          .insert({
            user_id: email.user_id,
            source: 'email',
            source_id: email.id,
            source_data: {
              email_id: email.id,
              message_id: email.message_id,
              from: email.from_address,
              subject: email.subject,
              received_at: email.received_at
            },
            ai_suggestion_type: processed.suggestionType,
            ai_suggestion_content: processed.suggestionContent,
            ai_suggestion_reasoning: processed.reasoning,
            confidence_score: processed.confidenceScore,
            priority: processed.priority,
            status: 'pending',
            needs_review: true
          });

        if (inboxError) {
          console.error(`Error creating inbox item for email ${email.id}:`, inboxError);
          errors.push(`Email ${email.subject}: ${inboxError.message}`);
        } else {
          processedCount++;
          console.log(`Created inbox item for: ${email.subject} (${processed.suggestionType})`);
        }
      } catch (error) {
        console.error(`Error processing email ${email.id}:`, error);
        errors.push(`Email ${email.subject}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${emails.length} emails`,
      stored: data?.length || 0,
      actionable: actionableCount,
      inboxItemsCreated: processedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
