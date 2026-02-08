'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
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
  ClockIcon,
  ExclamationCircleIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

export default function PreparedWorkPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [connection, setConnection] = useState<any>(null);
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Collapsible states
  const [showWaiting, setShowWaiting] = useState(false);
  const [showHandled, setShowHandled] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let pollingInterval: NodeJS.Timeout;

    async function loadData() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/login');
        return;
      }
      setUser(currentUser);

      // Check connection
      const { data: conn } = await supabase
        .from('connections')
        .select('*')
        .eq('user_id', currentUser.id)
        .in('provider', ['gmail', 'outlook'])
        .eq('status', 'active')
        .limit(1)
        .single();

      setConnection(conn);

      // Show onboarding modal if no connection
      if (!conn) {
        setIsOnboardingOpen(true);
      }

      // Fetch inbox items
      await fetchInboxItems(currentUser.id);

      setLoading(false);
    }

    async function fetchInboxItems(userId: string) {
      const { data: items } = await supabase
        .from('inbox_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (items) {
        setInboxItems(items);
      }
    }

    loadData();

    // Poll for new items every 10 seconds
    pollingInterval = setInterval(async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        await fetchInboxItems(currentUser.id);
      }
    }, 10000);

    // Cleanup polling on unmount
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [router]);

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

  if (loading) {
    return (
      <div className="flex h-screen">
        <SidebarNav userEmail={user?.email} />
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  // Group by work state (cognitive cost levels)
  const workPrepared = inboxItems.filter(item => item.work_state === 'work_prepared');
  const actionRequired = inboxItems.filter(item => item.work_state === 'action_required');
  const decisionsNeeded = inboxItems.filter(item => item.work_state === 'decision_required');
  const waiting = inboxItems.filter(item => item.work_state === 'waiting');

  // Level 2: Awareness required (noted)
  const noted = inboxItems.filter(item => item.work_state === 'noted' || item.work_state === 'no_work');

  // Level 3: Noise (hidden completely - don't show)
  // const noise = inboxItems.filter(item => item.work_state === 'noise');

  // Batch NOTED items to reduce clutter
  const { batches: notedBatches, unbatched: unbatchedNoted } = batchInboxItems(noted);
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

          {/* No Connection State */}
          {!connection && (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
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
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
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
                  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
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
                  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                    {actionRequired.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
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
                  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
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
                    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
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
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
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
