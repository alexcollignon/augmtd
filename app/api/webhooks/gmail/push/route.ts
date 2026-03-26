import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getGmailClient } from '@/lib/google/gmail';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';
import { syncCalendarForConnection } from '@/lib/calendar/sync-calendar';
import { createBotsForCalendarEvents } from '@/lib/integrations/meeting-bot/bot-manager';

export const maxDuration = 300;

const GMAIL_WEBHOOK_SECRET = process.env.GMAIL_WEBHOOK_SECRET!;

/**
 * POST /api/webhooks/gmail/push
 *
 * Receives Pub/Sub push notifications from Google when new emails arrive.
 * Always returns 200 to prevent Pub/Sub retry storms (processing is idempotent via message_id).
 */
export async function POST(request: NextRequest) {
  // Validate secret token in query param
  const token = request.nextUrl.searchParams.get('token');
  if (!GMAIL_WEBHOOK_SECRET || token !== GMAIL_WEBHOOK_SECRET) {
    console.warn('[GmailPush] Invalid or missing token — returning 200 to prevent retry storm');
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Pub/Sub wraps the message inside body.message.data (base64 encoded)
  const rawData = body?.message?.data;
  if (!rawData) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let notification: { emailAddress?: string; historyId?: string | number };
  try {
    notification = JSON.parse(Buffer.from(rawData, 'base64').toString());
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const { emailAddress, historyId } = notification;
  if (!emailAddress || !historyId) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Look up the active Gmail connection for this email address
  const { data: connection } = await adminSupabase
    .from('connections')
    .select('*')
    .eq('provider', 'gmail')
    .eq('provider_account_id', emailAddress)
    .eq('status', 'active')
    .maybeSingle();

  if (!connection) {
    console.warn(`[GmailPush] No active connection found for ${emailAddress}`);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const startHistoryId = connection.push_history_id;
  if (!startHistoryId) {
    console.warn(`[GmailPush] Connection ${connection.id} has no push_history_id — skipping delta, will be caught by cron`);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const encryptedTokens = connection.metadata.tokens;
    const onGmailTokenRefresh = async (newEncryptedTokens: string) => {
      await adminSupabase
        .from('connections')
        .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
        .eq('id', connection.id);
    };

    const gmail = await getGmailClient(encryptedTokens, onGmailTokenRefresh);

    // Fetch history since last known historyId
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
    });

    const historyList = historyRes.data.history || [];
    const messageIds: string[] = [];
    for (const h of historyList) {
      for (const ma of h.messagesAdded || []) {
        if (ma.message?.id && !messageIds.includes(ma.message.id)) {
          messageIds.push(ma.message.id);
        }
      }
    }

    if (messageIds.length === 0) {
      // Update historyId even if no new messages
      await adminSupabase
        .from('connections')
        .update({ push_history_id: String(historyId) })
        .eq('id', connection.id);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    console.log(`[GmailPush] Fetching ${messageIds.length} new message(s) for ${emailAddress}`);

    // Fetch full messages in parallel (cap at 20 per push event)
    const fetchedMessages = await Promise.all(
      messageIds.slice(0, 20).map(id =>
        gmail.users.messages.get({ userId: 'me', id, format: 'full' }).then(r => r.data),
      ),
    );

    // Run sync with preloaded messages — skips the fetch step
    await syncEmailsForConnection(connection, adminSupabase, {
      preloadedMessages: fetchedMessages,
    });

    // Update historyId to the latest from the push notification
    await adminSupabase
      .from('connections')
      .update({ push_history_id: String(historyId) })
      .eq('id', connection.id);

    // Sync calendar + schedule bots — catches new meeting invitations arriving via email
    await syncCalendarForConnection(connection, adminSupabase, { daysAhead: 14, daysBehind: 0 })
      .then(() => createBotsForCalendarEvents(connection.user_id, adminSupabase))
      .catch((err) => console.warn('[GmailPush] Calendar/bot sync failed (non-fatal):', err));

    console.log(`[GmailPush] ✓ Processed push for ${emailAddress}, updated historyId to ${historyId}`);
  } catch (err) {
    console.error(`[GmailPush] Error processing push for ${emailAddress}:`, err);
    // Still return 200 — Pub/Sub will not retry, and cron will catch any missed emails
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
