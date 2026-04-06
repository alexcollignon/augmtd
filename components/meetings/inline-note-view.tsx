'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ClockIcon,
  CheckCircleIcon,
  MicrophoneIcon,
  VideoCameraIcon,
  ArrowLeftIcon,
  TrashIcon,
  EnvelopeIcon,
  ComputerDesktopIcon,
  SparklesIcon,
  ChevronRightIcon,
  XMarkIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';
import type { MeetingChatContext } from '@/components/meetings/meeting-chat-sidebar';
import { useRecordingContext } from '@/context/recording-context';
import type { CalendarEvent } from '@/lib/types/meetings';
import { formatMeetingTime, calculateDuration } from '@/lib/types/meetings';
import LinkedWorkPanel from '@/components/meetings/linked-work-panel';
import ProcessingPipeline from '@/components/meetings/processing-pipeline';
import MeetingDocument from '@/components/meetings/meeting-document';

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

interface NotesStructured {
  document?: string;
  live_notes?: string;
}

interface MeetingTranscript {
  id: string;
  summary: string | null;
  decisions: Decision[];
  risks: Risk[];
  suggestedNextStep: string | null;
  keyMoments: KeyMoment[];
  transcriptSegments: TranscriptSegment[];
  durationMinutes: number;
  workItemsGenerated: number;
  source: string;
  botState: string | null;
  processed: boolean;
  notesStructured?: NotesStructured | null;
  templateId?: string;
  rawTranscript?: string | null;
}

interface InlineNoteViewProps {
  eventId?: string | null;
  onBack: () => void;
  onMeetingContextReady?: (ctx: MeetingChatContext) => void;
  onRequestChat?: (autoMessage?: string) => void;
  onCreated?: (id: string) => void;
  onNewBot?: () => void;
  onStartRecording?: (title: string, calendarEventId?: string, noteId?: string) => void;
}

const KEY_MOMENT_COLORS: Record<string, string> = {
  decision: 'bg-blue-50 border-l-2 border-blue-400',
  risk: 'bg-red-50 border-l-2 border-red-400',
  commitment: 'bg-amber-50 border-l-2 border-amber-400',
};

const KEY_MOMENT_BADGES: Record<string, string> = {
  decision: 'text-blue-700 bg-blue-100',
  risk: 'text-red-700 bg-red-100',
  commitment: 'text-amber-700 bg-amber-100',
};

const RISK_DOT: Record<string, string> = {
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

function timeUntil(startTime: string): string {
  const diff = new Date(startTime).getTime() - Date.now();
  if (diff <= 0) return 'Now';
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `in ${d}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m % 60}m`;
  return `in ${m}m`;
}

function TranscriptCollapsible({
  segments,
  durationSeconds,
  keyMomentMap,
  highlightedSegment,
}: {
  segments: TranscriptSegment[];
  durationSeconds: number | null;
  keyMomentMap: Map<number, KeyMoment>;
  highlightedSegment: number | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wide hover:text-neutral-600 transition-colors"
      >
        <ChevronRightIcon className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        Transcript
        <span className="font-normal normal-case text-neutral-400">
          {segments.length} segments{durationSeconds != null && ` · ${fmtDuration(durationSeconds)}`}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-0.5 rounded-lg bg-neutral-50 max-h-[500px] overflow-y-auto">
          {segments.map((seg, idx) => {
            const km = keyMomentMap.get(idx);
            return (
              <div
                key={idx}
                id={`segment-${idx}`}
                className={`px-4 py-2.5 transition-all duration-300 ${
                  highlightedSegment === idx
                    ? 'ring-2 ring-indigo-300 bg-indigo-50'
                    : km ? KEY_MOMENT_COLORS[km.type] : 'border-b border-neutral-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-semibold text-neutral-700">{seg.speaker}</span>
                  <span className="text-[10px] text-neutral-400">{formatTs(seg.timestamp)}</span>
                  {km && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 uppercase tracking-wide rounded ${KEY_MOMENT_BADGES[km.type]}`}>
                      {km.type}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-neutral-700 leading-relaxed">{seg.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function InlineNoteView({
  eventId,
  onBack,
  onMeetingContextReady,
  onRequestChat,
  onCreated,
  onNewBot,
  onStartRecording,
}: InlineNoteViewProps) {
  const isAdHoc = !eventId;

  // Remote data (scheduled meetings)
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [transcript, setTranscript] = useState<MeetingTranscript | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isAdHoc);
  const [error, setError] = useState<string | null>(null);

  // Ad-hoc fields
  const [adHocTitle, setAdHocTitle] = useState('');
  const [adHocLink, setAdHocLink] = useState('');
  const [linkFlash, setLinkFlash] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  // Note body (always present, saved before processing)
  const [noteBody, setNoteBody] = useState('');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteProcessing, setNoteProcessing] = useState(false);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capture state
  const [botScheduled, setBotScheduled] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Prep brief
  const [prepBrief, setPrepBrief] = useState<{
    pastMeetings: Array<{ title: string; date: string; summary: string }>;
    openActionItems: Array<{ title: string; fromMeeting: string }>;
    recentEmails: Array<{ subject: string; from: string; date: string; snippet: string }>;
    relevantDocs: Array<{ title: string; snippet: string }>;
  } | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepExpanded, setPrepExpanded] = useState(false);

  // Retry stuck processing
  const [retrying, setRetrying] = useState(false);

  // Post-capture UI
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recording = useRecordingContext();


  const fetchData = useCallback(async () => {
    if (!eventId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/meetings/${eventId}/full`);
      if (!res.ok) { setError('Failed to load meeting'); return; }
      const data = await res.json();
      setEvent(data.event);
      setTranscript(data.transcript);
      setActionItems(data.actionItems ?? []);
      setAudioUrl(data.audioUrl);
      if (data.transcript?.processed && onMeetingContextReady) {
        onMeetingContextReady({
          title: data.event.title,
          date: data.event.start_time,
          durationMinutes: data.transcript.durationMinutes ?? undefined,
          attendees: (data.event.attendees ?? []).map((a: any) => a.name || a.email || '').filter(Boolean),
          summary: data.transcript.summary ?? undefined,
          decisions: data.transcript.decisions?.map((d: any) => d.text) ?? [],
          actionItems: (data.actionItems ?? []).map((a: any) => ({
            text: a.workTitle,
            assignee: a.assignee ?? undefined,
            status: a.category,
          })),
          risks: (data.transcript.risks ?? []).map((r: any) => ({ description: r.text, severity: r.severity })),
          suggestedNextStep: data.transcript.suggestedNextStep ?? undefined,
        });
      }
    } catch {
      setError('Failed to load meeting');
    } finally {
      setLoading(false);
    }
  }, [eventId, onMeetingContextReady]);

  useEffect(() => {
    if (!eventId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setConfirmDelete(false);
    fetchData();
  }, [fetchData, eventId]);

  // Prep brief for upcoming scheduled meetings
  useEffect(() => {
    if (!eventId || transcript || loading) return;
    setPrepLoading(true);
    fetch(`/api/meetings/${eventId}/prep`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setPrepBrief(data); })
      .catch(() => {})
      .finally(() => setPrepLoading(false));
  }, [eventId, transcript, loading]);

  // Sync botScheduled from actual event data (persists across remounts)
  useEffect(() => {
    if (event?.attendee_bot_state === 'scheduled') setBotScheduled(true);
    else if (event?.attendee_bot_state === 'cancelled' || event?.attendee_bot_state === null) setBotScheduled(false);
  }, [event?.attendee_bot_state]);

  // Poll while processing
  useEffect(() => {
    if (!transcript || transcript.processed || transcript.botState === 'failed') return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [transcript?.processed, transcript?.botState, fetchData]);

  // Cleanup note debounce on unmount
  useEffect(() => {
    return () => { if (noteTimerRef.current) clearTimeout(noteTimerRef.current); };
  }, []);

  // For ad-hoc mode: when recording completes, go back so user finds the new note in Recent
  useEffect(() => {
    if (!isAdHoc) return;
    const ch = new BroadcastChannel('meetings-updated');
    ch.onmessage = () => onBack();
    return () => ch.close();
  }, [isAdHoc, onBack]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Immediately create/update the note row and return its id.
  // Called before starting a recording to ensure noteId is populated.
  const flushNoteSave = useCallback(async (): Promise<string | null> => {
    if (noteTimerRef.current) { clearTimeout(noteTimerRef.current); noteTimerRef.current = null; }
    if (!noteBody.trim()) return noteId;
    if (noteId) {
      await fetch(`/api/meetings/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
      }).catch(() => {});
      return noteId;
    }
    try {
      const res = await fetch('/api/meetings/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: adHocTitle || event?.title || 'Untitled note',
          body: noteBody,
          calendarEventId: eventId ?? undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setNoteId(data.id);
        return data.id as string;
      }
    } catch {}
    return null;
  }, [noteBody, noteId, adHocTitle, event?.title, eventId]);

  const debouncedNoteBodySave = useCallback((body: string, currentNoteId: string | null) => {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(async () => {
      if (!body.trim()) return;
      setNoteSaving(true);
      try {
        if (!currentNoteId) {
          const res = await fetch('/api/meetings/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: adHocTitle || event?.title || 'Untitled note',
              body,
              calendarEventId: eventId ?? undefined,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setNoteId(data.id);
            // Keep recording hook in sync so stopAndUpload merges into this row
            recording.setRecordingNoteId(data.id);
          }
        } else {
          await fetch(`/api/meetings/notes/${currentNoteId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          });
        }
      } catch {} finally { setNoteSaving(false); }
    }, 2000);
  }, [eventId, adHocTitle, event?.title]);

  const handleProcessNote = async () => {
    if (!noteBody.trim() && !adHocTitle.trim()) return;
    setNoteProcessing(true);
    try {
      let id = noteId;
      if (!id) {
        const res = await fetch('/api/meetings/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: adHocTitle || event?.title || 'Untitled note',
            body: noteBody,
            calendarEventId: eventId ?? undefined,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        id = data.id;
        setNoteId(id);
      } else {
        if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
        await fetch(`/api/meetings/notes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: adHocTitle || event?.title, body: noteBody }),
        });
      }
      const res = await fetch(`/api/meetings/notes/${id}/process`, { method: 'POST' });
      if (res.ok) {
        if (isAdHoc && id) {
          onCreated?.(id);
        } else {
          fetchData();
        }
      }
    } finally {
      setNoteProcessing(false);
    }
  };

  const handleScheduleAssistant = async () => {
    if (!event || scheduling) return;
    setScheduling(true);
    try {
      const res = await fetch(`/api/meetings/${event.id}/schedule-bot`, { method: 'POST' });
      if (res.ok) setBotScheduled(true);
    } catch {} finally { setScheduling(false); }
  };

  const handleCancelAssistant = async () => {
    if (!event || cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/meetings/${event.id}/cancel-bot`, { method: 'DELETE' });
      if (res.ok) setBotScheduled(false);
    } catch {} finally { setCancelling(false); }
  };

  const handleCopyLink = async () => {
    if (!event?.meeting_link) return;
    await navigator.clipboard.writeText(event.meeting_link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleConfirmToDesk = async (item: ActionItem) => {
    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.workTitle, kanban_column: 'todo' }),
      });
      if (res.ok) setConfirmedIds((prev) => new Set(prev).add(item.id));
    } catch {}
  };

  const handleDismissItem = (itemId: string) => {
    setDismissedIds((prev) => new Set(prev).add(itemId));
  };

  const handleCitationClick = (segmentIndex: number) => {
    setHighlightedSegment(segmentIndex);
    const el = document.getElementById(`segment-${segmentIndex}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setHighlightedSegment(null), 3000);
  };

const handleRetry = async () => {
    if (!transcript || retrying) return;
    setRetrying(true);
    try {
      if (transcript.source === 'recording' || transcript.source === 'upload') {
        // Re-queue audio file for Whisper transcription
        const retryId = eventId ?? transcript.id;
        await fetch(`/api/meetings/${retryId}/transcript/retry`, { method: 'POST' });
      } else {
        // Re-run AI analysis on text note
        await fetch(`/api/meetings/notes/${transcript.id}/process`, { method: 'POST' });
      }
      await fetchData();
    } catch {} finally { setRetrying(false); }
  };

  const handleDelete = async () => {
    if (!event) return;
    setDeleting(true);
    try {
      await fetch(`/api/meetings/${event.id}/transcript`, { method: 'DELETE' });
      new BroadcastChannel('meetings-updated').postMessage('deleted');
      onBack();
    } finally { setDeleting(false); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-2xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-neutral-100 rounded w-1/3" />
          <div className="h-6 bg-neutral-100 rounded w-2/3" />
          <div className="h-3 bg-neutral-100 rounded w-1/2" />
          <div className="h-24 bg-neutral-100 rounded" />
          <div className="h-16 bg-neutral-100 rounded" />
        </div>
      </div>
    );
  }

  if (error || (!event && !isAdHoc)) {
    return (
      <div className="px-6 py-8 text-center">
        <p className="text-[13px] text-neutral-500">{error ?? 'Meeting not found'}</p>
        <button onClick={onBack} className="mt-2 text-[12px] text-indigo-600 hover:underline">
          ← Back to meetings
        </button>
      </div>
    );
  }

  // Derived
  const isAfterStart = event ? new Date(event.start_time).getTime() <= Date.now() : true;
  const hasGoogleMeetLink = !!event?.meeting_link?.includes('meet.google.com');
  const adHocHasLink = adHocLink.includes('meet.google.com');

  const { primary } = !isAdHoc && event ? formatMeetingTime(event.start_time, event.end_time) : { primary: '' };
  const duration = !isAdHoc && event ? calculateDuration(event.start_time, event.end_time) : 0;

  const segmentDuration = (transcript?.transcriptSegments?.length ?? 0) > 0
    ? transcript!.transcriptSegments[transcript!.transcriptSegments.length - 1].timestamp
    : (transcript?.durationMinutes ?? 0) > 0 ? transcript!.durationMinutes * 60 : null;
  const durationSeconds = audioDuration ?? segmentDuration;

  const keyMomentMap = new Map<number, KeyMoment>();
  transcript?.keyMoments?.forEach((km) => keyMomentMap.set(km.segmentIndex, km));
  const risks = transcript?.risks ?? [];

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">

      {/* Back */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="p-1 hover:bg-neutral-100 rounded-md transition-colors text-neutral-400 hover:text-neutral-600"
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-[12px] text-neutral-400">Meetings</span>
      </div>

      {/* ── ZONE A — Meeting info ── */}
      <div className="mb-5">
        {isAdHoc ? (
          /* Ad-hoc: editable fields */
          <div className="space-y-2">
            <input
              autoFocus
              type="text"
              value={adHocTitle}
              onChange={(e) => setAdHocTitle(e.target.value)}
              placeholder="Meeting title"
              className="w-full text-xl font-semibold text-neutral-900 outline-none placeholder:text-neutral-300 bg-transparent"
            />
            <div className="flex items-center gap-2">
              <input
                ref={linkInputRef}
                type="text"
                value={adHocLink}
                onChange={(e) => setAdHocLink(e.target.value)}
                placeholder="Meeting link (optional — for sending assistant)"
                className={`flex-1 text-[12px] text-blue-600 outline-none bg-transparent placeholder:text-neutral-300 rounded transition-all duration-300 ${linkFlash ? 'ring-2 ring-indigo-400 bg-indigo-50 px-1' : ''}`}
              />
              <button
                onClick={() => { if (adHocLink.trim()) onNewBot?.(); else { setLinkFlash(true); linkInputRef.current?.focus(); setTimeout(() => setLinkFlash(false), 1200); } }}
                disabled={!adHocLink.trim()}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-full transition-colors flex-shrink-0 ${
                  adHocLink.trim()
                    ? 'text-white bg-indigo-600 hover:bg-indigo-700'
                    : 'text-neutral-400 bg-neutral-100 opacity-60 cursor-not-allowed'
                }`}
              >
                <ComputerDesktopIcon className="w-3 h-3" />
                Send assistant
              </button>
            </div>
          </div>
        ) : (
          /* Scheduled: pre-filled header */
          <>
            <div className="flex items-start justify-between gap-4 mb-2">
              <h1 className="text-xl font-semibold text-neutral-900">{event!.title}</h1>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {transcript?.processed && onRequestChat && (
                  <button
                    onClick={() => onRequestChat(`Draft a follow-up email summarizing this meeting for all attendees: ${(event!.attendees ?? []).map((a: any) => a.name || a.email).filter(Boolean).join(', ')}`)}
                    className="p-1.5 border border-neutral-200 rounded-md text-neutral-500 hover:bg-neutral-50 transition-colors"
                    title="Draft follow-up email"
                  >
                    <EnvelopeIcon className="w-3.5 h-3.5" />
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
                    <span className="text-[11px] text-neutral-500">Delete?</span>
                    <button onClick={handleDelete} disabled={deleting} className="text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-2.5 py-1 rounded transition-colors">
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="text-[11px] text-neutral-500 hover:text-neutral-700">Cancel</button>
                  </div>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-neutral-500">
              <span className="flex items-center gap-1">
                <ClockIcon className="w-3.5 h-3.5" />
                {primary} · {duration}min
              </span>
              {event!.meeting_link && (
                <>
                  <a href={event!.meeting_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                    <VideoCameraIcon className="w-3.5 h-3.5" />
                    Join
                  </a>
                  <button
                    onClick={handleCopyLink}
                    title="Copy meeting link"
                    className="flex items-center gap-1 text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                    {linkCopied && <span className="text-[11px] text-emerald-600">Copied</span>}
                  </button>
                </>
              )}
              {transcript && (
                <span className="text-[11px] text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded">
                  {transcript.source === 'bot' ? 'Online' : transcript.source === 'recording' ? 'In-person' : transcript.source === 'text' ? 'Note' : 'Upload'}
                </span>
              )}
            </div>


            {/* Attendees */}
            {(event!.attendees?.length ?? 0) > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {event!.attendees.slice(0, 6).map((a: any, i: number) => {
                    const key = a.email ?? a.name ?? String(i);
                    const color = attendeeColor(key);
                    return (
                      <div key={i} title={a.email || a.name || '?'} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ring-2 ring-white ${color}`}>
                        {getInitials(a.name, a.email)}
                      </div>
                    );
                  })}
                </div>
                <span className="text-[12px] text-neutral-500">
                  {event!.attendees.length <= 3
                    ? event!.attendees.map((a: any) => (a.name || a.email || '').split(/\s+/)[0]).join(', ')
                    : `${event!.attendees.slice(0, 2).map((a: any) => (a.name || a.email || '').split(/\s+/)[0]).join(', ')} & ${event!.attendees.length - 2} others`}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Processing pipeline */}
      {transcript && !transcript.processed && transcript.botState !== 'failed' && (
        <div className="mb-6">
          <ProcessingPipeline
            source={(transcript.source ?? 'bot') as 'bot' | 'recording' | 'upload' | 'text'}
            attendeeBotState={null}
            botState={transcript.botState}
            processed={transcript.processed}
          />
          {/* Retry for stuck text/recording notes */}
          {(transcript.source === 'text' || transcript.source === 'recording' || transcript.source === 'upload') && (
            <div className="mt-2 flex justify-end">
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="text-[11px] text-neutral-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
              >
                {retrying ? 'Retrying…' : 'Stuck? Retry analysis →'}
              </button>
            </div>
          )}
          {/* Show user's typed notes while processing */}
          {transcript.notesStructured?.live_notes && (
            <div className="mt-3 px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-b-lg">
              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Your notes</p>
              <p className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap">{transcript.notesStructured.live_notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Failed state */}
      {transcript && transcript.botState === 'failed' && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 px-4 py-3 bg-red-50 rounded-lg">
            <div>
              <p className="text-[13px] font-medium text-red-700">Transcription failed</p>
              <p className="text-[12px] text-red-500 mt-0.5">
                {audioUrl ? 'The audio was saved — you can retry.' : 'No audio available.'}
              </p>
            </div>
            {(transcript.source === 'text' || transcript.source === 'recording' || transcript.source === 'upload') && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-3 py-1.5 text-[12px] font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </div>
          {transcript.notesStructured?.live_notes && (
            <div className="mt-3 px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-lg">
              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Your notes</p>
              <p className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap">{transcript.notesStructured.live_notes}</p>
            </div>
          )}
        </div>
      )}

      {/* ── ZONE C — Recording bar or capture pills ── */}
      {!transcript && recording.state === 'recording' && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2.5 bg-red-50 rounded-xl">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
          <span className="text-[12px] font-semibold text-red-600 tabular-nums">{fmtDuration(recording.elapsed)}</span>
          <span className="flex-1 text-[12px] text-red-400">Recording in progress</span>
          <button
            onClick={recording.stopAndUpload}
            className="px-3 py-1 text-[12px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex-shrink-0"
          >
            Stop & transcribe
          </button>
        </div>
      )}

      {!transcript && recording.state === 'uploading' && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2.5 bg-neutral-50 rounded-xl">
          <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse flex-shrink-0" />
          <span className="text-[12px] text-neutral-500 flex-1">Uploading… {recording.uploadProgress}%</span>
        </div>
      )}

      {!transcript && recording.state !== 'recording' && recording.state !== 'uploading' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {/* Time until (scheduled only) */}
          {!isAdHoc && (
            <span className="text-[12px] text-neutral-400 mr-0.5">{timeUntil(event!.start_time)}</span>
          )}

          {/* Schedule assistant — before start, has Google Meet link */}
          {!isAdHoc && hasGoogleMeetLink && !isAfterStart && (
            botScheduled ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[12px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5">
                  <ComputerDesktopIcon className="w-3 h-3" />
                  Assistant scheduled
                </span>
                <button
                  onClick={handleCancelAssistant}
                  disabled={cancelling}
                  className="text-[11px] text-neutral-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Cancel assistant"
                >
                  {cancelling ? '…' : 'Cancel'}
                </button>
              </span>
            ) : (
              <button
                onClick={handleScheduleAssistant}
                disabled={scheduling}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-full transition-colors"
              >
                <ComputerDesktopIcon className="w-3 h-3" />
                {scheduling ? 'Scheduling…' : 'Schedule assistant'}
              </button>
            )
          )}

          {/* Send assistant — after start, has Google Meet link (scheduled) */}
          {!isAdHoc && hasGoogleMeetLink && isAfterStart && !botScheduled && (
            <button
              onClick={handleScheduleAssistant}
              disabled={scheduling}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-full transition-colors"
            >
              <ComputerDesktopIcon className="w-3 h-3" />
              {scheduling ? 'Sending…' : 'Send assistant'}
            </button>
          )}
          {!isAdHoc && hasGoogleMeetLink && isAfterStart && botScheduled && (
            <span className="text-[12px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5">
              <ComputerDesktopIcon className="w-3 h-3" />
              Assistant in meeting
            </span>
          )}


          {/* Record in person — uses page-level recording hook (survives navigation) */}
          <button
            onClick={async () => {
              // Flush any pending note save first so we have a noteId to merge into
              const resolvedNoteId = await flushNoteSave();
              console.log('[Record] flushNoteSave resolved noteId:', resolvedNoteId);
              onStartRecording?.(
                isAdHoc ? (adHocTitle || 'Ad-hoc meeting') : (event?.title ?? 'Meeting'),
                isAdHoc ? undefined : event?.id,
                resolvedNoteId ?? undefined,
              );
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-full transition-colors"
          >
            <MicrophoneIcon className="w-3 h-3" />
            Record in person
          </button>

          {/* Process with AI — when note body has content */}
          {noteBody.trim() && (
            <button
              onClick={handleProcessNote}
              disabled={noteProcessing}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 rounded-full transition-colors"
            >
              <SparklesIcon className="w-3 h-3" />
              {noteProcessing ? 'Processing…' : 'Process with AI'}
            </button>
          )}
        </div>
      )}


      {/* ── ZONE B — Note textarea (below pills) ── */}
      {!transcript && (
        <div className="mb-5">
          <textarea
            value={noteBody}
            onChange={(e) => {
              setNoteBody(e.target.value);
              debouncedNoteBodySave(e.target.value, noteId);
            }}
            placeholder={isAdHoc
              ? 'Write what was discussed, decided, or any action items…'
              : 'Jot down key points before or during the meeting…'}
            rows={5}
            className="w-full text-[14px] text-neutral-700 leading-relaxed outline-none placeholder:text-neutral-400 bg-transparent resize-none border-b border-neutral-100 pb-2"
          />
          {noteSaving && <span className="text-[10px] text-neutral-400">Saving…</span>}
        </div>
      )}


      {/* ── ZONE E — Prep brief (collapsible, scheduled only) ── */}
      {!isAdHoc && !transcript && (prepBrief || prepLoading) && (
        <div className="mb-6">
          <button
            onClick={() => setPrepExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wide hover:text-neutral-600 transition-colors"
          >
            <ChevronRightIcon className={`w-3 h-3 transition-transform duration-150 ${prepExpanded ? 'rotate-90' : ''}`} />
            Meeting prep
          </button>

          {prepExpanded && (
            <div className="mt-3 space-y-4">
              {prepLoading && (
                <div className="animate-pulse space-y-2">
                  <div className="h-3 bg-neutral-100 rounded w-1/3" />
                  <div className="h-14 bg-neutral-100 rounded" />
                </div>
              )}

              {prepBrief && !prepLoading && (
                <>
                  {prepBrief.pastMeetings.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Previous meetings</h2>
                      <div className="space-y-2">
                        {prepBrief.pastMeetings.map((pm, i) => (
                          <div key={i} className="px-3 py-2 bg-neutral-50 rounded-lg">
                            <p className="text-[12px] font-medium text-neutral-700">{pm.title}</p>
                            <p className="text-[10px] text-neutral-400 mt-0.5">
                              {new Date(pm.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            {pm.summary && <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{pm.summary}</p>}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {prepBrief.openActionItems.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Open action items</h2>
                      <div className="space-y-1">
                        {prepBrief.openActionItems.map((item, i) => (
                          <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-1.5" />
                            <div>
                              <p className="text-[12px] text-neutral-700">{item.title}</p>
                              {item.fromMeeting && <p className="text-[10px] text-neutral-400">from: {item.fromMeeting}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {prepBrief.recentEmails.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Recent emails</h2>
                      <div className="space-y-1">
                        {prepBrief.recentEmails.map((email, i) => (
                          <div key={i} className="px-3 py-1.5 bg-neutral-50 rounded-lg">
                            <p className="text-[12px] font-medium text-neutral-700 truncate">{email.subject}</p>
                            <p className="text-[10px] text-neutral-400">
                              {email.from} · {new Date(email.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {prepBrief.relevantDocs.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Relevant documents</h2>
                      <div className="space-y-1">
                        {prepBrief.relevantDocs.map((doc, i) => (
                          <div key={i} className="px-3 py-1.5 bg-neutral-50 rounded-lg">
                            <p className="text-[12px] font-medium text-neutral-700 truncate">{doc.title}</p>
                            {doc.snippet && <p className="text-[10px] text-neutral-400 truncate mt-0.5">{doc.snippet}</p>}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ZONE D — Post-capture content ── */}

      {/* Meeting document — primary note view */}
      {transcript?.processed && (
        <section className="mb-6">
          <MeetingDocument
            document={transcript.notesStructured?.document || transcript.summary || ''}
            eventId={eventId ?? null}
            editable
          />
        </section>
      )}

      {/* Action items */}
      {transcript?.processed && actionItems.length > 0 && (
        <section className="mb-6 pt-4 border-t border-neutral-100">
          <div className="space-y-px">
            {actionItems.map((item) => {
              const isMine = confirmedIds.has(item.id);
              const isNotMine = dismissedIds.has(item.id);
              const isPending = !isMine && !isNotMine;
              return (
                <div key={item.id} className={`flex items-center gap-2.5 py-1.5 group ${isNotMine ? 'opacity-40' : ''}`}>
                  {/* State indicator */}
                  {isMine ? (
                    <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  ) : isNotMine ? (
                    <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
                      <span className="w-2 h-px bg-neutral-400 block" />
                    </span>
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-neutral-300 flex-shrink-0" />
                  )}

                  {/* Task text */}
                  <p className={`flex-1 text-[13px] leading-relaxed min-w-0 ${isMine ? 'text-neutral-500' : isNotMine ? 'text-neutral-400' : 'text-neutral-700'}`}>
                    {item.workTitle}
                    {item.assignee && <span className="ml-1.5 text-[11px] text-neutral-400">— {item.assignee}</span>}
                  </p>

                  {/* Status label or action buttons */}
                  {isMine && (
                    <span className="text-[10px] text-emerald-600 font-medium flex-shrink-0">Added to desk</span>
                  )}
                  {isNotMine && (
                    <span className="text-[10px] text-neutral-400 flex-shrink-0">Not mine</span>
                  )}
                  {isPending && (
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleConfirmToDesk(item)}
                        className="px-2 py-0.5 text-[11px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors"
                      >
                        Mine
                      </button>
                      <button
                        onClick={() => handleDismissItem(item.id)}
                        className="px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded transition-colors"
                      >
                        Not mine
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Risks inline below action items */}
          {risks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {risks.map((risk: Risk, i: number) => (
                <span key={i} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
                  risk.severity === 'high' ? 'bg-red-50 text-red-600' :
                  risk.severity === 'medium' ? 'bg-amber-50 text-amber-600' :
                  'bg-neutral-100 text-neutral-500'
                }`}>
                  <span className={`w-1 h-1 rounded-full ${RISK_DOT[risk.severity] ?? 'bg-neutral-300'}`} />
                  {risk.text}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Related work */}
      {transcript?.processed && event?.id && (
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

      {/* Transcript segments — collapsed by default */}
      {transcript && transcript.transcriptSegments?.length > 0 && (
        <TranscriptCollapsible
          segments={transcript.transcriptSegments}
          durationSeconds={durationSeconds}
          keyMomentMap={keyMomentMap}
          highlightedSegment={highlightedSegment}
        />
      )}
    </div>
  );
}
