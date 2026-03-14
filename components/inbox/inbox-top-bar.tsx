'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { VideoCameraIcon } from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import type { CalendarEvent } from '@/lib/types/meetings';

interface InboxTopBarProps {
  preparedItems: InboxItem[];
  meetings: CalendarEvent[];
  meetingAssistantItems: InboxItem[];
  onSelectItem: (item: InboxItem) => void;
  firstName?: string | null;
}

function getGreeting(firstName?: string | null) {
  const hour = new Date().getHours();
  const time = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${time}, ${firstName}.` : `${time}.`;
}

function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);
  useEffect(() => {
    indexRef.current = 0;
    setDisplayed('');
    setDone(false);
    const id = setInterval(() => {
      indexRef.current += 1;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) { clearInterval(id); setDone(true); }
    }, 38);
    return () => clearInterval(id);
  }, [text]);
  return (
    <span>
      {displayed}
      {!done && <span className="inline-block w-[2px] h-[14px] bg-neutral-800 ml-0.5 align-middle animate-pulse" />}
    </span>
  );
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatMeetingLabel(dateStr: string, isToday: boolean) {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday) return time;
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

// ─── Floating dropdown (fixed-position, escapes all overflow contexts) ────────

interface DropdownProps {
  anchorRect: DOMRect | null;
  visible: boolean;
  children: React.ReactNode;
}

function FixedDropdown({ anchorRect, visible, children }: DropdownProps) {
  if (!anchorRect) return null;
  return (
    <div
      className={`fixed z-[200] bg-white border border-neutral-200 shadow-xl min-w-[220px] transition-all duration-150 ease-out ${
        visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-1 pointer-events-none'
      }`}
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
    >
      {children}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const getAccent = (item: InboxItem) =>
  item.execution_status === 'ready' ? 'border-l-indigo-500' :
  item.item_type === 'reply' ? 'border-l-indigo-400' :
  item.item_type === 'meeting' ? 'border-l-blue-400' :
  item.item_type === 'decision' ? 'border-l-orange-400' :
  item.item_type === 'review' ? 'border-l-violet-400' :
  'border-l-neutral-300';

const getBadge = (item: InboxItem) =>
  item.execution_status === 'ready' ? { text: 'See work', color: 'text-indigo-500' } :
  item.item_type === 'reply' ? { text: 'Reply', color: 'text-indigo-500' } :
  item.item_type === 'meeting' ? { text: 'Meeting', color: 'text-blue-500' } :
  item.item_type === 'decision' ? { text: 'Decide', color: 'text-orange-500' } :
  item.item_type === 'review' ? { text: 'Review', color: 'text-violet-500' } :
  { text: 'Action', color: 'text-neutral-400' };

// ─── Single task chip ─────────────────────────────────────────────────────────

function TaskChip({ item, onSelect }: { item: InboxItem; onSelect: (item: InboxItem) => void }) {
  const badge = getBadge(item);
  const label = item.work_title || item.source_data?.from_name || item.source_data?.from || 'Untitled';
  return (
    <button
      onClick={() => onSelect(item)}
      className={`group flex-shrink-0 flex items-center gap-2 pl-2.5 pr-3 h-[30px] bg-white border border-neutral-200 border-l-2 ${getAccent(item)} hover:bg-neutral-50 transition-colors`}
    >
      <span className="relative flex-shrink-0 overflow-hidden whitespace-nowrap max-w-[110px] group-hover:max-w-[220px] transition-[max-width] duration-200 ease-out">
        <span className="text-[12px] font-medium text-neutral-800">{label}</span>
        <span className="absolute right-0 inset-y-0 w-6 bg-gradient-to-r from-transparent to-white group-hover:opacity-0 transition-opacity duration-150 pointer-events-none" />
      </span>
      <span className={`text-[10.5px] font-semibold flex-shrink-0 ${badge.color}`}>{badge.text}</span>
    </button>
  );
}

// ─── Overflow "+N more" chip with dropdown ────────────────────────────────────

function MoreTasksChip({ items, onSelect }: { items: InboxItem[]; onSelect: (item: InboxItem) => void }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (ref.current) setRect(ref.current.getBoundingClientRect());
    setOpen(true);
  }, []);
  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  return (
    <>
      <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className="flex-shrink-0">
        <button className="flex items-center px-2.5 h-[30px] bg-white border border-neutral-200 hover:bg-neutral-50 transition-colors">
          <span className="text-[11px] text-neutral-500 font-medium">+{items.length} more</span>
        </button>
      </div>
      <FixedDropdown anchorRect={rect} visible={open}>
        <div onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
          {items.map(item => {
            const b = getBadge(item);
            const s = item.source_data?.from_name || item.source_data?.from || '';
            const t = item.work_title || 'Untitled';
            return (
              <button
                key={item.id}
                onClick={() => { onSelect(item); setOpen(false); }}
                className={`w-full flex items-center gap-2 pl-2.5 pr-3 py-2.5 border-l-2 ${getAccent(item)} hover:bg-neutral-50 transition-colors text-left border-b border-b-neutral-100 last:border-b-0`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-neutral-800 truncate">{s || t}</p>
                  {s && <p className="text-[11px] text-neutral-400 truncate mt-0.5">{t}</p>}
                </div>
                <span className={`text-[10.5px] font-semibold flex-shrink-0 ${b.color}`}>{b.text}</span>
              </button>
            );
          })}
        </div>
      </FixedDropdown>
    </>
  );
}

// ─── Meeting helpers ──────────────────────────────────────────────────────────

const getMeetingAccent = (m: CalendarEvent) =>
  m.meeting_status === 'in_progress' ? 'border-l-red-500' :
  m.meeting_status === 'starting_soon' ? 'border-l-amber-400' : 'border-l-blue-300';

const getMeetingTimeColor = (m: CalendarEvent) =>
  m.meeting_status === 'in_progress' ? 'text-red-600' :
  m.meeting_status === 'starting_soon' ? 'text-amber-600' : 'text-neutral-500';

function MeetingChip({ meeting: m, isToday }: { meeting: CalendarEvent; isToday: boolean }) {
  const isNow = m.meeting_status === 'in_progress';
  const isSoon = m.meeting_status === 'starting_soon';
  const handleJoin = (e: React.MouseEvent) => { e.stopPropagation(); window.open(m.meeting_link!, '_blank'); };
  return (
    <div className={`flex-shrink-0 flex items-center gap-2 pl-2.5 pr-3 h-[30px] bg-white border border-neutral-200 border-l-2 ${getMeetingAccent(m)}`}>
      {isNow && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
      <span className={`text-[11px] font-semibold flex-shrink-0 ${getMeetingTimeColor(m)}`}>{formatMeetingLabel(m.start_time, isToday)}</span>
      <span className="text-[12px] font-medium text-neutral-800 truncate max-w-[130px]">{m.title}</span>
      {(isNow || isSoon) && m.meeting_link && (
        <button
          onClick={handleJoin}
          className={`flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 text-white flex-shrink-0 transition-colors ${isNow ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'}`}
        >
          <VideoCameraIcon className="w-2.5 h-2.5" />
          Join
        </button>
      )}
    </div>
  );
}

function MoreMeetingsChip({ meetings }: { meetings: CalendarEvent[] }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (ref.current) setRect(ref.current.getBoundingClientRect());
    setOpen(true);
  }, []);
  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  return (
    <>
      <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className="flex-shrink-0">
        <button className="flex items-center px-2.5 h-[30px] bg-white border border-neutral-200 hover:bg-neutral-50 transition-colors">
          <span className="text-[11px] text-neutral-500 font-medium">+{meetings.length} more</span>
        </button>
      </div>
      <FixedDropdown anchorRect={rect} visible={open}>
        <div onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
          {meetings.map(m => {
            const mIsNow = m.meeting_status === 'in_progress';
            const mIsSoon = m.meeting_status === 'starting_soon';
            const attendees = m.attendees ?? [];
            const attendeeLabel = attendees.length === 1
              ? `1:1 · ${attendees[0]?.name || attendees[0]?.email || ''}`
              : attendees.length > 1 ? `${attendees.length} attendees` : '';
            return (
              <div
                key={m.id}
                className={`flex items-center gap-2 pl-2.5 pr-3 py-2.5 border-l-2 ${getMeetingAccent(m)} hover:bg-neutral-50 transition-colors border-b border-b-neutral-100 last:border-b-0`}
              >
                {mIsNow && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-semibold flex-shrink-0 ${getMeetingTimeColor(m)}`}>{formatTime(m.start_time)}</span>
                    <span className="text-[12px] font-medium text-neutral-800 truncate">{m.title}</span>
                  </div>
                  {attendeeLabel && <p className="text-[11px] text-neutral-400 mt-0.5">{attendeeLabel}</p>}
                </div>
                {(mIsNow || mIsSoon) && m.meeting_link && (
                  <button
                    onClick={e => { e.stopPropagation(); window.open(m.meeting_link!, '_blank'); }}
                    className={`flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 text-white flex-shrink-0 transition-colors ${mIsNow ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'}`}
                  >
                    <VideoCameraIcon className="w-2.5 h-2.5" />
                    Join
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </FixedDropdown>
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InboxTopBar({ preparedItems, meetings, meetingAssistantItems, onSelectItem, firstName }: InboxTopBarProps) {
  const now = new Date();
  const todayStr = now.toDateString();

  const todayMeetings = meetings
    .filter(m => {
      const isToday = new Date(m.start_time).toDateString() === todayStr;
      return m.meeting_status === 'in_progress' || m.meeting_status === 'starting_soon' || (isToday && m.meeting_status === 'upcoming');
    })
    .sort((a, b) => {
      const u = (m: CalendarEvent) => m.meeting_status === 'in_progress' ? 2 : m.meeting_status === 'starting_soon' ? 1 : 0;
      return u(b) - u(a) || new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    });

  // Fall back to next upcoming meetings when nothing is happening today
  const futureMeetings = todayMeetings.length === 0
    ? meetings
        .filter(m => m.meeting_status === 'upcoming' && new Date(m.start_time) > now)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        .slice(0, 3)
    : [];

  const displayMeetings = todayMeetings.length > 0 ? todayMeetings : futureMeetings;
  const meetingsAreToday = todayMeetings.length > 0;

  const allTasks = [...preparedItems, ...meetingAssistantItems];
  const hasAnything = allTasks.length > 0 || displayMeetings.length > 0;

  const MAX_VISIBLE_TASKS = 4;
  const MAX_VISIBLE_MEETINGS = 3;
  const visibleTasks = allTasks.slice(0, MAX_VISIBLE_TASKS);
  const overflowTasks = allTasks.slice(MAX_VISIBLE_TASKS);
  const visibleMeetings = displayMeetings.slice(0, MAX_VISIBLE_MEETINGS);
  const overflowMeetings = displayMeetings.slice(MAX_VISIBLE_MEETINGS);

  return (
    <div className="flex-shrink-0 border-b border-neutral-200 bg-white">
      <div className="px-6 pt-4 pb-2.5">
        <p className="text-[16px] font-semibold text-neutral-900 tracking-tight leading-none">
          <TypewriterText text={getGreeting(firstName)} />
        </p>
      </div>

      <div className="flex items-center gap-1.5 px-6 pb-3 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {!hasAnything ? (
          <span className="text-[12px] text-neutral-400 italic">All clear — nothing pending.</span>
        ) : (
          <>
            {visibleTasks.map(item => (
              <TaskChip key={item.id} item={item} onSelect={onSelectItem} />
            ))}
            {overflowTasks.length > 0 && (
              <MoreTasksChip items={overflowTasks} onSelect={onSelectItem} />
            )}
            {allTasks.length > 0 && displayMeetings.length > 0 && (
              <div className="h-4 w-px bg-neutral-200 flex-shrink-0 mx-0.5" />
            )}
            {visibleMeetings.map(m => (
              <MeetingChip key={m.id} meeting={m} isToday={meetingsAreToday} />
            ))}
            {overflowMeetings.length > 0 && (
              <MoreMeetingsChip meetings={overflowMeetings} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
