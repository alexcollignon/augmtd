import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import DeskPageClient from './desk-page-client';

export default async function DeskPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex h-screen bg-white">
      <SidebarNav userEmail={user.email} />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <DeskPageClient />
      </main>
    </div>
  );
}
