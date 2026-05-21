import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { StudioPageClient } from '@/app/studio/studio-page-client';
import { getMyWorkspace } from '@/lib/workspace/features';

export const metadata = { title: 'Studio — AUGMTD' };

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ workflow?: string }>;
}) {
  const { workflow: initialWorkflowId } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await getMyWorkspace(user.id, supabase);
  if (!(workspace?.features.studio ?? true)) redirect('/work');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  const [{ data: workflowsData }, { data: agentsData }] = await Promise.all([
    supabase
      .from('workflows')
      .select('id, user_id, name, description, icon, color, status, trigger, steps, output_config, last_run_at, next_run_at, created_at, updated_at, shared_with_company, sharing_mode, company_id, pinned')
      .order('updated_at', { ascending: false }),
    supabase
      .from('custom_agents')
      .select('id, user_id, name, description, color, icon, conversation_starters, web_enabled, shared_with_company')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ]);

  // Resolve owner names for shared agents
  const agentRows = agentsData ?? [];
  const foreignAgentUserIds = [...new Set(agentRows.filter((a: { user_id: string }) => a.user_id !== user.id).map((a: { user_id: string }) => a.user_id))];
  const agentOwnerNames: Record<string, string> = {};
  if (foreignAgentUserIds.length > 0) {
    const { data: agentProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', foreignAgentUserIds);
    (agentProfiles ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) => {
      agentOwnerNames[p.id] = p.full_name ?? p.email?.split('@')[0] ?? 'Teammate';
    });
    const stillMissing = foreignAgentUserIds.filter(id => !agentOwnerNames[id] || agentOwnerNames[id] === 'Teammate');
    if (stillMissing.length > 0) {
      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await Promise.all(stillMissing.map(async (uid) => {
        const { data: { user: authUser } } = await admin.auth.admin.getUserById(uid);
        if (authUser?.email) agentOwnerNames[uid] = authUser.email.split('@')[0];
      }));
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrichedAgents = agentRows.map((a: any) => ({
    ...a,
    is_owned_by_me: a.user_id === user.id,
    owner_name: (a.user_id !== user.id ? (agentOwnerNames[a.user_id] ?? 'Teammate') : null) as string | null,
  }));

  // Resolve owner names for shared workflows
  const workflowRows = workflowsData ?? [];
  const foreignWorkflowUserIds = [...new Set(workflowRows.filter((w: { user_id: string }) => w.user_id !== user.id).map((w: { user_id: string }) => w.user_id))];
  const workflowOwnerNames: Record<string, string> = {};
  if (foreignWorkflowUserIds.length > 0) {
    const { data: wfProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', foreignWorkflowUserIds);
    (wfProfiles ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) => {
      workflowOwnerNames[p.id] = p.full_name ?? p.email?.split('@')[0] ?? 'Teammate';
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialWorkflows = workflowRows.map((w: any) => ({
    ...w,
    is_owned_by_me: w.user_id === user.id,
    owner_name: w.user_id !== user.id ? (workflowOwnerNames[w.user_id] ?? 'Teammate') : null,
  }));

  return (
    <StudioPageClient
      userId={user.id}
      userFullName={profile?.full_name ?? undefined}
      initialWorkflows={initialWorkflows}
      initialAgents={enrichedAgents}
      initialWorkflowId={initialWorkflowId || null}
    />
  );
}
