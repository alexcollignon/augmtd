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
 * Polls Attendee bots and fetches completed transcripts.
 * Should be called periodically (e.g., every 5 minutes via cron job).
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

    console.log('[Cron] Starting Attendee bot polling');

    const result = await pollAndFetchTranscripts(supabaseAdmin);

    console.log(`[Cron] Processed ${result.processed} transcripts`);

    if (result.errors.length > 0) {
      console.error('[Cron] Errors during polling:', result.errors);
    }

    return NextResponse.json({
      success: true,
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
