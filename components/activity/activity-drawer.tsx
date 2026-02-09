'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, CheckCircleIcon, PencilIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';

interface ActivityDrawerProps {
  item: any;
  isOpen: boolean;
  onClose: () => void;
}

export default function ActivityDrawer({ item, isOpen, onClose }: ActivityDrawerProps) {
  const sourceData = item?.source_data;
  const provider = sourceData?.provider || 'gmail';
  const wasApproved = item?.status === 'approved';
  const wasModified = sourceData?.modified === true;

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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
          <div className="fixed inset-0 bg-black/20 transition-opacity" />
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
                  {item && (
                  <div className="flex h-full flex-col overflow-y-scroll bg-white shadow-2xl">
                    {/* Header */}
                    <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          wasApproved ? 'bg-green-50' : 'bg-gray-100'
                        }`}>
                          {wasApproved ? (
                            <CheckCircleIcon className="w-5 h-5 text-green-600" />
                          ) : (
                            <XMarkIcon className="w-5 h-5 text-gray-500" />
                          )}
                        </div>
                        <div>
                          <h2 className="text-sm font-semibold text-gray-900">
                            {wasApproved ? 'Approved & Executed' : 'Dismissed'}
                          </h2>
                          <p className="text-xs text-gray-500">
                            {item && formatTimestamp(item.reviewed_at || item.created_at)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <XMarkIcon className="w-5 h-5 text-gray-500" />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                      {/* Status Badge */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Image
                            src={provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
                            alt={provider}
                            width={16}
                            height={16}
                            className="w-4 h-4 opacity-60"
                          />
                          <span className="text-xs font-medium text-gray-500 uppercase">{provider}</span>
                        </div>
                        {wasModified && (
                          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-blue-50 rounded-md">
                            <PencilIcon className="w-3.5 h-3.5 text-blue-600" />
                            <span className="text-xs font-medium text-blue-700">Modified before sending</span>
                          </div>
                        )}
                      </div>

                      {/* Work Title */}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-2">Action</label>
                        <p className="text-sm text-gray-900">{item?.work_title || 'No title'}</p>
                      </div>

                      {/* Email Details (if available) */}
                      {sourceData?.draft && wasApproved && (
                        <>
                          {/* From/To */}
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                              <p className="text-sm text-gray-900">
                                {sourceData.from_name && <span className="font-medium">{sourceData.from_name}</span>}
                                {sourceData.from_name && <span className="text-gray-400"> &lt;</span>}
                                <span className={sourceData.from_name ? 'text-gray-600' : 'text-gray-900'}>
                                  {sourceData.from}
                                </span>
                                {sourceData.from_name && <span className="text-gray-400">&gt;</span>}
                              </p>
                            </div>
                          </div>

                          {/* Subject */}
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-2">Subject</label>
                            <p className="text-sm text-gray-900">{sourceData.draft.subject}</p>
                          </div>

                          {/* Email Body */}
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-2">Email Sent</label>
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                              <div className="text-sm text-gray-900 whitespace-pre-wrap font-sans leading-relaxed">
                                {sourceData.draft.body}
                              </div>
                            </div>
                          </div>

                          {/* AI Metadata */}
                          {sourceData.draft.tone && (
                            <div className="pt-2 border-t border-gray-100">
                              <p className="text-xs text-gray-400">
                                AI-generated draft • {sourceData.draft.tone} tone
                              </p>
                            </div>
                          )}
                        </>
                      )}

                      {/* Original Context (if no draft - dismissed item) */}
                      {!sourceData?.draft && sourceData?.from && (
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-2">Original Email</label>
                          <p className="text-sm text-gray-900">
                            From: {sourceData.from_name || sourceData.from}
                          </p>
                          {sourceData.subject && (
                            <p className="text-sm text-gray-600 mt-1">
                              Subject: {sourceData.subject}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
