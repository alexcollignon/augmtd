import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  EnvelopeIcon,
  SparklesIcon,
  InboxIcon,
  CheckCircleIcon,
  CalendarIcon,
  ClipboardDocumentListIcon
} from '@heroicons/react/24/outline';

export default async function InboxPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user has connected Gmail
  const { data: connection } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .single();

  // Fetch all inbox items (all emails are now processed and categorized)
  const { data: inboxItems } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Organize by category
  const pendingItems = inboxItems?.filter(item => item.status === 'pending') || [];
  const reviewedItems = inboxItems?.filter(item => item.status !== 'pending') || [];

  // Group pending items by category
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
              <span className="text-sm text-gray-600">{user.email}</span>
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-gray-900">Work Inbox</h2>
          <p className="text-gray-600 mt-1">
            All your emails organized by category with AI-prepared work
          </p>
        </div>

        {/* No Connection State */}
        {!connection && (
          <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
            <div className="max-w-md mx-auto">
              <EnvelopeIcon className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Connect Your Email
              </h3>
              <p className="text-gray-600 mb-6">
                Connect your Gmail account to start receiving AI-prepared work in your inbox
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
        {connection && (!inboxItems || inboxItems.length === 0) && (
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

        {/* Inbox Items - Organized by Category */}
        {connection && inboxItems && inboxItems.length > 0 && (
          <div className="space-y-6">
            {/* Action Required */}
            {actionRequired.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                    Action Required ({actionRequired.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {actionRequired.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Questions to Answer */}
            {questions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                    Questions to Answer ({questions.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {questions.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Decisions Needed */}
            {decisions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                    Decisions Needed ({decisions.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {decisions.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* For Your Information */}
            {information.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                    For Your Information ({information.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {information.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Newsletters */}
            {newsletters.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Newsletters ({newsletters.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                  {newsletters.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Promotional */}
            {promotional.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Promotional ({promotional.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                  {promotional.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Social */}
            {social.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Social ({social.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                  {social.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Other */}
            {other.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                    Other ({other.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-75">
                  {other.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Reviewed Items */}
            {reviewedItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                    Reviewed ({reviewedItems.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 opacity-60">
                  {reviewedItems.map((item) => (
                    <InboxItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function InboxItemCard({ item }: { item: any }) {
  const sourceData = item.source_data;
  const urgencyColors = {
    low: 'text-gray-600 bg-gray-100',
    medium: 'text-blue-700 bg-blue-100',
    high: 'text-orange-700 bg-orange-100',
    critical: 'text-red-700 bg-red-100'
  };

  const urgencyColor = urgencyColors[sourceData?.urgency as keyof typeof urgencyColors] || urgencyColors.medium;

  return (
    <Link href={`/inbox/${item.id}`} className="block hover:bg-gray-50 transition-colors">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {/* From */}
            <div className="flex items-center space-x-2 mb-1">
              <span className="font-medium text-gray-900">
                {sourceData?.from_name || sourceData?.from || 'Unknown'}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${urgencyColor}`}>
                {sourceData?.urgency || 'medium'}
              </span>
            </div>

            {/* Subject */}
            <h4 className="text-sm text-gray-900 font-medium mb-1 truncate">
              {sourceData?.subject || 'No subject'}
            </h4>

            {/* Summary */}
            <p className="text-sm text-gray-600 line-clamp-2 mb-2">
              {sourceData?.summary || item.ai_suggestion_content}
            </p>

            {/* Action Items Preview */}
            {sourceData?.actionItems && sourceData.actionItems.length > 0 && (
              <div className="flex items-center space-x-3 text-xs text-gray-500">
                <span className="flex items-center space-x-1">
                  <ClipboardDocumentListIcon className="w-4 h-4" />
                  <span>{sourceData.actionItems.length} action{sourceData.actionItems.length > 1 ? 's' : ''}</span>
                </span>
                {sourceData?.draftReply && (
                  <span className="flex items-center space-x-1">
                    <EnvelopeIcon className="w-4 h-4" />
                    <span>Draft ready</span>
                  </span>
                )}
                {sourceData?.calendarEvent && (
                  <span className="flex items-center space-x-1">
                    <CalendarIcon className="w-4 h-4" />
                    <span>Event suggested</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Priority Badge */}
          <div className="ml-4 flex-shrink-0">
            <div className="flex flex-col items-end space-y-1">
              <span className="text-xs text-gray-500">
                {new Date(item.created_at).toLocaleDateString()}
              </span>
              {item.priority >= 75 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700">
                  High Priority
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
