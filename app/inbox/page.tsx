import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import InboxViewToggle from '@/components/inbox/inbox-view-toggle';

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const view = searchParams.view || 'filtered';

  // Check if user has connected Gmail
  const { data: connection } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .single();

  // Fetch data based on view
  let inboxItems: any[] | null = null;
  let allEmails: any[] | null = null;

  if (view === 'filtered') {
    // Fetch AI-filtered inbox items
    const { data } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    inboxItems = data;
  } else {
    // Fetch all emails
    const { data } = await supabase
      .from('emails')
      .select('*')
      .eq('user_id', user.id)
      .order('received_at', { ascending: false });
    allEmails = data;
  }

  const pendingItems = inboxItems?.filter(item => item.status === 'pending') || [];
  const reviewedItems = inboxItems?.filter(item => item.status !== 'pending') || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <h1 className="text-2xl font-bold text-primary-600">AUGMTD</h1>
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Work Inbox</h2>
            <p className="text-gray-600 mt-1">
              {view === 'filtered'
                ? 'Review AI-prepared work from your emails'
                : 'View all your emails'}
            </p>
          </div>
          {connection && <InboxViewToggle />}
        </div>

        {/* No Connection State */}
        {!connection && (
          <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
            <div className="max-w-md mx-auto">
              <div className="text-4xl mb-4">📧</div>
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

        {/* Empty State - Filtered View */}
        {connection && view === 'filtered' && (!inboxItems || inboxItems.length === 0) && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <div className="text-4xl mb-4">✨</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              All caught up!
            </h3>
            <p className="text-gray-600">
              No actionable items found. Check "All Emails" to see everything.
            </p>
          </div>
        )}

        {/* Empty State - All Emails View */}
        {connection && view === 'all' && (!allEmails || allEmails.length === 0) && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <div className="text-4xl mb-4">📪</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No emails yet
            </h3>
            <p className="text-gray-600">
              We'll fetch your emails during the next sync.
            </p>
          </div>
        )}

        {/* AI-Filtered Inbox Items */}
        {connection && view === 'filtered' && inboxItems && inboxItems.length > 0 && (
          <div className="space-y-6">
            {/* Pending Items */}
            {pendingItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                    Pending Review ({pendingItems.length})
                  </h3>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {pendingItems.map((item) => (
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

        {/* All Emails View */}
        {connection && view === 'all' && allEmails && allEmails.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                All Emails ({allEmails.length})
              </h3>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
              {allEmails.map((email) => (
                <EmailCard key={email.id} email={email} />
              ))}
            </div>
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
              <div className="flex items-center space-x-2 text-xs text-gray-500">
                <span>📋 {sourceData.actionItems.length} action{sourceData.actionItems.length > 1 ? 's' : ''}</span>
                {sourceData?.draftReply && <span>• ✉️ Draft ready</span>}
                {sourceData?.calendarEvent && <span>• 📅 Event suggested</span>}
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

function EmailCard({ email }: { email: any }) {
  return (
    <div className="p-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* From */}
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-medium text-gray-900">
              {email.from_name || email.from_address}
            </span>
            <span className="text-xs text-gray-500">
              {email.from_address}
            </span>
          </div>

          {/* Subject */}
          <h4 className="text-sm text-gray-900 font-medium mb-1">
            {email.subject || '(No subject)'}
          </h4>

          {/* Body Preview */}
          <p className="text-sm text-gray-600 line-clamp-2">
            {email.body_preview || email.body?.substring(0, 150) + '...'}
          </p>
        </div>

        {/* Date */}
        <div className="ml-4 flex-shrink-0">
          <span className="text-xs text-gray-500">
            {new Date(email.received_at).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}
