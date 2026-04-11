import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InboxPageClient } from '@/app/inbox/inbox-page-client';

export const dynamic = 'force-dynamic';

export default async function PreparedWorkPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const { data: connections } = await supabase
    .from('connections')
    .select('id')
    .eq('user_id', user.id)
    .in('provider', ['gmail', 'outlook'])
    .eq('status', 'active');

  const hasConnection = (connections?.length ?? 0) > 0;

  const { data: inboxItems } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  return (
    <InboxPageClient
      initialUser={user}
      initialUserFullName={profile?.full_name}
      initialHasConnection={hasConnection}
      initialInboxItems={inboxItems || []}
    />
  );
}
