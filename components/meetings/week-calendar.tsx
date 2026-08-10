'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon, VideoCameraIcon, PencilSquareIcon, TrashIcon, MapPinIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button, IconButton, Input, Select } from '@/components/ui';
import type { CalendarEvent } from '@/lib/types/meetings';
import { isUserOrganizer, formatMeetingTime, calculateDuration } from '@/lib/types/meetings';
import NewMeetingModal from './new-meeting-modal';
import AttendeeInput, { type AttendeeChip } from './attendee-input';

const HOUR_HEIGHT = 64;
const START_HOUR = 7;
const END_HOUR = 23;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const GUTTER_WIDTH = 48;
const POPOVER_W = 300;
const DURATION_OPTIONS = [15, 30, 45, 60, 90];

type Connection = { id: string; provider: string; email?: string };

interface WeekCalendarProps {
  meetings: CalendarEvent[];
  userEmail: string;
  onRefresh?: () => void;
  onNewMeeting?: (date: Date) => void;
}

interface QuickCreate {
  date: Date;
  clientX: number;
  clientY: number;
  dayStr: string;
  ghostTop: number;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface EventLayout {
  event: CalendarEvent;
  col: number;
  numCols: number;
}

function layoutEvents(events: CalendarEvent[]): EventLayout[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
  const cols: number[] = [];
  const assignments: { event: CalendarEvent; col: number }[] = [];
  for (const event of sorted) {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    let col = cols.findIndex(endTime => endTime <= start);
    if (col === -1) col = cols.length;
    cols[col] = end;
    assignments.push({ event, col });
  }
  return assignments.map(({ event, col }) => {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    const overlapping = assignments.filter(other => {
      const oStart = new Date(other.event.start_time).getTime();
      const oEnd = new Date(other.event.end_time).getTime();
      return oStart < end && oEnd > start;
    });
    const numCols = Math.max(...overlapping.map(o => o.col)) + 1;
    return { event, col, numCols };
  });
}

function eventColor(event: CalendarEvent, userEmail: string): { bg: string; border: string; text: string } {
  if (event.meeting_status === 'in_progress') return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-800' };
  if (event.meeting_status === 'starting_soon') return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800' };
  if (event.meeting_status === 'completed') return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-500' };
  const self = event.attendees.find(a => a.self || a.email?.toLowerCase() === userEmail?.toLowerCase());
  const raw: string = self?.responseStatus ?? self?.status ?? 'needsAction';
  const status = raw === 'none' ? 'needsAction' : raw === 'tentativelyaccepted' ? 'tentative' : raw;
  if (status === 'declined') return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-400' };
  if (status === 'tentative') return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' };
  if (status === 'needsAction') return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900' };
  return { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-900' };
}

// ── Inline quick-create popover ──────────────────────────────────────────────
interface QuickCreatePopoverProps {
  quickCreate: QuickCreate;
  onClose: () => void;
  onSuccess: () => void;
  style: { left: number; top: number };
}

function QuickCreatePopover({ quickCreate, onClose, onSuccess, style }: QuickCreatePopoverProps) {
  const d = quickCreate.date;
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const [form, setForm] = useState({
    title: '',
    date: dateStr,
    time: timeStr,
    duration: 30,
    attendees: [] as AttendeeChip[],
    includeMeetLink: true,
    connectionId: '',
  });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  useEffect(() => {
    fetch('/api/connections').then(r => r.json()).then(data => {
      const conns: Connection[] = data.connections ?? [];
      setConnections(conns);
      if (conns.length > 0) setForm(f => ({ ...f, connectionId: conns[0].id }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  const handleSubmit = async () => {
    if (!form.title.trim()) { setError('Add a title.'); titleRef.current?.focus(); return; }
    const parsed = form.attendees.map(a => a.email).filter(Boolean);
    if (parsed.length === 0) { setError('Add at least one attendee.'); return; }
    setSending(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const startTime = new Date(`${form.date}T${form.time}`).toISOString();
      const endTime = new Date(new Date(`${form.date}T${form.time}`).getTime() + form.duration * 60000).toISOString();
      const res = await fetch('/api/meetings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          startTime, endTime, timezone,
          attendees: parsed,
          connectionId: form.connectionId || undefined,
          includeMeetLink: form.includeMeetLink,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === 'calendar_scope_required') {
          setError(`Calendar write access needed. Reconnect ${data.provider === 'gmail' ? 'Google' : 'Outlook'} in Settings.`);
        } else if (data?.error === 'No active email connection found') {
          // Honest words on a sovereign workspace (no mailbox auth exists here by design) —
          // never point at a Settings tab that doesn't exist.
          setError('This workspace runs without connected calendars, so invites can’t be sent from here. Share the meeting details in a message instead.');
        } else {
          setError(data?.error ?? 'Failed to create meeting');
        }
        setSending(false);
        return;
      }
      toast.success('Invitation sent');
      onSuccess();
    } catch {
      setError('Failed to create meeting');
      setSending(false);
    }
  };

  const selectedProvider = connections.find(c => c.id === form.connectionId)?.provider;

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white rounded-lg border border-neutral-200 shadow-xl flex flex-col"
      style={{ left: style.left, top: style.top, width: POPOVER_W }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-neutral-100">
        <span className="text-[13px] font-bold text-neutral-900">New meeting</span>
        <IconButton onClick={onClose} size="sm">
          <XMarkIcon className="w-3.5 h-3.5" />
        </IconButton>
      </div>

      <div className="px-3 py-3 space-y-2.5">
        {/* Title */}
        <input
          ref={titleRef}
          type="text"
          placeholder="Title"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          className="w-full text-[13px] font-semibold border-b border-neutral-200 pb-1.5 outline-none placeholder:text-neutral-300 focus:border-indigo-400 transition-colors bg-transparent"
        />

        {/* Date + Time */}
        <div className="flex gap-2">
          <Input
            type="date"
            value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="flex-1"
          />
          <Input
            type="time"
            value={form.time}
            onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
            className="w-[88px]"
          />
        </div>

        {/* Duration */}
        <Select
          value={form.duration}
          onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
        >
          {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} min</option>)}
        </Select>

        {/* Attendees */}
        <AttendeeInput
          value={form.attendees}
          onChange={attendees => setForm(f => ({ ...f, attendees }))}
          compact
        />

        {/* Account picker — only if >1 connection */}
        {connections.length > 1 && (
          <Select
            value={form.connectionId}
            onChange={e => setForm(f => ({ ...f, connectionId: e.target.value }))}
          >
            {connections.map(c => (
              <option key={c.id} value={c.id}>
                {c.email || c.id} ({c.provider === 'gmail' ? 'Google' : 'Outlook'})
              </option>
            ))}
          </Select>
        )}

        {/* Meet link toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.includeMeetLink}
            onChange={e => setForm(f => ({ ...f, includeMeetLink: e.target.checked }))}
            className="accent-indigo-600"
          />
          <VideoCameraIcon className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-[12px] text-neutral-500">
            {selectedProvider === 'outlook' ? 'Include Teams link' : 'Include Google Meet link'}
          </span>
        </label>

        {error && <p className="text-[11px] text-red-500">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-0.5">
          <Button
            onClick={handleSubmit}
            disabled={sending}
            size="sm"
            className="flex-1"
          >
            {sending ? 'Sending…' : 'Send invitation'}
          </Button>
          <Button
            onClick={onClose}
            variant="secondary"
            size="sm"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Event detail popover ──────────────────────────────────────────────────────
interface EventPopoverProps {
  event: CalendarEvent;
  userEmail: string;
  style: { left: number; top: number };
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}

function EventPopover({ event, userEmail, style, onClose, onEdit, onDeleted }: EventPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isUpcoming = event.meeting_status !== 'completed';
  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/meetings/${event.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Meeting deleted'); onDeleted(); }
      else { toast.error('Failed to delete meeting'); setDeleteConfirm(false); }
    } catch { toast.error('Failed to delete meeting'); setDeleteConfirm(false); }
    finally { setIsDeleting(false); }
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-neutral-200 shadow-2xl rounded-lg flex flex-col"
      style={{ left: style.left, top: style.top, width: 320 }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <h3 className="text-[15px] font-bold text-neutral-900 leading-tight flex-1 pr-2">{event.title}</h3>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {isUpcoming && !deleteConfirm && (
            <>
              <IconButton onClick={onEdit} title="Edit" className="hover:text-indigo-600">
                <PencilSquareIcon className="w-4 h-4" />
              </IconButton>
              <IconButton onClick={() => setDeleteConfirm(true)} title="Delete" tone="danger">
                <TrashIcon className="w-4 h-4" />
              </IconButton>
            </>
          )}
          {deleteConfirm && (
            <div className="flex items-center gap-1.5 mr-1">
              <span className="text-[11px] text-neutral-500">Delete?</span>
              <button onClick={handleDelete} disabled={isDeleting} className="text-[11px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
                {isDeleting ? '…' : 'Yes'}
              </button>
              <button onClick={() => setDeleteConfirm(false)} className="text-[11px] text-neutral-400 hover:text-neutral-600">No</button>
            </div>
          )}
          <IconButton onClick={onClose}>
            <XMarkIcon className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-4 space-y-2.5">
        {/* Date/time */}
        <div className="flex items-start gap-2 text-[13px] text-neutral-600">
          <CalendarIcon className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
          <div>
            <div>{new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            <div className="text-neutral-400 mt-0.5">{primary} · {duration}min</div>
          </div>
        </div>

        {/* Meet link */}
        {event.meeting_link && (
          <a href={event.meeting_link} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 text-[13px] text-blue-600 hover:underline font-medium">
            <VideoCameraIcon className="w-4 h-4 flex-shrink-0" />
            Join with {event.meeting_link.includes('teams.microsoft') ? 'Teams' : 'Google Meet'}
          </a>
        )}

        {/* Location */}
        {event.location && (
          <div className="flex items-center gap-2 text-[13px] text-neutral-500">
            <MapPinIcon className="w-4 h-4 flex-shrink-0 text-neutral-400" />
            {event.location}
          </div>
        )}

        {/* Attendees */}
        {event.attendees.length > 0 && (
          <div className="pt-1">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Attendees</p>
            <div className="space-y-1.5">
              {event.attendees.slice(0, 5).map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-semibold text-indigo-600">{(a.name || a.email)[0].toUpperCase()}</span>
                  </div>
                  <span className="text-[12px] text-neutral-700 truncate">{a.name || a.email}</span>
                </div>
              ))}
              {event.attendees.length > 5 && (
                <p className="text-[11px] text-neutral-400 pl-8">+{event.attendees.length - 5} more</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

export default function WeekCalendar({
  meetings,
  userEmail,
  onRefresh,
}: WeekCalendarProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<{ event: CalendarEvent; clientX: number; clientY: number } | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [quickCreate, setQuickCreate] = useState<QuickCreate | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const baseWeekStart = getWeekStart(now);
  const weekStart = new Date(baseWeekStart);
  weekStart.setDate(baseWeekStart.getDate() + weekOffset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    if (!scrollRef.current || !isCurrentWeek) return;
    const nowMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
    const top = Math.max(0, (nowMinutes / 60) * HOUR_HEIGHT - 120);
    scrollRef.current.scrollTop = top;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const weekLabel = (() => {
    const startLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endDay = days[6];
    const endLabel = endDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startLabel} – ${endLabel}`;
  })();

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);
  const nowMinutesFromStart = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const nowTop = (nowMinutesFromStart / 60) * HOUR_HEIGHT;
  const showNowLine = isCurrentWeek && nowMinutesFromStart >= 0 && nowMinutesFromStart <= TOTAL_HOURS * 60;

  const popoverStyle = quickCreate ? (() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const left = quickCreate.clientX + 12 + POPOVER_W > vw
      ? quickCreate.clientX - POPOVER_W - 12
      : quickCreate.clientX + 12;
    const top = Math.min(quickCreate.clientY - 20, vh - 420);
    return { left, top: Math.max(8, top) };
  })() : { left: 0, top: 0 };

  return (
    <div className="flex flex-col h-full">
      {/* Week nav header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-neutral-100 bg-white">
        <div className="flex items-center gap-2">
          <IconButton onClick={() => setWeekOffset(o => o - 1)} size="sm">
            <ChevronLeftIcon className="w-4 h-4" />
          </IconButton>
          <span className="text-[13px] font-semibold text-neutral-700 min-w-[180px] text-center">{weekLabel}</span>
          <IconButton onClick={() => setWeekOffset(o => o + 1)} size="sm">
            <ChevronRightIcon className="w-4 h-4" />
          </IconButton>
        </div>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="text-[12px] text-indigo-500 hover:underline">Today</button>
        )}
      </div>

      {/* Day headers */}
      <div className="flex-shrink-0 flex border-b border-neutral-100 bg-white" style={{ paddingLeft: GUTTER_WIDTH }}>
        {days.map((day) => {
          const isToday = day.toDateString() === now.toDateString();
          return (
            <div key={day.toISOString()} className="flex-1 py-2 text-center">
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-indigo-500' : 'text-neutral-400'}`}>
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </p>
              <p className={`text-[15px] font-semibold leading-tight mt-0.5 ${isToday ? 'text-white bg-indigo-600 w-7 h-7 rounded-full flex items-center justify-center mx-auto' : 'text-neutral-800'}`}>
                {day.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
          {/* Time gutter */}
          <div className="flex-shrink-0 relative" style={{ width: GUTTER_WIDTH }}>
            {hours.map((hour) => (
              <div key={hour} className="absolute w-full flex items-start justify-end pr-2" style={{ top: (hour - START_HOUR) * HOUR_HEIGHT - 8 }}>
                <span className="text-[10px] text-neutral-300 font-medium leading-none">
                  {hour === 12 ? '12pm' : hour > 12 ? `${hour - 12}pm` : `${hour}am`}
                </span>
              </div>
            ))}
          </div>

          {/* Grid columns */}
          <div className="flex flex-1 relative">
            {hours.map((hour) => (
              <div key={hour} className="absolute left-0 right-0 border-t border-neutral-100" style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }} />
            ))}

            {showNowLine && (
              <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                <div className="relative flex items-center">
                  <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -ml-1" />
                  <div className="flex-1 h-px bg-red-400" />
                </div>
              </div>
            )}

            {days.map((day) => {
              const dayStr = day.toDateString();
              const isToday = dayStr === now.toDateString();
              const dayEvents = meetings.filter(m => new Date(m.start_time).toDateString() === dayStr);
              const laid = layoutEvents(dayEvents);
              const isGhostDay = quickCreate?.dayStr === dayStr;

              return (
                <div
                  key={dayStr}
                  className={`relative flex-1 border-l border-neutral-100 group/col cursor-pointer ${isToday ? 'bg-indigo-50/20 hover:bg-indigo-50/40' : 'hover:bg-neutral-50/60'} transition-colors`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const offsetY = e.clientY - rect.top;
                    const snappedMinutes = Math.round((START_HOUR * 60 + (offsetY / HOUR_HEIGHT) * 60) / 15) * 15;
                    const h = Math.floor(snappedMinutes / 60);
                    const m = snappedMinutes % 60;
                    const clicked = new Date(day);
                    clicked.setHours(Math.min(h, END_HOUR - 1), m, 0, 0);
                    const ghostTop = ((clicked.getHours() - START_HOUR) * 60 + clicked.getMinutes()) / 60 * HOUR_HEIGHT;
                    setQuickCreate({ date: clicked, clientX: e.clientX, clientY: e.clientY, dayStr, ghostTop });
                  }}
                >
                  {hours.map((hour) => (
                    <div key={hour} className="absolute left-0 right-0 border-t border-neutral-50" style={{ top: (hour - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                  ))}

                  {/* Ghost block */}
                  {isGhostDay && (
                    <div
                      className="absolute left-[2px] right-[4px] bg-indigo-100 border border-indigo-300 pointer-events-none z-10"
                      style={{ top: quickCreate!.ghostTop, height: HOUR_HEIGHT / 2 - 2 }}
                    >
                      <p className="text-[11px] text-indigo-600 font-medium px-1.5 pt-0.5 truncate leading-tight">New meeting</p>
                      <p className="text-[10px] text-indigo-400 px-1.5 truncate">
                        {quickCreate!.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  )}

                  {laid.map(({ event, col, numCols }) => {
                    const startDate = new Date(event.start_time);
                    const endDate = new Date(event.end_time);
                    const startMins = (startDate.getHours() - START_HOUR) * 60 + startDate.getMinutes();
                    const durationMins = Math.max(15, (endDate.getTime() - startDate.getTime()) / 60000);
                    const top = (startMins / 60) * HOUR_HEIGHT;
                    const height = Math.max(20, (durationMins / 60) * HOUR_HEIGHT - 2);
                    const colors = eventColor(event, userEmail);

                    return (
                      <div
                        key={event.id}
                        onClick={(e) => { e.stopPropagation(); setSelectedEvent({ event, clientX: e.clientX, clientY: e.clientY }); }}
                        className={`absolute overflow-hidden border cursor-pointer hover:brightness-95 transition-all ${colors.bg} ${colors.border} ${colors.text}`}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          left: `calc(${(col / numCols) * 100}% + 2px)`,
                          width: `calc(${(1 / numCols) * 100}% - 4px)`,
                        }}
                      >
                        <div className="px-1.5 py-1 h-full flex flex-col overflow-hidden">
                          <p className="text-[11px] font-semibold leading-tight truncate">{event.title}</p>
                          {height > 32 && (
                            <p className="text-[10px] leading-tight opacity-70 truncate mt-0.5">
                              {startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick-create popover */}
      {quickCreate && (
        <QuickCreatePopover
          quickCreate={quickCreate}
          onClose={() => setQuickCreate(null)}
          onSuccess={() => { setQuickCreate(null); onRefresh?.(); }}
          style={popoverStyle}
        />
      )}

      {selectedEvent && (() => {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        const pw = 320;
        const left = selectedEvent.clientX + 16 + pw > vw
          ? selectedEvent.clientX - pw - 16
          : selectedEvent.clientX + 16;
        const top = Math.min(Math.max(8, selectedEvent.clientY - 60), vh - 360);
        return (
          <EventPopover
            event={selectedEvent.event}
            userEmail={userEmail}
            style={{ left, top }}
            onClose={() => setSelectedEvent(null)}
            onEdit={() => { setEditEvent(selectedEvent.event); setSelectedEvent(null); }}
            onDeleted={() => { setSelectedEvent(null); onRefresh?.(); }}
          />
        );
      })()}

      {editEvent && (
        <NewMeetingModal
          isOpen={!!editEvent}
          onClose={() => setEditEvent(null)}
          onSuccess={() => { setEditEvent(null); onRefresh?.(); }}
          event={editEvent}
        />
      )}
    </div>
  );
}
