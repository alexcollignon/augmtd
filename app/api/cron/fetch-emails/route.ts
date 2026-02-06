import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { fetchUnreadEmails, parseGmailMessage } from '@/lib/google/gmail';
import { checkIfActionable, processEmail } from '@/lib/ai/email-processor';

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

    // Get all active Gmail connections
    const { data: connections, error: connectionsError } = await supabase
      .from('connections')
      .select('*')
      .eq('provider', 'gmail')
      .eq('status', 'active');

    if (connectionsError) {
      console.error('Error fetching connections:', connectionsError);
      return NextResponse.json(
        { error: 'Failed to fetch connections' },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      console.log('No active Gmail connections found');
      return NextResponse.json({
        success: true,
        message: 'No connections to process',
        processed: 0
      });
    }

    console.log(`Found ${connections.length} active Gmail connections`);

    let totalEmailsFetched = 0;
    let totalActionable = 0;
    let totalInboxItems = 0;
    const errors: string[] = [];

    // Process each user's Gmail
    for (const connection of connections) {
      try {
        console.log(`Fetching emails for user ${connection.user_id}...`);

        // Update sync status
        await supabase
          .from('connections')
          .update({ sync_status: 'syncing' })
          .eq('id', connection.id);

        // Fetch unread emails
        const encryptedTokens = connection.metadata.tokens;
        const maxEmails = connection.metadata.max_emails_per_sync || 10;
        const messages = await fetchUnreadEmails(encryptedTokens, maxEmails);

        console.log(`Fetched ${messages.length} emails for user ${connection.user_id}`);

        // Process each email
        for (const message of messages) {
          try {
            const parsed = parseGmailMessage(message);

            // Check if email already exists
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

            // AI Processing
            const actionableCheck = await checkIfActionable({
              id: storedEmail.id,
              user_id: storedEmail.user_id,
              message_id: storedEmail.message_id,
              from_address: storedEmail.from_address,
              from_name: storedEmail.from_name,
              subject: storedEmail.subject,
              body: storedEmail.body,
              received_at: storedEmail.received_at
            });

            if (!actionableCheck.isActionable) {
              console.log(`Email not actionable: ${parsed.subject}`);
              continue;
            }

            totalActionable++;

            // Full AI processing
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

            // Create inbox item with comprehensive preparation
            const { error: inboxError } = await supabase
              .from('inbox_items')
              .insert({
                user_id: connection.user_id,
                source: 'email',
                source_id: storedEmail.id,
                source_data: {
                  // Email basics
                  email_id: storedEmail.id,
                  message_id: storedEmail.message_id,
                  from: storedEmail.from_address,
                  from_name: storedEmail.from_name,
                  subject: storedEmail.subject,
                  received_at: storedEmail.received_at,

                  // AI-prepared work
                  summary: processed.summary,
                  keyPoints: processed.keyPoints,
                  urgency: processed.urgency,
                  deadline: processed.deadline,
                  actionItems: processed.actionItems,
                  draftReply: processed.draftReply,
                  calendarEvent: processed.calendarEvent,
                  extractedData: processed.extractedData,
                  followUpActions: processed.followUpActions
                },
                ai_suggestion_type: processed.category,
                ai_suggestion_content: processed.summary,
                ai_suggestion_reasoning: processed.reasoning,
                confidence_score: processed.confidenceScore,
                priority: processed.priority,
                status: 'pending',
                needs_review: true
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

    console.log(`Cron job completed. Fetched: ${totalEmailsFetched}, Actionable: ${totalActionable}, Inbox items: ${totalInboxItems}`);

    return NextResponse.json({
      success: true,
      processed: connections.length,
      emailsFetched: totalEmailsFetched,
      actionable: totalActionable,
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
