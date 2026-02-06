'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, CheckCircleIcon, PencilIcon } from '@heroicons/react/24/outline';
import {
  ClipboardDocumentListIcon,
  EnvelopeIcon,
  CalendarIcon,
  ArrowPathIcon,
  ClockIcon,
  LinkIcon,
  SparklesIcon,
  UserIcon,
  BuildingOfficeIcon,
  BanknotesIcon
} from '@heroicons/react/24/outline';
import InboxActions from './inbox-actions';

interface InboxDrawerProps {
  item: any;
  isOpen: boolean;
  onClose: () => void;
}

export default function InboxDrawer({ item, isOpen, onClose }: InboxDrawerProps) {
  if (!item) return null;

  const sourceData = item.source_data;

  const urgencyColors = {
    low: 'bg-gray-100 text-gray-800',
    medium: 'bg-blue-100 text-blue-800',
    high: 'bg-orange-100 text-orange-800',
    critical: 'bg-red-100 text-red-800'
  };

  const urgencyColor = urgencyColors[sourceData?.urgency as keyof typeof urgencyColors] || urgencyColors.medium;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-in-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in-out duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-300"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-2xl">
                  <div className="flex h-full flex-col overflow-y-scroll bg-white shadow-xl">
                    {/* Header */}
                    <div className="bg-white px-6 py-6 border-b border-gray-200">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {(sourceData?.urgency === 'high' || sourceData?.urgency === 'critical' || item.priority >= 75) && (
                            <div className="mb-2">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${urgencyColor}`}>
                                {sourceData?.urgency === 'critical' ? 'Critical' : 'High Priority'}
                              </span>
                            </div>
                          )}
                          <Dialog.Title className="text-xl font-semibold text-gray-900">
                            {sourceData?.subject || 'No subject'}
                          </Dialog.Title>
                          <p className="text-sm text-gray-600 mt-1">
                            From: <span className="font-medium">{sourceData?.from_name || sourceData?.from}</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          className="ml-4 rounded-md text-gray-400 hover:text-gray-500"
                          onClick={onClose}
                        >
                          <XMarkIcon className="h-6 w-6" />
                        </button>
                      </div>

                      {/* Summary */}
                      {sourceData?.summary && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <p className="text-gray-900">{sourceData.summary}</p>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 px-6 py-6 space-y-6">
                      {/* Key Points */}
                      {sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
                        <div>
                          <h3 className="text-sm font-medium text-gray-700 mb-2">Key Points</h3>
                          <ul className="list-disc list-inside space-y-1">
                            {sourceData.keyPoints.map((point: string, index: number) => (
                              <li key={index} className="text-gray-900">{point}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Deadline */}
                      {sourceData?.deadline && (
                        <div>
                          <h3 className="text-sm font-medium text-gray-700 mb-2">Deadline</h3>
                          <div className="flex items-center space-x-2 text-gray-900">
                            <ClockIcon className="w-5 h-5 text-gray-400" />
                            <span>{sourceData.deadline}</span>
                          </div>
                        </div>
                      )}

                      {/* Action Items */}
                      {sourceData?.actionItems && sourceData.actionItems.length > 0 && (
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center space-x-2 mb-3">
                            <ClipboardDocumentListIcon className="w-5 h-5 text-gray-700" />
                            <h3 className="text-sm font-medium text-gray-900">Action Items</h3>
                          </div>
                          <div className="space-y-2">
                            {sourceData.actionItems.map((action: any, index: number) => (
                              <div key={index} className="flex items-start space-x-2">
                                <input type="checkbox" className="mt-1" />
                                <div className="flex-1">
                                  <p className="text-sm text-gray-900">{action.description}</p>
                                  {(action.deadline || action.estimatedTime) && (
                                    <div className="flex items-center space-x-3 mt-1 text-xs text-gray-600">
                                      {action.deadline && (
                                        <span className="flex items-center space-x-1">
                                          <ClockIcon className="w-3 h-3" />
                                          <span>{action.deadline}</span>
                                        </span>
                                      )}
                                      {action.estimatedTime && <span>{action.estimatedTime}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Draft Reply */}
                      {sourceData?.draftReply && (
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-2">
                              <EnvelopeIcon className="w-5 h-5 text-gray-700" />
                              <h3 className="text-sm font-medium text-gray-900">Draft Reply</h3>
                            </div>
                            <span className="text-xs text-gray-600">Tone: {sourceData.draftReply.tone}</span>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-medium text-gray-700">Subject</p>
                              <p className="text-sm text-gray-900 mt-1">{sourceData.draftReply.subject}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-700">Body</p>
                              <div className="mt-1 p-3 bg-white rounded border border-gray-200">
                                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-900">
                                  {sourceData.draftReply.body}
                                </pre>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Calendar Event */}
                      {sourceData?.calendarEvent && (
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center space-x-2 mb-3">
                            <CalendarIcon className="w-5 h-5 text-gray-700" />
                            <h3 className="text-sm font-medium text-gray-900">Suggested Calendar Event</h3>
                          </div>
                          <div className="space-y-2 text-sm">
                            <div>
                              <span className="font-medium text-gray-700">Title:</span>
                              <span className="ml-2 text-gray-900">{sourceData.calendarEvent.title}</span>
                            </div>
                            {sourceData.calendarEvent.date && (
                              <div>
                                <span className="font-medium text-gray-700">Date:</span>
                                <span className="ml-2 text-gray-900">{sourceData.calendarEvent.date}</span>
                              </div>
                            )}
                            {sourceData.calendarEvent.duration && (
                              <div>
                                <span className="font-medium text-gray-700">Duration:</span>
                                <span className="ml-2 text-gray-900">{sourceData.calendarEvent.duration}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer - Actions */}
                    <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
                      <InboxActions itemId={item.id} status={item.status} />
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
