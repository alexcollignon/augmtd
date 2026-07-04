import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ActivityPageClient, { type ActivityEvent } from '@/app/activity/activity-page-client';

// Activity timeline — a chronological log of the user's actions, backed by activity_events.
// RLS-safe (cookie session). Renders inside the (main) layout so it gets the sidebar.
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;

export default async function ActivityPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Fetch one extra to detect "load more". Degrades gracefully to empty if the table
  // isn't there yet (migration not applied).
  const { data, error } = await supabase
    .from('activity_events')
    .select('id, type, title, entity_type, entity_id, metadata, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (error) {
    console.error('[activity] page fetch failed:', error.message);
  }

  const rows = (data || []) as ActivityEvent[];
  const hasMore = rows.length > PAGE_SIZE;
  const events = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return <ActivityPageClient initialEvents={events} initialHasMore={hasMore} />;
}
