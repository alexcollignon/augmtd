'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  ArrowLeftIcon,
  PaperAirplaneIcon,
  UserIcon,
  CheckIcon,
  CalendarIcon,
  ArrowTopRightOnSquareIcon,
  MapPinIcon,
  VideoCameraIcon,
  ChevronRightIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import { isExecutable } from '@/lib/types/inbox';
import RecipientContextDisplay from './recipient-context-display';
import RsvpButtons from './rsvp-buttons';
import { createClient } from '@/lib/supabase/client';

interface WorkDetailPanelProps {
  item: InboxItem;
  isOpen: boolean;
  onClose: () => void;
  batchItems?: InboxItem[]; // If provided, this is a batch view
}

export default function WorkDetailPanel({ item, isOpen, onClose, batchItems }: WorkDetailPanelProps) {
  const [selectedBatchItem, setSelectedBatchItem] = useState<InboxItem | null>(null);

  // When viewing a selected batch item, treat it as a single item (not a batch)
  const isBatch = batchItems && batchItems.length > 1 && !selectedBatchItem;

  // Use selected batch item if viewing individual item in batch, otherwise use main item
  const currentItem = selectedBatchItem || item;
  const sourceData = currentItem.source_data;
  const recipientContext = currentItem.recipient_context;

  const [isSending, setIsSending] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isOpeningWorkflow, setIsOpeningWorkflow] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState<Record<number, boolean>>({});
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [linkedCalEvent, setLinkedCalEvent] = useState<{ id: string; attendees: any[] } | null>(null);

  const RSVP_LABELS: Record<string, string> = {
    accepted: 'Meeting accepted',
    tentative: 'Marked as maybe',
    declined: 'Meeting declined',
  };

  const handleRsvpDismiss = useCallback(async (response: string) => {
    toast.success(RSVP_LABELS[response] ?? 'RSVP updated');
    try {
      await fetch(`/api/inbox/${currentItem.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reviewed' }),
      });
    } catch { /* non-fatal */ }
    handleClose();
  }, [currentItem.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Look up matching calendar event — by time range, or by title extracted from invite subject
  useEffect(() => {
    setLinkedCalEvent(null);

    const lookup = async () => {
      const sd = item.source_data as any;
      const supabase = createClient();

      // 0. Direct lookup by calendar_event_id stored at sync time (language-independent)
      if (sd?.calendar_event_id) {
        const { data } = await supabase
          .from('calendar_events')
          .select('id, attendees')
          .eq('id', sd.calendar_event_id)
          .maybeSingle();
        if (data) { setLinkedCalEvent(data); return; }
      }

      const startTime = sd?.start_time || sd?.calendar_event?.start_time;
      const subject: string = sd?.subject || '';

      // 1. Try time-range lookup
      if (startTime) {
        const rangeStart = new Date(new Date(startTime).getTime() - 30 * 60 * 1000).toISOString();
        const rangeEnd = new Date(new Date(startTime).getTime() + 30 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from('calendar_events')
          .select('id, attendees')
          .gte('start_time', rangeStart)
          .lte('start_time', rangeEnd)
          .eq('status', 'confirmed')
          .limit(1)
          .maybeSingle();
        if (data) { setLinkedCalEvent(data); return; }
      }

      // 2. Fall back to title-based lookup from subject
      // Gmail: "Convite: Title @ date", Outlook: "Convite: Title - sáb. 14 mar..."
      if (subject) {
        const match =
          subject.match(/^(?:Convite|Invitation|Updated invitation|Invite|Convidado|Actualizado):\s*(.+?)\s*@\s*/i) ||
          subject.match(/^(?:Convite|Invitation|Updated invitation|Invite|Convidado|Actualizado):\s*(.+?)\s+-\s+(?:dom|seg|ter|qua|qui|sex|sáb|sun|mon|tue|wed|thu|fri|sat|\d)/i);
        if (match) {
          const title = match[1].trim();
          const { data } = await supabase
            .from('calendar_events')
            .select('id, attendees')
            .ilike('title', title)
            .eq('status', 'confirmed')
            .limit(1)
            .maybeSingle();
          if (data) setLinkedCalEvent(data);
        }
      }
    };

    lookup();
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleEmail = (idx: number) =>
    setExpandedEmails(prev => ({ ...prev, [idx]: !prev[idx] }));

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownloadAttachment = async (filename: string) => {
    setDownloadingFile(filename);
    try {
      const response = await fetch(
        `/api/inbox/${currentItem.id}/attachment?filename=${encodeURIComponent(filename)}`
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

  // Reset selected item when panel closes
  const handleClose = () => {
    setSelectedBatchItem(null);
    onClose();
  };

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

  // Check if this inbox item has meeting/calendar data
  const hasMeetingData = () => {
    return !!(
      sourceData?.meeting_link ||
      sourceData?.event_id ||
      sourceData?.start_time ||
      sourceData?.calendar_event
    );
  };

  // Format meeting time display
  const formatMeetingTime = (startTime: string, endTime?: string) => {
    const start = new Date(startTime);
    const now = new Date();

    const isToday = start.toDateString() === now.toDateString();
    const isTomorrow = start.toDateString() === new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString();

    const dateLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    const timeStr = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    if (endTime) {
      const end = new Date(endTime);
      const endTimeStr = end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return `${dateLabel} · ${timeStr}–${endTimeStr}`;
    }

    return `${dateLabel} · ${timeStr}`;
  };

  const handleOpenInWorkflows = async () => {
    setIsOpeningWorkflow(true);
    try {
      const response = await fetch(`/api/inbox/${item.id}/open-workflow`, {
        method: 'POST',
      });
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
                            (sourceData?.from_name || sourceData?.from) && (
                              <p className="text-[13px] text-neutral-600 mt-1.5">
                                From: {sourceData.from_name}
                                {sourceData.from && (
                                  <span className="text-neutral-400"> &lt;{sourceData.from}&gt;</span>
                                )}
                              </p>
                            )
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {selectedBatchItem && isBatch && (
                            <button
                              onClick={() => setSelectedBatchItem(null)}
                              className="flex-shrink-0 p-2 hover:bg-white/60 transition-colors"
                              title="Back to batch summary"
                            >
                              <ArrowLeftIcon className="w-5 h-5 text-neutral-500" />
                            </button>
                          )}
                          <button
                            onClick={handleClose}
                            className="flex-shrink-0 p-2 hover:bg-white/60 transition-colors"
                          >
                            <XMarkIcon className="w-5 h-5 text-neutral-500" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Content - Scrollable */}
                    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                      {/* Batch Items List - Only show when not viewing individual item */}
                      {isBatch && batchItems && !selectedBatchItem && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                            All Items ({batchItems.length})
                          </h3>
                          <div className="space-y-3">
                            {batchItems.map((batchItem, index) => (
                              <button
                                key={batchItem.id}
                                onClick={() => setSelectedBatchItem(batchItem)}
                                className="w-full text-left bg-neutral-50 border border-neutral-200 p-4 hover:border-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer"
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
                              </button>
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

                      {/* Meeting Details - Show calendar/meeting info if available */}
                      {!isBatch && hasMeetingData() && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                            Meeting Details
                          </h3>
                          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-3">
                            {/* Meeting Time */}
                            {(sourceData?.start_time || sourceData?.calendar_event?.start_time) && (
                              <div className="flex items-start gap-3">
                                <CalendarIcon className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-[13px] font-medium text-indigo-900">
                                    {formatMeetingTime(
                                      sourceData?.start_time || sourceData?.calendar_event?.start_time,
                                      sourceData?.end_time || sourceData?.calendar_event?.end_time
                                    )}
                                  </p>
                                  {(sourceData?.timezone || sourceData?.calendar_event?.timezone) && (
                                    <p className="text-[11px] text-indigo-700 mt-0.5">
                                      {sourceData?.timezone || sourceData?.calendar_event?.timezone}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Meeting Link */}
                            {(sourceData?.meeting_link || sourceData?.calendar_event?.meeting_link) && (
                              <div className="flex items-start gap-3">
                                <VideoCameraIcon className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                                <a
                                  href={sourceData?.meeting_link || sourceData?.calendar_event?.meeting_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[13px] text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
                                >
                                  Join Meeting
                                </a>
                              </div>
                            )}

                            {/* Location */}
                            {(sourceData?.location || sourceData?.calendar_event?.location) && (
                              <div className="flex items-start gap-3">
                                <MapPinIcon className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                                <p className="text-[13px] text-indigo-900">
                                  {sourceData?.location || sourceData?.calendar_event?.location}
                                </p>
                              </div>
                            )}

                            {/* Organizer */}
                            {(sourceData?.organizer || sourceData?.calendar_event?.organizer) && (
                              <div className="flex items-start gap-3">
                                <UserIcon className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-[11px] text-indigo-700 uppercase tracking-wide mb-0.5">
                                    Organizer
                                  </p>
                                  <p className="text-[13px] text-indigo-900">
                                    {sourceData?.organizer || sourceData?.calendar_event?.organizer}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Attendees */}
                            {(sourceData?.attendees || sourceData?.calendar_event?.attendees) && (
                              <div className="flex items-start gap-3">
                                <UserIcon className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-[11px] text-indigo-700 uppercase tracking-wide mb-1.5">
                                    Attendees ({(sourceData?.attendees || sourceData?.calendar_event?.attendees)?.length || 0})
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {(sourceData?.attendees || sourceData?.calendar_event?.attendees)?.slice(0, 8).map((attendee: any, i: number) => (
                                      <span
                                        key={i}
                                        className="inline-flex items-center px-2 py-1 text-[11px] bg-white text-indigo-900 border border-indigo-200 rounded"
                                      >
                                        {attendee.name || attendee.email || attendee}
                                      </span>
                                    ))}
                                    {(sourceData?.attendees || sourceData?.calendar_event?.attendees)?.length > 8 && (
                                      <span className="inline-flex items-center px-2 py-1 text-[11px] text-indigo-600">
                                        +{(sourceData?.attendees || sourceData?.calendar_event?.attendees).length - 8} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Meeting Description */}
                            {(sourceData?.description || sourceData?.calendar_event?.description) && (
                              <div className="pt-2 border-t border-indigo-200">
                                <p className="text-[11px] text-indigo-700 uppercase tracking-wide mb-1">
                                  Description
                                </p>
                                <p className="text-[12px] text-indigo-900 leading-relaxed whitespace-pre-wrap">
                                  {sourceData?.description || sourceData?.calendar_event?.description}
                                </p>
                              </div>
                            )}
                          </div>
                          {linkedCalEvent && (
                            <div className="mt-3 pt-3 border-t border-indigo-200">
                              <p className="text-[11px] font-medium text-indigo-600 uppercase tracking-wide mb-2">Your response</p>
                              <RsvpButtons
                                itemId={linkedCalEvent.id}
                                attendees={linkedCalEvent.attendees}
                                onDismiss={handleRsvpDismiss}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* RSVP for calendar invite emails (no structured meeting data, but matched by subject) */}
                      {!isBatch && !hasMeetingData() && linkedCalEvent && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                            Your Response
                          </h3>
                          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                            <RsvpButtons
                              itemId={linkedCalEvent.id}
                              attendees={linkedCalEvent.attendees}
                              onDismiss={handleClose}
                            />
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

                      {/* Draft Reply */}
                      {!isBatch && sourceData?.draft && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            Prepared Reply
                          </h3>
                          <div className="relative bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 p-4">
                            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-indigo-500" />
                            <div className="pl-3">
                              <p className="text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                                {typeof sourceData.draft === 'string' ? sourceData.draft : sourceData.draft.body}
                              </p>
                            </div>
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

                      {/* Attachments */}
                      {!isBatch && sourceData?.attachments && sourceData.attachments.length > 0 && (
                        <div>
                          <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                            Attachments ({sourceData.attachments.length})
                          </h3>
                          <div className="space-y-1.5">
                            {sourceData.attachments.map((att: { filename: string; mimeType: string; size: number; storagePath: string }, i: number) => (
                              <div
                                key={i}
                                className="flex items-center justify-between px-3 py-2 bg-neutral-50 border border-neutral-200"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <PaperClipIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                                  <span className="text-[13px] text-neutral-800 truncate">
                                    {att.filename}
                                  </span>
                                  <span className="text-[11px] text-neutral-400 flex-shrink-0">
                                    {formatFileSize(att.size)}
                                  </span>
                                </div>
                                <button
                                  onClick={() => handleDownloadAttachment(att.filename)}
                                  disabled={downloadingFile === att.filename}
                                  className="flex-shrink-0 ml-3 text-[12px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex items-center gap-1"
                                >
                                  {downloadingFile === att.filename ? (
                                    <div className="w-3 h-3 border border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                                  )}
                                  Download
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Email Thread — expandable cards */}
                      {!isBatch && sourceData?.thread_history && sourceData.thread_history.length > 0 && (
                        <div>
                          {sourceData.thread_history.length > 1 && (
                            <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">
                              Thread History
                            </h3>
                          )}
                          <div className="space-y-2">
                            {sourceData.thread_history.slice(0, 5).map((msg: any, i: number) => {
                              const isLast = i === Math.min(sourceData.thread_history.length, 5) - 1;
                              // Use full body from sourceData for the latest email card
                              const body = isLast && sourceData.body ? sourceData.body : msg.snippet;
                              const isExpanded = !!expandedEmails[i];

                              return (
                                <div
                                  key={i}
                                  className={`border text-[12px] ${isLast ? 'border-neutral-300 bg-white' : 'border-neutral-200 bg-neutral-50'}`}
                                >
                                  <button
                                    onClick={() => toggleEmail(i)}
                                    className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-medium text-neutral-900 truncate">
                                        {msg.from_name || msg.from}
                                      </span>
                                      {isLast && sourceData.thread_history.length > 1 && (
                                        <span className="flex-shrink-0 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
                                          Latest
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                      <span className="text-neutral-400">
                                        {new Date(msg.received_at).toLocaleString('en-US', {
                                          month: 'short', day: 'numeric',
                                          hour: 'numeric', minute: '2-digit', hour12: true,
                                        })}
                                      </span>
                                      <ChevronRightIcon
                                        className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                      />
                                    </div>
                                  </button>

                                  {!isExpanded && (
                                    <p className="px-3 pb-2.5 text-neutral-500 line-clamp-2 text-[12px]">
                                      {msg.snippet}
                                    </p>
                                  )}

                                  {isExpanded && (
                                    <div className="px-3 pb-3 border-t border-neutral-100 pt-2.5 space-y-2">
                                      {msg.subject && msg.subject !== sourceData.subject && (
                                        <p className="text-neutral-400 text-[11px]">{msg.subject}</p>
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
                          {/* Executable work — draft reply (if any) + open in Workflows */}
                          {isExecutable(item) && (
                            <>
                              <button
                                onClick={handleOpenInWorkflows}
                                disabled={isOpeningWorkflow}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
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

                          {/* Regular work actions */}
                          {!isExecutable(item) && (
                            <>
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

      </Dialog>
    </Transition>
  );
}
