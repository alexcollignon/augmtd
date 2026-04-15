'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import {
  PlayIcon, PauseIcon, PencilSquareIcon,
  ClockIcon, CheckCircleIcon, XCircleIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline';
import type { Workflow, WorkflowRun } from '@/lib/workflows/types';

interface Props {
  workflow: Workflow;
  initialTab?: Tab;
  onEdit: () => void;
  onWorkflowUpdated: (w: Workflow) => void;
  onWorkflowDeleted: (id: string) => void;
}

type Tab = 'runs' | 'settings';

function RunStatusIcon({ status }: { status: WorkflowRun['status'] }) {
  if (status === 'succeeded') return <CheckCircleIcon className="w-4 h-4 text-emerald-500" />;
  if (status === 'failed' || status === 'cancelled') return <XCircleIcon className="w-4 h-4 text-red-500" />;
  if (status === 'running') return <ArrowPathIcon className="w-4 h-4 text-indigo-500 animate-spin" />;
  return <ClockIcon className="w-4 h-4 text-neutral-400" />;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function StudioDetailPanel({ workflow: initialWorkflow, initialTab = 'runs', onEdit, onWorkflowUpdated, onWorkflowDeleted }: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [running, setRunning] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Sync when a different workflow is selected (component uses key= so this rarely fires,
  // but keep it as a safety net — respect initialTab so new workflows open on settings)
  useEffect(() => {
    setWorkflow(initialWorkflow);
    setActiveTab(initialTab);
    setConfirmingDelete(false);
  }, [initialWorkflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRuns = useCallback(async (wfId: string) => {
    const res = await fetch(`/api/workflows/${wfId}/runs`);
    if (res.ok) {
      const { runs } = await res.json();
      setRuns(runs);
    }
    setRunsLoading(false);
  }, []);

  useEffect(() => {
    setRunsLoading(true);
    setRuns([]);
    fetchRuns(initialWorkflow.id);
  }, [initialWorkflow.id, fetchRuns]);

  // Poll while runs are active
  useEffect(() => {
    const anyActive = runs.some(r => r.status === 'queued' || r.status === 'running');
    if (!anyActive) return;
    const interval = setInterval(() => fetchRuns(workflow.id), 4000);
    return () => clearInterval(interval);
  }, [runs, workflow.id, fetchRuns]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/run`, { method: 'POST' });
      if (res.ok) {
        await fetchRuns(workflow.id);
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Run failed' }));
        alert(error);
      }
    } finally {
      setRunning(false);
    }
  }, [workflow.id, fetchRuns]);

  const toggleStatus = useCallback(async () => {
    setTogglingStatus(true);
    const next: Workflow['status'] =
      workflow.status === 'active' ? 'paused' :
      workflow.status === 'paused' ? 'active' : 'active';
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        const { workflow: updated } = await res.json();
        setWorkflow(updated);
        onWorkflowUpdated(updated);
      }
    } finally {
      setTogglingStatus(false);
    }
  }, [workflow, onWorkflowUpdated]);

  const handleDelete = useCallback(async () => {
    await fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE' });
    onWorkflowDeleted(workflow.id);
  }, [workflow.id, onWorkflowDeleted]);

  const stepCount = workflow.steps.length;
  const triggerLabel =
    workflow.trigger.type === 'schedule'
      ? (workflow.trigger.label ?? workflow.trigger.cron)
      : 'Manual trigger only';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="px-6 pt-5 pb-0 border-b border-neutral-100 flex-shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-neutral-900 truncate">{workflow.name}</h2>
            {workflow.description && (
              <p className="text-[12.5px] text-neutral-500 mt-0.5">{workflow.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-[11.5px] text-neutral-500">
              <span className={`font-medium capitalize ${workflow.status === 'active' ? 'text-emerald-600' : workflow.status === 'paused' ? 'text-amber-600' : 'text-neutral-400'}`}>
                {workflow.status}
              </span>
              <span>{triggerLabel}</span>
              {workflow.last_run_at && <span>Last run {fmtTime(workflow.last_run_at)}</span>}
              {workflow.next_run_at && workflow.status === 'active' && (
                <span className="text-emerald-600">Next {fmtTime(workflow.next_run_at)}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <button
              onClick={runNow}
              disabled={running || stepCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[12px] font-medium rounded-md transition-colors disabled:opacity-50"
            >
              <PlayIcon className="w-3.5 h-3.5" />
              {running ? 'Starting…' : 'Run now'}
            </button>
            <button
              onClick={toggleStatus}
              disabled={togglingStatus || stepCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12px] font-medium rounded-md transition-colors disabled:opacity-50"
            >
              {workflow.status === 'active' ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
              {workflow.status === 'active' ? 'Pause' : 'Activate'}
            </button>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12px] font-medium rounded-md transition-colors"
            >
              <PencilSquareIcon className="w-3.5 h-3.5" />
              Edit
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {(['runs', 'settings'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-[12.5px] font-medium capitalize border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-neutral-900 border-neutral-900'
                  : 'text-neutral-500 border-transparent hover:text-neutral-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'runs' && (
          runsLoading ? (
            <div className="flex items-center justify-center h-24">
              <div className="w-5 h-5 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12">
              <ClockIcon className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
              <p className="text-[13px] font-medium text-neutral-600">No runs yet</p>
              <p className="text-[12px] text-neutral-400 mt-0.5">
                Click &ldquo;Run now&rdquo; to trigger manually, or activate the workflow.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map(run => <RunCard key={run.id} run={run} />)}
            </div>
          )
        )}

        {activeTab === 'settings' && (
          <div className="max-w-lg space-y-5">
            <dl className="text-[12.5px] border border-neutral-150 rounded-lg overflow-hidden divide-y divide-neutral-100">
              <Row label="Status"><span className="capitalize">{workflow.status}</span></Row>
              <Row label="Trigger">
                {workflow.trigger.type === 'schedule'
                  ? `${workflow.trigger.label ?? workflow.trigger.cron}${workflow.trigger.timezone ? ` (${workflow.trigger.timezone})` : ''}`
                  : 'Manual only'}
              </Row>
              <Row label="Steps">{stepCount}</Row>
              <Row label="Output">{workflow.output_config.destination}</Row>
            </dl>

            <div className="border border-red-200 rounded-lg p-4 bg-red-50/40">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12.5px] font-medium text-red-900">Delete workflow</div>
                  <div className="text-[11.5px] text-red-700 mt-0.5">Removes this workflow and all its runs.</div>
                </div>
                {confirmingDelete ? (
                  <div className="flex gap-2">
                    <button onClick={handleDelete} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[12px] font-medium rounded-md">
                      Confirm
                    </button>
                    <button onClick={() => setConfirmingDelete(false)} className="px-3 py-1.5 border border-neutral-200 text-neutral-700 text-[12px] font-medium rounded-md hover:bg-neutral-50">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmingDelete(true)} className="px-3 py-1.5 border border-red-300 text-red-700 text-[12px] font-medium rounded-md hover:bg-red-50">
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RunCard({ run }: { run: WorkflowRun }) {
  const [expanded, setExpanded] = useState(false);
  const duration = run.started_at && run.completed_at
    ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
    : null;

  return (
    <div className="border border-neutral-150 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors text-left"
      >
        <RunStatusIcon status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-neutral-900 capitalize">
            {run.triggered_by} run — {run.status}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {fmtTime(run.started_at)}
            {duration !== null ? ` · ${duration}s` : ''}
          </div>
        </div>
        {run.thread_id && (
          <Link
            href={`/work?thread=${run.thread_id}`}
            onClick={e => e.stopPropagation()}
            className="text-[11.5px] text-indigo-600 hover:text-indigo-700 flex-shrink-0"
          >
            Open thread →
          </Link>
        )}
      </button>

      {expanded && (
        <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50/50 space-y-2">
          {run.error && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {run.error}
            </div>
          )}
          {(run.step_outputs ?? []).map((s, i) => (
            <div key={i} className="border border-neutral-150 rounded bg-white p-3">
              <div className="text-[10.5px] uppercase tracking-wide text-neutral-400 font-semibold mb-1">
                Step {i + 1} — {s.step_type}
              </div>
              <div className="text-[12px] font-medium text-neutral-800 mb-1">{s.label}</div>
              {s.error ? (
                <div className="text-[11.5px] text-red-700">{s.error}</div>
              ) : (
                <pre className="text-[11px] text-neutral-600 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
                  {typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex px-4 py-2.5 bg-white">
      <dt className="w-24 text-neutral-500">{label}</dt>
      <dd className="flex-1 text-neutral-900">{children}</dd>
    </div>
  );
}
