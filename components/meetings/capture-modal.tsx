'use client';

import { useState, useEffect } from 'react';
import {
  XMarkIcon,
  LockClosedIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import type { UseRecordingReturn } from '@/hooks/useRecording';
import MeetingRecorder from './meeting-recorder';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendarEventId?: string;
  prefilledTitle?: string;
  recording: UseRecordingReturn;
}

export default function CaptureModal({
  isOpen,
  onClose,
  calendarEventId,
  prefilledTitle = '',
  recording,
}: CaptureModalProps) {
  const [title, setTitle] = useState(prefilledTitle);

  const isRecording = recording.state === 'recording';
  const isPostRecording = recording.state === 'uploading' || recording.state === 'processing' || recording.state === 'done';

  useEffect(() => {
    if (isOpen && !isRecording && !isPostRecording) {
      setTitle(prefilledTitle);
    }
  }, [isOpen, prefilledTitle, isRecording, isPostRecording]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRecording) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, isRecording]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { if (!isRecording) onClose(); }} />

      <div className="relative w-full max-w-[380px] mx-4 bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="text-[15px] font-bold text-neutral-900">Record meeting</h2>
          <button
            onClick={onClose}
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
          {!isPostRecording && (
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

          {isPostRecording && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 px-4 py-3 bg-emerald-50 rounded-lg border border-emerald-100">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0 mt-1.5" />
                <div>
                  <p className="text-[13px] font-semibold text-emerald-800">Transcribing your meeting…</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">Action items will appear in your inbox once done. You can close this.</p>
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

          {!isPostRecording && !isRecording && (
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
