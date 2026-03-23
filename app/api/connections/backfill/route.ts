/**
 * POST /api/connections/backfill
 *
 * Trigger historical email backfill for a connection.
 * Delegates async processing to Hetzner when MEETING_BOT_SERVICE_URL is set.
 * Falls back to synchronous sync (limited) if not configured.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';

export const maxDuration = 30;

const BACKFILL_MAX_EMAILS = parseInt(process.env.BACKFILL_MAX_EMAILS || '500', 10);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { connectionId, maxEmails } = await request.json();
  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
  }

  const cap = Math.min(maxEmails || BACKFILL_MAX_EMAILS, BACKFILL_MAX_EMAILS);

  const adminSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Verify the connection belongs to this user
  const { data: connection } = await adminSupabase
    .from('connections')
    .select('*')
    .eq('id', connectionId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  // Mark backfill as running
  await adminSupabase
    .from('connections')
    .update({
      backfill_status: 'running',
      backfill_started_at: new Date().toISOString(),
      backfill_emails_total: cap,
      backfill_emails_done: 0,
    })
    .eq('id', connectionId);

  const botServiceUrl = process.env.MEETING_BOT_SERVICE_URL;

  if (botServiceUrl) {
    // Delegate to Hetzner — fire-and-forget, return 202 immediately
    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
    fetch(`${botServiceUrl}/email-backfill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BOT_SECRET}`,
      },
      body: JSON.stringify({
        connectionId,
        userId: user.id,
        maxEmails: cap,
        appUrl,
      }),
    }).catch(err => {
      console.error('[Backfill] Failed to reach Hetzner:', err);
    });

    return NextResponse.json({ status: 'queued', maxEmails: cap }, { status: 202 });
  }

  // Fallback: run synchronously (limited window)
  try {
    const result = await syncEmailsForConnection(connection, adminSupabase, {
      maxEmails: Math.min(cap, 50),
      syncWindowDays: 365,
    });

    await adminSupabase
      .from('connections')
      .update({ backfill_status: 'completed', backfill_emails_done: result.emailsFetched })
      .eq('id', connectionId);

    return NextResponse.json({ status: 'completed', ...result });
  } catch (err) {
    await adminSupabase
      .from('connections')
      .update({ backfill_status: 'failed' })
      .eq('id', connectionId);

    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
