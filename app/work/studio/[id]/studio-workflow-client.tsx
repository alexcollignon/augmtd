'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  PlayIcon,
  PauseIcon,
  ArrowLeftIcon,
  PencilSquareIcon,
  TrashIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import type { Workflow, WorkflowRun } from '@/lib/workflows/types';

interface Props {
  userId: string;
  workflow: Workflow;
  initialRuns: WorkflowRun[];
}

type Tab = 'runs' | 'artifacts' | 'settings';

function RunStatusIcon({ status }: { status: WorkflowRun['status'] }) {
  if (status === 'succeeded') return <CheckCircleIcon className="w-4 h-4 text-emerald-500" />;
  if (status === 'failed' || status === 'cancelled') return <XCircleIcon className="w-4 h-4 text-red-500" />;
  if (status === 'running') return <ArrowPathIcon className="w-4 h-4 text-indigo-500 animate-spin" />;
  return <ClockIcon className="w-4 h-4 text-neutral-400" />;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function StudioWorkflowClient({ workflow: initialWorkflow, initialRuns }: Props) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [runs, setRuns] = useState<WorkflowRun[]>(initialRuns);
  const [activeTab, setActiveTab] = useState<Tab>('runs');
  const [running, setRunning] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const refreshRuns = useCallback(async () => {
    const res = await fetch(`/api/workflows/${workflow.id}/runs`);
    if (res.ok) {
      const { runs } = await res.json();
      setRuns(runs);
    }
  }, [workflow.id]);

  // Poll runs every 4s if any are queued/running
  useEffect(() => {
    const anyActive = runs.some(r => r.status === 'queued' || r.status === 'running');
    if (!anyActive) return;
    const interval = setInterval(refreshRuns, 4000);
    return () => clearInterval(interval);
  }, [runs, refreshRuns]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/run`, { method: 'POST' });
      if (res.ok) {
        await refreshRuns();
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Run failed' }));
        alert(error);
      }
    } finally {
      setRunning(false);
    }
  }, [workflow.id, refreshRuns]);

  const toggleStatus = useCallback(async () => {
    setTogglingStatus(true);
    const next: Workflow['status'] =
      workflow.status === 'active' ? 'paused' :
      workflow.status === 'paused' ? 'active' :
                                     'active';
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        const { workflow: updated } = await res.json();
        setWorkflow(updated);
      }
    } finally {
      setTogglingStatus(false);
    }
  }, [workflow]);

  const handleDelete = useCallback(async () => {
    const res = await fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/work?section=studio');
  }, [workflow.id, router]);

  const triggerLabel = workflow.trigger?.type === 'schedule'
    ? (('label' in workflow.trigger && workflow.trigger.label) || ('cron' in workflow.trigger ? workflow.trigger.cron : 'Scheduled'))
    : 'Manual trigger only';

  const stepCount = Array.isArray(workflow.steps) ? workflow.steps.length : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="px-8 py-5 border-b border-neutral-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <Link
            href="/work?section=studio"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            All workflows
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={runNow}
              disabled={running || stepCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[12.5px] font-medium rounded-md transition-colors disabled:opacity-50"
            >
              <PlayIcon className="w-3.5 h-3.5" />
              {running ? 'Starting…' : 'Run now'}
            </button>
            <button
              onClick={toggleStatus}
              disabled={togglingStatus || stepCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12.5px] font-medium rounded-md transition-colors disabled:opacity-50"
            >
              {workflow.status === 'active' ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
              {workflow.status === 'active' ? 'Pause' : 'Activate'}
            </button>
            <Link
              href={`/work/studio/${workflow.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12.5px] font-medium rounded-md transition-colors"
            >
              <PencilSquareIcon className="w-3.5 h-3.5" />
              Edit
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-8 h-8 bg-indigo-50 rounded-lg">
            <SparklesIcon className="w-4 h-4 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-neutral-900">{workflow.name}</h1>
            {workflow.description && (
              <p className="text-[12.5px] text-neutral-500">{workflow.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6 mt-3 text-[12px] text-neutral-500">
          <span>Status: <strong className="text-neutral-700 capitalize">{workflow.status}</strong></span>
          <span>Trigger: <strong className="text-neutral-700">{triggerLabel}</strong></span>
          <span>Last run: <strong className="text-neutral-700">{formatTime(workflow.last_run_at)}</strong></span>
          {workflow.next_run_at && workflow.status === 'active' && (
            <span>Next run: <strong className="text-neutral-700">{formatTime(workflow.next_run_at)}</strong></span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-5 -mb-5 border-b border-transparent">
          {(['runs', 'artifacts', 'settings'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-[13px] font-medium capitalize border-b-2 transition-colors ${
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
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === 'runs' && <RunsPane runs={runs} />}
        {activeTab === 'artifacts' && <ArtifactsPane runs={runs} />}
        {activeTab === 'settings' && (
          <SettingsPane
            workflow={workflow}
            confirmingDelete={confirmingDelete}
            setConfirmingDelete={setConfirmingDelete}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

function RunsPane({ runs }: { runs: WorkflowRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <ClockIcon className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
        <h3 className="text-[15px] font-semibold text-neutral-700">No runs yet</h3>
        <p className="text-[13px] text-neutral-500 mt-1">
          Click &ldquo;Run now&rdquo; to trigger this workflow manually, or activate it to run on schedule.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-3">
      {runs.map(run => <RunCard key={run.id} run={run} />)}
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
          <div className="text-[13px] font-medium text-neutral-900 capitalize">
            {run.triggered_by} run — {run.status}
          </div>
          <div className="text-[11.5px] text-neutral-500 mt-0.5">
            Started {formatTime(run.started_at)}
            {duration !== null ? ` · ${duration}s` : ''}
            {run.thread_id ? ` · thread opened` : ''}
          </div>
        </div>
        {run.thread_id && (
          <Link
            href={`/work?thread=${run.thread_id}`}
            onClick={e => e.stopPropagation()}
            className="text-[12px] text-indigo-600 hover:text-indigo-700"
          >
            Open thread →
          </Link>
        )}
      </button>

      {expanded && (
        <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50/50">
          {run.error && (
            <div className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
              {run.error}
            </div>
          )}
          <div className="space-y-2">
            {(run.step_outputs ?? []).map((s, i) => (
              <div key={i} className="border border-neutral-150 rounded bg-white p-3">
                <div className="text-[11px] uppercase tracking-wide text-neutral-400 font-semibold mb-1">
                  Step {i + 1} — {s.step_type}
                </div>
                <div className="text-[12.5px] font-medium text-neutral-800 mb-1">{s.label}</div>
                {s.error ? (
                  <div className="text-[12px] text-red-700">{s.error}</div>
                ) : (
                  <pre className="text-[11.5px] text-neutral-600 whitespace-pre-wrap font-sans max-h-60 overflow-y-auto">
                    {typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactsPane({ runs }: { runs: WorkflowRun[] }) {
  const threads = runs.filter(r => r.thread_id).map(r => r.thread_id);
  if (threads.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <h3 className="text-[15px] font-semibold text-neutral-700">No artifacts yet</h3>
        <p className="text-[13px] text-neutral-500 mt-1">
          Artifacts appear here once runs complete with document output.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <p className="text-[13px] text-neutral-500 mb-4">
        Open each run&apos;s thread to view its artifacts inline.
      </p>
      <div className="space-y-2">
        {runs.filter(r => r.thread_id).map(run => (
          <Link
            key={run.id}
            href={`/work?thread=${run.thread_id}`}
            className="block border border-neutral-150 rounded-lg px-4 py-3 hover:bg-neutral-50 transition-colors"
          >
            <div className="text-[13px] font-medium text-neutral-900">Run — {formatTime(run.started_at)}</div>
            <div className="text-[11.5px] text-neutral-500">Open to view artifact →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SettingsPane({
  workflow, confirmingDelete, setConfirmingDelete, onDelete,
}: {
  workflow: Workflow;
  confirmingDelete: boolean;
  setConfirmingDelete: (v: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="max-w-2xl space-y-6">
      <section>
        <h3 className="text-[14px] font-semibold text-neutral-900 mb-2">Details</h3>
        <dl className="text-[13px] border border-neutral-150 rounded-lg overflow-hidden divide-y divide-neutral-100">
          <Row label="Name">{workflow.name}</Row>
          <Row label="Description">{workflow.description || '—'}</Row>
          <Row label="Status"><span className="capitalize">{workflow.status}</span></Row>
          <Row label="Trigger">
            {workflow.trigger?.type === 'schedule'
              ? `Schedule (${('cron' in workflow.trigger ? workflow.trigger.cron : '')}${('timezone' in workflow.trigger && workflow.trigger.timezone ? ', ' + workflow.trigger.timezone : '')})`
              : 'Manual only'}
          </Row>
          <Row label="Steps">{Array.isArray(workflow.steps) ? workflow.steps.length : 0}</Row>
          <Row label="Output">{workflow.output_config?.destination ?? 'thread_message'}</Row>
        </dl>
      </section>

      <section>
        <h3 className="text-[14px] font-semibold text-red-700 mb-2">Danger zone</h3>
        <div className="border border-red-200 rounded-lg p-4 bg-red-50/40">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium text-red-900">Delete workflow</div>
              <div className="text-[12px] text-red-700 mt-0.5">
                Removes the workflow and all its runs, artifacts, and notifications.
              </div>
            </div>
            {confirmingDelete ? (
              <div className="flex gap-2">
                <button
                  onClick={onDelete}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[12px] font-medium rounded-md"
                >
                  Confirm delete
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-3 py-1.5 border border-neutral-200 text-neutral-700 text-[12px] font-medium rounded-md hover:bg-neutral-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-700 text-[12px] font-medium rounded-md hover:bg-red-50"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex px-4 py-2.5 bg-white">
      <dt className="w-32 text-neutral-500 text-[12.5px]">{label}</dt>
      <dd className="flex-1 text-neutral-900 text-[12.5px]">{children}</dd>
    </div>
  );
}
