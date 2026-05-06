import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { processAudioFile } from '@/lib/integrations/meeting-bot/transcription-pipeline';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const TRANSCRIPT_ID = 'acaaa1ab-186f-4f11-966b-b4e160dce264';
const STORAGE_PATH = 'ae306f38-f312-4bf3-aef4-562331a07fab/36817ac7-6b70-4176-b476-8a8d36970191.webm';

async function main() {
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Fetch the existing transcript row
  const { data: transcript, error } = await adminClient
    .from('meeting_transcripts')
    .select('id, user_id, title, start_time, end_time, calendar_event_id, transcript, source')
    .eq('id', TRANSCRIPT_ID)
    .single();

  if (error || !transcript) {
    console.error('Transcript not found:', error?.message);
    process.exit(1);
  }

  console.log(`Found: "${transcript.title}" (${transcript.id})`);
  console.log(`User: ${transcript.user_id}`);

  // 2. Verify audio exists in bucket
  const { data: fileList, error: listError } = await adminClient.storage
    .from('meeting-recordings')
    .list(transcript.user_id, { search: '36817ac7-6b70-4176-b476-8a8d36970191.webm' });

  if (listError || !fileList?.length) {
    console.error('Audio file not found in bucket at expected path. List error:', listError?.message);
    process.exit(1);
  }
  console.log(`Audio confirmed in bucket: ${STORAGE_PATH}`);

  // 3. Preserve existing typed text notes as live_notes context for AI
  const existingText = (transcript.transcript as string | null)?.trim() ?? '';
  const liveNotes = existingText || undefined;
  if (liveNotes) {
    console.log(`Preserving ${liveNotes.length} chars of text notes as AI context.`);
  }

  // 4. Reset row — link audio, preserve notes, mark for processing
  const now = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from('meeting_transcripts')
    .update({
      source: 'recording',
      recording_storage_path: STORAGE_PATH,
      bot_state: 'processing',
      processed: false,
      transcript: '',
      transcript_segments: [],
      notes_structured: { live_notes: liveNotes ?? '', document: '' },
      start_time: transcript.start_time ?? now,
      end_time: transcript.end_time ?? now,
    })
    .eq('id', TRANSCRIPT_ID);

  if (updateError) {
    console.error('Failed to update row:', updateError.message);
    process.exit(1);
  }
  console.log('Row updated — bot_state: processing, source: recording');

  // 5. Trigger transcription
  const botServiceUrl = process.env.MEETING_BOT_SERVICE_URL;

  if (botServiceUrl) {
    console.log(`Delegating to Hetzner: ${botServiceUrl}/transcribe`);
    const res = await fetch(`${botServiceUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MEETING_BOT_SECRET}`,
      },
      body: JSON.stringify({
        storagePath: STORAGE_PATH,
        transcriptId: TRANSCRIPT_ID,
        calendarEventId: transcript.calendar_event_id ?? undefined,
        userId: transcript.user_id,
        source: 'recording',
        liveNotes: liveNotes ?? undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      console.error(`Hetzner error (${res.status}):`, body);
      process.exit(1);
    }
    console.log(`Hetzner accepted (${res.status}) — transcription running in background.`);
  } else {
    console.log('No MEETING_BOT_SERVICE_URL — running transcription pipeline locally...');
    await processAudioFile({
      userId: transcript.user_id,
      calendarEventId: transcript.calendar_event_id ?? null,
      title: transcript.title,
      startTime: transcript.start_time ?? now,
      endTime: transcript.end_time ?? now,
      storagePath: STORAGE_PATH,
      source: 'recording',
      adminClient,
      existingTranscriptId: TRANSCRIPT_ID,
      liveNotes,
    });
    console.log('Transcription pipeline complete.');
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
