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
    const { storagePath, calendarEventId, title, startTime, endTime, source = 'recording', liveNotes, existingNoteId } = body as {
      storagePath: string;
      calendarEventId?: string;
      title: string;
      startTime: string;
      endTime: string;
      source?: 'recording' | 'upload';
      liveNotes?: string;
      existingNoteId?: string;
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

    // If an existing text note row exists for this session, promote it to a recording
    // instead of creating a duplicate row.
    const userId = user.id;
    let transcriptId: string;
    let mergedLiveNotes = liveNotes;

    console.log('[Confirm] existingNoteId received:', existingNoteId);

    if (existingNoteId) {
      const { data: existing, error: lookupError } = await adminClient
        .from('meeting_transcripts')
        .select('id, transcript')
        .eq('id', existingNoteId)
        .eq('user_id', userId)
        .maybeSingle();

      console.log('[Confirm] existing note lookup:', existing?.id ?? 'NOT FOUND', lookupError?.message ?? '');

      if (existing) {
        // Use the typed text as liveNotes context for the transcription
        const typedNotes = (existing.transcript as string | null)?.replace(/^"|"$/g, '').trim();
        if (typedNotes) mergedLiveNotes = [typedNotes, liveNotes].filter(Boolean).join('\n\n');

        await adminClient
          .from('meeting_transcripts')
          .update({
            source,
            recording_storage_path: storagePath,
            bot_state: 'processing',
            processed: false,
            transcript: '',
            transcript_segments: [],
            notes_structured: { live_notes: mergedLiveNotes || '', document: '' },
          })
          .eq('id', existing.id)
          .eq('user_id', userId);

        transcriptId = existing.id;
      } else {
        // Note not found — fall through to normal insert
        transcriptId = await insertPendingRow();
      }
    } else {
      transcriptId = await insertPendingRow();
    }

    async function insertPendingRow(): Promise<string> {
      const newId = randomUUID();
      const { error } = await adminClient
        .from('meeting_transcripts')
        .insert({
          id: newId,
          user_id: userId,
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
          notes_structured: mergedLiveNotes ? { live_notes: mergedLiveNotes, document: '' } : null,
        });
      if (error) console.error('[Recordings/Confirm] Failed to insert pending row:', error);
      return newId;
    }

    const botServiceUrl = process.env.MEETING_BOT_SERVICE_URL;
    if (botServiceUrl) {
      // Delegate to Hetzner transcription worker — returns 202 immediately
      fetch(`${botServiceUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.MEETING_BOT_SECRET}`,
        },
        body: JSON.stringify({
          storagePath,
          transcriptId,
          calendarEventId: calendarEventId ?? undefined,
          userId,
          source,
          liveNotes: mergedLiveNotes || undefined,
        }),
      }).catch((err) => console.error('[Recordings/Confirm] Failed to call Hetzner /transcribe:', err));
    } else {
      // Fallback: synchronous (local dev without bot service)
      processAudioFile({
        userId,
        calendarEventId: calendarEventId ?? null,
        title,
        startTime,
        endTime,
        storagePath,
        source,
        adminClient,
        existingTranscriptId: transcriptId,
        liveNotes: mergedLiveNotes || undefined,
      }).catch((err) => {
        console.error('[Recordings/Confirm] Transcription pipeline error:', err);
      });
    }

    return NextResponse.json({ success: true, transcriptId });
  } catch (error) {
    console.error('[Recordings/Confirm] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
