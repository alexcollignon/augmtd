import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renewGmailWatch } from '@/lib/google/gmail-watch';
import { renewOutlookSubscription } from '@/lib/microsoft/outlook-subscriptions';

export const maxDuration = 60;

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

  // Find connections whose push subscription expires within the next 24 hours
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: connections, error } = await adminSupabase
    .from('connections')
    .select('*')
    .lte('push_expires_at', cutoff)
    .not('push_expires_at', 'is', null)
    .eq('status', 'active');

  if (error) {
    console.error('[RenewPush] Error fetching connections:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { id: string; provider: string; ok: boolean; error?: string }[] = [];

  for (const connection of connections ?? []) {
    try {
      if (connection.provider === 'gmail') {
        await renewGmailWatch(connection, adminSupabase);
      } else if (connection.provider === 'outlook') {
        await renewOutlookSubscription(connection, adminSupabase);
      }
      results.push({ id: connection.id, provider: connection.provider, ok: true });
      console.log(`[RenewPush] ✓ Renewed ${connection.provider} subscription for connection ${connection.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: connection.id, provider: connection.provider, ok: false, error: msg });
      console.error(`[RenewPush] ✗ Failed to renew connection ${connection.id}:`, err);
    }
  }

  return NextResponse.json({ renewed: results.length, results });
}
