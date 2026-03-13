'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SidebarNav from '@/components/sidebar-nav';
import EmailListSections from '@/components/inbox/email-list-sections';
import EmailListChronological from '@/components/inbox/email-list-chronological';
import WorkDetailInline from '@/components/inbox/work-detail-inline';
import InboxChatView from '@/components/inbox/inbox-chat-view';
import MeetingsColumn from '@/components/inbox/meetings-column';
import OnboardingModal from '@/components/onboarding-modal';
import { ArrowPathIcon, SparklesIcon, ClockIcon, Bars3Icon, QueueListIcon, ArchiveBoxArrowDownIcon, XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/lib/types/meetings';
import type { InboxItem } from '@/lib/types/inbox';

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
  const [user] = useState(initialUser);
  const [hasConnection, setHasConnection] = useState(initialHasConnection);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialInboxItems);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(true);
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('chronological');
  const [density, setDensity] = useState<Density>('normal');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);
  const [isBulkDismissing, setIsBulkDismissing] = useState(false);
  const [bulkArchiveConfirmPending, setBulkArchiveConfirmPending] = useState(false);

  // Search state (client-side filter on left list)
  const [searchQuery, setSearchQuery] = useState('');

  // Chat / Ask state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const optimisticSyncTriggered = useRef(false);
  const isSyncingRef = useRef(false);

  // Restore persisted preferences after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const savedView = localStorage.getItem('inboxViewMode') as ViewMode | null;
    if (savedView === 'smart' || savedView === 'chronological') setViewMode(savedView);
    const savedDensity = localStorage.getItem('inboxDensity') as Density | null;
    if (savedDensity === 'normal' || savedDensity === 'compact') setDensity(savedDensity);
  }, []);

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
    return () => clearInterval(interval);
  }, [fetchMeetings]);

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

  // Poll for inbox items and sync status
  useEffect(() => {
    const supabase = createClient();

    async function fetchData() {
      const { data: items, error: itemsError } = await supabase
        .from('inbox_items')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (itemsError) {
        if (itemsError.message?.includes('JWT') || itemsError.code === 'PGRST301') {
          window.location.href = '/login?session=expired';
          return;
        }
      }

      if (items) {
        setInboxItems(items);
        setSelectedItem(prev => prev ? (items.find(i => i.id === prev.id) ?? prev) : null);
      }

      const { data: connections, error: connectionsError } = await supabase
        .from('connections')
        .select('sync_status, provider')
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
        const isCurrentlySyncing = connections.some(conn => conn.sync_status === 'syncing');
        const allCompleted = connections.every(conn =>
          conn.sync_status === 'completed' || conn.sync_status === 'failed'
        );

        if (optimisticSyncTriggered.current) {
          if (isCurrentlySyncing || allCompleted) {
            optimisticSyncTriggered.current = false;
            isSyncingRef.current = isCurrentlySyncing;
            setIsSyncing(isCurrentlySyncing);
          }
        } else {
          if (isSyncingRef.current !== isCurrentlySyncing) {
            isSyncingRef.current = isCurrentlySyncing;
            setIsSyncing(isCurrentlySyncing);
          }
        }

        if (isSyncingRef.current && !isCurrentlySyncing) {
          setInboxItems(items || []);
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

  const preparedItems = inboxItems.filter((item: any) => item.visual_section === 'prepared');
  const meetingAssistantItems = inboxItems.filter((item: any) => item.source === 'meeting');

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inboxItems;
    return inboxItems.filter(item => {
      const sd = (item as any).source_data;
      return (
        (sd?.from_name || '').toLowerCase().includes(q) ||
        (sd?.from || '').toLowerCase().includes(q) ||
        (sd?.subject || '').toLowerCase().includes(q) ||
        (sd?.snippet || '').toLowerCase().includes(q)
      );
    });
  }, [inboxItems, searchQuery]);

  const handleItemConfirmed = (ids: string[], action: 'confirm_as_mine' | 'not_my_task') => {
    setInboxItems(prev => {
      if (action === 'confirm_as_mine') {
        return prev.map(i => ids.includes(i.id) ? { ...i, visual_section: 'prepared' } : i);
      } else {
        return prev.filter(i => !ids.includes(i.id));
      }
    });
    setSelectedItem(prev => {
      if (!prev) return null;
      if (ids.includes(prev.id)) return null;
      const batchItems: InboxItem[] = (prev as any).__batchItems;
      if (batchItems && batchItems.every(b => ids.includes(b.id))) return null;
      return prev;
    });
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearSelection = () => { setSelectedIds(new Set()); setBulkArchiveConfirmPending(false); };

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

  const handleBulkDismiss = async () => {
    const ids = Array.from(selectedIds);
    setIsBulkDismissing(true);
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/inbox/${id}/dismiss`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'not_relevant' }),
        })
      ));
      setInboxItems(prev => prev.filter(i => !ids.includes(i.id)));
      setSelectedItem(prev => (prev && ids.includes(prev.id) ? null : prev));
      clearSelection();
      toast.success(`${ids.length} item${ids.length > 1 ? 's' : ''} dismissed`);
    } catch {
      toast.error('Could not dismiss items');
    } finally {
      setIsBulkDismissing(false);
    }
  };

  const handleSelectItem = (item: InboxItem) => {
    setSelectedItem(item);
    if (isChatOpen) closeChat();
  };

  const handleChatAction = useCallback(async (type: string, itemId: string) => {
    if (type === 'archive') {
      const res = await fetch(`/api/inbox/${itemId}/archive-source`, { method: 'POST' });
      if (!res.ok) throw new Error('Archive failed');
      setInboxItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedItem(prev => (prev?.id === itemId ? null : prev));
    } else if (type === 'open') {
      const item = inboxItems.find(i => i.id === itemId);
      if (item) handleSelectItem(item);
    } else if (type === 'workflow') {
      const item = inboxItems.find(i => i.id === itemId);
      if (item) handleSelectItem(item);
    }
  }, [inboxItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const openChat = () => {
    setIsChatOpen(true);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  };

  const closeChat = () => {
    setIsChatOpen(false);
    setChatInput('');
    setChatHistory([]);
  };

  const sendChatMessage = useCallback(async (message: string) => {
    if (!message.trim() || chatStreaming) return;
    const userMessage = message.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatStreaming(true);
    setStreamingContent('');

    try {
      const res = await fetch('/api/inbox/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: chatHistory,
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
    } catch {
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setChatStreaming(false);
      setStreamingContent('');
    }
  }, [chatHistory, chatStreaming]);

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <SidebarNav userEmail={user?.email} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Syncing banner */}
        {isSyncing && (
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
            <ArrowPathIcon className="w-4 h-4 text-indigo-600 animate-spin flex-shrink-0" />
            <p className="text-[13px] text-indigo-800 font-medium">
              Syncing your emails... This usually takes 30–60 seconds.
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

        {/* 3-column layout */}
        {hasConnection && (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left: email list */}
            <div className="w-[272px] flex-shrink-0 border-r border-neutral-200 flex flex-col bg-white">

              {/* View + density toggles */}
              <div className="flex-shrink-0 h-10 flex items-center justify-between px-2 border-b border-neutral-100">
                {/* View mode */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleViewMode('chronological')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      viewMode === 'chronological'
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-400 hover:text-neutral-700'
                    }`}
                  >
                    <ClockIcon className="w-3 h-3" />
                    Latest
                  </button>
                  <button
                    onClick={() => handleViewMode('smart')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      viewMode === 'smart'
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-400 hover:text-neutral-700'
                    }`}
                  >
                    <SparklesIcon className="w-3 h-3" />
                    Smart
                  </button>
                </div>

                {/* Density toggle */}
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleDensity('normal')}
                    title="Normal"
                    className={`p-1 rounded transition-colors ${
                      density === 'normal'
                        ? 'text-indigo-600'
                        : 'text-neutral-300 hover:text-neutral-500'
                    }`}
                  >
                    <QueueListIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDensity('compact')}
                    title="Compact"
                    className={`p-1 rounded transition-colors ${
                      density === 'compact'
                        ? 'text-indigo-600'
                        : 'text-neutral-300 hover:text-neutral-500'
                    }`}
                  >
                    <Bars3Icon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Bulk action bar */}
              {selectedIds.size > 0 && (
                <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-indigo-100 bg-indigo-50 min-h-[36px]">
                  {isBulkArchiving ? (
                    /* Loading state — full row */
                    <div className="flex items-center gap-2 flex-1">
                      <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-indigo-700">
                        Archiving {selectedIds.size} email{selectedIds.size > 1 ? 's' : ''}…
                      </span>
                    </div>
                  ) : bulkArchiveConfirmPending ? (
                    /* Confirm state — full row */
                    <>
                      <ArchiveBoxArrowDownIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-indigo-800 flex-1">
                        Archive {selectedIds.size} email{selectedIds.size > 1 ? 's' : ''}?
                      </span>
                      <button
                        onClick={() => { setBulkArchiveConfirmPending(false); handleBulkArchive(); }}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex-shrink-0"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setBulkArchiveConfirmPending(false)}
                        className="p-1 text-indigo-400 hover:text-indigo-700 transition-colors flex-shrink-0"
                        title="Cancel"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    /* Normal state */
                    <>
                      <span className="text-[11px] font-semibold text-indigo-700 flex-1">
                        {selectedIds.size} selected
                      </span>
                      <button
                        onClick={() => setBulkArchiveConfirmPending(true)}
                        disabled={isBulkDismissing}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                      >
                        <ArchiveBoxArrowDownIcon className="w-3 h-3" />
                        Archive
                      </button>
                      <button
                        onClick={handleBulkDismiss}
                        disabled={isBulkDismissing}
                        className="px-2 py-1 text-[11px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                      >
                        {isBulkDismissing ? (
                          <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        ) : 'Dismiss'}
                      </button>
                      <button
                        onClick={clearSelection}
                        className="p-1 text-indigo-300 hover:text-indigo-600 transition-colors"
                        title="Clear selection"
                      >
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
                  />
                ) : (
                  <EmailListSections
                    items={filteredItems}
                    selectedId={selectedItem?.id || null}
                    onSelect={handleSelectItem}
                    compact={density === 'compact'}
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                  />
                )}
              </div>
            </div>

            {/* Middle: search header + detail/chat */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col border-r border-neutral-200">
              {/* Middle header — search + ask */}
              <div className="flex-shrink-0 h-10 flex items-center gap-1 px-3 border-b border-neutral-200 bg-white">
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

                {/* Ask AI toggle */}
                <button
                  onClick={() => isChatOpen ? closeChat() : openChat()}
                  title="Ask AI"
                  className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold transition-colors ${
                    isChatOpen
                      ? 'bg-indigo-600 text-white'
                      : 'text-neutral-400 hover:text-neutral-700'
                  }`}
                >
                  <SparklesIcon className="w-3 h-3" />
                  Ask
                </button>
              </div>

              {isChatOpen ? (
                <InboxChatView
                  history={chatHistory}
                  streamingContent={streamingContent}
                  isStreaming={chatStreaming}
                  inboxItems={inboxItems}
                  onSelectItem={item => { setSelectedItem(item); closeChat(); }}
                  onSendMessage={sendChatMessage}
                  onAction={handleChatAction}
                  chatInput={chatInput}
                  onChatInputChange={setChatInput}
                  chatInputRef={chatInputRef}
                />
              ) : (
                <div className="flex-1 min-h-0">
                  <WorkDetailInline key={selectedItem?.id ?? 'empty'} item={selectedItem} onItemConfirmed={handleItemConfirmed} onRefreshMeetings={fetchMeetings} />
                </div>
              )}
            </div>

            {/* Right: calendar column */}
            <MeetingsColumn
              isOpen={isCalendarOpen}
              onToggle={() => setIsCalendarOpen(o => !o)}
              meetings={meetings}
              loading={meetingsLoading}
              userEmail={user?.email || ''}
              onRefresh={fetchMeetings}
            />
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
