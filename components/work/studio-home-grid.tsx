'use client';

import { useState, useRef } from 'react';
import {
  PlusIcon,
  BoltIcon,
  ClockIcon,
  EnvelopeIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  ChartBarIcon,
  ArrowPathIcon,
  NewspaperIcon,
  GlobeAltIcon,
  TableCellsIcon,
  InboxIcon,
  MegaphoneIcon,
  FunnelIcon,
  PresentationChartLineIcon,
  BriefcaseIcon,
  CpuChipIcon,
  BookOpenIcon,
  SparklesIcon,
  UsersIcon,
  StarIcon as StarOutlineIcon,
  UserGroupIcon,
  HeartIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';
import type { Workflow } from '@/lib/workflows/types';
import { makeStepId } from '@/lib/workflows/types';
import type { WorkflowTemplate } from './studio-empty-state';
export { WORKFLOW_TEMPLATES } from './studio-empty-state';

// ── Maps ──────────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  bolt: BoltIcon, clock: ClockIcon, envelope: EnvelopeIcon,
  'calendar-days': CalendarDaysIcon, 'document-text': DocumentTextIcon,
  'magnifying-glass': MagnifyingGlassIcon, 'chart-bar': ChartBarIcon,
  'arrow-path': ArrowPathIcon, newspaper: NewspaperIcon, 'globe-alt': GlobeAltIcon,
  'table-cells': TableCellsIcon, inbox: InboxIcon, megaphone: MegaphoneIcon,
  funnel: FunnelIcon, 'presentation-chart-line': PresentationChartLineIcon,
  briefcase: BriefcaseIcon, 'cpu-chip': CpuChipIcon, 'book-open': BookOpenIcon,
  sparkles: SparklesIcon,
};

const COLOR_MAP: Record<string, string> = {
  indigo: 'bg-indigo-500', violet: 'bg-violet-500', blue: 'bg-blue-500',
  emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', neutral: 'bg-neutral-500',
};

// ── Templates ─────────────────────────────────────────────────────────────────

const QUICK_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'sales-customer-update', name: 'Sales customer update', description: '', cadence: '· Use',
    icon: <UsersIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Sales customer update', description: 'Draft a personalised status update for each active customer',
      status: 'draft', trigger: { type: 'schedule', cron: '0 9 * * 5', label: 'Fridays at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch recent customer emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Draft customer updates', prompt: 'For each active customer thread, draft a brief personalised status update covering recent activity, open items, and next steps. Tone: professional and warm.', output_format: 'markdown', model_tier: 'reasoning' },
      ],
      output_config: { destination: 'artifact', artifact_type: 'document', title_template: 'Customer Updates — {{date}}', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'daily-news-brief', name: 'Daily personalized news brief', description: '', cadence: '· Use',
    icon: <NewspaperIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Daily personalized news brief', description: 'Web search curated into a personalised industry digest',
      status: 'draft', trigger: { type: 'schedule', cron: '0 8 * * 1-5', label: 'Weekdays at 8am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Search industry news', tool: 'web_search', config: { query: 'latest industry news today' } },
        { id: makeStepId(), type: 'ai', label: 'Write personalised brief', prompt: 'Curate a personalised daily news brief: top 5 relevant stories, each with headline, 2-sentence summary, and why it matters to me. Skip duplicates.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'board-metric-snapshot', name: 'Board-ready metric snapshot', description: '', cadence: '· Use',
    icon: <PresentationChartLineIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Board-ready metric snapshot', description: 'Compile key metrics into an executive-ready summary',
      status: 'draft', trigger: { type: 'schedule', cron: '0 9 * * 1', label: 'Mondays at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch recent emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write metric snapshot', prompt: 'From recent emails and reports, compile a board-ready metric snapshot: KPIs, highlights, risks, and recommended actions. Format for executive review.', output_format: 'markdown', model_tier: 'reasoning' },
      ],
      output_config: { destination: 'artifact', artifact_type: 'document', title_template: 'Metric Snapshot — {{week_of}}', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'competitive-intel-monitor', name: 'Competitive intel monitor', description: '', cadence: '· Use',
    icon: <MagnifyingGlassIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Competitive intel monitor', description: 'Monitor competitor activity and surface key signals',
      status: 'draft', trigger: { type: 'schedule', cron: '0 9 * * 1-5', label: 'Weekdays at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Search competitor activity', tool: 'web_search', config: { query: 'competitor product news announcements' } },
        { id: makeStepId(), type: 'ai', label: 'Summarise intel', prompt: 'Summarise competitive signals: product updates, pricing moves, hires, press mentions, and funding news. Flag anything requiring a response within 48h.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'meeting-pre-brief', name: 'Meeting pre-brief', description: '', cadence: '· Use',
    icon: <CalendarDaysIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Meeting pre-brief', description: 'Prepare talking points and context for today\'s meetings',
      status: 'draft', trigger: { type: 'schedule', cron: '0 7 * * 1-5', label: 'Weekdays at 7am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch today\'s calendar', tool: 'get_calendar', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write pre-brief', prompt: 'For each meeting today, write a pre-brief: attendees, likely agenda, relevant email context, and 2–3 talking points. Be concise and practical.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'team-sentiment-pulse', name: 'Team sentiment pulse', description: '', cadence: '· Use',
    icon: <HeartIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Team sentiment pulse', description: 'Analyse internal communication for team health signals',
      status: 'draft', trigger: { type: 'schedule', cron: '0 9 * * 5', label: 'Fridays at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch internal emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Assess team sentiment', prompt: 'Analyse internal email tone and patterns to assess team sentiment: morale signals, blockers mentioned, wins celebrated, and anything that warrants a manager check-in.', output_format: 'markdown', model_tier: 'reasoning' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'weekly-pipeline-review', name: 'Weekly pipeline review', description: '', cadence: '· Use',
    icon: <FunnelIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Weekly pipeline review', description: 'Review deals and surface follow-ups needed this week',
      status: 'draft', trigger: { type: 'schedule', cron: '0 8 * * 1', label: 'Mondays at 8am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch recent emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Review pipeline', prompt: 'Review recent email threads to identify active deals, pending follow-ups, and stalled conversations. Summarise by stage with recommended next actions.', output_format: 'markdown', model_tier: 'reasoning' },
      ],
      output_config: { destination: 'artifact', artifact_type: 'document', title_template: 'Pipeline Review — {{week_of}}', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'executive-summary', name: 'Executive summary', description: '', cadence: '· Use',
    icon: <DocumentTextIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Executive summary', description: 'Condense the week\'s activity into an executive one-pager',
      status: 'draft', trigger: { type: 'schedule', cron: '0 17 * * 5', label: 'Fridays at 5pm' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch week emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write executive summary', prompt: 'Write a concise executive summary of this week: key decisions made, progress on priorities, risks surfaced, and what needs attention next week. Max one page.', output_format: 'markdown', model_tier: 'reasoning' },
      ],
      output_config: { destination: 'artifact', artifact_type: 'document', title_template: 'Executive Summary — {{week_of}}', notification_mode: 'inbox_card' },
    },
  },
];

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'sales-customer-update':     UsersIcon,
  'daily-news-brief':          NewspaperIcon,
  'board-metric-snapshot':     PresentationChartLineIcon,
  'competitive-intel-monitor': MagnifyingGlassIcon,
  'meeting-pre-brief':         CalendarDaysIcon,
  'team-sentiment-pulse':      HeartIcon,
  'weekly-pipeline-review':    FunnelIcon,
  'executive-summary':         DocumentTextIcon,
};

const TEMPLATE_COLORS: Record<string, { bg: string; icon: string }> = {
  'sales-customer-update':     { bg: 'bg-violet-100',  icon: 'text-violet-600' },
  'daily-news-brief':          { bg: 'bg-amber-100',   icon: 'text-amber-600'  },
  'board-metric-snapshot':     { bg: 'bg-emerald-100', icon: 'text-emerald-600'},
  'competitive-intel-monitor': { bg: 'bg-rose-100',    icon: 'text-rose-600'   },
  'meeting-pre-brief':         { bg: 'bg-blue-100',    icon: 'text-blue-600'   },
  'team-sentiment-pulse':      { bg: 'bg-pink-100',    icon: 'text-pink-600'   },
  'weekly-pipeline-review':    { bg: 'bg-indigo-100',  icon: 'text-indigo-600' },
  'executive-summary':         { bg: 'bg-sky-100',     icon: 'text-sky-600'    },
};

const IDEA_SUGGESTIONS = [
  'Monitor competitor news every morning',
  'Draft a weekly client status email',
  'Prepare me for tomorrow\'s meetings',
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  myWorkflows: Workflow[];
  teamWorkflows: Workflow[];
  userFirstName?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onUseTemplate: (template: WorkflowTemplate) => void;
  onGenerateFromDescription: (description: string) => Promise<void>;
  onPinWorkflow: (id: string, pinned: boolean) => void;
}

export function StudioHomeGrid({
  myWorkflows, teamWorkflows, userFirstName, onSelect, onCreate, onUseTemplate, onGenerateFromDescription, onPinWorkflow,
}: Props) {
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleGenerate() {
    if (!description.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      await onGenerateFromDescription(description.trim());
    } catch {
      setError('Couldn\'t build that workflow — try rephrasing.');
    } finally {
      setGenerating(false);
    }
  }

  const activeCount = myWorkflows.filter(w => w.status === 'active').length;
  const [featuredWorkflow, ...restWorkflows] = myWorkflows;
  const randomIdea = IDEA_SUGGESTIONS[0];

  return (
    <div className="flex-1 flex flex-col items-center overflow-y-auto px-6 py-8 bg-neutral-50/40">
      <div className="w-full max-w-[900px] flex flex-col gap-8">

        {/* Header label */}
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <BoltIcon className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[10.5px] font-bold text-indigo-500 uppercase tracking-widest">Agent Workflow Studio</span>
          </div>
          <h1 className="text-[24px] font-bold text-neutral-900 tracking-tight leading-tight">
            Build reusable workflows for your team
          </h1>
          <p className="text-[13.5px] text-neutral-500 mt-1.5 leading-relaxed">
            AUGMTD runs your workflows on schedule, acts on your emails, and prepares work before you ask.
          </p>
        </div>

        {/* Create input */}
        <div>
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white shadow-sm px-4 py-2.5 focus-within:border-indigo-300 focus-within:shadow transition-all">
            <SparklesIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={description}
              onChange={e => { setDescription(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); }}
              disabled={generating}
              placeholder="Describe a workflow to build…"
              className="flex-1 text-[13px] focus:outline-none placeholder:text-neutral-300 disabled:opacity-50 bg-transparent"
            />
            <button
              onClick={handleGenerate}
              disabled={!description.trim() || generating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-medium disabled:opacity-30 hover:bg-indigo-700 transition-colors flex-shrink-0"
            >
              {generating ? (
                <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <PlusIcon className="w-3.5 h-3.5" />
              )}
              Create
            </button>
          </div>
          {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}

          {/* An idea for you */}
          <div className="flex items-center gap-2 mt-2.5">
            <span className="text-[11.5px] text-neutral-400">An idea for you →</span>
            <button
              onClick={() => { setDescription(randomIdea); inputRef.current?.focus(); }}
              className="text-[11.5px] text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              {randomIdea}
            </button>
          </div>
        </div>

        {/* My Workflows section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-neutral-800">My workflows</span>
              {activeCount > 0 && (
                <span className="text-[11px] text-neutral-400">· {activeCount} active</span>
              )}
            </div>
            <button
              onClick={onCreate}
              className="flex items-center gap-1 text-[12px] text-neutral-500 hover:text-indigo-600 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              New workflow
            </button>
          </div>

          {myWorkflows.length === 0 ? (
            <button
              onClick={onCreate}
              className="w-full py-8 rounded-xl border border-dashed border-neutral-200 text-[12.5px] text-neutral-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
            >
              + Create your first workflow
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {featuredWorkflow && (
                <FeaturedWorkflowCard
                  workflow={featuredWorkflow}
                  onClick={() => onSelect(featuredWorkflow.id)}
                  onPin={() => onPinWorkflow(featuredWorkflow.id, !featuredWorkflow.pinned)}
                />
              )}
              {restWorkflows.map(w => (
                <WorkflowCard
                  key={w.id}
                  workflow={w}
                  onClick={() => onSelect(w.id)}
                  onPin={() => onPinWorkflow(w.id, !w.pinned)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Shared by team */}
        {teamWorkflows.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <UserGroupIcon className="w-4 h-4 text-neutral-400" />
              <span className="text-[13px] font-semibold text-neutral-800">Shared by team</span>
              <span className="text-[11px] text-neutral-400">· {teamWorkflows.length} workflow{teamWorkflows.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {teamWorkflows.map(w => (
                <WorkflowCard
                  key={w.id}
                  workflow={w}
                  onClick={() => onSelect(w.id)}
                  isTeam
                />
              ))}
            </div>
          </div>
        )}

        {/* Templates */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-[13px] font-semibold text-neutral-800">Start from a template</span>
              <span className="text-[11px] text-neutral-400 ml-2">· Pre-built blueprints</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {QUICK_TEMPLATES.map(t => {
              const TIcon = TEMPLATE_ICONS[t.id] ?? BoltIcon;
              const tColor = TEMPLATE_COLORS[t.id] ?? { bg: 'bg-neutral-100', icon: 'text-neutral-500' };
              return (
                <button key={t.id} onClick={() => onUseTemplate(t)}
                  className="flex items-start gap-2.5 px-3 py-3 rounded-xl border border-neutral-100 bg-white hover:border-indigo-200 hover:shadow-sm transition-all text-left group">
                  <div className={`w-7 h-7 rounded-lg ${tColor.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <TIcon className={`w-3.5 h-3.5 ${tColor.icon}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-neutral-700 leading-snug group-hover:text-neutral-900 transition-colors">{t.name}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Featured workflow card (spans 2 cols equivalent via min-h) ─────────────────

function FeaturedWorkflowCard({ workflow: w, onClick, onPin }: {
  workflow: Workflow; onClick: () => void; onPin: () => void;
}) {
  const colorBg = COLOR_MAP[w.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WIcon = ICON_MAP[w.icon ?? 'bolt'] ?? BoltIcon;
  const scheduleLabel = w.trigger?.type === 'schedule'
    ? ('cron' in w.trigger && w.trigger.cron ? cronsToHuman(w.trigger.cron) : 'Scheduled')
    : 'Manual';
  const { statusDot, statusText } = workflowStatus(w);
  const lastRun = w.last_run_at ? formatRelative(w.last_run_at) : null;

  return (
    <div
      className="group relative col-span-1 rounded-xl border border-neutral-150 bg-white shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer p-4 flex flex-col gap-3"
      onClick={onClick}
      style={{ borderColor: '#e8e8e8' }}
    >
      {/* Top row: icon + badges */}
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-xl ${colorBg} flex items-center justify-center flex-shrink-0`}>
          <WIcon className="w-[18px] h-[18px] text-white" />
        </div>
        <div className="flex items-center gap-1.5">
          {w.sharing_mode == null && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-neutral-100 text-[10px] font-medium text-neutral-500">
              <LockClosedIcon className="w-2.5 h-2.5" />
              Private
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onPin(); }}
            title={w.pinned ? 'Unpin' : 'Pin to favorites'}
            className={`p-1 rounded-md hover:bg-neutral-100 transition-opacity ${w.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            {w.pinned
              ? <StarSolidIcon className="w-3.5 h-3.5 text-amber-400" />
              : <StarOutlineIcon className="w-3.5 h-3.5 text-neutral-300" />
            }
          </button>
        </div>
      </div>

      {/* Name + schedule */}
      <div>
        <div className="text-[13.5px] font-semibold text-neutral-900 leading-snug mb-0.5">{w.name}</div>
        <div className="text-[11px] text-neutral-400">{scheduleLabel}</div>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-neutral-100">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span className="text-[11px] text-neutral-500">{statusText}</span>
        </div>
        {lastRun && (
          <span className="text-[10.5px] text-neutral-400">{lastRun}</span>
        )}
      </div>
    </div>
  );
}

// ── Standard workflow card ─────────────────────────────────────────────────────

function WorkflowCard({ workflow: w, onClick, onPin, isTeam }: {
  workflow: Workflow; onClick: () => void; onPin?: () => void; isTeam?: boolean;
}) {
  const colorBg = COLOR_MAP[w.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WIcon = ICON_MAP[w.icon ?? 'bolt'] ?? BoltIcon;
  const scheduleLabel = w.trigger?.type === 'schedule'
    ? ('cron' in w.trigger && w.trigger.cron ? cronsToHuman(w.trigger.cron) : 'Scheduled')
    : 'Manual';
  const { statusDot, statusText } = workflowStatus(w);
  const lastRun = w.last_run_at ? formatRelative(w.last_run_at) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="group relative rounded-xl border bg-white hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer p-3.5 flex flex-col gap-2.5"
      style={{ borderColor: '#e8e8e8' }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className={`w-8 h-8 rounded-lg ${colorBg} flex items-center justify-center flex-shrink-0`}>
          <WIcon className="w-4 h-4 text-white" />
        </div>
        {onPin && (
          <button
            onClick={e => { e.stopPropagation(); onPin(); }}
            title={w.pinned ? 'Unpin' : 'Pin to favorites'}
            className={`p-0.5 rounded hover:bg-neutral-100 transition-opacity ${w.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            {w.pinned
              ? <StarSolidIcon className="w-3 h-3 text-amber-400" />
              : <StarOutlineIcon className="w-3 h-3 text-neutral-300" />
            }
          </button>
        )}
      </div>

      {/* Name */}
      <div>
        <div className="text-[12.5px] font-semibold text-neutral-800 leading-snug truncate">{w.name}</div>
        {isTeam && w.owner_name ? (
          <div className="text-[10.5px] text-neutral-400 mt-0.5">by {w.owner_name}</div>
        ) : (
          <div className="text-[10.5px] text-neutral-400 mt-0.5">{scheduleLabel}</div>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5 mt-auto pt-2 border-t border-neutral-100">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
        <span className="text-[10.5px] text-neutral-500 truncate">{statusText}</span>
        {lastRun && (
          <span className="text-[10px] text-neutral-400 ml-auto flex-shrink-0">{lastRun}</span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function workflowStatus(w: Workflow): { statusDot: string; statusText: string } {
  if (w.status === 'active') return { statusDot: 'bg-emerald-400', statusText: 'Active' };
  if (w.status === 'paused') return { statusDot: 'bg-amber-400', statusText: 'Paused' };
  return { statusDot: 'bg-neutral-200', statusText: 'Draft' };
}

function formatRelative(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function cronsToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;
  const [, hr, dom, , dow] = parts;
  if (hr === '*') return 'Every hour';
  if (hr.includes('/')) return `Every ${hr.split('/')[1]}h`;
  const h = parseInt(hr, 10);
  const hLabel = isNaN(h) ? hr : `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`;
  if (dom !== '*') return `Monthly · ${hLabel}`;
  if (dow === '*') return `Daily · ${hLabel}`;
  if (dow === '1-5') return `Weekdays · ${hLabel}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNames = dow.split(',').map(d => days[parseInt(d)] ?? d).join(', ');
  return `${dayNames} · ${hLabel}`;
}
