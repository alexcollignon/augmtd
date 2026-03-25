'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MicrophoneIcon, CalendarDaysIcon, UserCircleIcon, ChevronRightIcon, FolderIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import UpcomingMeetingCard from '@/components/meetings/upcoming-meeting-card';
import TranscriptListCard from '@/components/meetings/transcript-list-card';
import ActiveBotCard from '@/components/meetings/active-bot-card';
import CaptureModal from '@/components/meetings/capture-modal';
import MonthCalendar from '@/components/meetings/month-calendar';
import MeetingFoldersSidebar from '@/components/meetings/meeting-folders-sidebar';
import type { DriveFolder } from '@/lib/types/drive';

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

interface ScheduledEvent {
  id: string;
  title: string;
  startTime: string;
  attendeeBotId: string | null;
  attendeeBotState: string;
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
  // Map from calendarEventId → attendee_bot_state (source of truth for card display)
  const [botStateMap, setBotStateMap] = useState<Map<string, string>>(new Map());
  // Pending ad-hoc: set when user sends an ad-hoc bot, cleared when transcript row appears
  const [pendingAdhoc, setPendingAdhoc] = useState<{ initiatedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCapture, setShowCapture] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState(() => new Date().toDateString());
  const [seenIds, setSeenIds] = useState<Set<string>>(loadSeenIds);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  // Folder popover state for recent meeting cards
  const [folderPopoverTranscriptId, setFolderPopoverTranscriptId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);

  // Track isActive in a ref so the polling interval always reads the latest value
  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const meetingsUrl = selectedFolderId
        ? `/api/meetings?folderId=${encodeURIComponent(selectedFolderId)}`
        : '/api/meetings';
      const [meetingsData, transcriptsData] = await Promise.all([
        fetch(meetingsUrl).then((r) => r.json()),
        fetch('/api/meetings/transcripts').then((r) => r.json()),
      ]);

      const events: CalendarEvent[] = meetingsData.meetings ?? [];
      setUpcoming(events.filter((m) => m.meeting_status !== 'completed'));

      // Rebuild botStateMap from fresh calendar data
      const newMap = new Map<string, string>();
      for (const e of events) {
        if (e.attendee_bot_state) newMap.set(e.id, e.attendee_bot_state);
      }
      setBotStateMap(newMap);

      const mapped = mapTranscripts(transcriptsData.transcripts ?? []);
      setTranscripts(mapped);

      // Clear pendingAdhoc once a matching unprocessed ad-hoc transcript appears
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
  }, [selectedFolderId]);

  // Fetch folders list for move-to-folder popover
  useEffect(() => {
    fetch('/api/drive/folders')
      .then((r) => r.json())
      .then((data) => setFolders(Array.isArray(data) ? data : (data.folders ?? [])));
  }, []);

  // Initial load + refetch when folder filter changes (fetchAll depends on selectedFolderId)
  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]); // fetchAll changes when selectedFolderId changes

  // Adaptive polling: 5s when active, 30s otherwise
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

  const handleScheduled = (eventId: string) => {
    setBotStateMap((prev) => new Map(prev).set(eventId, 'scheduled'));
  };

  const handleCancelled = (eventId: string) => {
    setBotStateMap((prev) => new Map(prev).set(eventId, 'cancelled'));
  };

  const handleMoveTranscriptToFolder = async (transcriptId: string, folderId: string | null) => {
    setMovingFolderId(transcriptId);
    try {
      await fetch(`/api/meetings/recording/${transcriptId}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      setTranscripts((prev) =>
        prev.map((t) => (t.id === transcriptId ? { ...t, folderId } : t))
      );
    } finally {
      setMovingFolderId(null);
      setFolderPopoverTranscriptId(null);
    }
  };

  const handleCancel = async (eventId: string) => {
    setCancellingId(eventId);
    let success = false;
    try {
      const res = await fetch(`/api/meetings/${eventId}/cancel-bot`, { method: 'DELETE' });
      success = res.ok;
    } finally {
      setCancellingId(null);
    }
    if (success) {
      setBotStateMap((prev) => new Map(prev).set(eventId, 'cancelled'));
    }
  };

  // Derived sections
  const liveBots: Array<{ title: string; state: 'joining' | 'recording'; calendarEventId: string | null; startedAt?: string }> = [];

  // Live from calendar events
  for (const e of upcoming) {
    const state = botStateMap.get(e.id) ?? (e.attendee_bot_state ?? '');
    if (state === 'joining' || state === 'recording') {
      liveBots.push({
        title: e.title,
        state,
        calendarEventId: e.id,
        startedAt: e.start_time,
      });
    }
  }

  // Ad-hoc pending (before transcript row exists)
  if (pendingAdhoc) {
    liveBots.push({
      title: 'Ad-hoc meeting',
      state: 'joining',
      calendarEventId: null,
      startedAt: pendingAdhoc.initiatedAt,
    });
  }

  // Live from ad-hoc transcript rows in joining/recording phase
  const adhocLive = transcripts.filter(
    (t) =>
      t.source === 'bot' &&
      t.calendarEventId === null &&
      !t.processed &&
      (t.botState === 'joining' || t.botState === 'recording')
  );
  for (const t of adhocLive) {
    liveBots.push({
      title: t.title || 'Ad-hoc meeting',
      state: t.botState === 'recording' ? 'recording' : 'joining',
      calendarEventId: null,
      startedAt: t.startTime,
    });
  }

  const scheduledEvents: ScheduledEvent[] = upcoming
    .filter((e) => (botStateMap.get(e.id) ?? e.attendee_bot_state) === 'scheduled')
    .map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.start_time,
      attendeeBotId: e.attendee_bot_id ?? null,
      attendeeBotState: 'scheduled',
    }));

  // Transcribing: unprocessed, excluding ad-hoc that are still live (joining/recording)
  const processingList = transcripts.filter(
    (t) =>
      !t.processed &&
      !(
        t.source === 'bot' &&
        t.calendarEventId === null &&
        (t.botState === 'joining' || t.botState === 'recording')
      )
  );
  const failedList = transcripts.filter((t) => t.processed && t.botState === 'failed');
  const recentList = transcripts.filter((t) => t.processed && t.botState !== 'failed').slice(0, 20);

  const cutoff = Date.now() - TWENTY_FOUR_HOURS;
  const isNew = (t: Transcript) =>
    !seenIds.has(t.id) &&
    t.processed &&
    t.processedAt != null &&
    new Date(t.processedAt).getTime() > cutoff;

  const hasAssistantActivity = liveBots.length > 0 || scheduledEvents.length > 0;

  return (
    <div className="flex h-full">
      {/* Folder sidebar */}
      <MeetingFoldersSidebar
        selectedFolderId={selectedFolderId}
        onSelect={setSelectedFolderId}
      />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">Meetings</h1>
              <p className="text-[13px] text-neutral-500 mt-0.5">Capture, search, and turn conversations into actions</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border transition-colors ${
                  sidebarOpen
                    ? 'text-violet-700 bg-violet-50 border-violet-200'
                    : 'text-neutral-500 bg-white border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <UserCircleIcon className="w-3.5 h-3.5" />
                Assistant
              </button>
              <button
                onClick={() => setShowCapture(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                <MicrophoneIcon className="w-4 h-4" />
                Capture
              </button>
            </div>
          </div>

          {/* Upcoming meetings */}
          <section className="mb-8">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">
              Upcoming meetings
            </h2>
            {loading ? (
              <div className="grid grid-cols-[260px_1fr] gap-6">
                <div className="space-y-1">{[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-neutral-100 animate-pulse rounded" />)}</div>
                <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-20 bg-neutral-100 animate-pulse" />)}</div>
              </div>
            ) : (
              <div className="grid grid-cols-[260px_1fr] gap-6 items-start">
                <div className="bg-white border border-neutral-100 px-4 py-4">
                  <MonthCalendar
                    meetings={upcoming}
                    userEmail={userEmail}
                    selectedDateStr={selectedDateStr}
                    onSelectDate={setSelectedDateStr}
                  />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-neutral-600 mb-3">
                    {new Date(selectedDateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </p>
                  {(() => {
                    const dayMeetings = upcoming.filter(
                      (e) => new Date(e.start_time).toDateString() === selectedDateStr
                    );
                    if (dayMeetings.length === 0) {
                      return <p className="text-[13px] text-neutral-400 italic py-4">No upcoming meetings this day.</p>;
                    }
                    return (
                      <div className="space-y-2">
                        {dayMeetings.map((event) => (
                          <UpcomingMeetingCard
                            key={event.id}
                            event={event}
                            botState={botStateMap.get(event.id) ?? event.attendee_bot_state ?? null}
                            onScheduled={handleScheduled}
                            onCancelled={handleCancelled}
                          />
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </section>

          {/* Transcribing */}
          {processingList.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                Transcribing ({processingList.length})
              </h2>
              <div className="space-y-1.5">
                {processingList.map((t) => (
                  <TranscriptListCard key={t.id} {...t} />
                ))}
              </div>
            </section>
          )}

          {/* Failed */}
          {failedList.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-3">
                Transcription failed ({failedList.length})
              </h2>
              <div className="space-y-1.5">
                {failedList.map((t) => (
                  <TranscriptListCard key={t.id} {...t} />
                ))}
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
                    {/* Move to folder button */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderPopoverTranscriptId((prev) => (prev === t.id ? null : t.id));
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-700 bg-white border border-neutral-100 hover:border-neutral-200 shadow-sm transition-colors"
                        title="Move to folder"
                      >
                        <FolderIcon className="w-3 h-3" />
                      </button>
                      {/* Folder popover */}
                      {folderPopoverTranscriptId === t.id && (
                        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-neutral-200 shadow-md min-w-[140px] py-1">
                          <button
                            onClick={() => handleMoveTranscriptToFolder(t.id, null)}
                            disabled={movingFolderId === t.id}
                            className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-neutral-50 transition-colors ${
                              t.folderId === null ? 'text-neutral-900 font-medium' : 'text-neutral-600'
                            }`}
                          >
                            No folder
                          </button>
                          {folders.map((folder) => (
                            <button
                              key={folder.id}
                              onClick={() => handleMoveTranscriptToFolder(t.id, folder.id)}
                              disabled={movingFolderId === t.id}
                              className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-1.5 hover:bg-neutral-50 transition-colors ${
                                t.folderId === folder.id ? 'text-neutral-900 font-medium' : 'text-neutral-600'
                              }`}
                            >
                              <FolderIcon className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{folder.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Assistant sidebar */}
      {sidebarOpen && (
        <div className="w-72 flex-shrink-0 border-l border-neutral-100 bg-neutral-50 overflow-y-auto">
          <div className="px-4 py-4 border-b border-neutral-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCircleIcon className="w-4 h-4 text-violet-500" />
              <span className="text-[13px] font-semibold text-neutral-800">Meeting assistant</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-4 space-y-6">
            {/* Live now */}
            {liveBots.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                  Live now
                </p>
                <div className="space-y-1.5">
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
              </div>
            )}

            {/* Scheduled */}
            <div>
              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                Scheduled
              </p>
              {scheduledEvents.length === 0 ? (
                <p className="text-[12px] text-neutral-400 italic">No assistants scheduled.</p>
              ) : (
                <div className="space-y-1">
                  {scheduledEvents.map((e) => (
                    <div key={e.id} className="bg-white border border-neutral-100 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-neutral-800 truncate">{e.title}</p>
                          <p className="text-[11px] text-neutral-400 mt-0.5">
                            {new Date(e.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            {' · '}
                            {new Date(e.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                        {cancellingId === e.id ? (
                          <span className="text-[10px] font-medium text-neutral-400 animate-pulse flex-shrink-0 mt-0.5">Removing…</span>
                        ) : (
                          <button
                            onClick={() => handleCancel(e.id)}
                            className="text-[10px] text-neutral-400 hover:text-red-500 transition-colors flex-shrink-0 mt-0.5"
                          >
                            × Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Empty state */}
            {liveBots.length === 0 && scheduledEvents.length === 0 && (
              <div className="text-center py-6">
                <UserCircleIcon className="w-7 h-7 text-neutral-200 mx-auto mb-2" />
                <p className="text-[12px] text-neutral-400">No active assistants.</p>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Assistants will appear here when scheduled or live.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <CaptureModal
        isOpen={showCapture}
        onClose={() => setShowCapture(false)}
        onBotSent={() => setPendingAdhoc({ initiatedAt: new Date().toISOString() })}
      />
    </div>
  );
}
