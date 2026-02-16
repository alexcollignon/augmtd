'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  VideoCameraIcon,
  UserGroupIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import {
  formatMeetingTime,
  calculateDuration,
  getVIPAttendees,
  isUserOrganizer,
} from '@/lib/types/meetings';

interface MeetingDetailPanelProps {
  event: CalendarEvent;
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function MeetingDetailPanel({
  event,
  userEmail,
  isOpen,
  onClose,
}: MeetingDetailPanelProps) {
  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);
  const vipAttendees = getVIPAttendees(event.attendees);
  const isOrganizer = isUserOrganizer(event, userEmail);

  // Get AI-generated prep from meeting metadata if available
  // This would come from the meeting processor's source_data
  const prep = (event.metadata as any)?.prep as { agenda?: string; context?: string } | undefined;

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
                        <button
                          type="button"
                          className="rounded-md text-neutral-400 hover:text-neutral-600 transition-colors"
                          onClick={onClose}
                        >
                          <XMarkIcon className="h-5 w-5" />
                        </button>
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

                      {/* AI-Generated Prep (if available) */}
                      {prep && (prep.agenda || prep.context) && (
                        <div className="border-t border-neutral-200 pt-6">
                          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">
                            <SparklesIcon className="w-4 h-4 text-violet-600" />
                            Meeting Prep
                          </div>

                          {prep.agenda && (
                            <div className="mb-4">
                              <h4 className="text-sm font-semibold text-neutral-900 mb-2">Agenda</h4>
                              <div className="text-sm text-neutral-700 whitespace-pre-wrap">
                                {prep.agenda}
                              </div>
                            </div>
                          )}

                          {prep.context && (
                            <div>
                              <h4 className="text-sm font-semibold text-neutral-900 mb-2">Context</h4>
                              <p className="text-sm text-neutral-700">
                                {prep.context}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Description */}
                      {event.description && (
                        <div className="border-t border-neutral-200 pt-6">
                          <h4 className="text-sm font-semibold text-neutral-900 mb-2">Description</h4>
                          <div className="text-sm text-neutral-700 whitespace-pre-wrap">
                            {event.description}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer - Fixed */}
                    <div className="border-t border-neutral-200 bg-neutral-50 px-6 py-4">
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
