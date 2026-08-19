import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { WorkflowDetail } from '@/components/workflows/workflow-detail';
import { describeCron } from '@/lib/workflows/schedule';
import type { WorkflowStep, WorkflowTrigger } from '@/lib/workflows/types';

// ── THE WORKFLOW DEEP-DIVE (processes plan A3) — one workflow's own home: what its runs are
// doing now (Work), when they ran (Timeline), and what they left behind (History). A SCOPED
// PROJECTION of the deck's truth — every state word comes from the ONE derivation
// (`lib/workflows/process-state`), never recomputed here. Studio stays the method editor
// (the pencil); this page is the record.

export const metadata = { title: 'Workflow — AUGMTD' };

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await guardFeaturePage('studio');
  const { id } = await params;

  // The user's own client — RLS decides what this account may read.
  const supabase = await createClient();
  const { data: wf } = await supabase
    .from('workflows')
    .select('id, name, description, status, trigger, steps, output_config, agent_id, next_run_at, auto_paused_at')
    .eq('id', id)
    .maybeSingle();

  if (!wf) redirect('/home?view=workflows');

  const row = wf as {
    id: string; name: string; description: string | null; status: string;
    trigger: WorkflowTrigger | null; steps: WorkflowStep[] | null;
    agent_id: string | null; next_run_at: string | null; auto_paused_at: string | null;
  };

  // The PRESENTER coworker (never the owner — a workflow is system-owned).
  let workerName: string | null = null;
  if (row.agent_id) {
    const { data: agent } = await supabase
      .from('custom_agents').select('name').eq('id', row.agent_id).maybeSingle();
    workerName = (agent as { name: string } | null)?.name ?? null;
  }

  const trig = row.trigger as { type?: string; label?: string; cron?: string; timezone?: string; when?: string } | null;
  const scheduleLabel =
    trig?.type === 'schedule'
      ? (trig.label ?? (trig.cron ? describeCron(trig.cron, trig.timezone) : null))
      : trig?.type === 'reaction'
        ? (trig.label ?? (trig.when ? `When ${trig.when}` : 'On event'))
        : 'On demand';

  return (
    <WorkflowDetail
      workflowId={row.id}
      name={row.name}
      description={row.description}
      status={row.status}
      scheduleLabel={scheduleLabel}
      stepCount={(row.steps ?? []).length}
      workerName={workerName}
      nextRunAt={row.next_run_at}
      autoPaused={!!row.auto_paused_at}
    />
  );
}
