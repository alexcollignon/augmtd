import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkPageClient } from './work-page-client';
import { getUserIdentity } from '@/lib/context/work-patterns-service';
import { getBlueprintsForDepartment } from '@/lib/blueprints/blueprint-library';
import { WorkBlueprint, SavedWorkflow } from '@/lib/types/work-blueprints';

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; view?: string; prompt?: string }>;
}) {
  const { thread: initialThreadId, view: initialView, prompt: initialChatInput } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  // Same identity check as inbox page — requires name + dept + role
  const identity = await getUserIdentity(user.id, supabase);
  const hasCompletedIdentity = !!(
    profile?.full_name &&
    identity?.department &&
    identity?.jobRole
  );

  // Load department-filtered blueprints when identity is complete
  let blueprints: WorkBlueprint[] = [];
  if (hasCompletedIdentity && identity?.department) {
    blueprints = getBlueprintsForDepartment(identity.department);
  }

  // Load existing work threads + saved workflows in parallel
  const [{ data: threads }, { data: savedWorkflowsData }] = await Promise.all([
    supabase
      .from('work_threads')
      .select('id, title, plan, artifact, artifacts, status, auto_generated, saved_workflow_id, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('saved_workflows')
      .select('id, name, prompt, deliverable_types, usage_count, last_used_at, created_from_thread_id, created_at')
      .eq('user_id', user.id)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(20),
  ]);

  return (
    <WorkPageClient
      userEmail={profile?.email || user.email}
      userFullName={profile?.full_name}
      hasCompletedOnboarding={hasCompletedIdentity}
      blueprints={blueprints}
      initialThreads={threads || []}
      initialActiveThreadId={initialThreadId || null}
      initialView={initialView || null}
      initialChatInput={initialChatInput || null}
      initialSavedWorkflows={(savedWorkflowsData as SavedWorkflow[]) || []}
    />
  );
}
