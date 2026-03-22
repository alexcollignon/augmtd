import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { storeTranscriptAndGenerateWork } from '@/lib/integrations/meeting-bot/bot-manager';

export const maxDuration = 300;

/**
 * POST /api/meetings/recording/[id]/generate-insights
 *
 * Called by the Hetzner transcription worker after segments are written to Supabase.
 * Reads the existing transcript segments, runs AI insights, creates inbox items,
 * and marks the transcript as processed.
 *
 * Auth: Bearer {MEETING_BOT_SECRET}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const secret = process.env.MEETING_BOT_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: transcriptId } = await params;

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: transcript } = await adminClient
    .from('meeting_transcripts')
    .select('id, user_id, calendar_event_id, title, start_time, end_time, transcript_segments, source, recording_storage_path')
    .eq('id', transcriptId)
    .maybeSingle();

  if (!transcript) {
    return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
  }

  const segments = (transcript.transcript_segments as any[]) ?? [];
  if (segments.length === 0) {
    return NextResponse.json({ error: 'No segments to process' }, { status: 400 });
  }

  // storeTranscriptAndGenerateWork with existingTranscriptId skips the insert/update
  // of segments (already done by Hetzner) and goes straight to insights + inbox items.
  await storeTranscriptAndGenerateWork(
    transcript.user_id,
    transcript.calendar_event_id ?? null,
    null,
    transcript.title,
    transcript.start_time,
    transcript.end_time,
    segments,
    adminClient,
    {
      source: transcript.source ?? 'bot',
      recordingStoragePath: transcript.recording_storage_path ?? undefined,
      existingTranscriptId: transcriptId,
    }
  );

  return NextResponse.json({ success: true });
}
