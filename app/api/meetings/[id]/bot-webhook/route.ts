import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { processAudioFile } from '@/lib/integrations/meeting-bot/transcription-pipeline';

export const maxDuration = 300; // 5 min — allows Whisper to complete

// POST /api/meetings/[id]/bot-webhook
// Body: { botId, state, audioStoragePath }
// Auth: Authorization: Bearer {MEETING_BOT_SECRET}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Validate shared secret
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
    const { botId, state, audioStoragePath } = body as {
      botId: string;
      state: string;
      audioStoragePath?: string;
    };

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

    // When bot ends with audio, trigger transcription pipeline
    if (state === 'ended' && audioStoragePath) {
      // Fetch event details for context
      const { data: event } = await adminClient
        .from('calendar_events')
        .select('user_id, title, start_time, end_time')
        .eq('id', calendarEventId)
        .single();

      if (event) {
        // Pre-insert a pending transcript row so the meeting shows immediately
        // even if Whisper fails — same pattern as in-person recordings/confirm route
        const pendingId = randomUUID();
        const { error: pendingError } = await adminClient
          .from('meeting_transcripts')
          .insert({
            id: pendingId,
            user_id: event.user_id,
            meeting_id: calendarEventId,
            calendar_event_id: calendarEventId,
            title: event.title,
            start_time: event.start_time,
            end_time: event.end_time,
            duration_minutes: 0,
            source: 'bot',
            recording_storage_path: audioStoragePath,
            transcript: '',
            transcript_segments: [],
            attendees: [],
            processed: false,
            bot_state: 'processing',
          });

        if (pendingError) {
          console.error('[BotWebhook] Failed to insert pending transcript row:', pendingError);
        }

        await processAudioFile({
          userId: event.user_id,
          calendarEventId,
          title: event.title,
          startTime: event.start_time,
          endTime: event.end_time,
          storagePath: audioStoragePath,
          source: 'bot',
          adminClient,
          existingTranscriptId: pendingError ? undefined : pendingId,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[BotWebhook] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
