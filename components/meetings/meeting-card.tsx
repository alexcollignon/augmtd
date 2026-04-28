'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { VideoCameraIcon, MapPinIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import { formatMeetingTime, calculateDuration, isUserOrganizer } from '@/lib/types/meetings';
import MeetingDetailPanel from './meeting-detail-panel';
import NewMeetingModal from './new-meeting-modal';

interface MeetingCardProps {
  event: CalendarEvent;
  userEmail: string;
  onRefresh?: () => void;
}

export default function MeetingCard({ event, userEmail, onRefresh }: MeetingCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);
  const isOrganizer = isUserOrganizer(event, userEmail);

  const selfAttendee = event.attendees.find(
    (a) => a.self || a.email?.toLowerCase() === userEmail?.toLowerCase()
  );
  const rawStatus: string = selfAttendee?.status ?? selfAttendee?.responseStatus ?? 'needsAction';
  const rsvpStatus: string = isOrganizer ? 'accepted'
    : rawStatus === 'none' ? 'needsAction'
    : rawStatus === 'tentativelyaccepted' ? 'tentative'
    : rawStatus;

  const accentColor =
    event.meeting_status === 'in_progress' ? 'bg-red-500' :
    event.meeting_status === 'starting_soon' ? 'bg-amber-400' :
    event.meeting_status === 'completed' ? 'bg-neutral-200' :
    rsvpStatus === 'declined' ? 'bg-neutral-300' :
    rsvpStatus === 'tentative' ? 'bg-amber-400' :
    rsvpStatus === 'needsAction' ? 'bg-yellow-400' :
    'bg-blue-400';

  const cardOpacity = rsvpStatus === 'declined' ? 'opacity-60' : '';
  const isMeet = !!event.meeting_link?.includes('meet.google.com');
  const isUpcoming = event.meeting_status !== 'completed';

  const handleJoinMeeting = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (event.meeting_link) window.open(event.meeting_link, '_blank');
  };

  const attendeesLabel = event.attendees.length === 0
    ? 'No attendees'
    : event.attendees.length === 1
    ? `1:1 · ${event.attendees[0].name || event.attendees[0].email}`
    : `${event.attendees.length} attendees`;

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
        className={`group relative bg-white border border-neutral-100 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer overflow-hidden mb-1.5 ${cardOpacity}`}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg ${accentColor}`} />

        <div className="pl-4 pr-3 py-2">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <h3 className="text-[12px] font-semibold text-neutral-900 leading-tight truncate group-hover:text-indigo-700 transition-colors">
              {event.title}
            </h3>
            <div className="flex items-center gap-1 flex-shrink-0">
              {event.meeting_status === 'in_progress' && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Now</span>
              )}
              {isUpcoming && (
                deleteConfirm ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <span className="text-[10px] text-neutral-400">Delete?</span>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setIsDeleting(true);
                        try {
                          const res = await fetch(`/api/meetings/${event.id}`, { method: 'DELETE' });
                          if (res.ok) { onRefresh?.(); }
                          else { toast.error('Failed to delete'); setDeleteConfirm(false); }
                        } catch { toast.error('Failed to delete'); setDeleteConfirm(false); }
                        finally { setIsDeleting(false); }
                      }}
                      disabled={isDeleting}
                      className="text-[10px] font-semibold text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      {isDeleting ? '…' : 'Yes'}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(false); }} className="text-[10px] text-neutral-400 hover:text-neutral-600">No</button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowEdit(true); }}
                      title="Edit meeting"
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-neutral-300 hover:text-indigo-500 transition-all"
                    >
                      <PencilSquareIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(true); }}
                      title="Delete meeting"
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-neutral-300 hover:text-red-500 transition-all"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </>
                )
              )}
            </div>
          </div>

          {/* Time */}
          <p className="text-[11px] text-neutral-500 mb-1">
            {primary} · {duration}min
          </p>

          {/* Meta row */}
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span className="truncate">{attendeesLabel}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
              {event.meeting_link && (event.meeting_status === 'starting_soon' || event.meeting_status === 'in_progress') ? (
                <button
                  onClick={handleJoinMeeting}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-white rounded-full transition-colors ${
                    event.meeting_status === 'in_progress' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  <VideoCameraIcon className="w-2.5 h-2.5" />
                  Join
                </button>
              ) : (
                <>
                  {rsvpBadge && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 border rounded-full ${rsvpBadge.className}`}>
                      {rsvpBadge.label}
                    </span>
                  )}
                  {isOrganizer && <span className="text-[10px] text-indigo-500 font-medium">Organizer</span>}
                  {event.meeting_link && <VideoCameraIcon className="w-3 h-3" />}
                  {event.location && !event.meeting_link && <MapPinIcon className="w-3 h-3" />}
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

      <MeetingDetailPanel
        event={event}
        userEmail={userEmail}
        isOpen={showDetail}
        onClose={() => setShowDetail(false)}
        onRefresh={onRefresh}
        onEdit={isUpcoming ? () => { setShowDetail(false); setShowEdit(true); } : undefined}
        onDelete={isUpcoming ? () => { setShowDetail(false); onRefresh?.(); } : undefined}
      />

      {showEdit && (
        <NewMeetingModal
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
          onSuccess={() => { setShowEdit(false); onRefresh?.(); }}
          event={event}
        />
      )}
    </>
  );
}
