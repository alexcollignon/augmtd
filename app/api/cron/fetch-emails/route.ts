import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { fetchUnreadEmails as fetchGmailEmails, parseGmailMessage } from '@/lib/google/gmail';
import { fetchUnreadEmails as fetchOutlookEmails, parseOutlookMessage } from '@/lib/microsoft/outlook';
import { processEmail } from '@/lib/ai/email-processor';

export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel Cron sends this header)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Starting email fetch cron job...');

    // Use service role to bypass RLS
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

    // Get all active email connections (Gmail + Outlook)
    const { data: connections, error: connectionsError } = await supabase
      .from('connections')
      .select('*')
      .in('provider', ['gmail', 'outlook'])
      .eq('status', 'active');

    if (connectionsError) {
      console.error('Error fetching connections:', connectionsError);
      return NextResponse.json(
        { error: 'Failed to fetch connections' },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      console.log('No active email connections found');
      return NextResponse.json({
        success: true,
        message: 'No connections to process',
        processed: 0
      });
    }

    console.log(`Found ${connections.length} active email connections`);

    let totalEmailsFetched = 0;
    let totalInboxItems = 0;
    const errors: string[] = [];

    // Process each connection (Gmail or Outlook)
    for (const connection of connections) {
      try {
        console.log(`Fetching ${connection.provider} emails for user ${connection.user_id}...`);

        // Update sync status
        await supabase
          .from('connections')
          .update({ sync_status: 'syncing' })
          .eq('id', connection.id);

        // Fetch emails based on provider
        const encryptedTokens = connection.metadata.tokens;
        const maxEmails = connection.metadata.max_emails_per_sync || 10;
        const syncWindowDays = connection.metadata.sync_window_days || 7;

        let messages: any[];
        if (connection.provider === 'gmail') {
          messages = await fetchGmailEmails(encryptedTokens, maxEmails, syncWindowDays);
        } else if (connection.provider === 'outlook') {
          messages = await fetchOutlookEmails(encryptedTokens, maxEmails, syncWindowDays);
        } else {
          console.warn(`Unknown provider: ${connection.provider}`);
          continue;
        }

        console.log(`Fetched ${messages.length} ${connection.provider} emails for user ${connection.user_id}`);

        // Process each email
        for (const message of messages) {
          try {
            // Parse based on provider
            const parsed = connection.provider === 'gmail'
              ? parseGmailMessage(message)
              : parseOutlookMessage(message);

            // Check if email already exists (check ALL emails, including sent ones for context)
            const { data: existingEmail } = await supabase
              .from('emails')
              .select('id')
              .eq('message_id', parsed.message_id)
              .single();

            if (existingEmail) {
              console.log(`Email ${parsed.message_id} already exists, skipping...`);
              continue;
            }

            // Store email
            const { data: storedEmail, error: emailError } = await supabase
              .from('emails')
              .insert({
                user_id: connection.user_id,
                ...parsed
              })
              .select()
              .single();

            if (emailError) {
              console.error('Error storing email:', emailError);
              errors.push(`Failed to store email: ${emailError.message}`);
              continue;
            }

            totalEmailsFetched++;

            // Check if email is from the user (sent by them or by AUGMTD on their behalf)
            // Store for context but don't create inbox item
            const userEmail = connection.metadata?.email || connection.provider_account_id;
            const isFromUser = storedEmail.from_address.toLowerCase() === userEmail?.toLowerCase();

            console.log(`📧 Email: "${parsed.subject}"`);
            console.log(`   From: ${storedEmail.from_address}`);
            console.log(`   User: ${userEmail}`);
            console.log(`   Is from user: ${isFromUser}`);

            if (isFromUser) {
              console.log(`✓ Stored for context but skipping inbox item (sent email)`);
              continue; // Skip to next email (already stored for context)
            }

            // AI Processing - Process INCOMING emails only
            const processed = await processEmail({
              id: storedEmail.id,
              user_id: storedEmail.user_id,
              message_id: storedEmail.message_id,
              from_address: storedEmail.from_address,
              from_name: storedEmail.from_name,
              subject: storedEmail.subject,
              body: storedEmail.body,
              received_at: storedEmail.received_at
            });

            // Create inbox item with work-state model (for incoming emails only)
            const { error: inboxError } = await supabase
              .from('inbox_items')
              .insert({
                user_id: connection.user_id,
                source: 'email',
                source_id: storedEmail.id,

                // NEW: Work-state model
                work_state: processed.workState,
                work_title: processed.workTitle,
                what_i_prepared: processed.whatIPrepared,
                why_matters: processed.whyMatters,

                // Source data (includes email + AI preparation)
                source_data: {
                  // Email basics
                  email_id: storedEmail.id,
                  message_id: storedEmail.message_id,
                  from: storedEmail.from_address,
                  from_name: storedEmail.from_name,
                  subject: storedEmail.subject,
                  received_at: storedEmail.received_at,
                  provider: connection.provider,

                  // AI analysis
                  summary: processed.summary,
                  keyPoints: processed.keyPoints,
                  urgency: processed.urgency,
                  signals: processed.signals,

                  // Prepared outputs (conditional on work state)
                  ...processed.preparedOutput
                },

                // Legacy fields (for backward compatibility)
                ai_suggestion_type: processed.workState, // Use work state as type
                ai_suggestion_content: processed.summary,
                ai_suggestion_reasoning: processed.reasoning,
                confidence_score: processed.confidence,
                priority: processed.priority,
                status: 'pending',
                needs_review: processed.workState === 'work_prepared' || processed.workState === 'decision_required' || processed.workState === 'waiting'
              });

            if (inboxError) {
              console.error('Error creating inbox item:', inboxError);
              errors.push(`Failed to create inbox item: ${inboxError.message}`);
            } else {
              totalInboxItems++;
              console.log(`Created inbox item for: ${parsed.subject}`);
            }
          } catch (emailError) {
            console.error('Error processing email:', emailError);
            errors.push(`Email processing error: ${emailError instanceof Error ? emailError.message : 'Unknown'}`);
          }
        }

        // Update sync status
        await supabase
          .from('connections')
          .update({
            sync_status: 'completed',
            last_sync: new Date().toISOString()
          })
          .eq('id', connection.id);

      } catch (userError) {
        console.error(`Error processing user ${connection.user_id}:`, userError);
        errors.push(`User ${connection.user_id}: ${userError instanceof Error ? userError.message : 'Unknown'}`);

        // Mark sync as failed
        await supabase
          .from('connections')
          .update({ sync_status: 'failed' })
          .eq('id', connection.id);
      }
    }

    console.log(`Cron job completed. Fetched: ${totalEmailsFetched}, Inbox items: ${totalInboxItems}`);

    return NextResponse.json({
      success: true,
      processed: connections.length,
      emailsFetched: totalEmailsFetched,
      inboxItemsCreated: totalInboxItems,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
