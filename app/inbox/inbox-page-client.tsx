'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SidebarNav from '@/components/sidebar-nav';
import InboxTopBar from '@/components/inbox/inbox-top-bar';
import EmailListSections from '@/components/inbox/email-list-sections';
import WorkDetailInline from '@/components/inbox/work-detail-inline';
import MeetingsColumn from '@/components/inbox/meetings-column';
import OnboardingModal from '@/components/onboarding-modal';
import { ArrowPathIcon, SparklesIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import type { InboxItem } from '@/lib/types/inbox';

interface InboxPageClientProps {
  initialUser: any;
  initialUserFullName?: string;
  initialConnection: any | null;
  initialInboxItems: any[];
  hasCompletedIdentity: boolean;
}

export function InboxPageClient({
  initialUser,
  initialUserFullName,
  initialConnection,
  initialInboxItems,
  hasCompletedIdentity,
}: InboxPageClientProps) {
  const searchParams = useSearchParams();
  const [user] = useState(initialUser);
  const [connection, setConnection] = useState(initialConnection);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialInboxItems);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(true);
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);

  const optimisticSyncTriggered = useRef(false);
  const isSyncingRef = useRef(false);

  // Show onboarding if user hasn't completed identity profile
  useEffect(() => {
    setIsOnboardingOpen(!hasCompletedIdentity);
  }, [hasCompletedIdentity]);

  // Sync connection state
  useEffect(() => {
    setConnection(initialConnection);
  }, [initialConnection]);

  // Fetch meetings (shared between top bar and calendar column)
  useEffect(() => {
    const fetchMeetings = async () => {
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
    };
    fetchMeetings();
    const interval = setInterval(fetchMeetings, 60000);
    return () => clearInterval(interval);
  }, []);

  // Trigger initial sync after connecting
  useEffect(() => {
    const successParam = searchParams?.get('success');
    const justConnected = successParam === 'outlook_connected' || successParam === 'gmail_connected';

    if (justConnected && connection) {
      setIsSyncing(true);
      optimisticSyncTriggered.current = true;
      window.history.replaceState({}, '', '/inbox');
      fetch('/api/connections/sync', { method: 'POST' }).catch(() => {
        setIsSyncing(false);
        optimisticSyncTriggered.current = false;
      });
    }
  }, [searchParams, connection]);

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

      if (items) setInboxItems(items);

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
  }, [user.id, connection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived data for top bar
  const todayMeetings = meetings.filter(m =>
    new Date(m.start_time).toDateString() === new Date().toDateString()
  );
  const preparedItems = inboxItems.filter((item: any) => item.visual_section === 'prepared');

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <SidebarNav userEmail={user?.email} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar — priorities + today's meetings */}
        {connection && (
          <InboxTopBar
            preparedItems={preparedItems}
            todayMeetings={todayMeetings}
            onSelectItem={setSelectedItem}
          />
        )}

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
        {!connection && (
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
        {connection && (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left: email list */}
            <div className="w-[272px] flex-shrink-0 border-r border-neutral-200 overflow-y-auto bg-white">
              {inboxItems.length === 0 && !isSyncing ? (
                <div className="flex flex-col items-center justify-center h-full py-16 px-4 text-center">
                  <p className="text-[13px] text-neutral-500 font-medium mb-1">All caught up!</p>
                  <p className="text-[12px] text-neutral-400">
                    New items will appear here after the next sync.
                  </p>
                </div>
              ) : (
                <EmailListSections
                  items={inboxItems}
                  selectedId={selectedItem?.id || null}
                  onSelect={setSelectedItem}
                />
              )}
            </div>

            {/* Middle: inline detail panel */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
              <WorkDetailInline key={selectedItem?.id ?? 'empty'} item={selectedItem} />
            </div>

            {/* Right: calendar column */}
            <MeetingsColumn
              isOpen={isCalendarOpen}
              onToggle={() => setIsCalendarOpen(o => !o)}
              meetings={meetings}
              loading={meetingsLoading}
              userEmail={user?.email || ''}
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
