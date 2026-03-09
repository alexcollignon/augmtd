'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  EnvelopeIcon,
  CalendarIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  CheckIcon,
  PaperAirplaneIcon,
  VideoCameraIcon,
  MapPinIcon,
  PaperClipIcon,
  ArchiveBoxArrowDownIcon,
  FolderArrowDownIcon,
  PencilIcon,
  XMarkIcon,
  SparklesIcon,
  BookmarkIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import { isExecutable, needsConfirmation } from '@/lib/types/inbox';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import DraftPreviewModal from './draft-preview-modal';
import type { SavedWorkflow } from '@/lib/types/work-blueprints';

interface WorkDetailInlineProps {
  item: InboxItem | null;
  onItemConfirmed?: (ids: string[], action: 'confirm_as_mine' | 'not_my_task') => void;
}

export default function WorkDetailInline({ item, onItemConfirmed }: WorkDetailInlineProps) {
  const [isOpeningWorkflow, setIsOpeningWorkflow] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState<Record<number, boolean>>({});
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveConfirmPending, setArchiveConfirmPending] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[] | null>(null);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const [suggestedWorkflows, setSuggestedWorkflows] = useState<Array<Pick<SavedWorkflow, 'id' | 'name' | 'deliverable_types'> & { score: number }>>([]);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  const [freshPrompt, setFreshPrompt] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

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

  // Reset folder state when item changes
  useEffect(() => {
    setShowMoveMenu(false);
    setFolders(null);
    setExpandedEmails({});
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close move menu on outside click
  useEffect(() => {
    if (!showMoveMenu) return;
    const handler = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setShowMoveMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoveMenu]);

  // Fetch ranked workflow suggestions + AI suggestion for this item
  useEffect(() => {
    if (!item?.id) return;
    setIsSuggesting(true);
    setAiSuggestion(null);
    setSuggestedWorkflows([]);
    setFreshPrompt('');
    setShowWorkflowPanel(false);
    fetch(`/api/inbox/${item.id}/suggest-workflows`, { method: 'POST' })
      .then(r => r.json())
      .then(({ rankedWorkflows, aiSuggestion: suggestion }) => {
        setSuggestedWorkflows(rankedWorkflows ?? []);
        setAiSuggestion(suggestion ?? null);
      })
      .catch(() => {})
      .finally(() => setIsSuggesting(false));
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunWithWorkflow = async (workflowId: string) => {
    setIsOpeningWorkflow(true);
    try {
      const res = await fetch(`/api/work/saved-workflows/${workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxItemId: item.id }),
      });
      if (res.ok) {
        const { threadId } = await res.json();
        window.location.href = `/work?thread=${threadId}`;
      } else {
        toast.error('Failed to run workflow. Please try again.');
      }
    } catch {
      toast.error('Failed to run workflow. Please try again.');
    } finally {
      setIsOpeningWorkflow(false);
    }
  };

  const handleOpenInWorkflows = async (prompt?: string) => {
    setIsOpeningWorkflow(true);
    try {
      const response = await fetch(`/api/inbox/${item.id}/open-workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prompt ? { prompt } : {}),
      });
      if (response.ok) {
        const { threadId } = await response.json();
        const view = item.execution_status === 'ready' ? '&view=document' : '';
        window.location.href = `/work?thread=${threadId}${view}`;
      } else {
        toast.error('Failed to open workflow. Please try again.');
      }
    } catch {
      toast.error('Failed to open workflow. Please try again.');
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

  const handleOpenMoveMenu = async () => {
    setShowMoveMenu(true);
    if (folders !== null) return;
    setIsLoadingFolders(true);
    try {
      const res = await fetch(`/api/inbox/${item.id}/email-folders`);
      const data = await res.json();
      setFolders(res.ok ? (data.folders ?? []) : []);
    } catch {
      setFolders([]);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const handleMoveToFolder = async (folderId: string, folderName: string) => {
    setIsMoving(true);
    setShowMoveMenu(false);
    try {
      const res = await fetch(`/api/inbox/${item.id}/move-to-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, folderName }),
      });
      if (res.ok) {
        toast.success(`Moved to ${folderName}`);
        onItemConfirmed?.([item.id], 'not_my_task');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to move email');
      }
    } catch {
      toast.error('Failed to move email');
    } finally {
      setIsMoving(false);
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
    try {
      await confirmItem(item.id, confirmed);
      onItemConfirmed?.([item.id], action);
    } catch {
      alert('Failed to update. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleArchiveSource = async () => {
    setIsArchiving(true);
    try {
      const res = await fetch(`/api/inbox/${item.id}/archive-source`, { method: 'POST' });
      if (!res.ok) throw new Error('Archive failed');
      toast.success('Email archived');
      onItemConfirmed?.([item.id], 'not_my_task');
    } catch {
      toast.error('Could not archive email');
    } finally {
      setIsArchiving(false);
    }
  };

  const handleDownloadAttachment = async (filename: string) => {
    setDownloadingFile(filename);
    try {
      const response = await fetch(
        `/api/inbox/${item.id}/attachment?filename=${encodeURIComponent(filename)}`
      );
      if (response.ok) {
        const { signedUrl } = await response.json();
        window.open(signedUrl, '_blank');
      } else {
        console.error('Failed to get attachment URL');
      }
    } catch (error) {
      console.error('Download attachment error:', error);
    } finally {
      setDownloadingFile(null);
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
    <div ref={rootRef} className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-neutral-100">
        <h2 className="text-[17px] font-semibold text-neutral-900 leading-tight">
          {item.work_title || sourceData?.subject || 'Work Item'}
        </h2>
        {(sourceData?.from_name || sourceData?.from) && (
          <p className="text-[13px] text-neutral-500 mt-1">
            From {sourceData.from_name || sourceData.from}
            {sourceData.from_name && sourceData.from && (
              <span className="text-neutral-400 text-[12px]"> · {sourceData.from}</span>
            )}
          </p>
        )}
        {recipientContext?.otherRecipients && recipientContext.otherRecipients.length > 0 && (
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Also on thread: {recipientContext.otherRecipients.slice(0, 3).join(', ')}
            {recipientContext.otherRecipients.length > 3 && ` +${recipientContext.otherRecipients.length - 3} more`}
          </p>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Confirmation banner for suggested items */}
        {needsConfirmation(item) && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200">
            <CheckCircleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-amber-900">AI suggested this work item</p>
              <p className="text-[12px] text-amber-700 mt-0.5">Confirm if relevant to you, or dismiss.</p>
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
            </div>
          </div>
        )}

        {/* Summary — what was prepared / what sender is requesting */}
        {!executable && item.what_i_prepared && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
              Summary
            </h3>
            <p className="text-[13px] text-neutral-800 leading-relaxed">{item.what_i_prepared}</p>
          </div>
        )}

        {/* What will be created — compact inline for executable */}
        {executable && item.execution_plan && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wide text-indigo-600 font-semibold px-1.5 py-0.5 bg-indigo-50 border border-indigo-100">
                {item.execution_plan.deliverable_type}
              </span>
              <span className="text-[13px] text-neutral-700">{item.execution_plan.deliverable_description}</span>
              {item.execution_plan.deadline && (
                <span className="text-[11px] text-orange-500 font-medium flex items-center gap-1">
                  <CalendarIcon className="w-3.5 h-3.5" />
                  Due {new Date(item.execution_plan.deadline).toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="text-[12px] text-neutral-400">Open in Workflows to build a step-by-step plan.</p>
          </div>
        )}

        {/* Meeting details */}
        {hasMeetingData() && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
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
        {sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
              Key Points
            </h3>
            <ul className="space-y-1.5">
              {sourceData.keyPoints.map((point: string, i: number) => (
                <li key={i} className="flex items-start text-[13px] text-neutral-700">
                  <span className="text-indigo-500 mr-2 font-bold flex-shrink-0">·</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Draft reply */}
        {sourceData?.draft && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
              Prepared Reply
            </h3>
            <div className="relative bg-neutral-50 border border-neutral-200 p-4">
              <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-indigo-400" />
              <p className="pl-3 text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                {typeof sourceData.draft === 'string' ? sourceData.draft : sourceData.draft.body}
              </p>
            </div>
          </div>
        )}

        {/* Thread history — expandable, latest auto-expanded, no snippet when collapsed */}
        {sourceData?.thread_history && sourceData.thread_history.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
              Thread
            </h3>
            <div className="space-y-1.5">
              {sourceData.thread_history.slice(0, 5).map((msg: any, i: number) => {
                const isLast = i === Math.min(sourceData.thread_history.length, 5) - 1;
                const body = isLast && sourceData.body ? sourceData.body : msg.snippet;
                const isExpanded = !!expandedEmails[i];

                return (
                  <div
                    key={i}
                    className={`border text-[12px] ${isLast ? 'border-neutral-200 bg-white' : 'border-neutral-100 bg-neutral-50/50'}`}
                  >
                    <button
                      onClick={() => setExpandedEmails(prev => ({ ...prev, [i]: !prev[i] }))}
                      className="w-full flex items-center justify-between px-3 py-2 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`font-medium truncate ${isLast ? 'text-neutral-900' : 'text-neutral-600'}`}>
                          {msg.from_name || msg.from}
                        </span>
                        {isLast && sourceData.thread_history.length > 1 && (
                          <span className="flex-shrink-0 text-[10px] font-medium text-indigo-400 uppercase tracking-wide">
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-neutral-400">
                          {new Date(msg.received_at).toLocaleDateString()}
                        </span>
                        <ChevronRightIcon
                          className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-neutral-100 pt-2.5">
                        {msg.subject && msg.subject !== sourceData.subject && (
                          <p className="text-neutral-400 text-[11px] mb-2">{msg.subject}</p>
                        )}
                        <p className="text-[12px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
                          {body}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Attachments — chips */}
        {sourceData?.attachments && sourceData.attachments.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
              Attachments
            </h3>
            <div className="flex flex-wrap gap-2">
              {sourceData.attachments.map((att: { filename: string; mimeType: string; size: number; storagePath: string }, i: number) => (
                <button
                  key={i}
                  onClick={() => handleDownloadAttachment(att.filename)}
                  disabled={downloadingFile === att.filename}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 text-neutral-700 transition-colors disabled:opacity-50 max-w-[200px]"
                >
                  <PaperClipIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
                  <span className="truncate">{att.filename}</span>
                  {downloadingFile === att.filename && (
                    <div className="w-3 h-3 border border-neutral-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}


      </div>

      {/* Actions footer */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 flex-1">
              {/* Preparing state */}
              {executable && item.execution_status === 'preparing' && (
                <div className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold bg-indigo-50 text-indigo-500 border border-indigo-200 cursor-default">
                  <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  Preparing work…
                </div>
              )}

              {/* Ready state — direct to prepared document */}
              {executable && item.execution_status === 'ready' && (
                <button
                  onClick={() => handleOpenInWorkflows()}
                  disabled={isOpeningWorkflow}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  {isOpeningWorkflow ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Opening…
                    </>
                  ) : (
                    <>
                      <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                      See prepared work
                    </>
                  )}
                </button>
              )}

              {/* Draft reply — split button: instant send | edit & review */}
              {!executable && sourceData?.draft && (
                <div className="flex-1 flex">
                  <button
                    onClick={() => handleSendReply()}
                    disabled={isSending}
                    className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm"
                  >
                    {isSending ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    ) : (
                      <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                    )}
                    {isSending ? 'Sending…' : 'Send'}
                  </button>
                  <button
                    onClick={() => setShowDraftPreview(true)}
                    disabled={isSending}
                    className="px-3 py-2.5 bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-50 transition-all shadow-sm border-l border-indigo-500"
                    title="Review & edit before sending"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Mark complete — non-executable, no draft */}
              {!executable && !sourceData?.draft && (
                <button
                  onClick={handleComplete}
                  disabled={isCompleting}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  <CheckIcon className="w-4 h-4 mr-2" />
                  {isCompleting ? 'Completing...' : 'Mark Complete'}
                </button>
              )}

              {/* Move to folder */}
              {item.source === 'email' && sourceData?.provider ? (
                <div className="relative" ref={moveMenuRef}>
                  <button
                    onClick={handleOpenMoveMenu}
                    disabled={isMoving}
                    className="px-4 py-2.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 transition-colors border border-neutral-300 flex items-center gap-1.5"
                  >
                    {isMoving ? (
                      <div className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <FolderArrowDownIcon className="w-3.5 h-3.5" />
                    )}
                    Move to
                  </button>
                  {showMoveMenu && (
                    <div className="absolute bottom-full mb-1 right-0 bg-white border border-neutral-200 shadow-lg min-w-[180px] z-50">
                      {isLoadingFolders ? (
                        <div className="px-4 py-3 text-[12px] text-neutral-400 flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" />
                          Loading folders…
                        </div>
                      ) : !folders?.length ? (
                        <p className="px-4 py-3 text-[12px] text-neutral-400">No folders found</p>
                      ) : (
                        <div className="max-h-52 overflow-y-auto">
                          {folders.map(f => (
                            <button
                              key={f.id}
                              onClick={() => handleMoveToFolder(f.id, f.name)}
                              className="w-full text-left px-4 py-2.5 text-[13px] text-neutral-700 hover:bg-neutral-50 transition-colors border-b border-neutral-100 last:border-b-0"
                            >
                              {f.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
              {item.source === 'email' && sourceData?.provider && (
                isArchiving ? (
                  <div className="px-4 py-2.5 flex items-center gap-2 border border-indigo-200 bg-indigo-50 text-indigo-600">
                    <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className="text-[13px] font-semibold">Archiving…</span>
                  </div>
                ) : archiveConfirmPending ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 border border-indigo-300 bg-indigo-50">
                    <ArchiveBoxArrowDownIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                    <span className="text-[12px] font-semibold text-indigo-800">Archive?</span>
                    <button
                      onClick={() => { setArchiveConfirmPending(false); handleArchiveSource(); }}
                      className="ml-1 w-6 h-6 flex items-center justify-center bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex-shrink-0"
                      title="Confirm"
                    >
                      <CheckIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <button
                      onClick={() => setArchiveConfirmPending(false)}
                      className="w-6 h-6 flex items-center justify-center border border-neutral-300 text-neutral-500 hover:bg-neutral-100 transition-colors flex-shrink-0"
                      title="Cancel"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setArchiveConfirmPending(true)}
                    className="px-4 py-2.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors border border-neutral-300 flex items-center gap-2"
                  >
                    <ArchiveBoxArrowDownIcon className="w-4 h-4" />
                    Archive
                  </button>
                )
              )}
          </div>

              {/* Workflows — always on the right */}
              <button
                onClick={() => {
                  if (!isOpeningWorkflow) {
                    if (rootRef.current) setPanelTop(rootRef.current.getBoundingClientRect().top);
                    setShowWorkflowPanel(true);
                  }
                }}
                disabled={isOpeningWorkflow}
                className="flex-shrink-0 px-3 py-2.5 text-[13px] font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-indigo-200 flex items-center gap-1.5"
              >
                {isOpeningWorkflow ? (
                  <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <PlayIcon className="w-3.5 h-3.5" />
                )}
                Workflows
              </button>
        </div>
      </div>

      {/* Backdrop — only when panel is open */}
      {showWorkflowPanel && (
        <div className="fixed inset-0 z-30" onClick={() => setShowWorkflowPanel(false)} />
      )}

      {/* Workflow suggestions panel — always in DOM, slides over calendar column */}
      <div
        className={`fixed right-0 bottom-0 w-[272px] z-40 bg-white border-l border-neutral-200 shadow-xl flex flex-col transition-[transform,opacity] duration-200 ease-in-out ${
          showWorkflowPanel ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
        }`}
        style={{ top: panelTop }}
      >
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-neutral-200">
            <div className="flex items-center gap-2">
              <SparklesIcon className="w-4 h-4 text-indigo-500" />
              <span className="text-[13px] font-semibold text-neutral-900">Run a workflow</span>
            </div>
            <button
              onClick={() => setShowWorkflowPanel(false)}
              className="text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            {/* Active/existing thread for this item */}
            {item.work_thread_id && (
              <button
                onClick={() => { window.location.href = `/work?thread=${item.work_thread_id}`; }}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-green-50 border border-green-300 hover:bg-green-100 transition-colors group text-left mb-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="text-[13px] font-medium text-green-900 truncate">Continue in Workflows</span>
                </div>
                <ChevronRightIcon className="w-3.5 h-3.5 text-green-500 flex-shrink-0 ml-2" />
              </button>
            )}

            {isSuggesting ? (
              <>
                {/* Loading skeletons */}
                <div className="p-3 border border-indigo-100 bg-indigo-50/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 rounded bg-indigo-200 animate-pulse flex-shrink-0" />
                    <div className="h-3 bg-indigo-200 animate-pulse rounded flex-1" />
                  </div>
                  <div className="h-3 bg-indigo-100 animate-pulse rounded w-3/4 ml-5" />
                </div>
                {[1, 2].map(i => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2.5 border border-neutral-200 bg-white">
                    <div className="w-3.5 h-3.5 rounded bg-neutral-200 animate-pulse flex-shrink-0" />
                    <div className="h-3 bg-neutral-200 animate-pulse rounded flex-1" />
                    <div className="h-3 bg-neutral-100 animate-pulse rounded w-8 flex-shrink-0" />
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2.5 border border-dashed border-neutral-200">
                  <div className="h-3 bg-neutral-100 animate-pulse rounded w-16" />
                  <div className="w-3.5 h-3.5 rounded bg-neutral-100 animate-pulse flex-shrink-0" />
                </div>
              </>
            ) : (
              <>
                {/* AI suggestion */}
                {aiSuggestion && (
                  <div className="border border-indigo-200 bg-indigo-50 overflow-hidden">
                    <div className="flex items-start gap-2 px-3 pt-3 pb-2.5">
                      <SparklesIcon className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[12.5px] text-indigo-900 leading-snug">{aiSuggestion}</p>
                    </div>
                    <button
                      onClick={() => { setShowWorkflowPanel(false); handleOpenInWorkflows(); }}
                      disabled={isOpeningWorkflow}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      Run this
                      <ChevronRightIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Ranked saved workflows */}
                {suggestedWorkflows.map(wf => (
                  <button
                    key={wf.id}
                    onClick={() => { setShowWorkflowPanel(false); handleRunWithWorkflow(wf.id); }}
                    disabled={isOpeningWorkflow}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors group disabled:opacity-50 text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BookmarkIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                      <span className="text-[13px] font-medium text-neutral-900 group-hover:text-indigo-700 truncate">{wf.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      {wf.deliverable_types.length > 0 && (
                        <span className="text-[11px] text-neutral-400">{wf.deliverable_types.join('+')}</span>
                      )}
                      {wf.score >= 0.3 && (
                        <span className="text-[11px] text-neutral-400">{Math.round(wf.score * 100)}%</span>
                      )}
                      <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-400 transition-colors" />
                    </div>
                  </button>
                ))}

                {/* Start fresh — custom prompt */}
                <div className="border border-dashed border-neutral-300 mt-1">
                  <textarea
                    rows={2}
                    value={freshPrompt}
                    onChange={e => setFreshPrompt(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey && freshPrompt.trim()) {
                        e.preventDefault();
                        setShowWorkflowPanel(false);
                        handleOpenInWorkflows(freshPrompt.trim());
                      }
                    }}
                    placeholder="What do you want to do with this email?"
                    className="w-full px-3 py-2.5 text-[12.5px] text-neutral-700 placeholder:text-neutral-400 bg-transparent outline-none resize-none leading-snug"
                  />
                  {freshPrompt.trim() && (
                    <div className="px-3 pb-2.5 flex justify-end">
                      <button
                        onClick={() => { setShowWorkflowPanel(false); handleOpenInWorkflows(freshPrompt.trim()); }}
                        disabled={isOpeningWorkflow}
                        className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex items-center gap-0.5 transition-colors"
                      >
                        Open
                        <ArrowTopRightOnSquareIcon className="w-3 h-3 ml-0.5" />
                      </button>
                    </div>
                  )}
                </div>
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
