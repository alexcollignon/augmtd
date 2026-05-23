'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import EmailListSections from '@/components/inbox/email-list-sections';
import EmailListChronological from '@/components/inbox/email-list-chronological';
import { type SentEmail } from '@/components/inbox/sent-email-list';
import FolderSidebar, { type ConnectionFolders, type SelectedFolder } from '@/components/inbox/folder-rail';
import FolderEmailList from '@/components/inbox/folder-email-list';
import WorkDetailInline from '@/components/inbox/work-detail-inline';
import type { FolderEmailSummary, MessageDetail } from '@/lib/google/gmail';
import AiChatPanel from '@/components/shared/ai-chat-panel';
import WorkflowPanel from '@/components/inbox/workflow-panel';
import MeetingsColumn from '@/components/inbox/meetings-column';
import { ArrowPathIcon, ChatBubbleLeftIcon, SparklesIcon, Bars3Icon, QueueListIcon, ArchiveBoxArrowDownIcon, XMarkIcon, MagnifyingGlassIcon, CalendarDaysIcon, TrashIcon, PaperClipIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import ComposePanel from '@/components/inbox/compose-panel';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/lib/types/meetings';
import type { InboxItem } from '@/lib/types/inbox';


type ViewMode = 'chronological' | 'smart';
type Density = 'normal' | 'compact';

function markdownToHtml(text: string): string {
  // If the AI already emitted HTML tags, skip escaping and just structure it
  const hasHtmlTags = /<[a-z][\s\S]*?>/i.test(text);

  const inlined = hasHtmlTags
    ? text  // pass through as-is, tags will render in contenteditable
    : text
        .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([\s\S]+?)\*/g, '<em>$1</em>')
        .replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');

  // Split on blank lines → blocks
  const blocks = inlined.split(/\n{2,}/);
  return blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    // List block: lines starting with - or *
    const lines = trimmed.split('\n');
    if (!hasHtmlTags && lines.every(l => /^[-*]\s/.test(l.trim()))) {
      const items = lines.map(l => `<li>${l.trim().replace(/^[-*]\s+/, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('');
}

function SentEmailDetail({ email }: { email: SentEmail }) {
  const toList = (email.to_addresses ?? []).join(', ') || '—';
  const sentDate = email.received_at
    ? new Date(email.received_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const attachments = email.metadata?.attachments ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b border-neutral-100">
        <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">{email.subject || '(no subject)'}</h2>
        <div className="space-y-0.5 text-[12px] text-neutral-500">
          <div><span className="font-medium text-neutral-700">To:</span> {toList}</div>
          {sentDate && <div><span className="font-medium text-neutral-700">Sent:</span> {sentDate}</div>}
        </div>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {attachments.map((att, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-100 rounded text-[11px] text-neutral-600">
                <PaperClipIcon className="w-3 h-3 flex-shrink-0" />
                <span className="max-w-[160px] truncate">{att.filename}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 text-[13px] text-neutral-800 leading-relaxed">
        {email.html_body
          ? <div dangerouslySetInnerHTML={{ __html: email.html_body }} />
          : <pre className="whitespace-pre-wrap font-sans">{email.body ?? ''}</pre>
        }
      </div>
    </div>
  );
}

function FolderEmailDetail({ email, connectionId, folderSections, onMoved }: { email: MessageDetail; connectionId: string; folderSections: ConnectionFolders[]; onMoved: () => void }) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const dateStr = email.date
    ? new Date(email.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const conn = folderSections.find(c => c.connectionId === connectionId);
  const allFolders = conn?.folders ?? [];

  const handleMove = async (folderId: string) => {
    setIsMoving(true);
    setShowMoveMenu(false);
    try {
      await fetch('/api/inbox/folder-email-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, messageId: email.id, folderId }),
      });
      onMoved();
    } catch { /* non-fatal */ } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b border-neutral-100">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2 flex-1 min-w-0">{email.subject}</h2>
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowMoveMenu(v => !v)}
              disabled={isMoving}
              title="Move to folder"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
            >
              {isMoving
                ? <div className="w-4 h-4 border-2 border-neutral-300 border-t-indigo-500 rounded-full animate-spin" />
                : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25m19.5 0A2.25 2.25 0 0 1 19.5 16.5H6.75A2.25 2.25 0 0 1 4.5 14.25V6" /></svg>
              }
            </button>
            {showMoveMenu && allFolders.length > 0 && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-neutral-100 py-1 z-20 max-h-56 overflow-y-auto">
                {allFolders.map(f => (
                  <button key={f.id} onClick={() => handleMove(f.id)} className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 transition-colors truncate">
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="space-y-0.5 text-[12px] text-neutral-500">
          <div><span className="font-medium text-neutral-700">From:</span> {email.fromName || email.from}{email.fromName ? ` <${email.from}>` : ''}</div>
          {email.to && <div><span className="font-medium text-neutral-700">To:</span> {email.to}</div>}
          {dateStr && <div><span className="font-medium text-neutral-700">Date:</span> {dateStr}</div>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 text-[13px] text-neutral-800 leading-relaxed">
        {email.htmlBody
          ? <div dangerouslySetInnerHTML={{ __html: email.htmlBody }} />
          : <pre className="whitespace-pre-wrap font-sans">{email.body ?? ''}</pre>
        }
      </div>
    </div>
  );
}

interface InboxPageClientProps {
  initialUser: any;
  initialUserFullName?: string;
  initialHasConnection: boolean;
  initialInboxItems: any[];
  initialFolderSections?: ConnectionFolders[];
}

export function InboxPageClient({
  initialUser,
  initialUserFullName,
  initialHasConnection,
  initialInboxItems,
  initialFolderSections,
}: InboxPageClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [user] = useState(initialUser);
  const [hasConnection, setHasConnection] = useState(initialHasConnection);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialInboxItems);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('chronological');
  const [density, setDensity] = useState<Density>('normal');
  const [folderSidebarCollapsed, setFolderSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('inbox_folder_sidebar_collapsed') === 'true';
  });
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderSections, setFolderSections] = useState<ConnectionFolders[] | null>(initialFolderSections ?? null);
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder | null>(null);
  const [folderEmails, setFolderEmails] = useState<FolderEmailSummary[]>([]);
  const [folderEmailsLoading, setFolderEmailsLoading] = useState(false);
  const [selectedFolderEmailId, setSelectedFolderEmailId] = useState<string | null>(null);
  const [selectedFolderEmail, setSelectedFolderEmail] = useState<MessageDetail | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    initialFolderSections?.[0]?.connectionId ?? null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteConfirmPending, setBulkDeleteConfirmPending] = useState(false);
  const [bulkArchiveConfirmPending, setBulkArchiveConfirmPending] = useState(false);


  // Search state (client-side filter on left list)
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
    else setSearchQuery('');
  }, [showSearch]);

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
  const periodicSyncRef = useRef<number>(0);

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
  };

  useEffect(() => {
    localStorage.setItem('inboxDensity', density);
  }, [density]);

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

  // Folder management
  const fetchFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      const res = await fetch('/api/inbox/folders');
      if (!res.ok) return;
      const data = await res.json();
      // Enrich each connection with its email address from metadata
      const enriched: ConnectionFolders[] = (data.connections ?? []).map((c: any) => ({
        connectionId: c.connectionId,
        provider: c.provider,
        email: c.email ?? '',
        picture: c.picture ?? null,
        folders: c.folders ?? [],
      }));
      setFolderSections(enriched);
    } catch { /* non-fatal */ } finally {
      setFoldersLoading(false);
    }
  }, []);

  // Only fetch client-side if SSR didn't provide initial data (e.g. no-JS fallback)
  useEffect(() => { if (!initialFolderSections) fetchFolders(); }, [fetchFolders, initialFolderSections]);

  // Set default selected connection when folderSections first populates (client-fetch fallback path)
  useEffect(() => {
    if (!selectedConnectionId && folderSections?.length) {
      setSelectedConnectionId(folderSections[0].connectionId);
    }
  }, [folderSections]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectConnection = useCallback((id: string) => {
    setSelectedConnectionId(id);
    if (selectedFolder && selectedFolder.connectionId !== id) {
      setSelectedFolder(null);
    }
  }, [selectedFolder]);

  const handleSelectFolder = useCallback(async (folder: SelectedFolder | null) => {
    setSelectedFolder(folder);
    setSelectedFolderEmailId(null);
    setSelectedFolderEmail(null);
    if (!folder) return;
    setFolderEmailsLoading(true);
    try {
      const res = await fetch(`/api/inbox/folder-emails?connectionId=${folder.connectionId}&folderId=${encodeURIComponent(folder.folderId)}`);
      const data = await res.json();
      setFolderEmails(data.emails ?? []);
    } catch { setFolderEmails([]); } finally {
      setFolderEmailsLoading(false);
    }
  }, []);

  const handleSelectFolderEmail = useCallback(async (email: FolderEmailSummary) => {
    if (!selectedFolder) return;
    setSelectedFolderEmailId(email.id);
    setSelectedFolderEmail(null);
    try {
      const res = await fetch(`/api/inbox/folder-email-detail?connectionId=${selectedFolder.connectionId}&messageId=${encodeURIComponent(email.id)}`);
      if (res.ok) setSelectedFolderEmail(await res.json());
    } catch { /* non-fatal */ }
  }, [selectedFolder]);

  const handleCreateFolder = useCallback(async (connectionId: string, name: string) => {
    await fetch('/api/inbox/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, name }),
    });
    fetchFolders();
  }, [fetchFolders]);

  // Deep-link: ?item=<uuid> auto-selects a specific inbox item (e.g. from desk card)
  useEffect(() => {
    const itemId = searchParams?.get('item');
    if (!itemId || inboxItems.length === 0) return;
    if (deepLinkFiredRef.current === itemId) return; // already handled this specific item
    const target = inboxItems.find((i) => i.id === itemId);
    if (target) {
      deepLinkFiredRef.current = itemId;
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
      if (optimisticSyncTriggered.current) return;
      setIsSyncing(true);
      optimisticSyncTriggered.current = true;
      periodicSyncRef.current = Date.now();
      window.history.replaceState({}, '', '/inbox');
      fetch('/api/connections/sync', { method: 'POST' }).catch(() => {
        setIsSyncing(false);
        optimisticSyncTriggered.current = false;
      });
    }
  }, [searchParams, hasConnection]);

  // Realtime subscription — new items appear instantly without polling.
  // Auto-reconnects on WebSocket drop (CHANNEL_ERROR / TIMED_OUT / CLOSED).
  useEffect(() => {
    const supabase = createClient();
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function subscribe() {
      if (destroyed) return;
      currentChannel = supabase
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
        .subscribe((status) => {
          if (destroyed) return;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            const staleChannel = currentChannel;
            currentChannel = null;
            reconnectTimer = setTimeout(() => {
              if (staleChannel) supabase.removeChannel(staleChannel);
              subscribe();
            }, 3000);
          }
        });
    }

    subscribe();
    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (currentChannel) supabase.removeChannel(currentChannel);
    };
  }, [user.id]);

  // Poll for sync status only (inbox items arrive via Realtime above)
  useEffect(() => {
    const supabase = createClient();

    async function fetchData() {
      let connPollQuery = supabase
        .from('connections')
        .select('sync_status, sync_started_at, provider')
        .eq('user_id', user.id)
        .in('provider', ['gmail', 'outlook'])
        .eq('status', 'active');
      const { data: connections, error: connectionsError } = await connPollQuery;

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

        // Periodic catch-up sync — every 2 minutes regardless of provider mix.
        // Catches missed push notifications (Outlook) and Realtime WebSocket drops (Gmail).
        // Works the same whether the user has Gmail-only, Outlook-only, or both.
        if (connections && connections.length > 0 && !isCurrentlySyncing && Date.now() - periodicSyncRef.current > 2 * 60 * 1000) {
          periodicSyncRef.current = Date.now();
          fetch('/api/connections/sync', { method: 'POST' }).catch(() => {});
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
    // Filter by selected account (items with null connection_id are shown for any account)
    if (selectedConnectionId) {
      items = items.filter(i => {
        const cid = (i as any).connection_id;
        return cid === null || cid === selectedConnectionId;
      });
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
  }, [inboxItems, searchQuery, viewMode, selectedConnectionId]);

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
    await fetch(`/api/inbox/${itemId}/delete-source`, { method: 'POST' });
  }, []);

  const handleArchiveItem = useCallback(async (itemId: string) => {
    setInboxItems(prev => prev.filter(i => i.id !== itemId));
    setSelectedItem(prev => (prev?.id === itemId ? null : prev));
    await fetch(`/api/inbox/${itemId}/archive-source`, { method: 'POST' });
  }, []);

  const handleDropToFolder = useCallback(async (folder: SelectedFolder, itemIds: string[]) => {
    const name = folder.folderName.toLowerCase();
    // Optimistically remove from inbox list and clear selection
    setInboxItems(prev => prev.filter(i => !itemIds.includes(i.id)));
    setSelectedItem(prev => (prev && itemIds.includes(prev.id) ? null : prev));
    setSelectedIds(new Set());
    const n = itemIds.length;
    const label = n === 1 ? '1 email' : `${n} emails`;
    if (name.includes('trash') || name.includes('deleted')) {
      toast.success(`${label} moved to Trash`);
      await Promise.all(itemIds.map(id => fetch(`/api/inbox/${id}/delete-source`, { method: 'POST' })));
    } else if (name.includes('archive') || name === 'all mail') {
      toast.success(`${label} archived`);
      await Promise.all(itemIds.map(id => fetch(`/api/inbox/${id}/archive-source`, { method: 'POST' })));
    } else {
      toast.success(`${label} moved to ${folder.folderName}`);
      await Promise.all(itemIds.map(id =>
        fetch(`/api/inbox/${id}/move-to-folder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: folder.folderId, folderName: folder.folderName }),
        })
      ));
    }
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
    setComposeDraft(prev => ({ ...prev, ...draft, ...(draft.body != null ? { body: markdownToHtml(draft.body) } : {}) }));
    setComposeMode(true);
    setRightPanel('chat');
  }, []);

  const handleUseAsReply = useCallback((body: string, cc?: string, bcc?: string) => {
    setPendingReplyDraft({ body: markdownToHtml(body), cc, bcc });
  }, []);

  const handleReplyOpenChange = useCallback((open: boolean) => {
    setReplyIsOpen(open);
    if (open) setRightPanel('chat');
    else setPendingReplyDraft(null); // clear so "Use as reply" can re-trigger after discard
  }, []);

  const handleUpdateReplyDraft = useCallback((body: string) => {
    setReplyBody(markdownToHtml(body));
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
            setPendingReplyDraft({ body: markdownToHtml(parsed.body), cc: parsed.cc, bcc: parsed.bcc });
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
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* No connection */}
        {!hasConnection && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs">
              <div className="w-12 h-12 mx-auto mb-5 bg-primary-50 rounded-2xl flex items-center justify-center">
                <EnvelopeIcon className="w-6 h-6 text-primary-500" />
              </div>
              <h3 className="text-[16px] font-semibold text-neutral-900 mb-1.5">Connect your email</h3>
              <p className="text-[13px] text-neutral-400 mb-6 leading-relaxed">
                Connect Gmail or Outlook and give your AI the busywork
              </p>
              <Link
                href="/settings"
                className="inline-flex items-center px-5 py-2 bg-primary-500 text-white text-[13px] font-medium rounded-xl hover:bg-primary-600 transition-colors"
              >
                Go to Settings
              </Link>
            </div>
          </div>
        )}

        {hasConnection && (
          <div className="flex-1 min-h-0 relative overflow-hidden">

            {/* Folder sidebar + email list + detail + right panel */}
            <div className="absolute inset-0 flex min-h-0 overflow-hidden">

            {/* Folder sidebar */}
            {folderSections && folderSections.length > 0 && (
              <FolderSidebar
                connections={folderSections}
                selectedFolder={selectedFolder}
                onSelectFolder={handleSelectFolder}
                onCreateFolder={handleCreateFolder}
                loading={foldersLoading}
                collapsed={folderSidebarCollapsed}
                onToggleCollapsed={() => {
                  const next = !folderSidebarCollapsed;
                  setFolderSidebarCollapsed(next);
                  localStorage.setItem('inbox_folder_sidebar_collapsed', String(next));
                }}
                onCompose={() => { setComposeMode(true); setRightPanel('chat'); setTimeout(() => chatInputRef.current?.focus(), 50); }}
                onDropToFolder={handleDropToFolder}
                selectedConnectionId={selectedConnectionId ?? ''}
                onSelectConnection={handleSelectConnection}
              />
            )}

            {/* Left: email list */}
            <div className="w-[240px] flex-shrink-0 flex flex-col bg-neutral-50 p-2">
              <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">

              {/* View + density toggles / search — animated crossfade */}
              <div className="flex-shrink-0 relative h-10 border-b border-neutral-100 overflow-hidden">

                {/* Toolbar layer — slides up + fades out when search opens */}
                <div className={`absolute inset-0 flex items-center pl-2.5 pr-1 transition-all duration-200 ease-in-out ${showSearch ? 'opacity-0 -translate-y-2 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
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

                  {/* Density toggle + folder + action icons */}
                  <div className="flex items-center ml-auto">
                    <button
                      onClick={() => handleDensity(density === 'compact' ? 'normal' : 'compact')}
                      title={density === 'compact' ? 'Normal view' : 'Compact view'}
                      className="p-1 transition-colors text-neutral-300 hover:text-neutral-400"
                    >
                      {density === 'compact' ? <QueueListIcon className="w-3.5 h-3.5" /> : <Bars3Icon className="w-3.5 h-3.5" />}
                    </button>
                    <div className="w-px h-3.5 bg-neutral-200 mx-1" />
                    <button
                      onClick={() => { if (isSyncing) return; preSyncCountRef.current = inboxItems.length; setIsSyncing(true); fetch('/api/connections/sync', { method: 'POST' }).catch(() => setIsSyncing(false)); }}
                      disabled={isSyncing}
                      title={isSyncing ? 'Syncing…' : 'Sync inbox'}
                      className="p-1 transition-colors text-neutral-400 hover:text-neutral-600 disabled:opacity-50"
                    >
                      <ArrowPathIcon className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => setShowSearch(true)}
                      title="Search inbox"
                      className="p-1 transition-colors text-neutral-400 hover:text-neutral-600"
                    >
                      <MagnifyingGlassIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Search layer — slides up from below + fades in when search opens */}
                <div className={`absolute inset-0 flex items-center pl-2.5 pr-1 transition-all duration-200 ease-in-out ${showSearch ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
                  <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setShowSearch(false);
                    }}
                    placeholder="Search inbox..."
                    className="flex-1 mx-2 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0"
                  />
                  <button
                    onClick={() => setShowSearch(false)}
                    className="flex-shrink-0 p-0.5 text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </div>

              </div>

              {/* Sync bar */}
              {isSyncing && (
                <div className="flex-shrink-0 flex items-center justify-center gap-1.5 py-1.5 bg-neutral-50 border-b border-neutral-100">
                  <ArrowPathIcon className="w-3 h-3 text-neutral-400 animate-spin flex-shrink-0" />
                  <span className="text-[11.5px] text-neutral-400">
                    {(() => {
                      const delta = preSyncCountRef.current !== null
                        ? inboxItems.length - preSyncCountRef.current
                        : 0;
                      return delta > 0
                        ? `${delta} new item${delta !== 1 ? 's' : ''}`
                        : 'Syncing…';
                    })()}
                  </span>
                </div>
              )}

              {/* Bulk action bar */}
              {!selectedFolder && selectedIds.size > 0 && (
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
                      <button onClick={() => { setBulkArchiveConfirmPending(false); handleBulkArchive(); }} className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
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
                      <button onClick={() => { setBulkDeleteConfirmPending(false); handleBulkDelete(); }} className="px-2.5 py-1 text-[11px] font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
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
              <div key={density} className="flex-1 overflow-y-auto animate-[fadeIn_120ms_ease-out]">
                {selectedFolder ? (
                  <FolderEmailList
                    folderName={selectedFolder.folderName}
                    emails={folderEmails}
                    loading={folderEmailsLoading}
                    selectedId={selectedFolderEmailId}
                    onSelect={handleSelectFolderEmail}
                    density={density}
                  />
                ) : inboxItems.length === 0 && !isSyncing ? (
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

            {/* Middle: detail/compose */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col bg-neutral-50 pl-2 pt-2 pb-2">
              <div className="relative flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">

              <div className="flex-1 min-h-0 overflow-hidden">
                  {composeMode ? (
                    <ComposePanel
                      draft={composeDraft}
                      onChange={(fields) => setComposeDraft(prev => ({ ...prev, ...fields }))}
                      onDiscard={closeChat}
                      onSent={closeChat}
                      connectionId={(selectedItem as any)?.connection_id ?? undefined}
                    />
                  ) : selectedFolderEmail ? (
                    <FolderEmailDetail email={selectedFolderEmail} connectionId={selectedFolder?.connectionId ?? ''} folderSections={folderSections ?? []} onMoved={() => { handleSelectFolder(selectedFolder); }} />
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
                      folderSections={folderSections ?? undefined}
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
                  <CalendarDaysIcon className="w-4 h-4" />
                </button>
                <button onClick={() => { setComposeMode(false); openChat(); }} title="Ask AI" className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors">
                  <ChatBubbleLeftIcon className="w-4 h-4" />
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
                      ? (fields) => setComposeDraft(prev => ({ ...prev, ...fields, ...(fields.body != null ? { body: markdownToHtml(fields.body) } : {}) }))
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
  );
}
