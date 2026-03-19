'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ClockIcon,
  UserGroupIcon,
  CheckCircleIcon,
  BoltIcon,
  VideoCameraIcon,
  MicrophoneIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  InboxArrowDownIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import { formatMeetingTime, calculateDuration } from '@/lib/types/meetings';
import LinkedWorkPanel from '@/components/meetings/linked-work-panel';
import MeetingRecorder from '@/components/meetings/meeting-recorder';

interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

interface Decision {
  text: string;
  owner?: string;
  date?: string;
}

interface KeyMoment {
  segmentIndex: number;
  type: 'decision' | 'risk' | 'commitment';
  text: string;
}

interface Risk {
  text: string;
  severity: 'high' | 'medium' | 'low';
}

interface ActionItem {
  id: string;
  workTitle: string;
  whyMatters: string;
  priority: number;
  source: string;
  assignee: string | null;
  category: string;
}

interface MeetingTranscript {
  id: string;
  summary: string | null;
  decisions: Decision[];
  keyMoments: KeyMoment[];
  transcriptSegments: TranscriptSegment[];
  durationMinutes: number;
  workItemsGenerated: number;
  source: string;
}

interface MeetingDetailClientProps {
  event: CalendarEvent;
  transcript: MeetingTranscript | null;
  actionItems: ActionItem[];
  risks: Risk[];
  suggestedNextStep: string | null;
}

const KEY_MOMENT_COLORS: Record<KeyMoment['type'], string> = {
  decision: 'bg-blue-50 border-l-2 border-blue-400',
  risk: 'bg-red-50 border-l-2 border-red-400',
  commitment: 'bg-amber-50 border-l-2 border-amber-400',
};

const KEY_MOMENT_BADGES: Record<KeyMoment['type'], string> = {
  decision: 'text-blue-700 bg-blue-100',
  risk: 'text-red-700 bg-red-100',
  commitment: 'text-amber-700 bg-amber-100',
};

const RISK_DOT: Record<Risk['severity'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-neutral-300',
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}


export default function MeetingDetailClient({
  event,
  transcript,
  actionItems,
  risks,
  suggestedNextStep,
}: MeetingDetailClientProps) {
  const router = useRouter();
  const [transcriptKey, setTranscriptKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [itemSources, setItemSources] = useState<Record<string, string>>(() =>
    Object.fromEntries(actionItems.map((item) => [item.id, item.source]))
  );
  const [promoting, setPromoting] = useState<string | null>(null);

  const promoteToInbox = async (itemId: string) => {
    setPromoting(itemId);
    try {
      const res = await fetch(`/api/meetings/action-items/${itemId}/promote`, { method: 'PATCH' });
      if (res.ok) setItemSources((prev) => ({ ...prev, [itemId]: 'meeting_action' }));
    } finally {
      setPromoting(null);
    }
  };
  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/meetings/${event.id}/transcript`, { method: 'DELETE' });
      new BroadcastChannel('meetings-updated').postMessage('deleted');
      router.push('/meetings');
    } finally {
      setDeleting(false);
    }
  };

  const keyMomentMap = new Map<number, KeyMoment>();
  transcript?.keyMoments?.forEach((km) => keyMomentMap.set(km.segmentIndex, km));

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[12px] text-neutral-400 mb-4">
            <Link href="/meetings" className="hover:text-neutral-600 transition-colors">Meetings</Link>
            <span>/</span>
            <span className="text-neutral-600 truncate">{event.title}</span>
          </div>

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h1 className="text-xl font-semibold text-neutral-900">{event.title}</h1>
              {transcript && !confirmDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex-shrink-0 p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  title="Delete recording & transcript"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
              {transcript && confirmDelete && (
                <div className="flex-shrink-0 flex items-center gap-2">
                  <span className="text-[11px] text-neutral-500">Delete recording?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-2.5 py-1 rounded transition-colors"
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-[11px] text-neutral-500 hover:text-neutral-700"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-neutral-500">
              <span className="flex items-center gap-1">
                <ClockIcon className="w-3.5 h-3.5" />
                {primary} · {duration}min
              </span>
              {event.attendees.length > 0 && (
                <span className="flex items-center gap-1">
                  <UserGroupIcon className="w-3.5 h-3.5" />
                  {event.attendees.map((a) => a.name?.split(' ')[0] || a.email?.split('@')[0]).join(', ')}
                </span>
              )}
              {event.meeting_link && (
                <a
                  href={event.meeting_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <VideoCameraIcon className="w-3.5 h-3.5" />
                  Join
                </a>
              )}
              {transcript && (
                <span className="flex items-center gap-1">
                  <MicrophoneIcon className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-700 font-medium">Recorded</span>
                </span>
              )}
            </div>

            {/* Attendee avatar chips */}
            {event.attendees.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3">
                {event.attendees.slice(0, 5).map((a, i) => (
                  <div
                    key={i}
                    title={a.name || a.email || undefined}
                    className="w-6 h-6 rounded-full bg-neutral-200 flex items-center justify-center text-[10px] font-medium text-neutral-600 flex-shrink-0"
                  >
                    {getInitials(a.name, a.email)}
                  </div>
                ))}
                {event.attendees.length > 5 && (
                  <div className="w-6 h-6 rounded-full bg-neutral-200 flex items-center justify-center text-[10px] font-medium text-neutral-600 flex-shrink-0">
                    +{event.attendees.length - 5}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* No transcript yet — show recorder */}
          {!transcript && (
            <div className="border border-dashed border-neutral-200 p-6 mb-6">
              <h2 className="text-[13px] font-semibold text-neutral-900 mb-1">Record this meeting</h2>
              <p className="text-[12px] text-neutral-500 mb-4">
                Use your microphone to capture the conversation. Transcript and action items will be generated automatically.
              </p>
              <MeetingRecorder
                calendarEventId={event.id}
                meetingTitle={event.title}
                onTranscriptReady={() => setTranscriptKey((k) => k + 1)}
              />
            </div>
          )}

          {/* Summary */}
          {transcript?.summary && (
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">Summary</h2>
              <p className="text-[13px] text-neutral-700 leading-relaxed bg-neutral-50 border border-neutral-100 px-4 py-3">
                {transcript.summary}
              </p>
            </section>
          )}

          {/* Decisions */}
          {transcript && transcript.decisions?.length > 0 && (
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
                        <p className="text-[11px] text-neutral-400 mt-0.5">
                          {[d.owner, d.date].filter(Boolean).join(' · ')}
                        </p>
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
                {actionItems.map((item) => {
                  const currentSource = itemSources[item.id] ?? item.source;
                  const inInbox = currentSource === 'meeting_action';
                  return (
                    <div key={item.id} className="flex items-start gap-3 px-4 py-2.5 bg-white border border-neutral-100">
                      <BoltIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-neutral-800">{item.workTitle}</p>
                        {item.whyMatters && (
                          <p className="text-[11px] text-neutral-500 mt-0.5">{item.whyMatters}</p>
                        )}
                        {item.assignee && (
                          <span className="inline-block mt-1 text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5">
                            {item.assignee}
                          </span>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                        <span className="text-[10px] font-medium text-neutral-400 capitalize">{item.category}</span>
                        {inInbox ? (
                          <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                            <InboxArrowDownIcon className="w-3 h-3" />
                            In inbox ✓
                          </span>
                        ) : (
                          <button
                            onClick={() => promoteToInbox(item.id)}
                            disabled={promoting === item.id}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 disabled:opacity-50"
                          >
                            <InboxArrowDownIcon className="w-3 h-3" />
                            {promoting === item.id ? '…' : 'Send to inbox'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
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
          {transcript && transcript.transcriptSegments?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                Transcript
                <span className="ml-2 text-neutral-400 normal-case font-normal">
                  {transcript.transcriptSegments.length} segments · {transcript.durationMinutes}min
                </span>
              </h2>
              <div className="space-y-0.5 border border-neutral-100 bg-white max-h-[500px] overflow-y-auto">
                {transcript.transcriptSegments.map((seg, idx) => {
                  const km = keyMomentMap.get(idx);
                  return (
                    <div
                      key={idx}
                      className={`px-4 py-2.5 ${km ? KEY_MOMENT_COLORS[km.type] : 'border-b border-neutral-50'}`}
                    >
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

          {/* No content at all */}
          {!transcript && transcriptKey > 0 && (
            <div className="text-[13px] text-neutral-500 italic">
              Processing your recording — check back in a minute.
            </div>
          )}
        </div>
      </div>

      {/* Linked work sidebar */}
      <div className="w-72 flex-shrink-0 border-l border-neutral-100 bg-white overflow-y-auto px-5 py-6">
        <LinkedWorkPanel calendarEventId={event.id} />
      </div>
    </div>
  );
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
