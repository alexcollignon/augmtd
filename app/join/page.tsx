import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';
import JoinClient from './join-client';

export const dynamic = 'force-dynamic';

export default async function JoinPage(props: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await props.searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Superadmin bypass — they can manage workspaces without joining one.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.is_super_admin) redirect('/platform-admin');

  const workspace = await getMyWorkspace(user.id, supabase);

  // When coming from the workspace switcher, allow joining additional workspaces.
  if (from !== 'switcher') {
    if (workspace && workspace.status === 'active') redirect('/work');
    if (workspace && workspace.status === 'suspended') redirect('/suspended');
  }

  return <JoinClient userEmail={user.email ?? ''} initialCode={null} showBack={from === 'switcher'} />;
}
