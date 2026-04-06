'use client';

import { useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import { useRecording } from '@/hooks/useRecording';
import MeetingCard from './meeting-card';
import CaptureModal from './capture-modal';

interface MeetingsSidebarProps {
  userId: string;
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function MeetingsSidebar({ userId, userEmail, isOpen, onClose }: MeetingsSidebarProps) {
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['tomorrow', 'this_week']));
  const [showCapture, setShowCapture] = useState(false);
  const sidebarRecording = useRecording();

  // Fetch meetings from calendar_events
  useEffect(() => {
    const fetchMeetings = async () => {
      try {
        const response = await fetch('/api/meetings');
        if (response.ok) {
          const data = await response.json();
          setMeetings(data.meetings || []);
        }
      } catch (error) {
        console.error('Error fetching meetings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMeetings();

    // Poll for updates every 60 seconds (reduced from 30s to minimize load during sync)
    const interval = setInterval(fetchMeetings, 60000);
    return () => clearInterval(interval);
  }, [userId]);

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Group meetings by status/time
  const groupedMeetings = {
    in_progress: meetings.filter(m => m.meeting_status === 'in_progress'),
    starting_soon: meetings.filter(m => m.meeting_status === 'starting_soon'),
    today: meetings.filter(m => {
      if (m.meeting_status === 'in_progress' || m.meeting_status === 'starting_soon') return false;
      const start = new Date(m.start_time);
      const now = new Date();
      return start.toDateString() === now.toDateString();
    }),
    completed_recent: meetings.filter(m => {
      if (m.meeting_status !== 'completed') return false;
      const end = new Date(m.end_time);
      const now = new Date();
      const hoursAgo = (now.getTime() - end.getTime()) / (1000 * 60 * 60);
      return hoursAgo <= 24; // Show completed meetings from last 24 hours
    }),
    tomorrow: meetings.filter(m => {
      if (m.meeting_status !== 'upcoming') return false;
      const start = new Date(m.start_time);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return start.toDateString() === tomorrow.toDateString();
    }),
    this_week: meetings.filter(m => {
      if (m.meeting_status !== 'upcoming') return false;
      const start = new Date(m.start_time);
      const now = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      return start > tomorrow && start < nextWeek && start.toDateString() !== tomorrow.toDateString();
    }),
  };

  const totalMeetings = meetings.length;

  return (
    <div
      className={`
        fixed right-0 top-0 h-full w-[320px] bg-white border-l border-neutral-200 shadow-2xl
        flex flex-col z-50 transition-transform duration-300 ease-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}
    >
      {/* Header */}
      <div className="border-b border-neutral-200 bg-white px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900">Meetings</h2>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            {loading ? 'Loading...' : `${totalMeetings} ${totalMeetings === 1 ? 'meeting' : 'meetings'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCapture(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <MicrophoneIcon className="w-3 h-3" />
            Record
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-neutral-100 rounded transition-colors"
            aria-label="Close meetings panel"
          >
            <XMarkIcon className="w-5 h-5 text-neutral-500" />
          </button>
        </div>
      </div>

      <CaptureModal isOpen={showCapture} onClose={() => setShowCapture(false)} recording={sidebarRecording} />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 bg-neutral-50/30">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-neutral-200 rounded w-1/2"></div>
            <div className="space-y-3">
              <div className="h-20 bg-neutral-200 rounded"></div>
              <div className="h-20 bg-neutral-200 rounded"></div>
              <div className="h-20 bg-neutral-200 rounded"></div>
            </div>
          </div>
        ) : totalMeetings === 0 ? (
          <div className="text-center py-12">
            <p className="text-[14px] text-neutral-500">No meetings scheduled</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Happening Now */}
            {groupedMeetings.in_progress.length > 0 && (
              <MeetingSection
                title="HAPPENING NOW"
                count={groupedMeetings.in_progress.length}
                isCollapsed={false}
                onToggle={() => {}}
                canCollapse={false}
              >
                {groupedMeetings.in_progress.map(meeting => (
                  <MeetingCard
                    key={meeting.id}
                    event={meeting}
                    userEmail={userEmail}
                  />
                ))}
              </MeetingSection>
            )}

            {/* Starting Soon */}
            {groupedMeetings.starting_soon.length > 0 && (
              <MeetingSection
                title="STARTING SOON"
                count={groupedMeetings.starting_soon.length}
                isCollapsed={false}
                onToggle={() => {}}
                canCollapse={false}
              >
                {groupedMeetings.starting_soon.map(meeting => (
                  <MeetingCard
                    key={meeting.id}
                    event={meeting}
                    userEmail={userEmail}
                  />
                ))}
              </MeetingSection>
            )}

            {/* Today */}
            {groupedMeetings.today.length > 0 && (
              <MeetingSection
                title="TODAY"
                count={groupedMeetings.today.length}
                isCollapsed={collapsedSections.has('today')}
                onToggle={() => toggleSection('today')}
              >
                {groupedMeetings.today.map(meeting => (
                  <MeetingCard
                    key={meeting.id}
                    event={meeting}
                    userEmail={userEmail}
                  />
                ))}
              </MeetingSection>
            )}

            {/* Completed (Recent) */}
            {groupedMeetings.completed_recent.length > 0 && (
              <MeetingSection
                title="COMPLETED"
                count={groupedMeetings.completed_recent.length}
                isCollapsed={collapsedSections.has('completed')}
                onToggle={() => toggleSection('completed')}
              >
                {groupedMeetings.completed_recent.map(meeting => (
                  <MeetingCard
                    key={meeting.id}
                    event={meeting}
                    userEmail={userEmail}
                  />
                ))}
              </MeetingSection>
            )}

            {/* Tomorrow */}
            {groupedMeetings.tomorrow.length > 0 && (
              <MeetingSection
                title="TOMORROW"
                count={groupedMeetings.tomorrow.length}
                isCollapsed={collapsedSections.has('tomorrow')}
                onToggle={() => toggleSection('tomorrow')}
              >
                {groupedMeetings.tomorrow.map(meeting => (
                  <MeetingCard
                    key={meeting.id}
                    event={meeting}
                    userEmail={userEmail}
                  />
                ))}
              </MeetingSection>
            )}

            {/* This Week */}
            {groupedMeetings.this_week.length > 0 && (
              <MeetingSection
                title="THIS WEEK"
                count={groupedMeetings.this_week.length}
                isCollapsed={collapsedSections.has('this_week')}
                onToggle={() => toggleSection('this_week')}
              >
                {groupedMeetings.this_week.map(meeting => (
                  <MeetingCard
                    key={meeting.id}
                    event={meeting}
                    userEmail={userEmail}
                  />
                ))}
              </MeetingSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Section component for collapsible groups
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
    <div>
      <button
        onClick={canCollapse ? onToggle : undefined}
        disabled={!canCollapse}
        className={`
          w-full flex items-center justify-between mb-2
          ${canCollapse ? 'cursor-pointer hover:text-neutral-900' : 'cursor-default'}
          transition-colors
        `}
      >
        <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
          {title} ({count})
        </h3>
        {canCollapse && (
          isCollapsed ? (
            <ChevronDownIcon className="w-3.5 h-3.5 text-neutral-400" />
          ) : (
            <ChevronUpIcon className="w-3.5 h-3.5 text-neutral-400" />
          )
        )}
      </button>

      {!isCollapsed && (
        <div className="space-y-0">
          {children}
        </div>
      )}
    </div>
  );
}
