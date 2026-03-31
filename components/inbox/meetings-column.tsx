'use client';

import { useState } from 'react';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import CalendarSidebar from '@/components/meetings/calendar-sidebar';
import WeekCalendar from '@/components/meetings/week-calendar';
import NewMeetingModal from '@/components/meetings/new-meeting-modal';

interface MeetingsColumnProps {
  isOpen: boolean;
  onToggle: () => void;
  meetings: CalendarEvent[];
  loading: boolean;
  userEmail: string;
  onRefresh?: () => void;
}

export default function MeetingsColumn({ isOpen, onToggle, meetings, loading, userEmail, onRefresh }: MeetingsColumnProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [initialDate, setInitialDate] = useState<Date | undefined>(undefined);
  const [botStateMap, setBotStateMap] = useState<Map<string, string>>(new Map());
  const [calendarView, setCalendarView] = useState<'month' | 'week'>('month');
  const [weekClosing, setWeekClosing] = useState(false);

  const handleScheduled = (eventId: string) => setBotStateMap(prev => new Map(prev).set(eventId, 'scheduled'));
  const handleCancelled = (eventId: string) => setBotStateMap(prev => new Map(prev).set(eventId, 'cancelled'));

  const closeWeekView = () => {
    setWeekClosing(true);
    setTimeout(() => { setCalendarView('month'); setWeekClosing(false); }, 200);
  };

  return (
    <>
    {/* Week view overlay — only the week grid, positioned left of the existing sidebar */}
    {isOpen && (calendarView === 'week' || weekClosing) && (
      <div
        className={`fixed top-0 bottom-0 z-40 overflow-hidden bg-white border-l border-neutral-200 flex flex-col ${weekClosing ? 'week-collapse-exit' : 'week-expand-enter'}`}
        style={{ right: '316px', width: '680px', boxShadow: '-8px 0 24px rgba(0,0,0,0.10)' }}
      >
        <div className="flex-shrink-0 h-10 flex items-center justify-between px-3 border-b border-neutral-200">
          <button
            onClick={closeWeekView}
            className="flex items-center gap-1.5 text-[13px] text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            <span className="font-medium">Back</span>
          </button>
          <span className="text-[13px] font-semibold text-neutral-700">Calendar</span>
          <div className="w-6" />
        </div>
        <div className="flex-1 min-h-0">
          <WeekCalendar
            meetings={meetings}
            userEmail={userEmail}
            botStateMap={botStateMap}
            onScheduled={handleScheduled}
            onCancelled={handleCancelled}
            onRefresh={onRefresh}
            onNewMeeting={(date) => { setInitialDate(date); setShowNewForm(true); }}
          />
        </div>
      </div>
    )}

    <div
      className={`flex-shrink-0 flex flex-col bg-white transition-all duration-300 overflow-hidden ${
        isOpen ? 'w-[300px]' : 'w-9'
      }`}
    >
      {/* Header */}
      <div
        className={`flex-shrink-0 h-10 flex items-center border-b border-neutral-200 ${
          isOpen ? 'justify-between px-3' : 'justify-center'
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
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setInitialDate(undefined); setShowNewForm(true); }}
                title="New meeting"
                className="p-1 text-indigo-400 hover:text-indigo-600 transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
              {/* Month / Week toggle */}
              <div className="relative grid grid-cols-2 bg-neutral-100 rounded-full p-0.5">
                <div
                  className="absolute inset-y-0.5 w-[calc(50%-2px)] rounded-full bg-white shadow-sm pointer-events-none"
                  style={{
                    left: calendarView === 'week' && !weekClosing ? '50%' : '2px',
                    transition: 'left 180ms ease-in-out',
                  }}
                />
                <button
                  onClick={() => calendarView === 'week' && closeWeekView()}
                  className={`relative z-10 px-2.5 py-0.5 text-[11px] font-medium rounded-full text-center transition-colors duration-180 ${calendarView === 'month' && !weekClosing ? 'text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'}`}
                >
                  Month
                </button>
                <button
                  onClick={() => setCalendarView('week')}
                  className={`relative z-10 px-2.5 py-0.5 text-[11px] font-medium rounded-full text-center transition-colors duration-180 ${calendarView === 'week' && !weekClosing ? 'text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'}`}
                >
                  Week
                </button>
              </div>
              <button onClick={onToggle} title="Hide calendar" className="p-0.5 hover:opacity-70 transition-opacity">
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

      <NewMeetingModal
        isOpen={showNewForm}
        onClose={() => setShowNewForm(false)}
        onSuccess={() => onRefresh?.()}
        initialDate={initialDate}
      />

      {/* Content */}
      {isOpen && (
        loading ? (
          <div className="flex-1 px-3 py-2 animate-pulse space-y-3">
            <div className="h-3 bg-neutral-100 rounded w-1/2" />
            <div className="h-16 bg-neutral-100 rounded" />
            <div className="h-16 bg-neutral-100 rounded" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <CalendarSidebar
              meetings={meetings}
              userEmail={userEmail}
              botStateMap={botStateMap}
              onScheduled={handleScheduled}
              onCancelled={handleCancelled}
              onRefresh={onRefresh}
              onNewMeeting={(date) => { setInitialDate(date); setShowNewForm(true); }}
            />
          </div>
        )
      )}
    </div>
    </>
  );
}
