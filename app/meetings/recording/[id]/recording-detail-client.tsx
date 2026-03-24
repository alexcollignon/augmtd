'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ClockIcon,
  CheckCircleIcon,
  BoltIcon,
  MicrophoneIcon,
  CloudArrowUpIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { formatMeetingTime } from '@/lib/types/meetings';
import ProcessingPipeline from '@/components/meetings/processing-pipeline';

interface TranscriptSegment { speaker: string; text: string; timestamp: number }
interface Decision { text: string; owner?: string; date?: string }
interface KeyMoment { segmentIndex: number; type: 'decision' | 'risk' | 'commitment'; text: string }
interface Risk { text: string; severity: 'high' | 'medium' | 'low' }
interface ActionItem { id: string; workTitle: string; whyMatters: string; priority: number; source: string; assignee: string | null; category: string }

interface RecordingDetailClientProps {
  transcript: {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    source: string;
    processed: boolean;
    botState: string | null;
    summary: string | null;
    decisions: Decision[];
    keyMoments: KeyMoment[];
    transcriptSegments: TranscriptSegment[];
    workItemsGenerated: number;
  };
  actionItems: ActionItem[];
  userId: string;
  risks: Risk[];
  suggestedNextStep: string | null;
  audioUrl?: string | null;
}

const RISK_DOT: Record<Risk['severity'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-neutral-300',
};

const KEY_MOMENT_COLORS = {
  decision: 'bg-blue-50 border-l-2 border-blue-400',
  risk: 'bg-red-50 border-l-2 border-red-400',
  commitment: 'bg-amber-50 border-l-2 border-amber-400',
};
const KEY_MOMENT_BADGES = {
  decision: 'text-blue-700 bg-blue-100',
  risk: 'text-red-700 bg-red-100',
  commitment: 'text-amber-700 bg-amber-100',
};

export default function RecordingDetailClient({ transcript, actionItems, risks, suggestedNextStep, audioUrl }: RecordingDetailClientProps) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Local state for polling
  const [localBotState, setLocalBotState] = useState(transcript.botState);
  const [localProcessed, setLocalProcessed] = useState(transcript.processed);

  // Add to desk
  const [addingToDesk, setAddingToDesk] = useState(false);
  const [addedToDesk, setAddedToDesk] = useState(false);

  // Duration: browser fires ondurationchange; webm starts as Infinity then resolves.
  // Seed from last segment timestamp so we show *something* before audio loads.
  const segmentDuration = transcript.transcriptSegments?.length > 0
    ? transcript.transcriptSegments[transcript.transcriptSegments.length - 1].timestamp
    : transcript.durationMinutes > 0 ? transcript.durationMinutes * 60 : null;
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const durationSeconds = audioDuration ?? segmentDuration;

  // Poll while processing
  useEffect(() => {
    if (localProcessed || localBotState === 'failed') return;
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/recording/${transcript.id}/status`);
        if (!res.ok) return;
        const data = await res.json();
        setLocalBotState(data.botState);
        if (data.processed) {
          setLocalProcessed(true);
          clearInterval(intervalId);
          router.refresh();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(intervalId);
  }, [localProcessed, localBotState, transcript.id, router]);

  const handleAddToDesk = async () => {
    setAddingToDesk(true);
    try {
      const res = await fetch(`/api/meetings/recording/${transcript.id}/add-to-desk`, { method: 'POST' });
      if (res.ok) setAddedToDesk(true);
    } finally {
      setAddingToDesk(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/meetings/recording/${transcript.id}/retry`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setRetryError(data?.error ?? 'Retry failed');
      } else {
        setLocalBotState('processing');
        setLocalProcessed(false);
        router.refresh();
      }
    } catch {
      setRetryError('Network error');
    } finally {
      setRetrying(false);
    }
  };

  const { primary } = formatMeetingTime(transcript.startTime, transcript.endTime);
  const keyMomentMap = new Map<number, KeyMoment>();
  transcript.keyMoments?.forEach((km) => keyMomentMap.set(km.segmentIndex, km));

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/meetings/recording/${transcript.id}`, { method: 'DELETE' });
      new BroadcastChannel('meetings-updated').postMessage('deleted');
      router.push('/meetings');
    } finally {
      setDeleting(false);
    }
  };

  const SourceIcon = transcript.source === 'upload' ? CloudArrowUpIcon : MicrophoneIcon;

  return (
    <div className="flex-1 overflow-y-auto h-full">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[12px] text-neutral-400 mb-4">
          <Link href="/meetings" className="hover:text-neutral-600 transition-colors">Meetings</Link>
          <span>/</span>
          <span className="text-neutral-600 truncate">{transcript.title}</span>
        </div>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 mb-2">
            <h1 className="text-xl font-semibold text-neutral-900">{transcript.title}</h1>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex-shrink-0 p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex-shrink-0 flex items-center gap-2">
                <span className="text-[11px] text-neutral-500">Delete recording?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-2.5 py-1 rounded transition-colors"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-[11px] text-neutral-500 hover:text-neutral-700">
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-[12px] text-neutral-500">
            <span className="flex items-center gap-1">
              <ClockIcon className="w-3.5 h-3.5" />
              {primary}{durationSeconds != null ? ` · ${fmtDuration(durationSeconds)}` : ''}
            </span>
            <span className="flex items-center gap-1">
              <SourceIcon className="w-3.5 h-3.5" />
              {transcript.source === 'upload' ? 'Uploaded' : 'Recorded'}
            </span>
          </div>
        </div>

        {/* Quick actions — shown when analysis is ready */}
        {localProcessed && (
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-neutral-100">
            <button
              onClick={handleAddToDesk}
              disabled={addingToDesk || addedToDesk}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50 transition-colors"
            >
              {addedToDesk ? 'On your desk ✓' : addingToDesk ? 'Adding…' : '+ Add to desk'}
            </button>
            <button
              onClick={() => router.push(`/work/new?fromRecording=${transcript.id}`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors"
            >
              Start workflow →
            </button>
          </div>
        )}

        {/* Processing pipeline */}
        {!localProcessed && localBotState !== 'failed' && (
          <div className="mb-6">
            <ProcessingPipeline
              source={transcript.source as 'bot' | 'recording' | 'upload'}
              botState={localBotState}
              processed={localProcessed}
            />
          </div>
        )}

        {/* Failed state */}
        {localBotState === 'failed' && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 mb-6 bg-red-50 border border-red-100">
            <div>
              <p className="text-[13px] font-medium text-red-700">Transcription failed</p>
              <p className="text-[12px] text-red-500 mt-0.5">
                {audioUrl ? 'The audio was saved — you can retry.' : 'No audio available to retry.'}
              </p>
              {retryError && <p className="text-[11px] text-red-600 mt-1">{retryError}</p>}
            </div>
            {audioUrl && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="flex-shrink-0 px-3 py-1.5 text-[12px] font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </div>
        )}

        {/* Audio player */}
        {audioUrl && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              Recording{durationSeconds != null && <span className="ml-1.5 font-normal normal-case text-neutral-400">{fmtDuration(durationSeconds)}</span>}
            </h2>
            <audio
              controls
              src={audioUrl}
              className="w-full h-9"
              style={{ accentColor: '#6366f1' }}
              onDurationChange={(e) => {
                const d = e.currentTarget.duration;
                if (isFinite(d) && d > 0) setAudioDuration(d);
              }}
            />
          </section>
        )}

        {/* Summary */}
        {transcript.summary && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">Summary</h2>
            <p className="text-[13px] text-neutral-700 leading-relaxed bg-neutral-50 border border-neutral-100 px-4 py-3">
              {transcript.summary}
            </p>
          </section>
        )}

        {/* Decisions */}
        {transcript.decisions?.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              Decisions ({transcript.decisions.length})
            </h2>
            <div className="space-y-1.5">
              {transcript.decisions.map((d, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2.5 bg-white border border-neutral-100">
                  <CheckCircleIcon className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-neutral-800">{d.text}</p>
                    {(d.owner || d.date) && (
                      <p className="text-[11px] text-neutral-400 mt-0.5">{[d.owner, d.date].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Action items */}
        {actionItems.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              Action items ({actionItems.length})
            </h2>
            <div className="space-y-1.5">
              {actionItems.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-2.5 bg-white border border-neutral-100">
                  <BoltIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-neutral-800">{item.workTitle}</p>
                    {item.whyMatters && <p className="text-[11px] text-neutral-500 mt-0.5">{item.whyMatters}</p>}
                    {item.assignee && (
                      <span className="inline-block mt-1 text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5">
                        {item.assignee}
                      </span>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-[10px] font-medium text-neutral-400 capitalize mt-0.5">{item.category}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Risks / Blockers */}
        {risks.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              Risks &amp; Blockers ({risks.length})
            </h2>
            <div className="space-y-1.5">
              {risks.map((risk, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2.5 bg-white border border-neutral-100">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${RISK_DOT[risk.severity]}`} />
                  <p className="text-[13px] text-neutral-800 flex-1 min-w-0">{risk.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Suggested next step */}
        {suggestedNextStep && (
          <div className="mb-6 flex items-start gap-2 pl-1">
            <span className="text-indigo-400 text-[13px] flex-shrink-0 mt-0.5">✦</span>
            <p className="text-[12px] text-neutral-600 leading-relaxed">{suggestedNextStep}</p>
          </div>
        )}

        {/* Transcript */}
        {transcript.transcriptSegments?.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              Transcript
              <span className="ml-2 text-neutral-400 normal-case font-normal">
                {transcript.transcriptSegments.length} segments{durationSeconds != null && ` · ${fmtDuration(durationSeconds)}`}
              </span>
            </h2>
            <div className="space-y-0.5 border border-neutral-100 bg-white max-h-[500px] overflow-y-auto">
              {transcript.transcriptSegments.map((seg, idx) => {
                const km = keyMomentMap.get(idx);
                return (
                  <div key={idx} className={`px-4 py-2.5 ${km ? KEY_MOMENT_COLORS[km.type] : 'border-b border-neutral-50'}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-semibold text-neutral-700">{seg.speaker}</span>
                      <span className="text-[10px] text-neutral-400">{formatTs(seg.timestamp)}</span>
                      {km && (
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 uppercase tracking-wide ${KEY_MOMENT_BADGES[km.type]}`}>
                          {km.type}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-neutral-700 leading-relaxed">{seg.text}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
