import { SupabaseClient } from '@supabase/supabase-js';

export async function cloneWorkflowForUser(
  supabase: SupabaseClient,
  workflowId: string,
  userId: string,
): Promise<string> {
  const { data: source, error: srcErr } = await supabase
    .from('workflows')
    .select('name, icon, color, steps, output_config')
    .eq('id', workflowId)
    .single();

  if (srcErr || !source) throw new Error('Source workflow not found');

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  const { data: clone, error: insertErr } = await supabase
    .from('workflows')
    .insert({
      user_id: userId,
      company_id: membership?.company_id ?? null,
      name: `${source.name} (copy)`,
      icon: source.icon,
      color: source.color,
      trigger: { type: 'manual' },
      steps: source.steps ?? [],
      output_config: source.output_config,
      status: 'draft',
      shared_with_company: false,
      sharing_mode: null,
    })
    .select('id')
    .single();

  if (insertErr || !clone) throw new Error(insertErr?.message ?? 'Clone failed');
  return (clone as { id: string }).id;
}

// Fork a team task into the caller's account (cross-user clone for task sharing).
// Uses admin client for the source read so shared tasks owned by teammates are accessible.
export async function forkTaskForWorker(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  sourceId: string,
  userId: string,
  agentId: string,
): Promise<string> {
  const { data: source, error: srcErr } = await adminClient
    .from('workflows')
    .select('name, description, icon, color, trigger, steps, output_config, worker_instructions, sharing_mode, company_id, user_id')
    .eq('id', sourceId)
    .single();

  if (srcErr || !source) throw new Error('Source task not found');

  // Allow fork if owned by user OR shared with their company
  const isOwn = source.user_id === userId;
  if (!isOwn) {
    if (source.sharing_mode !== 'live') throw new Error('This task is not shared with the team');
    const { data: membership } = await adminClient
      .from('company_members')
      .select('company_id')
      .eq('user_id', userId)
      .eq('company_id', source.company_id)
      .eq('status', 'active')
      .single();
    if (!membership) throw new Error('You are not in the same company as the task owner');
  }

  const { data: myMembership } = await adminClient
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  const { data: clone, error: insertErr } = await adminClient
    .from('workflows')
    .insert({
      user_id: userId,
      agent_id: agentId,
      company_id: myMembership?.company_id ?? null,
      name: source.name,
      description: source.description,
      icon: source.icon ?? 'bolt',
      color: source.color ?? 'indigo',
      trigger: source.trigger,
      steps: source.steps ?? [],
      output_config: source.output_config,
      worker_instructions: source.worker_instructions,
      status: 'paused',
      shared_with_company: false,
      sharing_mode: null,
    })
    .select('id, name')
    .single();

  if (insertErr || !clone) throw new Error(insertErr?.message ?? 'Fork failed');
  return (clone as { id: string }).id;
}
