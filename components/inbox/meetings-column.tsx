'use client';

import { useState, useEffect } from 'react';
import {
  CalendarIcon, CalendarDaysIcon, Bars3Icon,
  ChevronRightIcon, ChevronLeftIcon, ChevronDownIcon, ChevronUpIcon,
  PlusIcon, XMarkIcon, VideoCameraIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/lib/types/meetings';
import MeetingCard from '@/components/meetings/meeting-card';

type Connection = { id: string; provider: string; email?: string };

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

interface MeetingsColumnProps {
  isOpen: boolean;
  onToggle: () => void;
  meetings: CalendarEvent[];
  loading: boolean;
  userEmail: string;
  onRefresh?: () => void;
}

function MeetingSection({
  title,
  count,
  isCollapsed,
  onToggle,
  canCollapse = true,
  children,
}: {
  title: string;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
  canCollapse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <button
        onClick={canCollapse ? onToggle : undefined}
        disabled={!canCollapse}
        className={`w-full h-6 flex items-center justify-between px-1 mb-0.5 ${canCollapse ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
          {title} <span className="text-neutral-300 font-normal">({count})</span>
        </h3>
        {canCollapse && (
          isCollapsed
            ? <ChevronDownIcon className="w-3 h-3 text-neutral-300" />
            : <ChevronUpIcon className="w-3 h-3 text-neutral-300" />
        )}
      </button>
      {!isCollapsed && <div>{children}</div>}
    </div>
  );
}

function getDotColor(m: CalendarEvent, userEmail: string): string {
  if (m.meeting_status === 'in_progress') return 'bg-red-500';
  if (m.meeting_status === 'starting_soon') return 'bg-amber-400';
  if (m.meeting_status === 'completed') return 'bg-neutral-300';
  const self = m.attendees.find(a => a.self || a.email?.toLowerCase() === userEmail?.toLowerCase());
  const raw: string = self?.responseStatus ?? self?.status ?? 'needsAction';
  const status = raw === 'none' ? 'needsAction' : raw === 'tentativelyaccepted' ? 'tentative' : raw;
  if (status === 'needsAction') return 'bg-amber-400';
  if (status === 'tentative') return 'bg-amber-300';
  if (status === 'declined') return 'bg-neutral-300';
  return 'bg-blue-400';
}

function MonthView({
  meetings,
  userEmail,
  onRefresh,
  onNewMeeting,
}: {
  meetings: CalendarEvent[];
  userEmail: string;
  onRefresh?: () => void;
  onNewMeeting?: (date: Date) => void;
}) {
  const today = new Date();
  const todayStr = today.toDateString();

  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayStr);

  const displayMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = displayMonth.getFullYear();
  const month = displayMonth.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  // Monday-first: (getDay()+6)%7 → Mon=0 … Sun=6
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  // Map meetings to date strings
  const meetingsByDate = new Map<string, CalendarEvent[]>();
  for (const m of meetings) {
    const key = new Date(m.start_time).toDateString();
    if (!meetingsByDate.has(key)) meetingsByDate.set(key, []);
    meetingsByDate.get(key)!.push(m);
  }

  const selectedMeetings = meetingsByDate.get(selectedDateStr) ?? [];
  const monthLabel = displayMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          onClick={() => setMonthOffset(o => o - 1)}
          className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-semibold text-neutral-700">{monthLabel}</span>
        <button
          onClick={() => setMonthOffset(o => o + 1)}
          className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors"
        >
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-semibold text-neutral-300 uppercase">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5 mb-3">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const dateStr = date.toDateString();
          const dayMeetings = meetingsByDate.get(dateStr) ?? [];
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDateStr;
          const dots = dayMeetings.slice(0, 3);

          return (
            <button
              key={i}
              onClick={() => { setSelectedDateStr(dateStr); if (onNewMeeting) onNewMeeting(date); }}
              className={`flex flex-col items-center py-1 rounded transition-colors ${
                isSelected
                  ? 'bg-indigo-600'
                  : isToday
                  ? 'bg-indigo-50 hover:bg-indigo-100'
                  : 'hover:bg-neutral-50'
              }`}
            >
              <span className={`text-[11px] font-medium leading-none mb-0.5 ${
                isSelected ? 'text-white' :
                isToday ? 'text-indigo-600' :
                date.getMonth() !== month ? 'text-neutral-300' :
                'text-neutral-700'
              }`}>
                {date.getDate()}
              </span>
              <div className="flex gap-0.5 h-1.5">
                {dots.map((m, j) => (
                  <div
                    key={j}
                    className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white/60' : getDotColor(m, userEmail)}`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected day meetings */}
      <div className="border-t border-neutral-100 pt-2">
        <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 px-1">
          {new Date(selectedDateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
        {selectedMeetings.length === 0 ? (
          <p className="text-[11px] text-neutral-400 px-1 py-1">No meetings</p>
        ) : (
          selectedMeetings.map(m => (
            <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />
          ))
        )}
      </div>
    </div>
  );
}

export default function MeetingsColumn({ isOpen, onToggle, meetings, loading, userEmail, onRefresh }: MeetingsColumnProps) {
  const [viewMode, setViewMode] = useState<'list' | 'month'>('month');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(['completed', 'next_week'])
  );

  // New meeting form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [newForm, setNewForm] = useState({
    title: '',
    date: '',
    time: '',
    duration: 30,
    attendees: '',
    notes: '',
    connectionId: '',
    includeMeetLink: true,
  });
  const [formState, setFormState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || connections.length > 0) return;
    fetch('/api/connections')
      .then(r => r.json())
      .then(d => {
        const conns: Connection[] = d.connections ?? [];
        setConnections(conns);
        if (conns.length > 0) setNewForm(f => ({ ...f, connectionId: conns[0].id }));
      })
      .catch(() => {});
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNewForm = (date?: Date) => {
    const today = new Date();
    const d = date ?? today;
    setNewForm(f => ({
      ...f,
      date: d.toISOString().slice(0, 10),
      time: '',
      title: '',
      attendees: '',
      notes: '',
      includeMeetLink: true,
    }));
    setFormState('idle');
    setFormError(null);
    setShowNewForm(true);
  };

  const closeNewForm = () => {
    setShowNewForm(false);
    setFormState('idle');
    setFormError(null);
  };

  const handleSendInvite = async () => {
    const { title, date, time, duration, attendees, notes, connectionId, includeMeetLink } = newForm;
    if (!title.trim() || !date || !time) { setFormError('Title, date, and time are required.'); return; }
    const parsed = attendees.split(',').map(s => s.trim()).filter(Boolean);
    if (parsed.length === 0) { setFormError('Add at least one attendee.'); return; }

    setFormState('sending');
    setFormError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const startTime = new Date(`${date}T${time}`).toISOString();
      const endTime = new Date(new Date(`${date}T${time}`).getTime() + duration * 60000).toISOString();

      const res = await fetch('/api/meetings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          startTime,
          endTime,
          timezone,
          attendees: parsed,
          notes: notes.trim() || undefined,
          connectionId: connectionId || undefined,
          includeMeetLink,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === 'calendar_scope_required') {
          setFormError(`Calendar write access needed. Reconnect ${data.provider === 'gmail' ? 'Google' : 'Outlook'} in Settings.`);
          setFormState('error');
          return;
        }
        throw new Error(data?.error ?? 'Unknown error');
      }
      setFormState('sent');
      toast.success('Invitation sent');
      setTimeout(() => { closeNewForm(); onRefresh?.(); }, 1200);
    } catch (err: any) {
      setFormError(err?.message ?? 'Failed to send invitation');
      setFormState('error');
    }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  };

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const daysToSunday = now.getDay() === 0 ? 7 : 7 - now.getDay();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + daysToSunday);
  endOfWeek.setHours(0, 0, 0, 0);

  const endOfNextWeek = new Date(endOfWeek);
  endOfNextWeek.setDate(endOfWeek.getDate() + 7);

  const grouped = {
    in_progress: meetings.filter(m => m.meeting_status === 'in_progress'),
    starting_soon: meetings.filter(m => m.meeting_status === 'starting_soon'),
    today: meetings.filter(m => {
      if (m.meeting_status !== 'upcoming') return false;
      return new Date(m.start_time).toDateString() === now.toDateString();
    }),
    completed_recent: meetings.filter(m => {
      if (m.meeting_status !== 'completed') return false;
      return new Date(m.end_time).toDateString() === now.toDateString();
    }),
    tomorrow: meetings.filter(m => {
      if (m.meeting_status !== 'upcoming') return false;
      return new Date(m.start_time).toDateString() === tomorrow.toDateString();
    }),
    this_week: meetings.filter(m => {
      if (m.meeting_status !== 'upcoming') return false;
      const start = new Date(m.start_time);
      return start > tomorrow && start < endOfWeek && start.toDateString() !== tomorrow.toDateString();
    }),
    next_week: meetings.filter(m => {
      if (m.meeting_status !== 'upcoming') return false;
      const start = new Date(m.start_time);
      return start >= endOfWeek && start < endOfNextWeek;
    }),
  };

  return (
    <div
      className={`flex-shrink-0 border-l border-neutral-200 flex flex-col bg-white transition-all duration-200 overflow-hidden ${
        isOpen ? 'w-[272px]' : 'w-9'
      }`}
    >
      {/* Header */}
      <div
        className={`flex-shrink-0 h-10 flex items-center border-b border-neutral-200 ${
          isOpen ? 'justify-between px-4' : 'justify-center'
        }`}
      >
        {isOpen ? (
          <>
            <button
              onClick={onToggle}
              title="Hide calendar"
              className="flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <CalendarIcon className="w-4 h-4 text-neutral-500" />
              <span className="text-[13px] font-semibold text-neutral-700">Calendar</span>
            </button>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => openNewForm()}
                title="New meeting"
                className={`p-1 rounded transition-colors ${showNewForm ? 'text-indigo-600' : 'text-neutral-300 hover:text-neutral-500'}`}
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                className={`p-1 rounded transition-colors ${
                  viewMode === 'list' ? 'text-indigo-600' : 'text-neutral-300 hover:text-neutral-500'
                }`}
              >
                <Bars3Icon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('month')}
                title="Month view"
                className={`p-1 rounded transition-colors ${
                  viewMode === 'month' ? 'text-indigo-600' : 'text-neutral-300 hover:text-neutral-500'
                }`}
              >
                <CalendarDaysIcon className="w-3.5 h-3.5" />
              </button>
              <button onClick={onToggle} title="Hide calendar" className="p-0.5 hover:opacity-70 transition-opacity ml-1">
                <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-400" />
              </button>
            </div>
          </>
        ) : (
          <button onClick={onToggle} title="Show calendar" className="hover:opacity-70 transition-opacity">
            <CalendarIcon className="w-4 h-4 text-neutral-400" />
          </button>
        )}
      </div>

      {/* New meeting form */}
      {isOpen && showNewForm && (
        <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-3 flex-shrink-0 overflow-y-auto max-h-[60vh]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] font-semibold text-neutral-700">New meeting</span>
            <button onClick={closeNewForm} className="p-0.5 text-neutral-400 hover:text-neutral-600 transition-colors">
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {/* Title */}
            <input
              type="text"
              placeholder="Title"
              value={newForm.title}
              onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))}
              autoFocus
              className="w-full text-[12px] border border-neutral-200 px-2 py-1.5 outline-none focus:border-indigo-400 bg-white placeholder:text-neutral-400"
            />

            {/* Date + Time */}
            <div className="flex gap-1.5">
              <input
                type="date"
                value={newForm.date}
                onChange={e => setNewForm(f => ({ ...f, date: e.target.value }))}
                className="flex-1 text-[12px] border border-neutral-200 px-2 py-1.5 outline-none focus:border-indigo-400 bg-white"
              />
              <input
                type="time"
                value={newForm.time}
                onChange={e => setNewForm(f => ({ ...f, time: e.target.value }))}
                className="w-[82px] text-[12px] border border-neutral-200 px-2 py-1.5 outline-none focus:border-indigo-400 bg-white"
              />
            </div>

            {/* Duration */}
            <select
              value={newForm.duration}
              onChange={e => setNewForm(f => ({ ...f, duration: Number(e.target.value) }))}
              className="w-full text-[12px] border border-neutral-200 px-2 py-1.5 outline-none focus:border-indigo-400 bg-white"
            >
              {DURATION_OPTIONS.map(d => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </select>

            {/* Attendees */}
            <input
              type="text"
              placeholder="Attendees (comma-separated emails)"
              value={newForm.attendees}
              onChange={e => setNewForm(f => ({ ...f, attendees: e.target.value }))}
              className="w-full text-[12px] border border-neutral-200 px-2 py-1.5 outline-none focus:border-indigo-400 bg-white placeholder:text-neutral-400"
            />

            {/* Notes */}
            <textarea
              rows={2}
              placeholder="Notes (optional)"
              value={newForm.notes}
              onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full text-[12px] border border-neutral-200 px-2 py-1.5 outline-none focus:border-indigo-400 bg-white placeholder:text-neutral-400 resize-none"
            />

            {/* Account picker — only when > 1 connection */}
            {connections.length > 1 && (
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">Send from</p>
                <div className="space-y-1">
                  {connections.map(c => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="connectionId"
                        value={c.id}
                        checked={newForm.connectionId === c.id}
                        onChange={() => setNewForm(f => ({ ...f, connectionId: c.id }))}
                        className="accent-indigo-600"
                      />
                      <span className="text-[12px] text-neutral-700">
                        {c.email || c.id}
                        <span className="ml-1 text-neutral-400 text-[11px]">({c.provider === 'gmail' ? 'Google' : 'Outlook'})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Meeting link toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newForm.includeMeetLink}
                onChange={e => setNewForm(f => ({ ...f, includeMeetLink: e.target.checked }))}
                className="accent-indigo-600"
              />
              <VideoCameraIcon className="w-3.5 h-3.5 text-neutral-400" />
              <span className="text-[12px] text-neutral-600">
                {connections.find(c => c.id === newForm.connectionId)?.provider === 'outlook'
                  ? 'Include Teams link'
                  : 'Include Google Meet link'}
              </span>
            </label>

            {/* Error */}
            {formError && (
              <p className="text-[11px] text-red-500">{formError}</p>
            )}

            {/* Actions */}
            {formState === 'sent' ? (
              <p className="text-[12px] text-green-600 font-medium">Invitation sent ✓</p>
            ) : (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSendInvite}
                  disabled={formState === 'sending'}
                  className="flex-1 py-1.5 text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {formState === 'sending' ? 'Sending…' : 'Send invitation'}
                </button>
                <button
                  onClick={closeNewForm}
                  className="px-3 py-1.5 text-[12px] text-neutral-500 hover:text-neutral-700 border border-neutral-200 hover:border-neutral-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-3 bg-neutral-100 rounded w-1/2" />
              <div className="h-16 bg-neutral-100 rounded" />
              <div className="h-16 bg-neutral-100 rounded" />
            </div>
          ) : viewMode === 'month' ? (
            <MonthView
              meetings={meetings}
              userEmail={userEmail}
              onRefresh={onRefresh}
              onNewMeeting={showNewForm
                ? (date) => setNewForm(f => ({ ...f, date: date.toISOString().slice(0, 10) }))
                : undefined}
            />
          ) : meetings.length === 0 ? (
            <p className="text-[12px] text-neutral-400 text-center py-8">No meetings scheduled</p>
          ) : (
            <div>
              {grouped.in_progress.length > 0 && (
                <MeetingSection title="HAPPENING NOW" count={grouped.in_progress.length} isCollapsed={false} onToggle={() => {}} canCollapse={false}>
                  {grouped.in_progress.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />)}
                </MeetingSection>
              )}
              {grouped.starting_soon.length > 0 && (
                <MeetingSection title="STARTING SOON" count={grouped.starting_soon.length} isCollapsed={false} onToggle={() => {}} canCollapse={false}>
                  {grouped.starting_soon.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />)}
                </MeetingSection>
              )}
              {grouped.today.length > 0 && (
                <MeetingSection title="TODAY" count={grouped.today.length} isCollapsed={collapsedSections.has('today')} onToggle={() => toggleSection('today')}>
                  {grouped.today.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />)}
                </MeetingSection>
              )}
              {grouped.completed_recent.length > 0 && (
                <MeetingSection title="COMPLETED TODAY" count={grouped.completed_recent.length} isCollapsed={collapsedSections.has('completed')} onToggle={() => toggleSection('completed')}>
                  {grouped.completed_recent.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />)}
                </MeetingSection>
              )}
              {grouped.tomorrow.length > 0 && (
                <MeetingSection title="TOMORROW" count={grouped.tomorrow.length} isCollapsed={collapsedSections.has('tomorrow')} onToggle={() => toggleSection('tomorrow')}>
                  {grouped.tomorrow.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />)}
                </MeetingSection>
              )}
              {grouped.this_week.length > 0 && (
                <MeetingSection title="THIS WEEK" count={grouped.this_week.length} isCollapsed={collapsedSections.has('this_week')} onToggle={() => toggleSection('this_week')}>
                  {grouped.this_week.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />)}
                </MeetingSection>
              )}
              {grouped.next_week.length > 0 && (
                <MeetingSection title="NEXT WEEK" count={grouped.next_week.length} isCollapsed={collapsedSections.has('next_week')} onToggle={() => toggleSection('next_week')}>
                  {grouped.next_week.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} onRefresh={onRefresh} />)}
                </MeetingSection>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
