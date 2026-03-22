import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // lightweight — no Whisper, just DB updates

/**
 * POST /api/meetings/[id]/bot-webhook
 * Body: { botId, state }
 * Auth: Authorization: Bearer {MEETING_BOT_SECRET}
 *
 * Lightweight state-update webhook called by the Hetzner bot at join/leave events.
 * Transcription is now handled entirely on Hetzner (transcription_worker.py) to avoid
 * Vercel's 300s function timeout for large audio files.
 * The worker calls /api/meetings/recording/[transcriptId]/generate-insights when done.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const secret = process.env.MEETING_BOT_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'Bot webhook not configured' }, { status: 503 });
    }

    const authHeader = request.headers.get('authorization') ?? '';
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: calendarEventId } = await params;
    const body = await request.json();
    const { botId, state } = body as { botId: string; state: string };

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Update bot state on the calendar event
    await adminClient
      .from('calendar_events')
      .update({ attendee_bot_state: state })
      .eq('id', calendarEventId);

    console.log(`[BotWebhook] Bot ${botId} state → ${state} for event ${calendarEventId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[BotWebhook] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
