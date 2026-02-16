'use client';

import { useState } from 'react';
import {
  CalendarIcon,
  VideoCameraIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import {
  formatMeetingTime,
  calculateDuration,
  getVIPAttendees,
  isUserOrganizer,
} from '@/lib/types/meetings';
import MeetingDetailPanel from './meeting-detail-panel';

interface MeetingCardProps {
  event: CalendarEvent;
  userEmail: string;
}

export default function MeetingCard({ event, userEmail }: MeetingCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  const { primary, secondary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);
  const vipAttendees = getVIPAttendees(event.attendees);
  const isOrganizer = isUserOrganizer(event, userEmail);

  // Status-based styling
  const getStatusStyle = () => {
    switch (event.meeting_status) {
      case 'in_progress':
        return {
          borderColor: 'border-red-200',
          hoverBorder: 'hover:border-red-300',
          accentColor: 'bg-red-500',
          badge: 'Happening now',
          badgeColor: 'bg-red-100 text-red-700',
        };
      case 'starting_soon':
        return {
          borderColor: 'border-amber-200',
          hoverBorder: 'hover:border-amber-300',
          accentColor: 'bg-amber-500',
          badge: null,
          badgeColor: '',
        };
      case 'completed':
        return {
          borderColor: 'border-neutral-200',
          hoverBorder: 'hover:border-neutral-300',
          accentColor: 'bg-neutral-400',
          badge: 'Completed',
          badgeColor: 'bg-neutral-100 text-neutral-600',
        };
      default:
        return {
          borderColor: 'border-blue-100',
          hoverBorder: 'hover:border-blue-200',
          accentColor: 'bg-blue-500',
          badge: null,
          badgeColor: '',
        };
    }
  };

  const style = getStatusStyle();

  const handleJoinMeeting = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (event.meeting_link) {
      window.open(event.meeting_link, '_blank');
    }
  };

  const handleGenerateFollowUp = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Implement follow-up generation
    console.log('Generate follow-up for meeting:', event.id);
  };

  return (
    <>
      <article
        onClick={() => setShowDetail(true)}
        className={`
          group relative bg-white
          border ${style.borderColor} ${style.hoverBorder}
          hover:shadow-md
          transition-all duration-150 cursor-pointer
          overflow-hidden
          mb-2
        `}
      >
        {/* Accent bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${style.accentColor}`} />

        {/* Main content */}
        <div className="relative pl-4 pr-3 py-2.5">
          {/* Header with icon and status badge */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <CalendarIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
              <h3 className="text-[13px] font-semibold text-neutral-900 leading-tight truncate group-hover:text-blue-700 transition-colors">
                {event.title}
              </h3>
            </div>

            {style.badge && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style.badgeColor} whitespace-nowrap`}>
                {style.badge}
              </span>
            )}
          </div>

          {/* Time - Primary (bold) */}
          <div className="text-[13px] font-medium text-neutral-900 mb-0.5">
            {primary}
          </div>

          {/* Time - Secondary (subtle) */}
          <div className="text-[11px] text-neutral-500 mb-2">
            {secondary} · {duration}min
          </div>

          {/* Attendees summary */}
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-600 mb-2">
            <span className="truncate">
              {event.attendees.length === 0 ? (
                'No attendees'
              ) : event.attendees.length === 1 ? (
                `1:1 with ${event.attendees[0].name || event.attendees[0].email}`
              ) : (
                <>
                  {event.attendees.length} attendees
                  {vipAttendees.length > 0 && (
                    <span className="text-violet-600 font-medium ml-1">
                      ({vipAttendees.length} VIP)
                    </span>
                  )}
                </>
              )}
            </span>

            {isOrganizer && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium whitespace-nowrap">
                Organizer
              </span>
            )}
          </div>

          {/* Location/Link indicators */}
          {(event.meeting_link || event.location) && (
            <div className="flex items-center gap-2 text-[10px] text-neutral-500">
              {event.meeting_link && (
                <div className="flex items-center gap-1">
                  <VideoCameraIcon className="w-3 h-3" />
                  <span>Video call</span>
                </div>
              )}
              {event.location && (
                <div className="flex items-center gap-1">
                  <MapPinIcon className="w-3 h-3" />
                  <span className="truncate max-w-[120px]">{event.location}</span>
                </div>
              )}
            </div>
          )}

          {/* Action buttons for different states */}
          {event.meeting_link && event.meeting_status === 'starting_soon' && (
            <button
              onClick={handleJoinMeeting}
              className="
                mt-2 w-full
                inline-flex items-center justify-center gap-1.5
                px-3 py-1.5 rounded-md text-[12px] font-semibold
                bg-blue-600 text-white
                hover:bg-blue-700
                transition-colors
              "
            >
              <VideoCameraIcon className="w-3.5 h-3.5" />
              Join Meeting
            </button>
          )}

          {event.meeting_link && event.meeting_status === 'in_progress' && (
            <button
              onClick={handleJoinMeeting}
              className="
                mt-2 w-full
                inline-flex items-center justify-center gap-1.5
                px-3 py-1.5 rounded-md text-[12px] font-semibold
                bg-red-600 text-white
                hover:bg-red-700
                transition-colors
                animate-pulse
              "
            >
              <VideoCameraIcon className="w-3.5 h-3.5" />
              Join Now
            </button>
          )}

          {event.meeting_status === 'completed' && !event.meeting_metadata.follow_up_generated && (
            <button
              onClick={handleGenerateFollowUp}
              className="
                mt-2 w-full
                px-3 py-1.5 rounded-md text-[11px] font-medium
                text-neutral-700 hover:bg-neutral-100
                border border-neutral-200
                transition-colors
              "
            >
              Generate follow-up →
            </button>
          )}
        </div>
      </article>

      {/* Detail Panel */}
      <MeetingDetailPanel
        event={event}
        userEmail={userEmail}
        isOpen={showDetail}
        onClose={() => setShowDetail(false)}
      />
    </>
  );
}
