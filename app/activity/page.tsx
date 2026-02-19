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

  // Fetch completed and dismissed items (most recent first)
  const { data: activityItems, error: fetchError } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['completed', 'dismissed'])
    .order('updated_at', { ascending: false })
    .limit(100);

  if (fetchError) {
    console.error('Error fetching activity items:', fetchError);
  }

  console.log('Activity items fetched:', activityItems?.length || 0, 'items');
  console.log('Sample item statuses:', activityItems?.slice(0, 3).map(i => ({ id: i.id, status: i.status })));

  return (
    <div className="flex h-screen bg-gradient-to-br from-neutral-50 to-white">
      {/* Sidebar */}
      <SidebarNav userEmail={user.email} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
          {/* Page Header */}
          <div className="mb-10">
            <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-2">
              Activity Log
            </h1>
            <p className="text-[15px] text-neutral-600">
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
