import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import DriveClient from './drive-client';

export default async function DrivePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: sources } = await supabase
    .from('knowledge_sources')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const { data: connections } = await supabase
    .from('connections')
    .select('id, provider, metadata')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .in('provider', ['gmail', 'outlook']);

  return (
    <div className="flex h-screen bg-gradient-to-br from-neutral-50 to-white">
      <SidebarNav userEmail={user.email} />
      <main className="flex-1 overflow-y-auto">
        <DriveClient
          initialSources={sources ?? []}
          connections={(connections ?? []).map((c) => ({
            id: c.id,
            provider: c.provider as 'gmail' | 'outlook',
            email: c.metadata?.email ?? '',
          }))}
        />
      </main>
    </div>
  );
}
