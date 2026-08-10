import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';
import SuspendedClient from './suspended-client';

export const dynamic = 'force-dynamic';

export default async function SuspendedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.is_super_admin) redirect('/platform-admin');

  const workspace = await getMyWorkspace(user.id, supabase);
  // If no workspace, send to /join instead
  if (!workspace) redirect('/join');
  // If workspace is active, they shouldn't be here
  if (workspace.status === 'active') redirect('/home');

  return (
    <SuspendedClient
      userEmail={user.email ?? ''}
      workspaceName={workspace.name}
    />
  );
}
