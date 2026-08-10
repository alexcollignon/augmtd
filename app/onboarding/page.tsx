import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';
import OnboardingClient from './onboarding-client';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await getMyWorkspace(user.id, supabase);
  if (workspace) redirect('/home');

  return <OnboardingClient userEmail={user.email ?? ''} />;
}
