import { SupabaseClient } from '@supabase/supabase-js';
import { getGraphClient } from './outlook';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const OUTLOOK_WEBHOOK_SECRET = process.env.OUTLOOK_WEBHOOK_SECRET!;

/**
 * Register a Microsoft Graph change notification subscription for inbox messages.
 * Stores subscriptionId + expiry in the DB.
 */
export async function registerOutlookSubscription(
  connection: { id: string; metadata: { tokens: string; email?: string } },
  adminSupabase: SupabaseClient,
): Promise<void> {
  if (!OUTLOOK_WEBHOOK_SECRET) {
    console.warn('[OutlookSub] OUTLOOK_WEBHOOK_SECRET not set — skipping subscription registration');
    return;
  }

  const client = await getGraphClient(connection.metadata.tokens);

  // Max expiry for mail subscriptions is 3 days (4230 minutes per MS docs)
  const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const subscription = await client.api('/subscriptions').post({
    changeType: 'created',
    notificationUrl: `${APP_URL}/api/webhooks/outlook/push`,
    resource: 'me/mailFolders/inbox/messages',
    expirationDateTime,
    clientState: OUTLOOK_WEBHOOK_SECRET,
  });

  await adminSupabase
    .from('connections')
    .update({
      push_subscription_id: subscription.id,
      push_expires_at: expirationDateTime,
    })
    .eq('id', connection.id);

  console.log(`[OutlookSub] Registered subscription ${subscription.id} for connection ${connection.id}, expires=${expirationDateTime}`);
}

/**
 * Renew an existing Outlook Graph subscription by PATCH-ing a new expirationDateTime.
 */
export async function renewOutlookSubscription(
  connection: { id: string; push_subscription_id: string | null; metadata: { tokens: string } },
  adminSupabase: SupabaseClient,
): Promise<void> {
  if (!connection.push_subscription_id) {
    // No existing subscription — register fresh
    return registerOutlookSubscription(connection, adminSupabase);
  }

  const client = await getGraphClient(connection.metadata.tokens);
  const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await client.api(`/subscriptions/${connection.push_subscription_id}`).patch({ expirationDateTime });

    await adminSupabase
      .from('connections')
      .update({ push_expires_at: expirationDateTime })
      .eq('id', connection.id);

    console.log(`[OutlookSub] Renewed subscription ${connection.push_subscription_id} for connection ${connection.id}`);
  } catch (err: any) {
    // Subscription may have expired and been deleted — register a new one
    if (err?.statusCode === 404) {
      console.warn(`[OutlookSub] Subscription ${connection.push_subscription_id} not found — re-registering`);
      return registerOutlookSubscription(connection, adminSupabase);
    }
    throw err;
  }
}
