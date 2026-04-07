'use client';

import { useMemo, useState, useEffect } from 'react';
import { getBotSession, type BotSessionStatus } from '@/lib/meetings/bot-session';
import {
  MicrophoneIcon,
  DocumentTextIcon,
  ComputerDesktopIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';

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

interface MeetingsHomeProps {
  upcoming: CalendarEvent[];
  transcripts: Transcript[];
  filterPersonEmail: string | null;
  onSelectMeeting: (id: string) => void;
  onDeleteTranscript: (transcriptId: string) => void;
  onRetryFailed: (transcriptId: string) => void;
  isNew: (t: Transcript) => boolean;
}

function attendeeLabel(attendees: Array<{ email: string; name?: string }>): string {
  const fn = (a: { email: string; name?: string }) =>
    a.name?.trim().split(/\s+/)[0] ?? a.email.split('@')[0];
  if (!attendees.length) return '';
  if (attendees.length === 1) return fn(attendees[0]);
  if (attendees.length === 2) return `${fn(attendees[0])} & ${fn(attendees[1])}`;
  return `${fn(attendees[0])}, ${fn(attendees[1])} & ${attendees.length - 2} other${attendees.length - 2 > 1 ? 's' : ''}`;
}

const ATTENDEE_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
];

function attendeeColor(key: string): string {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return ATTENDEE_COLORS[hash % ATTENDEE_COLORS.length];
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

function AttendeeAvatars({ attendees }: { attendees: Array<{ email: string; name?: string }> }) {
  if (!attendees.length) return null;
  const shown = attendees.slice(0, 5);
  const extra = attendees.length - shown.length;
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="flex -space-x-1.5">
        {shown.map((a, i) => {
          const key = a.email ?? a.name ?? String(i);
          const color = attendeeColor(key);
          return (
            <div key={i} className="relative group/av">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-2 ring-white ${color}`}>
                {getInitials(a.name, a.email)}
              </div>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-neutral-900 text-white text-[10px] rounded-md whitespace-nowrap opacity-0 group-hover/av:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
                {a.name ? `${a.name}` : a.email.split('@')[0]}
                <span className="block text-neutral-400">{a.email}</span>
              </div>
            </div>
          );
        })}
        {extra > 0 && (
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-2 ring-white bg-neutral-100 text-neutral-500">
            +{extra}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'bot') return <ComputerDesktopIcon className="w-4 h-4 text-violet-400" />;
  if (source === 'recording') return <MicrophoneIcon className="w-4 h-4 text-red-400" />;
  return <DocumentTextIcon className="w-4 h-4 text-blue-400" />;
}

function progressStatus(t: Transcript): { label: string; pulse: boolean } {
  if (t.source === 'recording') return { label: 'Transcribing recording…', pulse: true };
  if (t.source === 'text') return { label: 'Processing notes…', pulse: true };
  if (t.botState === 'scheduled') return { label: 'Assistant scheduled', pulse: false };
  if (t.botState === 'joining') return { label: 'Bot joining meeting…', pulse: true };
  if (t.botState === 'recording') return { label: 'Bot recording…', pulse: true };
  if (t.botState === 'processing') return { label: 'Transcribing…', pulse: true };
  return { label: 'Processing…', pulse: true };
}

function BotStateBadge({ state }: { state?: string | null }) {
  if (state === 'scheduled') return <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Scheduled</span>;
  if (state === 'joining') return <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Joining…</span>;
  if (state === 'recording') return <span className="text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded animate-pulse">Recording</span>;
  return null;
}

export default function MeetingsHome({
  upcoming,
  transcripts,
  filterPersonEmail,
  onSelectMeeting,
  onDeleteTranscript,
  onRetryFailed,
  isNew,
}: MeetingsHomeProps) {
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Bot session statuses for draft text notes — read from localStorage
  const [botSessions, setBotSessions] = useState<Map<string, BotSessionStatus>>(new Map());
  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrowStr = new Date(now.getTime() + 86400000).toDateString();

  // Find the nearest day (from now) that has non-completed events
  const nearestDay = useMemo(() => {
    const future = upcoming
      .filter((m) => m.meeting_status !== 'completed' && new Date(m.start_time) > now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    if (future.length === 0) return null;
    const nearestDateStr = new Date(future[0].start_time).toDateString();
    const events = future.filter((m) => new Date(m.start_time).toDateString() === nearestDateStr);
    const label =
      nearestDateStr === todayStr ? 'Today'
      : nearestDateStr === tomorrowStr ? 'Tomorrow'
      : new Date(nearestDateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    return { label, events };
  }, [upcoming]); // eslint-disable-line

  // Read bot session statuses from localStorage for draft text notes in the Live section.
  // Re-reads whenever transcripts change (new note appears, status updates on return).
  useEffect(() => {
    const map = new Map<string, BotSessionStatus>();
    for (const t of transcripts) {
      if (t.source !== 'text' || t.hasDocument || t.summary) continue;
      const session = getBotSession(t.id);
      if (session && session.status !== 'done' && session.status !== 'failed') {
        map.set(t.id, session.status);
      }
    }
    setBotSessions(map);
  }, [transcripts]);

  // Live: bot currently in meeting OR draft text note (saved but AI not yet run)
  const live = useMemo(() => {
    const items = transcripts.filter((t) =>
      // Bot actively joining/recording — user can still take notes
      (t.source === 'bot' && !t.processed && (t.botState === 'recording' || t.botState === 'joining')) ||
      // Draft text note — processed flag is true but no AI document/summary yet
      (t.source === 'text' && t.processed && !t.hasDocument && !t.summary && t.botState !== 'failed')
    );
    return items.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [transcripts]);

  // In-progress transcripts — AI processing phase only (bot left / recording uploaded)
  // Excludes bot recording/joining (those are in Live) and draft text notes.
  // Deduplicate by calendarEventId: keep highest-priority source (recording > bot > upload > text).
  const inProgress = useMemo(() => {
    const all = transcripts
      .filter((t) =>
        !t.processed && t.botState !== 'failed' &&
        // Exclude bot recording/joining — those show in Live
        !(t.source === 'bot' && (t.botState === 'recording' || t.botState === 'joining'))
      )
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const sourcePriority: Record<string, number> = { recording: 3, bot: 2, upload: 1, text: 0 };
    const seen = new Map<string, Transcript>();
    for (const t of all) {
      const key = t.calendarEventId ?? t.id;
      const existing = seen.get(key);
      if (!existing || (sourcePriority[t.source] ?? 0) > (sourcePriority[existing.source] ?? 0)) {
        seen.set(key, t);
      }
    }
    return Array.from(seen.values()).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [transcripts]);

  // Recent notes grouped by date
  const recentByDate = useMemo(() => {
    // Deduplicate by calendarEventId (same race condition as inProgress can produce two processed rows)
    const sourcePriorityR: Record<string, number> = { recording: 3, bot: 2, upload: 1, text: 0 };
    const seenR = new Map<string, Transcript>();
    // Exclude draft text notes (no document, no summary, not failed) — they live in the Live section
    for (const t of transcripts.filter((t) =>
      t.processed &&
      !(t.source === 'text' && !t.hasDocument && !t.summary && t.botState !== 'failed')
    )) {
      const key = t.calendarEventId ?? t.id;
      const existing = seenR.get(key);
      if (!existing || (sourcePriorityR[t.source] ?? 0) > (sourcePriorityR[existing.source] ?? 0)) {
        seenR.set(key, t);
      }
    }
    let list = Array.from(seenR.values())
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    if (filterPersonEmail) {
      list = list.filter((t) => t.attendees?.some((a) => a.email === filterPersonEmail));
    }

    const yesterdayStr = new Date(now.getTime() - 86400000).toDateString();
    const groups = new Map<string, Transcript[]>();
    const order: string[] = [];
    for (const t of list) {
      const dateStr = new Date(t.startTime).toDateString();
      if (!groups.has(dateStr)) { groups.set(dateStr, []); order.push(dateStr); }
      groups.get(dateStr)!.push(t);
    }
    return order.map((dateStr) => {
      const label =
        dateStr === todayStr ? 'Today'
        : dateStr === yesterdayStr ? 'Yesterday'
        : new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return { label, items: groups.get(dateStr)! };
    });
  }, [transcripts, filterPersonEmail]); // eslint-disable-line

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">

      {/* ── Coming up ── */}
      {nearestDay && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Coming up</h2>
            <span className="text-[11px] text-neutral-400">{nearestDay.label}</span>
          </div>
          <div className="rounded-xl border border-neutral-100 overflow-visible">
            {nearestDay.events.map((event, i) => (
              <button
                key={event.id}
                onClick={() => onSelectMeeting(event.id)}
                className={`w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-neutral-50 transition-colors ${i > 0 ? 'border-t border-neutral-100' : ''} ${i === 0 ? 'rounded-t-xl' : ''} ${i === nearestDay.events.length - 1 ? 'rounded-b-xl' : ''}`}
              >
                {/* Time */}
                <div className="text-right flex-shrink-0 w-14">
                  <p className="text-[12px] font-medium text-neutral-700">
                    {new Date(event.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="text-[10px] text-neutral-400">
                    {new Date(event.end_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {/* Accent bar */}
                <div className="w-px h-8 bg-indigo-200 flex-shrink-0" />
                {/* Title + attendees */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-neutral-800 truncate">{event.title}</p>
                  {(event.attendees?.length ?? 0) > 0 && (
                    <AttendeeAvatars attendees={event.attendees ?? []} />
                  )}
                </div>
                {/* Badge + CTA */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <BotStateBadge state={event.attendee_bot_state} />
                  <span className="text-[11px] font-medium text-indigo-600">Prepare →</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Live — bot recording or open draft note ── */}
      {live.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">Live</h2>
          <div className="space-y-0.5">
            {live.map((t) => {
              const isBot = t.source === 'bot';
              const isDraft = t.source === 'text';
              return (
                <div key={t.id} className="group/lv relative flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 transition-colors">
                  <button
                    onClick={() => onSelectMeeting(t.calendarEventId ?? t.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <SourceIcon source={t.source} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-neutral-800 truncate">{t.title || 'Untitled meeting'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {isBot && (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
                            <span className="text-[11px] text-neutral-400">
                              {t.botState === 'joining' ? 'Bot joining…' : 'Bot recording'}
                            </span>
                          </>
                        )}
                        {isDraft && (() => {
                          const botStatus = botSessions.get(t.id);
                          if (botStatus === 'sent') return (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                              <span className="text-[11px] text-amber-600">Joining soon</span>
                            </>
                          );
                          if (botStatus === 'in_meeting') return (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                              <span className="text-[11px] text-emerald-600">In meeting</span>
                            </>
                          );
                          if (botStatus === 'processing') return (
                            <>
                              <span className="w-2.5 h-2.5 rounded-full border-2 border-neutral-300 border-t-neutral-500 animate-spin flex-shrink-0" />
                              <span className="text-[11px] text-neutral-500">Transcribing</span>
                            </>
                          );
                          return (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                              <span className="text-[11px] text-neutral-400">Open note</span>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <span className="text-[11px] text-neutral-400 flex-shrink-0 mr-1">
                      {new Date(t.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                  {confirmDeleteId === t.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[11px] text-neutral-500 mr-0.5">Remove?</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteTranscript(t.id); setConfirmDeleteId(null); }}
                        className="p-1 rounded hover:bg-red-100 text-red-500"
                        title="Confirm remove"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                        className="p-1 rounded hover:bg-neutral-200 text-neutral-400"
                        title="Cancel"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
                      title="Remove"
                      className="opacity-0 group-hover/lv:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600 flex-shrink-0"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── In progress ── */}
      {inProgress.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">In progress</h2>
          <div className="space-y-0.5">
            {inProgress.map((t) => {
              const { label, pulse } = progressStatus(t);
              return (
                <div key={t.id} className="group/ip relative flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 transition-colors">
                  <button
                    onClick={() => onSelectMeeting(t.calendarEventId ?? t.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <SourceIcon source={t.source} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-neutral-800 truncate">{t.title || 'Untitled'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pulse ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                        <span className="text-[11px] text-neutral-400">{label}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <p className="text-[11px] text-neutral-400">
                        {new Date(t.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </button>
                  {confirmDeleteId === t.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[11px] text-neutral-500 mr-0.5">Remove?</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteTranscript(t.id); setConfirmDeleteId(null); }}
                        className="p-1 rounded hover:bg-red-100 text-red-500"
                        title="Confirm remove"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                        className="p-1 rounded hover:bg-neutral-200 text-neutral-400"
                        title="Cancel"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
                      title="Remove"
                      className="opacity-0 group-hover/ip:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600 flex-shrink-0"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recent notes ── */}
      {recentByDate.length === 0 ? (
        inProgress.length === 0 && live.length === 0 && (
          <div className="py-12 text-center">
            <MicrophoneIcon className="w-8 h-8 text-neutral-200 mx-auto mb-2" />
            <p className="text-[13px] text-neutral-500 font-medium">No notes yet</p>
            <p className="text-[12px] text-neutral-400 mt-1">
              {filterPersonEmail ? 'No meetings with this person.' : 'Use New Note to get started.'}
            </p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          {recentByDate.map((group) => (
            <section key={group.label}>
              <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((t) => {
                  if (t.botState === 'failed') {
                    return (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                      >
                        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                          <SourceIcon source={t.source} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-neutral-400 truncate">{t.title || 'Untitled'}</p>
                          <p className="text-[11px] text-red-400 mt-0.5">Processing failed</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {t.hasRecording && (
                            <button
                              onClick={() => {
                                setRetryingIds((prev) => new Set(prev).add(t.id));
                                onRetryFailed(t.id);
                              }}
                              disabled={retryingIds.has(t.id)}
                              className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <ArrowPathIcon className={`w-3 h-3 ${retryingIds.has(t.id) ? 'animate-spin' : ''}`} />
                              Retry
                            </button>
                          )}
                          {confirmDeleteId === t.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-neutral-500 mr-0.5">Remove?</span>
                              <button
                                onClick={() => { onDeleteTranscript(t.id); setConfirmDeleteId(null); }}
                                className="p-1 rounded hover:bg-red-100 text-red-500"
                                title="Confirm remove"
                              >
                                <CheckIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="p-1 rounded hover:bg-neutral-200 text-neutral-400"
                                title="Cancel"
                              >
                                <XMarkIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(t.id)}
                              className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
                              title="Remove"
                            >
                              <XMarkIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={t.id}
                      onClick={() => onSelectMeeting(t.calendarEventId ?? t.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                        <SourceIcon source={t.source} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-medium text-neutral-800 truncate">{t.title}</p>
                          {isNew(t) && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                        </div>
                        {(t.attendees?.length ?? 0) > 0 && (
                          <AttendeeAvatars attendees={t.attendees!} />
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-[11px] text-neutral-400">
                          {new Date(t.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {t.workItemsGenerated > 0 && (
                          <p className="text-[10px] text-blue-500 font-medium">{t.workItemsGenerated} items</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
