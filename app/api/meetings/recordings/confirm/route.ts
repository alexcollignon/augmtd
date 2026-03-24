import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { processAudioFile } from '@/lib/integrations/meeting-bot/transcription-pipeline';

// POST /api/meetings/recordings/confirm
// Body: { storagePath, calendarEventId?, title, startTime, endTime, source? }
// Returns: { success: true, transcriptId } immediately; transcription runs in background
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { storagePath, calendarEventId, title, startTime, endTime, source = 'recording' } = body as {
      storagePath: string;
      calendarEventId?: string;
      title: string;
      startTime: string;
      endTime: string;
      source?: 'recording' | 'upload';
    };

    if (!storagePath || !title || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'storagePath, title, startTime, endTime are required' },
        { status: 400 }
      );
    }

    // Validate path ownership — must start with user's ID
    if (!storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Pre-insert a pending transcript row so the UI shows it immediately
    const pendingId = randomUUID();
    const { error: pendingError } = await adminClient
      .from('meeting_transcripts')
      .insert({
        id: pendingId,
        user_id: user.id,
        meeting_id: calendarEventId ?? randomUUID(),
        calendar_event_id: calendarEventId ?? null,
        title,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: 0,
        source,
        recording_storage_path: storagePath,
        transcript: '',
        transcript_segments: [],
        attendees: [],
        processed: false,
        bot_state: 'processing',
      });

    if (pendingError) {
      console.error('[Recordings/Confirm] Failed to insert pending row:', pendingError);
    }

    const botServiceUrl = process.env.MEETING_BOT_SERVICE_URL;
    if (botServiceUrl && !pendingError) {
      // Delegate to Hetzner transcription worker — returns 202 immediately
      fetch(`${botServiceUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.MEETING_BOT_SECRET}`,
        },
        body: JSON.stringify({
          storagePath,
          transcriptId: pendingId,
          calendarEventId: calendarEventId ?? undefined,
          userId: user.id,
          source,
        }),
      }).catch((err) => console.error('[Recordings/Confirm] Failed to call Hetzner /transcribe:', err));
    } else {
      // Fallback: synchronous (local dev without bot service, or if pending insert failed)
      processAudioFile({
        userId: user.id,
        calendarEventId: calendarEventId ?? null,
        title,
        startTime,
        endTime,
        storagePath,
        source,
        adminClient,
        existingTranscriptId: pendingError ? undefined : pendingId,
      }).catch((err) => {
        console.error('[Recordings/Confirm] Transcription pipeline error:', err);
      });
    }

    return NextResponse.json({ success: true, transcriptId: pendingId });
  } catch (error) {
    console.error('[Recordings/Confirm] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
