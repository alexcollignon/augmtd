'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  EnvelopeIcon,
  CalendarIcon,
  ArrowUturnLeftIcon,
  PaperAirplaneIcon,
  ChevronRightIcon,
  CheckIcon,
  VideoCameraIcon,
  MapPinIcon,
  PaperClipIcon,
  ArchiveBoxArrowDownIcon,
  FolderArrowDownIcon,
  XMarkIcon,
  PlayIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';

import RsvpButtons from './rsvp-buttons';
import KbFilePicker from './kb-file-picker';
import { createClient } from '@/lib/supabase/client';

function IframeEmailBody({ html, plain }: { html: string | null; plain: string | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source === iframeRef.current?.contentWindow && e.data?.type === 'email-height') {
        iframeRef.current.style.height = Math.min(e.data.height + 24, 800) + 'px';
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  if (!html) {
    return (
      <div className="px-4 py-3 text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto">
        {plain?.trim()}
      </div>
    );
  }

  const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; margin: 0; padding: 16px; word-break: break-word; }
  img { max-width: 100% !important; height: auto; }
  img[width="1"], img[height="1"], img[src^="cid:"] { display: none !important; }
  table { max-width: 100%; }
  a { color: inherit; }
</style>
</head>
<body>${html}<script>window.addEventListener('load',function(){window.parent.postMessage({type:'email-height',height:document.body.scrollHeight},'*');});<\/script></body>
</html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
      className="w-full border-none block"
      style={{ height: '400px' }}
    />
  );
}

interface PendingAttachment {
  filename: string;
  content: string; // base64
  mimeType: string;
}

interface WorkDetailInlineProps {
  item: InboxItem | null;
  onItemConfirmed?: (ids: string[], action: 'confirm_as_mine' | 'not_my_task') => void;
  onRefreshMeetings?: () => void;
  pendingReplyDraft?: { body: string; cc?: string; bcc?: string } | null;
  onReplySent?: (itemId: string) => void;
  replyBody: string;
  onReplyBodyChange: (body: string) => void;
  onReplyOpenChange?: (open: boolean) => void;
  onOpenWorkflowPanel?: () => void;
}

export default function WorkDetailInline({ item, onItemConfirmed, onRefreshMeetings, pendingReplyDraft, onReplySent, replyBody, onReplyBodyChange, onReplyOpenChange, onOpenWorkflowPanel }: WorkDetailInlineProps) {
  const [expandedEmails, setExpandedEmails] = useState<Record<number, boolean>>({});
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<PendingAttachment[]>([]);
  const [replyCc, setReplyCc] = useState('');
  const [replyBcc, setReplyBcc] = useState('');
  const [showReplyCc, setShowReplyCc] = useState(false);
  const [showReplyBcc, setShowReplyBcc] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const replyBoxRef = useRef<HTMLDivElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);

  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveConfirmPending, setArchiveConfirmPending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[] | null>(null);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const [moveMenuPos, setMoveMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [linkedCalEvent, setLinkedCalEvent] = useState<{ id: string; attendees: any[] } | null>(null);
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null); // which response is loading
  const [fetchedHtmlBody, setFetchedHtmlBody] = useState<string | null>(null);

  // Fetch html_body from emails table when not present in source_data (emails synced before the fix)
  useEffect(() => {
    setFetchedHtmlBody(null);
    const sd = item?.source_data as any;
    if (!sd?.email_id || sd?.html_body) return;
    const supabase = createClient();
    supabase
      .from('emails')
      .select('html_body')
      .eq('id', sd.email_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.html_body) setFetchedHtmlBody(data.html_body);
      });
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Look up matching calendar event — by time range first, then by title from invite subject
  useEffect(() => {
    setLinkedCalEvent(null);
    if (!item) return;

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
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Reset folder + reply state when item changes
  useEffect(() => {
    setShowMoveMenu(false);
    setFolders(null);
    setExpandedEmails({});
    setReplyOpen(false);
    onReplyBodyChange('');
    onReplyOpenChange?.(false);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open + fill reply box when a pending draft arrives from chat (Use as reply path)
  useEffect(() => {
    if (pendingReplyDraft != null) {
      onReplyBodyChange(pendingReplyDraft.body);
      if (pendingReplyDraft.cc) { setReplyCc(pendingReplyDraft.cc); setShowReplyCc(true); }
      if (pendingReplyDraft.bcc) { setReplyBcc(pendingReplyDraft.bcc); setShowReplyBcc(true); }
      setReplyOpen(true);
      onReplyOpenChange?.(true);
      setTimeout(() => replyBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }, [pendingReplyDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize reply textarea as content grows
  useEffect(() => {
    const el = replyTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [replyBody]);

  // Close move menu on outside click
  useEffect(() => {
    if (!showMoveMenu) return;
    const handler = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setShowMoveMenu(false);
        setShowNewFolderInput(false);
        setNewFolderName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoveMenu]);


  const handleRsvpWithReply = async (response: 'accepted' | 'tentative' | 'declined', _sendEmail: boolean) => {
    if (!linkedCalEvent || rsvpLoading) return;
    setRsvpLoading(response);
    try {
      const res = await fetch(`/api/meetings/${linkedCalEvent.id}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRsvpLoading(null);
        toast.error(data?.error === 'calendar_scope_required' ? 'Calendar write access needed. Reconnect to RSVP.' : 'Failed to update RSVP');
        return;
      }
    } catch {
      setRsvpLoading(null);
      toast.error('Failed to update RSVP');
      return;
    }
    const labels: Record<string, string> = { accepted: 'Meeting accepted', tentative: 'Marked as maybe', declined: 'Meeting declined' };
    toast.success(labels[response] ?? 'RSVP updated');
    onRefreshMeetings?.();
    if (item) onItemConfirmed?.([item.id], 'not_my_task');
  };

  const handleLocalFileAttach = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const results = await Promise.all(files.map(async (file) => {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const content = btoa(binary);
      return { filename: file.name, content, mimeType: file.type || 'application/octet-stream' };
    }));
    setReplyAttachments(prev => [...prev, ...results]);
    e.target.value = '';
  }, []);

  const handleKbAttach = useCallback(async (selected: { id: string; filename: string }[]) => {
    setKbPickerOpen(false);
    const results = await Promise.all(selected.map(async ({ id, filename }) => {
      try {
        const res = await fetch(`/api/kb/attachment?fileId=${id}`);
        if (!res.ok) { toast.error(`Failed to load ${filename}`); return null; }
        return await res.json() as PendingAttachment;
      } catch {
        toast.error(`Failed to load ${filename}`);
        return null;
      }
    }));
    setReplyAttachments(prev => [...prev, ...(results.filter(Boolean) as PendingAttachment[])]);
  }, []);

  const handleSendReply = async () => {
    if (!item || !replyBody.trim()) return;
    setIsSendingReply(true);
    try {
      const res = await fetch(`/api/inbox/${item.id}/send-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customMessage: replyBody,
          attachments: replyAttachments,
          cc: replyCc.trim() || undefined,
          bcc: replyBcc.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      toast.success('Reply sent');
      setReplyOpen(false);
      onReplyOpenChange?.(false);
      onReplyBodyChange('');
      setReplyAttachments([]);
      setReplyCc('');
      setReplyBcc('');
      setShowReplyCc(false);
      setShowReplyBcc(false);
      onReplySent?.(item.id);
    } catch {
      toast.error('Could not send reply');
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleOpenMoveMenu = async () => {
    if (moveBtnRef.current) {
      const rect = moveBtnRef.current.getBoundingClientRect();
      setMoveMenuPos({ top: rect.top, right: window.innerWidth - rect.right });
    }
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

  const handleMoveToFolder = async (folderId: string, folderName: string, createNew = false) => {
    setIsMoving(true);
    setShowMoveMenu(false);
    setShowNewFolderInput(false);
    setNewFolderName('');
    try {
      const res = await fetch(`/api/inbox/${item.id}/move-to-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, folderName, ...(createNew && { createNew: true }) }),
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

  const handleDeleteSource = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/inbox/${item.id}/delete-source`, { method: 'POST' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Email deleted');
      onItemConfirmed?.([item.id], 'not_my_task');
    } catch {
      toast.error('Could not delete email');
    } finally {
      setIsDeleting(false);
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
    <div className="flex flex-col h-full bg-neutral-100">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-neutral-200 bg-white">
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

        {/* Meeting details */}
        {hasMeetingData() && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
              Meeting Details
            </h3>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-3">
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

        {/* Summary + Key Points — 2-column layout */}
        {item.what_i_prepared || (sourceData?.keyPoints?.length > 0) ? (
          <div className="grid grid-cols-2 gap-3">
            {item.what_i_prepared && (
              <div className="bg-white border border-neutral-200 rounded-lg shadow-sm p-4">
                <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
                  Summary
                </h3>
                <p className="text-[13px] text-neutral-700 leading-relaxed">{item.what_i_prepared}</p>
              </div>
            )}
            {sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
              <div className="bg-white border border-neutral-200 rounded-lg shadow-sm p-4">
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
          </div>
        ) : null}

        {/* Latest email body */}
        {(sourceData?.html_body || sourceData?.body) && (
          <div className="border border-neutral-200 bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="flex items-baseline justify-between px-4 pt-3 pb-2 border-b border-neutral-100">
              <span className="text-[13px] font-semibold text-neutral-800 truncate">
                {sourceData.from_name || sourceData.from || 'Unknown'}
              </span>
              {sourceData.received_at && (
                <span className="text-[11px] text-neutral-400 flex-shrink-0 ml-3">
                  {new Date(sourceData.received_at).toLocaleString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit', hour12: true,
                  })}
                </span>
              )}
            </div>
            <IframeEmailBody
              html={(sourceData.html_body as string | null) ?? fetchedHtmlBody}
              plain={sourceData.body as string | null}
            />
          </div>
        )}

        {/* Thread — older messages only, all collapsed */}
        {sourceData?.thread_history && sourceData.thread_history.length > 1 && (
          <div>
            <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
              Thread
            </h3>
            <div className="space-y-1">
              {sourceData.thread_history.slice(0, sourceData.thread_history.length - 1).slice(0, 8).map((msg: any, i: number) => {
                const isExpanded = !!expandedEmails[i];
                return (
                  <div key={i} className="border border-neutral-200 bg-white rounded-md text-[12px]">
                    <button
                      onClick={() => setExpandedEmails(prev => ({ ...prev, [i]: !prev[i] }))}
                      className="w-full flex items-center justify-between px-3 py-2 text-left"
                    >
                      <span className="font-medium text-neutral-600 truncate">
                        {msg.from_name || msg.from}
                      </span>
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
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-neutral-100 pt-2.5">
                        {msg.subject && msg.subject !== sourceData.subject && (
                          <p className="text-neutral-400 text-[11px] mb-2">{msg.subject}</p>
                        )}
                        <p className="text-[12px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
                          {msg.snippet}
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
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-md text-neutral-700 transition-colors disabled:opacity-50 max-w-[200px]"
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

        {/* Inline reply composer */}
        {replyOpen && item.source === 'email' && (
          <div ref={replyBoxRef} className="border border-neutral-200 bg-white">
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-neutral-100">
              <span className="text-[12px] font-semibold text-neutral-600 flex items-center gap-1.5">
                <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                Reply to {sourceData?.from_name || sourceData?.from || 'sender'}
              </span>
              <div className="flex items-center gap-2">
                {!showReplyCc && (
                  <button
                    onClick={() => setShowReplyCc(true)}
                    className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    CC
                  </button>
                )}
                {!showReplyBcc && (
                  <button
                    onClick={() => setShowReplyBcc(true)}
                    className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    BCC
                  </button>
                )}
                <button
                  onClick={() => { setReplyOpen(false); onReplyOpenChange?.(false); onReplyBodyChange(''); setReplyCc(''); setReplyBcc(''); setShowReplyCc(false); setShowReplyBcc(false); }}
                  className="text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            {showReplyCc && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
                <span className="text-[11px] font-semibold text-neutral-400 w-8 flex-shrink-0">CC</span>
                <input
                  type="text"
                  value={replyCc}
                  onChange={e => setReplyCc(e.target.value)}
                  placeholder="cc@example.com"
                  className="flex-1 text-[13px] text-neutral-800 placeholder-neutral-400 bg-transparent outline-none"
                />
              </div>
            )}
            {showReplyBcc && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
                <span className="text-[11px] font-semibold text-neutral-400 w-8 flex-shrink-0">BCC</span>
                <input
                  type="text"
                  value={replyBcc}
                  onChange={e => setReplyBcc(e.target.value)}
                  placeholder="bcc@example.com"
                  className="flex-1 text-[13px] text-neutral-800 placeholder-neutral-400 bg-transparent outline-none"
                />
              </div>
            )}
            <div className="px-4 pt-3 pb-2">
              <textarea
                ref={replyTextareaRef}
                value={replyBody}
                onChange={e => onReplyBodyChange(e.target.value)}
                autoFocus
                style={{ minHeight: '120px', maxHeight: '400px' }}
                className="w-full text-[13px] text-neutral-800 border-0 outline-none resize-none placeholder:text-neutral-400 leading-relaxed overflow-y-auto"
                placeholder="Write your reply…"
              />
            </div>
            {/* Attachment chips */}
            {replyAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                {replyAttachments.map((att, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-100 rounded text-[11px] text-neutral-700">
                    <PaperClipIcon className="w-3 h-3 flex-shrink-0" />
                    <span className="max-w-[140px] truncate">{att.filename}</span>
                    <button
                      onClick={() => setReplyAttachments(prev => prev.filter((_, j) => j !== i))}
                      className="hover:text-red-500 transition-colors ml-0.5"
                    >
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={attachFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleLocalFileAttach}
            />

            <div className="flex items-center justify-between gap-2 px-4 pb-3">
              {/* Attach button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAttachMenu(v => !v)}
                  className="p-1.5 rounded text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
                  title="Attach file"
                >
                  <PaperClipIcon className="w-4 h-4" />
                </button>
                {showAttachMenu && (
                  <div className="absolute bottom-9 left-0 w-52 bg-white border border-neutral-200 rounded-lg shadow-lg z-10 py-1">
                    <button
                      onClick={() => { attachFileInputRef.current?.click(); setShowAttachMenu(false); }}
                      className="w-full text-left px-3 py-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                    >
                      Upload a file
                    </button>
                    <button
                      onClick={() => { setKbPickerOpen(true); setShowAttachMenu(false); }}
                      className="w-full text-left px-3 py-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                    >
                      From knowledge base
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setReplyOpen(false); onReplyOpenChange?.(false); onReplyBodyChange(''); setReplyAttachments([]); setReplyCc(''); setReplyBcc(''); setShowReplyCc(false); setShowReplyBcc(false); }}
                  disabled={isSendingReply}
                  className="px-3 py-1.5 text-[12px] font-medium text-neutral-500 hover:text-neutral-700 disabled:opacity-50 transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={handleSendReply}
                  disabled={isSendingReply || !replyBody.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSendingReply
                    ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Sending…</>
                    : <><PaperAirplaneIcon className="w-3.5 h-3.5" />Send</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* KB file picker modal */}
        {kbPickerOpen && (
          <KbFilePicker
            onSelect={handleKbAttach}
            onClose={() => setKbPickerOpen(false)}
          />
        )}

      </div>

      {/* Actions footer */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-white px-4 py-3 relative z-10">
        <div className={`flex ${linkedCalEvent ? 'flex-col gap-2' : 'items-center gap-2'}`}>

          {/* RSVP row — meeting invites only */}
          {linkedCalEvent && (
            <div className="flex items-center gap-2">
              {(['accepted', 'tentative', 'declined'] as const).map((val) => {
                const labels = { accepted: 'Accept', tentative: 'Maybe', declined: 'Decline' };
                const icons = { accepted: CheckIcon, tentative: QuestionMarkCircleIcon, declined: XMarkIcon };
                const Icon = icons[val];
                const isThisLoading = rsvpLoading === val;
                const colorClass = val === 'accepted'
                  ? 'border-green-200 text-green-700 hover:bg-green-50 hover:border-green-300'
                  : val === 'declined'
                  ? 'border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300'
                  : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400';
                return (
                  <button
                    key={val}
                    onClick={() => handleRsvpWithReply(val, false)}
                    disabled={!!rsvpLoading}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold border rounded-lg bg-white disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm ${colorClass}`}
                  >
                    {isThisLoading
                      ? <div className="w-4 h-4 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                      : <Icon className="w-4 h-4" />
                    }
                    {isThisLoading ? 'Sending…' : labels[val]}
                  </button>
                );
              })}
            </div>
          )}

          {/* Action icons row */}
          <div className="flex items-center gap-1.5 flex-1">

              {/* Reply */}
              {item.source === 'email' && (
                <button
                  title="Reply"
                  onClick={() => {
                    setReplyOpen(true);
                    onReplyOpenChange?.(true);
                    setTimeout(() => replyBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                  }}
                  className={`p-2.5 rounded-md transition-colors border ${
                    linkedCalEvent
                      ? 'text-neutral-600 border-neutral-300 hover:bg-neutral-100'
                      : 'text-indigo-600 border-indigo-200 bg-indigo-50 hover:bg-indigo-100'
                  }`}
                >
                  <ArrowUturnLeftIcon className="w-4 h-4" />
                </button>
              )}

              {/* Move to folder */}
              {item.source === 'email' && sourceData?.provider ? (
                <div ref={moveMenuRef}>
                  <button
                    ref={moveBtnRef}
                    title="Move to folder"
                    onClick={handleOpenMoveMenu}
                    disabled={isMoving}
                    className="p-2.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 transition-colors border border-neutral-300 flex items-center justify-center"
                  >
                    {isMoving ? (
                      <div className="w-4 h-4 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <FolderArrowDownIcon className="w-4 h-4" />
                    )}
                  </button>
                  {showMoveMenu && moveMenuPos && (
                    <div className="fixed bg-white border border-neutral-200 shadow-lg min-w-[180px] z-[9999] rounded-md" style={{ top: moveMenuPos.top - 4, right: moveMenuPos.right, transform: 'translateY(-100%)' }}>
                      {isLoadingFolders ? (
                        <div className="px-4 py-3 text-[12px] text-neutral-400 flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" />
                          Loading folders…
                        </div>
                      ) : (
                        <>
                          {!!folders?.length && (
                            <div className="max-h-48 overflow-y-auto">
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
                          {/* New folder */}
                          <div className="border-t border-neutral-100">
                            {showNewFolderInput ? (
                              <div className="flex items-center gap-1.5 px-3 py-2">
                                <input
                                  ref={newFolderInputRef}
                                  type="text"
                                  value={newFolderName}
                                  onChange={e => setNewFolderName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && newFolderName.trim()) handleMoveToFolder('', newFolderName.trim(), true);
                                    if (e.key === 'Escape') { setShowNewFolderInput(false); setNewFolderName(''); }
                                  }}
                                  placeholder="Folder name"
                                  autoFocus
                                  className="flex-1 text-[12px] text-neutral-800 placeholder-neutral-400 outline-none bg-transparent"
                                />
                                <button
                                  onClick={() => { if (newFolderName.trim()) handleMoveToFolder('', newFolderName.trim(), true); }}
                                  disabled={!newFolderName.trim()}
                                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-30 transition-colors flex-shrink-0"
                                >
                                  Create
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setShowNewFolderInput(true); setTimeout(() => newFolderInputRef.current?.focus(), 50); }}
                                className="w-full text-left px-4 py-2.5 text-[13px] text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center gap-1.5"
                              >
                                <span className="text-neutral-400 text-base leading-none">+</span>
                                New folder
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
              {item.source === 'email' && sourceData?.provider && (
                archiveConfirmPending ? (
                  <div className="flex items-center gap-1 px-2 py-1.5 border border-indigo-300 bg-indigo-50">
                    <span className="text-[11px] font-semibold text-indigo-700 mr-1">Archive?</span>
                    <button onClick={() => { setArchiveConfirmPending(false); handleArchiveSource(); }} className="w-5 h-5 flex items-center justify-center bg-indigo-600 text-white hover:bg-indigo-700 transition-colors" title="Confirm">
                      <CheckIcon className="w-3 h-3" strokeWidth={2.5} />
                    </button>
                    <button onClick={() => setArchiveConfirmPending(false)} className="w-5 h-5 flex items-center justify-center border border-neutral-300 text-neutral-500 hover:bg-neutral-100 transition-colors" title="Cancel">
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    title="Archive"
                    onClick={() => setArchiveConfirmPending(true)}
                    disabled={isArchiving}
                    className="p-2.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 transition-colors border border-neutral-300 flex items-center justify-center"
                  >
                    {isArchiving
                      ? <div className="w-4 h-4 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                      : <ArchiveBoxArrowDownIcon className="w-4 h-4" />
                    }
                  </button>
                )
              )}

              {/* Delete */}
              {item.source === 'email' && sourceData?.provider && (
                deleteConfirmPending ? (
                  <div className="flex items-center gap-1 px-2 py-1.5 border border-red-200 bg-red-50">
                    <span className="text-[11px] font-semibold text-red-700 mr-1">Delete?</span>
                    <button onClick={() => { setDeleteConfirmPending(false); handleDeleteSource(); }} className="w-5 h-5 flex items-center justify-center bg-red-600 text-white hover:bg-red-700 transition-colors" title="Confirm">
                      <CheckIcon className="w-3 h-3" strokeWidth={2.5} />
                    </button>
                    <button onClick={() => setDeleteConfirmPending(false)} className="w-5 h-5 flex items-center justify-center border border-neutral-300 text-neutral-500 hover:bg-neutral-100 transition-colors" title="Cancel">
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    title="Delete"
                    onClick={() => setDeleteConfirmPending(true)}
                    disabled={isDeleting}
                    className="p-2.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors border border-neutral-300 flex items-center justify-center"
                  >
                    {isDeleting
                      ? <div className="w-4 h-4 border-2 border-red-300 border-t-transparent rounded-full animate-spin" />
                      : <TrashIcon className="w-4 h-4" />
                    }
                  </button>
                )
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Workflows */}
              <button
                title="Workflows"
                onClick={() => onOpenWorkflowPanel?.()}
                className="p-2.5 text-indigo-500 hover:bg-indigo-50 transition-colors border border-indigo-200 rounded-md flex items-center justify-center"
              >
                <PlayIcon className="w-4 h-4" />
              </button>
          </div>
        </div>
      </div>

    </div>
  );
}
