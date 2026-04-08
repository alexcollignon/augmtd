'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SidebarNav from '@/components/sidebar-nav';
import EmailListSections from '@/components/inbox/email-list-sections';
import EmailListChronological from '@/components/inbox/email-list-chronological';
import WorkDetailInline from '@/components/inbox/work-detail-inline';
import AiChatPanel from '@/components/shared/ai-chat-panel';
import WorkflowPanel from '@/components/inbox/workflow-panel';
import MeetingsColumn from '@/components/inbox/meetings-column';
import OnboardingModal from '@/components/onboarding-modal';
import { ArrowPathIcon, ChatBubbleLeftRightIcon, SparklesIcon, Bars3Icon, QueueListIcon, ArchiveBoxArrowDownIcon, XMarkIcon, MagnifyingGlassIcon, PencilSquareIcon, CalendarIcon, RectangleGroupIcon, TrashIcon } from '@heroicons/react/24/outline';
import ComposePanel from '@/components/inbox/compose-panel';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/lib/types/meetings';
import type { InboxItem } from '@/lib/types/inbox';

import DeskPageClient from '@/app/desk/desk-page-client';

type ViewMode = 'chronological' | 'smart';
type Density = 'normal' | 'compact';

interface InboxPageClientProps {
  initialUser: any;
  initialUserFullName?: string;
  initialHasConnection: boolean;
  initialInboxItems: any[];
}

export function InboxPageClient({
  initialUser,
  initialUserFullName,
  initialHasConnection,
  initialInboxItems,
}: InboxPageClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [user] = useState(initialUser);
  const [hasConnection, setHasConnection] = useState(initialHasConnection);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialInboxItems);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('chronological');
  const [density, setDensity] = useState<Density>('normal');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteConfirmPending, setBulkDeleteConfirmPending] = useState(false);
  const [bulkArchiveConfirmPending, setBulkArchiveConfirmPending] = useState(false);

  const [showDesk, setShowDesk] = useState(false);
  const [deskClosing, setDeskClosing] = useState(false);

  const closeDesk = useCallback(() => {
    setDeskClosing(true);
    setTimeout(() => { setShowDesk(false); setDeskClosing(false); }, 300);
  }, []);

  // Search state (client-side filter on left list)
  const [searchQuery, setSearchQuery] = useState('');

  // Right panel + compose state
  const [rightPanel, setRightPanel] = useState<'calendar' | 'chat' | 'workflow' | null>('calendar');
  const [composeMode, setComposeMode] = useState(false);
  const [composeDraft, setComposeDraft] = useState({ to: '', cc: '', subject: '', body: '' });
  // AI-drafted reply flow
  const [pendingReplyDraft, setPendingReplyDraft] = useState<{ body: string; cc?: string; bcc?: string } | null>(null);
  const [replyIsOpen, setReplyIsOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const autoFiredReplyRef = useRef(false);
  const deepLinkFiredRef = useRef<string | null>(null);
  // Email context chip
  const [chipDismissed, setChipDismissed] = useState(false);

  // Chat / Ask state
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [chatSources, setChatSources] = useState<string[]>(['inbox', 'kb', 'calendar']);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ filename: string; extractedText: string }>>([]);
  const [isAttaching, setIsAttaching] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const optimisticSyncTriggered = useRef(false);
  const isSyncingRef = useRef(false);
  const preSyncCountRef = useRef<number | null>(null);
  const outlookLastPolledRef = useRef<number>(0);

  // Restore persisted preferences after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const savedView = localStorage.getItem('inboxViewMode') as ViewMode | null;
    if (savedView === 'smart' || savedView === 'chronological') setViewMode(savedView);
    const savedDensity = localStorage.getItem('inboxDensity') as Density | null;
    if (savedDensity === 'normal' || savedDensity === 'compact') setDensity(savedDensity);
    // Auto-select most recently received item after hydration (can't do during SSR — causes dangerouslySetInnerHTML mismatch)
    const latest = inboxItems.length
      ? inboxItems.reduce((a, b) => new Date((b as any).created_at) > new Date((a as any).created_at) ? b : a)
      : null;
    setSelectedItem(prev => prev ?? latest);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('inboxViewMode', mode);
  };

  const handleDensity = (d: Density) => {
    setDensity(d);
    localStorage.setItem('inboxDensity', d);
  };

  // Check actual context profile to decide whether to show onboarding
  useEffect(() => {
    fetch('/api/context/onboarding')
      .then(r => r.json())
      .then(data => {
        if (!data.completed) setIsOnboardingOpen(true);
      })
      .catch(() => {}); // non-fatal
  }, []);

  // Sync connection state
  useEffect(() => {
    setHasConnection(initialHasConnection);
  }, [initialHasConnection]);

  // Fetch meetings (shared between top bar and calendar column)
  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings');
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings || []);
      }
    } catch {
      // non-fatal
    } finally {
      setMeetingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();
    const interval = setInterval(fetchMeetings, 60000);

    // Refresh immediately when a meeting/recording is added or deleted from another page
    const channel = new BroadcastChannel('meetings-updated');
    channel.onmessage = () => fetchMeetings();

    return () => {
      clearInterval(interval);
      channel.close();
    };
  }, [fetchMeetings]);

  // Deep-link: ?item=<uuid> auto-selects a specific inbox item (e.g. from desk card)
  useEffect(() => {
    const itemId = searchParams?.get('item');
    if (!itemId || inboxItems.length === 0) return;
    if (deepLinkFiredRef.current === itemId) return; // already handled this specific item
    const target = inboxItems.find((i) => i.id === itemId);
    if (target) {
      deepLinkFiredRef.current = itemId;
      setShowDesk(false);
      handleSelectItem(target);
      window.history.replaceState({}, '', '/inbox');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxItems, searchParams]);

  // Trigger initial sync after connecting
  useEffect(() => {
    const successParam = searchParams?.get('success');
    const justConnected = successParam === 'outlook_connected' || successParam === 'gmail_connected';

    if (justConnected && hasConnection) {
      setIsSyncing(true);
      optimisticSyncTriggered.current = true;
      window.history.replaceState({}, '', '/inbox');
      fetch('/api/connections/sync', { method: 'POST' }).catch(() => {
        setIsSyncing(false);
        optimisticSyncTriggered.current = false;
      });
    }
  }, [searchParams, hasConnection]);

  // Realtime subscription — new items appear instantly without polling
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox_items:${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inbox_items',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const item = payload.new as InboxItem;
          if (item.status === 'pending') {
            setInboxItems(prev => prev.some(i => i.id === item.id) ? prev : [item, ...prev]);
            setSelectedItem(prev => prev ?? item);
          }
        } else if (payload.eventType === 'UPDATE') {
          setInboxItems(prev => prev.map(i => i.id === (payload.new as any).id ? payload.new as InboxItem : i));
        } else if (payload.eventType === 'DELETE') {
          setInboxItems(prev => prev.filter(i => i.id !== (payload.old as any).id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id]);

  // Poll for sync status only (inbox items arrive via Realtime above)
  useEffect(() => {
    const supabase = createClient();

    async function fetchData() {
      const { data: connections, error: connectionsError } = await supabase
        .from('connections')
        .select('sync_status, sync_started_at, provider')
        .eq('user_id', user.id)
        .in('provider', ['gmail', 'outlook'])
        .eq('status', 'active');

      if (connectionsError) {
        if (connectionsError.message?.includes('JWT') || connectionsError.code === 'PGRST301') {
          window.location.href = '/login?session=expired';
          return;
        }
      }

      if (connections && connections.length > 0) {
        const STALE_MS = 5 * 60 * 1000; // 5 minutes
        const isCurrentlySyncing = connections.some(conn => {
          if (conn.sync_status !== 'syncing') return false;
          if (!conn.sync_started_at) return true;
          return Date.now() - new Date(conn.sync_started_at).getTime() < STALE_MS;
        });
        const allCompleted = connections.every(conn =>
          conn.sync_status === 'completed' || conn.sync_status === 'failed'
        );

        const wasSyncing = isSyncingRef.current;

        if (optimisticSyncTriggered.current) {
          if (isCurrentlySyncing || allCompleted) {
            optimisticSyncTriggered.current = false;
            isSyncingRef.current = isCurrentlySyncing;
            setIsSyncing(isCurrentlySyncing);
          }
        } else {
          if (isSyncingRef.current !== isCurrentlySyncing) {
            // Capture count just before sync starts
            if (isCurrentlySyncing && preSyncCountRef.current === null) {
              preSyncCountRef.current = inboxItems.length;
            }
            isSyncingRef.current = isCurrentlySyncing;
            setIsSyncing(isCurrentlySyncing);
          }
        }

        // During sync: poll inbox_items every 2s as fallback for unreliable Realtime bulk delivery
        if (isCurrentlySyncing) {
          const { data: syncItems } = await supabase
            .from('inbox_items')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
          if (syncItems) {
            setInboxItems(syncItems);
            setSelectedItem(prev =>
              prev ? (syncItems.find(i => i.id === prev.id) ?? prev) : (syncItems[0] ?? null)
            );
          }
        }

        if (wasSyncing && !isCurrentlySyncing) {
          // Full refetch as catch-all for items that arrived before Realtime was subscribed
          const { data: freshItems } = await supabase
            .from('inbox_items')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
          if (freshItems) {
            setInboxItems(freshItems);
            setSelectedItem(prev => prev ? (freshItems.find(i => i.id === prev.id) ?? prev) : (freshItems[0] ?? null));
          }
          const newCount = (freshItems || []).length;
          const prevCount = preSyncCountRef.current ?? newCount;
          const delta = newCount - prevCount;
          preSyncCountRef.current = null;
          if (delta > 0) {
            toast.success(`Sync complete — ${delta} new item${delta !== 1 ? 's' : ''}`);
          } else {
            toast.success('Inbox up to date');
          }
        }

        // Outlook has no reliable push catchup mechanism — poll every 2 minutes while inbox is open
        const hasOutlook = connections.some(c => c.provider === 'outlook');
        if (hasOutlook && !isCurrentlySyncing && Date.now() - outlookLastPolledRef.current > 2 * 60 * 1000) {
          outlookLastPolledRef.current = Date.now();
          fetch('/api/connections/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'outlook' }),
          }).catch(() => {});
        }
      }
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    function scheduleNext() {
      const delay = isSyncingRef.current ? 2000 : 10000;
      timeoutId = setTimeout(async () => {
        await fetchData();
        scheduleNext();
      }, delay);
    }

    fetchData().then(scheduleNext);
    return () => clearTimeout(timeoutId);
  }, [user.id, hasConnection]); // eslint-disable-line react-hooks/exhaustive-deps

  const preparedItems = inboxItems.filter((item: any) => ['reply', 'decision', 'meeting', 'review'].includes(item.item_type));
  const meetingAssistantItems = inboxItems.filter((item: any) => item.source === 'meeting');

  const filteredItems = useMemo(() => {
    let items = inboxItems;
    // Smart tab hides noise items; all other work_states (including 'noted') appear
    if (viewMode === 'smart') {
      items = items.filter(item => (item as any).work_state !== 'noise');
    }
    const q = searchQuery.trim().toLowerCase();
    // Always show at least the most recent item when no search is active
    if (!q && items.length === 0 && inboxItems.length > 0) {
      items = [inboxItems[0]];
    }
    if (!q) return items;
    return items.filter(item => {
      const sd = (item as any).source_data;
      return (
        (sd?.from_name || '').toLowerCase().includes(q) ||
        (sd?.from || '').toLowerCase().includes(q) ||
        (sd?.subject || '').toLowerCase().includes(q) ||
        (sd?.snippet || '').toLowerCase().includes(q)
      );
    });
  }, [inboxItems, searchQuery, viewMode]);

  const handleItemConfirmed = (ids: string[], _action: 'confirm_as_mine' | 'not_my_task') => {
    const idsSet = new Set(ids);

    // Determine if the currently selected item is being removed
    const batchItems: InboxItem[] | undefined = (selectedItem as any)?.__batchItems;
    const currentIsRemoved = selectedItem && (
      idsSet.has(selectedItem.id) ||
      (batchItems && batchItems.every(b => idsSet.has(b.id)))
    );

    // Auto-select the next item in the visible list
    let nextSelected: InboxItem | null = null;
    if (currentIsRemoved && selectedItem) {
      const currentIndex = filteredItems.findIndex(i => i.id === selectedItem.id);
      const remaining = filteredItems.filter(i => !idsSet.has(i.id));
      nextSelected = remaining[currentIndex] ?? remaining[currentIndex - 1] ?? null;
    }

    setInboxItems(prev => prev.filter(i => !idsSet.has(i.id)));
    if (currentIsRemoved) setSelectedItem(nextSelected);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearSelection = () => { setSelectedIds(new Set()); setBulkArchiveConfirmPending(false); setBulkDeleteConfirmPending(false); };

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    setIsBulkArchiving(true);
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/inbox/${id}/archive-source`, { method: 'POST' })
      ));
      setInboxItems(prev => prev.filter(i => !ids.includes(i.id)));
      setSelectedItem(prev => (prev && ids.includes(prev.id) ? null : prev));
      clearSelection();
      toast.success(`${ids.length} email${ids.length > 1 ? 's' : ''} archived`);
    } catch {
      toast.error('Could not archive emails');
    } finally {
      setIsBulkArchiving(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setIsBulkDeleting(true);
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/inbox/${id}/delete-source`, { method: 'POST' })
      ));
      setInboxItems(prev => prev.filter(i => !ids.includes(i.id)));
      setSelectedItem(prev => (prev && ids.includes(prev.id) ? null : prev));
      clearSelection();
      toast.success(`${ids.length} email${ids.length > 1 ? 's' : ''} deleted`);
    } catch {
      toast.error('Could not delete emails');
    } finally {
      setIsBulkDeleting(false);
      setBulkDeleteConfirmPending(false);
    }
  };

  const handleSelectItem = (item: InboxItem) => {
    setSelectedItem(item);
    // Mark as read in our DB + on the provider (fire-and-forget)
    if (item.is_read === false) {
      setInboxItems(prev => prev.map(i => i.id === item.id ? { ...i, is_read: true } : i));
      fetch(`/api/inbox/${item.id}/mark-read`, { method: 'POST' }).catch(() => {});
    }
    setComposeMode(false);
    setChipDismissed(false);
    setRightPanel('chat');
    setPendingReplyDraft(null);
    setReplyBody('');
    setReplyIsOpen(false);
    autoFiredReplyRef.current = false;
    setChatHistory([]);
    setChatInput('');
    setAttachedFiles([]);
  };

  const emailChipActive = !!selectedItem && !chipDismissed && rightPanel === 'chat' && !composeMode;
  const emailChipData = selectedItem ? {
    subject: (selectedItem as any).source_data?.subject,
    from: (selectedItem as any).source_data?.from_address || (selectedItem as any).source_data?.from,
    fromName: (selectedItem as any).source_data?.from_name,
    summary: (selectedItem as any).source_data?.summary,
    keyPoints: (selectedItem as any).source_data?.keyPoints,
    body: (selectedItem as any).source_data?.body,
    itemType: (selectedItem as any).item_type ?? null,
    connectionId: (selectedItem as any).connection_id ?? null,
    isRead: (selectedItem as any).is_read !== false,
  } : null;

  const handleDeleteItem = useCallback(async (itemId: string) => {
    setInboxItems(prev => prev.filter(i => i.id !== itemId));
    setSelectedItem(prev => (prev?.id === itemId ? null : prev));
    await fetch(`/api/inbox/${itemId}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'deleted_from_list' }),
    });
  }, []);

  const handleArchiveItem = useCallback(async (itemId: string) => {
    setInboxItems(prev => prev.filter(i => i.id !== itemId));
    setSelectedItem(prev => (prev?.id === itemId ? null : prev));
    await fetch(`/api/inbox/${itemId}/archive-source`, { method: 'POST' });
  }, []);

  const handleChatAction = useCallback(async (type: string, itemId: string) => {
    if (type === 'archive') {
      const res = await fetch(`/api/inbox/${itemId}/archive-source`, { method: 'POST' });
      if (!res.ok) throw new Error('Archive failed');
      setInboxItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedItem(prev => (prev?.id === itemId ? null : prev));
    } else if (type === 'open') {
      const item = inboxItems.find(i => i.id === itemId);
      if (item) handleSelectItem(item);
    }
  }, [inboxItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenWorkflow = useCallback((itemId: string, skill?: string, prefillTitle?: string) => {
    const params = new URLSearchParams();
    if (skill) params.set('skill', skill);
    if (prefillTitle) params.set('title', prefillTitle);
    if (itemId) params.set('fromItem', itemId);
    router.push(`/work/new?${params.toString()}`);
  }, [router]);

  const handleOpenProcess = useCallback((processId: string) => {
    router.push(`/processes/${processId}`);
  }, [router]);

  const openChat = () => {
    setRightPanel('chat');
    setTimeout(() => chatInputRef.current?.focus(), 50);
  };

  const closeChat = () => {
    setRightPanel(null);
    setChatInput('');
    setChatHistory([]);
    setAttachedFiles([]);
    setComposeMode(false);
    setComposeDraft({ to: '', cc: '', subject: '', body: '' });
  };

  const handleOpenCompose = useCallback((draft: Partial<{ to: string; cc: string; subject: string; body: string }>) => {
    setComposeDraft(prev => ({ ...prev, ...draft }));
    setComposeMode(true);
    setRightPanel('chat');
  }, []);

  const handleUseAsReply = useCallback((body: string, cc?: string, bcc?: string) => {
    setPendingReplyDraft({ body, cc, bcc });
  }, []);

  const handleReplyOpenChange = useCallback((open: boolean) => {
    setReplyIsOpen(open);
    if (open) setRightPanel('chat');
    else setPendingReplyDraft(null); // clear so "Use as reply" can re-trigger after discard
  }, []);

  const handleUpdateReplyDraft = useCallback((body: string) => {
    setReplyBody(body);
    setReplyIsOpen(true);
  }, []);

  // Auto-fire "Draft a reply" the first time reply box opens for an email
  useEffect(() => {
    if (replyIsOpen && !autoFiredReplyRef.current && chatHistory.length === 0) {
      autoFiredReplyRef.current = true;
      const timer = setTimeout(() => sendChatMessage('Draft a reply to this email'), 150);
      return () => clearTimeout(timer);
    }
  }, [replyIsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileAttach = useCallback(async (file: File) => {
    setIsAttaching(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/inbox/chat/attach', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setAttachedFiles(prev => [...prev, { filename: data.filename, extractedText: data.extractedText }]);
    } catch (err: any) {
      toast.error(err.message || 'Could not extract text from this file type');
    } finally {
      setIsAttaching(false);
    }
  }, []);

  const sendChatMessage = useCallback(async (message: string) => {
    if (!message.trim() || chatStreaming) return;
    const userMessage = message.trim();
    const fileContext = attachedFiles.length
      ? attachedFiles.map(f => `=== ${f.filename} ===\n${f.extractedText}`).join('\n\n')
      : undefined;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatStreaming(true);
    setStreamingContent('');

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: 'inbox',
          message: userMessage,
          history: chatHistory,
          sources: chatSources,
          mode: composeMode ? 'compose' : replyIsOpen ? 'reply' : 'inbox',
          ...(composeMode && composeDraft.body ? { composeDraft } : {}),
          ...(replyIsOpen ? { replyDraft: replyBody } : {}),
          ...(fileContext ? { fileContext } : {}),
          ...(emailChipActive && emailChipData ? { emailContext: emailChipData } : {}),
        }),
      });

      if (!res.ok || !res.body) throw new Error('Chat request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setStreamingContent(full);
      }

      setChatHistory(prev => [...prev, { role: 'assistant', content: full }]);

      // Extract REPLY_DRAFT token — open reply box if not already open, else update in place
      try {
        const m = full.match(/REPLY_DRAFT:(\{[\s\S]+?\})/);
        if (m) {
          const parsed = JSON.parse(m[1]);
          if (parsed?.body) {
            // Always go through pendingReplyDraft so WorkDetailInline can handle cc/bcc too
            setPendingReplyDraft({ body: parsed.body, cc: parsed.cc, bcc: parsed.bcc });
            autoFiredReplyRef.current = true;
          }
        }
      } catch {}
    } catch {
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setChatStreaming(false);
      setStreamingContent('');
      setAttachedFiles([]);
    }
  }, [chatHistory, chatStreaming, chatSources, attachedFiles, composeMode, composeDraft, replyIsOpen, replyBody, emailChipActive, emailChipData]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden">
      <SidebarNav userEmail={user?.email} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Syncing banner */}
        {isSyncing && (
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
            <ArrowPathIcon className="w-4 h-4 text-indigo-600 animate-spin flex-shrink-0" />
            <p className="text-[13px] text-indigo-800 font-medium">
              {(() => {
                const delta = preSyncCountRef.current !== null
                  ? inboxItems.length - preSyncCountRef.current
                  : 0;
                return delta > 0
                  ? `Syncing… ${delta} new item${delta !== 1 ? 's' : ''} so far`
                  : 'Syncing your inbox…';
              })()}
            </p>
          </div>
        )}

        {/* No connection */}
        {!hasConnection && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm">
              <div className="w-14 h-14 mx-auto mb-4 bg-indigo-50 flex items-center justify-center">
                <SparklesIcon className="w-7 h-7 text-indigo-600" />
              </div>
              <h3 className="text-[17px] font-semibold text-neutral-900 mb-2">Connect Your Email</h3>
              <p className="text-[14px] text-neutral-600 mb-6">
                Connect Gmail or Outlook to start receiving AI-prepared work
              </p>
              <Link
                href="/settings"
                className="inline-flex items-center px-6 py-2.5 bg-indigo-600 text-white text-[14px] font-semibold hover:bg-indigo-700 transition-all"
              >
                Go to Settings
              </Link>
            </div>
          </div>
        )}

        {/* Desk + inbox stacked — desk slides up from below */}
        {hasConnection && (
          <div className="flex-1 min-h-0 relative overflow-hidden">

            {/* Desk panel — slides up from below, unmounts after close animation */}
            {(showDesk || deskClosing) && (
              <div className={`absolute inset-0 z-50 ${deskClosing ? 'desk-slide-down' : 'desk-slide-up'}`}>
                <DeskPageClient onClose={closeDesk} />
              </div>
            )}

            {/* 3-column inbox layout */}
            <div className="absolute inset-0 flex min-h-0 overflow-hidden">
            {/* Left: email list */}
            <div className="w-[272px] flex-shrink-0 flex flex-col bg-neutral-50 p-2">
              <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">

              {/* View + density toggles */}
              <div className="flex-shrink-0 flex items-center justify-between pl-2.5 pr-1 h-10 border-b border-neutral-100">
                {/* Segmented view tabs */}
                <div className="relative grid grid-cols-2 bg-neutral-100 rounded-full p-0.5">
                  <div
                    className="absolute inset-y-0.5 w-[calc(50%-2px)] rounded-full bg-white shadow-sm pointer-events-none"
                    style={{
                      left: viewMode === 'smart' ? '50%' : '2px',
                      transition: 'left 180ms ease-in-out',
                    }}
                  />
                  {(['chronological', 'smart'] as const).map((key) => {
                    const labels = { chronological: 'Standard', smart: 'Smart' };
                    return (
                      <button
                        key={key}
                        onClick={() => handleViewMode(key)}
                        className={`relative z-10 px-2.5 py-0.5 text-[11px] font-medium rounded-full text-center transition-colors duration-180 ${
                          viewMode === key ? 'text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        {labels[key]}
                      </button>
                    );
                  })}
                </div>

                {/* Density toggles + action icons */}
                <div className="flex items-center">
                  {/* Density — subtle toggles */}
                  <button
                    onClick={() => handleDensity('normal')}
                    title="Normal density"
                    className={`p-1 transition-colors ${
                      density === 'normal' ? 'text-neutral-400' : 'text-neutral-300 hover:text-neutral-400'
                    }`}
                  >
                    <QueueListIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDensity('compact')}
                    title="Compact density"
                    className={`p-1 transition-colors ${
                      density === 'compact' ? 'text-neutral-400' : 'text-neutral-300 hover:text-neutral-400'
                    }`}
                  >
                    <Bars3Icon className="w-3.5 h-3.5" />
                  </button>
                  {/* Divider */}
                  <div className="w-px h-3.5 bg-neutral-200 mx-1" />
                  {/* Compose — action icon, indigo tint */}
                  <button
                    onClick={() => {
                      setComposeMode(true);
                      setRightPanel('chat');
                      setTimeout(() => chatInputRef.current?.focus(), 50);
                    }}
                    title="Compose new email"
                    className={`p-1 transition-colors ${
                      composeMode ? 'text-indigo-500' : 'text-neutral-400 hover:text-indigo-500'
                    }`}
                  >
                    <PencilSquareIcon className="w-3.5 h-3.5" />
                  </button>
                  {/* Sync — action icon */}
                  <button
                    onClick={() => {
                      if (isSyncing) return;
                      preSyncCountRef.current = inboxItems.length;
                      setIsSyncing(true);
                      fetch('/api/connections/sync', { method: 'POST' }).catch(() => setIsSyncing(false));
                    }}
                    disabled={isSyncing}
                    title={isSyncing ? 'Syncing…' : 'Sync inbox'}
                    className="p-1 transition-colors text-neutral-400 hover:text-neutral-600 disabled:opacity-50"
                  >
                    <ArrowPathIcon className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Bulk action bar */}
              {selectedIds.size > 0 && (
                <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-indigo-100 bg-indigo-50 min-h-[36px]">
                  {isBulkArchiving ? (
                    <div className="flex items-center gap-2 flex-1">
                      <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-indigo-700">Archiving…</span>
                    </div>
                  ) : isBulkDeleting ? (
                    <div className="flex items-center gap-2 flex-1">
                      <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-red-700">Deleting…</span>
                    </div>
                  ) : bulkArchiveConfirmPending ? (
                    <>
                      <ArchiveBoxArrowDownIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-indigo-800 flex-1">
                        Archive {selectedIds.size} email{selectedIds.size > 1 ? 's' : ''}?
                      </span>
                      <button onClick={() => { setBulkArchiveConfirmPending(false); handleBulkArchive(); }} className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                        Confirm
                      </button>
                      <button onClick={() => setBulkArchiveConfirmPending(false)} className="p-1 text-indigo-400 hover:text-indigo-700 transition-colors" title="Cancel">
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : bulkDeleteConfirmPending ? (
                    <>
                      <TrashIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-red-800 flex-1">
                        Delete {selectedIds.size} email{selectedIds.size > 1 ? 's' : ''}?
                      </span>
                      <button onClick={() => { setBulkDeleteConfirmPending(false); handleBulkDelete(); }} className="px-2.5 py-1 text-[11px] font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors">
                        Confirm
                      </button>
                      <button onClick={() => setBulkDeleteConfirmPending(false)} className="p-1 text-red-400 hover:text-red-700 transition-colors" title="Cancel">
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] font-semibold text-indigo-700 flex-1">
                        {selectedIds.size} selected
                      </span>
                      <button
                        onClick={() => setBulkArchiveConfirmPending(true)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-700 border border-indigo-200 bg-white rounded-md hover:bg-indigo-50 transition-colors"
                      >
                        <ArchiveBoxArrowDownIcon className="w-3 h-3" />
                        Archive
                      </button>
                      <button
                        onClick={() => setBulkDeleteConfirmPending(true)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-red-600 border border-red-200 bg-white rounded-md hover:bg-red-50 transition-colors"
                      >
                        <TrashIcon className="w-3 h-3" />
                        Delete
                      </button>
                      <button onClick={clearSelection} className="p-1 text-indigo-300 hover:text-indigo-600 transition-colors" title="Clear selection">
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Email list */}
              <div className="flex-1 overflow-y-auto">
                {inboxItems.length === 0 && !isSyncing ? (
                  <div className="flex flex-col items-center justify-center h-full py-16 px-4 text-center">
                    <p className="text-[13px] text-neutral-500 font-medium mb-1">All caught up!</p>
                    <p className="text-[12px] text-neutral-400">
                      New items will appear here after the next sync.
                    </p>
                  </div>
                ) : filteredItems.length === 0 && searchQuery ? (
                  <div className="flex flex-col items-center justify-center h-full py-16 px-4 text-center">
                    <p className="text-[13px] text-neutral-500 font-medium mb-1">No results</p>
                    <p className="text-[12px] text-neutral-400">Try a different search term</p>
                  </div>
                ) : viewMode === 'chronological' ? (
                  <EmailListChronological
                    items={filteredItems}
                    selectedId={selectedItem?.id || null}
                    onSelect={handleSelectItem}
                    compact={density === 'compact'}
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onDelete={handleDeleteItem}
                    onArchive={handleArchiveItem}
                  />
                ) : (
                  <EmailListSections
                    items={filteredItems}
                    selectedId={selectedItem?.id || null}
                    onSelect={handleSelectItem}
                    compact={density === 'compact'}
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onDelete={handleDeleteItem}
                    onArchive={handleArchiveItem}
                  />
                )}
              </div>
              </div>
            </div>

            {/* Middle: search header + detail/compose */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col bg-neutral-50 pl-2 pt-2 pb-2">
              <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
              {/* Middle header — search + ask + compose */}
              <div className="flex-shrink-0 h-10 flex items-center gap-1 px-3 border-b border-neutral-100">
                {/* Search */}
                <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      setSearchQuery('');
                      searchInputRef.current?.blur();
                    }
                  }}
                  placeholder="Search inbox..."
                  className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="flex-shrink-0 p-0.5 text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Divider */}
                <div className="w-px h-4 bg-neutral-200 mx-1 flex-shrink-0" />

                {/* On Your Desk toggle */}
                <button
                  onClick={() => showDesk ? closeDesk() : setShowDesk(true)}
                  title="On Your Desk"
                  className={`flex-shrink-0 p-1.5 border rounded-md transition-colors ${
                    showDesk
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  <RectangleGroupIcon className="w-3.5 h-3.5" />
                </button>


              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                  {composeMode ? (
                    <ComposePanel
                      draft={composeDraft}
                      onChange={(fields) => setComposeDraft(prev => ({ ...prev, ...fields }))}
                      onDiscard={closeChat}
                      onSent={closeChat}
                    />
                  ) : (
                    <WorkDetailInline
                      key={selectedItem?.id ?? 'empty'}
                      item={selectedItem}
                      onItemConfirmed={handleItemConfirmed}
                      onRefreshMeetings={fetchMeetings}
                      pendingReplyDraft={pendingReplyDraft}
                      onReplySent={(itemId) => {
                        setPendingReplyDraft(null);
                        setReplyBody('');
                        setReplyIsOpen(false);
                        handleItemConfirmed([itemId], 'not_my_task');
                      }}
                      replyBody={replyBody}
                      onReplyBodyChange={setReplyBody}
                      onReplyOpenChange={handleReplyOpenChange}
                      onOpenWorkflowPanel={() => setRightPanel('workflow')}
                    />
                  )}
              </div>
              </div>
            </div>

            {/* Right panel — persistent wrapper, animates open/close */}
            <div className={`flex-shrink-0 bg-neutral-50 flex flex-col transition-[width] duration-200 overflow-hidden ${rightPanel ? 'w-[316px]' : 'w-12'}`}>
              {/* Closed — icon strip */}
              <div className={`flex flex-col items-center pt-3 gap-1.5 transition-opacity duration-150 ${rightPanel ? 'opacity-0 pointer-events-none absolute' : 'opacity-100'}`}>
                <button onClick={() => setRightPanel('calendar')} title="Calendar" className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors">
                  <CalendarIcon className="w-4 h-4" />
                </button>
                <button onClick={() => { setComposeMode(false); openChat(); }} title="Ask AI" className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors">
                  <ChatBubbleLeftRightIcon className="w-4 h-4" />
                </button>
              </div>
              {/* Open — full panel */}
              <div className={`flex-1 relative p-2 min-h-0 transition-opacity duration-150 ${rightPanel ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {/* Calendar panel — no transform (would break position:fixed week overlay) */}
                <div className={`absolute inset-2 transition-opacity duration-200 ${rightPanel === 'calendar' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                  <div className="h-full rounded-2xl bg-white shadow-sm overflow-hidden">
                    <MeetingsColumn
                      isOpen={true}
                      onToggle={() => setRightPanel(null)}
                      meetings={meetings}
                      loading={meetingsLoading}
                      userEmail={user?.email || ''}
                      onRefresh={fetchMeetings}
                      onChatOpen={() => { setComposeMode(false); openChat(); }}
                    />
                  </div>
                </div>
                {/* Chat panel */}
                <div className={`absolute inset-2 transition-all duration-200 ${rightPanel === 'chat' ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-2 pointer-events-none'}`}>
                  <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
                  <AiChatPanel
                    context="inbox"
                    composeDraft={composeMode ? composeDraft : undefined}
                    onUpdateComposeDraft={composeMode
                      ? (fields) => setComposeDraft(prev => ({ ...prev, ...fields }))
                      : undefined}
                    onOpenCompose={handleOpenCompose}
                    onUseAsReply={handleUseAsReply}
                    emailChipActive={emailChipActive}
                    emailChipData={emailChipData ?? undefined}
                    onDismissEmailChip={() => setChipDismissed(true)}
                    onSwitchToCalendar={() => setRightPanel('calendar')}
                    onClose={closeChat}
                    history={chatHistory}
                    streamingContent={streamingContent}
                    isStreaming={chatStreaming}
                    inboxItems={inboxItems}
                    onSelectItem={item => { setSelectedItem(item); setComposeMode(false); }}
                    onSendMessage={sendChatMessage}
                    onAction={handleChatAction}
                    chatInput={chatInput}
                    onChatInputChange={setChatInput}
                    chatInputRef={chatInputRef}
                    chatSources={chatSources}
                    onSourcesChange={setChatSources}
                    attachedFiles={attachedFiles}
                    onFileAttach={handleFileAttach}
                    onRemoveFile={(filename) => setAttachedFiles(prev => prev.filter(f => f.filename !== filename))}
                    isAttaching={isAttaching}
                    mode={composeMode ? 'compose' : replyIsOpen ? 'reply' : 'inbox'}
                    replyDraft={replyIsOpen ? replyBody : undefined}
                    onUpdateReplyDraft={handleUpdateReplyDraft}
                    onOpenWorkflow={handleOpenWorkflow}
                    onOpenProcess={handleOpenProcess}
                  />
                  </div>
                </div>
                {/* Workflow panel */}
                <div className={`absolute inset-2 transition-all duration-200 ${rightPanel === 'workflow' ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-2 pointer-events-none'}`}>
                  <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
                    <WorkflowPanel item={selectedItem} onClose={() => setRightPanel(null)} />
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}
      </div>

      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        userEmail={user?.email}
        userFullName={initialUserFullName}
      />

    </div>
  );
}
