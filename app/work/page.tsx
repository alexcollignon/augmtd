import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkPageClient } from './work-page-client';
import {
  hasCompletedOnboarding,
  getUserIdentity,
} from '@/lib/context/work-patterns-service';
import { getBlueprintsForDepartment } from '@/lib/blueprints/blueprint-library';

export default async function WorkPage() {
  const supabase = await createClient();

  // Server-side auth check
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  // Check onboarding status and load blueprints based on department
  const completed = await hasCompletedOnboarding(user.id, supabase);
  let blueprints = [];

  if (completed) {
    const identity = await getUserIdentity(user.id, supabase);
    if (identity?.department) {
      blueprints = getBlueprintsForDepartment(identity.department);
    }
  }

  // Render client component
  return (
    <WorkPageClient
      userEmail={profile?.email || user.email}
      hasCompletedOnboarding={completed}
      blueprints={blueprints}
    />
  );
}
