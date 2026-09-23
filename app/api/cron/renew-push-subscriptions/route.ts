import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { registerGmailWatch, renewGmailWatch } from '@/lib/google/gmail-watch';
import { registerOutlookSubscription, renewOutlookSubscription } from '@/lib/microsoft/outlook-subscriptions';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { pushShapeStale } from '@/lib/email-sync/push-shape';

/** W9.2 — connections registered with an older push shape (INBOX-only) are re-registered here, at
 *  most this many per run (the renew budget is 60s); the rest are REPORTED as leftBehind and taken by
 *  the next run (no silent caps). `scripts/rewatch-sent.ts` does the same on demand, dry-run default. */
const SHAPE_MIGRATION_PER_RUN = 25;

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!hasBearer(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Find connections whose push subscription expires within the next 24 hours
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const [{ data: expiringConnections, error }, { data: unregisteredGmail }, { data: unregisteredOutlook }] =
    await Promise.all([
      // Expiring soon — renew
      adminSupabase
        .from('connections')
        .select('*')
        .lte('push_expires_at', cutoff)
        .not('push_expires_at', 'is', null)
        .eq('status', 'active'),
      // Gmail never registered (push_history_id IS NULL)
      adminSupabase
        .from('connections')
        .select('*')
        .eq('provider', 'gmail')
        .eq('status', 'active')
        .is('push_history_id', null),
      // Outlook never registered (push_subscription_id IS NULL)
      adminSupabase
        .from('connections')
        .select('*')
        .eq('provider', 'outlook')
        .eq('status', 'active')
        .is('push_subscription_id', null),
    ]);

  if (error) {
    console.error('[RenewPush] Error fetching connections:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // W9.2 THE PUSH SHAPE — registered connections whose stamp is not the current shape (INBOX-only
  // watches from before Sent was covered). Full listing through fetchAllRows (house rule 7).
  const registered = await fetchAllRows<any>((from, to) => adminSupabase
    .from('connections')
    .select('*')
    .in('provider', ['gmail', 'outlook'])
    .eq('status', 'active')
    .not('push_expires_at', 'is', null)
    .order('id', { ascending: true })
    .range(from, to));
  const shapeStale = registered.filter((c) => pushShapeStale(c));

  // Deduplicate — a connection could appear in both expiring + unregistered lists
  const seen = new Set<string>();
  const toRenew: { connection: any; isNew: boolean }[] = [];
  for (const c of expiringConnections ?? []) {
    if (!seen.has(c.id)) { seen.add(c.id); toRenew.push({ connection: c, isNew: false }); }
  }
  for (const c of [...(unregisteredGmail ?? []), ...(unregisteredOutlook ?? [])]) {
    if (!seen.has(c.id)) { seen.add(c.id); toRenew.push({ connection: c, isNew: true }); }
  }

  let shapeQueued = 0;
  for (const c of shapeStale) {
    if (seen.has(c.id)) continue; // already renewed above — renewal re-registers to the current shape
    if (shapeQueued >= SHAPE_MIGRATION_PER_RUN) continue;
    seen.add(c.id); toRenew.push({ connection: c, isNew: false }); shapeQueued++;
  }
  const shapeLeftBehind = shapeStale.filter((c) => !seen.has(c.id)).length;
  if (shapeLeftBehind) console.log(`[RenewPush] push-shape migration: ${shapeLeftBehind} connection(s) left for the next run`);

  const results: { id: string; provider: string; ok: boolean; new?: boolean; error?: string }[] = [];

  for (const { connection, isNew } of toRenew) {
    try {
      if (connection.provider === 'gmail') {
        isNew
          ? await registerGmailWatch(connection, adminSupabase)
          : await renewGmailWatch(connection, adminSupabase);
      } else if (connection.provider === 'outlook') {
        isNew
          ? await registerOutlookSubscription(connection, adminSupabase)
          : await renewOutlookSubscription(connection, adminSupabase);
      }
      results.push({ id: connection.id, provider: connection.provider, ok: true, new: isNew });
      console.log(`[RenewPush] ✓ ${isNew ? 'Registered' : 'Renewed'} ${connection.provider} subscription for connection ${connection.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: connection.id, provider: connection.provider, ok: false, new: isNew, error: msg });
      console.error(`[RenewPush] ✗ Failed to ${isNew ? 'register' : 'renew'} connection ${connection.id}:`, err);
    }
  }

  return NextResponse.json({ renewed: results.length, results, shapeMigration: { queued: shapeQueued, leftBehind: shapeLeftBehind } });
}
