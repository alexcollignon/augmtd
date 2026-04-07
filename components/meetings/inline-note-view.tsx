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
  onNoteRowCreated?: () => void;
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
  onNoteRowCreated,
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
  const noteIdRef = useRef<string | null>(null);      // mirrors noteId, updated synchronously
  const creatingNoteRef = useRef(false);              // guard: only one POST ever in-flight
  const createOnOpenFiredRef = useRef(false);         // guard: survives StrictMode fake-unmount
  // Live notes typed while bot is recording — saved to transcript.notes_structured.live_notes
  const [botLiveNotes, setBotLiveNotes] = useState('');
  const botLiveNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capture state
  const [botScheduled, setBotScheduled] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Ad-hoc bot send state (inline — no modal)
  const [adHocBotSending, setAdHocBotSending] = useState(false);
  const [adHocBotSent, setAdHocBotSent] = useState(false);
  const [adHocBotState, setAdHocBotState] = useState<string | null>(null); // 'joining' | 'recording' | null
  const [adHocBotFailed, setAdHocBotFailed] = useState(false); // true after 2-min timeout with no transcript
  const adHocBotPollCountRef = useRef(0);

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
  const [reanalyzing, setReanalyzing] = useState(false);

  // Post-capture UI — confirmedDeskIds maps actionItem.id → desk_item.id for undo/delete
  const [confirmedDeskIds, setConfirmedDeskIds] = useState<Map<string, string>>(new Map());
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
      // Restore any live notes typed while the bot was recording
      if (data.transcript?.notesStructured?.live_notes) {
        setBotLiveNotes(data.transcript.notesStructured.live_notes);
      }
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

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      if (botLiveNotesTimerRef.current) clearTimeout(botLiveNotesTimerRef.current);
    };
  }, []);

  // Create-on-open for ad-hoc notes: immediately create a DB row so every keystroke is a PATCH,
  // eliminating the race condition where rapid typing fired multiple POSTs.
  // The row appears in the "Live" section straight away via onNoteRowCreated → fetchAll.
  // createOnOpenFiredRef (a ref, not state) survives React StrictMode's fake-unmount so only
  // one POST fires even though the effect runs twice in development.
  useEffect(() => {
    if (!isAdHoc || createOnOpenFiredRef.current) return;
    createOnOpenFiredRef.current = true;
    fetch('/api/meetings/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', body: '' }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.id) return;
        noteIdRef.current = data.id;
        setNoteId(data.id);
        onNoteRowCreated?.();
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for the bot transcript after "Send assistant" is clicked.
  // Hetzner creates the row asynchronously (joining → recording → processing).
  // When found, switch to the bot transcript's InlineNoteView via onCreated.
  // Fallback: after 24 polls (~2 minutes) with no result, restore "Finish".
  useEffect(() => {
    if (!adHocBotSent || !noteIdRef.current) return;
    adHocBotPollCountRef.current = 0;

    const interval = setInterval(async () => {
      adHocBotPollCountRef.current += 1;

      // 2-minute timeout: 24 × 5s = 120s
      if (adHocBotPollCountRef.current > 24) {
        clearInterval(interval);
        setAdHocBotFailed(true);
        return;
      }

      try {
        const res = await fetch(`/api/meetings/bot/linked/${noteIdRef.current}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.notFound) return;

        // Bot transcript found — update indicator state
        setAdHocBotState(data.botState);

        // Once the bot has moved past joining/recording (i.e. it's processing or done),
        // navigate to the bot transcript view so the user sees the result naturally.
        if (data.botState !== 'joining' && data.botState !== 'recording') {
          clearInterval(interval);
          onCreated?.(data.id);
        }
      } catch {}
    }, 5000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adHocBotSent]);

  // handleBack: for ad-hoc notes, delete the row if user navigated away without writing anything.
  const handleBack = useCallback(async () => {
    // Delete the note row if user navigated away without writing anything.
    // Applies to: fresh ad-hoc notes (isAdHoc) and ad-hoc drafts returned via Live section
    // (detected by synthetic event: event.id === transcript.id).
    const isSyntheticEvent = event && transcript && event.id === transcript.id;
    // Skip deletion if bot was sent — text note holds live notes that generate-insights needs
    if (!adHocBotSent && noteIdRef.current && !noteBody.trim() && !adHocTitle.trim() && (isAdHoc || isSyntheticEvent)) {
      await fetch(`/api/meetings/notes/${noteIdRef.current}`, { method: 'DELETE' }).catch(() => {});
    }
    onBack();
  }, [isAdHoc, adHocBotSent, noteBody, adHocTitle, event, transcript, onBack]);

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
    // Subsequent saves (PATCH): debounce 2s to avoid hammering the API while typing.
    const delay = noteIdRef.current ? 2000 : 0;
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
  }, [eventId, adHocTitle, event?.title]);

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

  const handleSendAdHocBot = async () => {
    if (!adHocLink.trim() || adHocBotSending) return;
    setAdHocBotSending(true);
    try {
      const res = await fetch('/api/meetings/bot/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingUrl: adHocLink.trim(),
          calendarEventId: noteIdRef.current ?? undefined,
          title: adHocTitle || 'Ad-hoc meeting',
        }),
      });
      if (res.ok) {
        setAdHocBotSent(true);
        onNoteRowCreated?.(); // refresh list so MeetingsHome deduplication works
      }
    } catch {} finally {
      setAdHocBotSending(false);
    }
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
      if (res.ok) {
        const { item: deskItem } = await res.json();
        setConfirmedDeskIds((prev) => new Map(prev).set(item.id, deskItem.id));
      }
    } catch {}
  };

  const handleUndoConfirm = async (actionItemId: string) => {
    const deskItemId = confirmedDeskIds.get(actionItemId);
    if (deskItemId) {
      try {
        await fetch(`/api/desk/${deskItemId}`, { method: 'DELETE' });
      } catch {}
    }
    setConfirmedDeskIds((prev) => { const m = new Map(prev); m.delete(actionItemId); return m; });
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

  const saveBotLiveNotes = useCallback((notes: string, transcriptId: string) => {
    if (botLiveNotesTimerRef.current) clearTimeout(botLiveNotesTimerRef.current);
    botLiveNotesTimerRef.current = setTimeout(() => {
      fetch(`/api/meetings/recording/${transcriptId}/live-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liveNotes: notes }),
      }).catch(() => {});
    }, 1500);
  }, []);

  const handleDelete = async () => {
    if (!event) return;
    setDeleting(true);
    try {
      // Remove any manually-added desk items for this meeting's action items
      const deskDeletePromises = Array.from(confirmedDeskIds.values()).map((deskItemId) =>
        fetch(`/api/desk/${deskItemId}`, { method: 'DELETE' }).catch(() => {})
      );
      await Promise.all(deskDeletePromises);

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

  // Draft text note: saved to DB but AI hasn't run yet — show full active-phase UI
  const isDraftNote = !!transcript && transcript.source === 'text' &&
    transcript.processed && !transcript.notesStructured?.document && !transcript.summary;

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">

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
                // Trigger debounced save so title is persisted even without body changes
                debouncedNoteBodySave(noteBody);
              }}
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
              {adHocBotSent ? (
                <span className="flex items-center gap-1.5 text-[12px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium flex-shrink-0">
                  <ComputerDesktopIcon className="w-3 h-3" />
                  Assistant joining…
                </span>
              ) : (
                <button
                  onClick={() => {
                    if (adHocLink.trim()) handleSendAdHocBot();
                    else { setLinkFlash(true); linkInputRef.current?.focus(); setTimeout(() => setLinkFlash(false), 1200); }
                  }}
                  disabled={adHocBotSending}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-full transition-colors flex-shrink-0 ${
                    adHocLink.trim()
                      ? 'text-white bg-indigo-600 hover:bg-indigo-700'
                      : 'text-neutral-400 bg-neutral-100 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <ComputerDesktopIcon className="w-3 h-3" />
                  {adHocBotSending ? 'Sending…' : 'Send assistant'}
                </button>
              )}
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
          {/* Live note-taking while bot is recording; read-only once transcribing */}
          {(transcript.botState === 'recording' || transcript.botState === 'joining') ? (
            <div className="mt-3 px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-lg">
              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Your notes</p>
              <textarea
                value={botLiveNotes}
                onChange={(e) => {
                  setBotLiveNotes(e.target.value);
                  saveBotLiveNotes(e.target.value, transcript.id);
                }}
                placeholder="Jot down key points while the assistant records…"
                rows={4}
                className="w-full text-[13px] text-neutral-700 leading-relaxed outline-none placeholder:text-neutral-400 bg-transparent resize-none"
              />
            </div>
          ) : botLiveNotes ? (
            <div className="mt-3 px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-b-lg">
              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Your notes</p>
              <p className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap">{botLiveNotes}</p>
            </div>
          ) : null}
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

      {recording.state === 'uploading' && (
        <div className="flex items-center gap-2 mb-4 text-[12px] text-neutral-500">
          <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-indigo-500 animate-spin flex-shrink-0" />
          Uploading recording…
        </div>
      )}

      {recording.state === 'processing' && (
        <div className="flex items-center gap-2 mb-4 text-[12px] text-neutral-500">
          <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-indigo-500 animate-spin flex-shrink-0" />
          Transcribing and analysing…
        </div>
      )}

      {(!transcript || isDraftNote) && recording.state !== 'recording' && recording.state !== 'uploading' && recording.state !== 'processing' && (
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


          {/* Bot joining/recording indicator — replaces Record + Finish when bot was sent */}
          {adHocBotSent && !adHocBotFailed && (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${adHocBotState === 'recording' ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-400 animate-pulse'}`} />
              {adHocBotState === 'recording' ? 'Recording — notes will be combined with transcript' : 'Assistant joining…'}
            </span>
          )}

          {/* Bot failure fallback — reappears after 2-minute timeout */}
          {adHocBotFailed && (
            <span className="text-[12px] text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
              Bot didn&apos;t join —
            </span>
          )}

          {/* Record in person — hidden when bot was sent */}
          {!adHocBotSent && (
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
          )}

          {/* Finish — triggers AI analysis. Hidden when bot is in charge (bot sent + not failed). */}
          {(noteBody.trim() || adHocTitle.trim() || (isDraftNote && event?.id === transcript?.id)) && (!adHocBotSent || adHocBotFailed) && (
            <button
              onClick={handleProcessNote}
              disabled={noteProcessing}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 rounded-full transition-colors"
            >
              <SparklesIcon className="w-3 h-3" />
              {noteProcessing ? 'Processing…' : adHocBotFailed ? 'Finish (process notes)' : 'Finish'}
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
            onChange={(e) => {
              setNoteBody(e.target.value);
              debouncedNoteBodySave(e.target.value);
            }}
            placeholder={adHocBotSent
              ? 'Jot live notes — they\'ll be combined with the transcript when the meeting ends…'
              : isAdHoc
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
              const isMine = confirmedDeskIds.has(item.id);
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
                      <span className="text-[10px] text-emerald-600 font-medium">Added to desk</span>
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
