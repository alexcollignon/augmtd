import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkPageClient } from './work-page-client';
import { getUserIdentity } from '@/lib/context/work-patterns-service';

export const metadata = { title: 'Chat — AUGMTD' };

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; prompt?: string; processStep?: string; processId?: string; stepTitle?: string; stepDesc?: string }>;
}) {
  const { thread: initialThreadId, prompt: initialChatInput, processStep, processId, stepTitle, stepDesc } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  const identity = await getUserIdentity(user.id, supabase);
  const hasCompletedIdentity = !!(
    profile?.full_name &&
    identity?.department &&
    identity?.jobRole
  );

  const [{ data: threads }, { data: savedWorkflowsData }] = await Promise.all([
    supabase
      .from('work_threads')
      .select('id, title, plan, artifact, artifacts, status, auto_generated, saved_workflow_id, is_generating, created_at, updated_at, process_id, process_step_index, processes(title)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('saved_workflows')
      .select('id, name, prompt')
      .eq('user_id', user.id)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(10),
  ]);

  return (
    <WorkPageClient
      userEmail={profile?.email || user.email}
      userFullName={profile?.full_name}
      hasCompletedOnboarding={hasCompletedIdentity}
      initialThreads={(threads || []).map((t: any) => ({
        ...t,
        process_title: t.processes?.title ?? null,
        processes: undefined,
      }))}
      initialActiveThreadId={initialThreadId || null}
      initialChatInput={initialChatInput || null}
      initialSavedWorkflows={savedWorkflowsData || []}
      processStepContext={processStep ? { processStep, processId, stepTitle, stepDesc } : undefined}
    />
  );
}
