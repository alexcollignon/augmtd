'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/solid';

type RecorderState = 'idle' | 'recording' | 'uploading' | 'processing' | 'done' | 'error';

interface MeetingRecorderProps {
  calendarEventId?: string;
  meetingTitle: string;
  onTranscriptReady?: () => void;
}

export default function MeetingRecorder({
  calendarEventId,
  meetingTitle,
  onTranscriptReady,
}: MeetingRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0); // seconds
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100
  const [errorMessage, setErrorMessage] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const originalTitleRef = useRef<string>(typeof document !== 'undefined' ? document.title : '');

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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000); // collect chunks every second
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

    setState('uploading');
    setUploadProgress(0);

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const now = new Date();
    const startTime = new Date(startTimeRef.current).toISOString();
    const endTime = now.toISOString();

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

      // 3. Confirm — fire-and-forget transcription
      setState('processing');
      const confirmRes = await fetch('/api/meetings/recordings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          calendarEventId,
          title: meetingTitle,
          startTime,
          endTime,
        }),
      });
      if (!confirmRes.ok) throw new Error('Failed to start transcription');

      setState('done');
      onTranscriptReady?.();
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Upload failed');
      setState('error');
    }
  }, [calendarEventId, meetingTitle, onTranscriptReady]);

  return (
    <div className="flex flex-col gap-3">
      {state === 'idle' && (
        <button
          onClick={startRecording}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <MicrophoneIcon className="w-4 h-4" />
          Start Recording
        </button>
      )}

      {state === 'recording' && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-50 border border-red-200">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-mono font-medium text-red-700">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <button
            onClick={stopAndUpload}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
          >
            <StopIcon className="w-4 h-4" />
            Stop &amp; Transcribe
          </button>
        </div>
      )}

      {state === 'uploading' && (
        <div className="space-y-1.5">
          <p className="text-sm text-neutral-600">Uploading recording… {uploadProgress}%</p>
          <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {state === 'processing' && (
        <p className="text-sm text-neutral-600 italic">
          Transcribing… action items will appear in your inbox shortly.
        </p>
      )}

      {state === 'done' && (
        <p className="text-sm text-green-700 font-medium">
          Recording submitted — transcript processing in background.
        </p>
      )}

      {state === 'error' && (
        <div className="space-y-2">
          <p className="text-sm text-red-700">{errorMessage}</p>
          <button
            onClick={() => { setState('idle'); setErrorMessage(''); }}
            className="text-xs text-neutral-500 hover:text-neutral-700 underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
