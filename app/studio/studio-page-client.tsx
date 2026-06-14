'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/components/work/studio-empty-state';
import { StudioHomeGrid } from '@/components/work/studio-home-grid';
import { StudioDetailPanel } from '@/components/work/studio-detail-panel';
import { StudioBuilder } from '@/components/work/studio-builder';
import type { Workflow, WorkflowRun } from '@/lib/workflows/types';
import type { SidebarAgent } from '@/components/agents/agents-sidebar-section';

interface StudioPageClientProps {
  userId?: string;
  userFullName?: string;
  initialWorkflowId?: string | null;
  initialAgents?: SidebarAgent[];
  initialWorkflows?: Workflow[];
  assignWorkerId?: string | null;
}

export function StudioPageClient({
  userId: _userId,
  userFullName,
  initialWorkflowId = null,
  initialAgents = [],
  initialWorkflows = [],
  assignWorkerId = null,
}: StudioPageClientProps) {
  const router = useRouter();

  const [studioWorkflows, setStudioWorkflows] = useState<Workflow[] | null>(
    initialWorkflows.length > 0 ? initialWorkflows : null
  );
  const [studioLoading, setStudioLoading] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(initialWorkflowId);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const runsCacheRef = useRef<Map<string, WorkflowRun[]>>(new Map());
  const runsInflightRef = useRef<Set<string>>(new Set());

  function prefetchRuns(id: string) {
    if (runsCacheRef.current.has(id) || runsInflightRef.current.has(id)) return;
    runsInflightRef.current.add(id);
    fetch(`/api/workflows/${id}/runs`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        runsCacheRef.current.set(id, data?.runs ?? []);
        runsInflightRef.current.delete(id);
      })
      .catch(() => runsInflightRef.current.delete(id));
  }

  useEffect(() => {
    if (!studioWorkflows) return;
    studioWorkflows.slice(0, 8).forEach(w => prefetchRuns(w.id));
  }, [studioWorkflows?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load workflows if not hydrated from SSR
  useEffect(() => {
    if (studioWorkflows === null && !studioLoading) {
      setStudioLoading(true);
      fetchStudioWorkflows(initialWorkflowId ?? undefined).finally(() => setStudioLoading(false));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedWorkflow = studioWorkflows?.find(w => w.id === selectedWorkflowId) ?? null;
  const isBuilding = !!editingWorkflowId && editingWorkflowId === selectedWorkflow?.id;

  async function fetchStudioWorkflows(selectId?: string) {
    const res = await fetch('/api/workflows');
    if (res.ok) {
      const data = await res.json();
      setStudioWorkflows(data.workflows ?? []);
      if (selectId) setSelectedWorkflowId(selectId);
    }
  }

  async function handleCreateWorkflow() {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Untitled routine',
        ...(assignWorkerId ? { agent_id: assignWorkerId } : {}),
      }),
    });
    if (res.ok) {
      const { workflow } = await res.json();
      setStudioWorkflows(prev => prev ? [workflow, ...prev] : [workflow]);
      setSelectedWorkflowId(workflow.id);
      setEditingWorkflowId(workflow.id);
    }
  }

  async function handleUseTemplate(template: WorkflowTemplate) {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: template.workflow.name,
        description: template.workflow.description,
        trigger: template.workflow.trigger,
        steps: template.workflow.steps,
        output_config: template.workflow.output_config,
        status: template.workflow.status,
      }),
    });
    if (res.ok) {
      const { workflow } = await res.json();
      setStudioWorkflows(prev => prev ? [workflow, ...prev] : [workflow]);
      setSelectedWorkflowId(workflow.id);
      setEditingWorkflowId(workflow.id);
    }
  }

  async function handleGenerateWorkflow(description: string) {
    const res = await fetch('/api/workflows/generate-from-description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) throw new Error('Generation failed');
    const { workflow: generated } = await res.json();
    await handleUseTemplate({ workflow: generated } as WorkflowTemplate);
  }

  async function handleRenameWorkflow(id: string, name: string) {
    setStudioWorkflows(prev => prev?.map(w => w.id === id ? { ...w, name } : w) ?? null);
    await fetch(`/api/workflows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  async function handleDeleteWorkflow(id: string) {
    setStudioWorkflows(prev => prev?.filter(w => w.id !== id) ?? null);
    if (selectedWorkflowId === id) setSelectedWorkflowId(null);
    await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
  }

  async function handleShareWorkflow(id: string, mode: string | null) {
    setStudioWorkflows(prev =>
      prev?.map(w => w.id === id ? { ...w, sharing_mode: mode as any } : w) ?? null
    );
    await fetch(`/api/workflows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharing_mode: mode }),
    });
  }

  async function handlePinWorkflow(id: string, pinned: boolean) {
    setStudioWorkflows(prev =>
      prev?.map(w => w.id === id ? { ...w, pinned } : w) ?? null
    );
    await fetch(`/api/workflows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    });
  }

  async function handleCloneWorkflow(id: string) {
    const res = await fetch(`/api/workflows/${id}/clone`, { method: 'POST' });
    if (!res.ok) return;
    const { workflow_id } = await res.json();
    const listRes = await fetch('/api/workflows');
    if (listRes.ok) {
      const { workflows } = await listRes.json();
      setStudioWorkflows(workflows);
    }
    setSelectedWorkflowId(workflow_id);
  }

  function handleWorkflowUpdated(updated: Workflow) {
    setStudioWorkflows(prev => prev?.map(w => w.id === updated.id ? updated : w) ?? null);
  }

  function handleOpenWorkflowThread(threadId: string) {
    router.push(`/work?thread=${threadId}`);
  }

  function handleOpenWorkflowArtifact(threadId: string, artifactId: string) {
    router.push(`/work?thread=${threadId}&artifact=${artifactId}`);
  }

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50">

      {/* Full-width main content */}
      <div className="flex-1 min-w-0 flex flex-col bg-neutral-50 p-2 overflow-hidden">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {isBuilding && selectedWorkflow ? (
            <StudioBuilder
              key={editingWorkflowId}
              workflow={selectedWorkflow}
              agents={initialAgents}
              onClose={(updated) => { handleWorkflowUpdated(updated); setEditingWorkflowId(null); }}
              onBack={() => {
                const w = selectedWorkflow;
                if (w && w.name === 'Untitled workflow' && (!w.steps || w.steps.length === 0) && !w.description) {
                  handleDeleteWorkflow(w.id);
                  setSelectedWorkflowId(null);
                }
                setEditingWorkflowId(null);
              }}
            />
          ) : selectedWorkflow ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-shrink-0 px-6 pt-4 pb-0">
                <button
                  onClick={() => setSelectedWorkflowId(null)}
                  className="inline-flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-700 transition-colors"
                >
                  <ArrowLeftIcon className="w-3 h-3" />
                  Studio
                </button>
              </div>
              <StudioDetailPanel
                key={selectedWorkflow.id}
                workflow={selectedWorkflow}
                initialRuns={runsCacheRef.current.get(selectedWorkflow.id)}
                onEdit={() => setEditingWorkflowId(selectedWorkflow.id)}
                onWorkflowUpdated={handleWorkflowUpdated}
                onWorkflowDeleted={handleDeleteWorkflow}
                onOpenThread={handleOpenWorkflowThread}
                onOpenArtifact={handleOpenWorkflowArtifact}
                onClone={handleCloneWorkflow}
              />
            </div>
          ) : studioLoading || studioWorkflows === null ? (
            <div className="flex items-center justify-center flex-1">
              <div className="w-5 h-5 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : (
            <StudioHomeGrid
              myWorkflows={(studioWorkflows ?? []).filter(w => w.is_owned_by_me !== false)}
              teamWorkflows={(studioWorkflows ?? []).filter(w => w.is_owned_by_me === false)}
              userFirstName={userFullName?.split(' ')[0]}
              onSelect={(id) => { setSelectedWorkflowId(id); setEditingWorkflowId(null); }}
              onCreate={handleCreateWorkflow}
              onUseTemplate={handleUseTemplate}
              onGenerateFromDescription={handleGenerateWorkflow}
              onPinWorkflow={handlePinWorkflow}
              onEditWorkflow={(id) => { setSelectedWorkflowId(id); setEditingWorkflowId(id); }}
              onDeleteWorkflow={handleDeleteWorkflow}
              onShareWorkflow={handleShareWorkflow}
            />
          )}
        </div>
      </div>

    </div>
  );
}
