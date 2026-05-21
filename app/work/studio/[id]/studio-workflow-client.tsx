'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
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
  WrenchScrewdriverIcon,
  UserCircleIcon,
  BoltIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  NewspaperIcon,
  GlobeAltIcon,
  EnvelopeIcon,
  MegaphoneIcon,
  BuildingOfficeIcon,
  Cog6ToothIcon,
  EllipsisVerticalIcon,
  DocumentArrowDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import type { Workflow, WorkflowRun, WorkflowStep } from '@/lib/workflows/types';
import { describeCron } from '@/lib/workflows/schedule';

interface Props {
  userId: string;
  workflow: Workflow;
  initialRuns: WorkflowRun[];
}

type Tab = 'overview' | 'history' | 'documents' | 'settings';

const STEP_TYPE_COLORS = {
  tool:  { bg: 'bg-blue-500',    light: 'bg-blue-50',    text: 'text-blue-700' },
  ai:    { bg: 'bg-violet-500',  light: 'bg-violet-50',  text: 'text-violet-700' },
  agent: { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-700' },
};

const STEP_TYPE_ICONS = {
  tool:  WrenchScrewdriverIcon,
  ai:    SparklesIcon,
  agent: UserCircleIcon,
};

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  get_urgent_emails: EnvelopeIcon,
  get_calendar:      CalendarDaysIcon,
  read_kb_file:      DocumentTextIcon,
  web_search:        MagnifyingGlassIcon,
  fetch_url:         GlobeAltIcon,
  browser_fetch:     GlobeAltIcon,
  rss_feed:          NewspaperIcon,
  linkedin_post:     MegaphoneIcon,
  get_pt_tenders:    BuildingOfficeIcon,
};

const WORKFLOW_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  bolt: BoltIcon, clock: ClockIcon, envelope: EnvelopeIcon,
  'calendar-days': CalendarDaysIcon, 'document-text': DocumentTextIcon,
  'magnifying-glass': MagnifyingGlassIcon, 'arrow-path': ArrowPathIcon,
  newspaper: NewspaperIcon, 'globe-alt': GlobeAltIcon, megaphone: MegaphoneIcon,
  sparkles: SparklesIcon,
};

const WORKFLOW_COLOR_MAP: Record<string, string> = {
  indigo: 'bg-indigo-500', violet: 'bg-violet-500', blue: 'bg-blue-500',
  emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', neutral: 'bg-neutral-500',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function groupByDate(runs: WorkflowRun[]): Array<{ label: string; runs: WorkflowRun[] }> {
  const groups: Record<string, WorkflowRun[]> = {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  for (const run of runs) {
    const d = new Date(run.created_at); d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = 'Today';
    else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(run);
  }
  return Object.entries(groups).map(([label, runs]) => ({ label, runs }));
}

function humanTrigger(t: WorkflowRun['triggered_by']): string {
  if (t === 'schedule') return 'Scheduled';
  if (t === 'manual') return 'Manual';
  return t;
}

function RunStatusPill({ status }: { status: WorkflowRun['status'] }) {
  if (status === 'succeeded') return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
      <CheckCircleIcon className="w-3 h-3" /> Completed
    </span>
  );
  if (status === 'failed') return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
      <XCircleIcon className="w-3 h-3" /> Failed
    </span>
  );
  if (status === 'running') return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
      <ArrowPathIcon className="w-3 h-3 animate-spin" /> Running…
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
      <ClockIcon className="w-3 h-3" /> Queued
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StudioWorkflowClient({ workflow: initialWorkflow, initialRuns }: Props) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [runs, setRuns] = useState<WorkflowRun[]>(initialRuns);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [running, setRunning] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const colorBg = WORKFLOW_COLOR_MAP[workflow.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WorkflowIcon = WORKFLOW_ICON_MAP[workflow.icon ?? 'bolt'] ?? BoltIcon;
  const stepCount = Array.isArray(workflow.steps) ? workflow.steps.length : 0;
  const lastRun = runs[0] ?? null;
  const allDocs = runs.flatMap(r => r.artifacts ?? []);

  const scheduleLabel = (() => {
    if (workflow.trigger?.type !== 'schedule') return null;
    const cron = 'cron' in workflow.trigger ? workflow.trigger.cron : '';
    const tz = 'timezone' in workflow.trigger ? workflow.trigger.timezone as string | undefined : undefined;
    return cron ? describeCron(cron, tz) : null;
  })();

  const nextRunLabel = (() => {
    if (!workflow.next_run_at || workflow.status !== 'active') return null;
    const diff = new Date(workflow.next_run_at).getTime() - Date.now();
    if (diff < 0) return 'soon';
    const m = Math.floor(diff / 60000);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h}h`;
    return `in ${Math.floor(h / 24)}d`;
  })();

  const refreshRuns = useCallback(async () => {
    const res = await fetch(`/api/workflows/${workflow.id}/runs`);
    if (res.ok) {
      const { runs } = await res.json();
      setRuns(runs);
    }
  }, [workflow.id]);

  useEffect(() => {
    const anyActive = runs.some(r => r.status === 'queued' || r.status === 'running');
    if (!anyActive) return;
    const interval = setInterval(refreshRuns, 4000);
    return () => clearInterval(interval);
  }, [runs, refreshRuns]);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/run`, { method: 'POST' });
      if (res.ok) {
        await refreshRuns();
        setActiveTab('history');
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
    const next: Workflow['status'] = workflow.status === 'active' ? 'paused' : 'active';
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
      setMoreOpen(false);
    }
  }, [workflow]);

  const handleDelete = useCallback(async () => {
    const res = await fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/studio');
  }, [workflow.id, router]);

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview',  label: 'Overview' },
    { id: 'history',   label: 'History',   count: runs.length || undefined },
    { id: 'documents', label: 'Documents', count: allDocs.length || undefined },
    { id: 'settings',  label: 'Settings' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">

      {/* ── Header ── */}
      <header className="px-8 pt-6 pb-0 border-b border-neutral-100 flex-shrink-0">

        {/* Back + actions row */}
        <div className="flex items-center justify-between mb-5">
          <Link href="/studio"
            className="inline-flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-700 transition-colors">
            <ArrowLeftIcon className="w-3 h-3" />
            All workflows
          </Link>

          <div className="flex items-center gap-2">
            <button onClick={runNow} disabled={running || stepCount === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-medium rounded-lg transition-colors disabled:opacity-40">
              <PlayIcon className="w-3.5 h-3.5" />
              {running ? 'Starting…' : 'Run now'}
            </button>
            <Link href={`/work/studio/${workflow.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12.5px] font-medium rounded-lg transition-colors">
              <PencilSquareIcon className="w-3.5 h-3.5" />
              Edit
            </Link>
            {/* ··· menu */}
            <div className="relative" ref={moreRef}>
              <button onClick={() => setMoreOpen(o => !o)}
                className="p-1.5 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600">
                <EllipsisVerticalIcon className="w-4 h-4" />
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden z-20">
                  <button onClick={toggleStatus} disabled={togglingStatus || stepCount === 0}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-neutral-700 hover:bg-neutral-50 transition-colors text-left disabled:opacity-40">
                    {workflow.status === 'active'
                      ? <><PauseIcon className="w-4 h-4" /> Pause</>
                      : <><PlayIcon className="w-4 h-4" /> Activate</>}
                  </button>
                  <div className="border-t border-neutral-100" />
                  <button onClick={() => { setConfirmingDelete(true); setMoreOpen(false); setActiveTab('settings'); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors text-left">
                    <TrashIcon className="w-4 h-4" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Identity */}
        <div className="flex items-start gap-4 mb-4">
          <div className={`w-12 h-12 rounded-2xl ${colorBg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <WorkflowIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[18px] font-semibold text-neutral-900 leading-tight">{workflow.name}</h1>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                workflow.status === 'active'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-neutral-100 text-neutral-500'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${workflow.status === 'active' ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                {workflow.status === 'active' ? 'Active' : 'Paused'}
              </span>
            </div>
            {workflow.description && (
              <p className="text-[13px] text-neutral-500 mt-0.5 leading-snug">{workflow.description}</p>
            )}
            {/* Schedule / trigger info */}
            <div className="flex items-center gap-3 mt-1.5 text-[12px] text-neutral-400 flex-wrap">
              {scheduleLabel ? (
                <span className="flex items-center gap-1"><ClockIcon className="w-3.5 h-3.5" />{scheduleLabel}</span>
              ) : (
                <span className="flex items-center gap-1"><ClockIcon className="w-3.5 h-3.5" />Manual only</span>
              )}
              {nextRunLabel && (
                <span className="text-neutral-400">· Next run <span className="text-neutral-600 font-medium">{nextRunLabel}</span></span>
              )}
              {lastRun && (
                <span className="text-neutral-400">· Last run <span className="text-neutral-600 font-medium">{relativeTime(lastRun.created_at)}</span></span>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 -mb-px">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'text-neutral-900 border-neutral-900'
                  : 'text-neutral-400 border-transparent hover:text-neutral-600'
              }`}>
              {tab.label}
              {tab.count !== undefined && (
                <span className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.id ? 'bg-neutral-100 text-neutral-600' : 'bg-neutral-100 text-neutral-400'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto bg-neutral-50/60">
        {activeTab === 'overview' && (
          <OverviewPane workflow={workflow} runs={runs} onRunNow={runNow} running={running} />
        )}
        {activeTab === 'history' && <HistoryPane runs={runs} />}
        {activeTab === 'documents' && <DocumentsPane runs={runs} />}
        {activeTab === 'settings' && (
          <SettingsPane workflow={workflow} confirmingDelete={confirmingDelete}
            setConfirmingDelete={setConfirmingDelete} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewPane({ workflow, runs, onRunNow, running }: {
  workflow: Workflow; runs: WorkflowRun[]; onRunNow: () => void; running: boolean;
}) {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const succeeded = runs.filter(r => r.status === 'succeeded');
  const lastSucceeded = succeeded[0] ?? null;

  return (
    <div className="p-8 max-w-4xl">
      <div className="grid grid-cols-3 gap-6">

        {/* Steps — 2 cols */}
        <div className="col-span-2">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </p>
          {steps.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-10 text-center">
              <p className="text-[13px] text-neutral-500 mb-3">No steps configured yet.</p>
              <Link href={`/work/studio/${workflow.id}/edit`}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-indigo-600 hover:text-indigo-700 font-medium">
                <PencilSquareIcon className="w-3.5 h-3.5" /> Add steps
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <StepRow key={step.id} step={step} index={idx} isLast={idx === steps.length - 1} />
              ))}
            </div>
          )}
        </div>

        {/* Stats sidebar — 1 col */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">At a glance</p>

          <StatCard label="Last run" value={runs[0] ? relativeTime(runs[0].created_at) : 'Never'}>
            {runs[0] && <RunStatusPill status={runs[0].status} />}
            {runs[0]?.thread_id && (
              <Link href={`/work?thread=${runs[0].thread_id}`}
                className="block mt-2 text-[12px] text-indigo-600 hover:text-indigo-700 font-medium">
                View output →
              </Link>
            )}
          </StatCard>

          <StatCard label="Total runs" value={String(runs.length)}>
            {runs.length > 0 && (
              <div className="text-[12px] text-neutral-500 mt-1">
                {succeeded.length} completed · {runs.length - succeeded.length} failed/other
              </div>
            )}
          </StatCard>

          {lastSucceeded && (
            <StatCard label="Last successful output" value="">
              <div className="text-[12px] text-neutral-600 mt-0.5">{fmtDate(lastSucceeded.completed_at)}</div>
              {lastSucceeded.thread_id && (
                <Link href={`/work?thread=${lastSucceeded.thread_id}`}
                  className="block mt-2 text-[12px] text-indigo-600 hover:text-indigo-700 font-medium">
                  Open →
                </Link>
              )}
            </StatCard>
          )}

          {steps.length > 0 && (
            <button onClick={onRunNow} disabled={running}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-medium rounded-xl transition-colors disabled:opacity-40">
              <PlayIcon className="w-4 h-4" />
              {running ? 'Starting…' : 'Run now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-150 p-4">
      <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">{label}</div>
      {value && <div className="text-[15px] font-semibold text-neutral-900">{value}</div>}
      {children}
    </div>
  );
}

function StepRow({ step, index, isLast }: { step: WorkflowStep; index: number; isLast: boolean }) {
  const colors = STEP_TYPE_COLORS[step.type];
  const TypeIcon = STEP_TYPE_ICONS[step.type];
  const toolId = step.type === 'tool' ? (step as { tool: string }).tool : undefined;
  const ToolIcon = toolId ? (TOOL_ICONS[toolId] ?? TypeIcon) : TypeIcon;

  const typeLabel = step.type === 'tool' ? 'Fetch' : step.type === 'ai' ? 'AI' : 'Agent';

  return (
    <div className="relative">
      <div className="bg-white rounded-xl border border-neutral-150 px-4 py-3 flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold`}>
          {index + 1}
        </div>
        <div className="w-6 h-6 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
          <ToolIcon className="w-3.5 h-3.5 text-neutral-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-neutral-900 truncate">{step.label || '(unnamed)'}</div>
        </div>
        <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${colors.light} ${colors.text} flex-shrink-0`}>
          {typeLabel}
        </span>
      </div>
      {!isLast && <div className="absolute left-[22px] top-full w-px h-2 bg-neutral-200" />}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

function HistoryPane({ runs }: { runs: WorkflowRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-8">
        <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center mb-4">
          <ClockIcon className="w-6 h-6 text-neutral-400" />
        </div>
        <h3 className="text-[15px] font-semibold text-neutral-700 mb-1">No runs yet</h3>
        <p className="text-[13px] text-neutral-400 max-w-xs">
          Trigger this workflow manually or activate it to run on schedule.
        </p>
      </div>
    );
  }

  const groups = groupByDate(runs);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      {groups.map(({ label, runs: groupRuns }) => (
        <div key={label}>
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">{label}</p>
          <div className="space-y-2">
            {groupRuns.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function RunCard({ run }: { run: WorkflowRun }) {
  const [expanded, setExpanded] = useState(false);
  const duration = fmtDuration(run.started_at, run.completed_at);
  const hasDetails = (run.step_outputs?.length ?? 0) > 0 || run.error;

  return (
    <div className="bg-white rounded-xl border border-neutral-150 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <RunStatusPill status={run.status} />
            <span className="text-[12.5px] text-neutral-500">{humanTrigger(run.triggered_by)}</span>
            {duration && <span className="text-[12px] text-neutral-400">· {duration}</span>}
          </div>
          <div className="text-[11.5px] text-neutral-400 mt-0.5">{fmtDate(run.started_at)}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {run.thread_id && (
            <Link href={`/work?thread=${run.thread_id}`}
              className="text-[12px] text-indigo-600 hover:text-indigo-700 font-medium">
              View output →
            </Link>
          )}
          {hasDetails && (
            <button onClick={() => setExpanded(v => !v)}
              className="p-1 rounded-md hover:bg-neutral-100 transition-colors text-neutral-400">
              <ChevronRightIcon className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50/60 space-y-2">
          {run.error && (
            <div className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {run.error}
            </div>
          )}
          {(run.step_outputs ?? []).map((s, i) => (
            <div key={i} className="bg-white rounded-lg border border-neutral-150 p-3">
              <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">
                Step {i + 1} · {s.step_type === 'ai' ? 'AI' : s.step_type === 'tool' ? 'Fetch' : 'Agent'}
              </div>
              <div className="text-[12.5px] font-medium text-neutral-800 mb-1">{s.label}</div>
              {s.error ? (
                <div className="text-[12px] text-red-700">{s.error}</div>
              ) : (
                <pre className="text-[11.5px] text-neutral-600 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto leading-relaxed">
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

// ── Documents ─────────────────────────────────────────────────────────────────

function DocumentsPane({ runs }: { runs: WorkflowRun[] }) {
  const docs = runs.flatMap(r =>
    (r.artifacts ?? []).map(a => ({ ...a, run_started_at: r.started_at, run_thread_id: r.thread_id }))
  );

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-8">
        <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center mb-4">
          <DocumentArrowDownIcon className="w-6 h-6 text-neutral-400" />
        </div>
        <h3 className="text-[15px] font-semibold text-neutral-700 mb-1">No documents yet</h3>
        <p className="text-[13px] text-neutral-400 max-w-xs">
          Documents generated by this workflow will appear here after a successful run.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="grid grid-cols-2 gap-3">
        {docs.map(doc => (
          <div key={doc.id} className="bg-white rounded-xl border border-neutral-150 p-4 flex flex-col gap-2">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <DocumentTextIcon className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-neutral-900 leading-snug">{doc.title || 'Untitled'}</div>
                <div className="text-[11.5px] text-neutral-400 mt-0.5">{fmtDate(doc.run_started_at)}</div>
              </div>
            </div>
            {doc.run_thread_id && (
              <Link href={`/work?thread=${doc.run_thread_id}`}
                className="mt-1 text-[12px] text-indigo-600 hover:text-indigo-700 font-medium">
                Open →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

function SettingsPane({
  workflow, confirmingDelete, setConfirmingDelete, onDelete,
}: {
  workflow: Workflow; confirmingDelete: boolean;
  setConfirmingDelete: (v: boolean) => void; onDelete: () => void;
}) {
  const scheduleLabel = (() => {
    if (workflow.trigger?.type !== 'schedule') return 'Manual only';
    const cron = 'cron' in workflow.trigger ? workflow.trigger.cron : '';
    const tz = 'timezone' in workflow.trigger ? workflow.trigger.timezone as string | undefined : undefined;
    return cron ? describeCron(cron, tz) : 'Scheduled';
  })();

  const outputLabel = workflow.output_config?.destination === 'artifact' ? 'Document' : 'Inbox message';

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <section>
        <h3 className="text-[13px] font-semibold text-neutral-700 mb-3">Details</h3>
        <dl className="border border-neutral-150 rounded-xl overflow-hidden divide-y divide-neutral-100 bg-white text-[13px]">
          <Row label="Name">{workflow.name}</Row>
          <Row label="Description">{workflow.description || <span className="text-neutral-400">—</span>}</Row>
          <Row label="Status"><span className="capitalize">{workflow.status}</span></Row>
          <Row label="Schedule">{scheduleLabel}</Row>
          <Row label="Steps">{Array.isArray(workflow.steps) ? workflow.steps.length : 0}</Row>
          <Row label="Output">{outputLabel}</Row>
        </dl>
      </section>

      <section>
        <h3 className="text-[13px] font-semibold text-red-600 mb-3">Danger zone</h3>
        <div className="border border-red-200 rounded-xl p-4 bg-white">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-neutral-900">Delete this workflow</div>
              <div className="text-[12px] text-neutral-500 mt-0.5">
                Permanently removes this workflow and all its history.
              </div>
            </div>
            {confirmingDelete ? (
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={onDelete}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[12px] font-medium rounded-lg">
                  Confirm delete
                </button>
                <button onClick={() => setConfirmingDelete(false)}
                  className="px-3 py-1.5 border border-neutral-200 text-neutral-700 text-[12px] font-medium rounded-lg hover:bg-neutral-50">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmingDelete(true)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-[12px] font-medium rounded-lg hover:bg-red-50 transition-colors">
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
    <div className="flex px-4 py-2.5 gap-4">
      <dt className="w-28 text-neutral-400 text-[12.5px] flex-shrink-0">{label}</dt>
      <dd className="flex-1 text-neutral-900 text-[12.5px]">{children}</dd>
    </div>
  );
}
