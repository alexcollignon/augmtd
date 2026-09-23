import { SupabaseClient } from '@supabase/supabase-js';
import { getGmailClient } from './gmail';
import {
  GMAIL_WATCH_LABEL_IDS, GMAIL_WATCH_FILTER_BEHAVIOR, PUSH_WATCH_SHAPE, mergeConnectionMetadata,
} from '@/lib/email-sync/push-shape';

const GMAIL_PUBSUB_TOPIC = process.env.GMAIL_PUBSUB_TOPIC!;

/**
 * Register a Gmail push watch for a connection (INBOX + SENT — W9.2).
 * Stores historyId + expiry (7 days from now) + the push shape stamp in the DB.
 */
export async function registerGmailWatch(
  connection: { id: string; metadata: { tokens: string; email?: string } },
  adminSupabase: SupabaseClient,
): Promise<void> {
  if (!GMAIL_PUBSUB_TOPIC) {
    console.warn('[GmailWatch] GMAIL_PUBSUB_TOPIC not set — skipping watch registration');
    return;
  }

  const gmail = await getGmailClient(connection.metadata.tokens);

  const { data: watchResponse } = await gmail.users.watch({
    userId: 'me',
    // W9.2 — THE PUSH SHAPE (lib/email-sync/push-shape.ts): arrivals AND the user's own sends.
    requestBody: {
      topicName: GMAIL_PUBSUB_TOPIC,
      labelIds: [...GMAIL_WATCH_LABEL_IDS],
      labelFilterBehavior: GMAIL_WATCH_FILTER_BEHAVIOR,
    },
  });

  if (!watchResponse?.historyId) {
    throw new Error('[GmailWatch] watch response missing historyId');
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await adminSupabase
    .from('connections')
    .update({
      push_history_id: String(watchResponse.historyId),
      push_expires_at: expiresAt,
    })
    .eq('id', connection.id);
  if (error) throw new Error(`[GmailWatch] connection update failed: ${error.message}`);
  await mergeConnectionMetadata(adminSupabase, connection.id, { push_watch_shape: PUSH_WATCH_SHAPE });

  console.log(`[GmailWatch] Registered watch for connection ${connection.id}, historyId=${watchResponse.historyId}, expires=${expiresAt}`);
}

/**
 * Renew an existing Gmail push watch. users.watch REPLACES the mailbox's watch, so renewing is also
 * the migration to the current shape (idempotent) — the stamp is written after it succeeds.
 * Extends the subscription expiry but preserves the existing push_history_id so no
 * messages fall through the gap between the old and new watch historyIds.
 */
export async function renewGmailWatch(
  connection: { id: string; metadata: { tokens: string; email?: string }; push_history_id?: string | null },
  adminSupabase: SupabaseClient,
): Promise<void> {
  if (!GMAIL_PUBSUB_TOPIC) {
    console.warn('[GmailWatch] GMAIL_PUBSUB_TOPIC not set — skipping watch renewal');
    return;
  }

  const gmail = await getGmailClient(connection.metadata.tokens);

  const { data: watchResponse } = await gmail.users.watch({
    userId: 'me',
    // W9.2 — THE PUSH SHAPE (lib/email-sync/push-shape.ts): arrivals AND the user's own sends.
    requestBody: {
      topicName: GMAIL_PUBSUB_TOPIC,
      labelIds: [...GMAIL_WATCH_LABEL_IDS],
      labelFilterBehavior: GMAIL_WATCH_FILTER_BEHAVIOR,
    },
  });

  if (!watchResponse?.historyId) {
    throw new Error('[GmailWatch] watch response missing historyId');
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Preserve existing push_history_id so the next push notification continues
  // from the last-processed position, not from the new watch's historyId.
  // Only fall back to the new historyId if none was stored (shouldn't happen on renewal path).
  const updatePayload: Record<string, string> = { push_expires_at: expiresAt };
  if (!connection.push_history_id) {
    updatePayload.push_history_id = String(watchResponse.historyId);
  }

  const { error } = await adminSupabase
    .from('connections')
    .update(updatePayload)
    .eq('id', connection.id);
  if (error) throw new Error(`[GmailWatch] connection update failed: ${error.message}`);
  await mergeConnectionMetadata(adminSupabase, connection.id, { push_watch_shape: PUSH_WATCH_SHAPE });

  console.log(`[GmailWatch] Renewed watch for connection ${connection.id}, expires=${expiresAt}, historyId preserved=${!!connection.push_history_id}`);
}
