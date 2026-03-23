/**
 * POST /api/email/fetch-batch
 *
 * Thin route for Hetzner backfill worker: fetch a batch of raw parsed emails
 * for a connection without running any AI. Handles OAuth token refresh in TS.
 *
 * Auth: Bearer BOT_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchUnreadEmails as fetchGmailEmails, parseGmailMessage } from '@/lib/google/gmail';
import { fetchUnreadEmails as fetchOutlookEmails, parseOutlookMessage } from '@/lib/microsoft/outlook';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { connectionId, userId, offset = 0, limit = 25 } = await request.json();

  if (!connectionId || !userId) {
    return NextResponse.json({ error: 'connectionId and userId required' }, { status: 400 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: connection } = await adminSupabase
    .from('connections')
    .select('*')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  const encryptedTokens = connection.metadata.tokens;
  // Use a very long sync window for backfill (2 years)
  const syncWindowDays = 730;

  try {
    let parsedEmails: any[] = [];

    if (connection.provider === 'gmail') {
      const onGmailTokenRefresh = async (newEncryptedTokens: string) => {
        await adminSupabase
          .from('connections')
          .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
          .eq('id', connection.id);
      };
      // Fetch limit+offset messages, then slice the offset window
      // Note: Gmail API doesn't support offset natively; we fetch offset+limit and slice
      const messages = await fetchGmailEmails(
        encryptedTokens,
        offset + limit,
        syncWindowDays,
        connection.metadata?.email,
        onGmailTokenRefresh,
      );
      const batch = messages.slice(offset, offset + limit);
      parsedEmails = batch.map(m => parseGmailMessage(m));
    } else if (connection.provider === 'outlook') {
      const onTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
        const newEncryptedTokens = Buffer.from(JSON.stringify(newTokens)).toString('base64');
        await adminSupabase
          .from('connections')
          .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
          .eq('id', connection.id);
      };
      const messages = await fetchOutlookEmails(encryptedTokens, offset + limit, syncWindowDays, onTokenRefresh);
      const batch = messages.slice(offset, offset + limit);
      parsedEmails = batch.map(m => parseOutlookMessage(m));
    } else {
      return NextResponse.json({ error: `Unknown provider: ${connection.provider}` }, { status: 400 });
    }

    return NextResponse.json({ emails: parsedEmails, provider: connection.provider });
  } catch (err) {
    console.error('[FetchBatch] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
