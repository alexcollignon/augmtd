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
