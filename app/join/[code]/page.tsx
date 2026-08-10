import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';
import JoinClient from '../join-client';

export const dynamic = 'force-dynamic';

export default async function JoinWithCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Unauthenticated: bounce to login with redirect back to this code URL
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.is_super_admin) redirect('/platform-admin');

  const workspace = await getMyWorkspace(user.id, supabase);
  if (workspace && workspace.status === 'active') {
    redirect('/home');
  }
  if (workspace && workspace.status === 'suspended') {
    redirect('/suspended');
  }

  return <JoinClient userEmail={user.email ?? ''} initialCode={code} />;
}
