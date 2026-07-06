import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createClient } from '@supabase/supabase-js';
import { getGmailClient } from '@/lib/google/gmail';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';
import { syncCalendarForConnection } from '@/lib/calendar/sync-calendar';
import { createBotsForCalendarEvents } from '@/lib/integrations/meeting-bot/bot-manager';
import { featureEnabledForUser } from '@/lib/workspace/check-by-userid';

export const maxDuration = 300;

const GMAIL_WEBHOOK_SECRET = process.env.GMAIL_WEBHOOK_SECRET!;

/**
 * POST /api/webhooks/gmail/push
 *
 * Receives Pub/Sub push notifications from Google when new emails arrive.
 * Returns 200 immediately to prevent Pub/Sub retry storms, then processes async via waitUntil.
 */
export async function POST(request: NextRequest) {
  // Validate secret token in query param
  const token = request.nextUrl.searchParams.get('token');
  if (!GMAIL_WEBHOOK_SECRET || token !== GMAIL_WEBHOOK_SECRET) {
    console.warn('[GmailPush] Invalid or missing token');
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
  if (!rawData) return NextResponse.json({ ok: true }, { status: 200 });

  let notification: { emailAddress?: string; historyId?: string | number };
  try {
    notification = JSON.parse(Buffer.from(rawData, 'base64').toString());
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const { emailAddress, historyId } = notification;
  if (!emailAddress || !historyId) return NextResponse.json({ ok: true }, { status: 200 });

  // Return 200 immediately — process async so Vercel timeout never blocks Google ACK
  waitUntil(processGmailPush(emailAddress, String(historyId)));
  return NextResponse.json({ ok: true }, { status: 200 });
}

async function processGmailPush(emailAddress: string, historyId: string) {
  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: connection } = await adminSupabase
    .from('connections')
    .select('*')
    .eq('provider', 'gmail')
    .eq('provider_account_id', emailAddress)
    .eq('status', 'active')
    .maybeSingle();

  if (!connection) {
    console.warn(`[GmailPush] No active connection found for ${emailAddress}`);
    return;
  }

  // Workspace feature gate — if email is disabled for this user's workspace,
  // acknowledge and skip (prevents Google retries while honoring feature flags).
  if (!await featureEnabledForUser(adminSupabase, connection.user_id, 'email')) {
    console.log(`[GmailPush] email feature disabled for user ${connection.user_id} — skipping`);
    return;
  }

  const startHistoryId = connection.push_history_id;
  if (!startHistoryId) {
    console.warn(`[GmailPush] Connection ${connection.id} has no push_history_id — updating to current and skipping`);
    await adminSupabase.from('connections').update({ push_history_id: historyId }).eq('id', connection.id);
    return;
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

    // Advance the cursor NOW only when there's nothing to store (safe — nothing to lose). When there ARE
    // messages we advance AFTER they're stored (below) so a failed sync can never skip unstored mail.
    if (messageIds.length === 0) {
      await adminSupabase.from('connections').update({ push_history_id: historyId }).eq('id', connection.id);
      console.log(`[GmailPush] No new messages for ${emailAddress}, historyId advanced to ${historyId}`);
      return;
    }

    console.log(`[GmailPush] Processing ${messageIds.length} message(s) for ${emailAddress} (cap 50, newest first)`);

    // Reverse so newest messages are processed first — if cap is hit, oldest are dropped not newest
    const prioritized = [...messageIds].reverse();

    const fetchedMessages = await Promise.all(
      prioritized.slice(0, 50).map(id =>
        gmail.users.messages.get({ userId: 'me', id, format: 'full' }).then(r => r.data),
      ),
    );

    await syncEmailsForConnection(connection, adminSupabase, {
      preloadedMessages: fetchedMessages,
    });

    // ADVANCE THE CURSOR ONLY AFTER STORAGE SUCCEEDS. If any step above threw (fetch, sync, rate limit,
    // token refresh, a single bad message), push_history_id stays put so the NEXT push — or the periodic
    // sweep — re-fetches this exact range. Emails are never silently dropped by a cursor that moved past
    // unstored mail. Re-fetching is idempotent (sync dedups by message_id). This is the missed-email fix.
    await adminSupabase.from('connections').update({ push_history_id: historyId }).eq('id', connection.id);

    // Sync calendar + schedule bots — catches meeting invitations arriving via email
    await syncCalendarForConnection(connection, adminSupabase, { daysAhead: 14, daysBehind: 0 })
      .then(() => createBotsForCalendarEvents(connection.user_id, adminSupabase))
      .catch((err) => console.warn('[GmailPush] Calendar/bot sync failed (non-fatal):', err));

    console.log(`[GmailPush] ✓ Processed ${fetchedMessages.length} message(s) for ${emailAddress}`);
  } catch (err) {
    console.error(`[GmailPush] Error processing push for ${emailAddress}:`, err);
  }
}
