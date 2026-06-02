'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ClockIcon,
  CheckCircleIcon,
  BoltIcon,
  VideoCameraIcon,
  MicrophoneIcon,
  TrashIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';
import type { DriveFolder } from '@/lib/types/drive';
import type { CalendarEvent } from '@/lib/types/meetings';
import { formatMeetingTime, calculateDuration } from '@/lib/types/meetings';
import LinkedWorkPanel from '@/components/meetings/linked-work-panel';
import MeetingRecorder from '@/components/meetings/meeting-recorder';
import { useRecording } from '@/hooks/useRecording';
import { getTemplateNames } from '@/lib/meetings/templates';
import ProcessingPipeline from '@/components/meetings/processing-pipeline';
import MeetingChatSidebar, { type MeetingChatContext } from '@/components/meetings/meeting-chat-sidebar';

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

interface EnhancedNote {
  user_note: string;
  context: string;
}

interface NotesStructured {
  enhanced_notes?: EnhancedNote[];
  live_notes?: string;
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
  notesStructured?: NotesStructured | null;
  templateId?: string;
}

interface MeetingDetailClientProps {
  event: CalendarEvent;
  transcript: MeetingTranscript | null;
  actionItems: ActionItem[];
  risks: Risk[];
  suggestedNextStep: string | null;
  audioUrl?: string | null;
  transcriptBotState?: string | null;
  transcriptProcessed?: boolean;
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

function attendeeColor(key: string): string {
  const colors = [
    'bg-indigo-100 text-indigo-700',
    'bg-violet-100 text-violet-700',
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
  ];
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

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
  audioUrl,
  transcriptBotState,
  transcriptProcessed,
}: MeetingDetailClientProps) {
  const router = useRouter();
  const [transcriptKey, setTranscriptKey] = useState(0);
  const detailRecording = useRecording(() => setTranscriptKey((k) => k + 1));
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Local state for polling
  const [localBotState, setLocalBotState] = useState(transcriptBotState ?? null);
  const [localProcessed, setLocalProcessed] = useState(transcriptProcessed ?? false);
  const [localAttendeeState, setLocalAttendeeState] = useState(event.attendee_bot_state ?? null);


  // Per-meeting assistant toggle
  const [localAssistantState, setLocalAssistantState] = useState<string | null>(
    event.attendee_bot_state ?? (event.attendee_bot_id ? 'scheduled' : null)
  );
  const [schedulingBot, setSchedulingBot] = useState(false);
  const [cancellingBot, setCancellingBot] = useState(false);

  const segmentDuration = (transcript?.transcriptSegments?.length ?? 0) > 0
    ? transcript!.transcriptSegments[transcript!.transcriptSegments.length - 1].timestamp
    : (transcript?.durationMinutes ?? 0) > 0 ? transcript!.durationMinutes * 60 : null;
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const durationSeconds = audioDuration ?? segmentDuration;

  // Poll while transcript is being processed or bot is still active
  useEffect(() => {
    if (localProcessed || localBotState === 'failed') return;
    // Keep polling if bot is active even if transcript hasn't been loaded yet
    if (!transcript && !localAssistantState) return;
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/${event.id}/status`);
        if (!res.ok) return;
        const data = await res.json();
        setLocalAttendeeState(data.attendeeBotState);
        setLocalBotState(data.botState);
        if (data.attendeeBotState) setLocalAssistantState(data.attendeeBotState);
        if (data.processed) {
          setLocalProcessed(true);
          clearInterval(intervalId);
          router.refresh();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(intervalId);
  }, [localProcessed, localBotState, localAssistantState, transcript, event.id, router]);

  // Fetch folders for the folder chip
  useEffect(() => {
    fetch('/api/drive/folders')
      .then((r) => r.json())
      .then((data) => setFolders(Array.isArray(data) ? data : (data.folders ?? [])));
  }, []);

  const handleMoveToFolder = async (folderId: string | null) => {
    setMovingFolder(true);
    try {
      await fetch(`/api/meetings/${event.id}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      setCurrentFolderId(folderId);
    } finally {
      setMovingFolder(false);
      setFolderPopoverOpen(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/meetings/${event.id}/transcript/retry`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setRetryError(data?.error ?? 'Retry failed');
      } else {
        setLocalBotState('processing');
        setLocalAttendeeState(null);
        setLocalProcessed(false);
        router.refresh();
      }
    } catch {
      setRetryError('Network error');
    } finally {
      setRetrying(false);
    }
  };
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(event.folder_id ?? null);
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [movingFolder, setMovingFolder] = useState(false);
  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);

  const handleOpenWorkflow = (title: string, skill?: string) => {
    const params = new URLSearchParams();
    if (title) params.set('title', title);
    if (skill) params.set('skill', skill);
    router.push(`/work/new${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const buildMeetingContext = (): MeetingChatContext => ({
    title: event.title,
    date: event.start_time,
    durationMinutes: duration ?? undefined,
    attendees: event.attendees.map((a) => a.name || a.email || '').filter(Boolean),
    summary: transcript?.summary ?? undefined,
    decisions: transcript?.decisions?.map((d) => d.text) ?? [],
    actionItems: actionItems.map((a) => ({
      text: a.workTitle,
      assignee: a.assignee ?? undefined,
      status: a.category,
    })),
    risks: risks.map((r) => ({ description: r.text, severity: r.severity })),
    suggestedNextStep: suggestedNextStep ?? undefined,
  });

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
    <div className="flex h-full min-h-0 bg-neutral-50">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-8">
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
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {localProcessed && transcript && (
                  <button
                    onClick={() => setChatOpen((v) => !v)}
                    className={`p-1.5 border rounded-md transition-colors ${
                      chatOpen
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'
                    }`}
                    title="Ask AI about this meeting"
                  >
                    <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
                  </button>
                )}
                {transcript && !confirmDelete && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Delete recording & transcript"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                )}
                {transcript && confirmDelete && (
                  <div className="flex items-center gap-2">
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
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-neutral-500">
              <span className="flex items-center gap-1">
                <ClockIcon className="w-3.5 h-3.5" />
                {primary} · {duration}min
              </span>
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
              {event.meeting_link?.includes('meet.google.com') && !transcript && (
                localAssistantState === 'joining' ? (
                  <span className="text-[11px] font-medium text-amber-600">Joining…</span>
                ) : localAssistantState === 'recording' ? (
                  <span className="text-[11px] font-medium text-red-600">● Recording</span>
                ) : localAssistantState === 'done' ? (
                  <span className="text-[11px] font-medium text-neutral-400">Done</span>
                ) : localAssistantState === 'scheduled' ? (
                  cancellingBot ? (
                    <span className="text-[11px] font-medium text-neutral-400 animate-pulse">Removing assistant…</span>
                  ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-[11px] font-medium text-emerald-600">Assistant scheduled ✓</span>
                    <button
                      onClick={async () => {
                        setCancellingBot(true);
                        let success = false;
                        try {
                          const res = await fetch(`/api/meetings/${event.id}/cancel-bot`, { method: 'DELETE' });
                          success = res.ok;
                        } finally {
                          setCancellingBot(false);
                        }
                        if (success) { setLocalAssistantState(null); setLocalAttendeeState(null); }
                      }}
                      className="text-[11px] text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      × Remove
                    </button>
                  </span>
                  )
                ) : schedulingBot ? (
                  <span className="text-[11px] font-medium text-neutral-400 animate-pulse">Scheduling assistant…</span>
                ) : (
                  <button
                    onClick={async () => {
                      setSchedulingBot(true);
                      try {
                        const res = await fetch(`/api/meetings/${event.id}/schedule-bot`, { method: 'POST' });
                        if (res.ok) {
                          setLocalAssistantState('scheduled');
                          setLocalAttendeeState('scheduled');
                          // Don't reset schedulingBot — localAssistantState change handles the transition
                        } else {
                          setSchedulingBot(false);
                        }
                      } catch {
                        setSchedulingBot(false);
                      }
                    }}
                    className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Send assistant →
                  </button>
                )
              )}
              {transcript && (
                <span className="flex items-center gap-1">
                  <MicrophoneIcon className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-700 font-medium">Recorded</span>
                </span>
              )}
              {transcript && (
                <span className="text-[11px] text-neutral-400 bg-neutral-100 px-2 py-0.5">
                  {transcript.source === 'bot' ? 'Online' : transcript.source === 'recording' ? 'In-person' : 'Upload'}
                </span>
              )}
            </div>

            {/* Attendees as readable text */}
            {event.attendees.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {event.attendees.slice(0, 6).map((a, i) => {
                    const key = a.email ?? a.name ?? String(i);
                    const color = attendeeColor(key);
                    return (
                      <div
                        key={i}
                        title={a.name || a.email || '?'}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ring-2 ring-white ${color}`}
                      >
                        {getInitials(a.name, a.email)}
                      </div>
                    );
                  })}
                </div>
                <span className="text-[12px] text-neutral-500">
                  {event.attendees.length <= 3
                    ? event.attendees.map((a) => (a.name || a.email || '').split(/\s+/)[0]).join(', ')
                    : `${event.attendees.slice(0, 2).map((a) => (a.name || a.email || '').split(/\s+/)[0]).join(', ')} & ${event.attendees.length - 2} others`}
                </span>
              </div>
            )}

            {/* Folder chip */}
            {currentFolderId && (
              <div className="relative mt-2">
                <button
                  onClick={() => setFolderPopoverOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 bg-neutral-50 border border-neutral-100 px-2 py-0.5 transition-colors"
                  title="Change folder"
                >
                  <FolderIcon className="w-3 h-3" />
                  {folders.find((f) => f.id === currentFolderId)?.name ?? 'Folder'}
                </button>
                {folderPopoverOpen && (
                  <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-neutral-200 shadow-md min-w-[160px] py-1">
                    <button
                      onClick={() => handleMoveToFolder(null)}
                      disabled={movingFolder}
                      className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 transition-colors"
                    >
                      Remove from folder
                    </button>
                    <div className="border-t border-neutral-100 my-1" />
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => handleMoveToFolder(folder.id)}
                        disabled={movingFolder}
                        className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-1.5 hover:bg-neutral-50 transition-colors ${
                          currentFolderId === folder.id ? 'text-neutral-900 font-medium' : 'text-neutral-600'
                        }`}
                      >
                        <FolderIcon className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Processing pipeline — show when transcript is processing or bot is active */}
          {!localProcessed && localBotState !== 'failed' &&
            (transcript || localAssistantState === 'joining' || localAssistantState === 'recording') && (
            <div className="mb-6">
              <ProcessingPipeline
                source={(transcript?.source ?? 'bot') as 'bot' | 'recording' | 'upload'}
                attendeeBotState={localAttendeeState}
                botState={localBotState}
                processed={localProcessed}
              />
            </div>
          )}

          {/* Failed state */}
          {transcript && localBotState === 'failed' && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 mb-6 bg-red-50 rounded-lg">
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

          {/* No transcript yet — show recorder */}
          {!transcript && (
            <div className="rounded-lg border border-dashed border-neutral-200 p-6 mb-6">
              <h2 className="text-[13px] font-semibold text-neutral-900 mb-1">Record this meeting</h2>
              <p className="text-[12px] text-neutral-500 mb-4">
                Use your microphone to capture the conversation. Transcript and action items will be generated automatically.
              </p>
              <MeetingRecorder
                state={detailRecording.state}
                elapsed={detailRecording.elapsed}
                uploadProgress={detailRecording.uploadProgress}
                errorMessage={detailRecording.errorMessage}
                onStart={() => detailRecording.startRecording(event.title, event.id)}
                onPause={detailRecording.pauseRecording}
                onResume={detailRecording.resumeRecording}
                onStop={detailRecording.stopAndUpload}
                onReset={detailRecording.reset}
              />
            </div>
          )}

          {/* Enhanced notes — user notes with AI context (Granola-style) */}
          {transcript?.notesStructured?.enhanced_notes && transcript.notesStructured.enhanced_notes.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-3">Your Notes</h2>
              <div className="space-y-4">
                {transcript.notesStructured.enhanced_notes.map((note, i) => (
                  <div key={i}>
                    <p className="text-[14px] font-medium text-neutral-900 leading-relaxed">{note.user_note}</p>
                    <div className="mt-1.5 border-l-2 border-neutral-200 pl-3">
                      <p className="text-[13px] text-neutral-500 leading-relaxed">{note.context}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Summary */}
          {transcript?.summary && (
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Summary</h2>
              <p className="text-[14px] text-neutral-700 leading-relaxed">
                {transcript.summary}
              </p>
            </section>
          )}

          {/* Decisions — clean document style */}
          {transcript && transcript.decisions?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                Decisions
              </h2>
              <div className="space-y-2">
                {transcript.decisions.map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircleIcon className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-neutral-800 leading-relaxed">{d.text}</p>
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

          {/* Action items — checkbox style */}
          {actionItems.length > 0 && (
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                Action Items
              </h2>
              <div className="space-y-2">
                {actionItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-300 flex-shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] leading-relaxed text-neutral-800">
                        {item.workTitle}
                        {item.assignee && (
                          <span className="ml-1.5 text-[11px] text-neutral-400 font-normal">— {item.assignee}</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Risks / Blockers */}
          {risks.length > 0 && (
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                Risks &amp; Blockers
              </h2>
              <div className="space-y-2">
                {risks.map((risk, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${RISK_DOT[risk.severity]}`} />
                    <p className="text-[13px] text-neutral-800 leading-relaxed flex-1 min-w-0">{risk.text}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Suggested next step */}
          {suggestedNextStep && (
            <div className="mb-6 flex items-start gap-2">
              <span className="text-indigo-400 text-[13px] flex-shrink-0 mt-0.5">✦</span>
              <p className="text-[13px] text-neutral-600 leading-relaxed">{suggestedNextStep}</p>
            </div>
          )}

          {/* Related work — inline section */}
          {localProcessed && (
            <section className="mb-6">
              <LinkedWorkPanel calendarEventId={event.id} />
            </section>
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

          {/* Transcript */}
          {transcript && transcript.transcriptSegments?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                Transcript
                <span className="ml-2 text-neutral-400 normal-case font-normal">
                  {transcript.transcriptSegments.length} segments{durationSeconds != null && ` · ${fmtDuration(durationSeconds)}`}
                </span>
              </h2>
              <div className="space-y-0.5 rounded-lg bg-neutral-50 max-h-[500px] overflow-y-auto">
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
        </div>
        </div>

      <div className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ${chatOpen ? 'w-[380px]' : 'w-0'}`}>
        <MeetingChatSidebar
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          meetingContext={buildMeetingContext()}
          onOpenWorkflow={handleOpenWorkflow}
        />
      </div>
    </div>
  );
}

function fmtDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
