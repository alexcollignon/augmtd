'use client';

import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  PaperAirplaneIcon,
  UserIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import RecipientContextDisplay from './recipient-context-display';
import DraftPreviewModal from './draft-preview-modal';

interface WorkDetailPanelProps {
  item: InboxItem;
  isOpen: boolean;
  onClose: () => void;
}

export default function WorkDetailPanel({ item, isOpen, onClose }: WorkDetailPanelProps) {
  const sourceData = item.source_data;
  const recipientContext = item.recipient_context;
  const [isSending, setIsSending] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);

  // Get role display in business language
  const getRoleDisplay = () => {
    if (!recipientContext) return 'Recipient';

    const roleLabels: Record<string, string> = {
      primary_owner: 'Primary Owner',
      secondary_owner: 'Co-Owner',
      reviewer: 'Reviewer',
      approver: 'Approver',
      informed: 'Informed (FYI)',
    };

    return roleLabels[recipientContext.detectedRole] || 'Recipient';
  };

  // Get suggested action
  const getSuggestedAction = () => {
    if (sourceData?.draft) return 'Send reply';
    if (item.work_state === 'decision_required') return 'Provide decision';
    if (item.work_state === 'action_required') return 'Take action';
    return 'Review details';
  };

  const handleSendReply = async (customMessage?: string) => {
    setIsSending(true);
    try {
      const response = await fetch(`/api/inbox/${item.id}/send-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMessage }),
      });

      if (response.ok) {
        window.location.reload();
      } else {
        console.error('Failed to send reply');
        alert('Failed to send reply. Please try again.');
      }
    } catch (error) {
      console.error('Send reply error:', error);
      alert('Failed to send reply. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      const response = await fetch(`/api/inbox/${item.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reviewed' }),
      });

      if (response.ok) {
        window.location.reload();
      } else {
        console.error('Failed to complete item');
        alert('Failed to complete item. Please try again.');
      }
    } catch (error) {
      console.error('Complete error:', error);
      alert('Failed to complete item. Please try again.');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleDismiss = async () => {
    setIsDismissing(true);
    try {
      const response = await fetch(`/api/inbox/${item.id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'not_relevant' }),
      });

      const data = await response.json();

      if (response.ok) {
        window.location.reload();
      } else {
        console.error('Failed to dismiss item:', data);
        alert(data.error || 'Failed to dismiss item. Please try again.');
      }
    } catch (error) {
      console.error('Dismiss error:', error);
      alert('Failed to dismiss item. Please try again.');
    } finally {
      setIsDismissing(false);
    }
  };

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </Transition.Child>

        {/* Drawer Panel */}
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
                <Dialog.Panel className="pointer-events-auto w-screen max-w-2xl">
                  <div className="flex h-full flex-col bg-white shadow-2xl">
                    {/* Header */}
                    <div className="relative bg-gradient-to-r from-indigo-50 to-violet-50 px-6 py-5 border-b border-indigo-100">
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-indigo-500" />
                      <div className="flex items-start justify-between pl-4">
                        <div className="flex-1 pr-4">
                          <Dialog.Title className="text-[18px] font-semibold text-neutral-900 leading-tight">
                            {item.work_title || sourceData?.subject || 'Work Item'}
                          </Dialog.Title>
                          {sourceData?.from_name && (
                            <p className="text-[13px] text-neutral-600 mt-1.5">
                              From: {sourceData.from_name}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={onClose}
                          className="flex-shrink-0 p-2 hover:bg-white/60 transition-colors"
                        >
                          <XMarkIcon className="w-5 h-5 text-neutral-500" />
                        </button>
                      </div>
                    </div>

                    {/* Content - Scrollable */}
                    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                      {/* What Was Prepared */}
                      {item.what_i_prepared && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            What Was Prepared
                          </h3>
                          <p className="text-[14px] text-neutral-900 leading-relaxed">
                            {item.what_i_prepared}
                          </p>
                        </div>
                      )}

                      {/* Why This Matters */}
                      {item.why_matters && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            Why This Matters
                          </h3>
                          <p className="text-[14px] text-neutral-900 leading-relaxed">
                            {item.why_matters}
                          </p>
                        </div>
                      )}

                      {/* Draft Reply */}
                      {sourceData?.draft && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            Prepared Reply
                          </h3>
                          <div className="relative bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 p-4">
                            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-indigo-500" />
                            <div className="pl-3">
                              {typeof sourceData.draft === 'object' && sourceData.draft.tone && (
                                <div className="mb-3">
                                  <span className="text-[10px] text-indigo-600 font-medium">
                                    Tone: {sourceData.draft.tone}
                                  </span>
                                </div>
                              )}
                              <p className="text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                                {typeof sourceData.draft === 'string' ? sourceData.draft : sourceData.draft.body}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Your Role */}
                      <div>
                        <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                          Your Role
                        </h3>
                        <div className="bg-neutral-50 border border-neutral-200 p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-neutral-600">Assigned Role:</span>
                            <span className="text-[13px] font-semibold text-neutral-900">
                              {getRoleDisplay()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-neutral-600">Suggested Action:</span>
                            <span className="text-[13px] font-semibold text-neutral-900">
                              {getSuggestedAction()}
                            </span>
                          </div>
                          {recipientContext?.suggestionLabel && (
                            <div className="pt-2 border-t border-neutral-200">
                              <p className="text-[12px] text-neutral-500 italic">
                                {recipientContext.suggestionLabel}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Involved Parties */}
                      {recipientContext?.otherRecipients && recipientContext.otherRecipients.length > 0 && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            Also on Thread
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {recipientContext.otherRecipients.slice(0, 5).map((email, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center px-3 py-1.5 text-[12px] bg-neutral-100 text-neutral-700 border border-neutral-200"
                              >
                                <UserIcon className="w-3 h-3 mr-1.5" />
                                {email}
                              </span>
                            ))}
                            {recipientContext.otherRecipients.length > 5 && (
                              <span className="inline-flex items-center px-3 py-1.5 text-[12px] bg-neutral-100 text-neutral-500">
                                +{recipientContext.otherRecipients.length - 5} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Key Points */}
                      {sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            Key Points
                          </h3>
                          <ul className="space-y-2">
                            {sourceData.keyPoints.map((point: string, i: number) => (
                              <li key={i} className="flex items-start text-[13px] text-neutral-700">
                                <span className="text-indigo-600 mr-2 font-bold">•</span>
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Thread History */}
                      {sourceData?.thread_history && sourceData.thread_history.length > 1 && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            Thread History
                          </h3>
                          <div className="space-y-2">
                            {sourceData.thread_history.slice(0, 3).map((msg: any, i: number) => (
                              <div
                                key={i}
                                className="bg-neutral-50 border border-neutral-200 p-3 text-[12px]"
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="font-medium text-neutral-900">
                                    {msg.from_name || msg.from}
                                  </span>
                                  <span className="text-neutral-500">
                                    {new Date(msg.received_at).toLocaleDateString()}
                                  </span>
                                </div>
                                <p className="text-neutral-600 line-clamp-2">
                                  {msg.snippet}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Advanced Details (Collapsible) */}
                      {recipientContext && (
                        <details className="group">
                          <summary className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide cursor-pointer hover:text-indigo-600 transition-colors">
                            Advanced Details
                          </summary>
                          <div className="mt-3">
                            <RecipientContextDisplay
                              recipientContext={recipientContext}
                              otherRecipients={recipientContext.otherRecipients || []}
                            />
                          </div>
                        </details>
                      )}
                    </div>

                    {/* Actions Footer - Fixed at bottom */}
                    <div className="flex-shrink-0 bg-neutral-50 px-6 py-4 border-t border-neutral-200">
                      <div className="flex items-center gap-3">
                        {/* Primary action */}
                        {sourceData?.draft && (
                          <button
                            onClick={() => setShowDraftPreview(true)}
                            className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm hover:shadow"
                          >
                            <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                            Review & Send
                          </button>
                        )}
                        {!sourceData?.draft && (
                          <button
                            onClick={handleComplete}
                            disabled={isCompleting}
                            className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                          >
                            <CheckIcon className="w-4 h-4 mr-2" />
                            {isCompleting ? 'Completing...' : 'Mark Complete'}
                          </button>
                        )}

                        {/* Secondary actions */}
                        <button
                          onClick={handleDismiss}
                          disabled={isDismissing}
                          className="px-4 py-2.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 transition-colors border border-neutral-300"
                        >
                          {isDismissing ? 'Dismissing...' : 'Dismiss'}
                        </button>
                      </div>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>

        {/* Draft Preview Modal */}
        {sourceData?.draft && (
          <DraftPreviewModal
            isOpen={showDraftPreview}
            onClose={() => setShowDraftPreview(false)}
            draft={typeof sourceData.draft === 'string' ? sourceData.draft : sourceData.draft.body}
            subject={sourceData.subject || 'Re: (no subject)'}
            to={sourceData.from || 'Unknown'}
            onSend={handleSendReply}
          />
        )}
      </Dialog>
    </Transition>
  );
}
