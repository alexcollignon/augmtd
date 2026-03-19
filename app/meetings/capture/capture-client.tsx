'use client';

import { useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  MicrophoneIcon,
  CloudArrowUpIcon,
  LockClosedIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import MeetingRecorder from '@/components/meetings/meeting-recorder';

type Mode = null | 'record' | 'upload';

export default function CaptureClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledEventId = searchParams.get('calendarEventId') ?? undefined;
  const prefilledTitle = searchParams.get('title') ?? '';

  const [mode, setMode] = useState<Mode>(null);
  const [title, setTitle] = useState(prefilledTitle);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!uploadFile || !title.trim()) return;
    setUploadState('uploading');
    setUploadProgress(0);
    setUploadError('');

    try {
      // Presign
      const presignRes = await fetch('/api/meetings/recordings/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: uploadFile.name, mimeType: uploadFile.type || 'audio/mpeg' }),
      });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { signedUrl, storagePath } = await presignRes.json();

      // XHR upload with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', uploadFile.type || 'audio/mpeg');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(uploadFile);
      });

      setUploadState('processing');
      const now = new Date().toISOString();
      const confirmRes = await fetch('/api/meetings/recordings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          calendarEventId: prefilledEventId ?? null,
          title: title.trim(),
          startTime: now,
          endTime: now,
          source: 'upload',
        }),
      });
      if (!confirmRes.ok) throw new Error('Failed to start transcription');

      setUploadState('done');
      setTimeout(() => router.push('/meetings'), 2000);
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed');
      setUploadState('error');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-white flex flex-col">
      {/* Header */}
      <div className="border-b border-neutral-100 bg-white px-6 py-4 flex items-center gap-3">
        <Link href="/meetings" className="p-1.5 hover:bg-neutral-100 rounded transition-colors">
          <ArrowLeftIcon className="w-4 h-4 text-neutral-500" />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-neutral-900">Capture Meeting</h1>
          <p className="text-[12px] text-neutral-500">Record or add a meeting securely inside your environment</p>
        </div>
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        {/* Capture options */}
        {!mode && (
          <div className="grid grid-cols-2 gap-4 mb-8">
            {/* Local recording */}
            <button
              onClick={() => setMode('record')}
              className="flex flex-col items-center gap-3 p-6 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-center group"
            >
              <div className="w-12 h-12 bg-red-50 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                <MicrophoneIcon className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-neutral-900">Start local recording</p>
                <p className="text-[11px] text-neutral-500 mt-1">
                  Record from your laptop or phone microphone. Perfect for in-person meetings.
                </p>
              </div>
            </button>

            {/* Upload audio */}
            <button
              onClick={() => setMode('upload')}
              className="flex flex-col items-center gap-3 p-6 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-center group"
            >
              <div className="w-12 h-12 bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <CloudArrowUpIcon className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-neutral-900">Upload audio</p>
                <p className="text-[11px] text-neutral-500 mt-1">
                  Upload an audio or video file from a past meeting for transcription and analysis.
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Meeting details form */}
        {mode && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-semibold text-neutral-900">Meeting details</h2>
              <button
                onClick={() => { setMode(null); setUploadFile(null); setUploadState('idle'); }}
                className="text-[12px] text-neutral-400 hover:text-neutral-600"
              >
                ← Change capture method
              </button>
            </div>

            <div className="space-y-3 mb-6">
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
            </div>

            {/* Record mode */}
            {mode === 'record' && (
              <div>
                <MeetingRecorder
                  calendarEventId={prefilledEventId}
                  meetingTitle={title || 'Untitled meeting'}
                  onTranscriptReady={() => setTimeout(() => router.push('/meetings'), 1500)}
                />
              </div>
            )}

            {/* Upload mode */}
            {mode === 'upload' && uploadState === 'idle' && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/mp4,video/webm"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
                {!uploadFile ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-neutral-200 hover:border-indigo-300 py-8 text-center transition-colors"
                  >
                    <CloudArrowUpIcon className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                    <p className="text-[13px] text-neutral-500">Click to select audio file</p>
                    <p className="text-[11px] text-neutral-400 mt-1">MP3, M4A, WAV, MP4, WebM</p>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-4 py-3 bg-neutral-50 border border-neutral-200">
                      <CloudArrowUpIcon className="w-5 h-5 text-blue-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-neutral-800 truncate">{uploadFile.name}</p>
                        <p className="text-[11px] text-neutral-400">{(uploadFile.size / 1024 / 1024).toFixed(1)} MB</p>
                      </div>
                      <button onClick={() => setUploadFile(null)} className="text-[11px] text-neutral-400 hover:text-neutral-600">Remove</button>
                    </div>
                    <button
                      onClick={handleUpload}
                      disabled={!title.trim()}
                      className="w-full py-2.5 text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Upload &amp; Transcribe
                    </button>
                  </div>
                )}
              </div>
            )}

            {uploadState === 'uploading' && (
              <div className="space-y-2">
                <p className="text-[13px] text-neutral-600">Uploading… {uploadProgress}%</p>
                <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            {uploadState === 'processing' && (
              <p className="text-[13px] text-neutral-600 italic">Transcribing… action items will appear in your inbox shortly.</p>
            )}

            {uploadState === 'done' && (
              <p className="text-[13px] text-green-700 font-medium">Submitted — redirecting to meetings…</p>
            )}

            {uploadState === 'error' && (
              <div>
                <p className="text-[13px] text-red-700 mb-2">{uploadError}</p>
                <button onClick={() => setUploadState('idle')} className="text-[12px] text-neutral-500 underline">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* Privacy badge */}
        <div className="border border-neutral-100 bg-neutral-50 px-4 py-3 flex items-start gap-3">
          <LockClosedIcon className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-medium text-neutral-800">Private cloud processing</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Your meeting data is processed and stored entirely inside your company environment. No public cloud storage. Captured inside your environment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
