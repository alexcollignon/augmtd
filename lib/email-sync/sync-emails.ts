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

// Postgres rejects \u0000 (null bytes) in text columns — strip recursively from any value
function stripNulls(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/\u0000/g, '');
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, stripNulls(val)]));
  }
  return v;
}

import {
  fetchUnreadEmails as fetchGmailEmails,
  parseGmailMessage,
  fetchGmailAttachment,
} from '@/lib/google/gmail';
import {
  fetchUnreadEmails as fetchOutlookEmails,
  parseOutlookMessage,
  fetchOutlookAttachments,
  fetchOutlookAttachmentContent,
} from '@/lib/microsoft/outlook';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { processEmail } from '@/lib/ai/email-processor';
import { analyzeRecipients, shouldCreateInboxItem, getSuggestionLevel, getSuggestionLabel } from '@/lib/ai/recipient-detector';
import { analyzeSentEmail } from '@/lib/context/sent-email-analyzer';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import type { UserContextProfile } from '@/lib/types/user-context';
import { decomposeEmailWork } from '@/lib/execution/work-decomposition';

/**
 * Detect whether an email was forwarded based on subject and body patterns
 */
function detectForwarded(subject: string, body: string): boolean {
  if (/^(fwd?:|fw:)\s/i.test(subject.trim())) return true;
  if (/^-{5,}\s*forwarded message\s*-{5,}/im.test(body)) return true;
  if (/^begin forwarded message:/im.test(body)) return true;
  return false;
}

interface ProcessedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  extractedText: string | null;
}

async function processAttachmentsForEmail(params: {
  emailId: string;
  userId: string;
  provider: 'gmail' | 'outlook';
  encryptedTokens: string;
  parsedEmail: ReturnType<typeof parseGmailMessage> | ReturnType<typeof parseOutlookMessage>;
  outlookInternalId?: string;
  adminSupabase: SupabaseClient;
}): Promise<{ attachments: ProcessedAttachment[]; hasCalendarInvite: boolean }> {
  const { emailId, userId, provider, encryptedTokens, parsedEmail, outlookInternalId, adminSupabase } = params;
  const results: ProcessedAttachment[] = [];

  let attachmentList: Array<{ id: string; filename: string; mimeType: string; size: number }> = [];

  if (provider === 'gmail') {
    const gmailParsed = parsedEmail as ReturnType<typeof parseGmailMessage>;
    attachmentList = (gmailParsed.attachments || []).map(a => ({
      id: a.attachmentId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
    }));
  } else if (provider === 'outlook' && outlookInternalId) {
    try {
      const outlookAttachments = await fetchOutlookAttachments(encryptedTokens, outlookInternalId);
      attachmentList = outlookAttachments.map(a => ({
        id: a.id,
        filename: a.name,
        mimeType: a.contentType,
        size: a.size,
      }));
    } catch (err) {
      console.error(`[Attachments] Failed to list Outlook attachments for email ${emailId}:`, err);
      return { attachments: results, hasCalendarInvite: false };
    }
  }

  const hasCalendarInvite = attachmentList.some(
    (a) => a.mimeType?.includes('calendar') || a.mimeType === 'application/ics' || a.filename?.toLowerCase().endsWith('.ics')
  );

  console.log(`[Attachments] Processing ${attachmentList.length} attachments for email ${emailId}${hasCalendarInvite ? ' (calendar invite)' : ''}`);

  for (const att of attachmentList) {
    // Skip calendar/ICS files — presence already captured in hasCalendarInvite above,
    // and Supabase Storage rejects application/ics (415 Unsupported Media Type)
    if (att.mimeType?.includes('calendar') || att.mimeType === 'application/ics' || att.filename?.toLowerCase().endsWith('.ics')) {
      continue;
    }

    try {
      // Download attachment content
      let buffer: Buffer;
      if (provider === 'gmail') {
        const gmailId = (parsedEmail as ReturnType<typeof parseGmailMessage>).metadata.gmail_id as string;
        buffer = await fetchGmailAttachment(encryptedTokens, gmailId, att.id);
      } else {
        buffer = await fetchOutlookAttachmentContent(encryptedTokens, outlookInternalId!, att.id);
      }

      // Extract text
      const extractedText = await extractTextFromAttachment(buffer, att.mimeType, att.filename);

      // Upload to Supabase Storage
      const storagePath = `${userId}/${emailId}/${att.filename}`;
      const { error: uploadError } = await adminSupabase.storage
        .from('email-attachments')
        .upload(storagePath, buffer, {
          contentType: att.mimeType,
          upsert: true,
        });

      if (uploadError) {
        console.error(`[Attachments] Failed to upload ${att.filename}:`, uploadError);
        continue;
      }

      results.push({
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        storagePath,
        extractedText: extractedText ? extractedText.slice(0, 3000) : null,
      });

      console.log(`[Attachments] ✓ Stored ${att.filename} (${att.size} bytes, text: ${extractedText ? 'yes' : 'no'})`);
    } catch (err) {
      console.error(`[Attachments] Failed to process attachment ${att.filename}:`, err);
      // Never throw — one bad attachment shouldn't kill the sync
    }
  }

  return { attachments: results, hasCalendarInvite };
}

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
        userInfo.role || 'User', // Fixed: use role field, not fullName
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
      const onGmailTokenRefresh = async (newEncryptedTokens: string) => {
        await adminSupabase
          .from('connections')
          .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
          .eq('id', connection.id);
        console.log(`✓ Updated refreshed Gmail tokens for connection ${connection.id}`);
      };
      messages = await fetchGmailEmails(encryptedTokens, maxEmails, syncWindowDays, connection.metadata?.email, onGmailTokenRefresh);
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

    // Fetch user context, calendar context, and identity block in parallel
    const [userContext, calendarContext, userContextBlock] = await Promise.all([
      getUserContext(connection.user_id, adminSupabase),
      getCalendarContext(connection.user_id, adminSupabase),
      buildUserContextBlock(connection.user_id, adminSupabase),
    ]);

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
    if (userContextBlock) {
      console.log(`✓ Loaded identity context block`);
    }
    const meetingsCount = calendarContext.upcomingMeetings?.length || 0;
    const hasPatterns = !!calendarContext.meetingBehavior;
    const hasMeetings = meetingsCount > 0;

    if (hasMeetings || hasPatterns) {
      console.log(`✓ Loaded calendar context (${meetingsCount} upcoming meetings${hasPatterns ? ', patterns learned' : ', no patterns yet'})`);
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

        const isForwarded = detectForwarded(parsed.subject || '', parsed.body || '');

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

        // Strip parser-only fields that don't exist as DB columns before inserting
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { attachments: _att, hasAttachments: _ha, outlookInternalId: _oid, ...emailDbFields } = parsed as any;

        // Store email
        const { data: storedEmail, error: emailError } = await adminSupabase
          .from('emails')
          .insert({
            user_id: connection.user_id,
            connection_id: connection.id,
            ...emailDbFields,
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

        // Process attachments (Gmail: check parsed.attachments; Outlook: check parsed.hasAttachments)
        const hasAttachments =
          ((parsed as any).attachments?.length > 0) ||
          ((parsed as any).hasAttachments === true);

        let processedAttachments: ProcessedAttachment[] = [];
        let calendarEventId: string | null = null;

        if (hasAttachments) {
          const attResult = await processAttachmentsForEmail({
            emailId: storedEmail.id,
            userId: connection.user_id,
            provider: connection.provider as 'gmail' | 'outlook',
            encryptedTokens,
            parsedEmail: parsed,
            outlookInternalId: (parsed as any).outlookInternalId,
            adminSupabase,
          });
          processedAttachments = attResult.attachments;

          // If this is a calendar invite email, find the matching calendar event
          // by organizer (= email sender) + future start time — language-independent
          if (attResult.hasCalendarInvite && storedEmail.from_address) {
            const { data: calEvent } = await adminSupabase
              .from('calendar_events')
              .select('id')
              .eq('user_id', connection.user_id)
              .ilike('organizer', storedEmail.from_address)
              .gte('start_time', storedEmail.received_at ?? new Date().toISOString())
              .eq('status', 'confirmed')
              .order('start_time', { ascending: true })
              .limit(1)
              .maybeSingle();
            calendarEventId = calEvent?.id ?? null;
            if (calendarEventId) {
              console.log(`[CalendarInvite] Linked email to calendar_event ${calendarEventId}`);
            }
          }
        }

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

        // Always fetch the connection owner's profile directly (works for solo users and orgs)
        const { data: ownerProfile } = await adminSupabase
          .from('profiles')
          .select('id, email, full_name, organization_id')
          .eq('id', connection.user_id)
          .single();

        const usersInSystem: Array<{ id: string; email: string; full_name: string | null }> =
          ownerProfile ? [{ id: ownerProfile.id, email: ownerProfile.email, full_name: ownerProfile.full_name }] : [];

        // Also fetch other org members if the user belongs to an org
        if (ownerProfile?.organization_id) {
          const { data: orgMembers } = await adminSupabase
            .from('profiles')
            .select('id, email, full_name')
            .eq('organization_id', ownerProfile.organization_id)
            .neq('id', connection.user_id)
            .limit(100);
          if (orgMembers) usersInSystem.push(...orgMembers);
        }

        // Add the connection email as an alias if it differs from the profile email
        // This allows users to connect inboxes that don't match their AUGMTD login email
        const connectionEmail = connection.metadata?.email || connection.provider_account_id;
        if (connectionEmail && ownerProfile && connectionEmail.toLowerCase() !== ownerProfile.email.toLowerCase()) {
          usersInSystem.push({
            id: connection.user_id,
            email: connectionEmail,
            full_name: ownerProfile.full_name,
          });
        }

        // orgUsers alias kept for the analyzeRecipients call below
        const orgUsers = usersInSystem;

        console.log(`🔍 Analyzing recipients for: "${parsed.subject}"`);
        console.log(`   To: ${storedEmail.to_addresses?.join(', ') || 'none'}`);
        console.log(`   CC: ${storedEmail.cc_addresses?.join(', ') || 'none'}`);

        // Look up sender in relationship graph to provide context for recipient detection
        const senderRelData = userContext?.relationshipGraph?.[storedEmail.from_address.toLowerCase()];
        const senderContext = senderRelData
          ? { importance: senderRelData.importance * 100, relationshipType: senderRelData.typicalTone }
          : undefined;

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
          })),
          senderContext,
          connection.user_id,
          adminSupabase
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

          const suggestionLevel = getSuggestionLevel(recipient.responsibilityConfidence);
          const suggestionLabel = getSuggestionLabel(suggestionLevel);

          console.log(`   ✓ Creating item for ${recipient.email} (${recipient.detectedRole}, ${suggestionLabel})`);

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

            // Use the latest non-user email from the thread as the "current email"
            // (Gmail fetches newest-first, so the update path often processes an older email
            // that arrives after a newer one already created the inbox item — without this fix
            // the draft would be generated against the old email, not the latest reply)
            const latestIncoming = threadEmails
              ? [...threadEmails].reverse().find(e => !e.is_from_user)
              : null;
            const emailForProcessing = latestIncoming || storedEmail;

            // AI Processing with full thread context (recipient-specific)
            const processed = await processEmail({
              id: emailForProcessing.id,
              user_id: recipient.userId,
              message_id: emailForProcessing.message_id,
              from_address: emailForProcessing.from_address,
              from_name: emailForProcessing.from_name,
              subject: emailForProcessing.subject,
              body: emailForProcessing.body,
              received_at: emailForProcessing.received_at,
              thread_context: threadEmails || [],
              user_context: userContext,
              calendar_context: calendarContext,
              is_forwarded: isForwarded,
              recipient_position: recipient.position === 'to' || recipient.position === 'cc' ? recipient.position : undefined,
              recipient_email: recipient.email,
              user_context_block: userContextBlock || undefined,
            }, adminSupabase);

            // Work Decomposition (Layer 2): Check if this is executable work
            let executionPlan = null;
            let isExecutable = false;

            try {
              executionPlan = await decomposeEmailWork(
                {
                  subject: emailForProcessing.subject,
                  body: emailForProcessing.body,
                  from: emailForProcessing.from_name || emailForProcessing.from_address,
                  threadHistory: threadEmails || undefined,
                },
                recipient.userId,
                adminSupabase
              );

              if (executionPlan) {
                isExecutable = true;
                console.log(`       🤖 Executable work detected: ${executionPlan.deliverable_description}`);
              }
            } catch (error) {
              console.error('[Sync] Work decomposition error:', error);
              // Continue without execution plan - don't break email sync
            }

            // Update existing inbox item with recipient context
            const { error: updateError } = await adminSupabase
              .from('inbox_items')
              .update({
                connection_id: connection.id,
                work_state: recipient.inferredWorkState,
                work_title: processed.workTitle,
                what_i_prepared: processed.whatIPrepared,
                why_matters: processed.whyMatters,
                item_type: processed.itemType,

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
                  from: emailForProcessing.from_address,
                  from_address: emailForProcessing.from_address,
                  from_name: emailForProcessing.from_name,
                  subject: emailForProcessing.subject,
                  body: emailForProcessing.body,
                  html_body: ((emailForProcessing as any).html_body as string | null)?.slice(0, 15000) || null,
                  received_at: emailForProcessing.received_at,
                  provider: connection.provider,
                  calendar_event_id: calendarEventId || undefined,
                  isForwarded,
                  thread_history: threadEmails?.map(e => ({
                    from: e.from_address,
                    from_name: e.from_name,
                    subject: e.subject,
                    received_at: e.received_at,
                    snippet: e.body.substring(0, 2500)
                  })),
                  summary: processed.summary,
                  keyPoints: processed.keyPoints,
                  urgency: processed.urgency,
                  signals: processed.signals,
                  attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
                  ...processed.preparedOutput
                },
                ai_suggestion_type: recipient.inferredWorkState,
                ai_suggestion_content: processed.summary,
                ai_suggestion_reasoning: recipient.reasoning,
                confidence_score: Math.round(recipient.responsibilityConfidence * 100),
                priority: processed.priority,
                needs_review: true,

                // Execution fields (Layer 2: Work Decomposition)
                is_executable: isExecutable,
                execution_plan: executionPlan,
                execution_status: executionPlan ? 'queued' : null,
                current_step: 0,
                artifacts: [],
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

          // Fetch thread history for new item (same context as update path)
          const { data: threadEmailsForNew } = await adminSupabase
            .from('emails')
            .select('*')
            .eq('user_id', recipient.userId)
            .eq('thread_id', storedEmail.thread_id || storedEmail.message_id)
            .order('received_at', { ascending: true });

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
            thread_context: threadEmailsForNew || [],
            user_context: userContext,
            calendar_context: calendarContext,
            is_forwarded: isForwarded,
            recipient_position: recipient.position === 'to' || recipient.position === 'cc' ? recipient.position : undefined,
            recipient_email: recipient.email,
            user_context_block: userContextBlock || undefined,
          }, adminSupabase);

          // Work Decomposition (Layer 2): Check if this is executable work
          let executionPlan = null;
          let isExecutable = false;

          try {
            executionPlan = await decomposeEmailWork(
              {
                subject: storedEmail.subject,
                body: storedEmail.body,
                from: storedEmail.from_name || storedEmail.from_address,
                threadHistory: threadEmailsForNew || undefined,
              },
              recipient.userId,
              adminSupabase
            );

            if (executionPlan) {
              isExecutable = true;
              console.log(`       🤖 Executable work detected: ${executionPlan.deliverable_description}`);
            }
          } catch (error) {
            console.error('[Sync] Work decomposition error:', error);
            // Continue without execution plan - don't break email sync
          }

          // Create inbox item for this recipient
          const { data: newInboxItem, error: inboxError } = await adminSupabase
            .from('inbox_items')
            .insert(stripNulls({
              user_id: recipient.userId,
              connection_id: connection.id,
              source: 'email',
              source_id: storedEmail.id,

              // Work-state model (from recipient analysis)
              work_state: recipient.inferredWorkState,
              work_title: processed.workTitle,
              what_i_prepared: processed.whatIPrepared,
              why_matters: processed.whyMatters,
              item_type: processed.itemType,

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
                from_address: storedEmail.from_address,
                from_name: storedEmail.from_name,
                subject: storedEmail.subject,
                body: storedEmail.body,
                html_body: ((parsed as any).html_body as string | null)?.slice(0, 15000) || null,
                received_at: storedEmail.received_at,
                provider: connection.provider,
                calendar_event_id: calendarEventId || undefined,
                isForwarded,
                thread_history: threadEmailsForNew?.map(e => ({
                  from: e.from_address,
                  from_name: e.from_name,
                  subject: e.subject,
                  received_at: e.received_at,
                  snippet: e.body.substring(0, 2500)
                })),
                summary: processed.summary,
                keyPoints: processed.keyPoints,
                urgency: processed.urgency,
                signals: processed.signals,
                attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
                ...processed.preparedOutput
              },

              // Execution fields (Layer 2: Work Decomposition)
              is_executable: isExecutable,
              execution_plan: executionPlan,
              execution_status: executionPlan ? 'queued' : null,
              current_step: 0,
              artifacts: [],

              // Legacy fields
              ai_suggestion_type: recipient.inferredWorkState,
              ai_suggestion_content: processed.summary,
              ai_suggestion_reasoning: recipient.reasoning,
              confidence_score: Math.round(recipient.responsibilityConfidence * 100),
              priority: processed.priority,
              status: 'pending',
              needs_review: true
            }) as Record<string, unknown>)
            .select('id')
            .single();

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
