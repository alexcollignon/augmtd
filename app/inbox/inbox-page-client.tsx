'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SidebarNav from '@/components/sidebar-nav';
import WorkSections from '@/components/inbox/work-sections';
import OnboardingModal from '@/components/onboarding-modal';
import MeetingsSidebar from '@/components/meetings/meetings-sidebar';
import {
  CheckCircleIcon,
  SparklesIcon,
  ArrowPathIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';

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
  hasCompletedIdentity
}: InboxPageClientProps) {
  const searchParams = useSearchParams();
  const [user] = useState(initialUser);
  const [connection, setConnection] = useState(initialConnection);
  const [inboxItems, setInboxItems] = useState(initialInboxItems);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // Track when we've optimistically started a sync
  const optimisticSyncTriggered = useRef(false);
  // Ref so fetchData can read current isSyncing without being in the effect deps
  const isSyncingRef = useRef(false);

  // Set onboarding modal state on client-side only (prevents hydration mismatch)
  // Show onboarding if user hasn't completed their identity profile
  useEffect(() => {
    setIsOnboardingOpen(!hasCompletedIdentity);
  }, [hasCompletedIdentity]);

  // Sync connection state when initial prop changes (e.g., switching providers)
  useEffect(() => {
    setConnection(initialConnection);
  }, [initialConnection]);

  // Check if we just connected and trigger initial sync
  useEffect(() => {
    const successParam = searchParams?.get('success');
    const justConnected = successParam === 'outlook_connected' || successParam === 'gmail_connected';

    console.log('[Inbox] Connection check:', {
      successParam,
      justConnected,
      hasConnection: !!connection,
      provider: connection?.provider
    });

    if (justConnected && connection) {
      console.log('[Inbox] Triggering optimistic sync for', connection.provider);

      // Show loading state immediately (optimistic UI)
      setIsSyncing(true);
      optimisticSyncTriggered.current = true;

      // Clean URL after reading the success param
      window.history.replaceState({}, '', '/inbox');

      // Trigger initial sync automatically
      fetch('/api/connections/sync', {
        method: 'POST',
      }).then(() => {
        console.log('[Inbox] Sync API called successfully');
      }).catch(err => {
        console.error('Failed to trigger initial sync:', err);
        // Stop showing loading if sync failed to start
        setIsSyncing(false);
        optimisticSyncTriggered.current = false;
      });
    }
  }, [searchParams, connection]);


  // Poll for new items and check sync status
  useEffect(() => {
    const supabase = createClient();

    async function fetchData() {
      // Fetch inbox items
      const { data: items, error: itemsError } = await supabase
        .from('inbox_items')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      // Check for auth errors
      if (itemsError) {
        console.error('[Inbox] Error fetching items:', itemsError);
        // If it's an auth error, redirect to login
        if (itemsError.message?.includes('JWT') || itemsError.code === 'PGRST301') {
          console.log('[Session] Auth error detected, redirecting to login');
          window.location.href = '/login?session=expired';
          return;
        }
      }

      if (items) {
        setInboxItems(items);
      }

      // Check ALL connections sync status (Gmail + Outlook)
      const { data: connections, error: connectionsError } = await supabase
        .from('connections')
        .select('sync_status, provider')
        .eq('user_id', user.id)
        .in('provider', ['gmail', 'outlook'])
        .eq('status', 'active');

      // Check for auth errors
      if (connectionsError) {
        console.error('[Inbox] Error fetching connections:', connectionsError);
        if (connectionsError.message?.includes('JWT') || connectionsError.code === 'PGRST301') {
          console.log('[Session] Auth error detected, redirecting to login');
          window.location.href = '/login?session=expired';
          return;
        }
      }

      if (connections && connections.length > 0) {
        // Check if ANY connection is currently syncing
        const isCurrentlySyncing = connections.some(conn => conn.sync_status === 'syncing');
        const allCompleted = connections.every(conn =>
          conn.sync_status === 'completed' || conn.sync_status === 'failed'
        );

        // If we optimistically triggered a sync, only update state when we see actual progress
        if (optimisticSyncTriggered.current) {
          // Sync has actually started or completed - clear optimistic flag
          if (isCurrentlySyncing || allCompleted) {
            optimisticSyncTriggered.current = false;
            isSyncingRef.current = isCurrentlySyncing;
            setIsSyncing(isCurrentlySyncing);
          }
          // Otherwise, keep showing optimistic loading state (ignore 'pending')
        } else {
          // Normal polling - update state based on database
          if (isSyncingRef.current !== isCurrentlySyncing) {
            isSyncingRef.current = isCurrentlySyncing;
            setIsSyncing(isCurrentlySyncing);
          }
        }

        // If was syncing and now completed, refresh to show new items
        if (isSyncingRef.current && !isCurrentlySyncing) {
          setInboxItems(items || []);
        }
      }
    }

    // Use a self-rescheduling approach so interval adapts to sync state
    // without putting isSyncing in the dependency array
    let timeoutId: ReturnType<typeof setTimeout>;

    function scheduleNext() {
      const delay = isSyncingRef.current ? 2000 : 10000;
      timeoutId = setTimeout(async () => {
        await fetchData();
        scheduleNext();
      }, delay);
    }

    // Fetch immediately on mount, then start adaptive scheduling
    fetchData().then(scheduleNext);

    return () => clearTimeout(timeoutId);
  }, [user.id, connection]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <div className="flex h-screen bg-gradient-to-br from-neutral-50 to-white">
      {/* Sidebar */}
      <SidebarNav userEmail={user?.email} />

      {/* Main Content - Two Column Layout */}
      <main className="flex-1 overflow-y-auto flex relative">
        {/* Center Column - Email Work */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
          {/* Page Header */}
          <div className="mb-10 flex items-start justify-between">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-2">
                Prepared Work
              </h1>
              <p className="text-[15px] text-neutral-600">
                Prepared work items that need your attention right now.
              </p>
            </div>

            {/* Calendar Toggle Button */}
            {connection && (
              <button
                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-neutral-200 hover:border-neutral-300 text-neutral-700 hover:text-neutral-900 transition-all shadow-sm hover:shadow"
                aria-label={isCalendarOpen ? 'Hide calendar' : 'Show calendar'}
              >
                <CalendarIcon className="w-5 h-5" />
                <span className="text-[14px] font-medium">Meetings</span>
              </button>
            )}
          </div>

          {/* Syncing Banner */}
          {isSyncing && (
            <div className="mb-8 p-5 bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-white shadow-sm flex items-center justify-center">
                  <ArrowPathIcon className="w-5 h-5 text-indigo-600 animate-spin" />
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-indigo-900 mb-0.5">
                    Syncing your emails...
                  </p>
                  <p className="text-[13px] text-indigo-700">
                    Fetching and processing your emails. This usually takes 30-60 seconds.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* No Connection State */}
          {!connection && (
            <div className="text-center py-20 bg-white border border-neutral-200 shadow-sm">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 mx-auto mb-5 bg-gradient-to-br from-indigo-50 to-violet-50 flex items-center justify-center shadow-sm">
                  <SparklesIcon className="w-8 h-8 text-indigo-600" />
                </div>
                <h3 className="text-[17px] font-semibold text-neutral-900 mb-2">
                  Connect Your Email
                </h3>
                <p className="text-[14px] text-neutral-600 mb-8">
                  Connect Gmail or Outlook to start receiving AI-prepared work
                </p>
                <Link
                  href="/settings"
                  className="inline-flex items-center px-8 py-3 bg-indigo-600 text-white text-[14px] font-semibold hover:bg-indigo-700 transition-all shadow-sm hover:shadow"
                >
                  Go to Settings
                </Link>
              </div>
            </div>
          )}

          {/* Empty State */}
          {connection && inboxItems.length === 0 && !isSyncing && (
            <div className="text-center py-20 bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 shadow-sm">
              <div className="w-16 h-16 mx-auto mb-5 bg-white flex items-center justify-center shadow-sm">
                <CheckCircleIcon className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-[17px] font-semibold text-neutral-900 mb-2">
                All caught up!
              </h3>
              <p className="text-[14px] text-neutral-600">
                No pending work. I'll prepare new items during the next email sync.
              </p>
            </div>
          )}

          {/* Content - Section-Based Layout */}
          {connection && inboxItems.length > 0 && (
            <WorkSections items={inboxItems} />
          )}
          </div>
        </div>

        {/* Right Sidebar - Meetings (Collapsible Drawer) */}
        {connection && (
          <>
            {/* Overlay - Click to close */}
            {isCalendarOpen && (
              <div
                className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
                onClick={() => setIsCalendarOpen(false)}
                aria-hidden="true"
              />
            )}

            {/* Meetings Drawer */}
            <MeetingsSidebar
              userId={user.id}
              userEmail={user.email}
              isOpen={isCalendarOpen}
              onClose={() => setIsCalendarOpen(false)}
            />
          </>
        )}
      </main>

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        userEmail={user?.email}
        userFullName={initialUserFullName}
      />
    </div>
  );
}
