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

    if (connectionError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch connections',
          message: 'Unable to load your email connections. Please try again.',
          action: 'retry'
        },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      return NextResponse.json(
        {
          error: 'No active email connections',
          message: 'Connect Gmail or Outlook to start syncing emails.',
          action: 'connect'
        },
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

            console.log(`\n--- Processing email: ${parsed.subject}`);
            console.log(`    From: ${parsed.from_address}`);

          // Check if email already exists
          const { data: existingEmail } = await adminSupabase
            .from('emails')
            .select('id')
            .eq('message_id', parsed.message_id)
            .single();

          if (existingEmail) {
            console.log(`    ✓ Already exists, skipping`);
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

            // Check if email is from the user (sent by them or by AUGMTD on their behalf)
            // Store for context but don't create inbox item
            const userEmail = connection.metadata?.email || connection.provider_account_id;
            const isFromUser = storedEmail.from_address.toLowerCase() === userEmail?.toLowerCase();

            console.log(`    User email: ${userEmail}`);
            console.log(`    Is from user: ${isFromUser}`);

            if (isFromUser) {
              console.log(`    ✓ Stored for context but skipping inbox item (sent email)\n`);
              continue; // Skip to next email (already stored for context)
            }

            // Check if inbox item already exists for this thread
            const { data: existingInboxItem } = await adminSupabase
              .from('inbox_items')
              .select('id, status')
              .eq('user_id', user.id)
              .eq('source', 'email')
              .eq('source_data->>thread_id', storedEmail.thread_id || storedEmail.message_id)
              .eq('status', 'pending')
              .single();

            if (existingInboxItem) {
              console.log(`    ♻️  Updating existing inbox item for thread\n`);

              // Get all emails in this thread for context
              const { data: threadEmails } = await adminSupabase
                .from('emails')
                .select('*')
                .eq('user_id', user.id)
                .eq('thread_id', storedEmail.thread_id || storedEmail.message_id)
                .order('received_at', { ascending: true });

              // Map thread emails and mark which are from user
              const threadContext = threadEmails?.map(e => ({
                from_address: e.from_address,
                from_name: e.from_name,
                subject: e.subject,
                body: e.body,
                received_at: e.received_at,
                is_from_user: e.from_address === user.email
              })) || [];

              // AI Processing with full thread context
              const processed = await processEmail({
                id: storedEmail.id,
                user_id: storedEmail.user_id,
                message_id: storedEmail.message_id,
                from_address: storedEmail.from_address,
                from_name: storedEmail.from_name,
                subject: storedEmail.subject,
                body: storedEmail.body,
                received_at: storedEmail.received_at,
                thread_context: threadContext
              });

              // Update existing inbox item
              const { error: updateError } = await adminSupabase
                .from('inbox_items')
                .update({
                  work_state: processed.workState,
                  work_title: processed.workTitle,
                  what_i_prepared: processed.whatIPrepared,
                  why_matters: processed.whyMatters,
                  source_data: {
                    email_id: storedEmail.id,
                    message_id: storedEmail.message_id,
                    thread_id: storedEmail.thread_id || storedEmail.message_id,
                    from: storedEmail.from_address,
                    from_name: storedEmail.from_name,
                    subject: storedEmail.subject,
                    received_at: storedEmail.received_at,
                    provider: connection.provider,
                    thread_history: threadEmails?.map(e => ({
                      from: e.from_address,
                      from_name: e.from_name,
                      subject: e.subject,
                      received_at: e.received_at,
                      snippet: e.body.substring(0, 150),
                      is_from_user: e.from_address === user.email
                    })),
                    summary: processed.summary,
                    keyPoints: processed.keyPoints,
                    urgency: processed.urgency,
                    signals: processed.signals,
                    ...processed.preparedOutput
                  },
                  ai_suggestion_type: processed.workState,
                  ai_suggestion_content: processed.summary,
                  ai_suggestion_reasoning: processed.reasoning,
                  confidence_score: processed.confidence,
                  priority: processed.priority,
                  needs_review: processed.workState === 'work_prepared' || processed.workState === 'decision_required' || processed.workState === 'waiting'
                })
                .eq('id', existingInboxItem.id);

              if (updateError) {
                console.error('Error updating inbox item:', updateError);
                errors.push(`Failed to update inbox item: ${updateError.message}`);
              }

              continue; // Skip to next email
            }

            console.log(`    → Creating new inbox item (new thread)\n`);

          // Get all emails in this thread for context (even for new inbox items)
          const { data: threadEmails } = await adminSupabase
            .from('emails')
            .select('*')
            .eq('user_id', user.id)
            .eq('thread_id', storedEmail.thread_id || storedEmail.message_id)
            .order('received_at', { ascending: true });

          // Map thread emails and mark which are from user
          const threadContext = threadEmails?.map(e => ({
            from_address: e.from_address,
            from_name: e.from_name,
            subject: e.subject,
            body: e.body,
            received_at: e.received_at,
            is_from_user: e.from_address === user.email
          })) || [];

          // AI Processing - Process INCOMING emails only
          const processed = await processEmail({
            id: storedEmail.id,
            user_id: storedEmail.user_id,
            message_id: storedEmail.message_id,
            from_address: storedEmail.from_address,
            from_name: storedEmail.from_name,
            subject: storedEmail.subject,
            body: storedEmail.body,
            received_at: storedEmail.received_at,
            thread_context: threadContext
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
                thread_id: storedEmail.thread_id || storedEmail.message_id,
                from: storedEmail.from_address,
                from_name: storedEmail.from_name,
                subject: storedEmail.subject,
                received_at: storedEmail.received_at,
                provider: connection.provider,

                // Thread context
                thread_history: threadEmails?.map(e => ({
                  from: e.from_address,
                  from_name: e.from_name,
                  subject: e.subject,
                  received_at: e.received_at,
                  snippet: e.body.substring(0, 150),
                  is_from_user: e.from_address === user.email
                })),

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
              needs_review: processed.workState === 'work_prepared' || processed.workState === 'decision_required' || processed.workState === 'waiting'
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

        // Detect specific error types and provide actionable messages
        const errorMessage = syncError instanceof Error ? syncError.message : 'Unknown';
        let userFriendlyError = errorMessage;

        if (errorMessage.includes('Invalid Credentials') || errorMessage.includes('401')) {
          userFriendlyError = `${connection.provider === 'gmail' ? 'Gmail' : 'Outlook'} authentication expired. Please reconnect your account.`;
        } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
          userFriendlyError = `Network error while syncing ${connection.provider === 'gmail' ? 'Gmail' : 'Outlook'}. Check your internet connection and try again.`;
        } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
          userFriendlyError = `${connection.provider === 'gmail' ? 'Gmail' : 'Outlook'} rate limit reached. Please wait a few minutes and try again.`;
        } else if (errorMessage.includes('quota')) {
          userFriendlyError = `${connection.provider === 'gmail' ? 'Gmail' : 'Outlook'} API quota exceeded. Try again later.`;
        } else {
          userFriendlyError = `Failed to sync ${connection.provider === 'gmail' ? 'Gmail' : 'Outlook'}: ${errorMessage}`;
        }

        errors.push(userFriendlyError);
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

    // Provide specific error messages based on error type
    const errorMessage = error instanceof Error ? error.message : 'Unknown';
    let userMessage = 'Failed to sync emails. Please try again.';
    let action = 'retry';

    if (errorMessage.includes('Unauthorized') || errorMessage.includes('auth')) {
      userMessage = 'Your session has expired. Please log in again.';
      action = 'login';
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
      userMessage = 'Network error. Check your internet connection and try again.';
      action = 'retry';
    } else if (errorMessage.includes('timeout')) {
      userMessage = 'Request timed out. The server took too long to respond.';
      action = 'retry';
    }

    return NextResponse.json(
      {
        error: 'Sync failed',
        message: userMessage,
        details: errorMessage,
        action
      },
      { status: 500 }
    );
  }
}
