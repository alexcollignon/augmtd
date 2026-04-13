import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AgentForm } from '@/components/agents/agent-form';

export const metadata = { title: 'New Agent — AUGMTD' };

export default async function NewAgentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-neutral-50 overflow-hidden">
      <AgentForm mode="create" />
    </div>
  );
}
