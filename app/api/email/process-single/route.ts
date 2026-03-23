/**
 * POST /api/email/process-single
 *
 * Thin route for Hetzner backfill worker: run the full AI pipeline for one
 * pre-parsed email (processEmail + analyzeRecipients + DB writes).
 *
 * Auth: Bearer BOT_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { connectionId, userId, parsedEmail } = await request.json();

  if (!connectionId || !userId || !parsedEmail) {
    return NextResponse.json({ error: 'connectionId, userId, and parsedEmail required' }, { status: 400 });
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

  try {
    const result = await syncEmailsForConnection(connection, adminSupabase, {
      preloadedMessages: [parsedEmail],
    });

    return NextResponse.json({
      inboxItemsCreated: result.inboxItemsCreated,
      emailsFetched: result.emailsFetched,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[ProcessSingle] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
