import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { syncCalendarForConnection } from '@/lib/calendar/sync-calendar';
import { processMeetingsForUser } from '@/lib/calendar/meeting-processor';
import { analyzeCalendarPatterns } from '@/lib/calendar/pattern-analyzer';
import { createBotsForCalendarEvents } from '@/lib/integrations/meeting-bot/bot-manager';

export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel Cron sends this header)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    // Get all active gmail/outlook connections
    const { data: connections, error: connectionsError } = await supabase
      .from('connections')
      .select('*')
      .in('provider', ['gmail', 'outlook'])
      .eq('status', 'active');

    if (connectionsError) {
      console.error('[SyncCalendar] Error fetching connections:', connectionsError);
      return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 });
    }

    if (!connections || connections.length === 0) {
      console.log('[SyncCalendar] No active connections found');
      return NextResponse.json({
        success: true,
        message: 'No connections to process',
        processed: 0,
      });
    }

    console.log(`[SyncCalendar] Found ${connections.length} active connections`);

    let totalEventsSynced = 0;
    let totalMeetingPrep = 0;
    let totalBotsCreated = 0;
    const errors: string[] = [];

    for (const connection of connections) {
      console.log(`[SyncCalendar] Syncing calendar for ${connection.provider} user ${connection.user_id}...`);

      // Sync calendar
      const calendarResult = await syncCalendarForConnection(connection, supabase, {
        daysAhead: 14,
        daysBehind: 7,
      });

      totalEventsSynced += calendarResult.synced;
      errors.push(...calendarResult.errors);

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

      // Always run bot scheduling — detects new meetings and recovers orphaned jobs
      // regardless of whether new calendar events were synced this run.
      const botResult = await createBotsForCalendarEvents(connection.user_id, supabase);
      totalBotsCreated += botResult.created;
      errors.push(...botResult.errors);
    }

    console.log(`[SyncCalendar] Done. Events: ${totalEventsSynced}, Prep: ${totalMeetingPrep}, Bots: ${totalBotsCreated}`);

    return NextResponse.json({
      success: true,
      processed: connections.length,
      eventsSynced: totalEventsSynced,
      meetingPrepItems: totalMeetingPrep,
      botsCreated: totalBotsCreated,
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
