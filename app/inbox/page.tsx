'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import SimpleInboxCard from '@/components/inbox/simple-inbox-card';
import InboxDrawer from '@/components/inbox/inbox-drawer';
import OnboardingModal from '@/components/onboarding-modal';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon,
  Cog6ToothIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon
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
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  // Group by work state
  const workPrepared = inboxItems.filter(item => item.work_state === 'work_prepared');
  const decisionsNeeded = inboxItems.filter(item => item.work_state === 'decision_required');
  const waiting = inboxItems.filter(item => item.work_state === 'waiting');
  const handled = inboxItems.filter(item => item.work_state === 'no_work');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-primary-50/30">
      {/* Header */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link href="/" className="flex items-center space-x-2.5 group">
                <div className="relative">
                  <Image
                    src="/augmtd-logo.png"
                    alt="AUGMTD"
                    width={32}
                    height={32}
                    className="w-8 h-8 group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-primary-900 bg-clip-text text-transparent">AUGMTD</span>
              </Link>
              <Link href="/inbox" className="text-gray-900 font-medium px-4 py-2 rounded-lg bg-gradient-to-br from-primary-50 to-purple-50 border border-primary-200/50 shadow-sm transition-all">
                Inbox
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">{user?.email}</span>
              <Link href="/settings" className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all border border-transparent" title="Settings">
                <Cog6ToothIcon className="w-5 h-5" />
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header - NEW: Work-centric title */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Prepared Work</h2>
          <p className="text-gray-600">
            Your next steps, ready for review
          </p>
        </div>

        {/* No Connection State */}
        {!connection && (
          <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
            <div className="max-w-md mx-auto">
              <SparklesIcon className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Connect Your Email
              </h3>
              <p className="text-gray-600 mb-6">
                Connect Gmail or Outlook to start receiving AI-prepared work
              </p>
              <div className="flex justify-center space-x-3">
                <Link
                  href="/api/auth/gmail/connect"
                  className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium"
                >
                  Connect Gmail
                </Link>
                <Link
                  href="/api/auth/outlook/connect"
                  className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Connect Outlook
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {connection && inboxItems.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <CheckCircleIcon className="w-12 h-12 mx-auto mb-4 text-green-500" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              All caught up!
            </h3>
            <p className="text-gray-600">
              No pending work. I'll prepare new items during the next email sync.
            </p>
          </div>
        )}

        {/* Content - 4 Work State Sections */}
        {connection && inboxItems.length > 0 && (
          <div className="space-y-6">
            {/* 1. READY TO EXECUTE - Work Prepared */}
            {workPrepared.length > 0 && (
              <section>
                <div className="flex items-center space-x-2.5 mb-4">
                  <div className="p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-sm">
                    <CheckCircleIcon className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Ready to Execute ({workPrepared.length})</h3>
                  <span className="text-sm text-gray-500">I prepared drafts and next steps</span>
                </div>
                <div className="bg-white rounded-2xl border border-gray-200/50 divide-y divide-gray-100 shadow-lg shadow-gray-200/50 overflow-hidden">
                  {workPrepared.map((item) => (
                    <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                  ))}
                </div>
              </section>
            )}

            {/* 2. DECISIONS NEEDED */}
            {decisionsNeeded.length > 0 && (
              <section>
                <div className="flex items-center space-x-2.5 mb-4">
                  <div className="p-2 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg shadow-sm">
                    <ExclamationCircleIcon className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Decisions Needed ({decisionsNeeded.length})</h3>
                  <span className="text-sm text-gray-500">I need your judgment</span>
                </div>
                <div className="bg-white rounded-2xl border border-orange-200/50 divide-y divide-gray-100 shadow-lg shadow-orange-100/50 overflow-hidden">
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
                  className="w-full flex items-center justify-between py-3 px-4 text-left group rounded-xl hover:bg-gray-100/50 transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 bg-gray-400 rounded-lg">
                      <ClockIcon className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                      Waiting ({waiting.length})
                    </h3>
                    <span className="text-sm text-gray-500">Nothing to do now, I'm tracking these</span>
                  </div>
                  {showWaiting ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  )}
                </button>
                {showWaiting && (
                  <div className="mt-3 bg-white/60 rounded-2xl border border-gray-200/50 divide-y divide-gray-100 backdrop-blur-sm">
                    {waiting.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 4. HANDLED AUTOMATICALLY - Collapsible */}
            {handled.length > 0 && (
              <section>
                <button
                  onClick={() => setShowHandled(!showHandled)}
                  className="w-full flex items-center justify-between py-3 px-4 text-left group rounded-xl hover:bg-gray-100/50 transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 bg-gray-300 rounded-lg">
                      <CheckCircleIcon className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                      Handled Automatically ({handled.length})
                    </h3>
                    <span className="text-sm text-gray-400">FYIs and confirmations I took care of</span>
                  </div>
                  {showHandled ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  )}
                </button>
                {showHandled && (
                  <div className="mt-3 bg-white/40 rounded-2xl border border-gray-200/50 divide-y divide-gray-100 backdrop-blur-sm">
                    {handled.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* All caught up message */}
            {workPrepared.length === 0 && decisionsNeeded.length === 0 && (
              <div className="text-center py-12 bg-gradient-to-br from-white to-gray-50 rounded-2xl border border-gray-200/50 shadow-sm">
                <div className="inline-flex p-3 bg-gradient-to-br from-green-50 to-green-100 rounded-2xl mb-4">
                  <CheckCircleIcon className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  All caught up!
                </h3>
                <p className="text-gray-600 text-sm max-w-md mx-auto">
                  No actionable work right now. {waiting.length > 0 && `${waiting.length} item${waiting.length > 1 ? 's' : ''} waiting on others.`} {handled.length > 0 && `${handled.length} item${handled.length > 1 ? 's' : ''} already handled.`}
                </p>
              </div>
            )}
          </div>
        )}
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
