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
import type { ConnectionFolders } from '@/components/inbox/folder-rail';

import RsvpButtons from './rsvp-buttons';
import KbFilePicker from './kb-file-picker';
import FormatToolbar from './format-toolbar';
import { createClient } from '@/lib/supabase/client';
import AttendeeInput, { AttendeeChip } from '@/components/meetings/attendee-input';

function IframeEmailBody({ html, plain }: { html: string | null; plain: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !html) return;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host { display: block; overflow-x: auto; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; }
      img { max-width: 100% !important; height: auto; }
      img[width="1"], img[height="1"], img[src^="cid:"] { display: none !important; }
      a { color: inherit; }
    </style>${html}`;

    // Open all links in a new tab (shadow DOM ignores <base target="_blank">)
    shadow.querySelectorAll('a[href]').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  }, [html]);

  if (!html) {
    return (
      <div className="px-4 py-3 text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto">
        {plain?.trim()}
      </div>
    );
  }

  return <div ref={hostRef} className="w-full px-4 py-2" />;
}

interface PendingAttachment {
  filename: string;
  content: string; // base64
  mimeType: string;
}

// System folder names that don't make sense as move destinations
const EXCLUDED_SYSTEM_FOLDERS = new Set([
  'sent', 'sent items', 'sent mail',
  'trash', 'deleted items', 'bin',
  'drafts',
  'spam', 'junk', 'junk email',
  'all mail', 'outbox',
]);

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
  folderSections?: ConnectionFolders[];
}

export default function WorkDetailInline({ item, onItemConfirmed, onRefreshMeetings, pendingReplyDraft, onReplySent, replyBody, onReplyBodyChange, onReplyOpenChange, onOpenWorkflowPanel, folderSections }: WorkDetailInlineProps) {
  const [expandedEmails, setExpandedEmails] = useState<Record<number, boolean>>({});
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [threadEmails, setThreadEmails] = useState<any[] | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<PendingAttachment[]>([]);
  const [replyCc, setReplyCc] = useState('');
  const [replyBcc, setReplyBcc] = useState('');
  const [showReplyCc, setShowReplyCc] = useState(false);
  const [showReplyBcc, setShowReplyBcc] = useState(false);
  const [ccChips, setCcChips] = useState<AttendeeChip[]>([]);
  const [bccChips, setBccChips] = useState<AttendeeChip[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [showSignature, setShowSignature] = useState(true);
  const [signatureHtml, setSignatureHtml] = useState<string | null>(null);
  const replyBoxRef = useRef<HTMLDivElement>(null);
  const replyTextareaRef = useRef<HTMLDivElement>(null);
  const lastExternalReplyBody = useRef<string>('');
  const attachFileInputRef = useRef<HTMLInputElement>(null);

  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveConfirmPending, setArchiveConfirmPending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  // Derive move-target folders from folderSections: same connection, exclude system folders
  // that aren't meaningful destinations (Sent, Trash, Drafts, Spam, etc.)
  const availableFolders = (() => {
    const connId = (item as any)?.connection_id;
    if (!connId || !folderSections) return null;
    const conn = folderSections.find(c => c.connectionId === connId);
    if (!conn) return null;
    return conn.folders.filter(f =>
      !f.isSystem || !EXCLUDED_SYSTEM_FOLDERS.has(f.name.toLowerCase())
    );
  })();
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const [moveMenuPos, setMoveMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [linkedCalEvent, setLinkedCalEvent] = useState<{ id: string; attendees: any[] } | null>(null);
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null); // which response is loading

  // Fetch signature for this item's connection
  useEffect(() => {
    const connectionId = (item as any)?.connection_id;
    const url = connectionId
      ? `/api/user/signature?connectionId=${connectionId}`
      : '/api/user/signature';
    fetch(url)
      .then(r => r.json())
      .then(({ signature }) => {
        setSignatureHtml(signature ?? null);
      })
      .catch(() => {});

    // Live-update if user saves a signature in settings while reply is open
    const handler = (e: Event) => {
      const { connectionId: savedId, signature } = (e as CustomEvent).detail;
      if (!connectionId || savedId === connectionId) {
        setSignatureHtml(signature || null);
      }
    };
    window.addEventListener('signature-saved', handler);
    return () => window.removeEventListener('signature-saved', handler);
  }, [(item as any)?.connection_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset thread state on item change
  useEffect(() => {
    setShowAllHistory(false);
    setExpandedEmails({});
    setThreadEmails(null);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live thread fetch — query emails table by thread_id so we always see the complete thread.
  // After the primary query, stitches in emails from other providers using RFC References headers.
  useEffect(() => {
    const sd = item?.source_data as any;
    if (!sd) return;
    const supabase = createClient();
    const threadId = sd.thread_id;
    if (threadId) {
      supabase
        .from('emails')
        .select('id, message_id, in_reply_to, references_ids, from_address, from_name, to_addresses, cc_addresses, subject, body, html_body, received_at, is_from_user, metadata')
        .eq('thread_id', threadId)
        .order('received_at', { ascending: true })
        .then(async ({ data: primary }) => {
          const primaryEmails = primary ?? [];

          // Cross-provider stitching via RFC threading headers:
          // 1. Find emails whose references_ids overlap with our thread's message_ids
          // 2. Find emails whose message_id appears in our thread's references_ids
          const primaryMessageIds = primaryEmails.map((e: any) => e.message_id).filter(Boolean);
          const allReferencedIds = primaryEmails.flatMap((e: any) => e.references_ids || []).filter(Boolean);

          const stitchQueries: Promise<{ data: any[] | null }>[] = [];

          if (primaryMessageIds.length > 0) {
            // Other-provider emails that reference any message in our thread
            stitchQueries.push(
              Promise.resolve(
                supabase
                  .from('emails')
                  .select('id, message_id, in_reply_to, references_ids, from_address, from_name, to_addresses, cc_addresses, subject, body, html_body, received_at, is_from_user, metadata')
                  .overlaps('references_ids', primaryMessageIds)
                  .neq('thread_id', threadId)
              ).then(r => ({ data: r.data }))
            );
          }

          if (allReferencedIds.length > 0) {
            // Emails that our thread references but have a different thread_id (sent from other provider)
            stitchQueries.push(
              Promise.resolve(
                supabase
                  .from('emails')
                  .select('id, message_id, in_reply_to, references_ids, from_address, from_name, to_addresses, cc_addresses, subject, body, html_body, received_at, is_from_user, metadata')
                  .in('message_id', allReferencedIds)
                  .neq('thread_id', threadId)
              ).then(r => ({ data: r.data }))
            );
          }

          if (stitchQueries.length > 0) {
            const stitchResults = await Promise.all(stitchQueries);
            const seen = new Set(primaryEmails.map((e: any) => e.message_id).filter(Boolean));
            const merged = [...primaryEmails];
            for (const { data: extra } of stitchResults) {
              for (const e of (extra || [])) {
                if (!e.message_id || !seen.has(e.message_id)) {
                  merged.push(e);
                  if (e.message_id) seen.add(e.message_id);
                }
              }
            }
            merged.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
            setThreadEmails(merged);
          } else {
            setThreadEmails(primaryEmails);
          }
        });
    } else if (sd.email_id) {
      // Single email — no thread
      supabase
        .from('emails')
        .select('id, message_id, in_reply_to, references_ids, from_address, from_name, to_addresses, cc_addresses, subject, body, html_body, received_at, is_from_user, metadata')
        .eq('id', sd.email_id)
        .maybeSingle()
        .then(({ data }) => {
          setThreadEmails(data ? [data] : []);
        });
    } else {
      setThreadEmails([]);
    }
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

  // Avatar helpers for thread
  const AVATAR_COLORS = [
    'bg-indigo-100 text-indigo-700', 'bg-violet-100 text-violet-700',
    'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700',
    'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700',
  ];
  const avatarColor = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  };
  const initials = (name: string) =>
    name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  const handleExpandMsg = useCallback((idx: number) => {
    setExpandedEmails(prev => ({ ...prev, [idx]: !prev[idx] }));
  }, []);
  // Reset folder + reply state when item changes
  useEffect(() => {
    setShowMoveMenu(false);
    setExpandedEmails({});
    setReplyOpen(false);
    setShowSignature(true);
    onReplyBodyChange('');
    onReplyOpenChange?.(false);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open + fill reply box when a pending draft arrives from chat (Use as reply path)
  useEffect(() => {
    if (pendingReplyDraft != null) {
      onReplyBodyChange(pendingReplyDraft.body);
      if (pendingReplyDraft.cc) { setReplyCc(pendingReplyDraft.cc); setCcChips(pendingReplyDraft.cc.split(',').map(e => ({ email: e.trim() })).filter(c => c.email)); setShowReplyCc(true); }
      if (pendingReplyDraft.bcc) { setReplyBcc(pendingReplyDraft.bcc); setBccChips(pendingReplyDraft.bcc.split(',').map(e => ({ email: e.trim() })).filter(c => c.email)); setShowReplyBcc(true); }
      setReplyOpen(true);
      onReplyOpenChange?.(true);
      setTimeout(() => replyBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }, [pendingReplyDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inject or remove signature block in reply box when showSignature / signatureHtml change
  useEffect(() => {
    if (!replyOpen) return;
    const el = replyTextareaRef.current;
    if (!el) return;

    // If el just mounted empty but replyBody already has content (e.g. AI draft injected
    // in the same batch as setReplyOpen), seed el first so the sig appends to the draft
    // rather than overwriting it.
    if (!el.innerHTML.trim() && replyBody) {
      el.innerHTML = replyBody;
    }

    const existing = el.querySelector('[data-sig="1"]') as HTMLElement | null;
    if (existing) existing.remove();

    if (showSignature && signatureHtml) {
      const sigDiv = document.createElement('div');
      sigDiv.setAttribute('data-sig', '1');
      sigDiv.innerHTML = `<br>-- <br>${signatureHtml}`;
      el.appendChild(sigDiv);
    }

    const html = el.innerHTML;
    lastExternalReplyBody.current = html;
    onReplyBodyChange(html);
  }, [showSignature, signatureHtml, replyOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync externally-set replyBody (AI draft) into the contenteditable, preserving sig
  useEffect(() => {
    const el = replyTextareaRef.current;
    if (!el || replyBody === lastExternalReplyBody.current) return;
    lastExternalReplyBody.current = replyBody;

    const existingSig = el.querySelector('[data-sig="1"]')?.outerHTML ?? '';
    el.innerHTML = replyBody;
    if (existingSig && !el.querySelector('[data-sig="1"]')) {
      el.innerHTML = el.innerHTML + existingSig;
    }
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

  const handleReplySync = useCallback(() => {
    const html = replyTextareaRef.current?.innerHTML ?? '';
    lastExternalReplyBody.current = html;
    onReplyBodyChange(html);
  }, [onReplyBodyChange]);

  const handleCcChips = (chips: AttendeeChip[]) => {
    setCcChips(chips);
    setReplyCc(chips.map(c => c.email).join(', '));
  };

  const handleBccChips = (chips: AttendeeChip[]) => {
    setBccChips(chips);
    setReplyBcc(chips.map(c => c.email).join(', '));
  };

  const handleSendReply = async () => {
    if (!item || !replyBody.replace(/<[^>]*>/g, '').trim()) return;
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
      setCcChips([]);
      setBccChips([]);
      onReplySent?.(item.id);
    } catch {
      toast.error('Could not send reply');
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleOpenMoveMenu = () => {
    if (moveBtnRef.current) {
      const rect = moveBtnRef.current.getBoundingClientRect();
      setMoveMenuPos({ top: rect.top, right: window.innerWidth - rect.right });
    }
    setShowMoveMenu(true);
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

        {/* Conversation thread stack — live from emails table, oldest first, latest expanded */}
        {(() => {
          const sd = sourceData as any;
          const currentEmailId: string = sd?.email_id ?? '';

          // Helper: parse display name from "Name <email>" or bare email
          const parseName = (addr: string) => {
            const m = addr.match(/^(.+?)\s*<[^>]+>$/);
            return m ? m[1].trim() : addr.trim();
          };

          // Helper: format recipient list (max 2 inline, +N chip)
          const formatRecipients = (addrs: string[] | null) => {
            if (!addrs?.length) return null;
            const names = addrs.map(parseName);
            if (names.length <= 2) return names.join(', ');
            return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
          };

          // Loading skeleton
          if (threadEmails === null) {
            return (
              <div className="space-y-1.5 animate-pulse">
                <div className="h-11 bg-neutral-100 rounded-lg" />
                <div className="h-11 bg-neutral-100 rounded-lg" />
              </div>
            );
          }

          // Split into older + latest
          const latestIdx = threadEmails.findIndex(e => e.id === currentEmailId);
          const latest = latestIdx >= 0 ? threadEmails[latestIdx] : threadEmails[threadEmails.length - 1];
          const older = latestIdx > 0 ? threadEmails.slice(0, latestIdx) : threadEmails.slice(0, -1);

          const ALWAYS_VISIBLE = 2;
          const hidden = older.length > ALWAYS_VISIBLE ? older.slice(0, older.length - ALWAYS_VISIBLE) : [];
          const visible = older.length > ALWAYS_VISIBLE ? older.slice(older.length - ALWAYS_VISIBLE) : older;

          const renderOlderMsg = (msg: any, idx: number) => {
            const name = msg.is_from_user ? 'You' : (msg.from_name || msg.from_address || 'Unknown');
            const isExpanded = !!expandedEmails[idx];
            return (
              <div key={msg.id ?? idx} className="border border-neutral-200 bg-white rounded-lg overflow-hidden">
                <button
                  onClick={() => handleExpandMsg(idx)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-50 transition-colors"
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${avatarColor(name)}`}>
                    {initials(name)}
                  </div>
                  <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                    <span className="text-[12px] font-semibold text-neutral-700 flex-shrink-0">{name}</span>
                    {!isExpanded && msg.body && (
                      <span className="text-[12px] text-neutral-400 truncate block">{msg.body.replace(/\n/g, ' ').trim()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[11px] text-neutral-400">
                      {new Date(msg.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                    <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-neutral-100">
                    <IframeEmailBody html={msg.html_body ?? null} plain={msg.body ?? null} />
                  </div>
                )}
              </div>
            );
          };

          const latestName = latest ? (latest.is_from_user ? 'You' : (latest.from_name || latest.from_address || 'Unknown')) : (sd?.from_name || sd?.from || 'Unknown');
          const toStr = latest ? formatRecipients(latest.to_addresses) : formatRecipients(sd?.to_addresses);
          const ccStr = latest ? formatRecipients(latest.cc_addresses) : formatRecipients(sd?.cc_addresses);

          return (
            <div className="space-y-1.5">
              {/* Hidden older messages behind fold */}
              {hidden.length > 0 && showAllHistory && hidden.map((msg: any, i: number) => renderOlderMsg(msg, i))}

              {/* "Show earlier" pill */}
              {hidden.length > 0 && (
                <button
                  onClick={() => setShowAllHistory(v => !v)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <ChevronRightIcon className={`w-3 h-3 transition-transform duration-150 ${showAllHistory ? '-rotate-90' : 'rotate-90'}`} />
                  {showAllHistory ? 'Hide earlier messages' : `Show ${hidden.length} earlier message${hidden.length !== 1 ? 's' : ''}`}
                </button>
              )}

              {/* Always-visible older messages */}
              {visible.map((msg: any, i: number) => renderOlderMsg(msg, hidden.length + i))}

              {/* Latest message — always expanded */}
              {(latest?.html_body || latest?.body || sd?.html_body || sd?.body) && (
                <div className="border border-neutral-200 bg-white rounded-lg shadow-sm overflow-hidden">
                  {/* Header: avatar + sender + date */}
                  <div className="flex items-center gap-3 px-3 py-2.5 border-b border-neutral-100">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${avatarColor(latestName)}`}>
                      {initials(latestName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-neutral-800 truncate">{latestName}</div>
                      {toStr && (
                        <div className="text-[11px] text-neutral-400 truncate">
                          <span className="font-medium">To:</span> {toStr}
                          {ccStr && <><span className="ml-2 font-medium">CC:</span> {ccStr}</>}
                        </div>
                      )}
                    </div>
                    {(latest?.received_at || sd?.received_at) && (
                      <span className="text-[11px] text-neutral-400 flex-shrink-0">
                        {new Date(latest?.received_at ?? sd.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                    )}
                  </div>
                  <IframeEmailBody
                    html={latest?.html_body ?? (sd?.html_body as string | null)}
                    plain={latest?.body ?? (sd?.body as string | null)}
                  />
                </div>
              )}
            </div>
          );
        })()}

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
                  onClick={() => { setReplyOpen(false); onReplyOpenChange?.(false); onReplyBodyChange(''); setReplyCc(''); setReplyBcc(''); setShowReplyCc(false); setShowReplyBcc(false); setCcChips([]); setBccChips([]); }}
                  className="text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            {showReplyCc && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100 relative">
                <span className="text-[11px] font-semibold text-neutral-400 w-8 flex-shrink-0">CC</span>
                <AttendeeInput value={ccChips} onChange={handleCcChips} noBorder compact placeholder="cc@example.com" />
              </div>
            )}
            {showReplyBcc && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100 relative">
                <span className="text-[11px] font-semibold text-neutral-400 w-8 flex-shrink-0">BCC</span>
                <AttendeeInput value={bccChips} onChange={handleBccChips} noBorder compact placeholder="bcc@example.com" />
              </div>
            )}
            <div className="px-4 pt-3 pb-2">
              <div
                ref={replyTextareaRef}
                contentEditable
                suppressContentEditableWarning
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onInput={() => {
                  const html = replyTextareaRef.current?.innerHTML ?? '';
                  lastExternalReplyBody.current = html;
                  onReplyBodyChange(html);
                }}
                data-placeholder="Write your reply…"
                className="w-full text-[13px] text-neutral-800 border-0 outline-none leading-relaxed overflow-y-auto"
                style={{ minHeight: '120px', maxHeight: '400px' }}
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
              {/* Attach + format toolbar */}
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <div className="relative flex-shrink-0">
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

                <div className="w-px h-4 bg-neutral-200 flex-shrink-0" />
                <FormatToolbar editorRef={replyTextareaRef} onSync={handleReplySync} />
                <div className="w-px h-4 bg-neutral-200 flex-shrink-0" />
                <button
                  type="button"
                  onClick={() => setShowSignature(v => !v)}
                  disabled={!signatureHtml}
                  className={`text-[11px] font-medium transition-colors ${showSignature && signatureHtml ? 'text-indigo-600' : 'text-neutral-400 hover:text-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed'}`}
                  title={!signatureHtml ? 'No signature configured' : showSignature ? 'Remove signature' : 'Add signature'}
                >
                  Sig
                </button>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { setReplyOpen(false); onReplyOpenChange?.(false); onReplyBodyChange(''); setReplyAttachments([]); setReplyCc(''); setReplyBcc(''); setShowReplyCc(false); setShowReplyBcc(false); setCcChips([]); setBccChips([]); }}
                  disabled={isSendingReply}
                  className="px-3 py-1.5 text-[12px] font-medium text-neutral-500 hover:text-neutral-700 disabled:opacity-50 transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={handleSendReply}
                  disabled={isSendingReply || !replyBody.replace(/<[^>]*>/g, '').trim()}
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
                      <>
                          {!!availableFolders?.length && (
                            <div className="max-h-48 overflow-y-auto">
                              {availableFolders.map(f => (
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
