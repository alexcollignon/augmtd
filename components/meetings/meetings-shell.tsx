'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChatBubbleLeftIcon,
  CalendarDaysIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { usePathname, useRouter } from 'next/navigation';
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
import { broadcastProjectsUpdated, onProjectsUpdated } from '@/lib/projects/broadcast';
import NewMeetingModal from '@/components/meetings/new-meeting-modal';
import MeetingsLeftPanel from '@/components/meetings/meetings-left-panel';
import ProjectMeetingsView from '@/components/meetings/project-meetings-view';
import CalendarSidebar from '@/components/meetings/calendar-sidebar';
import MeetingChatSidebar from '@/components/meetings/meeting-chat-sidebar';
import ChatSidebar from '@/components/shared/chat-sidebar';
import { createPortal } from 'react-dom';

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
  children: React.ReactNode;
}

export default function MeetingsShell({
  userEmail,
  initialUpcoming,
  initialTranscripts,
  children,
}: MeetingsShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  // ── Data state ──────────────────────────────────────────────────────────
  // Instant-load: start from the SSR initials (or empty) — the SAME value on server + client, so no
  // hydration mismatch — then hydrate the localStorage fallback in a layout effect below (reading the cache
  // in the initializer would populate on the client but not the server). fetchAll refreshes after.
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>(initialUpcoming ?? []);
  const [rawTranscripts, setRawTranscripts] = useState<Transcript[]>(initialTranscripts ?? []);
  const [loading, setLoading] = useState(!initialUpcoming);
  useLayoutEffect(() => {
    if (initialUpcoming) return; // SSR already provided the data
    const c = loadLS<{ upcoming: CalendarEvent[]; transcripts: Transcript[] }>('aug-meetings-v1');
    if (c) { setUpcoming(c.upcoming ?? []); setRawTranscripts(c.transcripts ?? []); setLoading(false); }
  }, [initialUpcoming]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; tracked?: boolean }>>([]);
  // Suggested initiatives that HAVE meetings — surfaced in the sidebar so a labeled-but-untracked meeting
  // (e.g. a recorded call the initiative machine tagged) is visible + one-click trackable, mirroring Home.
  type MeetingSuggestion = { key: string; name: string; meetingIds: string[]; items: Array<{ table: string; id: string }> };
  const [suggestions, setSuggestions] = useState<MeetingSuggestion[]>([]);
  const [trackingKey, setTrackingKey] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());

  // ── UI state ─────────────────────────────────────────────────────────────
  const [rightPanel, setRightPanel] = useState<'chat' | 'calendar' | null>('calendar');
  const [chatAutoMessage, setChatAutoMessage] = useState<string | undefined>(undefined);
  const [activeMeetingContext, setActiveMeetingContext] = useState<MeetingChatContext | null>(null);
  const [filterPersonEmail, setFilterPersonEmail] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSuggestionKey, setSelectedSuggestionKey] = useState<string | null>(null);


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
      setRawTranscripts(mapped);
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

  // ONE BRAIN (Blocker D): the meetings sidebar's "projects" ARE the entity registry — active bodies of
  // work from the portfolio; a meeting files into one via ITS ENTITY LINK (via='user' + locked — recognition
  // never overrides your filing). The label-era suggestions machinery died with the projects table.
  const loadProjects = useCallback(() => {
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => setProjects(((d.entities ?? []) as Array<{ id: string; name: string; status: string; weight: number; tracked?: boolean }>)
      .filter((e) => e.status === 'active')
      // Name-sorted (stable across refetches — no reorder flicker); the menu splits tracked/suggested.
      .sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ id: e.id, name: e.name, tracked: !!e.tracked })))).catch(() => {});
  }, []);
  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => onProjectsUpdated(() => { loadProjects(); fetchAll(); }), [loadProjects, fetchAll]);
  // ENTITY membership map — kept in SEPARATE state so a `fetchAll` reload (which resets projectId from the
  // dead legacy column) can't wipe it. The derived `transcripts` below reads projectId from this map, so
  // membership survives polling. Keyed by transcript id → the entity it's recognized into.
  const [mtgEntity, setMtgEntity] = useState<Record<string, string | null>>({});
  const transcriptIdsKey = rawTranscripts.map((t) => t.id).join(',');
  useEffect(() => {
    if (!transcriptIdsKey) return;
    let alive = true;
    fetch(`/api/items/entity?kind=meeting&ids=${transcriptIdsKey}`).then((r) => r.json()).then((d) => {
      if (!alive || !d?.links) return;
      const links = d.links as Record<string, { entityId: string }>;
      setMtgEntity((prev) => { const next = { ...prev }; for (const id of transcriptIdsKey.split(',')) next[id] = links[id]?.entityId ?? null; return next; });
    }).catch(() => {});
    return () => { alive = false; };
  }, [transcriptIdsKey]);
  // The transcripts the UI sees — projectId ALWAYS from the entity map (falls back to the raw value while
  // the map warms), so the sidebar filter + chips reflect real membership regardless of reloads.
  const transcripts = useMemo(() => rawTranscripts.map((t) => ({ ...t, projectId: mtgEntity[t.id] ?? t.projectId ?? null })), [rawTranscripts, mtgEntity]);
  // File a meeting into a body of work (or clear) — a locked user link (final; a detach is a remembered
  // "none"). The meeting's ACTION ITEMS move WITH it (server cascade), so it's never split from its work.
  const moveToProject = async (transcriptId: string, entityId: string | null) => {
    setMtgEntity((prev) => ({ ...prev, [transcriptId]: entityId }));
    try { await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'meeting', id: transcriptId, entityId }) }); broadcastProjectsUpdated({ reason: 'meeting-move' }); }
    catch { /* non-fatal; next fetchAll reconciles */ }
  };
  // A drag-to-project asks for CONFIRMATION first (it moves the meeting AND its action items). Resolve the
  // from/to names + the action-item count, then show the modal; only on confirm do we actually move.
  const [pendingMove, setPendingMove] = useState<null | { transcriptId: string; title: string; fromName: string | null; toId: string; toName: string; count: number }>(null);
  const [movePending, setMovePending] = useState(false);
  const requestMove = async (transcriptId: string, toId: string | null) => {
    if (!toId) { moveToProject(transcriptId, null); return; } // detach doesn't need a confirm
    const t = transcripts.find((x) => x.id === transcriptId);
    if (t?.projectId === toId) return; // already there — no-op
    const fromName = t?.projectId ? (projects.find((p) => p.id === t.projectId)?.name ?? null) : null;
    const toName = projects.find((p) => p.id === toId)?.name ?? 'this project';
    let count = 0;
    try { const d = await fetch(`/api/items/entity?kind=meeting&id=${transcriptId}`).then((r) => r.json()); count = d?.commitmentCount ?? 0; } catch { /* count optional */ }
    setPendingMove({ transcriptId, title: t?.title || 'this meeting', fromName, toId, toName, count });
  };
  const confirmMove = async () => {
    if (!pendingMove) return;
    setMovePending(true);
    await moveToProject(pendingMove.transcriptId, pendingMove.toId);
    setMovePending(false); setPendingMove(null);
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
  // Create a body of work inline — FOUNDS a tracked entity (a user declaring work = a registry row).
  const handleCreateProject = async (name: string): Promise<string | null> => {
    const res = await fetch('/api/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.id) setProjects((prev) => [...prev, { id: data.id, name, tracked: true }]);
      loadProjects();
      broadcastProjectsUpdated({ reason: 'create' });
      return (data?.id as string) ?? null;
    }
    return null;
  };

  // Label-era suggestions died with the projects table (entities appear in the sidebar automatically).
  const handleTrackSuggestion = async (_s: MeetingSuggestion) => { setSelectedSuggestionKey(null); };

  const handleRenameTranscript = async (id: string, title: string) => {
    setRawTranscripts((prev) => prev.map((t) => t.id === id ? { ...t, title } : t));
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
    setRawTranscripts((prev) => prev.filter((t) => t.id !== transcriptId));
    try {
      await fetch(`/api/meetings/recording/${transcriptId}`, { method: 'DELETE' });
    } catch {
      fetchAll();
    }
  };

  const handleRetryFailed = async (transcriptId: string) => {
    setRawTranscripts((prev) =>
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
  const selectedProject = selectedProjectId ? projects.find((p) => p.id === selectedProjectId) ?? null : null;
  const selectedSuggestion = selectedSuggestionKey ? suggestions.find((s) => s.key === selectedSuggestionKey) ?? null : null;
  const isOnProject = !!selectedProject || !!selectedSuggestion;

  // Selected meeting id from URL for left panel highlighting
  const urlMeetingId = (() => {
    const m = pathname.match(/^\/meetings\/(.+)$/);
    return m ? m[1] : null;
  })();

  // ── Context value ─────────────────────────────────────────────────────────
  const contextValue = {
    transcripts,
    upcoming,
    projects,
    createProject: handleCreateProject,
    moveToProject,
    loading,
    userEmail,
    isNew,
    fetchAll,
    handleDeleteTranscript,
    handleRetryFailed,
    handleRenameTranscript,
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
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={(id) => {
            setSelectedProjectId(id);
            setSelectedSuggestionKey(null);
            setFilterPersonEmail(null);
            if (id) router.push('/meetings');
          }}
          onCreateProject={handleCreateProject}
          onMoveToProject={requestMove}
          suggestions={suggestions.map((s) => ({ key: s.key, name: s.name, meetingCount: s.meetingIds.length }))}
          selectedSuggestionKey={selectedSuggestionKey}
          onSelectSuggestion={(key) => {
            setSelectedSuggestionKey(key);
            setSelectedProjectId(null);
            setFilterPersonEmail(null);
            if (key) router.push('/meetings');
          }}
          onTrackSuggestion={(key) => {
            const s = suggestions.find((x) => x.key === key);
            if (s) handleTrackSuggestion(s);
          }}
          trackingKey={trackingKey}
          selectedMeetingId={urlMeetingId}
          onSelectMeeting={(id) => {
            setSelectedProjectId(null);
            setSelectedSuggestionKey(null);
            setActiveMeetingContext(null);
            setChatAutoMessage(undefined);
            if (id) router.push(`/meetings/${id}`);
            else router.push('/meetings');
          }}
          filterPersonEmail={filterPersonEmail}
          onFilterPerson={(email) => {
            setFilterPersonEmail(email);
            setSelectedProjectId(null);
            setSelectedSuggestionKey(null);
            router.push('/meetings');
          }}
          onNewNote={() => {
            setSelectedProjectId(null);
            setSelectedSuggestionKey(null);
            router.push('/meetings/new');
          }}
          onNavigateHome={() => {
            setSelectedProjectId(null);
            setSelectedSuggestionKey(null);
            setFilterPersonEmail(null);
            setActiveMeetingContext(null);
            if (rightPanel === 'chat') setRightPanel(null);
            router.push('/meetings');
          }}
          isHome={isHome && !isOnProject}
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
                  {selectedProject && !urlMeetingId ? selectedProject.name : selectedSuggestion && !urlMeetingId ? selectedSuggestion.name : 'Meetings'}
                </h2>
              </div>
              <button
                onClick={() => router.push('/meetings/new')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[12px] font-medium transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                New meeting
              </button>
            </div>

            {/* Body — a selected project OR suggested initiative's meetings own the BARE /meetings path
                only. A routed child (/meetings/<id>, /meetings/new) always wins: the project rows are
                plain links, so the URL — not shell state — must decide what renders (the same-path
                state-vs-URL divergence class; the note view was unreachable from a project folder). */}
            <div className="flex-1 overflow-y-auto">
              {selectedProject && !urlMeetingId ? (
                <ProjectMeetingsView
                  project={selectedProject}
                  transcripts={transcripts}
                  isNew={isNew}
                />
              ) : selectedSuggestion && !urlMeetingId ? (
                <ProjectMeetingsView
                  suggestion={{
                    key: selectedSuggestion.key,
                    name: selectedSuggestion.name,
                    meetingIds: selectedSuggestion.meetingIds,
                    onTrack: () => handleTrackSuggestion(selectedSuggestion),
                    tracking: trackingKey === selectedSuggestion.key,
                  }}
                  transcripts={transcripts}
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
      {pendingMove && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => !movePending && setPendingMove(null)}>
          <div className="absolute inset-0 bg-neutral-900/25 backdrop-blur-[2px]" />
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-xl p-5">
            <h3 className="text-[15px] font-semibold text-neutral-900">Move this meeting?</h3>
            <p className="text-[13px] text-neutral-600 leading-relaxed mt-2">
              <span className="font-medium text-neutral-800">{pendingMove.title}</span>{pendingMove.fromName ? <> will move from <span className="font-medium">{pendingMove.fromName}</span></> : <> will be added</>} to <span className="font-medium text-indigo-700">{pendingMove.toName}</span>.
            </p>
            {pendingMove.count > 0 && (
              <p className="text-[12.5px] text-neutral-500 mt-1.5">Its {pendingMove.count} action item{pendingMove.count === 1 ? '' : 's'} will move with it, so nothing is left behind.</p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setPendingMove(null)} disabled={movePending} className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-neutral-500 hover:text-neutral-800 transition-colors">Cancel</button>
              <button onClick={confirmMove} disabled={movePending} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors">{movePending ? 'Moving…' : 'Move meeting'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </MeetingsDataContext.Provider>
  );
}
