import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export const maxDuration = 800; // Pro+Fluid — pagination can pull a fuller window per run

// SCHEDULE (vercel.json): `*/15 * * * *`

/**
 * GET /api/cron/fetch-emails — runs every 15 minutes (see the SCHEDULE line above).
 *
 * Periodic fallback sweep for all active email connections.
 * Catches emails that were missed by the push webhook (expired watch, historyId gaps,
 * Vercel timeouts, Pub/Sub delivery failures). The push webhook handles real-time delivery;
 * this is the safety net.
 *
 * ── W9.5 THE CLOCKS SAY WHAT THEY DO (invariant 10 NO SILENT CAPS) ──
 * This route used to start EVERY active connection at once (`Promise.allSettled` over the whole
 * list) with no wall-clock guard: at scale one slow mailbox — or simply N of them — ran the function
 * into its 800s kill, the response never came back, and nothing said which mailboxes were skipped.
 * Now, the same discipline as sync-calendar / label-sweep:
 *   • a PAGED, ORDERED read of the live connections (no PostgREST 1000-row cap);
 *   • LEAST-RECENTLY-SYNCED FIRST (`last_sync` ascending, never-synced first) — a budget-cut run
 *     self-balances instead of starving the same tail;
 *   • BOUNDED concurrency (FETCH_CONCURRENCY syncs in flight), no new connection is STARTED after
 *     START_DEADLINE_MS, and the route answers by ROUTE_DEADLINE_MS whatever is still in flight;
 *   • an HONEST report — `leftBehind` (never started; they lead the next run) and `unfinished`
 *     (started, still running at the deadline — the sync dedupes by message id, so a cut run is
 *     simply finished by the next one).
 */
const FETCH_CONCURRENCY = 8;
const START_DEADLINE_MS = 560_000;  // stop STARTING new connections here …
const ROUTE_DEADLINE_MS = 740_000;  // … and answer here, well inside the 800s kill.

type ConnectionRow = { id: string; provider: string; last_sync: string | null } & Record<string, unknown>;

export async function GET(request: NextRequest) {
  if (!hasBearer(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const startDeadline = t0 + START_DEADLINE_MS;
  const routeDeadline = t0 + ROUTE_DEADLINE_MS;

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // The whole connection row travels to syncEmailsForConnection (it reads tokens, metadata,
  // last_sync, provider ids …), so this select stays `*` — the one reader owns the shape.
  let loadError: string | null = null;
  const connections = await fetchAllRows<ConnectionRow>(async (from, to) => {
    const res = await adminSupabase
      .from('connections')
      .select('*')
      .in('provider', ['gmail', 'outlook'])
      .eq('status', 'active')
      .order('last_sync', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (res.error) loadError = res.error.message;
    return res as { data: ConnectionRow[] | null; error: unknown };
  });

  if (loadError) {
    console.error('[FetchEmailsCron] Failed to load connections:', loadError);
    if (!connections.length) return NextResponse.json({ error: loadError }, { status: 500 });
  }

  if (!connections.length) {
    return NextResponse.json({ succeeded: 0, failed: 0, totalFetched: 0, totalCreated: 0, leftBehind: 0, unfinished: 0, activeConnections: 0 });
  }

  console.log(`[FetchEmailsCron] Sweeping ${connections.length} active connection(s), least-recently-synced first`);

  let succeeded = 0, failed = 0, totalFetched = 0, totalCreated = 0, leftBehind = 0, started = 0;
  const queue = [...connections];

  const syncOne = async (connection: ConnectionRow) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the lib's Connection shape; the row is the full `*` select
      const result = await syncEmailsForConnection(connection as any, adminSupabase, {
        // Use a 3-day window — enough to catch gaps from push failures without
        // re-processing old emails that are already in the DB (sync deduplicates by message_id).
        syncWindowDays: 3,
      });
      succeeded++;
      totalFetched += result.emailsFetched;
      totalCreated += result.inboxItemsCreated;
      console.log(`[FetchEmailsCron] ✓ ${connection.provider} ${connection.id}: ${result.emailsFetched} fetched, ${result.inboxItemsCreated} created`);
    } catch (err) {
      failed++;
      console.error(`[FetchEmailsCron] ✗ ${connection.provider} ${connection.id}:`, err);
    }
  };

  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      // THE WALL-CLOCK GUARD: never START a mailbox the route cannot finish; count it instead.
      if (Date.now() > startDeadline) { leftBehind++; continue; }
      started++;
      await syncOne(next);
    }
  };

  const pool = Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, connections.length) }, worker));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<'deadline'>((resolve) => { timer = setTimeout(() => resolve('deadline'), Math.max(0, routeDeadline - Date.now())); });
  const outcome = await Promise.race([pool.then(() => 'done' as const), cutoff]);
  if (timer) clearTimeout(timer);

  // Anything still in the queue when the route answers was never started.
  if (outcome === 'deadline') { leftBehind += queue.length; queue.length = 0; }
  const unfinished = Math.max(0, started - succeeded - failed);

  if (leftBehind > 0 || unfinished > 0) {
    console.log(`[FetchEmailsCron] route budget spent: ${leftBehind} connection(s) never started (they lead the next run, least-recently-synced), ${unfinished} still in flight at the deadline`);
  }
  console.log(`[FetchEmailsCron] Done — ${succeeded} ok, ${failed} failed, ${totalFetched} emails fetched, ${totalCreated} items created`);

  return NextResponse.json({
    succeeded, failed, totalFetched, totalCreated,
    leftBehind, unfinished, activeConnections: connections.length,
    loadError: loadError ?? undefined,
  });
}
