'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import SimpleInboxCard from '@/components/inbox/simple-inbox-card';
import InboxDrawer from '@/components/inbox/inbox-drawer';
import { ChevronDownIcon, ChevronUpIcon, SparklesIcon } from '@heroicons/react/24/outline';

export default function InboxPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [connection, setConnection] = useState<any>(null);
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Collapsible states
  const [showNewsletters, setShowNewsletters] = useState(false);
  const [showPromotional, setShowPromotional] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

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
        .eq('provider', 'gmail')
        .eq('status', 'active')
        .single();
      setConnection(conn);

      // Fetch inbox items
      const { data: items } = await supabase
        .from('inbox_items')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
      setInboxItems(items || []);

      setLoading(false);
    }

    loadData();
  }, [router]);

  const handleItemClick = (item: any) => {
    setSelectedItem(item);
    setIsDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    // Refresh data after closing drawer (in case item was approved/rejected)
    setTimeout(async () => {
      const supabase = createClient();
      const { data: items } = await supabase
        .from('inbox_items')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setInboxItems(items || []);
    }, 300);
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  // Organize items
  const pendingItems = inboxItems.filter(item => item.status === 'pending');
  const reviewedItems = inboxItems.filter(item => item.status !== 'pending');

  // High priority items with TODOs (action items)
  const preparedItems = pendingItems
    .filter(item => {
      const sd = item.source_data;
      const hasActionItems = sd?.actionItems && sd.actionItems.length > 0;
      const isHighPriority = item.priority >= 75 || sd?.urgency === 'high' || sd?.urgency === 'critical';
      return hasActionItems && isHighPriority;
    })
    .sort((a, b) => {
      // Sort by urgency first (critical > high > medium > low)
      const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const urgencyA = urgencyOrder[a.source_data?.urgency as keyof typeof urgencyOrder] ?? 2;
      const urgencyB = urgencyOrder[b.source_data?.urgency as keyof typeof urgencyOrder] ?? 2;
      if (urgencyA !== urgencyB) return urgencyA - urgencyB;
      // Then by priority score
      return (b.priority || 0) - (a.priority || 0);
    })
    .slice(0, 5); // Top 5

  // Categorize pending items
  const actionRequired = pendingItems.filter(item => item.ai_suggestion_type === 'action_required');
  const questions = pendingItems.filter(item => item.ai_suggestion_type === 'question');
  const decisions = pendingItems.filter(item => item.ai_suggestion_type === 'decision');
  const information = pendingItems.filter(item => item.ai_suggestion_type === 'information');
  const newsletters = pendingItems.filter(item => item.ai_suggestion_type === 'newsletter');
  const promotional = pendingItems.filter(item => item.ai_suggestion_type === 'promotional');
  const social = pendingItems.filter(item => item.ai_suggestion_type === 'social');
  const other = pendingItems.filter(item => item.ai_suggestion_type === 'other');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link href="/" className="flex items-center space-x-2">
                <Image
                  src="/augmtd-logo.png"
                  alt="AUGMTD"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
                <span className="text-xl font-bold text-gray-900">AUGMTD</span>
              </Link>
              <div className="flex space-x-4">
                <Link href="/inbox" className="text-gray-900 font-medium px-3 py-2 rounded-md bg-gray-100">
                  Inbox
                </Link>
                <Link href="/settings" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md">
                  Settings
                </Link>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user?.email}</span>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900">Work Inbox</h2>
          <p className="text-gray-600 mt-1">
            AI-prepared work from your emails
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
                Connect your Gmail account to start receiving AI-prepared work
              </p>
              <Link
                href="/api/auth/gmail/connect"
                className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium"
              >
                Connect Gmail
              </Link>
            </div>
          </div>
        )}

        {/* Empty State */}
        {connection && inboxItems.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <SparklesIcon className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              All caught up!
            </h3>
            <p className="text-gray-600">
              No emails yet. We'll fetch and categorize them during the next sync.
            </p>
          </div>
        )}

        {/* Content */}
        {connection && inboxItems.length > 0 && (
          <div className="space-y-8">
            {/* I Prepared These For You */}
            {preparedItems.length > 0 && (
              <div>
                <div className="flex items-center space-x-2 mb-4">
                  <SparklesIcon className="w-5 h-5 text-primary-600" />
                  <h3 className="text-lg font-semibold text-gray-900">I prepared these for you</h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 shadow-sm">
                  {preparedItems.map((item) => (
                    <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                  ))}
                </div>
              </div>
            )}

            {/* Action Required */}
            {actionRequired.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
                  Action Required ({actionRequired.length})
                </h3>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {actionRequired.map((item) => (
                    <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                  ))}
                </div>
              </div>
            )}

            {/* Questions */}
            {questions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
                  Questions to Answer ({questions.length})
                </h3>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {questions.map((item) => (
                    <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                  ))}
                </div>
              </div>
            )}

            {/* Decisions */}
            {decisions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
                  Decisions Needed ({decisions.length})
                </h3>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {decisions.map((item) => (
                    <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                  ))}
                </div>
              </div>
            )}

            {/* Information */}
            {information.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
                  For Your Information ({information.length})
                </h3>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {information.map((item) => (
                    <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                  ))}
                </div>
              </div>
            )}

            {/* Newsletters - Collapsible */}
            {newsletters.length > 0 && (
              <div>
                <button
                  onClick={() => setShowNewsletters(!showNewsletters)}
                  className="w-full flex items-center justify-between mb-3 text-left"
                >
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Newsletters ({newsletters.length})
                  </h3>
                  {showNewsletters ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {showNewsletters && (
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                    {newsletters.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Promotional - Collapsible */}
            {promotional.length > 0 && (
              <div>
                <button
                  onClick={() => setShowPromotional(!showPromotional)}
                  className="w-full flex items-center justify-between mb-3 text-left"
                >
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Promotional ({promotional.length})
                  </h3>
                  {showPromotional ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {showPromotional && (
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                    {promotional.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Social - Collapsible */}
            {social.length > 0 && (
              <div>
                <button
                  onClick={() => setShowSocial(!showSocial)}
                  className="w-full flex items-center justify-between mb-3 text-left"
                >
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Social ({social.length})
                  </h3>
                  {showSocial ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {showSocial && (
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                    {social.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Other - Collapsible */}
            {other.length > 0 && (
              <div>
                <button
                  onClick={() => setShowOther(!showOther)}
                  className="w-full flex items-center justify-between mb-3 text-left"
                >
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Other ({other.length})
                  </h3>
                  {showOther ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {showOther && (
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                    {other.map((item) => (
                      <SimpleInboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                  </div>
                )}
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
    </div>
  );
}
