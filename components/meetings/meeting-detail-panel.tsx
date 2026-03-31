'use client';

import { Fragment, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  VideoCameraIcon,
  UserGroupIcon,
  DocumentTextIcon,
  MicrophoneIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import {
  formatMeetingTime,
  calculateDuration,
  getVIPAttendees,
  isUserOrganizer,
} from '@/lib/types/meetings';
import { createClient } from '@/lib/supabase/client';
import RsvpButtons from '@/components/inbox/rsvp-buttons';
import MeetingRecorder from '@/components/meetings/meeting-recorder';


interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

interface MeetingTranscript {
  id: string;
  title: string;
  transcript_segments: TranscriptSegment[];
  duration_minutes: number;
  work_items_generated: number;
}

interface MeetingDetailPanelProps {
  event: CalendarEvent;
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  botState?: string | null;
  onScheduled?: (eventId: string) => void;
  onCancelled?: (eventId: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export default function MeetingDetailPanel({
  event,
  userEmail,
  isOpen,
  onClose,
  onRefresh,
  botState: botStateProp,
  onScheduled,
  onCancelled,
  onEdit,
  onDelete,
}: MeetingDetailPanelProps) {
  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);
  const vipAttendees = getVIPAttendees(event.attendees);
  const isOrganizer = isUserOrganizer(event, userEmail);
  const botState = botStateProp ?? event.attendee_bot_state ?? null;
  const isMeet = !!event.meeting_link?.includes('meet.google.com');
  const isUpcoming = event.meeting_status !== 'completed';
  const [schedulingBot, setSchedulingBot] = useState(false);
  const [cancellingBot, setCancellingBot] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Transcript state
  const [transcript, setTranscript] = useState<MeetingTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptKey, setTranscriptKey] = useState(0); // bump to refetch

  // Fetch transcript for completed meetings (or after recording submitted)
  useEffect(() => {
    if (!isOpen || (event.meeting_status !== 'completed' && transcriptKey === 0)) {
      setTranscript(null);
      return;
    }

    const fetchTranscript = async () => {
      setTranscriptLoading(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('meeting_transcripts')
          .select('id, title, transcript_segments, duration_minutes, work_items_generated')
          .eq('calendar_event_id', event.id)
          .maybeSingle(); // Use maybeSingle() instead of single() to handle no results gracefully

        if (error) {
          console.error('Failed to fetch transcript:', error);
          setTranscript(null);
        } else {
          setTranscript(data); // Will be null if no transcript exists yet
        }
      } catch (err) {
        console.error('Error fetching transcript:', err);
        setTranscript(null);
      } finally {
        setTranscriptLoading(false);
      }
    };

    fetchTranscript();
  }, [isOpen, event.id, event.meeting_status, transcriptKey]);

  const handleJoinMeeting = () => {
    if (event.meeting_link) {
      window.open(event.meeting_link, '_blank');
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-in-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in-out duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-neutral-900/25 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        {/* Panel */}
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-200"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-md">
                  <div className="flex h-full flex-col overflow-y-scroll bg-white shadow-xl">
                    {/* Header - Fixed */}
                    <div className="border-b border-neutral-200 bg-white px-6 py-5">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-5 h-5 text-blue-600" />
                          <Dialog.Title className="text-base font-semibold text-neutral-900">
                            Meeting Details
                          </Dialog.Title>
                        </div>
                        <div className="flex items-center gap-2">
                          {onEdit && (
                            <button
                              type="button"
                              onClick={onEdit}
                              title="Edit meeting"
                              className="p-1.5 text-neutral-400 hover:text-indigo-600 transition-colors"
                            >
                              <PencilSquareIcon className="w-4 h-4" />
                            </button>
                          )}
                          {onDelete && (
                            deleteConfirm ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-neutral-500">Delete?</span>
                                <button
                                  onClick={async () => {
                                    setIsDeleting(true);
                                    try {
                                      const res = await fetch(`/api/meetings/${event.id}`, { method: 'DELETE' });
                                      if (res.ok) { onDelete(); }
                                      else { toast.error('Failed to delete meeting'); setDeleteConfirm(false); }
                                    } catch { toast.error('Failed to delete meeting'); setDeleteConfirm(false); }
                                    finally { setIsDeleting(false); }
                                  }}
                                  disabled={isDeleting}
                                  className="text-[11px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                                >
                                  {isDeleting ? 'Deleting…' : 'Yes'}
                                </button>
                                <button onClick={() => setDeleteConfirm(false)} className="text-[11px] text-neutral-400 hover:text-neutral-600">No</button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm(true)}
                                title="Delete meeting"
                                className="p-1.5 text-neutral-400 hover:text-red-500 transition-colors"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            className="rounded-md text-neutral-400 hover:text-neutral-600 transition-colors"
                            onClick={onClose}
                          >
                            <XMarkIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </div>

                      {/* Meeting title */}
                      <h2 className="mt-4 text-lg font-semibold text-neutral-900 leading-tight">
                        {event.title}
                      </h2>

                      {/* Time */}
                      <div className="mt-2 flex items-center gap-2 text-sm text-neutral-600">
                        <ClockIcon className="w-4 h-4" />
                        <span>{primary} · {duration}min</span>
                      </div>
                    </div>

                    {/* Content - Scrollable */}
                    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                      {/* Location */}
                      {event.location && (
                        <div>
                          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">
                            <MapPinIcon className="w-4 h-4" />
                            Location
                          </div>
                          <p className="text-sm text-neutral-900">{event.location}</p>
                        </div>
                      )}

                      {/* Meeting Link */}
                      {event.meeting_link && (
                        <div>
                          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">
                            <VideoCameraIcon className="w-4 h-4" />
                            Video Conference
                          </div>
                          <button
                            onClick={handleJoinMeeting}
                            className="
                              inline-flex items-center gap-2
                              px-4 py-2 rounded-md text-sm font-medium
                              bg-blue-600 text-white
                              hover:bg-blue-700
                              transition-colors
                            "
                          >
                            <VideoCameraIcon className="w-4 h-4" />
                            Join Meeting
                          </button>
                        </div>
                      )}

                      {/* Attendees */}
                      <div>
                        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">
                          <UserGroupIcon className="w-4 h-4" />
                          Attendees ({event.attendees.length})
                        </div>
                        <div className="space-y-2">
                          {event.organizer && (
                            <div className="flex items-center justify-between text-sm">
                              <div>
                                <div className="font-medium text-neutral-900">
                                  {event.organizer}
                                </div>
                                <div className="text-xs text-neutral-500">Organizer</div>
                              </div>
                              {isOrganizer && (
                                <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                                  You
                                </span>
                              )}
                            </div>
                          )}

                          {event.attendees.map((attendee, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-sm border-t border-neutral-100 pt-2"
                            >
                              <div>
                                <div className="font-medium text-neutral-900">
                                  {attendee.name || attendee.email}
                                </div>
                                {attendee.name && (
                                  <div className="text-xs text-neutral-500">{attendee.email}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {attendee.isVIP && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">
                                    VIP
                                  </span>
                                )}
                                {attendee.status && (
                                  <span className="text-xs text-neutral-500 capitalize">
                                    {attendee.status}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {vipAttendees.length > 0 && (
                          <div className="mt-3 p-3 bg-violet-50 border border-violet-200 rounded-md">
                            <p className="text-xs text-violet-900 font-medium">
                              🌟 {vipAttendees.length} VIP {vipAttendees.length === 1 ? 'attendee' : 'attendees'} in this meeting
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Meeting assistant — Google Meet + upcoming */}
                      {isMeet && isUpcoming && (
                        <div className="border-t border-neutral-200 pt-6">
                          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">
                            <MicrophoneIcon className="w-4 h-4 text-indigo-500" />
                            Meeting assistant
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            {botState === 'joining' ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-600">
                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                Joining meeting…
                              </span>
                            ) : botState === 'recording' ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-600">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                Recording
                              </span>
                            ) : botState === 'done' ? (
                              <span className="text-[12px] text-neutral-400">● Transcribed</span>
                            ) : botState === 'cancelled' ? (
                              schedulingBot ? (
                                <span className="text-[12px] text-neutral-400 animate-pulse">Scheduling…</span>
                              ) : (
                                <button
                                  onClick={async () => {
                                    setSchedulingBot(true);
                                    try {
                                      const res = await fetch(`/api/meetings/${event.id}/enable-bot`, { method: 'POST' });
                                      if (res.ok) onScheduled?.(event.id);
                                      else setSchedulingBot(false);
                                    } catch { setSchedulingBot(false); }
                                  }}
                                  className="text-[12px] text-neutral-500 hover:text-indigo-600 transition-colors"
                                >
                                  ↺ Re-enable assistant
                                </button>
                              )
                            ) : botState === 'scheduled' ? (
                              cancellingBot ? (
                                <span className="text-[12px] text-neutral-400 animate-pulse">Removing…</span>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-600">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                    Assistant scheduled
                                  </span>
                                  <button
                                    onClick={async () => {
                                      setCancellingBot(true);
                                      let ok = false;
                                      try {
                                        const res = await fetch(`/api/meetings/${event.id}/cancel-bot`, { method: 'DELETE' });
                                        ok = res.ok;
                                      } finally { setCancellingBot(false); }
                                      if (ok) { setSchedulingBot(false); onCancelled?.(event.id); }
                                    }}
                                    className="text-[11px] text-neutral-400 hover:text-red-500 transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )
                            ) : schedulingBot ? (
                              <span className="text-[12px] text-neutral-400 animate-pulse">Scheduling…</span>
                            ) : (
                              <button
                                onClick={async () => {
                                  setSchedulingBot(true);
                                  try {
                                    const res = await fetch(`/api/meetings/${event.id}/schedule-bot`, { method: 'POST' });
                                    if (res.ok) onScheduled?.(event.id);
                                    else setSchedulingBot(false);
                                  } catch { setSchedulingBot(false); }
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors"
                              >
                                + Send assistant to meeting
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* In-Person Recorder (for upcoming / in-progress meetings) */}
                      {(event.meeting_status === 'upcoming' || event.meeting_status === 'in_progress' || event.meeting_status === 'starting_soon') && (
                        <div className="border-t border-neutral-200 pt-6">
                          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">
                            <MicrophoneIcon className="w-4 h-4 text-red-600" />
                            Record In-Person
                          </div>
                          <p className="text-xs text-neutral-500 mb-3">
                            Meeting in the room? Record directly from your mic — transcript and action items generated automatically.
                          </p>
                          <MeetingRecorder
                            calendarEventId={event.id}
                            meetingTitle={event.title}
                            onTranscriptReady={() => setTranscriptKey((k) => k + 1)}
                          />
                        </div>
                      )}

                      {/* Meeting Transcript (for completed meetings) */}
                      {event.meeting_status === 'completed' && (
                        <div className="border-t border-neutral-200 pt-6">
                          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">
                            <DocumentTextIcon className="w-4 h-4 text-blue-600" />
                            Transcript
                          </div>

                          {transcriptLoading && (
                            <div className="text-sm text-neutral-500 italic">
                              Loading transcript...
                            </div>
                          )}

                          {!transcriptLoading && !transcript && (
                            <div className="text-sm text-neutral-500 italic">
                              Transcript not available yet. It will appear here once the meeting bot has processed the recording.
                            </div>
                          )}

                          {!transcriptLoading && transcript && (
                            <>
                              {/* Transcript metadata */}
                              <div className="mb-4 flex items-center gap-4 text-xs text-neutral-600">
                                <span>{transcript.transcript_segments.length} segments</span>
                                <span>•</span>
                                <span>{transcript.duration_minutes} min duration</span>
                                {transcript.work_items_generated > 0 && (
                                  <>
                                    <span>•</span>
                                    <span className="text-blue-600 font-medium">
                                      {transcript.work_items_generated} action {transcript.work_items_generated === 1 ? 'item' : 'items'} created
                                    </span>
                                  </>
                                )}
                              </div>

                              {/* Transcript segments */}
                              <div className="space-y-3 max-h-96 overflow-y-auto bg-neutral-50 border border-neutral-200 rounded-md p-4">
                                {transcript.transcript_segments.map((segment, idx) => (
                                  <div key={idx} className="text-sm">
                                    <div className="font-semibold text-neutral-900 mb-1">
                                      {segment.speaker}
                                      <span className="ml-2 text-xs font-normal text-neutral-500">
                                        {formatTimestamp(segment.timestamp)}
                                      </span>
                                    </div>
                                    <div className="text-neutral-700 leading-relaxed">
                                      {segment.text}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}


                    </div>

                    {/* Footer - Fixed */}
                    <div className="border-t border-neutral-200 bg-neutral-50 px-6 py-4 space-y-3">
                      {/* RSVP */}
                      <div>
                        <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-2">Your response</p>
                        <RsvpButtons
                          itemId={event.id}
                          attendees={event.attendees}
                          userEmail={userEmail}
                          onDismiss={(response) => {
                            const labels: Record<string, string> = { accepted: 'Meeting accepted', tentative: 'Marked as maybe', declined: 'Meeting declined' };
                            toast.success(labels[response] ?? 'RSVP updated');
                            onClose();
                            onRefresh?.();
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={onClose}
                          className="flex-1 px-4 py-2 rounded-md text-sm font-medium text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 transition-colors"
                        >
                          Close
                        </button>
                        {event.meeting_link && (
                          <button
                            onClick={handleJoinMeeting}
                            className="flex-1 px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                          >
                            Join Meeting
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

/**
 * Format timestamp (seconds) to MM:SS
 */
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
