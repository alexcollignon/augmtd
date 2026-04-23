import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InboxPageClient } from '@/app/inbox/inbox-page-client';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { getActiveWorkspaceId } from '@/lib/workspace/active-workspace';

export const dynamic = 'force-dynamic';

export default async function PreparedWorkPage() {
  await guardFeaturePage('email');

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const activeWorkspaceId = await getActiveWorkspaceId();

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  let connQuery = supabase
    .from('connections')
    .select('id')
    .eq('user_id', user.id)
    .in('provider', ['gmail', 'outlook'])
    .eq('status', 'active');
  if (activeWorkspaceId) connQuery = connQuery.or(`workspace_id.eq.${activeWorkspaceId},workspace_id.is.null`);
  const { data: connections } = await connQuery;

  const hasConnection = (connections?.length ?? 0) > 0;

  let itemsQuery = supabase
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  if (activeWorkspaceId) itemsQuery = itemsQuery.or(`workspace_id.eq.${activeWorkspaceId},workspace_id.is.null`);
  const { data: inboxItems } = await itemsQuery;

  return (
    <InboxPageClient
      initialUser={user}
      initialUserFullName={profile?.full_name}
      initialHasConnection={hasConnection}
      initialInboxItems={inboxItems || []}
      activeWorkspaceId={activeWorkspaceId}
    />
  );
}
