import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import MeetingsPageClient from './meetings-page-client';

export default async function MeetingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex h-screen bg-neutral-50">
      <SidebarNav userEmail={user.email} />
      <main className="flex-1 min-h-0 flex flex-col">
        <MeetingsPageClient userEmail={user.email ?? ''} />
      </main>
    </div>
  );
}
