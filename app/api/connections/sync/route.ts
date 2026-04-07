import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';
import { syncCalendarForConnection } from '@/lib/calendar/sync-calendar';
import { processMeetingsForUser } from '@/lib/calendar/meeting-processor';
import { analyzeCalendarPatterns } from '@/lib/calendar/pattern-analyzer';
import { createBotsForCalendarEvents } from '@/lib/integrations/meeting-bot/bot-manager';

export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get optional provider filter from request body
    const body = await request.json().catch(() => ({}));
    const providerFilter = body.provider; // 'gmail' | 'outlook' | undefined

    console.log(`Manual sync triggered by user ${user.id}${providerFilter ? ` for ${providerFilter}` : ''}`);

    // Use service role to bypass RLS for operations
    const adminSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get user's email connections (Gmail or Outlook)
    // If provider is specified, filter to only that provider
    let query = adminSupabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (providerFilter) {
      query = query.eq('provider', providerFilter);
    } else {
      query = query.in('provider', ['gmail', 'outlook']);
    }

    const { data: connections, error: connectionError } = await query;

    if (connectionError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch connections',
          message: 'Unable to load your email connections. Please try again.',
          action: 'retry'
        },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      return NextResponse.json(
        {
          error: 'No active connections',
          message: 'Connect Gmail or Outlook to start syncing emails and calendar.',
          action: 'connect'
        },
        { status: 404 }
      );
    }

    // Process all connections in parallel — within each, calendar → bots → emails order is preserved
    const results = await Promise.all(connections.map(async (connection) => {
      try {
        console.log(`Syncing ${connection.provider} calendar + emails for user ${user.id}...`);

        console.log(`[Sync Order] 1/3: Syncing calendar for ${connection.provider}...`);
        const calendarResult = await syncCalendarForConnection(connection, adminSupabase, {
          daysAhead: 14,
          daysBehind: 7,
        });
        if (calendarResult.synced > 0) {
          console.log(`[Sync Order] ✓ Calendar synced: ${calendarResult.synced} events`);
        }

        console.log(`[Sync Order] 2/3: Creating meeting bots for ${connection.provider}...`);
        const botResult = await createBotsForCalendarEvents(user.id, adminSupabase);
        if (botResult.created > 0) {
          console.log(`[Sync Order] ✓ Bots created: ${botResult.created} meeting bots`);
        }

        console.log(`[Sync Order] 3/3: Syncing emails for ${connection.provider}...`);
        const emailResult = await syncEmailsForConnection(connection, adminSupabase);
        if (emailResult.emailsFetched > 0) {
          console.log(`[Sync Order] ✓ Emails synced: ${emailResult.emailsFetched} emails`);
        }

        const needsReconnect = calendarResult.errors.some((e: string) => e.includes('invalid_grant')) ||
          emailResult.errors.some((e: string) => e.includes('invalid_grant'));
        if (needsReconnect) {
          await adminSupabase.from('connections').update({ status: 'needs_reconnect' }).eq('id', connection.id);
          console.warn(`[Sync] Marked connection ${connection.id} as needs_reconnect (invalid_grant)`);
        }

        return { calendarResult, botResult, emailResult, error: null, needsReconnect };
      } catch (err) {
        console.error(`Sync error for ${connection.provider}:`, err);
        const needsReconnect = String(err).includes('invalid_grant');
        if (needsReconnect) {
          await adminSupabase.from('connections').update({ status: 'needs_reconnect' }).eq('id', connection.id);
          console.warn(`[Sync] Marked connection ${connection.id} as needs_reconnect (invalid_grant)`);
        }
        return {
          calendarResult: { synced: 0, errors: [String(err)] },
          botResult: { created: 0, errors: [] },
          emailResult: { emailsFetched: 0, inboxItemsCreated: 0, errors: [] },
          error: String(err),
          needsReconnect,
        };
      }
    }));

    // Aggregate results
    const anyNeedsReconnect = results.some(r => r.needsReconnect);
    const totalEventsSynced = results.reduce((sum, r) => sum + r.calendarResult.synced, 0);
    const totalEmailsFetched = results.reduce((sum, r) => sum + r.emailResult.emailsFetched, 0);
    let totalInboxItemsCreated = results.reduce((sum, r) => sum + r.emailResult.inboxItemsCreated, 0);
    const totalBotsCreated = results.reduce((sum, r) => sum + r.botResult.created, 0);
    const errors = results.flatMap(r => [...r.calendarResult.errors, ...r.botResult.errors, ...r.emailResult.errors]);

    console.log(`Manual sync completed. Emails: ${totalEmailsFetched}, Calendar: ${totalEventsSynced}, Inbox items: ${totalInboxItemsCreated}`);

    // User-scoped post-sync ops — run once after all connections finish
    let meetingPrepItemsCreated = 0;
    if (totalEventsSynced > 0) {
      console.log(`[Sync Order] 1.5: Analyzing calendar patterns...`);
      const patternResult = await analyzeCalendarPatterns(user.id, adminSupabase);
      if (patternResult.success) {
        console.log(`[Sync Order] ✓ Patterns analyzed: ${patternResult.patternsDetected} meeting types, ${Math.round(patternResult.confidence * 100)}% confidence`);
      }

      console.log(`Processing meetings for user ${user.id}...`);
      const meetingResult = await processMeetingsForUser(user.id, adminSupabase);
      meetingPrepItemsCreated = meetingResult.created;
      totalInboxItemsCreated += meetingPrepItemsCreated;
      console.log(`Created ${meetingPrepItemsCreated} meeting prep items`);
    }

    return NextResponse.json({
      success: true,
      emailsFetched: totalEmailsFetched,
      eventsSynced: totalEventsSynced,
      botsCreated: totalBotsCreated,
      meetingPrepItems: meetingPrepItemsCreated,
      inboxItemsCreated: totalInboxItemsCreated,
      errors: errors.length > 0 ? errors : undefined,
      ...(anyNeedsReconnect && { action: 'reconnect' }),
    });

  } catch (error) {
    console.error('Manual sync error:', error);

    // Provide specific error messages based on error type
    const errorMessage = error instanceof Error ? error.message : 'Unknown';
    let userMessage = 'Failed to sync emails and calendar. Please try again.';
    let action = 'retry';

    if (errorMessage.includes('Unauthorized') || errorMessage.includes('auth')) {
      userMessage = 'Your session has expired. Please log in again.';
      action = 'login';
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
      userMessage = 'Network error. Check your internet connection and try again.';
      action = 'retry';
    } else if (errorMessage.includes('timeout')) {
      userMessage = 'Request timed out. The server took too long to respond.';
      action = 'retry';
    }

    return NextResponse.json(
      {
        error: 'Sync failed',
        message: userMessage,
        details: errorMessage,
        action
      },
      { status: 500 }
    );
  }
}
