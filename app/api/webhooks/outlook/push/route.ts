import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getGraphClient, parseOutlookMessage } from '@/lib/microsoft/outlook';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';

export const maxDuration = 60;

const OUTLOOK_WEBHOOK_SECRET = process.env.OUTLOOK_WEBHOOK_SECRET!;

/**
 * GET /api/webhooks/outlook/push
 *
 * Microsoft Graph validation handshake — must respond within 10s with validationToken.
 * No DB calls before this response.
 */
export async function GET(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

/**
 * POST /api/webhooks/outlook/push
 *
 * Receives change notifications from Microsoft Graph when new emails arrive.
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const notifications: any[] = body?.value || [];
  if (notifications.length === 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Validate clientState on all notifications
  const validNotifications = notifications.filter(
    (n) => n.clientState === OUTLOOK_WEBHOOK_SECRET,
  );
  if (validNotifications.length === 0) {
    console.warn('[OutlookPush] No notifications passed clientState validation');
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  for (const notification of validNotifications) {
    try {
      const resourceData = notification.resourceData;
      const messageId = resourceData?.id;
      if (!messageId) continue;

      // The subscription is per-user; use subscriptionId to find the connection
      const subscriptionId = notification.subscriptionId;
      const { data: connection } = await adminSupabase
        .from('connections')
        .select('*')
        .eq('provider', 'outlook')
        .eq('push_subscription_id', subscriptionId)
        .eq('status', 'active')
        .maybeSingle();

      if (!connection) {
        console.warn(`[OutlookPush] No connection found for subscriptionId ${subscriptionId}`);
        continue;
      }

      const onTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
        const newEncryptedTokens = Buffer.from(JSON.stringify(newTokens)).toString('base64');
        await adminSupabase
          .from('connections')
          .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
          .eq('id', connection.id);
      };

      const client = await getGraphClient(connection.metadata.tokens, onTokenRefresh);

      // Fetch full message
      const message = await client
        .api(`/me/messages/${messageId}`)
        .select('id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,hasAttachments')
        .get();

      await syncEmailsForConnection(connection, adminSupabase, {
        preloadedMessages: [message],
      });

      console.log(`[OutlookPush] ✓ Processed notification for message ${messageId}`);
    } catch (err) {
      console.error('[OutlookPush] Error processing notification:', err);
      // Continue to next notification
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
