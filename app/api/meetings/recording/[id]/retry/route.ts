import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { processAudioFile } from '@/lib/integrations/meeting-bot/transcription-pipeline';

export const maxDuration = 300;

// POST /api/meetings/recording/[id]/retry
// Retries transcription for a failed in-person/upload recording by transcript ID.
//
// If MEETING_BOT_SERVICE_URL is configured, delegates to the Hetzner transcription worker
// (POST /transcribe) — avoids Vercel 300s limit for large audio files.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: transcriptId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: transcript } = await adminClient
    .from('meeting_transcripts')
    .select('id, recording_storage_path, title, start_time, end_time, source, calendar_event_id, user_id')
    .eq('id', transcriptId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!transcript) {
    return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
  }

  if (!transcript.recording_storage_path) {
    return NextResponse.json({ error: 'No audio recording available to retry' }, { status: 400 });
  }

  // Reset to processing
  await adminClient
    .from('meeting_transcripts')
    .update({ bot_state: 'processing', processed: false })
    .eq('id', transcriptId);

  const botServiceUrl = process.env.MEETING_BOT_SERVICE_URL;
  if (botServiceUrl) {
    // Delegate to Hetzner transcription worker — returns 202 immediately.
    fetch(`${botServiceUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MEETING_BOT_SECRET}`,
      },
      body: JSON.stringify({
        storagePath: transcript.recording_storage_path,
        transcriptId,
        calendarEventId: transcript.calendar_event_id ?? undefined,
        userId: user.id,
        source: transcript.source ?? 'recording',
      }),
    }).catch((err) => console.error('[RetryRoute] Failed to call Hetzner /transcribe:', err));

    return NextResponse.json({ success: true, async: true });
  }

  // Fallback: synchronous (local dev without bot service)
  await processAudioFile({
    userId: user.id,
    calendarEventId: transcript.calendar_event_id ?? null,
    title: transcript.title,
    startTime: transcript.start_time,
    endTime: transcript.end_time,
    storagePath: transcript.recording_storage_path,
    source: transcript.source ?? 'recording',
    adminClient,
    existingTranscriptId: transcriptId,
  });

  return NextResponse.json({ success: true });
}
