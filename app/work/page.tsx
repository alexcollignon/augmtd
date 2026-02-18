import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkPageClient } from './work-page-client';
import {
  hasCompletedOnboarding,
  getUserIdentity,
} from '@/lib/context/work-patterns-service';
import { getBlueprintsForDepartment } from '@/lib/blueprints/blueprint-library';
import { WorkBlueprint } from '@/lib/types/work-blueprints';

export default async function WorkPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  const completed = await hasCompletedOnboarding(user.id, supabase);
  let blueprints: WorkBlueprint[] = [];
  if (completed) {
    const identity = await getUserIdentity(user.id, supabase);
    if (identity?.department) {
      blueprints = getBlueprintsForDepartment(identity.department);
    }
  }

  // Load existing work threads
  const { data: threads } = await supabase
    .from('work_threads')
    .select('id, title, plan, status, created_at, updated_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(50);

  return (
    <WorkPageClient
      userEmail={profile?.email || user.email}
      hasCompletedOnboarding={completed}
      blueprints={blueprints}
      initialThreads={threads || []}
    />
  );
}
