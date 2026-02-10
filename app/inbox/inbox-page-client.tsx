'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SidebarNav from '@/components/sidebar-nav';
import SimpleInboxCard from '@/components/inbox/simple-inbox-card';
import BatchCard from '@/components/inbox/batch-card';
import InboxDrawer from '@/components/inbox/inbox-drawer';
import OnboardingModal from '@/components/onboarding-modal';
import { batchInboxItems } from '@/lib/utils/batch-inbox-items';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  SparklesIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

interface InboxPageClientProps {
  initialUser: any;
  initialConnection: any | null;
  initialInboxItems: any[];
}

export function InboxPageClient({
  initialUser,
  initialConnection,
  initialInboxItems
}: InboxPageClientProps) {
  const searchParams = useSearchParams();
  const [user] = useState(initialUser);
  const [connection, setConnection] = useState(initialConnection);
  const [inboxItems, setInboxItems] = useState(initialInboxItems);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(!initialConnection);
  const [isSyncing, setIsSyncing] = useState(false);

  // Track when we've optimistically started a sync
  const optimisticSyncTriggered = useRef(false);

  // Collapsible states
  const [showWaiting, setShowWaiting] = useState(false);
  const [showHandled, setShowHandled] = useState(false);

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
      const { data: items } = await supabase
        .from('inbox_items')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (items) {
        setInboxItems(items);
      }

      // Check connection sync status
      if (connection) {
        const { data: conn } = await supabase
          .from('connections')
          .select('sync_status')
          .eq('id', connection.id)
          .single();

        if (conn) {
          const isCurrentlySyncing = conn.sync_status === 'syncing';
          const syncCompleted = conn.sync_status === 'completed' || conn.sync_status === 'failed';

          // If we optimistically triggered a sync, only update state when we see actual progress
          if (optimisticSyncTriggered.current) {
            // Sync has actually started or completed - clear optimistic flag
            if (isCurrentlySyncing || syncCompleted) {
              optimisticSyncTriggered.current = false;
              setIsSyncing(isCurrentlySyncing);
            }
            // Otherwise, keep showing optimistic loading state (ignore 'pending')
          } else {
            // Normal polling - update state based on database
            setIsSyncing(isCurrentlySyncing);
          }

          // If was syncing and now completed, refresh to show new items
          if (isSyncing && !isCurrentlySyncing) {
            setInboxItems(items || []);
          }
        }
      }
    }

    // Poll more frequently (every 2s) when syncing, otherwise every 10s
    const pollInterval = isSyncing ? 2000 : 10000;
    const pollingInterval = setInterval(fetchData, pollInterval);

    // Fetch immediately on mount
    fetchData();

    return () => clearInterval(pollingInterval);
  }, [user.id, connection, isSyncing]);

  const handleItemClick = (item: any) => {
    setSelectedItem(item);
    setIsDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    // Refresh data after closing drawer
    setTimeout(async () => {
      const supabase = createClient();
      const { data: items } = await supabase
        .from('inbox_items')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      setInboxItems(items || []);
    }, 300);
  };

  // Group by work state (cognitive cost levels)
  const workPrepared = inboxItems.filter(item => item.work_state === 'work_prepared');
  const actionRequired = inboxItems.filter(item => item.work_state === 'action_required');
  const decisionsNeeded = inboxItems.filter(item => item.work_state === 'decision_required');
  const waiting = inboxItems.filter(item => item.work_state === 'waiting');

  // Level 2: Awareness required (noted)
  const noted = inboxItems.filter(item => item.work_state === 'noted' || item.work_state === 'no_work');

  // Batch mechanical ACTION_REQUIRED and NOTED items to reduce clutter
  const { batches: actionBatches, unbatched: unbatchedActions } = batchInboxItems(actionRequired);
  const { batches: notedBatches, unbatched: unbatchedNoted } = batchInboxItems(noted);
  const totalActionCount = actionRequired.length;
  const totalNotedCount = noted.length;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <SidebarNav userEmail={user?.email} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Prepared Work</h1>
            <p className="text-sm text-gray-500">
              These are the only things that need your attention right now.
            </p>
          </div>

          {/* Syncing Banner */}
          {isSyncing && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center space-x-3">
                <ArrowPathIcon className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-900">
                    Syncing your emails...
                  </p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    We're fetching and processing your emails. This usually takes 30-60 seconds.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* No Connection State */}
          {!connection && (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <div className="max-w-md mx-auto">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                  <SparklesIcon className="w-6 h-6 text-gray-400" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">
                  Connect Your Email
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  Connect Gmail or Outlook to start receiving AI-prepared work
                </p>
                <div className="flex justify-center space-x-3">
                  <Link
                    href="/api/auth/gmail/connect"
                    className="inline-block px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    Connect Gmail
                  </Link>
                  <Link
                    href="/api/auth/outlook/connect"
                    className="inline-block px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Connect Outlook
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {connection && inboxItems.length === 0 && (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
                <CheckCircleIcon className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                All caught up!
              </h3>
              <p className="text-sm text-gray-600">
                No pending work. I'll prepare new items during the next email sync.
              </p>
            </div>
          )}

          {/* Content - 4 Work State Sections */}
          {connection && inboxItems.length > 0 && (
            <div className="space-y-8">
              {/* 1. WORK PREPARED */}
              {workPrepared.length > 0 && (
                <section>
                  <div className="flex items-center space-x-2.5 mb-3">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                      Work Prepared ({workPrepared.length})
                    </h2>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                    {workPrepared.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                </section>
              )}

              {/* 2. ACTION REQUIRED */}
              {actionRequired.length > 0 && (
                <section>
                  <div className="flex items-center space-x-2.5 mb-3">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                      Action Required ({actionRequired.length})
                    </h2>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {/* Operational actions first (unbatched - high priority) */}
                    {unbatchedActions.length > 0 && (
                      <div className="divide-y divide-gray-100">
                        {unbatchedActions.map((item) => (
                          <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                        ))}
                      </div>
                    )}

                    {/* Mechanical actions (batched - low friction) */}
                    {actionBatches.map((batch) => (
                      <BatchCard
                        key={batch.id}
                        batch={batch}
                        onClick={(itemId) => {
                          const item = batch.items.find(i => i.id === itemId);
                          if (item) handleItemClick(item);
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* 3. DECISIONS NEEDED */}
              {decisionsNeeded.length > 0 && (
                <section>
                  <div className="flex items-center space-x-2.5 mb-3">
                    <div className="w-2 h-2 rounded-full bg-orange-500" />
                    <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                      Decisions Needed ({decisionsNeeded.length})
                    </h2>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                    {decisionsNeeded.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                </section>
              )}

              {/* 3. WAITING - Collapsible */}
              {waiting.length > 0 && (
                <section>
                  <button
                    onClick={() => setShowWaiting(!showWaiting)}
                    className="w-full flex items-center justify-between mb-3 group"
                  >
                    <div className="flex items-center space-x-2.5">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                      <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide group-hover:text-gray-900 transition-colors">
                        Waiting ({waiting.length})
                      </h2>
                    </div>
                    {showWaiting ? (
                      <ChevronUpIcon className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    ) : (
                      <ChevronDownIcon className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    )}
                  </button>
                  {showWaiting && (
                    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                      {waiting.map((item) => (
                        <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* 4. NOTED - Level 2: Awareness Required */}
              {totalNotedCount > 0 && (
                <section>
                  <button
                    onClick={() => setShowHandled(!showHandled)}
                    className="w-full flex items-center justify-between mb-3 group"
                  >
                    <div className="flex items-center space-x-2.5">
                      <div className="w-2 h-2 rounded-full bg-gray-300" />
                      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide group-hover:text-gray-700 transition-colors">
                        Noted ({totalNotedCount})
                      </h2>
                    </div>
                    {showHandled ? (
                      <ChevronUpIcon className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    ) : (
                      <ChevronDownIcon className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    )}
                  </button>
                  {showHandled && (
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      {/* Info banner */}
                      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                        <p className="text-xs text-gray-600">
                          These don't need a response, but you may want to be aware of them.
                        </p>
                      </div>

                      {/* Batched items first */}
                      {notedBatches.map((batch) => (
                        <BatchCard
                          key={batch.id}
                          batch={batch}
                          onClick={(itemId) => {
                            const item = batch.items.find(i => i.id === itemId);
                            if (item) handleItemClick(item);
                          }}
                        />
                      ))}

                      {/* Unbatched items */}
                      {unbatchedNoted.length > 0 && (
                        <div className="divide-y divide-gray-100">
                          {unbatchedNoted.map((item) => (
                            <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* All caught up message */}
              {workPrepared.length === 0 && actionRequired.length === 0 && decisionsNeeded.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
                    <CheckCircleIcon className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-2">
                    All caught up!
                  </h3>
                  <p className="text-sm text-gray-600">
                    Nothing needs your attention right now.
                    {waiting.length > 0 && ` ${waiting.length} item${waiting.length > 1 ? 's' : ''} waiting on others.`}
                    {totalNotedCount > 0 && ` ${totalNotedCount} item${totalNotedCount > 1 ? 's' : ''} noted for awareness.`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Drawer */}
      <InboxDrawer
        item={selectedItem}
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
      />

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        userEmail={user?.email}
      />
    </div>
  );
}
