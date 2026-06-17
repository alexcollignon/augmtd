'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { StudioBuilder } from '@/components/work/studio-builder';
import type { Workflow } from '@/lib/workflows/types';
import type { SidebarAgent } from '@/components/agents/agents-sidebar-section';

interface StudioPageClientProps {
  userId?: string;
  userFullName?: string;
  initialWorkflowId?: string | null;
  initialAgents?: SidebarAgent[];
  initialWorkflows?: Workflow[];
  assignWorkerId?: string | null;
}

// The Studio overview/grid was removed — tasks are managed from each worker's
// Tasks tab. This page is now solely the pipeline builder, reached from a task
// ("edit steps", ?workflow=) or when creating a blank pipeline for a worker
// (?assign_worker=). Bare /studio has no purpose → redirect to /workers.
export function StudioPageClient({
  initialWorkflowId = null,
  initialAgents = [],
  initialWorkflows = [],
  assignWorkerId = null,
}: StudioPageClientProps) {
  const router = useRouter();

  const [workflow, setWorkflow] = useState<Workflow | null>(
    initialWorkflowId ? (initialWorkflows.find(w => w.id === initialWorkflowId) ?? null) : null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Edit an existing task's pipeline.
      if (initialWorkflowId) {
        if (!workflow) {
          const res = await fetch('/api/workflows');
          if (res.ok && !cancelled) {
            const data = await res.json();
            const found = (data.workflows as Workflow[] | undefined)?.find(w => w.id === initialWorkflowId) ?? null;
            setWorkflow(found);
          }
        }
        if (!cancelled) setLoading(false);
        return;
      }

      // Create a blank pipeline for a worker (from the Tasks tab).
      if (assignWorkerId) {
        const res = await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Untitled routine', agent_id: assignWorkerId }),
        });
        if (res.ok && !cancelled) {
          const { workflow: created } = await res.json();
          setWorkflow(created);
          setLoading(false);
        }
        return;
      }

      // No target — the overview is gone; nothing to show here.
      router.replace('/workers');
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => router.push('/workers');

  // Backing out of a freshly-created, never-edited blank pipeline removes it so
  // it doesn't litter the worker's task list.
  const back = () => {
    if (workflow && workflow.name === 'Untitled routine' && (!workflow.steps || workflow.steps.length === 0) && !workflow.description) {
      fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE' }).catch(() => {});
    }
    router.push('/workers');
  };

  if (loading || !workflow) {
    return (
      <div className="flex flex-1 items-center justify-center bg-neutral-50">
        <div className="w-5 h-5 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50">
      <div className="flex-1 min-w-0 flex flex-col bg-neutral-50 p-2 overflow-hidden">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          <StudioBuilder
            workflow={workflow}
            agents={initialAgents}
            onClose={close}
            onBack={back}
          />
        </div>
      </div>
    </div>
  );
}
