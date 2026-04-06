'use client';

import { useState, useEffect } from 'react';
import {
  XMarkIcon,
  MicrophoneIcon,
  LockClosedIcon,
  VideoCameraIcon,
  ChevronLeftIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import type { UseRecordingReturn } from '@/hooks/useRecording';
import MeetingRecorder from './meeting-recorder';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendarEventId?: string;
  prefilledTitle?: string;
  onBotSent?: () => void;
  recording: UseRecordingReturn;
}

type Mode = null | 'record' | 'bot';

export default function CaptureModal({
  isOpen,
  onClose,
  calendarEventId,
  prefilledTitle = '',
  onBotSent,
  recording,
}: CaptureModalProps) {
  const [mode, setMode] = useState<Mode>(null);
  const [title, setTitle] = useState(prefilledTitle);

  const [botUrl, setBotUrl] = useState('');
  const [botState, setBotState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [botError, setBotError] = useState('');

  const isRecording = recording.state === 'recording';
  const isPostRecording = recording.state === 'uploading' || recording.state === 'processing' || recording.state === 'done';

  useEffect(() => {
    if (isOpen && !isRecording && !isPostRecording) {
      setMode(null);
      setTitle(prefilledTitle);
      setBotUrl('');
      setBotState('idle');
      setBotError('');
    }
    // When opening while already recording, go straight to record mode
    if (isOpen && isRecording) {
      setMode('record');
    }
  }, [isOpen, prefilledTitle, isRecording, isPostRecording]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // ESC is a no-op while recording — don't close
      if (e.key === 'Escape' && !isRecording) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, isRecording]);

  if (!isOpen) return null;

  const handleClose = () => {
    // If recording, just minimize (close modal overlay, recording continues)
    onClose();
  };

  const handleBackdropClick = () => {
    // Backdrop click is a no-op while recording
    if (!isRecording) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={handleBackdropClick} />

      <div className="relative w-full max-w-[380px] mx-4 bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            {mode && !isRecording && !isPostRecording && (
              <button
                onClick={() => setMode(null)}
                className="p-1 hover:bg-neutral-100 rounded-md transition-colors text-neutral-400 hover:text-neutral-600"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="text-[15px] font-bold text-neutral-900">
                {mode === 'record' ? 'Record meeting' : mode === 'bot' ? 'Meeting assistant' : 'Capture Meeting'}
              </h2>
              {!mode && !isPostRecording && (
                <p className="text-[12px] text-neutral-400 mt-0.5">Record in-person or send an AI assistant</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-neutral-100 rounded-md transition-colors"
            title={isRecording ? 'Minimize — recording continues in background' : 'Close'}
          >
            {isRecording ? (
              <ArrowDownTrayIcon className="w-4 h-4 text-neutral-400" />
            ) : (
              <XMarkIcon className="w-4 h-4 text-neutral-400" />
            )}
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Mode picker */}
          {!mode && !isPostRecording && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('record')}
                className="flex flex-col items-center gap-3 p-5 bg-neutral-50 rounded-lg hover:bg-neutral-100 transition-colors text-center group border border-transparent hover:border-neutral-200"
              >
                <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center group-hover:bg-red-100 transition-colors">
                  <MicrophoneIcon className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-neutral-900">Record</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">In-person or phone</p>
                </div>
              </button>

              <button
                onClick={() => setMode('bot')}
                className="flex flex-col items-center gap-3 p-5 bg-neutral-50 rounded-lg hover:bg-neutral-100 transition-colors text-center group border border-transparent hover:border-neutral-200"
              >
                <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center group-hover:bg-violet-100 transition-colors">
                  <VideoCameraIcon className="w-5 h-5 text-violet-500" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-neutral-900">AI Assistant</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">Any Google Meet</p>
                </div>
              </button>
            </div>
          )}

          {/* Record mode */}
          {mode === 'record' && !isPostRecording && (
            <div className="flex flex-col gap-4">
              {!isRecording && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1.5">Meeting title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Q2 Revenue Planning"
                    className="w-full px-3 py-2 text-[13px] border border-neutral-200 rounded-md outline-none focus:border-indigo-400 placeholder:text-neutral-400"
                  />
                </div>
              )}
              <MeetingRecorder
                state={recording.state}
                elapsed={recording.elapsed}
                uploadProgress={recording.uploadProgress}
                errorMessage={recording.errorMessage}
                onStart={() => recording.startRecording(title || 'Untitled meeting', calendarEventId)}
                onStop={recording.stopAndUpload}
                onReset={recording.reset}
              />
              {isRecording && (
                <p className="text-[11px] text-neutral-400">
                  You can close this panel — recording will continue in the background.
                </p>
              )}
            </div>
          )}

          {/* Bot mode */}
          {mode === 'bot' && botState === 'idle' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1.5">Google Meet link</label>
                <input
                  type="url"
                  value={botUrl}
                  onChange={(e) => setBotUrl(e.target.value)}
                  placeholder="https://meet.google.com/xxx-xxxx-xxx"
                  className="w-full px-3 py-2 text-[13px] border border-neutral-200 rounded-md outline-none focus:border-indigo-400 placeholder:text-neutral-400"
                />
                <p className="text-[11px] text-neutral-400 mt-1.5">The assistant will join within 30 seconds and transcribe automatically.</p>
              </div>
              {botError && <p className="text-[12px] text-red-600 -mt-1">{botError}</p>}
              <button
                onClick={async () => {
                  if (!botUrl.includes('meet.google.com')) {
                    setBotError('Only Google Meet links are supported');
                    return;
                  }
                  setBotState('sending');
                  setBotError('');
                  try {
                    const res = await fetch('/api/meetings/bot/adhoc', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ meetingUrl: botUrl }),
                    });
                    if (!res.ok) {
                      const d = await res.json();
                      throw new Error(d.error ?? 'Failed');
                    }
                    setBotState('done');
                    onBotSent?.();
                  } catch (err: any) {
                    setBotError(err.message ?? 'Failed to send meeting assistant');
                    setBotState('error');
                  }
                }}
                disabled={!botUrl.trim()}
                className="w-full py-2.5 text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                Send assistant
              </button>
            </div>
          )}

          {mode === 'bot' && botState === 'sending' && (
            <p className="text-[13px] text-neutral-500 text-center py-2">Scheduling assistant…</p>
          )}

          {mode === 'bot' && botState === 'error' && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-red-600">{botError}</p>
              <button
                onClick={() => { setBotState('idle'); setBotError(''); }}
                className="text-[12px] text-neutral-500 hover:text-neutral-700 underline text-left"
              >
                Try again
              </button>
            </div>
          )}

          {/* Success states */}
          {(botState === 'done' || isPostRecording) && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 px-4 py-3 bg-emerald-50 rounded-lg border border-emerald-100">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0 mt-1.5" />
                <div>
                  <p className="text-[13px] font-semibold text-emerald-800">
                    {isPostRecording ? 'Transcribing your meeting…' : 'Assistant joining in ~30 seconds'}
                  </p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">
                    {isPostRecording
                      ? 'Action items will appear in your inbox once done. You can close this.'
                      : 'The transcript will appear in Recent meetings once the call ends.'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-full py-2 text-[13px] font-medium text-neutral-600 border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {/* Privacy badge */}
          {!isPostRecording && botState !== 'done' && !isRecording && (
            <div className="bg-neutral-50 rounded-lg px-4 py-3 flex items-start gap-3 border border-neutral-100">
              <LockClosedIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-neutral-500">
                <span className="font-medium text-neutral-700">Private cloud processing — </span>
                audio is processed and stored entirely inside your company environment.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
