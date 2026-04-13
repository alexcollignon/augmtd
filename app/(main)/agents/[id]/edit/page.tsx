import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AgentForm } from '@/components/agents/agent-form';

export const metadata = { title: 'Edit Agent — AUGMTD' };

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: agent } = await supabase
    .from('custom_agents')
    .select(`
      id, name, description, instructions, memory_text, color, icon, conversation_starters,
      agent_knowledge_sources (id, name, knowledge_file_id)
    `)
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!agent) redirect('/work');

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-neutral-50 overflow-hidden">
      <AgentForm
        mode="edit"
        initial={{
          id: agent.id,
          name: agent.name,
          description: agent.description ?? '',
          instructions: agent.instructions ?? '',
          memory_text: agent.memory_text ?? '',
          color: agent.color,
          icon: agent.icon,
          sources: (agent.agent_knowledge_sources ?? []) as any,
          conversation_starters: (agent as any).conversation_starters ?? null,
        }}
      />
    </div>
  );
}
