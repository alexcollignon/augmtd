'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChatBubbleLeftIcon,
  CalendarDaysIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { usePathname, useRouter } from 'next/navigation';
import type { DriveFolder } from '@/lib/types/drive';
import type { CalendarEvent } from '@/lib/types/meetings';
import { useRecordingContext } from '@/context/recording-context';
import {
  MeetingsDataContext,
  mapTranscripts,
  type Transcript,
} from '@/context/meetings-data-context';
import type { MeetingChatContext } from '@/components/meetings/meeting-chat-sidebar';
import CaptureModal from '@/components/meetings/capture-modal';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
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
  // Instant-load: start from the SSR initials (or empty) — the SAME value on server + client, so no
  // hydration mismatch — then hydrate the localStorage fallback in a layout effect below (reading the cache
  // in the initializer would populate on the client but not the server). fetchAll refreshes after.
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>(initialUpcoming ?? []);
  const [transcripts, setTranscripts] = useState<Transcript[]>(initialTranscripts ?? []);
  const [loading, setLoading] = useState(!initialUpcoming);
  useLayoutEffect(() => {
    if (initialUpcoming) return; // SSR already provided the data
    const c = loadLS<{ upcoming: CalendarEvent[]; transcripts: Transcript[] }>('aug-meetings-v1');
    if (c) { setUpcoming(c.upcoming ?? []); setTranscripts(c.transcripts ?? []); setLoading(false); }
  }, [initialUpcoming]);
  const [folders, setFolders] = useState<DriveFolder[]>(initialFolders ?? []);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());

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

  // Keep ref in sync with pathname-derived meeting id; set correct panel per page type
  useEffect(() => {
    const match = pathname.match(/^\/meetings\/(.+)$/);
    selectedMeetingIdRef.current = match ? match[1] : null;
    if (match) {
      setRightPanel(null);
    } else if (pathname === '/meetings') {
      setRightPanel('calendar');
    }
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

      const mapped = mapTranscripts(transcriptsData.transcripts ?? []);
      setTranscripts(mapped);
      saveLS('aug-meetings-v1', { upcoming: events, transcripts: mapped }); // cache for instant re-entry
    } catch {
      // Swallow — polling will retry
    }
  }, [router]);

  useEffect(() => {
    setSeenIds(loadSeenIds());
  }, []);

  useEffect(() => {
    // Don't force a skeleton when we already have SSR/cached data — just refresh silently in the
    // background. `loading` was initialised true only when there was genuinely nothing to show.
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  useEffect(() => {
    const ch = new BroadcastChannel('meetings-updated');
    ch.onmessage = () => fetchAll();
    return () => ch.close();
  }, [fetchAll]);

  useEffect(() => {
    if (initialFolders) return;
    fetch('/api/meetings/folders')
      .then((r) => r.json())
      .then((data) => setFolders(Array.isArray(data) ? data : (data.folders ?? [])));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Projects (unification) — the same projects as Home; a meeting shows its project + can be filed into one.
  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then((d) => setProjects((d.projects ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))).catch(() => {});
  }, []);
  // File a meeting into a project (or clear) — sticky (server sets project_locked). Optimistic.
  const moveToProject = async (transcriptId: string, projectId: string | null) => {
    setTranscripts((prev) => prev.map((t) => t.id === transcriptId ? { ...t, projectId } : t));
    try { await fetch('/api/items/project', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'meeting', id: transcriptId, projectId }) }); }
    catch { /* non-fatal; next fetchAll reconciles */ }
  };

  // Adaptive polling
  useEffect(() => {
    const hasProcessing = transcripts.some((t) => !t.processed);
    const isActive = hasProcessing || recording.state === 'recording';
    isActiveRef.current = isActive;

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchAll, isActive ? 5_000 : 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [transcripts, fetchAll, recording.state]);

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
  const handleCreateFolder = async (name: string) => {
    const res = await fetch('/api/meetings/folders', {
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
    const res = await fetch(`/api/meetings/folders/${id}`, {
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
    const res = await fetch(`/api/meetings/folders/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setFolders((prev) => prev.filter((f) => f.id !== id));
      if (selectedFolderId === id) setSelectedFolderId(null);
    }
  };

  const handleMoveToFolder = async (transcriptId: string, folderId: string | null) => {
    setTranscripts((prev) => prev.map((t) => t.id === transcriptId ? { ...t, folderId } : t));
    try {
      await fetch(`/api/meetings/recording/${transcriptId}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
    } catch {
      fetchAll();
    }
  };

  const handleRenameTranscript = async (id: string, title: string) => {
    setTranscripts((prev) => prev.map((t) => t.id === id ? { ...t, title } : t));
    try {
      await fetch(`/api/meetings/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    } catch {
      fetchAll();
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
    projects,
    moveToProject,
    loading,
    userEmail,
    isNew,
    fetchAll,
    handleDeleteTranscript,
    handleRetryFailed,
    handleMoveToFolder,
    handleRenameTranscript,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    activeMeetingContext,
    setActiveMeetingContext,
    filterPersonEmail,
    setFilterPersonEmail,
    chatIsOpen: rightPanel === 'chat',
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
          onMoveToFolder={handleMoveToFolder}
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
            const id = recording.recordingEventId ?? recording.recordingNoteId;
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
              <button
                onClick={() => router.push('/meetings/new')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[12px] font-medium transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                New note
              </button>
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
            {isHome ? (
              <button
                onClick={() => setRightPanel('calendar')}
                title="Calendar"
                className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors"
              >
                <CalendarDaysIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => { setChatAutoMessage(undefined); setRightPanel('chat'); }}
                title="AI Chat"
                className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors"
              >
                <ChatBubbleLeftIcon className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Open — full panel */}
          <div className={`flex-1 relative p-2 min-h-0 transition-opacity duration-150 ${rightPanel ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            {isHome ? (
              /* Home: calendar only */
              <div className="absolute inset-2">
                <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
                  <CalendarSidebar
                    meetings={upcoming}
                    userEmail={userEmail}
                    onRefresh={fetchAll}
                    onNewMeeting={() => setShowNewMeeting(true)}
                    onClose={() => setRightPanel(null)}
                    showViewToggle
                  />
                </div>
              </div>
            ) : (
              /* Meeting detail: chat only */
              <div className={`absolute inset-2 transition-all duration-200 ${rightPanel === 'chat' ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-2 pointer-events-none'}`}>
                <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
                  {activeMeetingContext ? (
                    <MeetingChatSidebar
                      inline
                      isOpen
                      onClose={() => { setRightPanel(null); setChatAutoMessage(undefined); }}
                      meetingContext={activeMeetingContext}
                      onOpenWorkflow={handleOpenWorkflow}
                      autoMessage={chatAutoMessage}
                    />
                  ) : (
                    <ChatSidebar
                      inline
                      isOpen
                      onClose={() => setRightPanel(null)}
                      context="meeting"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Modals ── */}
        <CaptureModal
          isOpen={showCapture}
          onClose={() => setShowCapture(false)}
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
