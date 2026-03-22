import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { processAudioFile } from '@/lib/integrations/meeting-bot/transcription-pipeline';

export const maxDuration = 300;

// POST /api/meetings/[id]/transcript/retry
// Re-runs the transcription pipeline for a failed transcript that has audio in storage.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: calendarEventId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find the failed transcript for this event
  const { data: transcript } = await adminClient
    .from('meeting_transcripts')
    .select('id, recording_storage_path, title, start_time, end_time, source, user_id')
    .eq('calendar_event_id', calendarEventId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!transcript) {
    return NextResponse.json({ error: 'No transcript found for this event' }, { status: 404 });
  }

  if (!transcript.recording_storage_path) {
    return NextResponse.json({ error: 'No audio recording available to retry' }, { status: 400 });
  }

  // Reset row to processing state
  await adminClient
    .from('meeting_transcripts')
    .update({ bot_state: 'processing', processed: false })
    .eq('id', transcript.id);

  // Re-run pipeline
  await processAudioFile({
    userId: user.id,
    calendarEventId,
    title: transcript.title,
    startTime: transcript.start_time,
    endTime: transcript.end_time,
    storagePath: transcript.recording_storage_path,
    source: transcript.source ?? 'bot',
    adminClient,
    existingTranscriptId: transcript.id,
  });

  return NextResponse.json({ success: true });
}
