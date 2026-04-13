import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkPageClient } from '@/app/work/work-page-client';
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

  // Cleanup stale temporary threads (fire-and-forget, non-blocking)
  void supabase
    .from('work_threads')
    .delete()
    .eq('user_id', user.id)
    .eq('is_temporary', true);

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  const [{ data: threads }, { data: savedWorkflowsData }, { data: agentsData }] = await Promise.all([
    supabase
      .from('work_threads')
      .select('id, title, plan, artifact, artifacts, status, auto_generated, saved_workflow_id, is_generating, created_at, updated_at, process_id, process_step_index, agent_id, processes(title)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .or('is_temporary.eq.false,is_temporary.is.null')
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('saved_workflows')
      .select('id, name, prompt')
      .eq('user_id', user.id)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from('custom_agents')
      .select('id, name, description, color, icon, conversation_starters')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ]);

  return (
    <WorkPageClient
      userId={user.id}
      userEmail={profile?.email || user.email}
      userFullName={profile?.full_name}
      initialThreads={(threads || []).map((t: any) => ({
        ...t,
        process_title: t.processes?.title ?? null,
        processes: undefined,
      }))}
      initialActiveThreadId={initialThreadId || null}
      initialChatInput={initialChatInput || null}
      initialSavedWorkflows={savedWorkflowsData || []}
      initialAgents={agentsData || []}
      processStepContext={processStep ? { processStep, processId, stepTitle, stepDesc } : undefined}
    />
  );
}
