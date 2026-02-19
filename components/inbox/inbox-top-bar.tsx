'use client';

import { useState, useEffect, useRef } from 'react';
import { CalendarIcon, SparklesIcon } from '@heroicons/react/24/outline';
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
      if (indexRef.current >= text.length) {
        clearInterval(id);
        setDone(true);
      }
    }, 38);
    return () => clearInterval(id);
  }, [text]);

  return (
    <span>
      {displayed}
      {!done && (
        <span className="inline-block w-[2px] h-[15px] bg-neutral-800 ml-0.5 align-middle animate-pulse" />
      )}
    </span>
  );
}

function Divider() {
  return <div className="h-4 w-px bg-neutral-200 flex-shrink-0 mx-1" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest whitespace-nowrap flex-shrink-0">
      {children}
    </span>
  );
}

export default function InboxTopBar({ preparedItems, meetings, meetingAssistantItems, onSelectItem, firstName }: InboxTopBarProps) {
  const now = new Date();

  const todayStr = now.toDateString();
  const todayMeetings = meetings.filter(m => new Date(m.start_time).toDateString() === todayStr);

  let displayMeetings: CalendarEvent[];
  let meetingLabel: string;

  if (todayMeetings.length > 0) {
    displayMeetings = todayMeetings;
    meetingLabel = 'Today';
  } else {
    const upcoming = meetings
      .filter(m => m.meeting_status === 'upcoming' && new Date(m.start_time) > now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    if (upcoming.length > 0) {
      const nextDateStr = new Date(upcoming[0].start_time).toDateString();
      displayMeetings = upcoming.filter(m => new Date(m.start_time).toDateString() === nextDateStr);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      meetingLabel = nextDateStr === tomorrow.toDateString()
        ? 'Tomorrow'
        : new Date(upcoming[0].start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } else {
      displayMeetings = [];
      meetingLabel = 'Meetings';
    }
  }

  const todos = meetingAssistantItems.filter(i => !i.source_data?.category || i.source_data.category === 'todo');
  const waitingFor = meetingAssistantItems.filter(i => i.source_data?.category === 'waiting_for');
  const projects = meetingAssistantItems.filter(i => i.source_data?.category === 'project');
  const hasMeetingAssistant = meetingAssistantItems.length > 0;

  return (
    <div className="flex-shrink-0 border-b border-neutral-200 bg-white">

      {/* Welcome */}
      <div className="px-6 pt-4 pb-3">
        <p className="text-[16px] font-semibold text-neutral-900 tracking-tight leading-none">
          <TypewriterText text={getGreeting(firstName)} />
        </p>
      </div>

      {/* Smart strip */}
      <div className="flex items-center gap-2.5 px-6 pb-3 overflow-x-auto">

        {/* Tasks */}
        {preparedItems.length > 0 && (
          <>
            <SectionLabel>Tasks</SectionLabel>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {preparedItems.slice(0, 4).map(item => (
                <button
                  key={item.id}
                  onClick={() => onSelectItem(item)}
                  className="inline-flex items-center px-2.5 py-1 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-colors text-[12px] text-indigo-800 font-medium whitespace-nowrap truncate max-w-[180px]"
                >
                  {item.work_title || 'Untitled'}
                </button>
              ))}
              {preparedItems.length > 4 && (
                <span className="text-[11px] text-neutral-400 flex-shrink-0">+{preparedItems.length - 4}</span>
              )}
            </div>
            <Divider />
          </>
        )}

        {/* Meetings */}
        <SectionLabel>{meetingLabel}</SectionLabel>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {displayMeetings.length === 0 ? (
            <span className="text-[12px] text-neutral-400">None</span>
          ) : (
            <>
              {displayMeetings.slice(0, 4).map(meeting => {
                const start = new Date(meeting.start_time);
                const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                const isNow = meeting.meeting_status === 'in_progress';
                const isSoon = meeting.meeting_status === 'starting_soon';
                return (
                  <div
                    key={meeting.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 border text-[12px] font-medium whitespace-nowrap flex-shrink-0 ${
                      isNow ? 'bg-red-50 border-red-200 text-red-800'
                        : isSoon ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-700'
                    }`}
                  >
                    <CalendarIcon className="w-3 h-3 flex-shrink-0 opacity-50" />
                    <span className="opacity-60 text-[11px]">{timeStr}</span>
                    <span className="truncate max-w-[140px]">{meeting.title}</span>
                  </div>
                );
              })}
              {displayMeetings.length > 4 && (
                <span className="text-[11px] text-neutral-400 flex-shrink-0">+{displayMeetings.length - 4}</span>
              )}
            </>
          )}
        </div>

        {/* Meeting Assistant — only shown when populated */}
        {hasMeetingAssistant && (
          <>
            <Divider />
            <SparklesIcon className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />

            {todos.length > 0 && (
              <>
                <SectionLabel>Todos</SectionLabel>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {todos.slice(0, 3).map(item => (
                    <button
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      className="inline-flex items-center px-2.5 py-1 bg-violet-50 border border-violet-100 hover:bg-violet-100 hover:border-violet-200 transition-colors text-[12px] text-violet-800 font-medium whitespace-nowrap truncate max-w-[160px]"
                    >
                      {item.work_title || 'Untitled'}
                    </button>
                  ))}
                  {todos.length > 3 && <span className="text-[11px] text-neutral-400 flex-shrink-0">+{todos.length - 3}</span>}
                </div>
              </>
            )}

            {waitingFor.length > 0 && (
              <>
                {todos.length > 0 && <Divider />}
                <SectionLabel>Waiting</SectionLabel>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {waitingFor.slice(0, 2).map(item => (
                    <button
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      className="inline-flex items-center px-2.5 py-1 bg-amber-50 border border-amber-100 hover:bg-amber-100 transition-colors text-[12px] text-amber-800 font-medium whitespace-nowrap truncate max-w-[160px]"
                    >
                      {item.work_title || 'Untitled'}
                    </button>
                  ))}
                  {waitingFor.length > 2 && <span className="text-[11px] text-neutral-400 flex-shrink-0">+{waitingFor.length - 2}</span>}
                </div>
              </>
            )}

            {projects.length > 0 && (
              <>
                {(todos.length > 0 || waitingFor.length > 0) && <Divider />}
                <SectionLabel>Projects</SectionLabel>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {projects.slice(0, 2).map(item => (
                    <button
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      className="inline-flex items-center px-2.5 py-1 bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-colors text-[12px] text-emerald-800 font-medium whitespace-nowrap truncate max-w-[160px]"
                    >
                      {item.work_title || 'Untitled'}
                    </button>
                  ))}
                  {projects.length > 2 && <span className="text-[11px] text-neutral-400 flex-shrink-0">+{projects.length - 2}</span>}
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
