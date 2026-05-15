'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  PlayIcon, PauseIcon, PencilSquareIcon,
  ClockIcon, CheckCircleIcon, XCircleIcon, ArrowPathIcon, TrashIcon,
  ClipboardDocumentIcon, CheckIcon, DocumentArrowDownIcon,
  ChatBubbleLeftRightIcon, DocumentTextIcon, TableCellsIcon,
  PresentationChartBarIcon, EnvelopeIcon,
  DocumentDuplicateIcon, ChevronDownIcon, LockClosedIcon, UsersIcon,
  EllipsisVerticalIcon, SparklesIcon, WrenchScrewdriverIcon, UserCircleIcon,
  BoltIcon, CalendarDaysIcon, MagnifyingGlassIcon, NewspaperIcon,
  GlobeAltIcon, MegaphoneIcon, BuildingOfficeIcon, ChevronRightIcon,
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
const STEP_TYPE_COLORS = {
  tool:  { bg: 'bg-blue-500',    light: 'bg-blue-50',    text: 'text-blue-700' },
  ai:    { bg: 'bg-violet-500',  light: 'bg-violet-50',  text: 'text-violet-700' },
  agent: { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-700' },
};
const STEP_TYPE_ICONS = { tool: WrenchScrewdriverIcon, ai: SparklesIcon, agent: UserCircleIcon };
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
  const [runsLoading, setRunsLoading] = useState(!initialRuns);
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
    const prefetched = initialRuns;
    if (prefetched && prefetched.length > 0) {
      setRuns(prefetched);
      setRunsLoading(false);
      fetchRuns(initialWorkflow.id); // refresh silently in background
    } else {
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

        {/* Actions row */}
        <div className="flex items-center justify-end gap-2 mb-4">
          <button onClick={runNow} disabled={running || stepCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-medium rounded-lg transition-colors disabled:opacity-40">
            <PlayIcon className="w-3.5 h-3.5" />
            {running ? 'Starting…' : 'Run now'}
          </button>
          {isOwner ? (
            <>
              <button onClick={onEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12px] font-medium rounded-lg transition-colors">
                <PencilSquareIcon className="w-3.5 h-3.5" />
                Edit
              </button>
              <div className="relative" ref={moreRef}>
                <button onClick={() => { setMoreOpen(o => !o); setShareOpen(false); }}
                  className="p-1.5 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600">
                  <EllipsisVerticalIcon className="w-4 h-4" />
                </button>
                {(moreOpen || shareOpen) && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden z-20">
                    {/* Pause / Activate */}
                    <button onClick={toggleStatus} disabled={togglingStatus || stepCount === 0}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-40">
                      {workflow.status === 'active'
                        ? <><PauseIcon className="w-4 h-4" /> Pause</>
                        : <><PlayIcon className="w-4 h-4" /> Activate</>}
                    </button>

                    {/* Sharing */}
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
            </>
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

        {/* Identity */}
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl ${colorBg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <WorkflowIcon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[15px] font-semibold text-neutral-900 leading-tight truncate">{workflow.name}</h2>
              <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                workflow.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${workflow.status === 'active' ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                {workflow.status === 'active' ? 'Active' : 'Paused'}
              </span>
            </div>
            {workflow.description && (
              <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug">{workflow.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5 text-[11.5px] text-neutral-400 flex-wrap">
              <span className="flex items-center gap-1">
                <ClockIcon className="w-3 h-3" />
                {scheduleLabel ?? 'Manual only'}
              </span>
              {nextRunLabel && <span>· Next <span className="text-neutral-600 font-medium">{nextRunLabel}</span></span>}
              {runs[0] && <span>· Last <span className="text-neutral-600 font-medium">{relativeTime(runs[0].created_at)}</span></span>}
            </div>
          </div>
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
        {activeTab === 'overview' && (
          <OverviewPane workflow={workflow} runs={runs} loading={runsLoading}
            onOpenThread={onOpenThread} onOpenArtifact={onOpenArtifact}
            onRunDeleted={runId => setRuns(prev => prev.filter(r => r.id !== runId))}
            workflowId={workflow.id} />
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

function OverviewPane({ workflow, runs, loading, onOpenThread, onOpenArtifact, onRunDeleted, workflowId }: {
  workflow: Workflow; runs: WorkflowRun[]; loading: boolean;
  onOpenThread?: (id: string) => void;
  onOpenArtifact?: (threadId: string, artifactId: string) => void;
  onRunDeleted?: (runId: string) => void;
  workflowId: string;
}) {
  const steps = workflow.steps;
  const succeeded = runs.filter(r => r.status === 'succeeded');
  const lastRun = runs[0] ?? null;

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

  const nextRunDate = workflow.next_run_at
    ? new Date(workflow.next_run_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="p-5">
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard label="Last run" value={lastRun ? relativeTime(lastRun.created_at) : 'Never'}>
          {lastRun && <RunStatusPill status={lastRun.status} />}
        </StatCard>
        <StatCard label="Total runs" value={loading ? '…' : String(runs.length)}>
          {!loading && runs.length > 0 && (
            <div className="text-[11px] text-neutral-400 mt-0.5">{succeeded.length} completed</div>
          )}
        </StatCard>
        <StatCard
          label="Next run"
          value={workflow.trigger.type !== 'schedule' ? 'Manual' : (nextRunLabel ?? (workflow.status !== 'active' ? 'Paused' : '—'))}
        >
          {nextRunDate && workflow.status === 'active' && (
            <div className="text-[11px] text-neutral-400 mt-0.5 truncate" title={nextRunDate}>{nextRunDate}</div>
          )}
          {workflow.trigger.type === 'schedule' && workflow.status !== 'active' && (
            <div className="text-[11px] text-neutral-400 mt-0.5">Activate to schedule</div>
          )}
        </StatCard>
      </div>

      {/* History */}
      <div className="mt-5">
        <p className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">History</p>
        {loading ? (
          <div className="flex items-center justify-center h-16">
            <div className="w-4 h-4 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : (() => {
          const hasActiveRun = runs.some(r => r.status === 'queued' || r.status === 'running');
          const showUpcoming = workflow.status === 'active' && workflow.trigger.type === 'schedule'
            && workflow.next_run_at && !hasActiveRun;
          if (runs.length === 0 && !showUpcoming) {
            return (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center mb-2">
                  <ClockIcon className="w-4 h-4 text-neutral-400" />
                </div>
                <p className="text-[12px] text-neutral-400">No runs yet</p>
              </div>
            );
          }
          const groups = groupByDate(runs);
          return (
            <div className="space-y-4">
              {showUpcoming && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-neutral-200 bg-white">
                  <ClockIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-neutral-400">Upcoming scheduled run</div>
                    <div className="text-[11px] text-neutral-400">{fmtDateTime(workflow.next_run_at)}</div>
                  </div>
                </div>
              )}
              {groups.map(({ label, runs: groupRuns }) => (
                <div key={label}>
                  <p className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5">{label}</p>
                  <div className="space-y-1.5">
                    {groupRuns.map(run => (
                      <RunCard key={run.id} run={run} workflowId={workflowId}
                        onOpenThread={onOpenThread} onOpenArtifact={onOpenArtifact}
                        onDeleted={onRunDeleted} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function StatCard({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-150 p-3">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-[14px] font-semibold text-neutral-900">{value}</div>
      {children}
    </div>
  );
}

function StepRow({ step, index, isLast }: { step: WorkflowStep; index: number; isLast: boolean }) {
  const colors = STEP_TYPE_COLORS[step.type];
  const TypeIcon = STEP_TYPE_ICONS[step.type];
  const toolId = step.type === 'tool' ? (step as { tool: string }).tool : undefined;
  const ToolIcon = toolId ? (TOOL_ICONS[toolId] ?? TypeIcon) : TypeIcon;
  const typeLabel = step.type === 'ai' ? 'AI' : step.type === 'tool' ? 'Fetch' : 'Agent';

  return (
    <div className="relative">
      <div className="bg-white rounded-xl border border-neutral-150 px-3 py-2.5 flex items-center gap-2.5">
        <div className={`w-6 h-6 rounded-md ${colors.bg} flex items-center justify-center flex-shrink-0 text-white text-[10px] font-bold`}>
          {index + 1}
        </div>
        <div className="w-5 h-5 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
          <ToolIcon className="w-3 h-3 text-neutral-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-neutral-900 truncate">{step.label || '(unnamed)'}</div>
        </div>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colors.light} ${colors.text} flex-shrink-0`}>
          {typeLabel}
        </span>
      </div>
      {!isLast && <div className="absolute left-[18px] top-full w-px h-1.5 bg-neutral-200" />}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

function HistoryPane({ runs, loading, workflow, workflowId, onOpenThread, onOpenArtifact, onRunDeleted }: {
  runs: WorkflowRun[]; loading: boolean; workflow: Workflow; workflowId: string;
  onOpenThread?: (id: string) => void;
  onOpenArtifact?: (threadId: string, artifactId: string) => void;
  onRunDeleted?: (runId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="w-5 h-5 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const hasActiveRun = runs.some(r => r.status === 'queued' || r.status === 'running');
  const showUpcoming = workflow.status === 'active' && workflow.trigger.type === 'schedule'
    && workflow.next_run_at && !hasActiveRun;

  if (runs.length === 0 && !showUpcoming) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center mb-3">
          <ClockIcon className="w-5 h-5 text-neutral-400" />
        </div>
        <h3 className="text-[13px] font-semibold text-neutral-700 mb-1">No runs yet</h3>
        <p className="text-[12px] text-neutral-400 max-w-xs">Trigger manually or activate to run on schedule.</p>
      </div>
    );
  }

  const groups = groupByDate(runs);

  return (
    <div className="p-5 space-y-4">
      {showUpcoming && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-neutral-200 bg-white">
          <ClockIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-neutral-400">Upcoming scheduled run</div>
            <div className="text-[11px] text-neutral-400">{fmtDateTime(workflow.next_run_at)}</div>
          </div>
        </div>
      )}
      {groups.map(({ label, runs: groupRuns }) => (
        <div key={label}>
          <p className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5">{label}</p>
          <div className="space-y-1.5">
            {groupRuns.map(run => (
              <RunCard key={run.id} run={run} workflowId={workflowId}
                onOpenThread={onOpenThread} onOpenArtifact={onOpenArtifact}
                onDeleted={onRunDeleted} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RunCard({ run, workflowId, onOpenThread, onOpenArtifact, onDeleted }: {
  run: WorkflowRun; workflowId: string;
  onOpenThread?: (id: string) => void;
  onOpenArtifact?: (threadId: string, artifactId: string) => void;
  onDeleted?: (runId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const duration = fmtDuration(run.started_at, run.completed_at);
  const hasDetails = (run.step_outputs?.length ?? 0) > 0 || run.error;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    const res = await fetch(`/api/workflows/${workflowId}/runs/${run.id}`, { method: 'DELETE' });
    if (res.ok) onDeleted?.(run.id);
    else { setDeleting(false); setConfirmingDelete(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-neutral-150 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <RunStatusPill status={run.status} />
            <span className="text-[11.5px] text-neutral-500">
              {run.triggered_by === 'schedule' ? 'Scheduled' : 'Manual'}
            </span>
            {duration && <span className="text-[11px] text-neutral-400">· {duration}</span>}
          </div>
          <div className="text-[11px] text-neutral-400 mt-0.5">{fmtDateTime(run.started_at)}</div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {run.thread_id && onOpenThread && (
            <button onClick={() => onOpenThread(run.thread_id!)} title="View output"
              className="p-1.5 text-neutral-400 hover:text-indigo-600 transition-colors rounded-md hover:bg-indigo-50">
              <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {run.thread_id && (run.artifacts?.length ?? 0) > 0 && onOpenArtifact && (
            <button onClick={() => onOpenArtifact(run.thread_id!, run.artifacts![0].id!)} title="Open document"
              className="p-1.5 text-neutral-400 hover:text-indigo-600 transition-colors rounded-md hover:bg-indigo-50">
              <DocumentArrowDownIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {hasDetails && (
            <button onClick={() => setExpanded(v => !v)}
              className="p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors rounded-md hover:bg-neutral-100">
              <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          )}
          {run.status !== 'running' && onDeleted && (
            confirmingDelete ? (
              <>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white text-[10.5px] font-medium rounded transition-colors disabled:opacity-50">
                  Delete
                </button>
                <button onClick={e => { e.stopPropagation(); setConfirmingDelete(false); }}
                  className="px-2 py-0.5 border border-neutral-200 text-neutral-600 text-[10.5px] font-medium rounded hover:bg-neutral-50">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={e => { e.stopPropagation(); setConfirmingDelete(true); }}
                className="p-1.5 text-neutral-300 hover:text-red-500 transition-colors rounded-md hover:bg-red-50">
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            )
          )}
        </div>
      </div>

      <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-neutral-100 px-3 py-3 bg-neutral-50/60 space-y-2">
            {run.error && (
              <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{run.error}</div>
            )}
            {(run.step_outputs ?? []).map((s, i) => (
              <div key={i} className="bg-white rounded-lg border border-neutral-150 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold">
                    Step {i + 1} · {s.step_type === 'ai' ? 'AI' : s.step_type === 'tool' ? 'Fetch' : 'Agent'}
                  </div>
                  {!s.error && s.output != null && (
                    <CopyButton text={typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2)} />
                  )}
                </div>
                <div className="text-[12px] font-medium text-neutral-800 mb-1">{s.label}</div>
                {s.error ? (
                  <div className="text-[11.5px] text-red-700">{s.error}</div>
                ) : typeof s.output === 'string' ? (
                  <div className="text-[11.5px] text-neutral-600 max-h-48 overflow-y-auto prose prose-sm prose-neutral max-w-none">
                    <MarkdownText content={s.output} />
                  </div>
                ) : (
                  <pre className="text-[11px] text-neutral-600 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
                    {JSON.stringify(s.output, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
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
