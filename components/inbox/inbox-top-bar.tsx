'use client';

import { CalendarIcon } from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import type { CalendarEvent } from '@/lib/types/meetings';

interface InboxTopBarProps {
  preparedItems: InboxItem[];
  meetings: CalendarEvent[];
  onSelectItem: (item: InboxItem) => void;
}

export default function InboxTopBar({ preparedItems, meetings, onSelectItem }: InboxTopBarProps) {
  const now = new Date();

  // Meetings to display: today first, otherwise next upcoming day
  const todayStr = now.toDateString();
  const todayMeetings = meetings.filter(m =>
    new Date(m.start_time).toDateString() === todayStr
  );

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

  const hasPrepared = preparedItems.length > 0;

  return (
    <div className="flex-shrink-0 border-b border-neutral-200 bg-white px-4 py-2 flex items-center gap-4 overflow-x-auto min-h-[42px]">
      {/* Priority */}
      {hasPrepared && (
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest whitespace-nowrap">
            Priority
          </span>
          <div className="flex items-center gap-1.5">
            {preparedItems.slice(0, 5).map(item => (
              <button
                key={item.id}
                onClick={() => onSelectItem(item)}
                className="inline-flex items-center px-2.5 py-0.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-colors text-[12px] text-indigo-800 font-medium whitespace-nowrap truncate max-w-[180px]"
              >
                {item.work_title || 'Untitled'}
              </button>
            ))}
            {preparedItems.length > 5 && (
              <span className="text-[11px] text-neutral-400">+{preparedItems.length - 5} more</span>
            )}
          </div>
        </div>
      )}

      {hasPrepared && (
        <div className="h-4 w-px bg-neutral-200 flex-shrink-0" />
      )}

      {/* Meetings — always visible */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest whitespace-nowrap">
          {meetingLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {displayMeetings.length === 0 ? (
            <span className="text-[12px] text-neutral-400">No upcoming meetings</span>
          ) : (
            <>
              {displayMeetings.slice(0, 5).map(meeting => {
                const start = new Date(meeting.start_time);
                const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                const isNow = meeting.meeting_status === 'in_progress';
                const isSoon = meeting.meeting_status === 'starting_soon';
                return (
                  <div
                    key={meeting.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 border text-[12px] font-medium whitespace-nowrap ${
                      isNow
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : isSoon
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-neutral-50 border-neutral-100 text-neutral-700'
                    }`}
                  >
                    <CalendarIcon className="w-3 h-3 flex-shrink-0 opacity-60" />
                    <span className="opacity-60">{timeStr}</span>
                    <span className="truncate max-w-[140px]">{meeting.title}</span>
                  </div>
                );
              })}
              {displayMeetings.length > 5 && (
                <span className="text-[11px] text-neutral-400">+{displayMeetings.length - 5}</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
