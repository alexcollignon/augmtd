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
    .select('id, user_id, calendar_event_id, title, start_time, end_time, transcript_segments, source, recording_storage_path, notes_structured')
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
  const notesStructured = transcript.notes_structured as { live_notes?: string } | null;
  let liveNotes = notesStructured?.live_notes || '';

  if (transcript.calendar_event_id) {
    // For scheduled bot meetings: check calendar_events.metadata.live_notes
    // (LiveNotepad saves there while bot records).
    const { data: calEvent } = await adminClient
      .from('calendar_events')
      .select('metadata')
      .eq('id', transcript.calendar_event_id)
      .maybeSingle();
    const calLiveNotes = (calEvent?.metadata as any)?.live_notes || '';
    if (calLiveNotes && calLiveNotes !== liveNotes) {
      liveNotes = [liveNotes, calLiveNotes].filter(Boolean).join('\n\n');
    }

    // For ad-hoc bot meetings linked to a text note: also read the text note's
    // typed content (transcript field). This captures notes the user typed in
    // InlineNoteView before the UI switched to the bot transcript view.
    const { data: linkedTextNote } = await adminClient
      .from('meeting_transcripts')
      .select('transcript')
      .eq('id', transcript.calendar_event_id)
      .eq('source', 'text')
      .maybeSingle();
    const textNoteContent = (linkedTextNote?.transcript as string) || '';
    if (textNoteContent && !liveNotes.includes(textNoteContent)) {
      liveNotes = [textNoteContent, liveNotes].filter(Boolean).join('\n\n');
    }
  }

  const liveNotesForAI = liveNotes || undefined;

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
      liveNotes: liveNotesForAI,
    }
  );

  // Fire-and-forget: surface to desk pool
  void (async () => {
    try {
      const { data: done } = await adminClient
        .from('meeting_transcripts')
        .select('summary, work_items_generated, suggested_next_step, title, source, calendar_event_id')
        .eq('id', transcriptId)
        .maybeSingle();
      if (!done) return;

      const count = (done.work_items_generated as number) ?? 0;
      const urgency = count >= 3 ? 'high' : count >= 1 ? 'medium' : 'low';
      const isBot = done.source === 'bot';
      const sourceId = isBot && done.calendar_event_id ? done.calendar_event_id : transcriptId;
      const sourceUrl = isBot && done.calendar_event_id
        ? `/meetings/${done.calendar_event_id}`
        : `/meetings/recording/${transcriptId}`;
      const title = done.suggested_next_step
        ? (done.suggested_next_step as string).slice(0, 120)
        : `Review: ${(done.title as string) ?? 'Meeting'}`;

      await adminClient
        .from('desk_items')
        .upsert({
          user_id: transcript.user_id,
          source_type: 'meeting_action',
          source_id: sourceId,
          thread_key: null,
          source_refs: [{ type: 'meeting_action', id: transcriptId }],
          kanban_column: 'pool',
          position: 0,
          title,
          description: done.summary ? (done.summary as string).slice(0, 200) : null,
          source_url: sourceUrl,
          urgency,
          email_count: 1,
          has_prepared: false,
          synthesis: null,
          synthesis_at: null,
        }, { onConflict: 'user_id,source_type,source_id', ignoreDuplicates: true });
    } catch (e) {
      console.error('[generate-insights] auto-desk error:', e);
    }
  })();

  return NextResponse.json({ success: true });
}
