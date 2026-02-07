import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { fetchUnreadEmails as fetchGmailEmails, parseGmailMessage } from '@/lib/google/gmail';
import { fetchUnreadEmails as fetchOutlookEmails, parseOutlookMessage } from '@/lib/microsoft/outlook';
import { processEmail } from '@/lib/ai/email-processor';

export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`Manual sync triggered by user ${user.id}`);

    // Use service role to bypass RLS for operations
    const adminSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get user's email connections (Gmail or Outlook)
    const { data: connections, error: connectionError } = await adminSupabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .in('provider', ['gmail', 'outlook'])
      .eq('status', 'active');

    if (connectionError || !connections || connections.length === 0) {
      return NextResponse.json(
        { error: 'No active email connections found' },
        { status: 404 }
      );
    }

    let totalEmailsFetched = 0;
    let totalInboxItemsCreated = 0;
    const errors: string[] = [];

    // Process each connection
    for (const connection of connections) {

      // Update sync status
      await adminSupabase
        .from('connections')
        .update({ sync_status: 'syncing' })
        .eq('id', connection.id);

      try {
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

        console.log(`Fetched ${messages.length} ${connection.provider} emails for user ${user.id}`);

        // Process each email
        for (const message of messages) {
          try {
            // Parse based on provider
            const parsed = connection.provider === 'gmail'
              ? parseGmailMessage(message)
              : parseOutlookMessage(message);

          // Check if email already exists
          const { data: existingEmail } = await adminSupabase
            .from('emails')
            .select('id')
            .eq('message_id', parsed.message_id)
            .single();

          if (existingEmail) {
            console.log(`Email ${parsed.message_id} already exists, skipping...`);
            continue;
          }

            // Store email
            const { data: storedEmail, error: emailError } = await adminSupabase
              .from('emails')
              .insert({
                user_id: user.id,
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

          // Create inbox item with work-state model
          const { error: inboxError } = await adminSupabase
            .from('inbox_items')
            .insert({
              user_id: user.id,
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
              ai_suggestion_type: processed.workState,
              ai_suggestion_content: processed.summary,
              ai_suggestion_reasoning: processed.reasoning,
              confidence_score: processed.confidence,
              priority: processed.priority,
              status: 'pending',
              needs_review: processed.workState !== 'no_work'
            });

            if (inboxError) {
              console.error('Error creating inbox item:', inboxError);
              errors.push(`Failed to create inbox item: ${inboxError.message}`);
            } else {
              totalInboxItemsCreated++;
            }
          } catch (emailError) {
            console.error('Error processing email:', emailError);
            errors.push(`Email processing error: ${emailError instanceof Error ? emailError.message : 'Unknown'}`);
          }
        }

        // Update sync status to completed
        await adminSupabase
          .from('connections')
          .update({
            sync_status: 'completed',
            last_sync: new Date().toISOString()
          })
          .eq('id', connection.id);

      } catch (syncError) {
        // Mark sync as failed
        await adminSupabase
          .from('connections')
          .update({ sync_status: 'failed' })
          .eq('id', connection.id);

        console.error('Sync error for connection:', syncError);
        errors.push(`Connection ${connection.id} failed: ${syncError instanceof Error ? syncError.message : 'Unknown'}`);
      }
    }

    // Return summary after processing all connections
    console.log(`Manual sync completed. Fetched: ${totalEmailsFetched}, Inbox items: ${totalInboxItemsCreated}`);

    return NextResponse.json({
      success: true,
      emailsFetched: totalEmailsFetched,
      inboxItemsCreated: totalInboxItemsCreated,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Manual sync error:', error);
    return NextResponse.json(
      {
        error: 'Sync failed',
        details: error instanceof Error ? error.message : 'Unknown'
      },
      { status: 500 }
    );
  }
}
