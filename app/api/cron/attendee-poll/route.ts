import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pollAndFetchTranscripts } from '@/lib/integrations/attendee/bot-manager';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/cron/attendee-poll
 *
 * Runs every 5 minutes to:
 * 1. Update meeting statuses (upcoming → starting_soon → in_progress → completed)
 * 2. Poll Attendee bots and fetch completed transcripts
 *
 * Secure this endpoint in production with:
 * - Vercel Cron secret header
 * - Or internal API key
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (if configured)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron] Starting Attendee bot polling and meeting status update');

    // 1. Update meeting statuses (upcoming → in_progress → completed)
    const { data: statusUpdates, error: statusError } = await supabaseAdmin.rpc('update_meeting_statuses');

    if (statusError) {
      console.error('[Cron] Error updating meeting statuses:', statusError);
    } else {
      console.log(`[Cron] Updated ${statusUpdates || 0} meeting statuses`);
    }

    // 2. Poll bots and fetch transcripts
    const result = await pollAndFetchTranscripts(supabaseAdmin);

    console.log(`[Cron] Processed ${result.processed} transcripts`);

    if (result.errors.length > 0) {
      console.error('[Cron] Errors during polling:', result.errors);
    }

    return NextResponse.json({
      success: true,
      statusUpdates: statusUpdates || 0,
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Attendee poll error:', error);
    return NextResponse.json(
      { error: 'Polling failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
