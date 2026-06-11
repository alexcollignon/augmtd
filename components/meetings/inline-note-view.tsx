'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ClockIcon,
  CheckCircleIcon,
  MicrophoneIcon,
  VideoCameraIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  TrashIcon,
  SparklesIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  XMarkIcon,
  ClipboardDocumentIcon,
  PaperAirplaneIcon,
  DocumentTextIcon,
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
  chatIsOpen?: boolean;
  onCreated?: (id: string) => void;
  onNoteRowCreated?: () => void;
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
  chatIsOpen,
  onCreated,
  onNoteRowCreated,
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

  // Inline title edit (scheduled / processed view)
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Note body (always present, saved before processing)
  const [noteBody, setNoteBody] = useState('');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteProcessing, setNoteProcessing] = useState(false);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteIdRef = useRef<string | null>(null);      // mirrors noteId, updated synchronously
  const creatingNoteRef = useRef(false);              // guard: only one POST ever in-flight
  // Capture state
  const [linkCopied, setLinkCopied] = useState(false);

  // Prep brief
  const [prepBrief, setPrepBrief] = useState<{
    pastMeetings: Array<{ id: string; title: string; date: string; summary: string; decisions: string[] }>;
    openActionItems: Array<{ title: string; fromMeeting: string }>;
    recentEmails: Array<{ subject: string; from: string; date: string; snippet: string }>;
    relevantDocs: Array<{ title: string; snippet: string }>;
    relationships: Array<{ name: string; email: string; type: string; lastInteraction: string | null; topics: string[] }>;
    agenda: string | null;
    aiSummary: string | null;
  } | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepExpanded, setPrepExpanded] = useState(false);

  // Retry stuck processing
  const [retrying, setRetrying] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  // Post-capture UI — local "mine" tracking for action items
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [teaserValue, setTeaserValue] = useState('');
  const [showAttendees, setShowAttendees] = useState(false);

  const recording = useRecordingContext();


  // Incremented each time a new fetch starts; stale calls check against this to avoid clobbering state.
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!eventId) { setLoading(false); return; }
    const id = ++fetchIdRef.current;
    const stale = () => fetchIdRef.current !== id;
    try {
      // Retry up to 5× on 404 — row may still be written when navigating immediately after upload
      let res: Response | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (stale()) return;
        res = await fetch(`/api/meetings/${eventId}/full`);
        if (res.status !== 404) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 1200));
      }
      if (stale()) return;
      if (!res || !res.ok) { setError('Failed to load meeting'); return; }
      const data = await res.json();
      if (stale()) return;
      setEvent(data.event);
      setTranscript(data.transcript);
      setActionItems(data.actionItems ?? []);
      setAudioUrl(data.audioUrl);
      // If this is a draft text note (saved but not yet AI-processed), wire up the note ID
      // so every keystroke goes to PATCH (not POST), and restore any saved body content.
      // NOTE: rawTranscript can be empty (title-only note) — still need to set noteIdRef.
      if (
        data.transcript?.source === 'text' &&
        data.transcript?.processed &&
        !data.transcript?.notesStructured?.document &&
        !data.transcript?.summary
      ) {
        noteIdRef.current = data.transcript.id;
        setNoteId(data.transcript.id);
        if (data.transcript.rawTranscript) {
          setNoteBody(data.transcript.rawTranscript);
        }
      }
      // Synthetic event: /full creates a fake event from the transcript when no real calendar
      // event exists (ad-hoc notes navigated back via Live section). Restore the editable title.
      if (data.event && data.transcript && data.event.id === data.transcript.id) {
        setAdHocTitle(data.event.title || '');
      }

      if (data.event && onMeetingContextReady) {
        const processed = data.transcript?.processed ?? false;
        onMeetingContextReady({
          title: data.event.title,
          date: data.event.start_time,
          durationMinutes: processed ? (data.transcript!.durationMinutes ?? undefined) : undefined,
          attendees: (data.event.attendees ?? []).map((a: any) => a.name || a.email || '').filter(Boolean),
          summary: processed ? (data.transcript!.summary ?? undefined) : undefined,
          decisions: processed ? (data.transcript!.decisions?.map((d: any) => d.text) ?? []) : [],
          actionItems: processed ? (data.actionItems ?? []).map((a: any) => ({
            text: a.workTitle,
            assignee: a.assignee ?? undefined,
            status: a.category,
          })) : [],
          risks: processed ? (data.transcript!.risks ?? []).map((r: any) => ({ description: r.text, severity: r.severity })) : [],
          suggestedNextStep: processed ? (data.transcript!.suggestedNextStep ?? undefined) : undefined,
          transcriptId: data.transcript?.id,
        });
      }
    } catch {
      if (!stale()) setError('Failed to load meeting');
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [eventId, onMeetingContextReady]);

  useEffect(() => {
    if (!eventId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setConfirmDelete(false);
    fetchData();
  }, [fetchData, eventId]);

  // Poll for text notes that are being processed by AI (user navigated away mid-processing and returned)
  useEffect(() => {
    if (!transcript || transcript.source !== 'text' || transcript.processed || transcript.botState !== 'processing') return;
    const interval = setInterval(() => { fetchData(); }, 3000);
    return () => clearInterval(interval);
  }, [transcript?.source, transcript?.processed, transcript?.botState, fetchData]);

  // Prep brief for upcoming scheduled meetings
  useEffect(() => {
    if (!eventId || transcript || loading) return;
    setPrepLoading(true);
    fetch(`/api/meetings/${eventId}/prep`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) { setPrepBrief(data); setPrepExpanded(true); } })
      .catch(() => {})
      .finally(() => setPrepLoading(false));
  }, [eventId, transcript, loading]);

  // Poll while processing
  useEffect(() => {
    if (!transcript || transcript.processed || transcript.botState === 'failed') return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [transcript?.processed, transcript?.botState, fetchData]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    };
  }, []);



  // handleBack: for ad-hoc notes, delete the row if user navigated away without writing anything.
  const handleBack = useCallback(async () => {
    // Delete the note row if user navigated away without writing anything.
    // Applies to: fresh ad-hoc notes (isAdHoc) and ad-hoc drafts returned via Live section
    // (detected by synthetic event: event.id === transcript.id).
    const isSyntheticEvent = event && transcript && event.id === transcript.id;
    if (noteIdRef.current && !noteBody.trim() && !adHocTitle.trim() && (isAdHoc || isSyntheticEvent)) {
      await fetch(`/api/meetings/notes/${noteIdRef.current}`, { method: 'DELETE' }).catch(() => {});
    }
    onBack();
  }, [isAdHoc, noteBody, adHocTitle, event, transcript, onBack]);

  // For ad-hoc mode: when recording completes, go back so user finds the new note in Recent
  useEffect(() => {
    if (!isAdHoc) return;
    const ch = new BroadcastChannel('meetings-updated');
    ch.onmessage = () => onBack();
    return () => ch.close();
  }, [isAdHoc, onBack]);

  // Refresh when AI chat edits notes or action items
  useEffect(() => {
    if (!eventId) return;
    const ch = new BroadcastChannel('meeting-updates');
    ch.onmessage = () => fetchData();
    return () => ch.close();
  }, [eventId, fetchData]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Immediately create/update the note row and return its id.
  // Called before starting a recording to ensure noteId is populated.
  const flushNoteSave = useCallback(async (): Promise<string | null> => {
    if (noteTimerRef.current) { clearTimeout(noteTimerRef.current); noteTimerRef.current = null; }
    const titleVal = adHocTitle || event?.title || '';
    if (!noteBody.trim() && !titleVal.trim()) return noteId;
    if (noteId) {
      await fetch(`/api/meetings/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleVal || 'Untitled note', body: noteBody }),
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
        noteIdRef.current = data.id;
        setNoteId(data.id);
        return data.id as string;
      }
    } catch {}
    return null;
  }, [noteBody, noteId, adHocTitle, event?.title, eventId]);

  const debouncedNoteBodySave = useCallback((body: string) => {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    // First save (no existing row): fire immediately so navigating away doesn't lose the note.
    // Subsequent saves (PATCH): short debounce — fast enough to feel instant for title edits.
    const delay = noteIdRef.current ? 400 : 0;
    noteTimerRef.current = setTimeout(async () => {
      // Skip only if both body and title are empty — don't skip a title-only save
      if (!body.trim() && !(adHocTitle || event?.title)) return;
      setNoteSaving(true);
      try {
        if (!noteIdRef.current) {
          // Guard: if a POST is already in-flight, skip — the in-flight one will complete first
          // and noteIdRef.current will be set before any subsequent debounce fires.
          if (creatingNoteRef.current) return;
          creatingNoteRef.current = true;
          try {
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
              noteIdRef.current = data.id;
              setNoteId(data.id);
              // Keep recording hook in sync so stopAndUpload merges into this row
              recording.setRecordingNoteId(data.id);
              onNoteRowCreated?.();
            }
          } finally {
            creatingNoteRef.current = false;
          }
        } else {
          await fetch(`/api/meetings/notes/${noteIdRef.current}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: adHocTitle || event?.title || 'Untitled meeting',
              body,
            }),
          });
        }
      } catch {} finally { setNoteSaving(false); }
    }, delay);
  }, [eventId, adHocTitle, event?.title, onNoteRowCreated]);

  const handleProcessNote = async () => {
    if (!noteBody.trim() && !adHocTitle.trim()) return;
    setNoteProcessing(true);
    try {
      let id = noteIdRef.current ?? noteId;
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
        noteIdRef.current = data.id;
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

  const handleCopyLink = async () => {
    if (!event?.meeting_link) return;
    await navigator.clipboard.writeText(event.meeting_link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleConfirmItem = (itemId: string) => {
    setConfirmedIds((prev) => new Set(prev).add(itemId));
  };

  const handleUndoConfirm = (actionItemId: string) => {
    setConfirmedIds((prev) => { const s = new Set(prev); s.delete(actionItemId); return s; });
  };

  const handleDismissItem = (itemId: string) => {
    setDismissedIds((prev) => new Set(prev).add(itemId));
  };

  const handleUndoDismiss = (itemId: string) => {
    setDismissedIds((prev) => { const s = new Set(prev); s.delete(itemId); return s; });
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

  const handleReanalyze = async () => {
    if (!transcript || reanalyzing) return;
    setReanalyzing(true);
    try {
      const id = eventId ?? transcript.id;
      await fetch(`/api/meetings/${id}/re-enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'default' }),
      });
      await fetchData();
    } catch {} finally { setReanalyzing(false); }
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
        <button onClick={handleBack} className="mt-2 text-[12px] text-indigo-600 hover:underline">
          ← Back to meetings
        </button>
      </div>
    );
  }

  // Derived
  const isAfterStart = event ? new Date(event.start_time).getTime() <= Date.now() : true;
  const hasGoogleMeetLink = !!event?.meeting_link?.includes('meet.google.com');
  const { primary } = !isAdHoc && event ? formatMeetingTime(event.start_time, event.end_time) : { primary: '' };
  const duration = !isAdHoc && event ? calculateDuration(event.start_time, event.end_time) : 0;

  const segmentDuration = (transcript?.transcriptSegments?.length ?? 0) > 0
    ? transcript!.transcriptSegments[transcript!.transcriptSegments.length - 1].timestamp
    : (transcript?.durationMinutes ?? 0) > 0 ? transcript!.durationMinutes * 60 : null;
  const durationSeconds = audioDuration ?? segmentDuration;

  const keyMomentMap = new Map<number, KeyMoment>();
  transcript?.keyMoments?.forEach((km) => keyMomentMap.set(km.segmentIndex, km));
  const risks = transcript?.risks ?? [];

  // Draft text note: saved to DB but AI hasn't run yet — show full active-phase UI
  const isDraftNote = !!transcript && transcript.source === 'text' &&
    transcript.processed && !transcript.notesStructured?.document && !transcript.summary;

  // True when the active in-person recording belongs to THIS note/event specifically.
  // Gates recording/upload/processing bars so they don't bleed into unrelated open notes.
  const isThisNoteRecording = (() => {
    const { state, recordingEventId, recordingNoteId } = recording;
    if (state !== 'recording' && state !== 'paused' && state !== 'uploading' && state !== 'processing') return false;
    // Calendar-event-linked recording
    if (recordingEventId) return recordingEventId === eventId;
    // Note-linked recording (ad-hoc, or note was created during recording)
    if (recordingNoteId) return recordingNoteId === eventId || recordingNoteId === transcript?.id || recordingNoteId === noteId;
    // No IDs yet — ad-hoc recording just started, matches only a truly empty note view
    return !eventId && !transcript;
  })();

  return (
    <div className="flex flex-col flex-1">
    <div className="px-6 pt-8 pb-4 max-w-2xl mx-auto w-full flex-1">

      {/* Back */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={handleBack}
          className="p-1 hover:bg-neutral-100 rounded-md transition-colors text-neutral-400 hover:text-neutral-600"
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-[12px] text-neutral-400">Meetings</span>
      </div>

      {/* ── ZONE A — Meeting info ── */}
      <div className="mb-5">
        {/* Show editable ad-hoc form for: new notes (isAdHoc) OR ad-hoc drafts returned via Live
            section (isDraftNote with a synthetic event — event.id === transcript.id) */}
        {(isAdHoc || (isDraftNote && event?.id === transcript?.id)) ? (
          /* Ad-hoc: editable fields */
          <div className="space-y-2">
            <input
              autoFocus
              type="text"
              value={adHocTitle}
              onChange={(e) => {
                setAdHocTitle(e.target.value);
                debouncedNoteBodySave(noteBody);
              }}
              onBlur={() => debouncedNoteBodySave(noteBody)}
              placeholder="Meeting title"
              className="w-full text-xl font-semibold text-neutral-900 outline-none placeholder:text-neutral-300 bg-transparent"
            />
          </div>
        ) : (
          /* Scheduled: pre-filled header */
          <>
            <div className="flex items-start justify-between gap-4 mb-2">
              {editingTitle ? (
              <input
                autoFocus
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={async () => {
                  setEditingTitle(false);
                  const trimmed = titleDraft.trim();
                  if (!trimmed || trimmed === event!.title || !transcript) return;
                  setEvent((ev: any) => ({ ...ev, title: trimmed }));
                  await fetch(`/api/meetings/notes/${transcript.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: trimmed }),
                  });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setEditingTitle(false); } }}
                className="w-full text-xl font-semibold text-neutral-900 outline-none bg-transparent border-b border-neutral-300 focus:border-indigo-400 pb-0.5"
              />
            ) : (
              <h1
                className="text-xl font-semibold text-neutral-900 cursor-text hover:text-neutral-700 transition-colors"
                onClick={() => { setTitleDraft(event!.title); setEditingTitle(true); }}
                title="Click to edit title"
              >
                {event!.title}
              </h1>
            )}
              <div className="flex items-center gap-1.5 flex-shrink-0">
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
                  {transcript.source === 'recording' ? 'In-person' : transcript.source === 'text' ? 'Note' : 'Upload'}
                </span>
              )}
            </div>


            {/* Attendees */}
            {(event!.attendees?.length ?? 0) > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowAttendees((v) => !v)}
                  className="flex items-center gap-2 group"
                >
                  <div className="flex -space-x-1.5">
                    {event!.attendees.slice(0, 6).map((a: any, i: number) => {
                      const key = a.email ?? a.name ?? String(i);
                      const color = attendeeColor(key);
                      return (
                        <div key={i} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ring-2 ring-white ${color}`}>
                          {getInitials(a.name, a.email)}
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-[12px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
                    {event!.attendees.length <= 3
                      ? event!.attendees.map((a: any) => (a.name || a.email || '').split(/\s+/)[0]).join(', ')
                      : `${event!.attendees.slice(0, 2).map((a: any) => (a.name || a.email || '').split(/\s+/)[0]).join(', ')} & ${event!.attendees.length - 2} others`}
                  </span>
                  <ChevronDownIcon className={`w-3 h-3 text-neutral-400 transition-transform duration-150 ${showAttendees ? 'rotate-180' : ''}`} />
                </button>

                {showAttendees && (() => {
                  const getDomain = (email?: string | null) => {
                    if (!email) return 'Unknown';
                    const at = email.indexOf('@');
                    return at >= 0 ? email.slice(at + 1) : 'Unknown';
                  };
                  const grouped = event!.attendees.reduce((acc: Record<string, any[]>, a: any) => {
                    const domain = getDomain(a.email);
                    if (!acc[domain]) acc[domain] = [];
                    acc[domain].push(a);
                    return acc;
                  }, {} as Record<string, any[]>);
                  return (
                    <div className="mt-2 rounded-xl border border-neutral-100 bg-white shadow-sm overflow-hidden">
                      {Object.entries(grouped).map(([domain, members], gi) => (
                        <div key={domain}>
                          {gi > 0 && <div className="border-t border-neutral-50" />}
                          <div className="px-3 pt-2 pb-1">
                            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">{domain}</p>
                          </div>
                          {(members as any[]).map((a: any, i: number) => {
                            const key = a.email ?? a.name ?? String(i);
                            const color = attendeeColor(key);
                            return (
                              <div key={i} className="flex items-center gap-2.5 px-3 py-1.5">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${color}`}>
                                  {getInitials(a.name, a.email)}
                                </div>
                                <div className="min-w-0">
                                  {a.name && <p className="text-[12px] font-medium text-neutral-800 truncate">{a.name}</p>}
                                  {a.email && <p className={`truncate ${a.name ? 'text-[11px] text-neutral-400' : 'text-[12px] text-neutral-600'}`}>{a.email}</p>}
                                </div>
                              </div>
                            );
                          })}
                          <div className="pb-1" />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* Processing pipeline */}
      {transcript && !transcript.processed && transcript.botState !== 'failed' && (
        <div className="mb-6">
          <ProcessingPipeline
            source={(transcript.source ?? 'recording') as 'recording' | 'upload' | 'text'}
            attendeeBotState={null}
            botState={transcript.botState}
            processed={transcript.processed}
          />
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="mt-1 text-[11px] text-neutral-400 hover:text-indigo-500 transition-colors disabled:opacity-50 pl-7"
          >
            {retrying ? 'Retrying…' : 'Stuck? Retry →'}
          </button>
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
      {isThisNoteRecording && recording.state === 'recording' && (
        <div className="flex flex-col gap-1.5 mb-4">
          <div className="flex items-center gap-3 px-3 py-2.5 bg-red-50 rounded-xl">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-[12px] font-semibold text-red-600 tabular-nums">{fmtDuration(recording.elapsed)}</span>
            <span className="flex-1 text-[12px] text-red-400">Recording in progress</span>
            <button
              onClick={recording.pauseRecording}
              className="px-3 py-1 text-[12px] font-semibold text-neutral-600 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg transition-colors flex-shrink-0"
            >
              Pause
            </button>
            <button
              onClick={recording.stopAndUpload}
              className="px-3 py-1 text-[12px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex-shrink-0"
            >
              Finish
            </button>
          </div>
          {/* Away-time warnings — visible on return to tab */}
          {recording.awaySeconds >= 55 * 60 ? (
            <p className="px-3 py-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg">
              ⚠ You&apos;ve been away {Math.floor(recording.awaySeconds / 60)} min — recording pauses in {Math.ceil((3600 - recording.awaySeconds) / 60)} min. Return to this tab to continue.
            </p>
          ) : recording.awaySeconds >= 45 * 60 ? (
            <p className="px-3 py-1.5 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg">
              ⏱ You&apos;ve been away {Math.floor(recording.awaySeconds / 60)} min — recording auto-pauses after 1 hour away.
            </p>
          ) : (
            <p className="px-3 text-[11px] text-neutral-400">
              Recording continues when you switch tabs — auto-pauses after 1 hour away.
            </p>
          )}
        </div>
      )}

      {isThisNoteRecording && recording.state === 'paused' && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2.5 bg-amber-50 rounded-xl border border-amber-100">
          <span className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" />
          <span className="text-[12px] font-semibold text-amber-600 tabular-nums">{fmtDuration(recording.elapsed)}</span>
          <span className="flex-1 text-[12px] text-amber-500">Recording paused</span>
          <button
            onClick={recording.resumeRecording}
            className="px-3 py-1 text-[12px] font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors flex-shrink-0"
          >
            Resume
          </button>
          <button
            onClick={recording.stopAndUpload}
            className="px-3 py-1 text-[12px] font-semibold text-neutral-600 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg transition-colors flex-shrink-0"
          >
            Finish
          </button>
        </div>
      )}

      {isThisNoteRecording && recording.state === 'uploading' && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-neutral-50 border border-neutral-100">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-neutral-200 border-t-indigo-500 animate-spin flex-shrink-0" />
            <span className="text-[12px] font-medium text-neutral-600">Uploading recording…</span>
            <span className="ml-auto text-[11px] text-neutral-400 tabular-nums">{recording.uploadProgress}%</span>
          </div>
          <div className="h-1 rounded-full bg-neutral-200 overflow-hidden">
            <div
              className="h-full bg-indigo-400 rounded-full transition-all duration-300"
              style={{ width: `${recording.uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {isThisNoteRecording && recording.state === 'processing' && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-neutral-50 border border-neutral-100">
          <div className="flex items-center gap-2.5">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-neutral-200 border-t-indigo-500 animate-spin flex-shrink-0" />
            <span className="text-[12px] font-medium text-neutral-600">Transcribing and analysing…</span>
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-400 pl-6">This usually takes under a minute</p>
        </div>
      )}

      {noteProcessing && (
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
            <span className="w-3 h-3 rounded-full border-2 border-indigo-200 border-t-indigo-500 animate-spin flex-shrink-0" />
            Generating brief…
          </span>
        </div>
      )}

      {recording.state === 'error' && recording.errorMessage && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2">
          <span className="text-[12px] text-red-600 flex-1">{recording.errorMessage}</span>
          <button onClick={recording.reset} className="text-[11px] text-red-400 hover:text-red-600 underline flex-shrink-0">Dismiss</button>
        </div>
      )}

      {(!transcript || isDraftNote) && !noteProcessing && recording.state !== 'recording' && recording.state !== 'paused' && recording.state !== 'uploading' && recording.state !== 'processing' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {/* Time until (scheduled only) */}
          {!isAdHoc && (
            <span className="text-[12px] text-neutral-400 mr-0.5">{timeUntil(event!.start_time)}</span>
          )}

          {/* Record in person */}
          <button
            onClick={async () => {
              const resolvedNoteId = await flushNoteSave();
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

          <span className="text-[11px] text-neutral-300 ml-0.5">· may pause if screen locks or 1h away</span>

          {/* Finish — triggers AI analysis */}
          {(noteBody.trim() || adHocTitle.trim() || (isDraftNote && event?.id === transcript?.id)) && (
            <button
              onClick={handleProcessNote}
              disabled={noteProcessing}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 rounded-full transition-colors"
            >
              <SparklesIcon className="w-3 h-3" />
              {noteProcessing ? 'Processing…' : 'Finish'}
            </button>
          )}
        </div>
      )}


      {/* ── ZONE B — Note textarea (below pills) ── */}
      {/* Also shown for draft text notes (saved but not yet AI-processed) so the user can keep editing */}
      {(!transcript || isDraftNote) && recording.state !== 'uploading' && recording.state !== 'processing' && (
        <div className="mb-5">
          <textarea
            value={noteBody}
            readOnly={noteProcessing}
            onChange={(e) => {
              if (noteProcessing) return;
              setNoteBody(e.target.value);
              debouncedNoteBodySave(e.target.value);
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
                  <div className="h-10 bg-neutral-100 rounded w-2/3" />
                </div>
              )}

              {prepBrief && !prepLoading && (
                <>
                  {/* AI brief — always shown first if available */}
                  {prepBrief.aiSummary && (
                    <div className="px-3 py-2.5 bg-indigo-50 rounded-lg border border-indigo-100">
                      <p className="text-[12px] text-indigo-800 leading-relaxed">{prepBrief.aiSummary}</p>
                    </div>
                  )}

                  {/* Agenda from calendar invite */}
                  {prepBrief.agenda && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Agenda</h2>
                      <p className="text-[12px] text-neutral-600 leading-relaxed whitespace-pre-line px-1">{prepBrief.agenda}</p>
                    </section>
                  )}

                  {/* Attendee relationships */}
                  {prepBrief.relationships.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Who's attending</h2>
                      <div className="space-y-1.5">
                        {prepBrief.relationships.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 px-3 py-1.5 bg-neutral-50 rounded-lg">
                            <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 text-[10px] font-semibold text-indigo-600 mt-0.5">
                              {r.name?.[0]?.toUpperCase() ?? '?'}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium text-neutral-700">{r.name}</p>
                              <p className="text-[10px] text-neutral-400">
                                {r.type || r.email}
                                {r.lastInteraction && ` · last contact ${new Date(r.lastInteraction).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                              </p>
                              {r.topics.length > 0 && (
                                <p className="text-[10px] text-neutral-400 mt-0.5">Topics: {r.topics.join(', ')}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Previous meetings */}
                  {prepBrief.pastMeetings.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Previous meetings</h2>
                      <div className="space-y-2">
                        {prepBrief.pastMeetings.map((pm, i) => (
                          <div key={i} className="px-3 py-2 bg-neutral-50 rounded-lg">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-[12px] font-medium text-neutral-700 truncate">{pm.title}</p>
                              <p className="text-[10px] text-neutral-400 flex-shrink-0">
                                {new Date(pm.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </p>
                            </div>
                            {pm.summary && <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{pm.summary}</p>}
                            {pm.decisions.length > 0 && (
                              <div className="mt-1.5 space-y-0.5">
                                {pm.decisions.slice(0, 3).map((d, j) => (
                                  <div key={j} className="flex items-start gap-1.5">
                                    <span className="w-1 h-1 rounded-full bg-blue-400 flex-shrink-0 mt-1.5" />
                                    <p className="text-[10px] text-blue-700">{d}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Open action items */}
                  {prepBrief.openActionItems.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Still open</h2>
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

                  {/* Recent relevant emails */}
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
                            {email.snippet && <p className="text-[10px] text-neutral-400 mt-0.5 line-clamp-1">{email.snippet}</p>}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Relevant KB docs */}
                  {prepBrief.relevantDocs.length > 0 && (
                    <section>
                      <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Relevant documents</h2>
                      <div className="space-y-1">
                        {prepBrief.relevantDocs.map((doc, i) => (
                          <div key={i} className="px-3 py-1.5 bg-neutral-50 rounded-lg">
                            <p className="text-[12px] font-medium text-neutral-700 truncate">{doc.title}</p>
                            {doc.snippet && <p className="text-[10px] text-neutral-400 line-clamp-2 mt-0.5">{doc.snippet}</p>}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Empty state */}
                  {!prepBrief.aiSummary && !prepBrief.agenda && prepBrief.relationships.length === 0 && prepBrief.pastMeetings.length === 0 && prepBrief.recentEmails.length === 0 && (
                    <p className="text-[12px] text-neutral-400 px-1">No prior context found for these attendees.</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ZONE D — Post-capture content ── */}

      {/* Meeting document — primary note view (hidden for draft text notes not yet AI-processed) */}
      {transcript?.processed && !isDraftNote && (
        <section className="mb-6">
          <MeetingDocument
            document={transcript.notesStructured?.document || transcript.summary || ''}
            eventId={eventId ?? null}
            editable
          />
          {!transcript.notesStructured?.document && !transcript.summary && (
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="mt-2 flex items-center gap-1.5 text-[12px] text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} />
              {reanalyzing ? 'Analyzing…' : 'Re-analyze with AI'}
            </button>
          )}
        </section>
      )}

      {/* Action items */}
      {transcript?.processed && !isDraftNote && actionItems.length > 0 && (
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

                  {/* Status label + undo, or action buttons */}
                  {isMine && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-emerald-600 font-medium">Mine</span>
                      <button
                        onClick={() => handleUndoConfirm(item.id)}
                        className="text-[10px] text-neutral-400 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Undo
                      </button>
                    </div>
                  )}
                  {isNotMine && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-neutral-400">Not mine</span>
                      <button
                        onClick={() => handleUndoDismiss(item.id)}
                        className="text-[10px] text-neutral-400 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Undo
                      </button>
                    </div>
                  )}
                  {isPending && (
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleConfirmItem(item.id)}
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

      {/* Your notes — raw notes the user typed */}
      {transcript?.processed && !isDraftNote && (() => {
        const userNotes = transcript.source === 'text'
          ? transcript.rawTranscript
          : transcript.notesStructured?.live_notes;
        if (!userNotes?.trim()) return null;
        return (
          <section className="mb-6 pt-4 border-t border-neutral-100">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <DocumentTextIcon className="w-3.5 h-3.5" />
              Your notes
            </h2>
            <div className="px-4 py-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <p className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
                {userNotes}
              </p>
            </div>
          </section>
        );
      })()}

      {/* Audio player */}
      {audioUrl && (
        <section className="mb-6">
          <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
            Recording{durationSeconds != null && <span className="ml-1.5 font-normal normal-case text-neutral-400">{fmtDuration(durationSeconds)}</span>}
          </h2>
          <audio
            controls
            preload="metadata"
            src={audioUrl}
            className="w-full h-9"
            style={{ accentColor: '#6366f1' }}
            onDurationChange={(e) => {
              const d = e.currentTarget.duration;
              if (isFinite(d) && d > 0) setAudioDuration(d);
            }}
            onError={(e) => {
              const err = (e.currentTarget as HTMLAudioElement).error;
              console.error('[Audio] Failed to load recording:', err?.code, err?.message);
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

    {/* ── AI chat teaser — only shown once there's a processed transcript to ask about ── */}
    {onRequestChat && transcript?.processed && !isDraftNote && (
      <div className={`sticky bottom-0 transition-all duration-200 ${chatIsOpen ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100 translate-y-0'}`}>
        <div className="relative px-6 max-w-2xl mx-auto w-full">
          {/* Gradient fade over scrolling content above */}
          <div className="absolute -top-16 inset-x-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          <div className="pb-8">
            <div className="rounded-2xl bg-white shadow-sm border border-neutral-200 overflow-hidden">
              <div className="px-4 pt-3 pb-1">
                <textarea
                  rows={1}
                  value={teaserValue}
                  onChange={(e) => setTeaserValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && teaserValue.trim()) {
                      e.preventDefault();
                      onRequestChat(teaserValue.trim());
                      setTeaserValue('');
                    }
                  }}
                  placeholder="Ask about this meeting…"
                  className="w-full resize-none bg-transparent text-[14px] text-neutral-800 placeholder:text-neutral-400 outline-none leading-relaxed"
                />
              </div>
              <div className="flex items-center px-3 pb-3 pt-1">
                <div className="ml-auto">
                  <button
                    onClick={() => {
                      if (!teaserValue.trim()) return;
                      onRequestChat(teaserValue.trim());
                      setTeaserValue('');
                    }}
                    disabled={!teaserValue.trim()}
                    className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
                  >
                    <PaperAirplaneIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Full-width white background strip so content doesn't bleed through */}
        <div className="absolute inset-0 bg-white -z-10" />
      </div>
    )}
    </div>
  );
}
