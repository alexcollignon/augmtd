import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ActivityPageClient from '@/app/activity/activity-page-client';

export default async function ActivityPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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

  return (
    <main className="flex-1 overflow-y-auto bg-gradient-to-br from-neutral-50 to-white">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
        <div className="mb-10">
          <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-2">
            Activity Log
          </h1>
          <p className="text-[15px] text-neutral-600">
            Execution history of all completed and dismissed items
          </p>
        </div>
        <ActivityPageClient activityItems={activityItems || []} />
      </div>
    </main>
  );
}
