'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  PlayIcon, PauseIcon, PencilSquareIcon,
  ClockIcon, CheckCircleIcon, XCircleIcon, ArrowPathIcon, TrashIcon,
  ClipboardDocumentIcon, CheckIcon, DocumentArrowDownIcon,
  DocumentTextIcon, TableCellsIcon, PresentationChartBarIcon, EnvelopeIcon,
  DocumentDuplicateIcon, ChevronDownIcon, LockClosedIcon, UsersIcon,
  EllipsisVerticalIcon, SparklesIcon,
  BoltIcon, CalendarDaysIcon, MagnifyingGlassIcon, NewspaperIcon,
  GlobeAltIcon, MegaphoneIcon, BuildingOfficeIcon,
} from '@heroicons/react/24/outline';
import type { Workflow, WorkflowRun, WorkflowStep, DocumentArtifact, SharingMode } from '@/lib/workflows/types';
import { describeCron } from '@/lib/workflows/schedule';
import { MarkdownText } from '@/components/work/chat-message';

interface Props {
  workflow: Workflow;
  initialTab?: Tab;
  initialRuns?: WorkflowRun[];
  onEdit: () => void;
  onWorkflowUpdated: (w: Workflow) => void;
  onWorkflowDeleted: (id: string) => void;
  onOpenThread?: (threadId: string) => void;
  onOpenArtifact?: (threadId: string, artifactId: string) => void;
  onClone?: (id: string) => void;
}

type Tab = 'overview' | 'history' | 'documents' | 'settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  get_urgent_emails: EnvelopeIcon, get_calendar: CalendarDaysIcon,
  read_kb_file: DocumentTextIcon, web_search: MagnifyingGlassIcon,
  fetch_url: GlobeAltIcon, browser_fetch: GlobeAltIcon,
  rss_feed: NewspaperIcon, linkedin_post: MegaphoneIcon, get_pt_tenders: BuildingOfficeIcon,
};

function artifactTypeIcon(type: string | undefined) {
  if (type === 'spreadsheet') return TableCellsIcon;
  if (type === 'presentation') return PresentationChartBarIcon;
  if (type === 'email') return EnvelopeIcon;
  return DocumentTextIcon;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

function StatusBadge({ status }: { status: Workflow['status'] }) {
  const isActive = status === 'active';
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${
      isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
      {isActive ? 'Active' : 'Paused'}
    </span>
  );
}

function RunStatusPill({ status }: { status: WorkflowRun['status'] }) {
  if (status === 'succeeded') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
      <CheckCircleIcon className="w-3 h-3" /> Completed
    </span>
  );
  if (status === 'failed' || status === 'cancelled') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
      <XCircleIcon className="w-3 h-3" /> Failed
    </span>
  );
  if (status === 'running') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
      <ArrowPathIcon className="w-3 h-3 animate-spin" /> Running…
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
      <ClockIcon className="w-3 h-3" /> Queued
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StudioDetailPanel({
  workflow: initialWorkflow, initialTab = 'overview', initialRuns,
  onEdit, onWorkflowUpdated, onWorkflowDeleted, onOpenThread, onOpenArtifact, onClone,
}: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [runs, setRuns] = useState<WorkflowRun[]>(initialRuns ?? []);
  const [runsLoading, setRunsLoading] = useState(initialRuns == null);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [running, setRunning] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [savingShareMode, setSavingShareMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWorkflow(initialWorkflow);
    setActiveTab(initialTab);
    setConfirmingDelete(false);
  }, [initialWorkflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchWorkflow = useCallback(async (wfId: string) => {
    const res = await fetch(`/api/workflows/${wfId}`);
    if (res.ok) {
      const { workflow: updated } = await res.json();
      setWorkflow(updated);
      onWorkflowUpdated(updated);
    }
  }, [onWorkflowUpdated]);

  const fetchRuns = useCallback(async (wfId: string) => {
    const res = await fetch(`/api/workflows/${wfId}/runs`);
    if (res.ok) {
      const { runs } = await res.json();
      setRuns(runs);
    }
    setRunsLoading(false);
  }, []);

  useEffect(() => {
    if (initialRuns != null) {
      // Already have data (possibly from prefetch) — show it immediately, refresh in background
      setRuns(initialRuns);
      setRunsLoading(false);
      fetchRuns(initialWorkflow.id);
    } else {
      // No prefetch data — show loading until fetch completes
      setRunsLoading(true);
      setRuns([]);
      fetchRuns(initialWorkflow.id);
    }
  }, [initialWorkflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const anyActive = runs.some(r => r.status === 'queued' || r.status === 'running');
    if (!anyActive) return;
    const interval = setInterval(async () => {
      await fetchRuns(workflow.id);
      fetchWorkflow(workflow.id);
    }, 4000);
    return () => clearInterval(interval);
  }, [runs, workflow.id, fetchRuns, fetchWorkflow]);

  useEffect(() => {
    if (!moreOpen && !shareOpen) return;
    const handler = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) { setMoreOpen(false); setShareOpen(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen, shareOpen]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/run`, { method: 'POST' });
      if (res.ok) {
        await fetchRuns(workflow.id);
        setActiveTab('history');
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Run failed' }));
        alert(error);
      }
    } finally { setRunning(false); }
  }, [workflow.id, fetchRuns]);

  const setShareMode = useCallback(async (mode: SharingMode | null) => {
    setSavingShareMode(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharing_mode: mode }),
      });
      if (res.ok) {
        const { workflow: updated } = await res.json();
        setWorkflow(updated); onWorkflowUpdated(updated);
      }
    } finally { setSavingShareMode(false); setShareOpen(false); }
  }, [workflow.id, onWorkflowUpdated]);

  const toggleStatus = useCallback(async () => {
    setTogglingStatus(true);
    const next: Workflow['status'] = workflow.status === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        const { workflow: updated } = await res.json();
        setWorkflow(updated); onWorkflowUpdated(updated);
      }
    } finally { setTogglingStatus(false); setMoreOpen(false); }
  }, [workflow, onWorkflowUpdated]);

  const handleDelete = useCallback(async () => {
    await fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE' });
    onWorkflowDeleted(workflow.id);
  }, [workflow.id, onWorkflowDeleted]);

  const colorBg = WORKFLOW_COLOR_MAP[workflow.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WorkflowIcon = WORKFLOW_ICON_MAP[workflow.icon ?? 'bolt'] ?? BoltIcon;
  const stepCount = workflow.steps.length;
  const allDocs: Array<{ artifact: DocumentArtifact; threadId: string }> = runs
    .filter(r => r.thread_id && (r.artifacts?.length ?? 0) > 0)
    .flatMap(r => (r.artifacts ?? []).filter(a => a.id).map(a => ({ artifact: a, threadId: r.thread_id! })));

  const scheduleLabel = (() => {
    if (workflow.trigger.type !== 'schedule') return null;
    return describeCron(workflow.trigger.cron ?? '', workflow.trigger.timezone);
  })();

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview',  label: 'Overview' },
    { id: 'documents', label: 'Documents', count: allDocs.length || undefined },
    { id: 'settings',  label: 'Settings' },
  ];

  const isOwner = workflow.is_owned_by_me !== false;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">

      {/* ── Header ── */}
      <header className="px-5 pt-5 pb-0 border-b border-neutral-100 flex-shrink-0">

        {/* Identity + actions row */}
        <div className="flex items-start gap-3 mb-3">
          {/* Icon */}
          <div className={`w-12 h-12 rounded-xl ${colorBg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <WorkflowIcon className="w-6 h-6 text-white" />
          </div>

          {/* Name + description */}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[16px] font-semibold text-neutral-900 leading-tight truncate">{workflow.name}</h2>
              <StatusBadge status={workflow.status} />
              {isOwner && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                  {workflow.sharing_mode === 'live'
                    ? <><UsersIcon className="w-3 h-3 text-indigo-500" /><span className="text-indigo-600">Shared</span></>
                    : <><LockClosedIcon className="w-3 h-3" />Private</>}
                </span>
              )}
            </div>
            {workflow.description && (
              <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug">{workflow.description}</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
            <button onClick={runNow} disabled={running || stepCount === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-medium rounded-lg transition-colors disabled:opacity-40">
              <PlayIcon className="w-3.5 h-3.5" />
              {running ? 'Running…' : 'Run workflow'}
            </button>
            {isOwner && (
              <button onClick={onEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600 text-[12px] font-medium">
                <PencilSquareIcon className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            {isOwner ? (
              <div className="relative" ref={moreRef}>
                <button onClick={() => { setMoreOpen(o => !o); setShareOpen(false); }}
                  className="p-1.5 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600">
                  <EllipsisVerticalIcon className="w-4 h-4" />
                </button>
                {(moreOpen || shareOpen) && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden z-20">
                    <button onClick={toggleStatus} disabled={togglingStatus || stepCount === 0}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-40">
                      {workflow.status === 'active'
                        ? <><PauseIcon className="w-4 h-4" /> Pause</>
                        : <><PlayIcon className="w-4 h-4" /> Activate</>}
                    </button>
                    <div className="border-t border-neutral-100" />
                    <button onClick={() => setShareOpen(o => !o)} disabled={savingShareMode}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50 transition-colors">
                      {workflow.sharing_mode === 'live'
                        ? <UsersIcon className="w-4 h-4 text-indigo-500" />
                        : <LockClosedIcon className="w-4 h-4" />}
                      <span className="flex-1 text-left">{workflow.sharing_mode === 'live' ? 'Shared' : 'Private'}</span>
                      <ChevronDownIcon className="w-3 h-3 opacity-40" />
                    </button>
                    {shareOpen && (
                      <div className="border-t border-neutral-100">
                        <button onClick={() => setShareMode(null)}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] hover:bg-neutral-50 transition-colors ${!workflow.sharing_mode ? 'font-medium text-neutral-900' : 'text-neutral-600'}`}>
                          <LockClosedIcon className="w-3.5 h-3.5 text-neutral-400" />
                          <div className="flex-1 text-left">
                            <div>Private</div>
                            <div className="text-[10.5px] text-neutral-400 font-normal">Only you</div>
                          </div>
                          {!workflow.sharing_mode && <CheckIcon className="w-3.5 h-3.5 text-indigo-600" />}
                        </button>
                        <button onClick={() => setShareMode('live')}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] hover:bg-neutral-50 transition-colors ${workflow.sharing_mode === 'live' ? 'font-medium text-neutral-900' : 'text-neutral-600'}`}>
                          <UsersIcon className="w-3.5 h-3.5 text-neutral-400" />
                          <div className="flex-1 text-left">
                            <div>Shared</div>
                            <div className="text-[10.5px] text-neutral-400 font-normal">Visible to team</div>
                          </div>
                          {workflow.sharing_mode === 'live' && <CheckIcon className="w-3.5 h-3.5 text-indigo-600" />}
                        </button>
                      </div>
                    )}
                    <div className="border-t border-neutral-100" />
                    <button onClick={() => { setConfirmingDelete(true); setMoreOpen(false); setActiveTab('settings'); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-red-600 hover:bg-red-50 transition-colors">
                      <TrashIcon className="w-4 h-4" /> Delete
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <span className="text-[11.5px] text-neutral-400">Shared by {workflow.owner_name ?? 'Teammate'}</span>
                {onClone && (
                  <button onClick={() => onClone(workflow.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12px] font-medium rounded-lg transition-colors">
                    <DocumentDuplicateIcon className="w-3.5 h-3.5" /> Clone
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-2 mb-3 text-[11.5px] text-neutral-400">
          <span className="flex items-center gap-1">
            <ClockIcon className="w-3 h-3" />
            {scheduleLabel ?? 'Manual only'}
          </span>
          {runs[0] && (
            <span>· Last <span className="text-neutral-600 font-medium">{relativeTime(runs[0].created_at)}</span></span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center -mb-px">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors ${
                activeTab === tab.id ? 'text-neutral-900 border-neutral-900' : 'text-neutral-400 border-transparent hover:text-neutral-600'
              }`}>
              {tab.label}
              {tab.count !== undefined && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.id ? 'bg-neutral-100 text-neutral-600' : 'bg-neutral-100 text-neutral-400'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto bg-neutral-50/60">
        {(activeTab === 'overview' || activeTab === 'history') && (
          <OverviewPane
            workflow={workflow}
            runs={runs}
            loading={runsLoading}
            onOpenThread={onOpenThread}
            onOpenArtifact={onOpenArtifact}
            onRunDeleted={runId => setRuns(prev => prev.filter(r => r.id !== runId))}
            workflowId={workflow.id}
            runNow={runNow}
            onActivate={toggleStatus}
            onViewAll={() => setActiveTab('history')}
          />
        )}
        {activeTab === 'documents' && (
          <DocumentsPane docs={allDocs} onOpenArtifact={onOpenArtifact} />
        )}
        {activeTab === 'settings' && (
          <SettingsPane workflow={workflow} confirmingDelete={confirmingDelete}
            setConfirmingDelete={setConfirmingDelete} onDelete={handleDelete}
            scheduleLabel={scheduleLabel} />
        )}
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewPane({ workflow, runs, loading, onOpenThread, onOpenArtifact, onRunDeleted, workflowId, runNow, onActivate, onViewAll }: {
  workflow: Workflow; runs: WorkflowRun[]; loading: boolean;
  onOpenThread?: (id: string) => void;
  onOpenArtifact?: (threadId: string, artifactId: string) => void;
  onRunDeleted?: (runId: string) => void;
  workflowId: string;
  runNow: () => void;
  onActivate: () => void;
  onViewAll: () => void;
}) {
  const lastRun = runs[0] ?? null;
  const latestRunThreadId = runs.find(r => r.thread_id)?.thread_id ?? null;
  const latestSucceededRun = runs.find(r => r.status === 'succeeded') ?? null;

  return (
    <div className="p-5 flex gap-5">

      {/* Left column */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-2.5">
          <LastRunCard lastRun={lastRun} />
          <NextRunCard workflow={workflow} onActivate={onActivate} />
          <TrustSourcesCard workflow={workflow} runs={runs} loading={loading} />
        </div>

        {/* Ask this workflow */}
        <AskWorkflowBox
          workflow={workflow}
          latestRunThreadId={latestRunThreadId}
          onOpenThread={onOpenThread}
          runNow={runNow}
        />

        {/* Latest briefing */}
        <LatestBriefingCard runs={runs} onOpenArtifact={onOpenArtifact} />

        {/* Chat input */}
        <WorkflowChatBar
          latestSucceededRun={latestSucceededRun}
          onOpenThread={onOpenThread}
        />
      </div>

      {/* Right column: Past runs */}
      <div className="w-[210px] flex-shrink-0">
        <PastRunsPanel
          runs={runs}
          loading={loading}
          onOpenThread={onOpenThread}
          onViewAll={onViewAll}
          workflowId={workflowId}
          onRunDeleted={onRunDeleted}
        />
      </div>

    </div>
  );
}

// ── Stat cards ─────────────────────────────────────────────────────────────────

function LastRunCard({ lastRun }: { lastRun: WorkflowRun | null }) {
  const toolBullets = lastRun?.step_outputs
    ?.filter(s => s.step_type === 'tool' && s.output != null)
    .slice(0, 3) ?? [];

  return (
    <div className="bg-white rounded-xl border border-neutral-150 p-3">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">LAST RUN</div>
      <div className="text-[14px] font-semibold text-neutral-900 mb-1">{lastRun ? relativeTime(lastRun.created_at) : 'Never'}</div>
      {lastRun && <RunStatusPill status={lastRun.status} />}
      {toolBullets.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {toolBullets.map((s, i) => (
            <li key={i} className="text-[10.5px] text-neutral-400 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-neutral-300 flex-shrink-0" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NextRunCard({ workflow, onActivate }: { workflow: Workflow; onActivate: () => void }) {
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

  const nextRunDate = workflow.next_run_at && workflow.status === 'active'
    ? new Date(workflow.next_run_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  const value = workflow.trigger.type !== 'schedule'
    ? 'Manual'
    : (nextRunLabel ?? (workflow.status !== 'active' ? 'Paused' : '—'));

  return (
    <div className="bg-white rounded-xl border border-neutral-150 p-3">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">NEXT RUN</div>
      <div className="text-[14px] font-semibold text-neutral-900">{value}</div>
      {nextRunDate && (
        <div className="text-[11px] text-neutral-400 mt-0.5 truncate">{nextRunDate}</div>
      )}
      {workflow.trigger.type === 'schedule' && workflow.status !== 'active' && (
        <>
          <div className="text-[11px] text-neutral-400 mt-0.5">Status: Paused</div>
          <button onClick={onActivate}
            className="mt-2 text-[10.5px] text-indigo-600 font-medium hover:underline">
            Activate schedule
          </button>
        </>
      )}
    </div>
  );
}

function TrustSourcesCard({ workflow, runs, loading }: { workflow: Workflow; runs: WorkflowRun[]; loading: boolean }) {
  const toolStepCount = workflow.steps.filter(s => s.type === 'tool').length;
  const confidence = (() => {
    if (loading || runs.length === 0) return 'No data';
    const rate = runs.filter(r => r.status === 'succeeded').length / runs.length;
    if (rate > 0.8) return 'High';
    if (rate > 0.5) return 'Medium';
    return 'Low';
  })();
  const confidenceColor = confidence === 'High'
    ? 'text-emerald-600'
    : confidence === 'Medium'
    ? 'text-amber-600'
    : 'text-neutral-400';

  return (
    <div className="bg-white rounded-xl border border-neutral-150 p-3">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">TRUST & SOURCES</div>
      <div className="text-[14px] font-semibold text-neutral-900">{toolStepCount} source{toolStepCount !== 1 ? 's' : ''}</div>
      <div className={`text-[11px] font-medium mt-0.5 ${confidenceColor}`}>Confidence: {confidence}</div>
      <button className="mt-2 inline-flex items-center gap-1 text-[10.5px] text-neutral-500 border border-neutral-200 rounded-md px-2 py-0.5 hover:bg-neutral-50 transition-colors">
        <GlobeAltIcon className="w-3 h-3" /> View sources
      </button>
    </div>
  );
}

// ── Ask this workflow box ──────────────────────────────────────────────────────

function AskWorkflowBox({ workflow, latestRunThreadId, onOpenThread, runNow }: {
  workflow: Workflow;
  latestRunThreadId: string | null;
  onOpenThread?: (id: string) => void;
  runNow: () => void;
}) {
  const colorBg = WORKFLOW_COLOR_MAP[workflow.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WFIcon = WORKFLOW_ICON_MAP[workflow.icon ?? 'bolt'] ?? BoltIcon;

  const handleClick = () => {
    if (latestRunThreadId && onOpenThread) {
      onOpenThread(latestRunThreadId);
    } else {
      runNow();
    }
  };

  return (
    <button onClick={handleClick}
      className="w-full bg-neutral-50 rounded-xl border border-neutral-100 px-4 py-3 flex items-start gap-3 hover:bg-neutral-100 transition-colors text-left">
      <div className={`w-8 h-8 rounded-lg ${colorBg} flex items-center justify-center flex-shrink-0`}>
        <WFIcon className="w-4 h-4 text-white" />
      </div>
      <div>
        <div className="text-[12.5px] font-medium text-neutral-800">Ask this workflow</div>
        <div className="text-[11px] text-neutral-400 mt-0.5">Private Cloud · chat with this workflow&apos;s memory, last run, sources and outputs</div>
      </div>
    </button>
  );
}

// ── Latest briefing card ───────────────────────────────────────────────────────

function LatestBriefingCard({ runs, onOpenArtifact }: {
  runs: WorkflowRun[];
  onOpenArtifact?: (threadId: string, artifactId: string) => void;
}) {
  const lastSucceeded = runs.find(r => r.status === 'succeeded');
  if (!lastSucceeded) return null;

  const lastAiStep = [...(lastSucceeded.step_outputs ?? [])].reverse()
    .find(s => s.step_type === 'ai' && typeof s.output === 'string');
  const aiOutput = lastAiStep?.output as string | undefined;
  if (!aiOutput) return null;

  const dateChip = new Date(lastSucceeded.created_at).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  const succeededCount = runs.filter(r => r.status === 'succeeded').length;
  const totalToolOutputs = runs.reduce((acc, r) =>
    acc + (r.step_outputs?.filter(s => s.step_type === 'tool' && s.output != null).length ?? 0), 0);
  const avgSignal = runs.length > 0 ? Math.round(totalToolOutputs / runs.length) : 0;

  const firstRunAt = runs[runs.length - 1]?.created_at;
  const weeksRunning = firstRunAt
    ? Math.max(1, Math.ceil((Date.now() - new Date(firstRunAt).getTime()) / (7 * 86400000)))
    : 1;

  const hasArtifact = (lastSucceeded.artifacts?.length ?? 0) > 0 && lastSucceeded.thread_id;

  return (
    <div className="bg-white rounded-xl border border-neutral-150 p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest flex-1">LATEST BRIEFING</span>
        <span className="text-[10px] text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">{dateChip}</span>
        {runs.length > 1 && succeededCount > 1 && (
          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
            +{succeededCount - 1} vs last week
          </span>
        )}
      </div>

      <div className="relative max-h-40 overflow-hidden">
        <div className="text-[12px] text-neutral-700 prose prose-sm prose-neutral max-w-none">
          <MarkdownText content={aiOutput} />
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-white to-transparent pointer-events-none" />
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10.5px] text-neutral-400 border-t border-neutral-100 pt-2.5">
        <span>RUNS {succeededCount} · {weeksRunning} week{weeksRunning !== 1 ? 's' : ''}</span>
        <span className="text-neutral-200">·</span>
        <span>AVG SIGNAL {avgSignal}</span>
        {hasArtifact && onOpenArtifact && (
          <button
            onClick={() => onOpenArtifact(lastSucceeded.thread_id!, lastSucceeded.artifacts![0].id!)}
            className="ml-auto text-[10.5px] text-indigo-500 hover:underline">
            Open doc →
          </button>
        )}
      </div>

      {runs.length > 3 && (
        <div className="mt-1.5 text-[10.5px] text-neutral-400 italic">
          Agent has run {runs.length} times and is refining sources.
        </div>
      )}
    </div>
  );
}

// ── Workflow chat input bar ────────────────────────────────────────────────────

const WORKFLOW_SUGGESTIONS = [
  'What changed since last week?',
  'Which item is most relevant for AUGMTD?',
  'Turn this into a LinkedIn post',
];

function WorkflowChatBar({ latestSucceededRun, onOpenThread }: {
  latestSucceededRun: WorkflowRun | null;
  onOpenThread?: (id: string) => void;
}) {
  const [value, setValue] = useState('');

  const submitText = (text: string) => {
    if (latestSucceededRun?.thread_id && onOpenThread) {
      onOpenThread(latestSucceededRun.thread_id);
    }
    setValue('');
    void text;
  };

  return (
    <div className="space-y-2">
      <div className="border border-neutral-200 rounded-xl px-4 py-3 flex items-center gap-3 bg-white">
        <SparklesIcon className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitText(value); }}
          placeholder="Ask about this workflow…"
          className="flex-1 text-[12.5px] text-neutral-700 placeholder-neutral-400 outline-none border-none bg-transparent"
        />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <span className="text-[10.5px] text-neutral-400 self-center">SUGGESTED</span>
        {WORKFLOW_SUGGESTIONS.map(s => (
          <button key={s} onClick={() => submitText(s)}
            className="text-[11px] text-neutral-500 border border-neutral-200 rounded-full px-2.5 py-1 hover:bg-neutral-50 transition-colors">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Past runs panel (right column) ────────────────────────────────────────────

function PastRunsPanel({ runs, loading, onOpenThread, onViewAll, workflowId, onRunDeleted }: {
  runs: WorkflowRun[];
  loading: boolean;
  onOpenThread?: (id: string) => void;
  onViewAll: () => void;
  workflowId: string;
  onRunDeleted?: (runId: string) => void;
}) {
  const last30 = runs.filter(r => Date.now() - new Date(r.created_at).getTime() < 30 * 86400000);
  const shown = runs.slice(0, 8);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-[11px] font-semibold text-neutral-700 flex-1">Past runs</span>
        <span className="text-[10px] text-neutral-400">Last 30d · {last30.length}</span>
        <button onClick={onViewAll} className="text-[10px] text-indigo-500 hover:underline ml-1">View all</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-4 h-4 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : shown.length === 0 ? (
        <div className="text-[11px] text-neutral-400 text-center py-6">No runs yet</div>
      ) : (
        <div className="space-y-2.5">
          {shown.map(run => (
            <PastRunRow key={run.id} run={run} workflowId={workflowId} onOpenThread={onOpenThread} onDeleted={onRunDeleted} />
          ))}
        </div>
      )}
    </div>
  );
}

function PastRunRow({ run, workflowId, onOpenThread, onDeleted }: {
  run: WorkflowRun;
  workflowId: string;
  onOpenThread?: (id: string) => void;
  onDeleted?: (runId: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dotColor = run.status === 'succeeded'
    ? 'bg-emerald-400'
    : (run.status === 'failed' || run.status === 'cancelled')
    ? 'bg-amber-400'
    : 'bg-neutral-300';

  const statusLabel = run.status === 'succeeded'
    ? 'Completed'
    : (run.status === 'failed' || run.status === 'cancelled')
    ? 'Needs attention'
    : 'Running…';

  const dateStr = run.started_at
    ? new Date(run.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
      ', ' + new Date(run.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : fmtDateTime(run.created_at);

  const duration = fmtDuration(run.started_at, run.completed_at);

  const aiSummary = (() => {
    const aiStep = [...(run.step_outputs ?? [])].reverse()
      .find(s => s.step_type === 'ai' && typeof s.output === 'string');
    if (!aiStep) return null;
    const firstLine = (aiStep.output as string).split('\n').find(l => l.trim().length > 0) ?? '';
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine || null;
  })();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    const res = await fetch(`/api/workflows/${workflowId}/runs/${run.id}`, { method: 'DELETE' });
    if (res.ok) onDeleted?.(run.id);
    else { setDeleting(false); setConfirmingDelete(false); }
  };

  return (
    <div className="group">
      <button
        onClick={() => { if (run.thread_id && onOpenThread) onOpenThread(run.thread_id); }}
        className="w-full flex items-start gap-2 text-left hover:bg-neutral-50 rounded-lg px-1.5 py-1.5 transition-colors">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor} mt-[3px] flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-neutral-600 leading-snug">
            <span className="font-medium">{statusLabel}</span>
            <span className="text-neutral-300 mx-1">·</span>
            <span>{dateStr}</span>
            {duration && <><span className="text-neutral-300 mx-1">·</span><span>{duration}</span></>}
          </div>
          {aiSummary && (
            <div className="text-[10.5px] text-neutral-400 italic truncate mt-0.5">{aiSummary}</div>
          )}
          {run.error && !aiSummary && (
            <div className="text-[10.5px] text-red-400 truncate mt-0.5">{run.error}</div>
          )}
        </div>
      </button>
      {run.status !== 'running' && onDeleted && (
        <div className="flex justify-end px-1.5 -mt-0.5">
          {confirmingDelete ? (
            <div className="flex gap-1.5">
              <button onClick={handleDelete} disabled={deleting}
                className="text-[10px] text-red-600 hover:underline disabled:opacity-50">Delete</button>
              <button onClick={() => setConfirmingDelete(false)}
                className="text-[10px] text-neutral-400 hover:underline">Cancel</button>
            </div>
          ) : (
            <button onClick={e => { e.stopPropagation(); setConfirmingDelete(true); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-neutral-300 hover:text-red-400">
              <TrashIcon className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────

function DocumentsPane({ docs, onOpenArtifact }: {
  docs: Array<{ artifact: DocumentArtifact; threadId: string }>;
  onOpenArtifact?: (threadId: string, artifactId: string) => void;
}) {
  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center mb-3">
          <DocumentArrowDownIcon className="w-5 h-5 text-neutral-400" />
        </div>
        <h3 className="text-[13px] font-semibold text-neutral-700 mb-1">No documents yet</h3>
        <p className="text-[12px] text-neutral-400 max-w-xs">Documents generated by this workflow will appear here.</p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-1.5">
      {docs.map(({ artifact, threadId }) => {
        const Icon = artifactTypeIcon(artifact.type);
        return (
          <button key={artifact.id} onClick={() => onOpenArtifact?.(threadId, artifact.id!)}
            className="w-full flex items-center gap-3 px-3.5 py-3 bg-white border border-neutral-150 rounded-xl hover:bg-neutral-50 transition-colors text-left group">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium text-neutral-900 truncate">{artifact.title}</div>
              <div className="text-[11px] text-neutral-400 mt-0.5 capitalize">
                {artifact.type ?? 'document'} · {fmtDateTime(artifact.generated_at)}
              </div>
            </div>
            <DocumentArrowDownIcon className="w-4 h-4 text-neutral-300 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

function SettingsPane({ workflow, confirmingDelete, setConfirmingDelete, onDelete, scheduleLabel }: {
  workflow: Workflow; confirmingDelete: boolean;
  setConfirmingDelete: (v: boolean) => void; onDelete: () => void;
  scheduleLabel: string | null;
}) {
  const outputLabel = workflow.output_config.destination === 'artifact' ? 'Document' : 'Inbox message';
  return (
    <div className="p-5 space-y-5 max-w-lg">
      <dl className="text-[12.5px] border border-neutral-150 rounded-xl overflow-hidden divide-y divide-neutral-100 bg-white">
        <Row label="Status"><span className="capitalize">{workflow.status}</span></Row>
        <Row label="Schedule">{scheduleLabel ?? 'Manual only'}</Row>
        <Row label="Steps">{workflow.steps.length}</Row>
        <Row label="Output">{outputLabel}</Row>
      </dl>

      <div className="border border-red-200 rounded-xl p-4 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[12.5px] font-medium text-neutral-900">Delete this workflow</div>
            <div className="text-[11.5px] text-neutral-500 mt-0.5">Permanently removes this workflow and all its history.</div>
          </div>
          {confirmingDelete ? (
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={onDelete} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[11.5px] font-medium rounded-lg">Confirm</button>
              <button onClick={() => setConfirmingDelete(false)} className="px-3 py-1.5 border border-neutral-200 text-neutral-700 text-[11.5px] font-medium rounded-lg hover:bg-neutral-50">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmingDelete(true)}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-[11.5px] font-medium rounded-lg hover:bg-red-50 transition-colors">
              <TrashIcon className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors flex-shrink-0" title="Copy">
      {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex px-4 py-2.5 bg-white gap-4">
      <dt className="w-24 text-neutral-400 text-[12px] flex-shrink-0">{label}</dt>
      <dd className="flex-1 text-neutral-900 text-[12px]">{children}</dd>
    </div>
  );
}

