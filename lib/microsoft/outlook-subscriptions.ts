import { SupabaseClient } from '@supabase/supabase-js';
import { getGraphClient } from './outlook';
import {
  OUTLOOK_INBOX_RESOURCE, OUTLOOK_SENT_RESOURCE, PUSH_WATCH_SHAPE, mergeConnectionMetadata,
} from '@/lib/email-sync/push-shape';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const OUTLOOK_WEBHOOK_SECRET = process.env.OUTLOOK_WEBHOOK_SECRET!;

type OutlookConn = {
  id: string;
  metadata: { tokens: string; email?: string; push_sent_subscription_id?: string | null };
  push_subscription_id?: string | null;
};

// Max expiry for mail subscriptions is 3 days (4230 minutes per MS docs)
const expiry = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

async function createSubscription(client: Awaited<ReturnType<typeof getGraphClient>>, resource: string, expirationDateTime: string) {
  return client.api('/subscriptions').post({
    changeType: 'created',
    notificationUrl: `${APP_URL}/api/webhooks/outlook/push`,
    resource,
    expirationDateTime,
    clientState: OUTLOOK_WEBHOOK_SECRET,
  });
}

/**
 * W9.2 — the Sent Items subscription (THE PUSH SHAPE, lib/email-sync/push-shape.ts). A mail the user
 * sends from Outlook directly lands in Sent Items and pushes like an arrival, so the thread it answers
 * closes within seconds. Renews the stored one (PATCH expiry) or creates it; the id rides in
 * connections.metadata.push_sent_subscription_id (the inbox id keeps the historical column).
 */
async function ensureSentSubscription(
  connection: OutlookConn,
  client: Awaited<ReturnType<typeof getGraphClient>>,
  adminSupabase: SupabaseClient,
  expirationDateTime: string,
): Promise<void> {
  const existing = connection.metadata?.push_sent_subscription_id ?? null;
  if (existing) {
    try {
      await client.api(`/subscriptions/${existing}`).patch({ expirationDateTime });
      return;
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
      console.warn(`[OutlookSub] Sent subscription ${existing} not found — re-registering`);
    }
  }
  const sub = await createSubscription(client, OUTLOOK_SENT_RESOURCE, expirationDateTime);
  await mergeConnectionMetadata(adminSupabase, connection.id, { push_sent_subscription_id: sub.id });
  console.log(`[OutlookSub] Registered Sent subscription ${sub.id} for connection ${connection.id}`);
}

/**
 * Register Microsoft Graph change notification subscriptions for inbox AND Sent Items messages.
 * Stores the inbox subscriptionId + expiry in the DB; the Sent id + the push shape stamp in metadata.
 */
export async function registerOutlookSubscription(
  connection: OutlookConn,
  adminSupabase: SupabaseClient,
): Promise<void> {
  if (!OUTLOOK_WEBHOOK_SECRET) {
    console.warn('[OutlookSub] OUTLOOK_WEBHOOK_SECRET not set — skipping subscription registration');
    return;
  }

  const client = await getGraphClient(connection.metadata.tokens);
  const expirationDateTime = expiry();

  const subscription = await createSubscription(client, OUTLOOK_INBOX_RESOURCE, expirationDateTime);

  const { error } = await adminSupabase
    .from('connections')
    .update({
      push_subscription_id: subscription.id,
      push_expires_at: expirationDateTime,
    })
    .eq('id', connection.id);
  if (error) throw new Error(`[OutlookSub] connection update failed: ${error.message}`);

  console.log(`[OutlookSub] Registered subscription ${subscription.id} for connection ${connection.id}, expires=${expirationDateTime}`);

  await ensureSentSubscription(connection, client, adminSupabase, expirationDateTime);
  await mergeConnectionMetadata(adminSupabase, connection.id, { push_watch_shape: PUSH_WATCH_SHAPE });
}

/**
 * Renew existing Outlook Graph subscriptions by PATCH-ing a new expirationDateTime (inbox + Sent).
 * A connection registered before W9.2 has no Sent subscription — renewal ADDS it (a subscription's
 * resource cannot be patched), which is the migration; idempotent (a stored Sent id is only renewed).
 */
export async function renewOutlookSubscription(
  connection: OutlookConn,
  adminSupabase: SupabaseClient,
): Promise<void> {
  if (!connection.push_subscription_id) {
    // No existing subscription — register fresh
    return registerOutlookSubscription(connection, adminSupabase);
  }

  const client = await getGraphClient(connection.metadata.tokens);
  const expirationDateTime = expiry();

  try {
    await client.api(`/subscriptions/${connection.push_subscription_id}`).patch({ expirationDateTime });

    const { error } = await adminSupabase
      .from('connections')
      .update({ push_expires_at: expirationDateTime })
      .eq('id', connection.id);
    if (error) throw new Error(`[OutlookSub] connection update failed: ${error.message}`);

    console.log(`[OutlookSub] Renewed subscription ${connection.push_subscription_id} for connection ${connection.id}`);
  } catch (err: any) {
    // Subscription may have expired and been deleted — register a new one
    if (err?.statusCode === 404) {
      console.warn(`[OutlookSub] Subscription ${connection.push_subscription_id} not found — re-registering`);
      return registerOutlookSubscription(connection, adminSupabase);
    }
    throw err;
  }

  await ensureSentSubscription(connection, client, adminSupabase, expirationDateTime);
  await mergeConnectionMetadata(adminSupabase, connection.id, { push_watch_shape: PUSH_WATCH_SHAPE });
}
