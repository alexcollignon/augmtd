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
import {
  isExecutable,
  isExecutionInProgress,
  isAwaitingApproval,
  isExecutionCompleted,
  getExecutionProgress
} from '@/lib/types/inbox';
import RecipientContextDisplay from './recipient-context-display';
import DraftPreviewModal from './draft-preview-modal';

interface WorkDetailPanelProps {
  item: InboxItem;
  isOpen: boolean;
  onClose: () => void;
  batchItems?: InboxItem[]; // If provided, this is a batch view
}

export default function WorkDetailPanel({ item, isOpen, onClose, batchItems }: WorkDetailPanelProps) {
  const isBatch = batchItems && batchItems.length > 1;
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

  // Batch actions
  const handleCompleteAll = async () => {
    if (!batchItems) return;

    setIsCompleting(true);
    try {
      const results = await Promise.allSettled(
        batchItems.map(batchItem =>
          fetch(`/api/inbox/${batchItem.id}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reviewed' }),
          })
        )
      );

      const failures = results.filter(r => r.status === 'rejected').length;
      if (failures > 0) {
        console.error(`Failed to complete ${failures} items`);
        alert(`Failed to complete ${failures} items. Please try again.`);
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Batch complete error:', error);
      alert('Failed to complete items. Please try again.');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleDismissAll = async () => {
    if (!batchItems) return;

    setIsDismissing(true);
    try {
      const results = await Promise.allSettled(
        batchItems.map(batchItem =>
          fetch(`/api/inbox/${batchItem.id}/dismiss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'not_relevant' }),
          })
        )
      );

      const failures = results.filter(r => r.status === 'rejected').length;
      if (failures > 0) {
        console.error(`Failed to dismiss ${failures} items`);
        alert(`Failed to dismiss ${failures} items. Please try again.`);
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Batch dismiss error:', error);
      alert('Failed to dismiss items. Please try again.');
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
                          {isBatch ? (
                            <p className="text-[13px] text-indigo-600 font-medium mt-1.5">
                              {batchItems.length} similar items
                            </p>
                          ) : (
                            sourceData?.from_name && (
                              <p className="text-[13px] text-neutral-600 mt-1.5">
                                From: {sourceData.from_name}
                              </p>
                            )
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
                      {/* Execution View - for executable work items */}
                      {!isBatch && isExecutable(item) && item.execution_plan && (
                        <div className="space-y-6">
                          {/* Deliverable Section */}
                          <div>
                            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                              📊 Deliverable
                            </h3>
                            <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 p-4 rounded-lg">
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-10 h-10 bg-indigo-500 text-white rounded-lg flex items-center justify-center font-bold text-lg">
                                  {item.execution_plan.deliverable_type === 'report' && '📊'}
                                  {item.execution_plan.deliverable_type === 'presentation' && '📽️'}
                                  {item.execution_plan.deliverable_type === 'spreadsheet' && '📈'}
                                  {item.execution_plan.deliverable_type === 'document' && '📄'}
                                  {item.execution_plan.deliverable_type === 'analysis' && '🔍'}
                                  {item.execution_plan.deliverable_type === 'email' && '✉️'}
                                </div>
                                <div className="flex-1">
                                  <div className="text-[10px] uppercase tracking-wide text-indigo-600 font-semibold mb-1">
                                    {item.execution_plan.deliverable_type}
                                  </div>
                                  <p className="text-[14px] text-neutral-900 font-medium leading-relaxed">
                                    {item.execution_plan.deliverable_description}
                                  </p>
                                  <div className="flex items-center gap-4 mt-3 text-[12px]">
                                    {item.execution_plan.estimated_time && (
                                      <span className="text-neutral-600">
                                        ⏱️ {item.execution_plan.estimated_time}
                                      </span>
                                    )}
                                    {item.execution_plan.deadline && (
                                      <span className="text-orange-600 font-medium">
                                        ⏰ Due: {new Date(item.execution_plan.deadline).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Execution Plan Steps */}
                          <div>
                            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                              ✨ Execution Plan
                            </h3>
                            <div className="space-y-2">
                              {item.execution_plan.steps.map((step) => (
                                <div
                                  key={step.number}
                                  className={`
                                    flex items-start gap-3 p-3 rounded-lg border
                                    ${step.status === 'completed' ? 'bg-green-50 border-green-200' : ''}
                                    ${step.status === 'running' ? 'bg-blue-50 border-blue-200' : ''}
                                    ${step.status === 'pending' ? 'bg-neutral-50 border-neutral-200' : ''}
                                    ${step.status === 'failed' ? 'bg-red-50 border-red-200' : ''}
                                  `}
                                >
                                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-white border-2 border-neutral-300 flex items-center justify-center">
                                    {step.status === 'completed' && (
                                      <CheckIcon className="w-4 h-4 text-green-600" />
                                    )}
                                    {step.status === 'running' && (
                                      <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                                    )}
                                    {step.status === 'pending' && (
                                      <span className="text-[10px] text-neutral-500 font-medium">{step.number}</span>
                                    )}
                                    {step.status === 'failed' && (
                                      <XMarkIcon className="w-4 h-4 text-red-600" />
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-[13px] text-neutral-900 font-medium">
                                      {step.action}
                                    </p>
                                    {step.skill && (
                                      <p className="text-[11px] text-neutral-500 mt-1">
                                        Skill: {step.skill}
                                      </p>
                                    )}
                                    {step.error && (
                                      <p className="text-[11px] text-red-600 mt-1">
                                        Error: {step.error}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Progress Bar */}
                            {isExecutionInProgress(item) && (
                              <div className="mt-4">
                                <div className="flex items-center justify-between text-[11px] text-neutral-600 mb-1">
                                  <span>Progress</span>
                                  <span>{getExecutionProgress(item)}%</span>
                                </div>
                                <div className="w-full bg-neutral-200 rounded-full h-2">
                                  <div
                                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${getExecutionProgress(item)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Status Badge */}
                          <div>
                            {item.execution_status === 'queued' && (
                              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                                <span className="text-[12px] text-blue-700 font-medium">
                                  Ready to execute
                                </span>
                              </div>
                            )}
                            {item.execution_status === 'running' && (
                              <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                                <span className="text-[12px] text-indigo-700 font-medium">
                                  Step {item.current_step + 1} of {item.execution_plan.steps.length}: In progress...
                                </span>
                              </div>
                            )}
                            {item.execution_status === 'awaiting_approval' && (
                              <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                                <div className="w-2 h-2 bg-orange-500 rounded-full" />
                                <span className="text-[12px] text-orange-700 font-medium">
                                  Awaiting your review
                                </span>
                              </div>
                            )}
                            {item.execution_status === 'completed' && (
                              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                <CheckIcon className="w-4 h-4 text-green-600" />
                                <span className="text-[12px] text-green-700 font-medium">
                                  Execution completed
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Artifacts (if any) */}
                          {item.artifacts && item.artifacts.length > 0 && (
                            <div>
                              <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                                📎 Generated Files
                              </h3>
                              <div className="space-y-2">
                                {item.artifacts.map((artifact, index) => (
                                  <div
                                    key={index}
                                    className="flex items-center justify-between p-3 bg-neutral-50 border border-neutral-200 rounded-lg hover:border-indigo-300 transition-colors"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="text-2xl">
                                        {artifact.type === 'excel' && '📊'}
                                        {artifact.type === 'powerpoint' && '📽️'}
                                        {artifact.type === 'word' && '📄'}
                                        {artifact.type === 'pdf' && '📕'}
                                        {artifact.type === 'email_draft' && '✉️'}
                                      </div>
                                      <div>
                                        <p className="text-[13px] text-neutral-900 font-medium">
                                          {artifact.name}
                                        </p>
                                        <p className="text-[11px] text-neutral-500">
                                          {(artifact.size / 1024).toFixed(1)} KB
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button className="px-3 py-1.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                                        Preview
                                      </button>
                                      <button className="px-3 py-1.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 rounded transition-colors">
                                        Download
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Batch Items List */}
                      {isBatch && batchItems && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                            All Items ({batchItems.length})
                          </h3>
                          <div className="space-y-3">
                            {batchItems.map((batchItem, index) => (
                              <div
                                key={batchItem.id}
                                className="bg-neutral-50 border border-neutral-200 p-4 hover:border-indigo-200 transition-colors"
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <h4 className="text-[14px] font-semibold text-neutral-900 flex-1">
                                    {batchItem.source_data?.subject || 'No subject'}
                                  </h4>
                                  <span className="text-[11px] text-neutral-500 ml-2">
                                    #{index + 1}
                                  </span>
                                </div>
                                <p className="text-[13px] text-neutral-600 mb-2">
                                  From: {batchItem.source_data?.from_name || batchItem.source_data?.from || 'Unknown'}
                                </p>
                                {batchItem.what_i_prepared && (
                                  <p className="text-[12px] text-neutral-700 line-clamp-2 mt-2">
                                    {batchItem.what_i_prepared}
                                  </p>
                                )}
                                <p className="text-[11px] text-neutral-500 mt-2">
                                  {new Date(batchItem.created_at).toLocaleString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* What Was Prepared - Only for non-executable items */}
                      {!isBatch && !isExecutable(item) && item.what_i_prepared && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            What Was Prepared
                          </h3>
                          <p className="text-[14px] text-neutral-900 leading-relaxed">
                            {item.what_i_prepared}
                          </p>
                        </div>
                      )}

                      {/* Why This Matters - Only for non-executable items */}
                      {!isBatch && !isExecutable(item) && item.why_matters && (
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
                      {!isBatch && sourceData?.draft && (
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
                      {!isBatch && (
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
                      )}

                      {/* Involved Parties */}
                      {!isBatch && recipientContext?.otherRecipients && recipientContext.otherRecipients.length > 0 && (
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
                      {!isBatch && sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
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
                      {!isBatch && sourceData?.thread_history && sourceData.thread_history.length > 1 && (
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
                      {!isBatch && recipientContext && (
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
                      {isBatch ? (
                        // Batch actions
                        <div className="space-y-2">
                          <p className="text-[12px] text-neutral-600 mb-3">
                            Actions will apply to all {batchItems?.length} items
                          </p>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={handleCompleteAll}
                              disabled={isCompleting}
                              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                            >
                              <CheckIcon className="w-4 h-4 mr-2" />
                              {isCompleting ? 'Completing...' : 'Mark All Complete'}
                            </button>
                            <button
                              onClick={handleDismissAll}
                              disabled={isDismissing}
                              className="px-4 py-2.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 transition-colors border border-neutral-300"
                            >
                              {isDismissing ? 'Dismissing...' : 'Dismiss All'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Single item actions
                        <div className="flex items-center gap-3">
                          {/* Executable work actions */}
                          {isExecutable(item) && (
                            <>
                              {item.execution_status === 'queued' && (
                                <button
                                  onClick={() => alert('Execution engine coming in Layer 3! This will start the AI execution.')}
                                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm hover:shadow"
                                >
                                  <span className="mr-2">▶️</span>
                                  Execute Work
                                </button>
                              )}
                              {item.execution_status === 'running' && (
                                <button
                                  disabled
                                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-blue-600 text-white opacity-75 cursor-not-allowed"
                                >
                                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  In Progress...
                                </button>
                              )}
                              {item.execution_status === 'awaiting_approval' && (
                                <button
                                  onClick={() => alert('Review artifacts and approve/reject the execution')}
                                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-orange-600 text-white hover:bg-orange-700 transition-all shadow-sm hover:shadow"
                                >
                                  <CheckIcon className="w-4 h-4 mr-2" />
                                  Review & Approve
                                </button>
                              )}
                              {item.execution_status === 'completed' && (
                                <button
                                  onClick={() => alert('Send the generated artifacts')}
                                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-green-600 text-white hover:bg-green-700 transition-all shadow-sm hover:shadow"
                                >
                                  <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                                  Send Result
                                </button>
                              )}
                            </>
                          )}

                          {/* Regular work actions */}
                          {!isExecutable(item) && (
                            <>
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
                            </>
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
                      )}
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
