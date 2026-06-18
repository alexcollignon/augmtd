'use client';

import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { IconButton } from '@/components/ui';
import type { CalendarEvent } from '@/lib/types/meetings';

export function getDotColor(m: CalendarEvent, userEmail: string): string {
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

interface MonthCalendarProps {
  meetings: CalendarEvent[];
  userEmail: string;
  selectedDateStr?: string;
  onSelectDate?: (dateStr: string) => void;
  onNewMeeting?: (date: Date) => void;
  /** compact: tighter spacing for narrow sidebars */
  compact?: boolean;
}

export default function MonthCalendar({
  meetings,
  userEmail,
  selectedDateStr: controlledDateStr,
  onSelectDate,
  onNewMeeting,
  compact = false,
}: MonthCalendarProps) {
  const today = new Date();
  const todayStr = today.toDateString();
  const [monthOffset, setMonthOffset] = useState(0);
  const [internalDateStr, setInternalDateStr] = useState(todayStr);

  const selectedDateStr = controlledDateStr ?? internalDateStr;

  const handleSelect = (dateStr: string) => {
    if (!controlledDateStr) setInternalDateStr(dateStr);
    onSelectDate?.(dateStr);
  };

  const displayMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = displayMonth.getFullYear();
  const month = displayMonth.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const meetingsByDate = new Map<string, CalendarEvent[]>();
  for (const m of meetings) {
    const key = new Date(m.start_time).toDateString();
    if (!meetingsByDate.has(key)) meetingsByDate.set(key, []);
    meetingsByDate.get(key)!.push(m);
  }

  const monthLabel = displayMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-2 px-1">
        <IconButton onClick={() => setMonthOffset(o => o - 1)} size="sm">
          <ChevronLeftIcon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </IconButton>
        <span className={`font-semibold text-neutral-700 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
          {monthLabel}
        </span>
        <IconButton onClick={() => setMonthOffset(o => o + 1)} size="sm">
          <ChevronRightIcon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </IconButton>
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className={`text-center font-semibold text-neutral-300 uppercase ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const dateStr = date.toDateString();
          const dayMeetings = meetingsByDate.get(dateStr) ?? [];
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDateStr;
          const dots = dayMeetings.slice(0, 3);

          return (
            <div key={i} className="relative group">
              <button
                onClick={() => handleSelect(dateStr)}
                className={`w-full flex flex-col items-center rounded transition-colors ${compact ? 'py-1' : 'py-1.5'} ${
                  isSelected
                    ? 'bg-indigo-600'
                    : isToday
                    ? 'bg-indigo-50 hover:bg-indigo-100'
                    : 'hover:bg-neutral-50'
                }`}
              >
                <span className={`font-medium leading-none mb-0.5 ${compact ? 'text-[11px]' : 'text-[12px]'} ${
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
              {onNewMeeting && (
                <button
                  onClick={() => onNewMeeting(date)}
                  title="New meeting"
                  className="absolute top-0 right-0 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-indigo-500 text-white text-[9px] leading-none"
                >
                  +
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
