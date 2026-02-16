/**
 * Shared Email Sync Logic
 *
 * Core email synchronization logic used by both:
 * - Automated cron job (/api/cron/fetch-emails)
 * - Manual user sync (/api/connections/sync)
 *
 * Handles:
 * - Fetching emails from Gmail/Outlook
 * - Parsing email data
 * - Recipient detection and role analysis
 * - Creating/updating inbox items with recipient context
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { fetchUnreadEmails as fetchGmailEmails, parseGmailMessage } from '@/lib/google/gmail';
import { fetchUnreadEmails as fetchOutlookEmails, parseOutlookMessage } from '@/lib/microsoft/outlook';
import { processEmail } from '@/lib/ai/email-processor';
import { analyzeRecipients, shouldCreateInboxItem, getSuggestionLevel, getSuggestionLabel } from '@/lib/ai/recipient-detector';
import { getVisualSection } from '@/lib/types/inbox';
import { analyzeSentEmail } from '@/lib/context/sent-email-analyzer';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import type { UserContextProfile } from '@/lib/types/user-context';

export interface SyncResult {
  emailsFetched: number;
  inboxItemsCreated: number;
  errors: string[];
}

export interface SyncOptions {
  maxEmails?: number;
  syncWindowDays?: number;
}

/**
 * Fetch user context profile for personalized AI processing
 * Uses new modular profiles but returns legacy format for compatibility
 */
async function getUserContext(
  userId: string,
  adminSupabase: SupabaseClient
): Promise<UserContextProfile | undefined> {
  try {
    const { getUserContextLegacy, initializeUserContext } = await import('@/lib/context/profile-adapter');

    // Try to load existing profiles
    const context = await getUserContextLegacy(userId, adminSupabase);

    if (context) {
      return context;
    }

    // Profile doesn't exist - initialize it
    console.log('[Sync] No user context found - initializing with smart defaults');

    const { getUserInfo } = await import('@/lib/context/initialize-context');
    const userInfo = await getUserInfo(userId, adminSupabase);

    if (userInfo) {
      // Initialize modular profiles
      await initializeUserContext(
        userId,
        userInfo.fullName || 'User',
        userInfo.fullName || '',
        userInfo.email,
        adminSupabase
      );

      // Load newly created profiles
      const newContext = await getUserContextLegacy(userId, adminSupabase);
      console.log('[Sync] ✓ Created new user context profiles (modular)');
      return newContext;
    }

    return undefined;
  } catch (error) {
    console.error('[Sync] Error fetching user context:', error);
    return undefined;
  }
}

/**
 * Sync emails for a single connection (Gmail or Outlook)
 */
export async function syncEmailsForConnection(
  connection: any,
  adminSupabase: SupabaseClient,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const result: SyncResult = {
    emailsFetched: 0,
    inboxItemsCreated: 0,
    errors: [],
  };

  try {
    // Update sync status
    await adminSupabase
      .from('connections')
      .update({ sync_status: 'syncing' })
      .eq('id', connection.id);

    // Fetch emails based on provider
    const encryptedTokens = connection.metadata.tokens;
    const maxEmails = options.maxEmails || connection.metadata.max_emails_per_sync || 10;
    const syncWindowDays = options.syncWindowDays || connection.metadata.sync_window_days || 7;

    let messages: any[];
    if (connection.provider === 'gmail') {
      messages = await fetchGmailEmails(encryptedTokens, maxEmails, syncWindowDays);
    } else if (connection.provider === 'outlook') {
      // Token refresh callback - updates database when tokens are refreshed
      const onTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
        const newEncryptedTokens = Buffer.from(JSON.stringify({
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
          expiresOn: newTokens.expiresOn,
        })).toString('base64');

        await adminSupabase
          .from('connections')
          .update({
            metadata: {
              ...connection.metadata,
              tokens: newEncryptedTokens
            }
          })
          .eq('id', connection.id);

        console.log(`✓ Updated refreshed tokens for connection ${connection.id}`);
      };

      messages = await fetchOutlookEmails(encryptedTokens, maxEmails, syncWindowDays, onTokenRefresh);
    } else {
      console.warn(`Unknown provider: ${connection.provider}`);
      result.errors.push(`Unknown provider: ${connection.provider}`);
      return result;
    }

    console.log(`Fetched ${messages.length} ${connection.provider} emails for user ${connection.user_id}`);

    // Fetch user context for personalized AI processing (creates if doesn't exist)
    const userContext = await getUserContext(connection.user_id, adminSupabase);
    if (userContext) {
      const confidence = Math.round(userContext.confidenceMetrics.overallScore * 100);
      if (confidence > 0) {
        console.log(`✓ Loaded user context (confidence: ${confidence}%, ${userContext.confidenceMetrics.signalCount} signals)`);
      } else {
        console.log(`○ User context initialized - AI will learn from behavior`);
      }
    } else {
      console.log(`⚠ Failed to load/create user context - AI will use generic prompts`);
    }

    // Fetch calendar context for scheduling-aware email processing
    const calendarContext = await getCalendarContext(connection.user_id, adminSupabase);
    if (calendarContext.meetingBehavior || calendarContext.upcomingMeetings) {
      console.log(`✓ Loaded calendar context (${calendarContext.upcomingMeetings?.length || 0} upcoming meetings, ${calendarContext.meetingBehavior ? 'patterns learned' : 'no patterns'})`);
    } else {
      console.log(`○ No calendar context available - AI will not use scheduling insights`);
    }

    // Process each email
    for (const message of messages) {
      try {
        // Parse based on provider
        const parsed = connection.provider === 'gmail'
          ? parseGmailMessage(message)
          : parseOutlookMessage(message);

        console.log(`\n--- Processing email: ${parsed.subject}`);
        console.log(`    From: ${parsed.from_address}`);

        // Check if email already exists (check ALL emails, including sent ones for context)
        const { data: existingEmail } = await adminSupabase
          .from('emails')
          .select('id')
          .eq('message_id', parsed.message_id)
          .single();

        if (existingEmail) {
          console.log(`    ✓ Already exists, skipping`);
          continue;
        }

        // Determine if email is from user (for learning)
        const userEmail = connection.metadata?.email || connection.provider_account_id;
        const isFromUser = parsed.from_address.toLowerCase() === userEmail?.toLowerCase();

        // Store email
        const { data: storedEmail, error: emailError } = await adminSupabase
          .from('emails')
          .insert({
            user_id: connection.user_id,
            ...parsed,
            is_from_user: isFromUser, // Flag for learning from sent emails
          })
          .select()
          .single();

        if (emailError) {
          console.error('Error storing email:', emailError);
          result.errors.push(`Failed to store email: ${emailError.message}`);
          continue;
        }

        result.emailsFetched++;

        // Check if email is from the user (already determined and stored)
        console.log(`    User email: ${userEmail}`);
        console.log(`    Is from user: ${storedEmail.is_from_user}`);

        if (storedEmail.is_from_user) {
          console.log(`    ✓ Stored for context, extracting learning signals...`);

          // Extract learning signals from sent email (async, non-blocking)
          analyzeSentEmail({
            userId: connection.user_id,
            emailId: storedEmail.id,
            from: storedEmail.from_address,
            to: storedEmail.to_addresses || [],
            cc: storedEmail.cc_addresses || [],
            subject: storedEmail.subject || '',
            body: storedEmail.body || '',
            sentAt: storedEmail.received_at || new Date().toISOString(),
            threadId: storedEmail.thread_id,
            inReplyTo: storedEmail.in_reply_to,
          }).catch(err => {
            console.error('    ✗ Error analyzing sent email:', err);
            // Don't break sync if learning fails
          });

          console.log(`    ✓ Learning signals queued, skipping inbox item (sent email)\n`);
          continue; // Skip to next email (already stored for context)
        }

        // ==== RECIPIENT DETECTION ====
        // Analyze all recipients to determine who needs inbox items

        // Get all users in this organization for mention detection
        const { data: orgUsers } = await adminSupabase
          .from('profiles')
          .select('id, email, full_name')
          .eq('organization_id', (await adminSupabase
            .from('profiles')
            .select('organization_id')
            .eq('id', connection.user_id)
            .single()
          ).data?.organization_id || '')
          .limit(100);

        // Add the connection email as an alias for the connection owner
        // This allows users to connect multiple inboxes (e.g., personal Gmail + work email)
        const connectionEmail = connection.metadata?.email || connection.provider_account_id;
        if (connectionEmail && orgUsers) {
          const connectionOwner = orgUsers.find(u => u.id === connection.user_id);
          if (connectionOwner && connectionEmail.toLowerCase() !== connectionOwner.email.toLowerCase()) {
            // Add connection email as an alias
            orgUsers.push({
              id: connection.user_id,
              email: connectionEmail,
              full_name: connectionOwner.full_name,
            });
          }
        }

        console.log(`🔍 Analyzing recipients for: "${parsed.subject}"`);
        console.log(`   To: ${storedEmail.to_addresses?.join(', ') || 'none'}`);
        console.log(`   CC: ${storedEmail.cc_addresses?.join(', ') || 'none'}`);

        // Analyze recipients (detects roles and calculates confidence)
        const recipientAnalysis = await analyzeRecipients(
          {
            messageId: storedEmail.message_id,
            from: storedEmail.from_address,
            fromName: storedEmail.from_name || undefined,
            to: storedEmail.to_addresses || [],
            cc: storedEmail.cc_addresses || [],
            subject: storedEmail.subject || '',
            body: storedEmail.body || '',
            threadId: storedEmail.thread_id || undefined,
          },
          (orgUsers || []).map(u => ({
            userId: u.id,
            email: u.email,
            fullName: u.full_name || undefined,
          }))
        );

        console.log(`✓ Found ${recipientAnalysis.recipients.length} recipients in system`);
        console.log(`   Primary owner: ${recipientAnalysis.primaryOwner || 'none detected'}`);
        console.log(`   Team email: ${recipientAnalysis.isTeamEmail ? 'yes' : 'no'}`);
        console.log(`   Mentioned users: ${recipientAnalysis.mentionedUsers.join(', ') || 'none'}`);

        // ==== END RECIPIENT DETECTION ====

        // ==== PROCESS EACH RECIPIENT ====
        // Create inbox items for recipients that meet confidence threshold

        for (const recipient of recipientAnalysis.recipients) {
          // Skip if not in our system
          if (!recipient.userId) {
            console.log(`   ⊘ Skipping ${recipient.email} (not in system)`);
            continue;
          }

          // CRITICAL: Only create inbox items for the connection owner
          // Other recipients are analyzed for context only (roles, mentions, etc.)
          if (recipient.userId !== connection.user_id) {
            console.log(`   ⊘ Skipping ${recipient.email} (not connection owner)`);
            continue;
          }

          // Check if this is the current user (connection owner)
          const isCurrentUser = recipient.userId === connection.user_id;

          // Skip if doesn't meet threshold (with user-centric logic)
          if (!shouldCreateInboxItem(recipient, isCurrentUser)) {
            console.log(`   ⊘ Skipping ${recipient.email} (${recipient.detectedRole}, confidence: ${Math.round(recipient.responsibilityConfidence * 100)}%)`);
            continue;
          }

          // Calculate suggestion level and visual section for UX
          const suggestionLevel = getSuggestionLevel(recipient.responsibilityConfidence);
          const suggestionLabel = getSuggestionLabel(suggestionLevel);
          const visualSection = getVisualSection(suggestionLevel);

          console.log(`   ✓ Creating item for ${recipient.email} (${recipient.detectedRole}, ${suggestionLabel} → ${visualSection})`);

          // Check if inbox item already exists for this thread + user
          const { data: existingInboxItem } = await adminSupabase
            .from('inbox_items')
            .select('id, status')
            .eq('user_id', recipient.userId)
            .eq('source', 'email')
            .eq('source_data->>thread_id', storedEmail.thread_id || storedEmail.message_id)
            .eq('status', 'pending')
            .single();

          if (existingInboxItem) {
            console.log(`       ♻️  Updating existing inbox item for thread`);

            // Get all emails in this thread for context
            const { data: threadEmails } = await adminSupabase
              .from('emails')
              .select('*')
              .eq('user_id', recipient.userId)
              .eq('thread_id', storedEmail.thread_id || storedEmail.message_id)
              .order('received_at', { ascending: true });

            // AI Processing with full thread context (recipient-specific)
            const processed = await processEmail({
              id: storedEmail.id,
              user_id: recipient.userId,
              message_id: storedEmail.message_id,
              from_address: storedEmail.from_address,
              from_name: storedEmail.from_name,
              subject: storedEmail.subject,
              body: storedEmail.body,
              received_at: storedEmail.received_at,
              thread_context: threadEmails || [],
              user_context: userContext, // NEW: Personalize based on learned style
              calendar_context: calendarContext, // NEW: Schedule-aware processing
            });

            // Update existing inbox item with recipient context
            const { error: updateError } = await adminSupabase
              .from('inbox_items')
              .update({
                work_state: recipient.inferredWorkState,
                work_title: processed.workTitle,
                what_i_prepared: processed.whatIPrepared,
                why_matters: processed.whyMatters,

                // NEW: Visual section for UX
                visual_section: visualSection,

                // NEW: User confirmation (initialize for suggested items)
                user_confirmation: visualSection === 'suggested' ? {
                  status: 'pending',
                } : null,

                // NEW: Recipient context
                recipient_context: {
                  detectedRole: recipient.detectedRole,
                  position: recipient.position,
                  wasExplicitlyMentioned: recipient.wasExplicitlyMentioned,
                  workSignals: recipient.workSignals,
                  inferredWorkState: recipient.inferredWorkState,
                  responsibilityConfidence: recipient.responsibilityConfidence,
                  confidenceBreakdown: recipient.confidenceBreakdown,
                  reasoning: recipient.reasoning,
                  otherRecipients: recipient.otherRecipients,
                  senderEmail: recipient.senderEmail,
                  senderRelationship: recipient.senderRelationship,
                  // NEW: Suggestion level for UX
                  suggestionLevel,
                  suggestionLabel,
                },

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
                    subject: e.subject,
                    received_at: e.received_at,
                    snippet: e.body.substring(0, 150)
                  })),
                  summary: processed.summary,
                  keyPoints: processed.keyPoints,
                  urgency: processed.urgency,
                  signals: processed.signals,
                  ...processed.preparedOutput
                },
                ai_suggestion_type: recipient.inferredWorkState,
                ai_suggestion_content: processed.summary,
                ai_suggestion_reasoning: recipient.reasoning,
                confidence_score: Math.round(recipient.responsibilityConfidence * 100),
                priority: processed.priority,
                needs_review: true
              })
              .eq('id', existingInboxItem.id);

            if (updateError) {
              console.error('       ✗ Error updating inbox item:', updateError);
              result.errors.push(`Failed to update inbox item: ${updateError.message}`);
            } else {
              console.log(`       ✓ Updated inbox item`);
            }

            continue; // Continue to next recipient
          }

          // AI Processing for this recipient (recipient-specific)
          const processed = await processEmail({
            id: storedEmail.id,
            user_id: recipient.userId,
            message_id: storedEmail.message_id,
            from_address: storedEmail.from_address,
            from_name: storedEmail.from_name,
            subject: storedEmail.subject,
            body: storedEmail.body,
            received_at: storedEmail.received_at,
            user_context: userContext, // NEW: Personalize based on learned style
            calendar_context: calendarContext, // NEW: Schedule-aware processing
          });

          // Create inbox item for this recipient
          const { error: inboxError } = await adminSupabase
            .from('inbox_items')
            .insert({
              user_id: recipient.userId,
              source: 'email',
              source_id: storedEmail.id,

              // Work-state model (from recipient analysis)
              work_state: recipient.inferredWorkState,
              work_title: processed.workTitle,
              what_i_prepared: processed.whatIPrepared,
              why_matters: processed.whyMatters,

              // NEW: Visual section for UX
              visual_section: visualSection,

              // NEW: User confirmation (initialize for suggested items)
              user_confirmation: visualSection === 'suggested' ? {
                status: 'pending',
              } : null,

              // NEW: Recipient context
              recipient_context: {
                detectedRole: recipient.detectedRole,
                position: recipient.position,
                wasExplicitlyMentioned: recipient.wasExplicitlyMentioned,
                workSignals: recipient.workSignals,
                inferredWorkState: recipient.inferredWorkState,
                responsibilityConfidence: recipient.responsibilityConfidence,
                confidenceBreakdown: recipient.confidenceBreakdown,
                reasoning: recipient.reasoning,
                otherRecipients: recipient.otherRecipients,
                senderEmail: recipient.senderEmail,
                senderRelationship: recipient.senderRelationship,
                // NEW: Suggestion level for UX
                suggestionLevel,
                suggestionLabel,
              },

              // Source data (includes email + AI preparation)
              source_data: {
                email_id: storedEmail.id,
                message_id: storedEmail.message_id,
                thread_id: storedEmail.thread_id || storedEmail.message_id,
                from: storedEmail.from_address,
                from_name: storedEmail.from_name,
                subject: storedEmail.subject,
                received_at: storedEmail.received_at,
                provider: connection.provider,
                summary: processed.summary,
                keyPoints: processed.keyPoints,
                urgency: processed.urgency,
                signals: processed.signals,
                ...processed.preparedOutput
              },

              // Legacy fields
              ai_suggestion_type: recipient.inferredWorkState,
              ai_suggestion_content: processed.summary,
              ai_suggestion_reasoning: recipient.reasoning,
              confidence_score: Math.round(recipient.responsibilityConfidence * 100),
              priority: processed.priority,
              status: 'pending',
              needs_review: true
            });

          if (inboxError) {
            console.error(`       ✗ Error creating inbox item:`, inboxError);
            result.errors.push(`Failed to create inbox item: ${inboxError.message}`);
          } else {
            result.inboxItemsCreated++;
            console.log(`       ✓ Created inbox item (${recipient.inferredWorkState})`);
          }
        } // End recipient loop
      } catch (emailError) {
        console.error('Error processing email:', emailError);
        result.errors.push(`Email processing error: ${emailError instanceof Error ? emailError.message : 'Unknown'}`);
      }
    }

    // Update sync status
    await adminSupabase
      .from('connections')
      .update({
        sync_status: 'completed',
        last_sync: new Date().toISOString()
      })
      .eq('id', connection.id);

  } catch (error) {
    console.error(`Error syncing connection ${connection.id}:`, error);
    result.errors.push(`Connection sync error: ${error instanceof Error ? error.message : 'Unknown'}`);

    // Mark sync as failed
    await adminSupabase
      .from('connections')
      .update({ sync_status: 'failed' })
      .eq('id', connection.id);
  }

  return result;
}
