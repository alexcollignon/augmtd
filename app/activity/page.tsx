import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SidebarNav from '@/components/sidebar-nav';
import ActivityItem from '@/components/activity/activity-item';

export default async function ActivityPage() {
  const supabase = await createClient();

  // Server-side auth check
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch completed and rejected items (most recent first)
  const { data: activityItems } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['approved', 'rejected'])
    .order('updated_at', { ascending: false })
    .limit(100);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <SidebarNav userEmail={user.email} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Activity</h1>
            <p className="text-sm text-gray-500">
              A record of completed work and dismissed items.
            </p>
          </div>

          {/* Activity List */}
          {!activityItems || activityItems.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <p className="text-gray-600">No activity yet</p>
              <p className="text-sm text-gray-500 mt-1">
                Completed work will appear here
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
              {activityItems.map((item) => (
                <ActivityItem key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
