import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAllWorkspaces } from '@/lib/workspace/features';
import OnboardingClient from './onboarding-client';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const allWorkspaces = await getAllWorkspaces(user.id);
  if (allWorkspaces.length > 0) redirect('/work');

  return <OnboardingClient userEmail={user.email ?? ''} />;
}
