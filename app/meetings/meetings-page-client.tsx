'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MicrophoneIcon,
  ChatBubbleLeftIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import type { DriveFolder } from '@/lib/types/drive';
import type { CalendarEvent } from '@/lib/types/meetings';
import { useRecordingContext } from '@/context/recording-context';
import CaptureModal from '@/components/meetings/capture-modal';
import NewMeetingModal from '@/components/meetings/new-meeting-modal';
import MeetingsLeftPanel from '@/components/meetings/meetings-left-panel';
import FolderDetailView from '@/components/meetings/folder-detail-view';
import LiveNotepad from '@/components/meetings/live-notepad';
import InlineNoteView from '@/components/meetings/inline-note-view';
import MeetingsHome from '@/components/meetings/meetings-home';
import CalendarSidebar from '@/components/meetings/calendar-sidebar';
import MeetingChatSidebar, { type MeetingChatContext } from '@/components/meetings/meeting-chat-sidebar';
import ChatSidebar from '@/components/shared/chat-sidebar';

interface Transcript {
  id: string;
  calendarEventId: string | null;
  title: string;
  startTime: string;
  durationMinutes: number;
  workItemsGenerated: number;
  processed: boolean;
  botState: string | null;
  source: 'bot' | 'recording' | 'upload' | 'text';
  summary?: string | null;
  processedAt?: string | null;
  folderId?: string | null;
  hasRecording: boolean;
  hasDocument?: boolean;
  attendees?: Array<{ email: string; name?: string }>;
}

function mapTranscripts(raw: any[]): Transcript[] {
  return raw.map((t) => ({
    id: t.id,
    calendarEventId: t.calendar_event_id,
    title: t.title,
    startTime: t.start_time,
    durationMinutes: t.duration_minutes,
    workItemsGenerated: t.work_items_generated,
    processed: t.processed,
    botState: t.bot_state ?? null,
    source: t.source,
    summary: t.summary,
    processedAt: t.updated_at ?? null,
    folderId: t.folder_id ?? null,
    hasRecording: !!t.recording_storage_path,
    hasDocument: !!t.has_document,
    attendees: (t.attendees as any[]) ?? [],
  }));
}

const SEEN_KEY = 'seen_transcripts';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

function loadSeenIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); }
  catch { return new Set(); }
}

export default function MeetingsPageClient({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [botStateMap, setBotStateMap] = useState<Map<string, string>>(new Map());
  const [pendingAdhoc, setPendingAdhoc] = useState<{ initiatedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCapture, setShowCapture] = useState(false);
  const [captureMode, setCaptureMode] = useState<'record' | 'bot' | null>(null);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [rightPanel, setRightPanel] = useState<'chat' | 'calendar' | null>('calendar');
  const [filterPersonEmail, setFilterPersonEmail] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<Set<string>>(loadSeenIds);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [showAdHocNote, setShowAdHocNote] = useState(false);
  const [inlineNoteKey, setInlineNoteKey] = useState(0);
  const [activeMeetingContext, setActiveMeetingContext] = useState<MeetingChatContext | null>(null);
  const [chatAutoMessage, setChatAutoMessage] = useState<string | undefined>(undefined);

  // Bot live notes (for meetings where the bot is recording)
  const [botLiveNotes, setBotLiveNotes] = useState('');
  const [activeBotEvent, setActiveBotEvent] = useState<CalendarEvent | null>(null);
  const botNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [folders, setFolders] = useState<DriveFolder[]>([]);

  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs so fetchAll can read current nav state without being in its dep array
  const selectedMeetingIdRef = useRef<string | null>(null);
  const showAdHocNoteRef = useRef(false);
  useEffect(() => { selectedMeetingIdRef.current = selectedMeetingId; }, [selectedMeetingId]);
  useEffect(() => { showAdHocNoteRef.current = showAdHocNote; }, [showAdHocNote]);

  // Global recording hook — survives page navigation
  const recording = useRecordingContext();

  const fetchAll = useCallback(async () => {
    try {
      const [meetingsData, transcriptsData] = await Promise.all([
        fetch('/api/meetings').then((r) => r.json()),
        fetch('/api/meetings/transcripts').then((r) => r.json()),
      ]);

      const events: CalendarEvent[] = meetingsData.meetings ?? [];
      setUpcoming(events);

      const newMap = new Map<string, string>();
      for (const e of events) {
        if (e.attendee_bot_state) newMap.set(e.id, e.attendee_bot_state);
      }
      setBotStateMap(newMap);

      // Detect active bot recording for live notepad
      const recordingEvent = events.find(
        (e) => e.attendee_bot_state === 'recording' || e.attendee_bot_state === 'joining'
      );
      setActiveBotEvent(recordingEvent ?? null);

      const mapped = mapTranscripts(transcriptsData.transcripts ?? []);
      setTranscripts(mapped);

      // If an ad-hoc bot meeting is actively recording/joining and the user has no meeting
      // open (e.g. they navigated away and came back), auto-open the InlineNoteView for it
      // so they can still take live notes.
      const activeAdHocBot = mapped.find(
        (t) => t.source === 'bot' && t.calendarEventId === null && !t.processed &&
          (t.botState === 'recording' || t.botState === 'joining')
      );
      if (activeAdHocBot && !selectedMeetingIdRef.current && !showAdHocNoteRef.current) {
        setSelectedMeetingId(activeAdHocBot.id);
      }

      setPendingAdhoc((prev) => {
        if (!prev) return null;
        const found = mapped.find(
          (t) =>
            t.source === 'bot' &&
            t.calendarEventId === null &&
            !t.processed &&
            new Date(t.startTime).getTime() >= new Date(prev.initiatedAt).getTime() - 60_000
        );
        return found ? null : prev;
      });
    } catch {
      // Swallow — polling will retry
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  // Refresh when a recording completes (broadcast from global RecordingProvider)
  useEffect(() => {
    const ch = new BroadcastChannel('meetings-updated');
    ch.onmessage = () => fetchAll();
    return () => ch.close();
  }, [fetchAll]);

  useEffect(() => {
    fetch('/api/drive/folders')
      .then((r) => r.json())
      .then((data) => setFolders(Array.isArray(data) ? data : (data.folders ?? [])));
  }, []);

  // Debounced save of bot live notes to metadata
  const saveBotLiveNotes = useCallback((notes: string, eventId: string) => {
    if (botNotesTimerRef.current) clearTimeout(botNotesTimerRef.current);
    botNotesTimerRef.current = setTimeout(() => {
      fetch(`/api/meetings/${eventId}/live-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liveNotes: notes }),
      }).catch(() => {});
    }, 2000);
  }, []);

  const handleBotLiveNotesChange = (notes: string) => {
    setBotLiveNotes(notes);
    if (activeBotEvent) saveBotLiveNotes(notes, activeBotEvent.id);
  };

  // Adaptive polling
  useEffect(() => {
    const liveStates = new Set(['joining', 'recording', 'scheduled']);
    const upcomingNonCompleted = upcoming.filter((m) => m.meeting_status !== 'completed');
    const hasLiveBot = upcomingNonCompleted.some((e) => {
      const state = botStateMap.get(e.id) ?? e.attendee_bot_state ?? '';
      return liveStates.has(state);
    });
    const hasProcessing = transcripts.some((t) => !t.processed);
    const isActive = hasLiveBot || hasProcessing || pendingAdhoc !== null || recording.state === 'recording';
    isActiveRef.current = isActive;

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchAll, isActive ? 5_000 : 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [upcoming, transcripts, botStateMap, pendingAdhoc, fetchAll, recording.state]);

  // Mark seen after 3s
  useEffect(() => {
    if (transcripts.length === 0) return;
    const timer = setTimeout(() => {
      const ids = transcripts.map((t) => t.id);
      const merged = [...Array.from(seenIds), ...ids].slice(-200);
      localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
      setSeenIds(new Set(merged));
    }, 3000);
    return () => clearTimeout(timer);
  }, [transcripts.length]); // eslint-disable-line

  const handleScheduled = (eventId: string) => setBotStateMap((prev) => new Map(prev).set(eventId, 'scheduled'));
  const handleCancelled = (eventId: string) => setBotStateMap((prev) => new Map(prev).set(eventId, 'cancelled'));

  const handleCreateFolder = async (name: string) => {
    const res = await fetch('/api/drive/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const folder: DriveFolder = await res.json();
      setFolders((prev) => [...prev, folder]);
    }
  };

  const handleRenameFolder = async (id: string, name: string) => {
    const res = await fetch(`/api/drive/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const updated: DriveFolder = await res.json();
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
    }
  };

  const handleDeleteFolder = async (id: string) => {
    const res = await fetch(`/api/drive/folders/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setFolders((prev) => prev.filter((f) => f.id !== id));
      if (selectedFolderId === id) setSelectedFolderId(null);
    }
  };

  const handleRequestChat = (autoMessage?: string) => {
    setChatAutoMessage(autoMessage);
    setRightPanel('chat');
  };

  const handleOpenWorkflow = (title: string, skill?: string) => {
    const params = new URLSearchParams();
    if (title) params.set('title', title);
    if (skill) params.set('skill', skill);
    router.push(`/work/new${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleOpenProcess = (processId: string) => {
    router.push(`/processes/${processId}`);
  };

  const handleDeleteTranscript = async (transcriptId: string) => {
    setTranscripts((prev) => prev.filter((t) => t.id !== transcriptId));
    try {
      await fetch(`/api/meetings/recording/${transcriptId}`, { method: 'DELETE' });
    } catch {
      fetchAll();
    }
  };

  const handleRetryFailed = async (transcriptId: string) => {
    setTranscripts((prev) =>
      prev.map((t) =>
        t.id === transcriptId ? { ...t, processed: false, botState: 'processing' } : t
      )
    );
    try {
      await fetch(`/api/meetings/recording/${transcriptId}/retry`, { method: 'POST' });
    } catch {
      fetchAll();
    }
  };

  // Derived
  const upcomingNonCompleted = upcoming.filter((m) => m.meeting_status !== 'completed');
  const liveBots: Array<{ title: string; state: 'joining' | 'recording'; calendarEventId: string | null; startedAt?: string }> = [];
  for (const e of upcomingNonCompleted) {
    const state = botStateMap.get(e.id) ?? (e.attendee_bot_state ?? '');
    if (state === 'joining' || state === 'recording') {
      liveBots.push({ title: e.title, state, calendarEventId: e.id, startedAt: e.start_time });
    }
  }
  if (pendingAdhoc) {
    liveBots.push({ title: 'Ad-hoc meeting', state: 'joining', calendarEventId: null, startedAt: pendingAdhoc.initiatedAt });
  }
  const adhocLive = transcripts.filter(
    (t) => t.source === 'bot' && t.calendarEventId === null && !t.processed &&
      (t.botState === 'joining' || t.botState === 'recording')
  );
  for (const t of adhocLive) {
    liveBots.push({ title: t.title || 'Ad-hoc meeting', state: t.botState === 'recording' ? 'recording' : 'joining', calendarEventId: null, startedAt: t.startTime });
  }


  const cutoff = Date.now() - TWENTY_FOUR_HOURS;
  const isNew = (t: Transcript) =>
    !seenIds.has(t.id) && t.processed && t.botState !== 'failed' && t.processedAt != null &&
    new Date(t.processedAt).getTime() > cutoff;

  // Determine if live notepad should show — only when NOT already inside an inline note
  // (inline note handles recording display itself)
  const showInlineNoteActive = !!(selectedMeetingId || showAdHocNote);
  // LiveNotepad is only for in-person recording. Scheduled bot meetings use InlineNoteView directly.
  const showLiveNotepad = recording.state === 'recording' && !showInlineNoteActive;
  const selectedFolder = selectedFolderId ? folders.find((f) => f.id === selectedFolderId) : null;

  // Determine center panel content
  const showInlineNote = !showLiveNotepad && !selectedFolder && showInlineNoteActive;
  const isHome = !showInlineNote && !selectedFolder && !showLiveNotepad;

  return (
    <div className="relative flex h-full overflow-hidden bg-neutral-50">
      {/* ── Left panel — meetings nav ── */}
      <MeetingsLeftPanel
        transcripts={transcripts}
        folders={folders}
        selectedFolderId={selectedFolderId}
        onSelectFolder={(id) => {
          setSelectedFolderId(id);
          setSelectedMeetingId(null);
          
          setFilterPersonEmail(null);
        }}
        onCreateFolder={handleCreateFolder}
        selectedMeetingId={selectedMeetingId}
        onSelectMeeting={(id) => {
          setSelectedMeetingId(id);
          
          setActiveMeetingContext(null);
          setChatAutoMessage(undefined);
          if (id) setSelectedFolderId(null);
        }}
        filterPersonEmail={filterPersonEmail}
        onFilterPerson={(email) => {
          setFilterPersonEmail(email);
          setSelectedMeetingId(null);
          setSelectedFolderId(null);
          
        }}
        onNewNote={() => {
          setSelectedMeetingId(null);
          setSelectedFolderId(null);
          setShowAdHocNote(true);
          setInlineNoteKey((k) => k + 1);
        }}
        onNavigateHome={() => {
          setSelectedMeetingId(null);
          setSelectedFolderId(null);
          setShowAdHocNote(false);
          setFilterPersonEmail(null);
          setActiveMeetingContext(null);
          if (rightPanel === 'chat') setRightPanel(null);
        }}
        isHome={!selectedMeetingId && !selectedFolderId && !showAdHocNote && !showLiveNotepad}
      />

      {/* ── Main content ── */}
      <div className="flex-1 overflow-hidden flex flex-col bg-neutral-50 p-2 pr-0">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {/* Main header */}
          <div className="flex-shrink-0 h-10 flex items-center justify-between px-4 border-b border-neutral-100">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold text-neutral-700">
                {selectedFolder ? selectedFolder.name
                  : showLiveNotepad ? recording.recordingTitle || 'Meeting'
                  : 'Meetings'}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {!showInlineNote && (
                <button
                  onClick={() => setShowCapture(true)}
                  className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
                >
                  <MicrophoneIcon className="w-3 h-3" />
                  Capture
                </button>
              )}
            </div>
          </div>

          {/* Main body */}
          <div className="flex-1 overflow-y-auto">
            {showLiveNotepad ? (
              <LiveNotepad
                title={recording.recordingTitle || 'Meeting'}
                elapsed={recording.elapsed}
                notes={recording.liveNotes}
                onNotesChange={recording.setLiveNotes}
                source="recording"
              />
            ) : selectedFolder ? (
              /* Folder detail view */
              <FolderDetailView
                folder={selectedFolder}
                transcripts={transcripts}
                folders={folders}
                onRename={handleRenameFolder}
                onDelete={handleDeleteFolder}
                isNew={isNew}
              />
            ) : showInlineNote ? (
              /* Inline note view — works for both scheduled (eventId set) and ad-hoc (eventId null) */
              <InlineNoteView
                key={inlineNoteKey}
                eventId={selectedMeetingId ?? null}
                onBack={() => {
                  setSelectedMeetingId(null);
                  setShowAdHocNote(false);
                  setActiveMeetingContext(null);
                  fetchAll();
                }}
                onMeetingContextReady={setActiveMeetingContext}
                onRequestChat={handleRequestChat}
                onNoteRowCreated={() => fetchAll()}
                onCreated={(id) => {
                  setShowAdHocNote(false);
                  setSelectedMeetingId(id);
                  fetchAll();
                }}
                onNewBot={() => {
                  setCaptureMode('bot');
                  setShowCapture(true);
                }}
                onStartRecording={(title, calendarEventId, noteId) => recording.startRecording(title, calendarEventId, noteId)}
              />
            ) : (
              /* Default: Home screen */
              <MeetingsHome
                upcoming={upcoming}
                transcripts={transcripts}
                filterPersonEmail={filterPersonEmail}
                onSelectMeeting={(id) => {
                  setSelectedMeetingId(id);
                  setActiveMeetingContext(null);
                  setChatAutoMessage(undefined);
                  setSelectedFolderId(null);
                }}
                onDeleteTranscript={handleDeleteTranscript}
                onRetryFailed={handleRetryFailed}
                isNew={isNew}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Right column ── */}
      <div className={`flex-shrink-0 bg-neutral-50 flex flex-col transition-[width] duration-200 overflow-hidden ${rightPanel ? 'w-[316px]' : 'w-12'}`}>
        {/* Closed — icon strip */}
        <div className={`flex flex-col items-center pt-3 gap-1.5 transition-opacity duration-150 ${rightPanel ? 'opacity-0 pointer-events-none absolute' : 'opacity-100'}`}>
          <button
            onClick={() => setRightPanel('calendar')}
            title="Calendar"
            className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors"
          >
            <CalendarDaysIcon className="w-4 h-4" />
          </button>
          {!isHome && (
            <button
              onClick={() => {
                setChatAutoMessage(undefined);
                setRightPanel('chat');
              }}
              title="AI Chat"
              className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors"
            >
              <ChatBubbleLeftIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Open — full panel */}
        <div className={`flex-1 relative p-2 min-h-0 transition-opacity duration-150 ${rightPanel ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {/* Calendar panel — opacity-only (no transform: avoids position:fixed overlay bugs) */}
          <div className={`absolute inset-2 transition-opacity duration-200 ${rightPanel === 'calendar' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
              <CalendarSidebar
                meetings={upcoming}
                userEmail={userEmail}
                botStateMap={botStateMap}
                onScheduled={handleScheduled}
                onCancelled={handleCancelled}
                onRefresh={fetchAll}
                onNewMeeting={() => setShowNewMeeting(true)}
                onClose={() => setRightPanel(null)}
                onOpenChat={() => { setChatAutoMessage(undefined); setRightPanel('chat'); }}
                showViewToggle
              />
            </div>
          </div>

          {/* Chat panel */}
          <div className={`absolute inset-2 transition-all duration-200 ${rightPanel === 'chat' ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-2 pointer-events-none'}`}>
            <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
              {activeMeetingContext ? (
                <MeetingChatSidebar
                  inline
                  isOpen
                  onClose={() => { setRightPanel(null); setChatAutoMessage(undefined); }}
                  meetingContext={activeMeetingContext}
                  onOpenWorkflow={handleOpenWorkflow}
                  onOpenProcess={handleOpenProcess}
                  autoMessage={chatAutoMessage}
                  onSwitchPanel={() => setRightPanel('calendar')}
                />
              ) : (
                <ChatSidebar
                  inline
                  isOpen
                  onClose={() => setRightPanel(null)}
                  context="meeting"
                  onSwitchPanel={() => setRightPanel('calendar')}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <CaptureModal
        isOpen={showCapture}
        onClose={() => { setShowCapture(false); setCaptureMode(null); }}
        onBotSent={() => setPendingAdhoc({ initiatedAt: new Date().toISOString() })}
        recording={recording}
      />
      <NewMeetingModal
        isOpen={showNewMeeting}
        onClose={() => setShowNewMeeting(false)}
        onSuccess={fetchAll}
      />
    </div>
  );
}
