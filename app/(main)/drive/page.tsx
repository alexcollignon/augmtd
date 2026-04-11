import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DriveClient from '@/app/drive/drive-client';

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
    <main className="flex-1 overflow-hidden flex flex-col">
      <DriveClient
        initialSources={sources ?? []}
        connections={(connections ?? []).map((c) => ({
          id: c.id,
          provider: c.provider as 'gmail' | 'outlook',
          email: c.metadata?.email ?? '',
        }))}
      />
    </main>
  );
}
