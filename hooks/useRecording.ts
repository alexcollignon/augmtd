'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import fixWebmDuration from 'fix-webm-duration';

export type RecordingState = 'idle' | 'recording' | 'paused' | 'uploading' | 'processing' | 'done' | 'error';

export interface UseRecordingReturn {
  state: RecordingState;
  elapsed: number;
  uploadProgress: number;
  errorMessage: string;
  liveNotes: string;
  setLiveNotes: (notes: string) => void;
  startRecording: (title: string, calendarEventId?: string, existingNoteId?: string) => Promise<void>;
  setRecordingNoteId: (noteId: string) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopAndUpload: () => Promise<void>;
  reset: () => void;
  /** Title of the current/last recording */
  recordingTitle: string;
  /** Calendar event linked to this recording (if any) */
  recordingEventId: string | undefined;
  /** Transcript/note ID created for this recording (reactive — updated via setRecordingNoteId) */
  recordingNoteId: string | undefined;
  /** Seconds the tab has been hidden while recording (resets to 0 on return). Used for away-time warnings. */
  awaySeconds: number;
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
  const [recordingNoteId, setRecordingNoteIdState] = useState<string | undefined>();

  const [awaySeconds, setAwaySeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mimeTypeRef = useRef<string>('audio/webm');
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  // Tracks accumulated elapsed ms before the most recent pause
  const elapsedBeforePauseRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const awayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Update document title while recording — includes away-time countdown so the user
  // can see the warning even from another tab.
  useEffect(() => {
    if (state === 'recording') {
      const remainingSecs = 3600 - awaySeconds;
      if (awaySeconds >= 55 * 60) {
        const minsLeft = Math.ceil(remainingSecs / 60);
        document.title = `⚠ ${minsLeft}min left before pause — AUGMTD`;
      } else if (awaySeconds >= 45 * 60) {
        const minsLeft = Math.ceil(remainingSecs / 60);
        document.title = `⏱ Recording away — ${minsLeft}min left — AUGMTD`;
      } else {
        document.title = `● Recording (${formatElapsed(elapsed)}) — AUGMTD`;
      }
    } else if (state === 'paused') {
      document.title = `⏸ Paused (${formatElapsed(elapsed)}) — AUGMTD`;
    } else if (state === 'uploading') {
      document.title = `↑ Uploading recording — AUGMTD`;
    } else if (state === 'processing') {
      document.title = `⟳ Transcribing — AUGMTD`;
    } else {
      document.title = originalTitleRef.current;
    }
  }, [state, elapsed, awaySeconds]);

  // Restore title on unmount
  useEffect(() => {
    return () => {
      document.title = originalTitleRef.current;
    };
  }, []);

  // beforeunload guard while recording or paused
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state]);

  const startRecording = useCallback(async (title: string, calendarEventId?: string, existingNoteId?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''].find(
        (t) => t === '' || MediaRecorder.isTypeSupported(t),
      ) ?? '';
      mimeTypeRef.current = mimeType || 'audio/webm';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      titleRef.current = title;
      eventIdRef.current = calendarEventId;
      noteIdRef.current = existingNoteId;
      setRecordingTitle(title);
      setRecordingEventId(calendarEventId);
      setRecordingNoteIdState(existingNoteId);
      setLiveNotes('');
      liveNotesRef.current = '';

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000);
      startTimeRef.current = Date.now();
      elapsedBeforePauseRef.current = 0;
      setState('recording');
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor(elapsedBeforePauseRef.current / 1000 + (Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Microphone access denied');
      setState('error');
    }
  }, []);

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    // Accumulate elapsed before pausing the timer
    elapsedBeforePauseRef.current += Date.now() - startTimeRef.current;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setState('paused');
  }, []);

  // Auto-pause behaviour:
  //
  // 1. `freeze` event (Chrome/Edge): fires immediately when the OS suspends the
  //    browser (sleep, screen lock). Never fires on tab/app switches.
  //
  // 2. `visibilitychange` + 1-hour timer (all browsers): universal safety net so
  //    a recording never runs unattended indefinitely. Normal tab switches are
  //    unaffected — the user just needs to return within the hour. The away-time
  //    counter (`awaySeconds`) drives UI warnings at 15 min and 5 min remaining.
  useEffect(() => {
    if (state !== 'recording') return;

    const SLEEP_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSleepTimer = () => {
      if (sleepTimer !== null) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
      }
    };

    const clearAwayTimer = () => {
      if (awayTimerRef.current !== null) {
        clearInterval(awayTimerRef.current);
        awayTimerRef.current = null;
      }
    };

    const handleFreeze = () => pauseRecording();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        sleepTimer = setTimeout(() => pauseRecording(), SLEEP_THRESHOLD_MS);
        // Tick awaySeconds every second so the UI can show countdown warnings
        awayTimerRef.current = setInterval(() => setAwaySeconds((s) => s + 1), 1000);
      } else {
        clearSleepTimer();
        clearAwayTimer();
        setAwaySeconds(0);
      }
    };

    document.addEventListener('freeze', handleFreeze);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('freeze', handleFreeze);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearSleepTimer();
      clearAwayTimer();
      setAwaySeconds(0);
    };
  }, [state, pauseRecording]);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor(elapsedBeforePauseRef.current / 1000 + (Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    setState('recording');
  }, []);

  const stopAndUpload = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop recorder and collect final chunks (works from both 'recording' and 'paused' states)
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    // Stop all tracks (releases mic)
    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;

    setState('uploading');
    setUploadProgress(0);

    const capturedMimeType = mimeTypeRef.current;
    const rawBlob = new Blob(chunksRef.current, { type: capturedMimeType });
    const durationMs = Date.now() - startTimeRef.current;
    // fixWebmDuration only applies to WebM containers
    const blob = capturedMimeType.includes('webm')
      ? await fixWebmDuration(rawBlob, durationMs)
      : rawBlob;
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
        body: JSON.stringify({ filename: 'recording.webm', mimeType: capturedMimeType }),
      });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { signedUrl, storagePath } = await presignRes.json();

      // 2. Upload via XHR for progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', capturedMimeType);
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
    setRecordingNoteIdState(noteId);
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
    elapsedBeforePauseRef.current = 0;
    setState('idle');
    setElapsed(0);
    setUploadProgress(0);
    setErrorMessage('');
    setLiveNotes('');
    liveNotesRef.current = '';
    setRecordingNoteIdState(undefined);
  }, []);

  return {
    state,
    elapsed,
    uploadProgress,
    errorMessage,
    liveNotes,
    setLiveNotes,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopAndUpload,
    reset,
    recordingTitle,
    recordingEventId,
    recordingNoteId,
    setRecordingNoteId,
    awaySeconds,
  };
}
