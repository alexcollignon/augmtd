'use client';

import { useState } from 'react';
import Link from 'next/link';
import { VideoCameraIcon, MapPinIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import { formatMeetingTime, calculateDuration, isUserOrganizer } from '@/lib/types/meetings';
import MeetingDetailPanel from './meeting-detail-panel';

interface MeetingCardProps {
  event: CalendarEvent;
  userEmail: string;
  onRefresh?: () => void;
}

export default function MeetingCard({ event, userEmail, onRefresh }: MeetingCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);
  const isOrganizer = isUserOrganizer(event, userEmail);

  // Derive user's own RSVP status (match by self flag or email)
  const selfAttendee = event.attendees.find(
    (a) => a.self || a.email?.toLowerCase() === userEmail?.toLowerCase()
  );
  // Normalize Outlook raw values: 'none' → needsAction, 'tentativelyaccepted' → tentative
  const rawStatus: string = selfAttendee?.status ?? selfAttendee?.responseStatus ?? 'needsAction';
  const rsvpStatus: string = isOrganizer ? 'accepted'
    : rawStatus === 'none' ? 'needsAction'
    : rawStatus === 'tentativelyaccepted' ? 'tentative'
    : rawStatus;

  // Accent bar: meeting state takes priority, then RSVP status
  const accentColor =
    event.meeting_status === 'in_progress' ? 'bg-red-500' :
    event.meeting_status === 'starting_soon' ? 'bg-amber-400' :
    event.meeting_status === 'completed' ? 'bg-neutral-200' :
    rsvpStatus === 'declined' ? 'bg-neutral-300' :
    rsvpStatus === 'tentative' ? 'bg-amber-400' :
    rsvpStatus === 'needsAction' ? 'bg-yellow-400' :
    'bg-blue-400'; // accepted / organizer

  const cardOpacity = rsvpStatus === 'declined' ? 'opacity-60' : '';

  const handleJoinMeeting = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (event.meeting_link) {
      window.open(event.meeting_link, '_blank');
    }
  };

  const attendeesLabel = event.attendees.length === 0
    ? 'No attendees'
    : event.attendees.length === 1
    ? `1:1 · ${event.attendees[0].name || event.attendees[0].email}`
    : `${event.attendees.length} attendees`;

  // RSVP badge — shown when not organizer + not fully accepted
  const rsvpBadge =
    isOrganizer ? null :
    rsvpStatus === 'needsAction' ? { label: 'Respond', className: 'text-amber-700 bg-amber-50 border-amber-200' } :
    rsvpStatus === 'tentative' ? { label: 'Maybe', className: 'text-amber-700 bg-amber-50 border-amber-200' } :
    rsvpStatus === 'declined' ? { label: 'Declined', className: 'text-neutral-500 bg-neutral-100 border-neutral-200' } :
    null;

  return (
    <>
      <article
        onClick={() => setShowDetail(true)}
        className={`group relative bg-white border border-neutral-100 hover:bg-neutral-50 transition-colors cursor-pointer overflow-hidden mb-1.5 ${cardOpacity}`}
      >
        {/* Accent bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentColor}`} />

        <div className="pl-4 pr-3 py-2">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <h3 className="text-[12px] font-semibold text-neutral-900 leading-tight truncate group-hover:text-indigo-700 transition-colors">
              {event.title}
            </h3>
            {event.meeting_status === 'in_progress' && (
              <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 flex-shrink-0">
                Now
              </span>
            )}
          </div>

          {/* Time */}
          <p className="text-[11px] text-neutral-500 mb-1">
            {primary} · {duration}min
          </p>

          {/* Meta row — attendees + RSVP badge + join button + icons */}
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span className="truncate">{attendeesLabel}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
              {event.meeting_link && (event.meeting_status === 'starting_soon' || event.meeting_status === 'in_progress') ? (
                <button
                  onClick={handleJoinMeeting}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors ${
                    event.meeting_status === 'in_progress'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  <VideoCameraIcon className="w-2.5 h-2.5" />
                  {event.meeting_status === 'in_progress' ? 'Join' : 'Join'}
                </button>
              ) : (
                <>
                  {rsvpBadge && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 border ${rsvpBadge.className}`}>
                      {rsvpBadge.label}
                    </span>
                  )}
                  {isOrganizer && (
                    <span className="text-[10px] text-indigo-500 font-medium">Organizer</span>
                  )}
                  {event.meeting_link && <VideoCameraIcon className="w-3 h-3" />}
                  {event.location && !event.meeting_link && <MapPinIcon className="w-3 h-3" />}
                  {/* Link to meetings detail page — only when transcript exists */}
                  {event.has_transcript && (
                    <Link
                      href={`/meetings/${event.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-indigo-500 hover:underline font-medium"
                    >
                      View
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </article>

      {/* Detail Panel */}
      <MeetingDetailPanel
        event={event}
        userEmail={userEmail}
        isOpen={showDetail}
        onClose={() => setShowDetail(false)}
        onRefresh={onRefresh}
      />
    </>
  );
}
