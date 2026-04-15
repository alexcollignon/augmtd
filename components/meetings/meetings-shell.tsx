'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatBubbleLeftIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { usePathname, useRouter } from 'next/navigation';
import type { DriveFolder } from '@/lib/types/drive';
import type { CalendarEvent } from '@/lib/types/meetings';
import { useRecordingContext } from '@/context/recording-context';
import {
  MeetingsDataContext,
  mapTranscripts,
  type Transcript,
  type LiveBot,
} from '@/context/meetings-data-context';
import type { MeetingChatContext } from '@/components/meetings/meeting-chat-sidebar';
import CaptureModal from '@/components/meetings/capture-modal';
import NewMeetingModal from '@/components/meetings/new-meeting-modal';
import MeetingsLeftPanel from '@/components/meetings/meetings-left-panel';
import FolderDetailView from '@/components/meetings/folder-detail-view';
import CalendarSidebar from '@/components/meetings/calendar-sidebar';
import MeetingChatSidebar from '@/components/meetings/meeting-chat-sidebar';
import ChatSidebar from '@/components/shared/chat-sidebar';

const SEEN_KEY = 'seen_transcripts';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

function loadSeenIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); }
  catch { return new Set(); }
}

interface MeetingsShellProps {
  userEmail: string;
  initialUpcoming?: CalendarEvent[];
  initialTranscripts?: Transcript[];
  initialFolders?: DriveFolder[];
  children: React.ReactNode;
}

export default function MeetingsShell({
  userEmail,
  initialUpcoming,
  initialTranscripts,
  initialFolders,
  children,
}: MeetingsShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  // ── Data state ──────────────────────────────────────────────────────────
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>(initialUpcoming ?? []);
  const [transcripts, setTranscripts] = useState<Transcript[]>(initialTranscripts ?? []);
  const [botStateMap, setBotStateMap] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    (initialUpcoming ?? []).forEach((e) => { if (e.attendee_bot_state) m.set(e.id, e.attendee_bot_state); });
    return m;
  });
  const [pendingAdhoc, setPendingAdhoc] = useState<{ initiatedAt: string } | null>(null);
  const [loading, setLoading] = useState(!initialUpcoming);
  const [folders, setFolders] = useState<DriveFolder[]>(initialFolders ?? []);
  const [seenIds, setSeenIds] = useState<Set<string>>(loadSeenIds);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [rightPanel, setRightPanel] = useState<'chat' | 'calendar' | null>('calendar');
  const [chatAutoMessage, setChatAutoMessage] = useState<string | undefined>(undefined);
  const [activeMeetingContext, setActiveMeetingContext] = useState<MeetingChatContext | null>(null);
  const [filterPersonEmail, setFilterPersonEmail] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);


  // Polling refs
  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedMeetingIdRef = useRef<string | null>(null);

  const recording = useRecordingContext();

  // Keep ref in sync with pathname-derived meeting id
  useEffect(() => {
    const match = pathname.match(/^\/meetings\/(.+)$/);
    selectedMeetingIdRef.current = match ? match[1] : null;
  }, [pathname]);

  // ── Data fetching ────────────────────────────────────────────────────────
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

      const mapped = mapTranscripts(transcriptsData.transcripts ?? []);
      setTranscripts(mapped);

      // Auto-open ad-hoc bot that started while user was away
      const activeAdHocBot = mapped.find(
        (t) => t.source === 'bot' && t.calendarEventId === null && !t.processed &&
          (t.botState === 'recording' || t.botState === 'joining')
      );
      if (activeAdHocBot && !selectedMeetingIdRef.current) {
        router.push(`/meetings/${activeAdHocBot.id}`);
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
  }, [router]);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  useEffect(() => {
    const ch = new BroadcastChannel('meetings-updated');
    ch.onmessage = () => fetchAll();
    return () => ch.close();
  }, [fetchAll]);

  useEffect(() => {
    if (initialFolders) return;
    fetch('/api/drive/folders')
      .then((r) => r.json())
      .then((data) => setFolders(Array.isArray(data) ? data : (data.folders ?? [])));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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


  // ── Handlers ─────────────────────────────────────────────────────────────
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


  // ── Derived ──────────────────────────────────────────────────────────────
  const upcomingNonCompleted = upcoming.filter((m) => m.meeting_status !== 'completed');
  const liveBots: LiveBot[] = [];
  for (const e of upcomingNonCompleted) {
    const state = botStateMap.get(e.id) ?? (e.attendee_bot_state ?? '');
    if (state === 'joining' || state === 'recording') {
      liveBots.push({ title: e.title, state: state as 'joining' | 'recording', calendarEventId: e.id, startedAt: e.start_time });
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

  // Derive nav state from URL
  const isHome = pathname === '/meetings';
  const isOnFolder = !!selectedFolderId;

  const selectedFolder = selectedFolderId ? folders.find((f) => f.id === selectedFolderId) : null;

  // Selected meeting id from URL for left panel highlighting
  const urlMeetingId = (() => {
    const m = pathname.match(/^\/meetings\/(.+)$/);
    return m ? m[1] : null;
  })();

  // ── Context value ─────────────────────────────────────────────────────────
  const contextValue = {
    transcripts,
    upcoming,
    folders,
    botStateMap,
    pendingAdhoc,
    loading,
    userEmail,
    liveBots,
    isNew,
    fetchAll,
    handleScheduled,
    handleCancelled,
    handleDeleteTranscript,
    handleRetryFailed,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    activeMeetingContext,
    setActiveMeetingContext,
    filterPersonEmail,
    setFilterPersonEmail,
    openChatPanel: (autoMessage?: string) => {
      setChatAutoMessage(autoMessage);
      setRightPanel('chat');
    },
    openCaptureModal: () => setShowCapture(true),
    openNewMeetingModal: () => setShowNewMeeting(true),
  };

  const handleOpenWorkflow = (title: string, skill?: string) => {
    const params = new URLSearchParams();
    if (title) params.set('title', title);
    if (skill) params.set('skill', skill);
    router.push(`/work/new${params.toString() ? `?${params.toString()}` : ''}`);
  };


  return (
    <MeetingsDataContext.Provider value={contextValue}>
      <div className="relative flex h-full overflow-hidden bg-neutral-50">
        {/* ── Left panel ── */}
        <MeetingsLeftPanel
          transcripts={transcripts}
          folders={folders}
          selectedFolderId={selectedFolderId}
          onSelectFolder={(id) => {
            setSelectedFolderId(id);
            setFilterPersonEmail(null);
            if (id) router.push('/meetings');
          }}
          onCreateFolder={handleCreateFolder}
          selectedMeetingId={urlMeetingId}
          onSelectMeeting={(id) => {
            setSelectedFolderId(null);
            setActiveMeetingContext(null);
            setChatAutoMessage(undefined);
            if (id) router.push(`/meetings/${id}`);
            else router.push('/meetings');
          }}
          filterPersonEmail={filterPersonEmail}
          onFilterPerson={(email) => {
            setFilterPersonEmail(email);
            setSelectedFolderId(null);
            router.push('/meetings');
          }}
          onNewNote={() => {
            setSelectedFolderId(null);
            router.push('/meetings/new');
          }}
          onNavigateHome={() => {
            setSelectedFolderId(null);
            setFilterPersonEmail(null);
            setActiveMeetingContext(null);
            if (rightPanel === 'chat') setRightPanel(null);
            router.push('/meetings');
          }}
          isHome={isHome && !isOnFolder}
          recordingState={
            recording.state === 'recording' || recording.state === 'uploading' || recording.state === 'processing'
              ? recording.state
              : null
          }
          recordingElapsed={recording.elapsed}
          recordingTitle={recording.recordingTitle}
          onNavigateToRecording={() => {
            const id = recording.recordingNoteId ?? recording.recordingEventId;
            if (id) router.push(`/meetings/${id}`);
            else router.push('/meetings/new');
          }}
        />

        {/* ── Main content ── */}
        <div className="flex-1 overflow-hidden flex flex-col bg-neutral-50 p-2 pr-0">
          <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 h-10 flex items-center justify-between px-4 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold text-neutral-700">
                  {selectedFolder ? selectedFolder.name : 'Meetings'}
                </h2>
              </div>
              <div className="flex items-center gap-1.5" />
            </div>

            {/* Body — folder view takes priority over URL-routed children */}
            <div className="flex-1 overflow-y-auto">
              {selectedFolder ? (
                <FolderDetailView
                  folder={selectedFolder}
                  transcripts={transcripts}
                  folders={folders}
                  onRename={handleRenameFolder}
                  onDelete={handleDeleteFolder}
                  isNew={isNew}
                />
              ) : (
                children
              )}
            </div>
          </div>
        </div>

        {/* ── Right panel ── */}
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
            {/* Calendar panel */}
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

        {/* ── Modals ── */}
        <CaptureModal
          isOpen={showCapture}
          onClose={() => setShowCapture(false)}
          onBotSent={() => setPendingAdhoc({ initiatedAt: new Date().toISOString() })}
          recording={recording}
        />
        <NewMeetingModal
          isOpen={showNewMeeting}
          onClose={() => setShowNewMeeting(false)}
          onSuccess={fetchAll}
        />
      </div>
    </MeetingsDataContext.Provider>
  );
}
