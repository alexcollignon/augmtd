'use client';

import { useState } from 'react';
import { CalendarIcon, ChevronRightIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import MeetingCard from '@/components/meetings/meeting-card';

interface MeetingsColumnProps {
  isOpen: boolean;
  onToggle: () => void;
  meetings: CalendarEvent[];
  loading: boolean;
  userEmail: string;
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
    <div className="mb-3">
      <button
        onClick={canCollapse ? onToggle : undefined}
        disabled={!canCollapse}
        className={`w-full h-7 flex items-center justify-between px-1 mb-1 ${canCollapse ? 'cursor-pointer' : 'cursor-default'}`}
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

export default function MeetingsColumn({ isOpen, onToggle, meetings, loading, userEmail }: MeetingsColumnProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(['completed', 'tomorrow', 'this_week', 'next_week'])
  );

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
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

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
      return start > tomorrow && start < nextWeek && start.toDateString() !== tomorrow.toDateString();
    }),
    next_week: meetings.filter(m => {
      if (m.meeting_status !== 'upcoming') return false;
      const start = new Date(m.start_time);
      return start >= nextWeek && start < twoWeeksOut;
    }),
  };

  return (
    <div
      className={`flex-shrink-0 border-l border-neutral-200 flex flex-col bg-white transition-all duration-200 overflow-hidden ${
        isOpen ? 'w-[272px]' : 'w-9'
      }`}
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className={`flex-shrink-0 h-10 flex items-center border-b border-neutral-200 hover:bg-neutral-50 transition-colors ${
          isOpen ? 'justify-between px-4' : 'justify-center'
        }`}
        title={isOpen ? 'Hide calendar' : 'Show calendar'}
      >
        {isOpen ? (
          <>
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-neutral-500" />
              <span className="text-[13px] font-semibold text-neutral-700">Calendar</span>
            </div>
            <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-400" />
          </>
        ) : (
          <CalendarIcon className="w-4 h-4 text-neutral-400" />
        )}
      </button>

      {/* Content — only rendered when open */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto px-3 py-4">
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-3 bg-neutral-100 rounded w-1/2" />
              <div className="h-16 bg-neutral-100 rounded" />
              <div className="h-16 bg-neutral-100 rounded" />
            </div>
          ) : meetings.length === 0 ? (
            <p className="text-[12px] text-neutral-400 text-center py-8">No meetings scheduled</p>
          ) : (
            <div>
              {grouped.in_progress.length > 0 && (
                <MeetingSection title="HAPPENING NOW" count={grouped.in_progress.length} isCollapsed={false} onToggle={() => {}} canCollapse={false}>
                  {grouped.in_progress.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} />)}
                </MeetingSection>
              )}
              {grouped.starting_soon.length > 0 && (
                <MeetingSection title="STARTING SOON" count={grouped.starting_soon.length} isCollapsed={false} onToggle={() => {}} canCollapse={false}>
                  {grouped.starting_soon.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} />)}
                </MeetingSection>
              )}
              {grouped.today.length > 0 && (
                <MeetingSection title="TODAY" count={grouped.today.length} isCollapsed={collapsedSections.has('today')} onToggle={() => toggleSection('today')}>
                  {grouped.today.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} />)}
                </MeetingSection>
              )}
              {grouped.completed_recent.length > 0 && (
                <MeetingSection title="COMPLETED TODAY" count={grouped.completed_recent.length} isCollapsed={collapsedSections.has('completed')} onToggle={() => toggleSection('completed')}>
                  {grouped.completed_recent.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} />)}
                </MeetingSection>
              )}
              {grouped.tomorrow.length > 0 && (
                <MeetingSection title="TOMORROW" count={grouped.tomorrow.length} isCollapsed={collapsedSections.has('tomorrow')} onToggle={() => toggleSection('tomorrow')}>
                  {grouped.tomorrow.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} />)}
                </MeetingSection>
              )}
              {grouped.this_week.length > 0 && (
                <MeetingSection title="THIS WEEK" count={grouped.this_week.length} isCollapsed={collapsedSections.has('this_week')} onToggle={() => toggleSection('this_week')}>
                  {grouped.this_week.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} />)}
                </MeetingSection>
              )}
              {grouped.next_week.length > 0 && (
                <MeetingSection title="NEXT WEEK" count={grouped.next_week.length} isCollapsed={collapsedSections.has('next_week')} onToggle={() => toggleSection('next_week')}>
                  {grouped.next_week.map(m => <MeetingCard key={m.id} event={m} userEmail={userEmail} />)}
                </MeetingSection>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
