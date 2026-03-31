'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MicrophoneIcon, FolderIcon, PlusIcon, ChatBubbleLeftRightIcon, ChevronLeftIcon } from '@heroicons/react/24/outline';
import type { DriveFolder } from '@/lib/types/drive';
import type { CalendarEvent } from '@/lib/types/meetings';
import TranscriptListCard from '@/components/meetings/transcript-list-card';
import ActiveBotCard from '@/components/meetings/active-bot-card';
import CaptureModal from '@/components/meetings/capture-modal';
import NewMeetingModal from '@/components/meetings/new-meeting-modal';
import CalendarSidebar from '@/components/meetings/calendar-sidebar';
import WeekCalendar from '@/components/meetings/week-calendar';
import MeetingFolderBrowser from '@/components/meetings/meeting-folder-browser';
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
  source: 'bot' | 'recording' | 'upload';
  summary?: string | null;
  processedAt?: string | null;
  folderId?: string | null;
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
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [botStateMap, setBotStateMap] = useState<Map<string, string>>(new Map());
  const [pendingAdhoc, setPendingAdhoc] = useState<{ initiatedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCapture, setShowCapture] = useState(false);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(loadSeenIds);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'recent' | 'folders'>('recent');
  const [calendarView, setCalendarView] = useState<'month' | 'week'>('month');
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [folderPopoverFor, setFolderPopoverFor] = useState<string | null>(null);
  const [newFolderForRecent, setNewFolderForRecent] = useState<string | null>(null);
  const [newFolderForRecentName, setNewFolderForRecentName] = useState('');

  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [meetingsData, transcriptsData] = await Promise.all([
        fetch('/api/meetings').then((r) => r.json()),
        fetch('/api/meetings/transcripts').then((r) => r.json()),
      ]);

      const events: CalendarEvent[] = meetingsData.meetings ?? [];
      setUpcoming(events.filter((m) => m.meeting_status !== 'completed'));

      const newMap = new Map<string, string>();
      for (const e of events) {
        if (e.attendee_bot_state) newMap.set(e.id, e.attendee_bot_state);
      }
      setBotStateMap(newMap);

      const mapped = mapTranscripts(transcriptsData.transcripts ?? []);
      setTranscripts(mapped);

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

  useEffect(() => {
    fetch('/api/drive/folders')
      .then((r) => r.json())
      .then((data) => setFolders(Array.isArray(data) ? data : (data.folders ?? [])));
  }, []);

  // Adaptive polling
  useEffect(() => {
    const liveStates = new Set(['joining', 'recording', 'scheduled']);
    const hasLiveBot = upcoming.some((e) => {
      const state = botStateMap.get(e.id) ?? e.attendee_bot_state ?? '';
      return liveStates.has(state);
    });
    const hasProcessing = transcripts.some((t) => !t.processed);
    const isActive = hasLiveBot || hasProcessing || pendingAdhoc !== null;
    isActiveRef.current = isActive;

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchAll, isActive ? 5_000 : 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [upcoming, transcripts, botStateMap, pendingAdhoc, fetchAll]);

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

  const handleCancel = async (eventId: string) => {
    setCancellingId(eventId);
    try {
      const res = await fetch(`/api/meetings/${eventId}/cancel-bot`, { method: 'DELETE' });
      if (res.ok) setBotStateMap((prev) => new Map(prev).set(eventId, 'cancelled'));
    } finally {
      setCancellingId(null);
    }
  };

  const handleMoveTranscriptToFolder = (transcriptId: string, folderId: string | null) => {
    setTranscripts((prev) =>
      prev.map((t) => (t.id === transcriptId ? { ...t, folderId } : t))
    );
  };

  const handleMoveRecentToFolder = async (transcriptId: string, folderId: string | null) => {
    await fetch(`/api/meetings/recording/${transcriptId}/folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    });
    handleMoveTranscriptToFolder(transcriptId, folderId);
    setFolderPopoverFor(null);
  };

  const handleCreateFolderAndMoveRecent = async (transcriptId: string, name: string) => {
    if (!name.trim()) return;
    const fRes = await fetch('/api/drive/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!fRes.ok) return;
    const folder: DriveFolder = await fRes.json();
    setFolders((prev) => [...prev, folder]);
    await handleMoveRecentToFolder(transcriptId, folder.id);
    setNewFolderForRecent(null);
    setNewFolderForRecentName('');
  };

  // Derived
  const liveBots: Array<{ title: string; state: 'joining' | 'recording'; calendarEventId: string | null; startedAt?: string }> = [];
  for (const e of upcoming) {
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

  const processingList = transcripts.filter(
    (t) => !t.processed && !(t.source === 'bot' && t.calendarEventId === null && (t.botState === 'joining' || t.botState === 'recording'))
  );
  const failedList = transcripts.filter((t) => t.processed && t.botState === 'failed');
  const recentList = transcripts.filter((t) => t.processed && t.botState !== 'failed' && (t.folderId ?? null) === null).slice(0, 20);

  const cutoff = Date.now() - TWENTY_FOUR_HOURS;
  const isNew = (t: Transcript) =>
    !seenIds.has(t.id) && t.processed && t.processedAt != null &&
    new Date(t.processedAt).getTime() > cutoff;

  const hasActivity = processingList.length > 0 || failedList.length > 0;

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* ── Main content ── */}
      <div className="flex-1 relative overflow-y-auto">
        {/* Week view overlay — backdrop dismisses on click */}
        {calendarView === 'week' && (
          <div className="absolute inset-0 z-10" onClick={() => setCalendarView('month')} />
        )}
        {calendarView === 'week' && (
          <div className="absolute right-0 top-0 bottom-0 z-20 w-[680px] bg-white border-l border-neutral-100 shadow-xl flex flex-col">
            <div className="flex-shrink-0 h-10 flex items-center justify-between px-3 border-b border-neutral-200">
              <button
                onClick={() => setCalendarView('month')}
                className="flex items-center gap-1.5 text-[13px] text-neutral-500 hover:text-neutral-800 transition-colors"
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                <span className="font-medium">Back</span>
              </button>
              <span className="text-[13px] font-semibold text-neutral-700">Calendar</span>
              <div className="w-6" />
            </div>
            <div className="flex-1 min-h-0">
              <WeekCalendar
                meetings={upcoming}
                userEmail={userEmail}
                botStateMap={botStateMap}
                onScheduled={handleScheduled}
                onCancelled={handleCancelled}
                onRefresh={fetchAll}
                onNewMeeting={(date) => { setShowNewMeeting(true); }}
              />
            </div>
          </div>
        )}
        <div className="max-w-2xl mx-auto px-6 py-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">Meetings</h1>
              <p className="text-[13px] text-neutral-500 mt-0.5">Capture, search, and turn conversations into actions</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCapture(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                <MicrophoneIcon className="w-4 h-4" />
                Capture
              </button>
            </div>
          </div>

          {/* Live bot banner */}
          {liveBots.length > 0 && (
            <div className="mb-5 space-y-1.5">
              {liveBots.map((bot, i) => (
                <ActiveBotCard
                  key={bot.calendarEventId ?? `adhoc-${i}`}
                  title={bot.title}
                  state={bot.state}
                  calendarEventId={bot.calendarEventId}
                  startedAt={bot.startedAt}
                />
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center gap-0 border-b border-neutral-200 mb-5">
            <button
              onClick={() => setActiveTab('recent')}
              className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'recent'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Recent
              {hasActivity && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700">
                  {processingList.length + failedList.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('folders')}
              className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'folders'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Folders
            </button>
          </div>

          {/* ── Recent tab ── */}
          {activeTab === 'recent' && (
            <div>
              {/* Transcribing */}
              {processingList.length > 0 && (
                <section className="mb-6">
                  <h2 className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                    Transcribing ({processingList.length})
                  </h2>
                  <div className="space-y-1.5">
                    {processingList.map((t) => <TranscriptListCard key={t.id} {...t} />)}
                  </div>
                </section>
              )}

              {/* Failed */}
              {failedList.length > 0 && (
                <section className="mb-6">
                  <h2 className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-3">
                    Transcription failed ({failedList.length})
                  </h2>
                  <div className="space-y-1.5">
                    {failedList.map((t) => <TranscriptListCard key={t.id} {...t} />)}
                  </div>
                </section>
              )}

              {/* Recent meetings */}
              <section>
                <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">
                  Recent meetings
                </h2>
                {loading && (
                  <div className="space-y-1.5">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-neutral-100 animate-pulse" />)}
                  </div>
                )}
                {!loading && recentList.length === 0 && (
                  <div className="py-8 text-center border border-dashed border-neutral-200">
                    <MicrophoneIcon className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                    <p className="text-[13px] text-neutral-500 font-medium">No recordings yet</p>
                    <p className="text-[12px] text-neutral-400 mt-1">
                      Use the Capture button to record or send an assistant to your next meeting.
                    </p>
                    <button
                      onClick={() => setShowCapture(true)}
                      className="inline-block mt-3 px-4 py-1.5 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors"
                    >
                      Capture meeting
                    </button>
                  </div>
                )}
                {!loading && recentList.length > 0 && (
                  <div className="space-y-1.5">
                    {recentList.map((t) => (
                      <div key={t.id} className="group relative">
                        <TranscriptListCard {...t} isNew={isNew(t)} />
                        {folderPopoverFor === t.id && (
                          <div className="fixed inset-0 z-20" onClick={() => setFolderPopoverFor(null)} />
                        )}
                        <div className={`absolute right-2 top-1/2 -translate-y-1/2 items-center z-30 ${folderPopoverFor === t.id ? 'flex' : 'hidden group-hover:flex'}`}>
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setFolderPopoverFor(folderPopoverFor === t.id ? null : t.id); }}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-700 bg-white border border-neutral-100 hover:border-neutral-200 shadow-sm transition-colors"
                              title="Move to folder"
                            >
                              <FolderIcon className="w-3 h-3" />
                            </button>
                            {folderPopoverFor === t.id && (
                              <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-neutral-200 shadow-md min-w-[160px] py-1">
                                {folders.filter((f) => !f.is_system).map((folder) => (
                                  <button
                                    key={folder.id}
                                    onClick={() => handleMoveRecentToFolder(t.id, folder.id)}
                                    className="w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-1.5 hover:bg-neutral-50 transition-colors text-neutral-600"
                                  >
                                    <FolderIcon className="w-3 h-3 flex-shrink-0" />
                                    <span className="truncate">{folder.name}</span>
                                  </button>
                                ))}
                                <div className={folders.filter((f) => !f.is_system).length > 0 ? 'border-t border-neutral-100 mt-1 pt-1' : ''}>
                                  {newFolderForRecent === t.id ? (
                                    <div className="px-2 py-1.5 flex items-center gap-1">
                                      <input
                                        autoFocus
                                        value={newFolderForRecentName}
                                        onChange={(e) => setNewFolderForRecentName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleCreateFolderAndMoveRecent(t.id, newFolderForRecentName);
                                          if (e.key === 'Escape') { setNewFolderForRecent(null); setNewFolderForRecentName(''); }
                                        }}
                                        placeholder="Folder name"
                                        className="flex-1 min-w-0 border border-neutral-200 px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-indigo-400"
                                      />
                                      <button
                                        onClick={() => handleCreateFolderAndMoveRecent(t.id, newFolderForRecentName)}
                                        className="px-1.5 py-0.5 bg-indigo-600 text-white text-[11px]"
                                      >
                                        Go
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setNewFolderForRecent(t.id); setNewFolderForRecentName(''); }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] text-indigo-600 hover:bg-indigo-50 flex items-center gap-1.5 transition-colors"
                                    >
                                      <PlusIcon className="w-3 h-3" />
                                      New folder…
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ── Folders tab ── */}
          {activeTab === 'folders' && !loading && (
            <MeetingFolderBrowser
              transcripts={transcripts.filter((t) => t.processed && t.botState !== 'failed')}
              folders={folders}
              onFoldersChange={setFolders}
              onTranscriptMoved={handleMoveTranscriptToFolder}
              isNew={isNew}
            />
          )}
        </div>
      </div>

      {/* ── Right column — fixed width, hosts toggle ── */}
      <div className="flex-shrink-0 w-[280px] border-l border-neutral-100 bg-white flex flex-col">
        {/* Sidebar header: toggle + title */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-neutral-100">
          <span className="text-[13px] font-semibold text-neutral-700">Calendar</span>
          <div className="flex items-center gap-1.5">
          <button
            onClick={() => setChatOpen((v) => !v)}
            title="Ask AI"
            className={`p-1 transition-colors ${chatOpen ? 'text-indigo-600' : 'text-neutral-400 hover:text-neutral-600'}`}
          >
            <ChatBubbleLeftRightIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowNewMeeting(true)}
            title="New meeting"
            className="p-1 text-indigo-400 hover:text-indigo-600 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center bg-neutral-100 rounded-full p-0.5">
            <button
              onClick={() => setCalendarView('month')}
              title="Month view"
              className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full transition-colors ${calendarView === 'month' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
              Month
            </button>
            <button
              onClick={() => setCalendarView('week')}
              title="Week view"
              className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full transition-colors ${calendarView === 'week' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
              Week
            </button>
          </div>
          </div>
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-3 bg-neutral-100 rounded w-1/2" />
              <div className="h-40 bg-neutral-100 rounded" />
            </div>
          ) : (
            <CalendarSidebar
              meetings={upcoming}
              userEmail={userEmail}
              botStateMap={botStateMap}
              onScheduled={handleScheduled}
              onCancelled={handleCancelled}
              onRefresh={fetchAll}
              onNewMeeting={() => setShowNewMeeting(true)}
            />
          )}
        </div>
      </div>

      <ChatSidebar
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        context="meeting"
      />

      <CaptureModal
        isOpen={showCapture}
        onClose={() => setShowCapture(false)}
        onBotSent={() => setPendingAdhoc({ initiatedAt: new Date().toISOString() })}
      />
      <NewMeetingModal
        isOpen={showNewMeeting}
        onClose={() => setShowNewMeeting(false)}
        onSuccess={fetchAll}
      />
    </div>
  );
}
