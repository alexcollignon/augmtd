import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SidebarNav from '@/components/sidebar-nav';
import ActivityPageClient from './activity-page-client';

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
    .order('reviewed_at', { ascending: false })
    .limit(100);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <SidebarNav userEmail={user.email} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Activity Log</h1>
            <p className="text-sm text-gray-500">
              Execution history of all completed and dismissed items
            </p>
          </div>

          {/* Activity List */}
          <ActivityPageClient activityItems={activityItems || []} />
        </div>
      </main>
    </div>
  );
}
