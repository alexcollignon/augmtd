'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import fixWebmDuration from 'fix-webm-duration';
import { vaultSaveMeta, vaultPatchMeta, vaultSaveChunk, vaultDelete } from '@/lib/recording/vault';

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
  /** Re-attempt a failed upload — the audio blob is kept in memory until it lands. */
  retryUpload: () => Promise<void>;
  /** Save the recorded audio to the user's device (escape hatch when upload keeps failing). */
  downloadRecording: () => void;
  /** True while a finished recording is held locally awaiting a (re)upload. */
  hasPendingUpload: boolean;
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
  const [hasPendingUpload, setHasPendingUpload] = useState(false);

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
  // Wall-clock instant the recording STARTED (never reset on resume — startTimeRef is).
  const recordingStartedAtRef = useRef<number>(0);
  // The vault session mirroring this recording to IndexedDB (crash/close recovery).
  const vaultIdRef = useRef<string | null>(null);
  const vaultSeqRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // A finished-but-not-yet-landed recording. Held until the confirm succeeds so a failed
  // upload is retryable (and downloadable) instead of silently destroying the audio.
  const pendingUploadRef = useRef<{
    blob: Blob;
    mimeType: string;
    title: string;
    calendarEventId?: string;
    startTime: string;
    endTime: string;
    notes: string;
    /** Set once the storage PUT succeeds — a retry then skips straight to confirm. */
    storagePath?: string;
  } | null>(null);

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

  // beforeunload guard while audio is at risk in this tab: recording, paused, mid-upload,
  // or a failed upload still holding the blob. (The vault makes a forced close recoverable,
  // but warning first is still the kinder path.)
  useEffect(() => {
    const atRisk = state === 'recording' || state === 'paused' || state === 'uploading' || (state === 'error' && hasPendingUpload);
    if (!atRisk) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state, hasPendingUpload]);

  // Vault heartbeat — while this tab owns a session, stamp liveness every 5s so the
  // recovery banner (any tab, any later visit) can tell a live session from a dead one.
  useEffect(() => {
    const owning = state === 'recording' || state === 'paused' || state === 'uploading' || state === 'processing' || (state === 'error' && hasPendingUpload);
    if (!owning || !vaultIdRef.current) {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      return;
    }
    const beat = () => { if (vaultIdRef.current) void vaultPatchMeta(vaultIdRef.current, { heartbeatAt: Date.now() }); };
    beat();
    heartbeatRef.current = setInterval(beat, 5000);
    return () => {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    };
  }, [state, hasPendingUpload]);

  const startRecording = useCallback(async (title: string, calendarEventId?: string, existingNoteId?: string) => {
    try {
      // Mono is all speech needs, and Whisper downmixes anyway.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''].find(
        (t) => t === '' || MediaRecorder.isTypeSupported(t),
      ) ?? '';
      mimeTypeRef.current = mimeType || 'audio/webm';
      // Speech-tuned bitrate: Opus is transparent for voice at 32 kbps mono (~14 MB/hour vs
      // ~58 MB/hour at the browser default — a long conference session stays uploadable).
      // AAC (Safari's audio/mp4) degrades faster at low bitrates, so give it more headroom.
      const audioBitsPerSecond = mimeType.includes('webm') ? 32_000 : 48_000;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond })
        : new MediaRecorder(stream, { audioBitsPerSecond });
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
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Mirror every chunk to the vault — a crash loses at most ~1s of audio.
          if (vaultIdRef.current) void vaultSaveChunk(vaultIdRef.current, vaultSeqRef.current++, e.data);
        }
      };

      // Open the vault session BEFORE the first chunk lands.
      vaultIdRef.current = crypto.randomUUID();
      vaultSeqRef.current = 0;
      void vaultSaveMeta({
        id: vaultIdRef.current,
        title,
        calendarEventId,
        noteId: existingNoteId,
        mimeType: mimeTypeRef.current,
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        stage: 'recording',
      });

      recorder.start(1000);
      startTimeRef.current = Date.now();
      recordingStartedAtRef.current = Date.now();
      pendingUploadRef.current = null;
      setHasPendingUpload(false);
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

  // The (re)tryable upload half: presign → PUT → confirm, working off pendingUploadRef.
  // The blob is released only after the confirm succeeds — a failure at any step leaves
  // everything in place for retryUpload()/downloadRecording().
  const performUpload = useCallback(async () => {
    const pending = pendingUploadRef.current;
    if (!pending) return;

    try {
      // 1+2. Presign + PUT — skipped on retry when the audio already landed and only
      // the confirm step failed.
      if (!pending.storagePath) {
        const presignRes = await fetch('/api/meetings/recordings/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: 'recording.webm', mimeType: pending.mimeType }),
        });
        if (!presignRes.ok) throw new Error('Failed to get upload URL');
        const { signedUrl, storagePath } = await presignRes.json();

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', signedUrl);
          xhr.setRequestHeader('Content-Type', pending.mimeType);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
          xhr.onerror = () => reject(new Error('Upload network error'));
          xhr.send(pending.blob);
        });
        pending.storagePath = storagePath;
        // Vault: a recovery after a crash here skips straight to confirm.
        if (vaultIdRef.current) void vaultPatchMeta(vaultIdRef.current, { storagePath });
      }

      // 3. Confirm — fire-and-forget transcription (include live notes)
      setState('processing');
      console.log('[Recording] confirm sending with existingNoteId:', noteIdRef.current);
      const confirmRes = await fetch('/api/meetings/recordings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath: pending.storagePath,
          calendarEventId: pending.calendarEventId,
          title: pending.title,
          startTime: pending.startTime,
          endTime: pending.endTime,
          liveNotes: pending.notes || undefined,
          existingNoteId: noteIdRef.current || undefined,
        }),
      });
      if (!confirmRes.ok) throw new Error('Failed to start transcription');

      // Landed — release the blob and clear the vault session.
      pendingUploadRef.current = null;
      setHasPendingUpload(false);
      if (vaultIdRef.current) { void vaultDelete(vaultIdRef.current); vaultIdRef.current = null; }
      setState('done');
      onTranscriptReady?.();
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Upload failed');
      setState('error');
    }
  }, [onTranscriptReady]);

  const stopAndUpload = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // True actively-recorded time (pauses excluded) — must be read BEFORE stop().
    const wasRecording = recorder.state === 'recording';
    const recordedMs = elapsedBeforePauseRef.current + (wasRecording ? Date.now() - startTimeRef.current : 0);

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
    // fixWebmDuration only applies to WebM containers
    const blob = capturedMimeType.includes('webm')
      ? await fixWebmDuration(rawBlob, recordedMs)
      : rawBlob;

    pendingUploadRef.current = {
      blob,
      mimeType: capturedMimeType,
      title: titleRef.current || 'Untitled meeting',
      calendarEventId: eventIdRef.current,
      startTime: new Date(recordingStartedAtRef.current || startTimeRef.current).toISOString(),
      endTime: new Date().toISOString(),
      notes: liveNotesRef.current,
      // noteIdRef intentionally NOT captured — read lazily at confirm time so any
      // setRecordingNoteId calls during upload are picked up.
    };
    setHasPendingUpload(true);
    chunksRef.current = [];

    // Vault: the finalized blob supersedes the chunk stream from here on.
    if (vaultIdRef.current) {
      void vaultPatchMeta(vaultIdRef.current, {
        stage: 'pending',
        finalBlob: blob,
        endTime: Date.now(),
        notes: liveNotesRef.current || undefined,
        noteId: noteIdRef.current,
        heartbeatAt: Date.now(),
      });
    }

    await performUpload();
  }, [performUpload]);

  const retryUpload = useCallback(async () => {
    if (!pendingUploadRef.current) return;
    setErrorMessage('');
    setState('uploading');
    setUploadProgress(0);
    await performUpload();
  }, [performUpload]);

  // Escape hatch: save the audio locally so a persistent upload failure never costs the meeting.
  const downloadRecording = useCallback(() => {
    const pending = pendingUploadRef.current;
    if (!pending) return;
    const ext = pending.mimeType.includes('mp4') ? 'm4a' : 'webm';
    const safeTitle = (pending.title || 'recording').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const url = URL.createObjectURL(pending.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);

  // Update the note id that will be passed to the confirm route on stop.
  // Call this when a text note row is created during an active recording.
  const setRecordingNoteId = useCallback((noteId: string) => {
    console.log('[Recording] setRecordingNoteId:', noteId, 'state:', state);
    noteIdRef.current = noteId;
    setRecordingNoteIdState(noteId);
    if (vaultIdRef.current) void vaultPatchMeta(vaultIdRef.current, { noteId });
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
    pendingUploadRef.current = null;
    setHasPendingUpload(false);
    chunksRef.current = [];
    // Reset is the user's explicit discard — the vault copy goes with it.
    if (vaultIdRef.current) { void vaultDelete(vaultIdRef.current); vaultIdRef.current = null; }
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
    retryUpload,
    downloadRecording,
    hasPendingUpload,
    reset,
    recordingTitle,
    recordingEventId,
    recordingNoteId,
    setRecordingNoteId,
    awaySeconds,
  };
}
