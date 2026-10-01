/**
 * Whisper Client — faster-whisper-server (OpenAI-compatible API)
 *
 * Sends audio to self-hosted faster-whisper-server and returns normalized segments.
 * POST {WHISPER_SERVICE_URL}/v1/audio/transcriptions (multipart/form-data)
 */

import { Agent } from 'undici';

// 30-minute timeout for headers + body — large audio files on the medium model
// can take several minutes to process on a CX32.
const whisperAgent = new Agent({
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout: 30 * 60 * 1000,
  connectTimeout: 30 * 1000,
});

export interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number; // seconds from start
}

interface WhisperVerboseSegment {
  id: number;
  text: string;
  start: number;
  end: number;
}

interface WhisperVerboseResponse {
  text: string;
  segments?: WhisperVerboseSegment[];
}

/**
 * Transcribe an audio buffer using faster-whisper-server.
 * Returns normalized segments compatible with storeTranscriptAndGenerateWork.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const whisperUrl = process.env.WHISPER_SERVICE_URL;
  if (!whisperUrl) {
    throw new Error('WHISPER_SERVICE_URL not configured');
  }

  const formData = new FormData();
  const blob = new Blob([audioBuffer.buffer as ArrayBuffer], { type: 'audio/webm' });
  formData.append('file', blob, filename);
  // PARITY WITH THE TRANSCRIPTION SERVICE (infra/meeting-bot/transcription_worker.py — the path every
  // deployed recording takes; this client is the no-service fallback). Until Oct 1 this fallback
  // forced `language: en` (a Portuguese/German/French meeting came back as English-shaped noise) on
  // the old medium model. Now the same request the service sends: large-v3-turbo, language
  // auto-detected per file, VAD on, and the punctuation seed prompt.
  formData.append('model', 'deepdml/faster-whisper-large-v3-turbo-ct2');
  formData.append('response_format', 'verbose_json');
  formData.append('vad_filter', 'true');
  formData.append('prompt', 'Okay, let us begin.');

  const response = await fetch(`${whisperUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    body: formData,
    // @ts-expect-error — undici dispatcher not in standard fetch types
    dispatcher: whisperAgent,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`Whisper transcription failed (${response.status}): ${body}`);
  }

  const data: WhisperVerboseResponse = await response.json();

  // Normalize to TranscriptSegment[]. No speaker diarization — use "Speaker" for all.
  const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
    speaker: 'Speaker',
    text: s.text.trim(),
    timestamp: Math.round(s.start),
  }));

  // Fallback: if no segments but text exists, create a single segment
  if (segments.length === 0 && data.text.trim()) {
    segments.push({ speaker: 'Speaker', text: data.text.trim(), timestamp: 0 });
  }

  return { text: data.text, segments };
}
