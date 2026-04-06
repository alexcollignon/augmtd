'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import fixWebmDuration from 'fix-webm-duration';

export type RecordingState = 'idle' | 'recording' | 'uploading' | 'processing' | 'done' | 'error';

export interface UseRecordingReturn {
  state: RecordingState;
  elapsed: number;
  uploadProgress: number;
  errorMessage: string;
  liveNotes: string;
  setLiveNotes: (notes: string) => void;
  startRecording: (title: string, calendarEventId?: string, existingNoteId?: string) => Promise<void>;
  setRecordingNoteId: (noteId: string) => void;
  stopAndUpload: () => Promise<void>;
  reset: () => void;
  /** Title of the current/last recording */
  recordingTitle: string;
  /** Calendar event linked to this recording (if any) */
  recordingEventId: string | undefined;
}

export function useRecording(
  onTranscriptReady?: () => void,
): UseRecordingReturn {
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [liveNotes, setLiveNotes] = useState('');
  const [recordingTitle, setRecordingTitle] = useState('');
  const [recordingEventId, setRecordingEventId] = useState<string | undefined>();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleRef = useRef('');
  const eventIdRef = useRef<string | undefined>(undefined);
  const noteIdRef = useRef<string | undefined>(undefined);
  const liveNotesRef = useRef('');
  const originalTitleRef = useRef(typeof document !== 'undefined' ? document.title : '');

  // Keep ref in sync for use in stopAndUpload closure
  useEffect(() => {
    liveNotesRef.current = liveNotes;
  }, [liveNotes]);

  // Format seconds to MM:SS
  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Update document title while recording
  useEffect(() => {
    if (state === 'recording') {
      document.title = `● Recording (${formatElapsed(elapsed)}) — AUGMTD`;
    } else if (state === 'uploading') {
      document.title = `↑ Uploading recording — AUGMTD`;
    } else if (state === 'processing') {
      document.title = `⟳ Transcribing — AUGMTD`;
    } else {
      document.title = originalTitleRef.current;
    }
  }, [state, elapsed]);

  // Restore title on unmount
  useEffect(() => {
    return () => {
      document.title = originalTitleRef.current;
    };
  }, []);

  // beforeunload guard while recording
  useEffect(() => {
    if (state !== 'recording') return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state]);

  const startRecording = useCallback(async (title: string, calendarEventId?: string, existingNoteId?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      titleRef.current = title;
      eventIdRef.current = calendarEventId;
      noteIdRef.current = existingNoteId;
      setRecordingTitle(title);
      setRecordingEventId(calendarEventId);
      setLiveNotes('');
      liveNotesRef.current = '';

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000);
      startTimeRef.current = Date.now();
      setState('recording');
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Microphone access denied');
      setState('error');
    }
  }, []);

  const stopAndUpload = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop recorder and collect final chunks
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    // Stop all tracks (releases mic)
    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;

    setState('uploading');
    setUploadProgress(0);

    const rawBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const durationMs = Date.now() - startTimeRef.current;
    const blob = await fixWebmDuration(rawBlob, durationMs);
    const startTime = new Date(startTimeRef.current).toISOString();
    const endTime = new Date().toISOString();
    const title = titleRef.current || 'Untitled meeting';
    const calendarEventId = eventIdRef.current;
    const notes = liveNotesRef.current;
    // noteIdRef intentionally NOT captured here — read lazily in the confirm
    // fetch so any setRecordingNoteId calls during upload are picked up.

    try {
      // 1. Presign
      const presignRes = await fetch('/api/meetings/recordings/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'recording.webm', mimeType: 'audio/webm' }),
      });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { signedUrl, storagePath } = await presignRes.json();

      // 2. Upload via XHR for progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', 'audio/webm');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(blob);
      });

      // 3. Confirm — fire-and-forget transcription (include live notes)
      setState('processing');
      console.log('[Recording] confirm sending with existingNoteId:', noteIdRef.current);
      const confirmRes = await fetch('/api/meetings/recordings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          calendarEventId,
          title,
          startTime,
          endTime,
          liveNotes: notes || undefined,
          existingNoteId: noteIdRef.current || undefined,
        }),
      });
      if (!confirmRes.ok) throw new Error('Failed to start transcription');

      setState('done');
      onTranscriptReady?.();
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Upload failed');
      setState('error');
    }
  }, [onTranscriptReady]);

  // Update the note id that will be passed to the confirm route on stop.
  // Call this when a text note row is created during an active recording.
  const setRecordingNoteId = useCallback((noteId: string) => {
    console.log('[Recording] setRecordingNoteId:', noteId, 'state:', state);
    noteIdRef.current = noteId;
  }, [state]);

  const reset = useCallback(() => {
    // Clean up recorder if still active
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setState('idle');
    setElapsed(0);
    setUploadProgress(0);
    setErrorMessage('');
    setLiveNotes('');
    liveNotesRef.current = '';
  }, []);

  return {
    state,
    elapsed,
    uploadProgress,
    errorMessage,
    liveNotes,
    setLiveNotes,
    startRecording,
    stopAndUpload,
    reset,
    recordingTitle,
    recordingEventId,
    setRecordingNoteId,
  };
}
