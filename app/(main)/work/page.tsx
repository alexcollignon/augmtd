import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkPageClient } from '@/app/work/work-page-client';
import { getMyWorkspace } from '@/lib/workspace/features';
export const metadata = { title: 'Chat — AUGMTD' };

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; prompt?: string; section?: string; workflow?: string; agent?: string }>;
}) {
  const { thread: initialThreadId, prompt: initialChatInput, section, workflow: initialWorkflowId, agent: initialAgentId } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await getMyWorkspace(user.id, supabase);
  const studioEnabled = workspace?.features.studio ?? true;
  const initialSection = (section === 'studio' && studioEnabled) ? 'studio' : 'chat';

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

  const THREAD_COLS = 'id, title, plan, artifact, artifacts, status, auto_generated, saved_workflow_id, is_generating, created_at, updated_at, agent_id, workflow_id';

  const [{ data: threads }, { data: savedWorkflowsData }, { data: agentsData }, initialThreadResult] = await Promise.all([
    supabase
      .from('work_threads')
      .select(THREAD_COLS)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .or('is_temporary.eq.false,is_temporary.is.null')
      .is('workflow_id', null)
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
      .select('id, user_id, name, description, color, icon, conversation_starters, web_enabled, shared_with_company')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    // If opening a specific thread (e.g. workflow run thread), fetch it directly
    // — it won't appear in the main query which excludes workflow_id threads.
    initialThreadId
      ? supabase
          .from('work_threads')
          .select(THREAD_COLS)
          .eq('id', initialThreadId)
          .eq('user_id', user.id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  // Resolve owner names for shared agents owned by others
  const agentRows = agentsData ?? [];
  const foreignAgentUserIds = [...new Set(agentRows.filter((a: { user_id: string }) => a.user_id !== user.id).map((a: { user_id: string }) => a.user_id))];
  const agentOwnerNames: Record<string, string> = {};
  if (foreignAgentUserIds.length > 0) {
    const { data: agentProfiles } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .in('user_id', foreignAgentUserIds);
    (agentProfiles ?? []).forEach((p: { user_id: string; full_name: string | null }) => {
      agentOwnerNames[p.user_id] = p.full_name ?? 'Teammate';
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrichedAgents = agentRows.map((a: any) => ({
    ...a,
    is_owned_by_me: a.user_id === user.id,
    owner_name: (a.user_id !== user.id ? (agentOwnerNames[a.user_id] ?? 'Teammate') : null) as string | null,
  }));

  // Merge the directly-fetched thread (e.g. a workflow run thread) into the list
  // if it isn't already there (workflow run threads are excluded from the main query).
  const baseThreads = threads ?? [];
  const extraThread = initialThreadResult?.data ?? null;
  const mergedThreads = extraThread && !baseThreads.find(t => t.id === extraThread.id)
    ? [extraThread, ...baseThreads]
    : baseThreads;

  return (
    <WorkPageClient
      userId={user.id}
      userEmail={profile?.email || user.email}
      userFullName={profile?.full_name}
      initialThreads={mergedThreads}
      initialActiveThreadId={initialThreadId || null}
      initialChatInput={initialChatInput || null}
      initialSavedWorkflows={savedWorkflowsData || []}
      initialAgents={enrichedAgents}
      initialSection={initialSection}
      initialWorkflowId={initialWorkflowId || null}
      initialAgentId={initialAgentId || null}
    />
  );
}
