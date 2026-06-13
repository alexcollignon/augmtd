'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import {
  MicrophoneIcon,
  DocumentTextIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
  PencilIcon,
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
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
  source: 'bot' | 'recording' | 'upload' | 'text';
  summary?: string | null;
  processedAt?: string | null;
  folderId?: string | null;
  hasRecording: boolean;
  hasDocument?: boolean;
  attendees?: Array<{ email: string; name?: string }>;
  sharingMode?: 'live' | null;
  isSharedWithMe?: boolean;
  sharedByName?: string | null;
}

interface MeetingsHomeProps {
  upcoming: CalendarEvent[];
  transcripts: Transcript[];
  filterPersonEmail: string | null;
  onSelectMeeting: (id: string) => void;
  onDeleteTranscript: (transcriptId: string) => void;
  onRetryFailed: (transcriptId: string) => void;
  isNew: (t: Transcript) => boolean;
  folders?: DriveFolder[];
  onMoveToFolder?: (transcriptId: string, folderId: string | null) => Promise<void>;
  onRenameTranscript?: (id: string, title: string) => Promise<void>;
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
  if (source === 'recording') return <MicrophoneIcon className="w-4 h-4 text-red-400" />;
  return <DocumentTextIcon className="w-4 h-4 text-blue-400" />;
}

function SourceBadge({ source }: { source: string }) {
  if (source === 'recording' || source === 'bot' || source === 'upload') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-[10px] font-medium text-emerald-600 flex-shrink-0">
        <MicrophoneIcon className="w-2.5 h-2.5" />
        Recorded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 text-[10px] font-medium text-blue-500 flex-shrink-0">
      <DocumentTextIcon className="w-2.5 h-2.5" />
      Note
    </span>
  );
}

function FolderChip({ folderId, folders }: { folderId?: string | null; folders: DriveFolder[] }) {
  if (!folderId) return null;
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return null;
  return (
    <span className="group/fc inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-500 flex-shrink-0 overflow-hidden">
      <FolderIcon className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="text-[10px] font-medium max-w-0 group-hover/fc:max-w-[120px] overflow-hidden whitespace-nowrap transition-[max-width] duration-200 ease-out">
        {folder.name}
      </span>
    </span>
  );
}

function progressStatus(t: Transcript): { label: string; pulse: boolean } {
  if (t.source === 'recording') return { label: 'Transcribing recording…', pulse: true };
  if (t.source === 'text') return { label: 'Processing notes…', pulse: true };
  return { label: 'Processing…', pulse: true };
}

type CaptureFilter = 'all' | 'recordings' | 'notes';

export default function MeetingsHome({
  upcoming,
  transcripts,
  filterPersonEmail,
  onSelectMeeting,
  onDeleteTranscript,
  onRetryFailed,
  isNew,
  folders = [],
  onMoveToFolder,
  onRenameTranscript,
}: MeetingsHomeProps) {
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [captureFilter, setCaptureFilter] = useState<CaptureFilter>('all');

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);

  // Context menu
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrowStr = new Date(now.getTime() + 86400000).toDateString();

  // Close context menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpenId]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 30);
    }
  }, [renamingId]);

  function openMenu(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 176 });
    setMenuOpenId(id);
  }

  function handleDragStart(e: React.DragEvent, t: Transcript) {
    const ids = selectedIds.has(t.id) && selectedIds.size > 1
      ? Array.from(selectedIds)
      : [t.id];
    e.dataTransfer.setData('application/x-meetings-items', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';

    // Semi-transparent ghost
    const el = (e.currentTarget as HTMLElement).cloneNode(true) as HTMLElement;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0.45;pointer-events:none;width:' + (e.currentTarget as HTMLElement).offsetWidth + 'px';
    document.body.appendChild(el);
    e.dataTransfer.setDragImage(el, 20, 20);
    requestAnimationFrame(() => document.body.removeChild(el));
  }

  function handleCardClick(e: React.MouseEvent, t: Transcript, allItems: Transcript[]) {
    if (renamingId === t.id) return;
    if (e.metaKey || e.ctrlKey) {
      // Toggle individual
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
        return next;
      });
      lastSelectedIdRef.current = t.id;
    } else if (e.shiftKey && lastSelectedIdRef.current) {
      // Range select
      const ids = allItems.map((i) => i.id);
      const a = ids.indexOf(lastSelectedIdRef.current);
      const b = ids.indexOf(t.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelectedIds(new Set(ids.slice(lo, hi + 1)));
    } else {
      setSelectedIds(new Set());
      lastSelectedIdRef.current = null;
      onSelectMeeting(t.calendarEventId ?? t.id);
    }
  }

  async function submitRename() {
    if (!renamingId || !renamingValue.trim()) { setRenamingId(null); return; }
    if (onRenameTranscript) await onRenameTranscript(renamingId, renamingValue.trim());
    setRenamingId(null);
  }

  // Find the nearest day (from now) that has non-completed events.
  // Keep a meeting visible until its end_time (or start + 1h as fallback) so
  // users arriving a few minutes late can still tap into it.
  const nearestDay = useMemo(() => {
    const future = upcoming
      .filter((m) => {
        if (m.meeting_status === 'completed') return false;
        const end = m.end_time ? new Date(m.end_time) : new Date(new Date(m.start_time).getTime() + 60 * 60 * 1000);
        return end > now;
      })
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

  // Live: draft text note (saved but AI not yet run)
  const live = useMemo(() => {
    const items = transcripts.filter((t) =>
      t.source === 'text' && t.processed && !t.hasDocument && !t.summary && t.botState !== 'failed'
    );
    return items.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [transcripts]);

  // In-progress transcripts
  const inProgress = useMemo(() => {
    const all = transcripts
      .filter((t) => !t.processed && t.botState !== 'failed')
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const sourcePriority: Record<string, number> = { recording: 3, upload: 1, text: 0 };
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
    const sourcePriorityR: Record<string, number> = { recording: 3, bot: 2, upload: 1, text: 0 };
    const seenR = new Map<string, Transcript>();
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
    if (captureFilter === 'recordings') {
      list = list.filter((t) => t.source === 'recording' || t.source === 'bot' || t.source === 'upload');
    } else if (captureFilter === 'notes') {
      list = list.filter((t) => t.source === 'text');
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
  }, [transcripts, filterPersonEmail, captureFilter]); // eslint-disable-line

  const allRecentItems = useMemo(() => recentByDate.flatMap((g) => g.items), [recentByDate]);

  // The currently open menu transcript
  const menuTranscript = menuOpenId ? transcripts.find((t) => t.id === menuOpenId) : null;
  const userFolders = folders.filter((f) => !f.is_system);

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
                <div className="text-right flex-shrink-0 w-14">
                  <p className="text-[12px] font-medium text-neutral-700">
                    {new Date(event.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="text-[10px] text-neutral-400">
                    {new Date(event.end_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="w-px h-8 bg-indigo-200 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-neutral-800 truncate">{event.title}</p>
                  {(event.attendees?.length ?? 0) > 0 && (
                    <AttendeeAvatars attendees={event.attendees ?? []} />
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-medium text-indigo-600">Prepare →</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Live — open draft note ── */}
      {live.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">Live</h2>
          <div className="space-y-0.5">
            {live.map((t) => (
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
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                      <span className="text-[11px] text-neutral-400">Open note</span>
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
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      className="p-1 rounded hover:bg-neutral-200 text-neutral-400"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
                    className="opacity-0 group-hover/lv:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600 flex-shrink-0"
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
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
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                        className="p-1 rounded hover:bg-neutral-200 text-neutral-400"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
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

      {/* ── Captured ── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-0.5">
          {(['all', 'recordings', 'notes'] as CaptureFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setCaptureFilter(f)}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors ${
                captureFilter === f
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {f === 'all' ? 'All' : f === 'recordings' ? 'Recordings' : 'Notes'}
            </button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <span className="text-[11px] text-neutral-500">{selectedIds.size} selected</span>
        )}
      </div>

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
                              >
                                <CheckIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="p-1 rounded hover:bg-neutral-200 text-neutral-400"
                              >
                                <XMarkIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(t.id)}
                              className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
                            >
                              <XMarkIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const isSelected = selectedIds.has(t.id);
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, t)}
                      onClick={(e) => handleCardClick(e, t, allRecentItems)}
                      className={`group/card relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer select-none ${
                        isSelected ? 'bg-indigo-50' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                        <SourceIcon source={t.source} />
                      </div>
                      <div className="flex-1 min-w-0">
                        {renamingId === t.id ? (
                          <input
                            ref={renameInputRef}
                            value={renamingValue}
                            onChange={(e) => setRenamingValue(e.target.value)}
                            onBlur={submitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitRename();
                              if (e.key === 'Escape') setRenamingId(null);
                              e.stopPropagation();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full text-[13px] font-medium text-neutral-800 bg-white border border-indigo-300 rounded px-1 py-0.5 outline-none"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-medium text-neutral-800 truncate">{t.title}</p>
                            {isNew(t) && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <SourceBadge source={t.source} />
                          {t.sharingMode && !t.isSharedWithMe && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-[10px] font-medium text-indigo-600 flex-shrink-0">
                              <UsersIcon className="w-2.5 h-2.5" />
                              Shared
                            </span>
                          )}
                          {t.isSharedWithMe && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-neutral-100 text-[10px] font-medium text-neutral-500 flex-shrink-0">
                              <UsersIcon className="w-2.5 h-2.5" />
                              {t.sharedByName ? `from ${t.sharedByName.split(' ')[0]}` : 'Shared'}
                            </span>
                          )}
                          {folders.length > 0 && <FolderChip folderId={t.folderId} folders={folders} />}
                          {(t.attendees?.length ?? 0) > 0 && (
                            <AttendeeAvatars attendees={t.attendees!} />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <p className="text-[11px] text-neutral-400">
                          {new Date(t.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {t.workItemsGenerated > 0 && (
                          <p className="text-[10px] text-blue-500 font-medium ml-1">{t.workItemsGenerated} items</p>
                        )}
                        <button
                          onClick={(e) => openMenu(e, t.id)}
                          className="opacity-0 group-hover/card:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600 ml-1"
                        >
                          <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Context menu (fixed position) ── */}
      {menuOpenId && menuPos && menuTranscript && (
        <div
          ref={menuRef}
          style={{ top: menuPos.top, left: Math.max(8, menuPos.left), width: 176 }}
          className="fixed z-[200] bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Move to folder section */}
          {onMoveToFolder && userFolders.length > 0 && (
            <>
              <div className="px-3 py-1.5">
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Move to</p>
              </div>
              {userFolders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => {
                    onMoveToFolder(menuOpenId, folder.id);
                    setMenuOpenId(null);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-neutral-50 transition-colors ${
                    menuTranscript.folderId === folder.id ? 'text-indigo-600 font-medium' : 'text-neutral-700'
                  }`}
                >
                  <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                  <span className="truncate">{folder.name}</span>
                  {menuTranscript.folderId === folder.id && <CheckIcon className="w-3 h-3 ml-auto flex-shrink-0" />}
                </button>
              ))}
              {menuTranscript.folderId && (
                <button
                  onClick={() => {
                    onMoveToFolder(menuOpenId, null);
                    setMenuOpenId(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-neutral-500 hover:bg-neutral-50 transition-colors"
                >
                  <XMarkIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                  Remove from folder
                </button>
              )}
              <div className="border-t border-neutral-100 my-1" />
            </>
          )}

          {/* Rename */}
          {onRenameTranscript && (
            <button
              onClick={() => {
                setRenamingId(menuOpenId);
                setRenamingValue(menuTranscript.title);
                setMenuOpenId(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <PencilIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
              Rename
            </button>
          )}

          {/* Delete */}
          <button
            onClick={() => {
              setConfirmDeleteId(menuOpenId);
              setMenuOpenId(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50 transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5 flex-shrink-0" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
