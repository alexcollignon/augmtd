'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  XMarkIcon,
  MicrophoneIcon,
  LockClosedIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import MeetingRecorder from './meeting-recorder';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendarEventId?: string;
  prefilledTitle?: string;
  onBotSent?: () => void;
}

type Mode = null | 'record' | 'bot';

export default function CaptureModal({
  isOpen,
  onClose,
  calendarEventId,
  prefilledTitle = '',
  onBotSent,
}: CaptureModalProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [title, setTitle] = useState(prefilledTitle);
  const [transcribing, setTranscribing] = useState(false);

  const [botUrl, setBotUrl] = useState('');
  const [botState, setBotState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [botError, setBotError] = useState('');

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setMode(null);
      setTitle(prefilledTitle);
      setTranscribing(false);
      setBotUrl('');
      setBotState('idle');
      setBotError('');
    }
  }, [isOpen, prefilledTitle]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg mx-4 bg-white shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-900">Capture Meeting</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5">Record in-person or send an AI assistant to a Google Meet</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-neutral-100 rounded transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">
          {/* Mode picker */}
          {!mode && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('record')}
                className="flex flex-col items-center gap-3 p-5 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-center group"
              >
                <div className="w-9 h-9 bg-red-50 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                  <MicrophoneIcon className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-neutral-900">Record</p>
                  <p className="text-[10px] text-neutral-500 mt-0.5">In-person or phone meeting</p>
                </div>
              </button>

              <button
                onClick={() => setMode('bot')}
                className="flex flex-col items-center gap-3 p-5 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-center group"
              >
                <div className="w-9 h-9 bg-violet-50 flex items-center justify-center group-hover:bg-violet-100 transition-colors">
                  <VideoCameraIcon className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-neutral-900">Meeting assistant</p>
                  <p className="text-[10px] text-neutral-500 mt-0.5">Any Google Meet — scheduled or impromptu</p>
                </div>
              </button>
            </div>
          )}

          {/* Meeting details + capture */}
          {mode && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-neutral-700">
                  {mode === 'record' ? 'Record meeting' : 'Send meeting assistant'}
                </p>
                <button
                  onClick={() => setMode(null)}
                  className="text-[11px] text-neutral-400 hover:text-neutral-600"
                >
                  ← Change
                </button>
              </div>

              {/* Title — not needed for bot mode */}
              {mode !== 'bot' && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">Meeting title *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Q2 Revenue Planning"
                    className="w-full px-3 py-2 text-[13px] border border-neutral-200 focus:border-indigo-400 focus:outline-none"
                  />
                </div>
              )}

              {/* Record mode */}
              {mode === 'record' && (
                <MeetingRecorder
                  calendarEventId={calendarEventId}
                  meetingTitle={title || 'Untitled meeting'}
                  onTranscriptReady={() => {
                    new BroadcastChannel('meetings-updated').postMessage('recorded');
                    setTranscribing(true);
                  }}
                />
              )}

              {/* Bot mode */}
              {mode === 'bot' && botState === 'idle' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-600 mb-1">Google Meet link</label>
                    <input
                      type="url"
                      value={botUrl}
                      onChange={(e) => setBotUrl(e.target.value)}
                      placeholder="https://meet.google.com/xxx-xxxx-xxx"
                      className="w-full px-3 py-2 text-[13px] border border-neutral-200 focus:border-indigo-400 focus:outline-none"
                    />
                    <p className="text-[11px] text-neutral-400 mt-1">The assistant will join the call within 30 seconds and transcribe automatically.</p>
                  </div>
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
                    className="w-full py-2.5 text-[13px] font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Send assistant
                  </button>
                  {botError && <p className="text-[12px] text-red-600">{botError}</p>}
                </div>
              )}
              {mode === 'bot' && botState === 'sending' && (
                <p className="text-[13px] text-neutral-600 italic">Scheduling assistant…</p>
              )}
              {mode === 'bot' && botState === 'done' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-100">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                    <div>
                      <p className="text-[13px] font-medium text-emerald-800">Assistant joining in ~30 seconds</p>
                      <p className="text-[11px] text-emerald-600 mt-0.5">The transcript will appear in Recent meetings once the call ends.</p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="w-full py-2 text-[13px] font-medium text-neutral-600 border border-neutral-200 hover:bg-neutral-50 transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
              {mode === 'bot' && botState === 'error' && (
                <div>
                  <p className="text-[13px] text-red-700 mb-2">{botError}</p>
                  <button onClick={() => { setBotState('idle'); setBotError(''); }} className="text-[12px] text-neutral-500 underline">Try again</button>
                </div>
              )}
            </>
          )}

          {/* Transcribing banner — shown after record completes */}
          {transcribing && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-100">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <div>
                  <p className="text-[13px] font-medium text-emerald-800">Transcribing your meeting…</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">Action items will appear in your inbox once done. You can close this.</p>
                </div>
              </div>
              <button
                onClick={() => { onClose(); router.refresh(); }}
                className="w-full py-2 text-[13px] font-medium text-neutral-600 border border-neutral-200 hover:bg-neutral-50 transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {/* Privacy badge */}
          <div className="border border-neutral-100 bg-neutral-50 px-4 py-3 flex items-start gap-3">
            <LockClosedIcon className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-neutral-500">
              <span className="font-medium text-neutral-700">Private cloud processing — </span>
              audio is processed and stored entirely inside your company environment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
