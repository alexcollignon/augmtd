'use client';

import { MicrophoneIcon, StopIcon, PauseIcon, PlayIcon } from '@heroicons/react/24/solid';
import type { RecordingState } from '@/hooks/useRecording';

interface MeetingRecorderProps {
  /** If using the hook externally (background recording mode) */
  state: RecordingState;
  elapsed: number;
  uploadProgress: number;
  errorMessage: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
}

function formatElapsed(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function MeetingRecorder({
  state,
  elapsed,
  uploadProgress,
  errorMessage,
  onStart,
  onPause,
  onResume,
  onStop,
  onReset,
}: MeetingRecorderProps) {
  return (
    <div className="flex flex-col gap-3">
      {state === 'idle' && (
        <button
          onClick={onStart}
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
            onClick={onPause}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition-colors"
          >
            <PauseIcon className="w-4 h-4" />
            Pause
          </button>
          <button
            onClick={onStop}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
          >
            <StopIcon className="w-4 h-4" />
            Finish
          </button>
        </div>
      )}

      {state === 'paused' && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-sm font-mono font-medium text-amber-700">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <button
            onClick={onResume}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
          >
            <PlayIcon className="w-4 h-4" />
            Resume
          </button>
          <button
            onClick={onStop}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
          >
            <StopIcon className="w-4 h-4" />
            Finish
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
            onClick={onReset}
            className="text-xs text-neutral-500 hover:text-neutral-700 underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
