import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';

export const maxDuration = 300;

/**
 * GET /api/cron/fetch-emails
 *
 * Periodic fallback sweep for all active email connections.
 * Catches emails that were missed by the push webhook (expired watch, historyId gaps,
 * Vercel timeouts, Pub/Sub delivery failures).
 *
 * Runs every 4 hours. The push webhook handles real-time delivery; this is the safety net.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: connections, error } = await adminSupabase
    .from('connections')
    .select('*')
    .in('provider', ['gmail', 'outlook'])
    .eq('status', 'active');

  if (error) {
    console.error('[FetchEmailsCron] Failed to load connections:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!connections || connections.length === 0) {
    return NextResponse.json({ synced: 0 });
  }

  console.log(`[FetchEmailsCron] Sweeping ${connections.length} active connection(s)`);

  const results = await Promise.allSettled(
    connections.map(async (connection) => {
      try {
        const result = await syncEmailsForConnection(connection, adminSupabase, {
          // Use a 3-day window — enough to catch gaps from push failures without
          // re-processing old emails that are already in the DB (sync deduplicates by message_id).
          syncWindowDays: 3,
        });
        console.log(`[FetchEmailsCron] ✓ ${connection.provider} ${connection.id}: ${result.emailsFetched} fetched, ${result.inboxItemsCreated} created`);
        return result;
      } catch (err) {
        console.error(`[FetchEmailsCron] ✗ ${connection.provider} ${connection.id}:`, err);
        throw err;
      }
    }),
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  const totalFetched = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.emailsFetched : 0), 0);
  const totalCreated = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.inboxItemsCreated : 0), 0);

  console.log(`[FetchEmailsCron] Done — ${succeeded} ok, ${failed} failed, ${totalFetched} emails fetched, ${totalCreated} items created`);

  return NextResponse.json({ succeeded, failed, totalFetched, totalCreated });
}
