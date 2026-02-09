'use client';

import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  ChevronDownIcon,
  ChevronUpIcon
} from '@heroicons/react/24/outline';
import {
  ClipboardDocumentListIcon,
  EnvelopeIcon,
  CalendarIcon,
  SparklesIcon,
  UserIcon,
  BuildingOfficeIcon,
  BanknotesIcon,
  LinkIcon
} from '@heroicons/react/24/outline';
import InboxActions from './inbox-actions';

interface InboxDrawerProps {
  item: any;
  isOpen: boolean;
  onClose: () => void;
}

export default function InboxDrawer({ item, isOpen, onClose }: InboxDrawerProps) {
  const [showEmail, setShowEmail] = useState(false);
  const [showThreadHistory, setShowThreadHistory] = useState(false);

  if (!item) return null;

  const sourceData = item.source_data;

  // Work state display
  const getWorkStateDisplay = (workState: string) => {
    switch (workState) {
      case 'work_prepared':
        return {
          icon: CheckCircleIcon,
          label: 'Ready to Execute',
          color: 'text-green-700 bg-green-50'
        };
      case 'decision_required':
        return {
          icon: ExclamationCircleIcon,
          label: 'Decision Needed',
          color: 'text-orange-700 bg-orange-50'
        };
      case 'waiting':
        return {
          icon: ClockIcon,
          label: 'Waiting',
          color: 'text-gray-700 bg-gray-50'
        };
      default:
        return {
          icon: CheckCircleIcon,
          label: 'FYI',
          color: 'text-gray-500 bg-gray-50'
        };
    }
  };

  const workStateDisplay = getWorkStateDisplay(item.work_state || 'work_prepared');
  const WorkStateIcon = workStateDisplay.icon;

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
                  <div className="flex h-full flex-col overflow-y-scroll bg-gradient-to-br from-white to-gray-50">
                    {/* Header - WORK-CENTRIC */}
                    <div className="bg-gradient-to-br from-white to-gray-50 px-6 py-6 border-b border-gray-200/50 backdrop-blur-sm sticky top-0 z-10">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Work State Badge */}
                          <div className="flex items-center space-x-2 mb-3">
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shadow-sm ${workStateDisplay.color}`}>
                              <WorkStateIcon className="w-3.5 h-3.5 mr-1.5" />
                              {workStateDisplay.label}
                            </span>
                            {(sourceData?.urgency === 'high' || sourceData?.urgency === 'critical') && (
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shadow-sm ${urgencyColor}`}>
                                {sourceData?.urgency === 'critical' ? '🔴 Critical' : '⚠️ High Priority'}
                              </span>
                            )}
                          </div>

                          {/* Work Title */}
                          <Dialog.Title className="text-2xl font-bold text-gray-900 leading-tight mb-2">
                            {item.work_title || sourceData?.subject || 'Review email'}
                          </Dialog.Title>

                          {/* What I Prepared */}
                          <div className="flex items-start space-x-2 mb-3">
                            <SparklesIcon className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-semibold text-primary-700">What I prepared:</p>
                              <p className="text-sm text-gray-900">{item.what_i_prepared || 'Summary and analysis'}</p>
                            </div>
                          </div>

                          {/* Why Matters */}
                          {item.why_matters && (
                            <div className="pt-3 border-t border-gray-200/50">
                              <p className="text-sm font-semibold text-gray-600 mb-1">Why this matters:</p>
                              <p className="text-gray-900 leading-relaxed">{item.why_matters}</p>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="ml-4 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          onClick={onClose}
                        >
                          <XMarkIcon className="h-6 w-6" />
                        </button>
                      </div>
                    </div>

                    {/* Content - Prepared Work */}
                    <div className="flex-1 px-6 py-6 space-y-5">
                      {/* Key Points */}
                      {sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
                        <div className="p-5 bg-white rounded-lg border border-gray-200/50 shadow-sm">
                          <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Key Points</h3>
                          <ul className="space-y-2.5">
                            {sourceData.keyPoints.map((point: string, index: number) => (
                              <li key={index} className="flex items-start space-x-2.5 text-gray-900">
                                <span className="text-primary-600 font-bold mt-0.5">•</span>
                                <span className="leading-relaxed">{point}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Draft Reply */}
                      {sourceData?.draft && (
                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-5 border border-blue-200/50">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center space-x-2.5">
                              <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-sm">
                                <EnvelopeIcon className="w-4 h-4 text-white" />
                              </div>
                              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Draft Reply</h3>
                            </div>
                            <span className="text-xs font-medium text-gray-600 px-2.5 py-1 bg-white rounded-full border border-blue-200">
                              Tone: {sourceData.draft.tone || 'professional'}
                            </span>
                          </div>
                          <div className="space-y-4">
                            <div className="p-4 bg-white rounded-lg border border-blue-100">
                              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Subject</p>
                              <p className="text-sm text-gray-900 font-medium">{sourceData.draft.subject}</p>
                            </div>
                            <div className="p-4 bg-white rounded-lg border border-blue-100">
                              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Body</p>
                              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-900 leading-relaxed">
                                {sourceData.draft.body}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Next Steps / Action Items */}
                      {sourceData?.nextSteps && sourceData.nextSteps.length > 0 && (
                        <div className="bg-gradient-to-br from-primary-50 to-purple-50 rounded-lg p-5 border border-primary-200/50">
                          <div className="flex items-center space-x-2.5 mb-4">
                            <div className="p-2 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg shadow-sm">
                              <ClipboardDocumentListIcon className="w-4 h-4 text-white" />
                            </div>
                            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Next Steps</h3>
                          </div>
                          <div className="space-y-3">
                            {sourceData.nextSteps.map((step: any, index: number) => (
                              <div key={index} className="flex items-start space-x-3 p-3 bg-white rounded-lg border border-primary-100 shadow-sm">
                                <input type="checkbox" className="mt-1.5 w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500" />
                                <div className="flex-1">
                                  <p className="text-sm text-gray-900 font-medium leading-relaxed">{step.description}</p>
                                  {step.estimatedTime && (
                                    <span className="inline-block mt-2 px-2 py-1 bg-gray-50 rounded-md text-xs text-gray-600">
                                      {step.estimatedTime}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Decision Analysis (for decision_required) */}
                      {sourceData?.analysis && (
                        <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-lg p-5 border border-orange-200/50">
                          <div className="flex items-center space-x-2.5 mb-4">
                            <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg shadow-sm">
                              <ExclamationCircleIcon className="w-4 h-4 text-white" />
                            </div>
                            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Analysis</h3>
                          </div>
                          <div className="space-y-4">
                            {sourceData.analysis.options && (
                              <div className="p-4 bg-white rounded-lg border border-orange-100">
                                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Options</p>
                                <ul className="space-y-2">
                                  {sourceData.analysis.options.map((option: string, i: number) => (
                                    <li key={i} className="text-sm text-gray-900">• {option}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {sourceData.analysis.recommendation && (
                              <div className="p-4 bg-white rounded-lg border border-orange-100">
                                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                                  My Recommendation (AI suggestion)
                                </p>
                                <p className="text-sm text-gray-900">{sourceData.analysis.recommendation}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Calendar Event */}
                      {sourceData?.calendarEvent && (
                        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-5 border border-purple-200/50">
                          <div className="flex items-center space-x-2.5 mb-4">
                            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg shadow-sm">
                              <CalendarIcon className="w-4 h-4 text-white" />
                            </div>
                            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Suggested Calendar Event</h3>
                          </div>
                          <div className="space-y-3 p-4 bg-white rounded-lg border border-purple-100">
                            <div>
                              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Title</span>
                              <p className="mt-1 text-sm text-gray-900 font-medium">{sourceData.calendarEvent.title}</p>
                            </div>
                            {sourceData.calendarEvent.duration && (
                              <div className="pt-3 border-t border-gray-100">
                                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Duration</span>
                                <p className="mt-1 text-sm text-gray-900 font-medium">{sourceData.calendarEvent.duration}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Extracted Data */}
                      {sourceData?.extractedData && Object.keys(sourceData.extractedData).some(key => sourceData.extractedData[key]?.length > 0) && (
                        <div className="p-5 bg-white rounded-lg border border-gray-200/50 shadow-sm">
                          <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Extracted Data</h3>
                          <div className="grid grid-cols-2 gap-3">
                            {sourceData.extractedData.people && sourceData.extractedData.people.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center space-x-1">
                                  <UserIcon className="w-3 h-3" />
                                  <span>People</span>
                                </p>
                                <p className="text-sm text-gray-900">{sourceData.extractedData.people.join(', ')}</p>
                              </div>
                            )}
                            {sourceData.extractedData.companies && sourceData.extractedData.companies.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center space-x-1">
                                  <BuildingOfficeIcon className="w-3 h-3" />
                                  <span>Companies</span>
                                </p>
                                <p className="text-sm text-gray-900">{sourceData.extractedData.companies.join(', ')}</p>
                              </div>
                            )}
                            {sourceData.extractedData.amounts && sourceData.extractedData.amounts.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center space-x-1">
                                  <BanknotesIcon className="w-3 h-3" />
                                  <span>Amounts</span>
                                </p>
                                <p className="text-sm text-gray-900">{sourceData.extractedData.amounts.join(', ')}</p>
                              </div>
                            )}
                            {sourceData.extractedData.links && sourceData.extractedData.links.length > 0 && (
                              <div className="col-span-2">
                                <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center space-x-1">
                                  <LinkIcon className="w-3 h-3" />
                                  <span>Links</span>
                                </p>
                                <div className="space-y-1">
                                  {sourceData.extractedData.links.map((link: string, i: number) => (
                                    <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary-600 hover:text-primary-700 truncate">
                                      {link}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* AI Reasoning */}
                      {item.ai_suggestion_reasoning && (
                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="flex items-start space-x-2">
                            <SparklesIcon className="w-4 h-4 text-gray-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">AI Reasoning</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{item.ai_suggestion_reasoning}</p>
                              {item.confidence_score && (
                                <p className="text-xs text-gray-500 mt-2">Confidence: {item.confidence_score}%</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Thread History - Expandable (only if multiple messages) */}
                      {sourceData?.thread_history && sourceData.thread_history.length > 1 && (
                        <div className="border-t border-gray-200 pt-5">
                          <button
                            onClick={() => setShowThreadHistory(!showThreadHistory)}
                            className="w-full flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                          >
                            <div className="flex items-center space-x-2">
                              <EnvelopeIcon className="w-4 h-4 text-blue-600" />
                              <span className="text-sm font-semibold text-blue-700">
                                Thread History ({sourceData.thread_history.length} messages)
                              </span>
                            </div>
                            {showThreadHistory ? (
                              <ChevronUpIcon className="w-5 h-5 text-blue-500" />
                            ) : (
                              <ChevronDownIcon className="w-5 h-5 text-blue-500" />
                            )}
                          </button>

                          {showThreadHistory && (
                            <div className="mt-3 space-y-3">
                              {sourceData.thread_history.map((msg: any, index: number) => (
                                <div key={index} className="p-4 bg-white rounded-lg border border-gray-200">
                                  <div className="space-y-2 text-sm">
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <span className="font-semibold text-gray-700">{msg.from}</span>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                          {new Date(msg.received_at).toLocaleString()}
                                        </div>
                                      </div>
                                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                                        #{index + 1}
                                      </span>
                                    </div>
                                    <div className="pt-2 border-t border-gray-100">
                                      <div className="font-medium text-gray-900 mb-1">{msg.subject}</div>
                                      <div className="text-gray-600 text-xs leading-relaxed">
                                        {msg.snippet}...
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Original Email - Expandable */}
                      <div className="border-t border-gray-200 pt-5">
                        <button
                          onClick={() => setShowEmail(!showEmail)}
                          className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <div className="flex items-center space-x-2">
                            <EnvelopeIcon className="w-4 h-4 text-gray-600" />
                            <span className="text-sm font-semibold text-gray-700">Original Email</span>
                          </div>
                          {showEmail ? (
                            <ChevronUpIcon className="w-5 h-5 text-gray-500" />
                          ) : (
                            <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                          )}
                        </button>

                        {showEmail && (
                          <div className="mt-3 p-5 bg-white rounded-lg border border-gray-200">
                            <div className="space-y-3 text-sm">
                              <div>
                                <span className="font-semibold text-gray-600">From:</span>
                                <span className="ml-2 text-gray-900">{sourceData?.from_name} ({sourceData?.from})</span>
                              </div>
                              <div>
                                <span className="font-semibold text-gray-600">Subject:</span>
                                <span className="ml-2 text-gray-900">{sourceData?.subject}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-gray-600">Received:</span>
                                <span className="ml-2 text-gray-900">{new Date(sourceData?.received_at).toLocaleString()}</span>
                              </div>
                              <div className="pt-3 border-t border-gray-200">
                                <span className="font-semibold text-gray-600 block mb-2">Body:</span>
                                <div className="text-gray-900 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                                  {sourceData?.summary}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer - Actions */}
                    <div className="border-t border-gray-200/50 px-6 py-5 bg-gradient-to-br from-white to-gray-50 backdrop-blur-sm sticky bottom-0">
                      <InboxActions
                        itemId={item.id}
                        status={item.status}
                        draft={sourceData?.draft}
                        onClose={onClose}
                      />
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
