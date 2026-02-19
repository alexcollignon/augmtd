'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  UserIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  DocumentChartBarIcon,
  DocumentIcon,
  MagnifyingGlassIcon,
  EnvelopeIcon,
  CalendarIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  CheckIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  VideoCameraIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import { isExecutable, needsConfirmation } from '@/lib/types/inbox';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import DraftPreviewModal from './draft-preview-modal';

interface WorkDetailInlineProps {
  item: InboxItem | null;
  onItemConfirmed?: (ids: string[], action: 'confirm_as_mine' | 'not_my_task') => void;
}

export default function WorkDetailInline({ item, onItemConfirmed }: WorkDetailInlineProps) {
  const [isOpeningWorkflow, setIsOpeningWorkflow] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const [showOriginalEmail, setShowOriginalEmail] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBatchCompleting, setIsBatchCompleting] = useState(false);
  const [isBatchDismissing, setIsBatchDismissing] = useState(false);

  if (!item) {
    return (
      <div className="flex-1 flex items-center justify-center bg-neutral-50/40 h-full">
        <div className="text-center">
          <div className="w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <EnvelopeIcon className="w-6 h-6 text-neutral-300" />
          </div>
          <p className="text-[13px] text-neutral-400">Select an email to see prepared work</p>
        </div>
      </div>
    );
  }

  const sourceData = item.source_data;
  const recipientContext = item.recipient_context;
  const executable = isExecutable(item);
  const isBatch = (item as any).__isBatch === true;
  const [batchItems, setBatchItems] = useState<InboxItem[]>((item as any).__batchItems || []);

  const handleOpenInWorkflows = async () => {
    setIsOpeningWorkflow(true);
    try {
      const response = await fetch(`/api/inbox/${item.id}/open-workflow`, { method: 'POST' });
      if (response.ok) {
        const { threadId, workflowPrompt } = await response.json();
        const url = workflowPrompt
          ? `/work?thread=${threadId}&prompt=${encodeURIComponent(workflowPrompt)}`
          : `/work?thread=${threadId}`;
        window.location.href = url;
      } else {
        alert('Failed to open workflow. Please try again.');
      }
    } catch {
      alert('Failed to open workflow. Please try again.');
    } finally {
      setIsOpeningWorkflow(false);
    }
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
        toast.success('Reply sent successfully');
        onItemConfirmed?.([item.id], 'not_my_task');
      } else {
        toast.error('Failed to send reply. Please try again.');
      }
    } catch {
      toast.error('Failed to send reply. Please try again.');
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
        toast.success('Marked as complete');
        onItemConfirmed?.([item.id], 'not_my_task');
      } else {
        toast.error('Failed to complete item. Please try again.');
      }
    } catch {
      toast.error('Failed to complete item. Please try again.');
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
        toast.success('Item dismissed');
        onItemConfirmed?.([item.id], 'not_my_task');
      } else {
        toast.error(data.error || 'Failed to dismiss item. Please try again.');
      }
    } catch {
      toast.error('Failed to dismiss item. Please try again.');
    } finally {
      setIsDismissing(false);
    }
  };

  const confirmItem = async (id: string, confirmed: boolean) => {
    const action = confirmed ? 'confirm_as_mine' : 'not_my_task';
    await fetch(`/api/inbox/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  };

  const handleConfirmation = async (confirmed: boolean) => {
    setIsConfirming(true);
    const action = confirmed ? 'confirm_as_mine' : 'not_my_task';
    const ids = isBatch ? batchItems.map(b => b.id) : [item.id];
    try {
      await Promise.all(ids.map(id => confirmItem(id, confirmed)));
      onItemConfirmed?.(ids, action);
    } catch {
      alert('Failed to update. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSingleItemConfirmation = async (id: string, confirmed: boolean) => {
    const action = confirmed ? 'confirm_as_mine' : 'not_my_task';
    setBatchItems(prev => prev.filter(b => b.id !== id));
    try {
      await confirmItem(id, confirmed);
      onItemConfirmed?.([id], action);
    } catch {
      setBatchItems(prev => [...prev]); // revert on error isn't trivial, just let polling correct it
      alert('Failed to update. Please try again.');
    }
  };

  const handleBatchComplete = async () => {
    setIsBatchCompleting(true);
    try {
      await Promise.all(batchItems.map(b =>
        fetch(`/api/inbox/${b.id}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reviewed' }),
        })
      ));
      onItemConfirmed?.(batchItems.map(b => b.id), 'not_my_task');
    } catch {
      alert('Failed to complete items. Please try again.');
    } finally {
      setIsBatchCompleting(false);
    }
  };

  const handleBatchDismiss = async () => {
    setIsBatchDismissing(true);
    try {
      await Promise.all(batchItems.map(b =>
        fetch(`/api/inbox/${b.id}/dismiss`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'not_relevant' }),
        })
      ));
      onItemConfirmed?.(batchItems.map(b => b.id), 'not_my_task');
    } catch {
      alert('Failed to dismiss items. Please try again.');
    } finally {
      setIsBatchDismissing(false);
    }
  };

  const stripHtml = (html: string): string => {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/td>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const hasMeetingData = () => !!(
    sourceData?.meeting_link || sourceData?.event_id ||
    sourceData?.start_time || sourceData?.calendar_event
  );

  const formatMeetingTime = (startTime: string, endTime?: string) => {
    const start = new Date(startTime);
    const now = new Date();
    const isToday = start.toDateString() === now.toDateString();
    const isTomorrow = start.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    const dateLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (endTime) {
      const endStr = new Date(endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${dateLabel} · ${timeStr}–${endStr}`;
    }
    return `${dateLabel} · ${timeStr}`;
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-neutral-100 bg-gradient-to-r from-indigo-50/50 to-white">
        <h2 className="text-[17px] font-semibold text-neutral-900 leading-tight">
          {item.work_title || sourceData?.subject || 'Work Item'}
        </h2>
        {!isBatch && (sourceData?.from_name || sourceData?.from) && (
          <p className="text-[13px] text-neutral-500 mt-1">
            From {sourceData.from_name || sourceData.from}
            {sourceData.from_name && sourceData.from && (
              <span className="text-neutral-400 text-[12px]"> · {sourceData.from}</span>
            )}
          </p>
        )}
        {isBatch && (
          <p className="text-[13px] text-indigo-600 font-medium mt-1">
            {batchItems.length} similar items
          </p>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Confirmation banner for suggested items */}
        {(isBatch ? batchItems.some(b => needsConfirmation(b)) : needsConfirmation(item)) && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200">
            <CheckCircleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-amber-900">
                {isBatch ? `AI suggested these ${batchItems.length} items` : 'AI suggested this work item'}
              </p>
              <p className="text-[12px] text-amber-700 mt-0.5">
                {isBatch ? 'Use ✓ / ✗ on each item, or use the bulk actions below.' : 'Confirm if relevant to you, or dismiss.'}
              </p>
              {!isBatch && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleConfirmation(true)}
                    disabled={isConfirming}
                    className="px-4 py-1.5 text-[12px] font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {isConfirming ? 'Saving...' : "Yes, it's mine"}
                  </button>
                  <button
                    onClick={() => handleConfirmation(false)}
                    disabled={isConfirming}
                    className="px-4 py-1.5 text-[12px] font-semibold bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                  >
                    Not mine
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Batch: list of items */}
        {isBatch && (
          <div>
            <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">
              All Items ({batchItems.length})
            </h3>
            <div className="space-y-2">
              {batchItems.map((bItem) => (
                <div key={bItem.id} className="bg-neutral-50 border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-neutral-900 mb-0.5">
                        {bItem.source_data?.subject || 'No subject'}
                      </p>
                      <p className="text-[12px] text-neutral-500">
                        {bItem.source_data?.from_name || bItem.source_data?.from || 'Unknown'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleSingleItemConfirmation(bItem.id, true)}
                        title="Mine"
                        className="w-7 h-7 flex items-center justify-center bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleSingleItemConfirmation(bItem.id, false)}
                        title="Not mine"
                        className="w-7 h-7 flex items-center justify-center bg-white border border-neutral-200 text-neutral-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Executable work */}
        {!isBatch && executable && item.execution_plan && (
          <div className="space-y-5">
            {(sourceData?.from_name || sourceData?.from || item.why_matters) && (
              <div>
                <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                  Requested by
                </h3>
                <div className="flex items-start gap-3 p-3 bg-neutral-50 border border-neutral-200">
                  <UserIcon className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] font-medium text-neutral-900">
                      {sourceData?.from_name || sourceData?.from || 'Unknown'}
                    </p>
                    {item.why_matters && (
                      <p className="text-[12px] text-neutral-600 mt-0.5">{item.why_matters}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                What will be created
              </h3>
              <div className="flex items-start gap-3 p-4 bg-white border border-neutral-300">
                <div className="flex-shrink-0 w-9 h-9 bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  {item.execution_plan.deliverable_type === 'report' && <DocumentTextIcon className="w-5 h-5 text-indigo-600" />}
                  {item.execution_plan.deliverable_type === 'presentation' && <PresentationChartBarIcon className="w-5 h-5 text-indigo-600" />}
                  {item.execution_plan.deliverable_type === 'spreadsheet' && <DocumentChartBarIcon className="w-5 h-5 text-indigo-600" />}
                  {item.execution_plan.deliverable_type === 'document' && <DocumentIcon className="w-5 h-5 text-indigo-600" />}
                  {item.execution_plan.deliverable_type === 'analysis' && <MagnifyingGlassIcon className="w-5 h-5 text-indigo-600" />}
                  {item.execution_plan.deliverable_type === 'email' && <EnvelopeIcon className="w-5 h-5 text-indigo-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-indigo-600 font-semibold">
                    {item.execution_plan.deliverable_type}
                  </span>
                  <p className="text-[14px] text-neutral-900 leading-relaxed mt-0.5">
                    {item.execution_plan.deliverable_description}
                  </p>
                  {item.execution_plan.deadline && (
                    <span className="inline-flex items-center gap-1 mt-2 text-[11px] text-orange-600 font-medium">
                      <CalendarIcon className="w-3.5 h-3.5" />
                      Due {new Date(item.execution_plan.deadline).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <p className="text-[12px] text-neutral-500">
              Open in Workflows to build and refine a step-by-step plan.
            </p>
          </div>
        )}

        {/* What was prepared (non-executable) */}
        {!isBatch && !executable && item.what_i_prepared && (
          <div>
            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
              What Was Prepared
            </h3>
            <p className="text-[14px] text-neutral-900 leading-relaxed">
              {item.what_i_prepared}
            </p>
          </div>
        )}

        {/* Meeting details */}
        {!isBatch && hasMeetingData() && (
          <div>
            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
              Meeting Details
            </h3>
            <div className="bg-indigo-50 border border-indigo-200 p-4 space-y-3">
              {(sourceData?.start_time || sourceData?.calendar_event?.start_time) && (
                <div className="flex items-start gap-3">
                  <CalendarIcon className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[13px] font-medium text-indigo-900">
                    {formatMeetingTime(
                      sourceData?.start_time || sourceData?.calendar_event?.start_time,
                      sourceData?.end_time || sourceData?.calendar_event?.end_time
                    )}
                  </p>
                </div>
              )}
              {(sourceData?.meeting_link || sourceData?.calendar_event?.meeting_link) && (
                <div className="flex items-start gap-3">
                  <VideoCameraIcon className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                  <a
                    href={sourceData?.meeting_link || sourceData?.calendar_event?.meeting_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-indigo-600 hover:underline font-medium"
                  >
                    Join Meeting
                  </a>
                </div>
              )}
              {(sourceData?.location || sourceData?.calendar_event?.location) && (
                <div className="flex items-start gap-3">
                  <MapPinIcon className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[13px] text-indigo-900">
                    {sourceData?.location || sourceData?.calendar_event?.location}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Key points */}
        {!isBatch && sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
              Key Points
            </h3>
            <ul className="space-y-2">
              {sourceData.keyPoints.map((point: string, i: number) => (
                <li key={i} className="flex items-start text-[13px] text-neutral-700">
                  <span className="text-indigo-600 mr-2 font-bold flex-shrink-0">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Draft reply */}
        {!isBatch && sourceData?.draft && (
          <div>
            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
              Prepared Reply
            </h3>
            <div className="relative bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 p-4">
              <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-indigo-500" />
              <p className="pl-3 text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                {typeof sourceData.draft === 'string' ? sourceData.draft : sourceData.draft.body}
              </p>
            </div>
          </div>
        )}

        {/* Also on thread */}
        {!isBatch && recipientContext?.otherRecipients && recipientContext.otherRecipients.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
              Also on Thread
            </h3>
            <div className="flex flex-wrap gap-2">
              {recipientContext.otherRecipients.slice(0, 5).map((email, i) => (
                <span key={i} className="inline-flex items-center px-3 py-1.5 text-[12px] bg-neutral-100 text-neutral-700 border border-neutral-200">
                  <UserIcon className="w-3 h-3 mr-1.5" />
                  {email}
                </span>
              ))}
              {recipientContext.otherRecipients.length > 5 && (
                <span className="inline-flex items-center px-3 py-1.5 text-[12px] text-neutral-500">
                  +{recipientContext.otherRecipients.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Thread history */}
        {!isBatch && sourceData?.thread_history && sourceData.thread_history.length > 1 && (
          <div>
            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
              Thread History
            </h3>
            <div className="space-y-2">
              {sourceData.thread_history.slice(0, 3).map((msg: any, i: number) => (
                <div key={i} className="bg-neutral-50 border border-neutral-200 p-3 text-[12px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-neutral-900">{msg.from_name || msg.from}</span>
                    <span className="text-neutral-500">{new Date(msg.received_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-neutral-600 line-clamp-2">{msg.snippet}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Original email */}
        {!isBatch && (sourceData?.body || sourceData?.snippet) && (
          <div>
            <button
              onClick={() => setShowOriginalEmail(!showOriginalEmail)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide hover:text-neutral-700 transition-colors"
            >
              <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-150 ${showOriginalEmail ? 'rotate-90' : ''}`} />
              Original Email
            </button>
            {showOriginalEmail && (
              <div className="mt-2 bg-neutral-50 border border-neutral-200">
                <div className="px-4 py-3 border-b border-neutral-200 space-y-1">
                  {(sourceData?.from_name || sourceData?.from) && (
                    <div className="flex gap-2 text-[12px]">
                      <span className="text-neutral-400 w-12 flex-shrink-0">From</span>
                      <span className="text-neutral-800">
                        {sourceData.from_name}
                        {sourceData.from && <span className="text-neutral-500"> &lt;{sourceData.from}&gt;</span>}
                      </span>
                    </div>
                  )}
                  {sourceData?.subject && (
                    <div className="flex gap-2 text-[12px]">
                      <span className="text-neutral-400 w-12 flex-shrink-0">Subject</span>
                      <span className="text-neutral-800">{sourceData.subject}</span>
                    </div>
                  )}
                </div>
                <div className="px-4 py-3">
                  <p className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
                    {stripHtml(sourceData.body || sourceData.snippet)}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions footer */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
        <div className="flex items-center gap-3">
          {isBatch ? (
            <>
              <button
                onClick={handleBatchComplete}
                disabled={isBatchCompleting || isBatchDismissing}
                className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                <CheckIcon className="w-4 h-4 mr-2" />
                {isBatchCompleting ? 'Completing...' : 'Mark All Complete'}
              </button>
              <button
                onClick={handleBatchDismiss}
                disabled={isBatchCompleting || isBatchDismissing}
                className="px-4 py-2.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 transition-colors border border-neutral-300"
              >
                {isBatchDismissing ? 'Dismissing...' : 'Dismiss All'}
              </button>
            </>
          ) : (
            <>
              {executable && (
                <>
                  {sourceData?.draft && (
                    <button
                      onClick={() => setShowDraftPreview(true)}
                      className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-white text-indigo-700 border border-indigo-300 hover:bg-indigo-50 transition-all"
                    >
                      <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                      Review & Send
                    </button>
                  )}
                  <button
                    onClick={handleOpenInWorkflows}
                    disabled={isOpeningWorkflow}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                  >
                    {isOpeningWorkflow ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Opening...
                      </>
                    ) : (
                      <>
                        <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                        Open in Workflows
                      </>
                    )}
                  </button>
                </>
              )}

              {!executable && (
                <>
                  {sourceData?.draft && (
                    <button
                      onClick={() => setShowDraftPreview(true)}
                      className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm"
                    >
                      <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                      Review & Send
                    </button>
                  )}
                  {!sourceData?.draft && (
                    <button
                      onClick={handleComplete}
                      disabled={isCompleting}
                      className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                    >
                      <CheckIcon className="w-4 h-4 mr-2" />
                      {isCompleting ? 'Completing...' : 'Mark Complete'}
                    </button>
                  )}
                </>
              )}

              <button
                onClick={handleDismiss}
                disabled={isDismissing}
                className="px-4 py-2.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 transition-colors border border-neutral-300"
              >
                {isDismissing ? 'Dismissing...' : 'Dismiss'}
              </button>
            </>
          )}
        </div>
      </div>

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
    </div>
  );
}
