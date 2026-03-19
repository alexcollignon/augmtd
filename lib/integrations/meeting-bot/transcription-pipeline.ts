/**
 * Transcription Pipeline — shared by in-person recording and online bot paths.
 *
 * Downloads audio from Supabase Storage → Whisper → storeTranscriptAndGenerateWork.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { transcribeAudio } from './whisper-client';
import { storeTranscriptAndGenerateWork } from '@/lib/integrations/attendee/bot-manager';

export interface ProcessAudioFileParams {
  userId: string;
  calendarEventId: string | null; // null for ad-hoc recordings
  title: string;
  startTime: string;
  endTime: string;
  storagePath: string; // path in meeting-recordings bucket
  source: 'bot' | 'recording' | 'upload';
  adminClient: SupabaseClient;
  existingTranscriptId?: string; // update pending row instead of inserting
}

/**
 * Download audio from meeting-recordings bucket, transcribe via Whisper,
 * and store transcript + generate work items.
 */
export async function processAudioFile(params: ProcessAudioFileParams): Promise<void> {
  const { userId, calendarEventId, title, startTime, endTime, storagePath, source, adminClient, existingTranscriptId } = params;

  console.log(`[TranscriptionPipeline] Starting transcription for: ${title} (${storagePath})`);

  try {
    // 1. Download audio from Supabase Storage
    const { data: audioData, error: downloadError } = await adminClient.storage
      .from('meeting-recordings')
      .download(storagePath);

    if (downloadError || !audioData) {
      throw new Error(`Failed to download audio from ${storagePath}: ${downloadError?.message}`);
    }

    const audioBuffer = Buffer.from(await audioData.arrayBuffer());
    const filename = storagePath.split('/').pop() ?? 'recording.webm';

    // 2. Transcribe via faster-whisper-server
    const { segments } = await transcribeAudio(audioBuffer, filename);

    console.log(`[TranscriptionPipeline] Transcribed ${segments.length} segments for: ${title}`);

    // 3. Store transcript + generate work items
    await storeTranscriptAndGenerateWork(
      userId,
      calendarEventId,
      null, // no bot ID for direct recordings
      title,
      startTime,
      endTime,
      segments, // already normalized { speaker, text, timestamp }
      adminClient,
      { source, recordingStoragePath: storagePath, existingTranscriptId }
    );

    console.log(`[TranscriptionPipeline] Done: ${title}`);
  } catch (err) {
    console.error(`[TranscriptionPipeline] Failed for: ${title}`, err);
    // Mark the pending transcript row as failed so the UI surfaces it
    if (existingTranscriptId) {
      await adminClient
        .from('meeting_transcripts')
        .update({ bot_state: 'failed', processed: true })
        .eq('id', existingTranscriptId)
        .catch((updateErr) => console.error('[TranscriptionPipeline] Failed to mark row as failed:', updateErr));
    }
    throw err;
  }
}
