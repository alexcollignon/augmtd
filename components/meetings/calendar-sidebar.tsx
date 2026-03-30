'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import MeetingCard from '@/components/meetings/meeting-card';
import MonthCalendar from '@/components/meetings/month-calendar';

interface CalendarSidebarProps {
  meetings: CalendarEvent[];
  userEmail: string;
  botStateMap: Map<string, string>;
  onScheduled: (eventId: string) => void;
  onCancelled: (eventId: string) => void;
  onRefresh?: () => void;
  onNewMeeting?: (date: Date) => void;
}

function getBotStateChip(state?: string | null) {
  if (!state || state === 'scheduled' || state === 'done') return null;
  if (state === 'joining') return { label: 'Joining', className: 'text-blue-600 bg-blue-50' };
  if (state === 'recording') return { label: 'Recording', className: 'text-red-600 bg-red-50' };
  if (state === 'processing') return { label: 'Transcribing', className: 'text-amber-600 bg-amber-50' };
  if (state === 'failed') return { label: 'Failed', className: 'text-red-600 bg-red-50' };
  return null;
}

function CompletedTodaySection({ meetings }: { meetings: CalendarEvent[] }) {
  const hasProcessing = meetings.some(m =>
    m.attendee_bot_state === 'joining' ||
    m.attendee_bot_state === 'recording' ||
    m.attendee_bot_state === 'processing'
  );
  const [collapsed, setCollapsed] = useState(!hasProcessing);

  if (meetings.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-neutral-100">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full h-6 flex items-center justify-between px-1 mb-0.5"
      >
        <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
          Completed today <span className="font-normal text-neutral-300">({meetings.length})</span>
        </h3>
        {collapsed
          ? <ChevronDownIcon className="w-3 h-3 text-neutral-300" />
          : <ChevronUpIcon className="w-3 h-3 text-neutral-300" />}
      </button>
      {!collapsed && (
        <div className="space-y-0.5">
          {meetings.map(m => {
            const chip = getBotStateChip(m.attendee_bot_state);
            return (
              <div key={m.id} className="px-1 py-1.5 flex items-center justify-between gap-2">
                <p className="text-[12px] text-neutral-700 truncate flex-1 leading-tight">{m.title}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {chip && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 ${chip.className}`}>
                      {chip.label}
                    </span>
                  )}
                  <Link href={`/meetings/${m.id}`} className="text-[10px] text-indigo-500 hover:underline font-medium">
                    View
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RollingWeekView({
  meetings,
  userEmail,
  botStateMap,
  onScheduled,
  onCancelled,
  onRefresh,
  focusDateStr,
}: {
  meetings: CalendarEvent[];
  userEmail: string;
  botStateMap: Map<string, string>;
  onScheduled: (eventId: string) => void;
  onCancelled: (eventId: string) => void;
  onRefresh?: () => void;
  focusDateStr?: string;
}) {
  const now = new Date();
  const todayStr = now.toDateString();
  const isFocused = focusDateStr && focusDateStr !== todayStr;

  if (isFocused) {
    const dayMeetings = meetings.filter(m =>
      new Date(m.start_time).toDateString() === focusDateStr
    );
    const focusDate = new Date(focusDateStr!);
    const label = focusDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (dayMeetings.length === 0) {
      return <p className="text-[12px] text-neutral-400 text-center py-4">{label} — no meetings</p>;
    }
    return (
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 px-1">{label}</p>
          {dayMeetings.map(m => (
            <MeetingCard
              key={m.id}
              event={m}
              userEmail={userEmail}
              botState={botStateMap.get(m.id) ?? m.attendee_bot_state ?? null}
              onScheduled={onScheduled}
              onCancelled={onCancelled}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      </div>
    );
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const inProgress = meetings.filter(m =>
    (m.meeting_status === 'in_progress' || m.meeting_status === 'starting_soon') &&
    new Date(m.end_time) > now
  );

  const byDay = new Map<string, CalendarEvent[]>();
  for (const m of meetings) {
    if (inProgress.includes(m)) continue;
    if (new Date(m.end_time) <= now) continue;
    const key = new Date(m.start_time).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(m);
  }

  const hasAny = inProgress.length > 0 || days.some(d => (byDay.get(d.toDateString()) ?? []).length > 0);

  if (!hasAny) {
    return <p className="text-[12px] text-neutral-400 text-center py-8">No meetings in the next 7 days</p>;
  }

  return (
    <div className="space-y-3">
      {inProgress.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-1 px-1">Now</p>
          {inProgress.map(m => (
            <MeetingCard
              key={m.id}
              event={m}
              userEmail={userEmail}
              botState={botStateMap.get(m.id) ?? m.attendee_bot_state ?? null}
              onScheduled={onScheduled}
              onCancelled={onCancelled}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
      {days.map((day, i) => {
        const dayMeetings = byDay.get(day.toDateString()) ?? [];
        if (dayMeetings.length === 0) return null;
        const isToday = day.toDateString() === todayStr;
        const isTomorrow = i === 1;
        const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return (
          <div key={day.toDateString()}>
            <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 px-1 ${isToday ? 'text-indigo-500' : 'text-neutral-400'}`}>
              {label}
            </p>
            {dayMeetings.map(m => (
              <MeetingCard
                key={m.id}
                event={m}
                userEmail={userEmail}
                botState={botStateMap.get(m.id) ?? m.attendee_bot_state ?? null}
                onScheduled={onScheduled}
                onCancelled={onCancelled}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function CalendarSidebar({
  meetings,
  userEmail,
  botStateMap,
  onScheduled,
  onCancelled,
  onRefresh,
  onNewMeeting,
}: CalendarSidebarProps) {
  const now = new Date();
  const todayStr = now.toDateString();
  const [selectedDateStr, setSelectedDateStr] = useState(todayStr);

  const completedToday = meetings.filter(m =>
    m.meeting_status === 'completed' &&
    new Date(m.end_time).toDateString() === todayStr
  );

  return (
    <div>
      <MonthCalendar
        meetings={meetings}
        userEmail={userEmail}
        selectedDateStr={selectedDateStr}
        onSelectDate={setSelectedDateStr}
        onNewMeeting={onNewMeeting}
        compact
      />
      <div className="border-t border-neutral-100 pt-3 mt-3">
        <RollingWeekView
          meetings={meetings}
          userEmail={userEmail}
          botStateMap={botStateMap}
          onScheduled={onScheduled}
          onCancelled={onCancelled}
          onRefresh={onRefresh}
          focusDateStr={selectedDateStr}
        />
        <CompletedTodaySection meetings={completedToday} />
      </div>
    </div>
  );
}
