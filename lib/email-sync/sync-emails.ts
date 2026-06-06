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
import { batchClassifyEmails, type EmailEnvelope } from '@/lib/ai/email-classifier-batch';
import { batchAnalyzeRecipients, type EmailRoutingInput, type UserInSystem } from '@/lib/ai/recipient-classifier-batch';

// Sanitize filenames for Supabase Storage keys — spaces and special chars cause 400 errors
function sanitizeStorageKey(filename: string): string {
  return filename
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._\-]/g, '_')
    .replace(/_+/g, '_');
}

// MIME types that Supabase Storage rejects outright — skip upload for these
const UNSUPPORTED_STORAGE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.ms-powerpoint', // ppt
  'application/octet-stream', // generic binary — also rejected
]);
function isStorageMimeTypeSupported(mimeType: string): boolean {
  return !UNSUPPORTED_STORAGE_MIME_TYPES.has(mimeType);
}

// Postgres rejects \u0000 (null bytes) in text columns — strip recursively from any value
/** Derive is_read from a stored email row: Gmail uses labels[], Outlook stores is_read directly */
function deriveIsRead(email: any): boolean {
  if (Array.isArray(email.labels)) return !email.labels.includes('UNREAD');
  if (typeof email.is_read === 'boolean') return email.is_read;
  return true;
}

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
  fetchSentEmails as fetchGmailSentEmails,
  parseGmailMessage,
  fetchGmailAttachment,
  fetchGmailThread,
} from '@/lib/google/gmail';
import {
  fetchUnreadEmails as fetchOutlookEmails,
  fetchSentEmails as fetchOutlookSentEmails,
  parseOutlookMessage,
  fetchOutlookAttachments,
  fetchOutlookAttachmentContent,
  fetchOutlookConversation,
} from '@/lib/microsoft/outlook';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { processEmail } from '@/lib/ai/email-processor';
import { analyzeRecipients, shouldCreateInboxItem, getSuggestionLevel, getSuggestionLabel } from '@/lib/ai/recipient-detector';
import { analyzeSentEmail } from '@/lib/context/sent-email-analyzer';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import type { UserContextProfile } from '@/lib/types/user-context';

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

  // Cap at 8 non-calendar attachments to avoid blocking sync on emails with many files
  const MAX_ATTACHMENTS = 8;
  const processableAttachments = attachmentList.filter(
    a => !(a.mimeType?.includes('calendar') || a.mimeType === 'application/ics' || a.filename?.toLowerCase().endsWith('.ics'))
  );
  if (processableAttachments.length > MAX_ATTACHMENTS) {
    console.log(`[Attachments] Capping at ${MAX_ATTACHMENTS} (was ${processableAttachments.length}) for email ${emailId}`);
  }

  console.log(`[Attachments] Processing ${Math.min(processableAttachments.length, MAX_ATTACHMENTS)} attachments for email ${emailId}${hasCalendarInvite ? ' (calendar invite)' : ''}`);

  let _attachmentCount = 0;
  for (const att of attachmentList) {
    // Skip calendar/ICS files — presence already captured in hasCalendarInvite above,
    // and Supabase Storage rejects application/ics (415 Unsupported Media Type)
    if (att.mimeType?.includes('calendar') || att.mimeType === 'application/ics' || att.filename?.toLowerCase().endsWith('.ics')) {
      continue;
    }

    // Enforce cap on non-calendar attachments
    if (_attachmentCount >= MAX_ATTACHMENTS) break;
    _attachmentCount++;

    try {
      // Download attachment content
      let buffer: Buffer;
      if (provider === 'gmail') {
        const gmailId = (parsedEmail as ReturnType<typeof parseGmailMessage>).metadata.gmail_id as string;
        buffer = await fetchGmailAttachment(encryptedTokens, gmailId, att.id);
      } else {
        buffer = await fetchOutlookAttachmentContent(encryptedTokens, outlookInternalId!, att.id);
      }

      // Extract text — skip for large files (>1.5 MB) to avoid blocking sync
      const MAX_EXTRACT_BYTES = 1.5 * 1024 * 1024;
      const extractedText = buffer.length <= MAX_EXTRACT_BYTES
        ? await extractTextFromAttachment(buffer, att.mimeType, att.filename)
        : null;

      // Skip upload for MIME types that Supabase Storage rejects (pptx, octet-stream, etc.)
      if (!isStorageMimeTypeSupported(att.mimeType)) {
        console.log(`[Attachments] Skipping upload for unsupported MIME type: ${att.mimeType} (${att.filename})`);
        // Still push metadata so the attachment appears in the email card, just without a storagePath
        results.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          storagePath: '',
          extractedText: extractedText ? extractedText.slice(0, 3000) : null,
        });
        continue;
      }

      // Upload to Supabase Storage
      const safeFilename = sanitizeStorageKey(att.filename);
      const storagePath = `${userId}/${emailId}/${safeFilename}`;
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
  /** Skip fetch step — use these pre-fetched raw messages directly (push webhook path) */
  preloadedMessages?: any[];
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
 * Backfill all historical messages in a thread that are not yet in the DB.
 * These rows are context-only — no inbox_item is created for them.
 * Non-fatal: any error is logged and swallowed so the main sync continues.
 */
async function backfillThreadHistory(params: {
  connection: any;
  storedEmail: any;
  encryptedTokens: string;
  adminSupabase: SupabaseClient;
  onGmailTokenRefresh?: (newTokens: string) => Promise<void>;
  onOutlookTokenRefresh?: (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => Promise<void>;
}): Promise<void> {
  const { connection, storedEmail, encryptedTokens, adminSupabase, onGmailTokenRefresh, onOutlookTokenRefresh } = params;

  try {
    const threadId = storedEmail.thread_id;
    if (!threadId) return; // Single-message thread — nothing to backfill

    // Check if this thread was already fully backfilled by looking at the oldest stored email
    const { data: oldestRow } = await adminSupabase
      .from('emails')
      .select('id, metadata')
      .eq('user_id', connection.user_id)
      .eq('thread_id', threadId)
      .order('received_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const backfilledAt = (oldestRow?.metadata as any)?.thread_backfilled_at;
    if (backfilledAt && Date.now() - new Date(backfilledAt).getTime() < 2 * 60 * 60 * 1000) return;

    // Fetch all messages in the thread from the provider
    let fetchedMessages: any[] = [];
    try {
      if (connection.provider === 'gmail') {
        const raw = await fetchGmailThread(encryptedTokens, threadId, onGmailTokenRefresh);
        // Single-message threads need no backfill
        if (raw.length <= 1) {
          if (oldestRow) {
            await adminSupabase
              .from('emails')
              .update({ metadata: { ...(oldestRow.metadata as any), thread_backfilled_at: new Date().toISOString() } })
              .eq('id', oldestRow.id);
          }
          return;
        }
        fetchedMessages = raw.map(m => parseGmailMessage(m));
      } else if (connection.provider === 'outlook') {
        const raw = await fetchOutlookConversation(encryptedTokens, threadId, onOutlookTokenRefresh);
        if (raw.length <= 1) {
          if (oldestRow) {
            await adminSupabase
              .from('emails')
              .update({ metadata: { ...(oldestRow.metadata as any), thread_backfilled_at: new Date().toISOString() } })
              .eq('id', oldestRow.id);
          }
          return;
        }
        fetchedMessages = raw.map(m => parseOutlookMessage(m));
      } else {
        return;
      }
    } catch (err) {
      console.warn(`[ThreadBackfill] Provider API call failed for thread ${threadId}:`, err);
      return;
    }

    // Get message_ids already stored in DB for this thread
    const { data: existingRows } = await adminSupabase
      .from('emails')
      .select('message_id')
      .eq('user_id', connection.user_id)
      .eq('thread_id', threadId);

    const knownMessageIds = new Set((existingRows || []).map((r: any) => r.message_id).filter(Boolean));

    // Filter to messages not yet in DB
    const userEmail = connection.metadata?.email || connection.provider_account_id;
    const rowsToInsert = fetchedMessages
      .filter(m => m.message_id && !knownMessageIds.has(m.message_id))
      .map(m => {
        // Strip parser-only fields before insert
        const { attachments: _a, hasAttachments: _ha, outlookInternalId: _oid, ...dbFields } = m as any;
        return stripNulls({
          user_id: connection.user_id,
          connection_id: connection.id,
          ...dbFields,
          html_body: (m as any).html_body?.slice(0, 15000) || null,
          is_from_user: (m.from_address || '').toLowerCase() === (userEmail || '').toLowerCase(),
          metadata: { ...m.metadata, thread_context_only: true },
        }) as Record<string, unknown>;
      });

    if (rowsToInsert.length > 0) {
      const { error } = await adminSupabase
        .from('emails')
        .upsert(rowsToInsert, { onConflict: 'message_id', ignoreDuplicates: true });
      if (error) {
        console.warn(`[ThreadBackfill] Insert error for thread ${threadId}:`, error.message);
      } else {
        console.log(`[ThreadBackfill] Inserted ${rowsToInsert.length} historical messages for thread ${threadId}`);
      }
    }

    // Mark thread as backfilled on the oldest row (timestamp-based for TTL re-runs)
    const anchorId = oldestRow?.id;
    if (anchorId) {
      await adminSupabase
        .from('emails')
        .update({ metadata: { ...(oldestRow.metadata as any), thread_backfilled_at: new Date().toISOString() } })
        .eq('id', anchorId);
    }
  } catch (err) {
    console.warn(`[ThreadBackfill] Unexpected error:`, err);
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
      .update({ sync_status: 'syncing', sync_started_at: new Date().toISOString() })
      .eq('id', connection.id);

    // Fetch emails based on provider (or use preloaded messages from push webhook)
    const encryptedTokens = connection.metadata.tokens;
    const maxEmails = options.maxEmails || connection.metadata.max_emails_per_sync || 50;
    const syncWindowDays = options.syncWindowDays || connection.metadata.sync_window_days || 7;

    let messages: any[];
    if (options.preloadedMessages) {
      messages = options.preloadedMessages;
      console.log(`Using ${messages.length} preloaded ${connection.provider} messages for user ${connection.user_id}`);
    } else if (connection.provider === 'gmail') {
      const onGmailTokenRefresh = async (newEncryptedTokens: string) => {
        await adminSupabase
          .from('connections')
          .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
          .eq('id', connection.id);
        console.log(`✓ Updated refreshed Gmail tokens for connection ${connection.id}`);
      };
      messages = await fetchGmailEmails(encryptedTokens, maxEmails, syncWindowDays, connection.metadata?.email, onGmailTokenRefresh, connection.last_sync ?? undefined);
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

      messages = await fetchOutlookEmails(encryptedTokens, maxEmails, syncWindowDays, onTokenRefresh, connection.last_sync ?? undefined);
    } else {
      console.warn(`Unknown provider: ${connection.provider}`);
      result.errors.push(`Unknown provider: ${connection.provider}`);
      return result;
    }

    console.log(`Fetched ${messages.length} ${connection.provider} emails for user ${connection.user_id}`);

    // Fetch user context, calendar context, identity block in parallel
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

    // === BATCH PRE-FILTER ===
    // Parse all messages upfront so we can build envelopes for the batch classifier.
    // If messages are already parsed (from fetch-batch / process-single), skip re-parsing.
    const parsedMessages = messages.map(m =>
      // A parsed message has message_id; a raw Gmail/Outlook message does not
      ('message_id' in m)
        ? m
        : connection.provider === 'gmail' ? parseGmailMessage(m) : parseOutlookMessage(m)
    );

    // Build envelopes (subject + from + snippet only — no body)
    const envelopes: EmailEnvelope[] = parsedMessages.map((p, i) => ({
      id: String(i), // use index as temporary id
      from: p.from_address,
      subject: p.subject || '',
      snippet: (p as any).snippet || p.body?.slice(0, 200) || '',
      body_preview: p.body?.slice(0, 500) || '',
    }));

    const classMap = await batchClassifyEmails(envelopes, connection.user_id, adminSupabase);

    // Build routing inputs for process-class emails
    const processEnvelopes = parsedMessages
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => classMap.get(String(i)) === 'process');

    const routingInputs: EmailRoutingInput[] = processEnvelopes.map(({ p, i }) => ({
      id: String(i),
      from: p.from_address,
      to: (p as any).to_addresses || [],
      cc: (p as any).cc_addresses || [],
      subject: p.subject || '',
    }));

    // Fetch users in system once for batch routing
    let usersInSystemForBatch: UserInSystem[] = [];
    try {
      const { data: ownerProfileForBatch } = await adminSupabase
        .from('profiles')
        .select('id, email, full_name, company_id')
        .eq('id', connection.user_id)
        .single();
      if (ownerProfileForBatch) {
        usersInSystemForBatch = [{ userId: ownerProfileForBatch.id, email: ownerProfileForBatch.email, fullName: ownerProfileForBatch.full_name ?? undefined }];
        if (ownerProfileForBatch.company_id) {
          const { data: members } = await adminSupabase
            .from('company_members')
            .select('user_id, profiles(id, email, full_name)')
            .eq('company_id', ownerProfileForBatch.company_id)
            .eq('status', 'active')
            .limit(100);
          if (members) {
            for (const m of members) {
              const pr = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              if (pr) usersInSystemForBatch.push({ userId: pr.id, email: pr.email, fullName: pr.full_name ?? undefined });
            }
          }
        }
      }
    } catch { /* non-fatal — batch routing falls back to connection owner */ }

    // routingMap provides pre-computed routing hints for each email; used to log and
    // in future to short-circuit per-email analyzeRecipients() for clear cases.
    const routingMap = await batchAnalyzeRecipients(routingInputs, usersInSystemForBatch, connection.user_id, adminSupabase);
    if (routingMap.size > 0) {
      console.log(`[BatchRouting] Pre-computed routing for ${routingMap.size} process-class email(s)`);
    }
    // === END BATCH PRE-FILTER ===

    // Hoist owner profile + company members — fetched ONCE, reused for all process-class emails
    // (previously this was fetched inside the per-email loop = N redundant DB round-trips)
    let _ownerProfile: { id: string; email: string; full_name: string | null; company_id: string | null } | null = null;
    const _orgUsers: Array<{ id: string; email: string; full_name: string | null }> = [];
    try {
      const { data: op } = await adminSupabase
        .from('profiles')
        .select('id, email, full_name, company_id')
        .eq('id', connection.user_id)
        .single();
      if (op) {
        _ownerProfile = op;
        _orgUsers.push({ id: op.id, email: op.email, full_name: op.full_name });
        if (op.company_id) {
          const { data: members } = await adminSupabase
            .from('company_members')
            .select('user_id, profiles(id, email, full_name)')
            .eq('company_id', op.company_id)
            .eq('status', 'active')
            .limit(100);
          if (members) {
            for (const m of members) {
              const pr = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              if (pr) _orgUsers.push({ id: pr.id, email: pr.email, full_name: pr.full_name });
            }
          }
        }
      }
    } catch { /* non-fatal — fall back to empty org context */ }
    const _connectionEmail = connection.metadata?.email || connection.provider_account_id;
    if (_connectionEmail && _ownerProfile && _connectionEmail.toLowerCase() !== _ownerProfile.email.toLowerCase()) {
      _orgUsers.push({ id: connection.user_id, email: _connectionEmail, full_name: _ownerProfile.full_name });
    }

    // Phase 1: sequential — store email rows, fire learning for sent, fast-path noise/fyi
    // Process-class emails are collected into processQueue for parallel AI in Phase 2
    interface _ProcessQueueItem {
      parsed: any;
      storedEmail: any;
      processedAttachments: ProcessedAttachment[];
      calendarEventId: string | null;
      hasCalendarInvite: boolean;
      isForwarded: boolean;
    }
    const processQueue: _ProcessQueueItem[] = [];

    for (let _msgIdx = 0; _msgIdx < parsedMessages.length; _msgIdx++) {
      const emailClass = classMap.get(String(_msgIdx)) ?? 'process';
      try {
        // Already parsed above
        const parsed = parsedMessages[_msgIdx];

        const isForwarded = detectForwarded(parsed.subject || '', parsed.body || '');

        console.log(`\n--- Processing email: ${parsed.subject}`);
        console.log(`    From: ${parsed.from_address}`);

        // Check if email already exists (check ALL emails, including sent ones for context)
        const { data: existingEmail } = await adminSupabase
          .from('emails')
          .select('*')
          .eq('message_id', parsed.message_id)
          .single();

        if (existingEmail) {
          // Email row exists — but check if an inbox_item was ever created for this thread.
          // This can happen when a previous sync stored the email rows but crashed or timed out
          // before creating inbox_items (e.g. first Outlook sync attempt partially succeeded).
          // In that case silently skipping would permanently drop the email from the inbox.
          const threadIdForCheck = parsed.thread_id || parsed.message_id;
          const { data: orphanCheck } = await adminSupabase
            .from('inbox_items')
            .select('id')
            .eq('user_id', connection.user_id)
            .eq('source', 'email')
            .eq('source_data->>thread_id', threadIdForCheck)
            .limit(1)
            .maybeSingle();

          if (orphanCheck) {
            // Inbox item exists — genuinely already processed, skip
            console.log(`    ✓ Already exists, skipping`);
            continue;
          }

          // Context-only backfill rows should never become inbox items
          if ((existingEmail.metadata as any)?.thread_context_only) {
            console.log(`    ⏭️  Skipping context-only backfill row`);
            continue;
          }

          // Email stored but no inbox item — recover it
          console.log(`    ♻️  Email exists but no inbox item — recovering`);

          if (emailClass === 'noise') {
            await adminSupabase.from('inbox_items').insert(stripNulls({
              user_id: connection.user_id,
              connection_id: connection.id,
              source: 'email',
              source_id: existingEmail.id,
              work_state: 'noise',
              work_title: existingEmail.subject || 'Email',
              why_matters: null,
              what_i_prepared: null,
              item_type: 'notification',
              source_data: {
                email_id: existingEmail.id,
                message_id: existingEmail.message_id,
                thread_id: existingEmail.thread_id || existingEmail.message_id,
                from: existingEmail.from_address,
                from_address: existingEmail.from_address,
                from_name: existingEmail.from_name,
                subject: existingEmail.subject,
                body: existingEmail.body,
                html_body: existingEmail.html_body?.slice(0, 15000) || null,
                received_at: existingEmail.received_at,
                provider: connection.provider,
              },
              is_read: deriveIsRead(existingEmail),
              status: 'pending',
              needs_review: false,
            }) as Record<string, unknown>);
            result.inboxItemsCreated++;
            continue;
          }

          if (emailClass === 'fyi_only') {
            await adminSupabase.from('inbox_items').insert(stripNulls({
              user_id: connection.user_id,
              connection_id: connection.id,
              source: 'email',
              source_id: existingEmail.id,
              work_state: 'noted',
              work_title: existingEmail.subject || 'Email',
              why_matters: null,
              what_i_prepared: null,
              item_type: 'fyi',
              source_data: {
                email_id: existingEmail.id,
                message_id: existingEmail.message_id,
                thread_id: existingEmail.thread_id || existingEmail.message_id,
                from: existingEmail.from_address,
                from_address: existingEmail.from_address,
                from_name: existingEmail.from_name,
                subject: existingEmail.subject,
                body: existingEmail.body,
                html_body: existingEmail.html_body?.slice(0, 15000) || null,
                received_at: existingEmail.received_at,
                provider: connection.provider,
              },
              is_read: deriveIsRead(existingEmail),
              status: 'pending',
              needs_review: false,
            }) as Record<string, unknown>);
            result.inboxItemsCreated++;
            continue;
          }

          // Process-class: queue the stored email for full AI processing (skip attachment re-fetch)
          processQueue.push({
            parsed,
            storedEmail: existingEmail,
            processedAttachments: [],
            calendarEventId: null,
            hasCalendarInvite: false,
            isForwarded,
          });
          continue;
        }

        // Determine if email is from user (for learning)
        const userEmail = connection.metadata?.email || connection.provider_account_id;
        const isFromUser = parsed.from_address.toLowerCase() === userEmail?.toLowerCase();

        // Strip parser-only fields that don't exist as DB columns before inserting
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { attachments: _att, hasAttachments: _ha, outlookInternalId: _oid, ...emailDbFields } = parsed as any;

        // Store email
        let { data: storedEmail, error: emailError } = await adminSupabase
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
          // 23505 = unique_violation on message_id — parallel sync race condition.
          // The other sync won the insert; look up the existing row and recover normally.
          if ((emailError as any).code === '23505') {
            const { data: racedEmail } = await adminSupabase
              .from('emails')
              .select('*')
              .eq('message_id', parsed.message_id)
              .single();
            if (racedEmail) {
              console.log(`    ⚡ Race condition — row inserted by parallel sync, recovering`);
              // Reuse the existing-email recovery path by falling through with racedEmail
              const threadIdForCheck2 = parsed.thread_id || parsed.message_id;
              const { data: orphanCheck2 } = await adminSupabase
                .from('inbox_items')
                .select('id')
                .eq('user_id', connection.user_id)
                .eq('source', 'email')
                .eq('source_data->>thread_id', threadIdForCheck2)
                .limit(1)
                .maybeSingle();
              if (orphanCheck2) {
                console.log(`    ✓ Already exists, skipping`);
                continue;
              }
              if ((racedEmail.metadata as any)?.thread_context_only) {
                console.log(`    ⏭️  Skipping context-only backfill row`);
                continue;
              }
              // Recover: assign to storedEmail and fall through to normal processing below
              storedEmail = racedEmail;
              emailError = null;
            } else {
              console.error('Error storing email:', emailError);
              result.errors.push(`Failed to store email: ${emailError.message}`);
              continue;
            }
          } else {
            console.error('Error storing email:', emailError);
            result.errors.push(`Failed to store email: ${emailError.message}`);
            continue;
          }
        }

        result.emailsFetched++;

        // Check if email is from the user
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

        // Backfill full thread history so AI sees complete context (non-fatal)
        await backfillThreadHistory({
          connection,
          storedEmail,
          encryptedTokens,
          adminSupabase,
          onGmailTokenRefresh: connection.provider === 'gmail'
            ? async (newTokens: string) => {
                await adminSupabase
                  .from('connections')
                  .update({ metadata: { ...connection.metadata, tokens: newTokens } })
                  .eq('id', connection.id);
              }
            : undefined,
          onOutlookTokenRefresh: connection.provider === 'outlook'
            ? async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
                const newEncryptedTokens = Buffer.from(JSON.stringify(newTokens)).toString('base64');
                await adminSupabase
                  .from('connections')
                  .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
                  .eq('id', connection.id);
              }
            : undefined,
        }).catch(err => console.warn(`[ThreadBackfill] Non-fatal error for thread ${storedEmail.thread_id}:`, err));

        // ==== BATCH AI FAST-PATH (before attachments — noise/fyi skip attachment fetching entirely) ====
        if (emailClass === 'noise' || emailClass === 'fyi_only') {
          const fastThreadId = storedEmail.thread_id || storedEmail.message_id;
          const { data: fastExisting } = await adminSupabase
            .from('inbox_items')
            .select('id, status')
            .eq('user_id', connection.user_id)
            .eq('source', 'email')
            .eq('source_data->>thread_id', fastThreadId)
            .maybeSingle();

          const fastSourceData = stripNulls({
            email_id: storedEmail.id,
            message_id: storedEmail.message_id,
            thread_id: fastThreadId,
            from: storedEmail.from_address,
            from_address: storedEmail.from_address,
            from_name: storedEmail.from_name,
            subject: storedEmail.subject,
            body: storedEmail.body,
            html_body: (parsed as any).html_body?.slice(0, 15000) || null,
            received_at: storedEmail.received_at,
            provider: connection.provider,
          });

          if (fastExisting) {
            // Thread already has an inbox item — update source_data so the card reflects the latest email.
            // Only update if item is still pending (don't re-surface dismissed/completed items).
            if (fastExisting.status === 'pending') {
              const label = emailClass === 'noise' ? 'noise' : 'FYI';
              console.log(`    ♻️  ${label} email — updating existing thread item`);
              await adminSupabase
                .from('inbox_items')
                .update(stripNulls({ source_data: fastSourceData, source_id: storedEmail.id }) as Record<string, unknown>)
                .eq('id', fastExisting.id);
            } else {
              console.log(`    ⏭️  Thread item already ${fastExisting.status}, skipping`);
            }
          } else if (emailClass === 'noise') {
            console.log(`    ⊘ Classified as noise — creating minimal inbox item`);
            const { error: noiseErr } = await adminSupabase.from('inbox_items').insert(stripNulls({
              user_id: connection.user_id,
              connection_id: connection.id,
              workspace_id: connection.workspace_id ?? null,
              source: 'email',
              source_id: storedEmail.id,
              work_state: 'noise',
              work_title: parsed.subject || 'Email',
              why_matters: null,
              what_i_prepared: null,
              item_type: 'notification',
              source_data: fastSourceData,
              is_read: deriveIsRead(storedEmail),
              status: 'pending',
              needs_review: false,
            }) as Record<string, unknown>);
            if (noiseErr) console.error(`    ✗ Failed to insert noise inbox item:`, noiseErr.message);
            else result.inboxItemsCreated++;
          } else {
            console.log(`    ℹ Classified as FYI — creating minimal inbox item`);
            const { error: fyiErr } = await adminSupabase.from('inbox_items').insert(stripNulls({
              user_id: connection.user_id,
              connection_id: connection.id,
              workspace_id: connection.workspace_id ?? null,
              source: 'email',
              source_id: storedEmail.id,
              work_state: 'noted',
              work_title: parsed.subject || 'Email',
              why_matters: null,
              what_i_prepared: null,
              item_type: 'fyi',
              source_data: fastSourceData,
              is_read: deriveIsRead(storedEmail),
              status: 'pending',
              needs_review: false,
            }) as Record<string, unknown>);
            if (fyiErr) console.error(`    ✗ Failed to insert fyi inbox item:`, fyiErr.message);
            else result.inboxItemsCreated++;
          }
          continue;
        }
        // ==== END BATCH AI FAST-PATH ====

        // Process-class: process attachments then queue for parallel AI (Phase 2)
        const hasAttachments =
          ((parsed as any).attachments?.length > 0) ||
          ((parsed as any).hasAttachments === true);

        let processedAttachments: ProcessedAttachment[] = [];
        let calendarEventId: string | null = null;
        let hasCalendarInvite = false;

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
          hasCalendarInvite = attResult.hasCalendarInvite ?? false;

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

        // Queue for Phase 2 parallel AI processing
        processQueue.push({ parsed, storedEmail, processedAttachments, calendarEventId, hasCalendarInvite, isForwarded });

      } catch (emailError) {
        console.error('Error processing email:', emailError);
        result.errors.push(`Email processing error: ${emailError instanceof Error ? emailError.message : 'Unknown'}`);
      }
    }

    // === Phase 2 pre-step: deduplicate processQueue by thread_id ===
    // Multiple emails from the same thread can arrive in the same sync batch (e.g. 5 replies
    // in one thread). If we process all 5 in parallel they all query existingInboxItem at the
    // same instant, see null, and each insert a separate inbox item → duplicates.
    // Fix: keep only the newest email per thread — processEmail loads full thread context from
    // DB anyway, so we never lose context.
    const _threadSeen = new Map<string, _ProcessQueueItem>();
    for (const item of processQueue) {
      const threadKey = item.storedEmail.thread_id || item.storedEmail.message_id;
      const existing = _threadSeen.get(threadKey);
      if (!existing || new Date(item.storedEmail.received_at) > new Date(existing.storedEmail.received_at)) {
        _threadSeen.set(threadKey, item);
      }
    }
    const _dedupedQueue = Array.from(_threadSeen.values());
    if (_dedupedQueue.length < processQueue.length) {
      console.log(`[Sync] Deduped processQueue: ${_dedupedQueue.length} threads (was ${processQueue.length} items)`);
    }

    // === Phase 2: Parallel AI processing — 5 process-class emails at a time ===
    if (_dedupedQueue.length > 0) {
      console.log(`\n[Sync] Phase 2: AI processing ${_dedupedQueue.length} process-class email(s) in parallel batches of 5`);
    }
    const _PARALLEL_BATCH = 5;
    for (let _bi = 0; _bi < _dedupedQueue.length; _bi += _PARALLEL_BATCH) {
      const _batch = _dedupedQueue.slice(_bi, _bi + _PARALLEL_BATCH);
      const _batchResults = await Promise.allSettled(_batch.map(async (qItem) => {
        const _batchResult = { inboxItemsCreated: 0, errors: [] as string[] };
        const { parsed, storedEmail, processedAttachments, calendarEventId, hasCalendarInvite, isForwarded } = qItem;

        // orgUsers — use pre-hoisted values (avoids redundant DB queries per email)
        const orgUsers = _orgUsers;

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

          // Check if inbox item already exists for this thread + user (any status)
          const { data: existingInboxItem } = await adminSupabase
            .from('inbox_items')
            .select('id, status')
            .eq('user_id', recipient.userId)
            .eq('source', 'email')
            .eq('source_data->>thread_id', storedEmail.thread_id || storedEmail.message_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // If already completed (e.g. user RSVPed or dismissed), don't re-surface it
          if (existingInboxItem && existingInboxItem.status !== 'pending') {
            console.log(`       ⏭️  Skipping thread — item already ${existingInboxItem.status}`);
            continue;
          }

          // For calendar invite emails (including updates and past events), if the user
          // already responded to an invite with the same meeting title, skip re-creating.
          // Covers: same-thread updates, cross-thread updates, and past events where
          // calendarEventId is null (past events fall outside the sync window).
          if (!existingInboxItem && hasCalendarInvite && storedEmail.subject) {
            // Normalize subject: strip invite prefixes to extract the meeting title
            const inviteTitleMatch = storedEmail.subject.match(
              /^(?:Convite|Invitation|Updated invitation|Convite atualizado|Invite|Convidado|Actualizado)[:\s]+(.+?)(?:\s*@\s*|\s*-\s*(?:dom|seg|ter|qua|qui|sex|sáb|sun|mon|tue|wed|thu|fri|sat|\d).*)?$/i
            );
            const meetingTitle = inviteTitleMatch ? inviteTitleMatch[1].trim() : null;

            // Check by calendar_event_id if available (future events)
            const calIdCheck = calendarEventId
              ? adminSupabase
                  .from('inbox_items')
                  .select('id, status')
                  .eq('user_id', recipient.userId)
                  .eq('source_data->>calendar_event_id', calendarEventId)
                  .neq('status', 'pending')
                  .limit(1)
                  .maybeSingle()
              : Promise.resolve({ data: null });

            // Check by meeting title extracted from subject (past events / cross-thread)
            const titleCheck = meetingTitle
              ? adminSupabase
                  .from('inbox_items')
                  .select('id, status')
                  .eq('user_id', recipient.userId)
                  .eq('item_type', 'meeting')
                  .neq('status', 'pending')
                  .ilike('source_data->>subject', `%${meetingTitle}%`)
                  .limit(1)
                  .maybeSingle()
              : Promise.resolve({ data: null });

            const [{ data: completedByCalId }, { data: completedByTitle }] = await Promise.all([calIdCheck, titleCheck]);
            const completedCalItem = completedByCalId ?? completedByTitle;

            if (completedCalItem) {
              console.log(`       ⏭️  Skipping calendar invite — event already ${completedCalItem.status}`);
              continue;
            }
          }

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

            // Update existing inbox item with recipient context
            const { error: updateError } = await adminSupabase
              .from('inbox_items')
              .update(stripNulls({
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
                    message_id: e.message_id,
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
              }) as Record<string, unknown>)
              .eq('id', existingInboxItem.id);

            if (updateError) {
              console.error('       ✗ Error updating inbox item:', updateError);
              _batchResult.errors.push(`Failed to update inbox item: ${updateError.message}`);
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

          // Create inbox item for this recipient
          const { data: newInboxItem, error: inboxError } = await adminSupabase
            .from('inbox_items')
            .insert(stripNulls({
              user_id: recipient.userId,
              connection_id: connection.id,
              source: 'email',
              source_id: storedEmail.id,

              // Work-state model (from recipient analysis)
              // Cap at 'noted' when role is irrelevant — user is CC'd so item should be
              // visible but low-priority, not treated as noise
              work_state: recipient.detectedRole === 'irrelevant' ? 'noted' : recipient.inferredWorkState,
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
                  message_id: e.message_id,
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

              // Legacy fields
              ai_suggestion_type: recipient.inferredWorkState,
              ai_suggestion_content: processed.summary,
              ai_suggestion_reasoning: recipient.reasoning,
              confidence_score: Math.round(recipient.responsibilityConfidence * 100),
              priority: processed.priority,
              is_read: deriveIsRead(storedEmail),
              status: 'pending',
              needs_review: true,
            }) as Record<string, unknown>)
            .select('id')
            .single();

          if (inboxError) {
            console.error(`       ✗ Error creating inbox item:`, inboxError);
            _batchResult.errors.push(`Failed to create inbox item: ${inboxError.message}`);
          } else {
            _batchResult.inboxItemsCreated++;
            console.log(`       ✓ Created inbox item (${recipient.inferredWorkState})`);
          }
        } // End recipient loop

        return _batchResult;
      })); // End async map

      // Accumulate parallel batch results
      for (const _r of _batchResults) {
        if (_r.status === 'fulfilled') {
          result.inboxItemsCreated += _r.value.inboxItemsCreated;
          result.errors.push(..._r.value.errors);
        } else {
          console.error('[Sync] Batch email processing error:', _r.reason);
          result.errors.push(`Batch processing error: ${_r.reason instanceof Error ? _r.reason.message : 'Unknown'}`);
        }
      }
    } // End Phase 2 batch loop

    // === Phase 3: Contact graph population (non-fatal) ===
    try {
      const { upsertContacts } = await import('@/lib/contacts/extract-contacts')
      const _userEmail = connection.metadata?.email || connection.provider_account_id || ''
      const _emailRows = processQueue.map(q => ({
        from_address: q.storedEmail.from_address,
        from_name: q.storedEmail.from_name ?? null,
        to_addresses: q.storedEmail.to_addresses ?? null,
        cc_addresses: q.storedEmail.cc_addresses ?? null,
        received_at: q.storedEmail.received_at ?? null,
      }))
      await upsertContacts({ userId: connection.user_id, userEmail: _userEmail, emails: _emailRows, adminSupabase })
      console.log(`[Contacts] Updated relationship_graph from ${_emailRows.length} email(s)`)
    } catch (_contactErr) {
      console.warn('[Contacts] Non-fatal: failed to update relationship_graph', _contactErr)
    }

    // === Phase 4: Sync sent emails (store for thread context, no inbox_item) ===
    console.log(`[SentSync] Starting sent email sync for ${connection.provider}...`);
    try {
      const encryptedTokensForSent = connection.metadata.tokens;
      const sentWindow = options.syncWindowDays || connection.metadata.sync_window_days || 7;
      let sentMessages: any[] = [];

      if (connection.provider === 'gmail') {
        const onGmailRefresh = async (newTokens: string) => {
          await adminSupabase.from('connections').update({ metadata: { ...connection.metadata, tokens: newTokens } }).eq('id', connection.id);
        };
        // Always use the full window (not last_sync) — sent emails are lightweight (max 25)
        // and this ensures attachment metadata gets backfilled on existing rows
        const raw = await fetchGmailSentEmails(encryptedTokensForSent, 25, sentWindow, onGmailRefresh);
        sentMessages = raw.map(m => parseGmailMessage(m));
      } else if (connection.provider === 'outlook') {
        const onOutlookRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
          const enc = Buffer.from(JSON.stringify(newTokens)).toString('base64');
          await adminSupabase.from('connections').update({ metadata: { ...connection.metadata, tokens: enc } }).eq('id', connection.id);
        };
        const raw = await fetchOutlookSentEmails(encryptedTokensForSent, 25, sentWindow, onOutlookRefresh);
        sentMessages = raw.map(m => parseOutlookMessage(m));
      }

      if (sentMessages.length > 0) {
        const userEmail = connection.metadata?.email || connection.provider_account_id;
        const sentRows = sentMessages.map(m => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { attachments, hasAttachments: _ha, outlookInternalId: _oid, ...dbFields } = m as any;
          // Store attachment metadata (filenames/sizes) without downloading content
          const attachmentMeta = Array.isArray(attachments) && attachments.length > 0
            ? attachments.map((a: any) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size ?? null }))
            : undefined;
          return stripNulls({
            user_id: connection.user_id,
            connection_id: connection.id,
            ...dbFields,
            html_body: (m as any).html_body?.slice(0, 15000) || null,
            is_from_user: true,
            is_read: true,
            metadata: attachmentMeta ? { attachments: attachmentMeta } : undefined,
          }) as Record<string, unknown>;
        }).filter(r => r.message_id); // must have a message_id for upsert

        const { error: sentErr } = await adminSupabase
          .from('emails')
          .upsert(sentRows, { onConflict: 'message_id', ignoreDuplicates: false });
        if (sentErr) {
          console.warn(`[SentSync] Upsert error:`, sentErr.message);
        } else {
          console.log(`[SentSync] Upserted ${sentRows.length} sent email(s) for thread context`);
        }
      }
    } catch (sentErr) {
      console.warn(`[SentSync] Non-fatal: failed to sync sent emails`, sentErr);
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
