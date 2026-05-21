import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { StudioWorkflowClient } from '@/app/work/studio/[id]/studio-workflow-client';

export const dynamic = 'force-dynamic';

export default async function StudioWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: workflow }, { data: runs }] = await Promise.all([
    supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('workflow_runs')
      .select('id, workflow_id, user_id, status, triggered_by, thread_id, step_outputs, error, started_at, completed_at, created_at')
      .eq('workflow_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  if (!workflow) notFound();

  void supabase
    .from('workflow_notifications')
    .update({ seen: true })
    .eq('user_id', user.id)
    .eq('workflow_id', id)
    .eq('seen', false);

  return (
    <StudioWorkflowClient
      userId={user.id}
      workflow={workflow}
      initialRuns={runs ?? []}
    />
  );
}
