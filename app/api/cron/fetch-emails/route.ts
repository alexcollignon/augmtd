import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';
import { syncCalendarForConnection } from '@/lib/calendar/sync-calendar';
import { processMeetingsForUser } from '@/lib/calendar/meeting-processor';

export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel Cron sends this header)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Starting email fetch cron job...');

    // Use service role to bypass RLS
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get all active email connections (Gmail + Outlook)
    const { data: connections, error: connectionsError } = await supabase
      .from('connections')
      .select('*')
      .in('provider', ['gmail', 'outlook'])
      .eq('status', 'active');

    if (connectionsError) {
      console.error('Error fetching connections:', connectionsError);
      return NextResponse.json(
        { error: 'Failed to fetch connections' },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      console.log('No active email connections found');
      return NextResponse.json({
        success: true,
        message: 'No connections to process',
        processed: 0
      });
    }

    console.log(`Found ${connections.length} active email connections`);

    let totalEmailsFetched = 0;
    let totalInboxItems = 0;
    let totalEventsSynced = 0;
    let totalMeetingPrep = 0;
    const errors: string[] = [];

    // Process each connection (Calendar FIRST, then emails)
    for (const connection of connections) {
      console.log(`[Cron] Syncing ${connection.provider} for user ${connection.user_id}...`);

      // Step 1: Sync calendar first (provides context for email processing)
      console.log(`[Cron] 1/2: Syncing calendar...`);
      const calendarResult = await syncCalendarForConnection(connection, supabase, {
        daysAhead: 14,
        daysBehind: 7,
      });

      totalEventsSynced += calendarResult.synced;
      errors.push(...calendarResult.errors);

      // Step 2: Process meetings for prep generation
      if (calendarResult.synced > 0) {
        const meetingResult = await processMeetingsForUser(connection.user_id, supabase);
        totalMeetingPrep += meetingResult.created;
        console.log(`[Cron] ✓ Calendar: ${calendarResult.synced} events, ${meetingResult.created} prep items`);
      }

      // Step 3: Sync emails after calendar (can use calendar context)
      console.log(`[Cron] 2/2: Syncing emails...`);
      const emailResult = await syncEmailsForConnection(connection, supabase);

      totalEmailsFetched += emailResult.emailsFetched;
      totalInboxItems += emailResult.inboxItemsCreated;
      errors.push(...emailResult.errors);

      console.log(`[Cron] ✓ Emails: ${emailResult.emailsFetched} fetched, ${emailResult.inboxItemsCreated} inbox items`);
    }

    console.log(`Cron job completed. Calendar: ${totalEventsSynced}, Emails: ${totalEmailsFetched}, Inbox: ${totalInboxItems}, Meeting prep: ${totalMeetingPrep}`);

    return NextResponse.json({
      success: true,
      processed: connections.length,
      eventsSynced: totalEventsSynced,
      meetingPrepItems: totalMeetingPrep,
      emailsFetched: totalEmailsFetched,
      inboxItemsCreated: totalInboxItems,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
