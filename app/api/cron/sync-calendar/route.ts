import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { syncCalendarForConnection } from '@/lib/calendar/sync-calendar';
import { processMeetingsForUser } from '@/lib/calendar/meeting-processor';
import { analyzeCalendarPatterns } from '@/lib/calendar/pattern-analyzer';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export const maxDuration = 300; // 5 minutes

const CALENDAR_SYNCED_AT_KEY = 'calendar_synced_at'; // mirrors lib/calendar/sync-calendar.ts SYNCED_AT_KEY

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel Cron sends this header)
    if (!hasBearer(request, 'CRON_SECRET')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[SyncCalendar] Starting calendar sync cron job...');

    // Use service role to bypass RLS
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // THE COVERAGE REPAIR, applied here too (stabilization W4.3): a paged, ORDERED read (no silent
    // PostgREST 1000-row cap — invariant 10) instead of a bare `.select('*')`.
    const allConnections = await fetchAllRows<{
      id: string; user_id: string; provider: string; status: string; provider_account_id: string;
      metadata: Record<string, unknown> | null;
    }>((from, to) => supabase
      .from('connections')
      .select('id, user_id, provider, status, provider_account_id, metadata')
      .in('provider', ['gmail', 'outlook'])
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, to));

    if (!allConnections.length) {
      console.log('[SyncCalendar] No active connections found');
      return NextResponse.json({
        success: true,
        message: 'No connections to process',
        processed: 0,
      });
    }

    // LEAST-RECENTLY-SYNCED FIRST (the same self-balancing rotation as draft-sweep/label-sweep,
    // read off this route's own stamp — `metadata.calendar_synced_at` — rather than a shared
    // item_plans marker, since calendar sync is per-CONNECTION, not per-user). Never-synced
    // connections (no stamp) lead by construction.
    const connections = [...allConnections].sort((a, b) => {
      const at = String((a.metadata as Record<string, unknown> | null)?.[CALENDAR_SYNCED_AT_KEY] ?? '');
      const bt = String((b.metadata as Record<string, unknown> | null)?.[CALENDAR_SYNCED_AT_KEY] ?? '');
      return at.localeCompare(bt);
    });

    console.log(`[SyncCalendar] Found ${connections.length} active connections`);

    // ── THE COVERAGE REPAIR (stabilization W4.3 — the draft-sweep class): this route used to walk
    // every connection SERIALLY with no wall-clock guard. Each connection can run a calendar
    // fetch + pattern analysis (AI) + meeting-prep generation (AI) + bot orphan-recovery — a large
    // connection count dies mid-loop on Vercel's 300s kill and the tail connections silently never
    // sync (the exact class the coverage repair fixed for draft-sweep and label-sweep). A wall-clock
    // guard stops cleanly and reports what it left for the next run (least-recently-synced first
    // self-balances the rotation). ──
    const routeDeadline = Date.now() + 265_000; // stop cleanly before the 300s kill
    const perConnBudgetMs = Math.min(45_000, Math.max(8_000, Math.floor(200_000 / connections.length)));

    let totalEventsSynced = 0;
    let totalMeetingPrep = 0;
    let connectionsLeftBehind = 0;
    const errors: string[] = [];

    for (const connection of connections) {
      if (Date.now() + perConnBudgetMs > routeDeadline) { connectionsLeftBehind++; continue; }
      console.log(`[SyncCalendar] Syncing calendar for ${connection.provider} user ${connection.user_id}...`);

      // Sync calendar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowed select() vs. the lib's Connection shape
      const calendarResult = await syncCalendarForConnection(connection as any, supabase, {
        daysAhead: 14,
        daysBehind: 7,
      });

      totalEventsSynced += calendarResult.synced;
      errors.push(...calendarResult.errors);

      if (calendarResult.errors.some((e: string) => e.includes('invalid_grant'))) {
        await supabase.from('connections').update({ status: 'needs_reconnect' }).eq('id', connection.id);
        console.warn(`[SyncCalendar] Marked connection ${connection.id} as needs_reconnect (invalid_grant)`);
        continue;
      }

      if (calendarResult.synced > 0) {
        // Analyze calendar patterns to build meeting_behavior profile
        console.log(`[SyncCalendar] Analyzing calendar patterns...`);
        const patternResult = await analyzeCalendarPatterns(connection.user_id, supabase);

        if (patternResult.success) {
          console.log(`[SyncCalendar] ✓ Patterns: ${patternResult.patternsDetected} types, ${Math.round(patternResult.confidence * 100)}% confidence`);
        }

        // Process meetings for prep generation
        const meetingResult = await processMeetingsForUser(connection.user_id, supabase);
        totalMeetingPrep += meetingResult.created;

        console.log(`[SyncCalendar] ✓ ${calendarResult.synced} events, ${meetingResult.created} prep items`);
      }
    }

    if (connectionsLeftBehind > 0) console.log(`[SyncCalendar] route budget spent: ${connectionsLeftBehind} connection(s) lead the next run (least-recently-synced)`);

    console.log(`[SyncCalendar] Done. Events: ${totalEventsSynced}, Prep: ${totalMeetingPrep}`);

    return NextResponse.json({
      success: true,
      processed: connections.length,
      eventsSynced: totalEventsSynced,
      meetingPrepItems: totalMeetingPrep,
      connectionsLeftBehind,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[SyncCalendar] Cron job error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 },
    );
  }
}
