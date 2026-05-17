'use client';

import { useState, useRef } from 'react';
import {
  PlusIcon,
  PaperAirplaneIcon,
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
  ChartPieIcon,
  HeartIcon,
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

const COLOR_BAR_MAP: Record<string, string> = {
  indigo: 'bg-indigo-400', violet: 'bg-violet-400', blue: 'bg-blue-400',
  emerald: 'bg-emerald-400', amber: 'bg-amber-400', rose: 'bg-rose-400', neutral: 'bg-neutral-400',
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

const SUGGESTIONS = [
  'Create a weekly client briefing',
  'Monitor legal AI news',
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  function handleSuggestion(text: string) {
    setDescription(text);
    inputRef.current?.focus();
  }

  const headline = userFirstName ? `Good to see you, ${userFirstName}` : 'Automate your work';
  const pinnedWorkflows = [...myWorkflows, ...teamWorkflows].filter(w => w.pinned);
  const [featuredWorkflow, ...restWorkflows] = myWorkflows;

  return (
    <div className="flex-1 flex flex-col items-center overflow-y-auto px-4 py-8">
      <div className="w-full max-w-[1060px] flex flex-col gap-6">

        {/* Headline */}
        <div className="text-center">
          <h1 className="text-[21px] font-semibold text-neutral-800 tracking-tight">{headline}</h1>
          <p className="text-[13px] text-neutral-400 mt-1">
            Pick a workflow, create a new one, or ask AUGMTD to build one for you.
          </p>
        </div>

        {/* AI input */}
        <div>
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden focus-within:border-indigo-300 focus-within:shadow-md transition-all">
            {/* Text area */}
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={description}
              onChange={e => { setDescription(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleGenerate(); } }}
              disabled={generating}
              placeholder="Describe a workflow you want to delegate…"
              rows={3}
              className="w-full px-4 pt-4 pb-2 text-[13px] resize-none focus:outline-none placeholder:text-neutral-300 disabled:opacity-50 bg-transparent leading-relaxed"
            />
            {/* Bottom bar: hint + send button */}
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-1.5">
                <SparklesIcon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                <span className="text-[11.5px] text-neutral-400">AUGMTD will design and explain it before saving.</span>
              </div>
              {generating ? (
                <div className="w-7 h-7 rounded-full bg-neutral-200 flex items-center justify-center flex-shrink-0">
                  <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-pulse" />
                </div>
              ) : (
                <button onClick={handleGenerate} disabled={!description.trim()}
                  className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-25 hover:bg-indigo-700 transition-colors flex-shrink-0">
                  <PaperAirplaneIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
          {/* Suggestion pills */}
          <div className="flex flex-wrap gap-2 mt-2.5">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                className="px-3 py-1 rounded-full border border-neutral-200 bg-white text-[12px] text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Favorites strip */}
        {pinnedWorkflows.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <StarSolidIcon className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-semibold text-neutral-600">Favorites</span>
              <span className="text-[11px] text-neutral-300">· Pinned for quick access</span>
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {pinnedWorkflows.map(w => (
                <FavoriteCard
                  key={w.id}
                  workflow={w}
                  onClick={() => onSelect(w.id)}
                  onUnpin={() => onPinWorkflow(w.id, false)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Three-column grid: Templates (1/3) | My workflows spanning 2/3 */}
        <div className="grid grid-cols-3 gap-5 items-start">

          {/* Col 1: Templates */}
          <div>
            <div className="h-7 flex items-center mb-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">Templates</span>
            </div>
            <div className="grid grid-cols-2 gap-0.5">
              {QUICK_TEMPLATES.map(t => {
                const TIcon = TEMPLATE_ICONS[t.id] ?? BoltIcon;
                const tColor = TEMPLATE_COLORS[t.id] ?? { bg: 'bg-neutral-100', icon: 'text-neutral-500' };
                return (
                  <button key={t.id} onClick={() => onUseTemplate(t)}
                    className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-neutral-50 transition-colors text-left">
                    <div className={`w-6 h-6 rounded-md ${tColor.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <TIcon className={`w-3.5 h-3.5 ${tColor.icon}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-medium text-neutral-700 leading-snug">{t.name}</div>
                      <div className="text-[10px] text-neutral-400 mt-0.5">{t.cadence}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Col 2+3: My Workflows */}
          <div className="col-span-2">
            {/* Header — same height as templates header for alignment */}
            <div className="h-7 flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">My workflows</span>
                <button onClick={onCreate}
                  className="inline-flex items-center gap-1 text-[11.5px] text-neutral-400 hover:text-neutral-700 transition-colors">
                  <PlusIcon className="w-3 h-3" />
                  New
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <UserGroupIcon className="w-3 h-3 text-neutral-300" />
                <span className="text-[11px] text-neutral-400">Team</span>
                <span className="text-[10px] text-neutral-300 mx-0.5">·</span>
                <span className="text-[11px] text-neutral-400">Shared</span>
              </div>
            </div>

            {myWorkflows.length === 0 && teamWorkflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <p className="text-[12.5px] text-neutral-400">No workflows yet</p>
                <button onClick={onCreate} className="mt-2 text-[12px] text-indigo-500 hover:text-indigo-700 transition-colors">
                  Create one →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">

                {/* Personal workflows */}
                <div className="space-y-1.5">
                  {myWorkflows.length === 0 ? (
                    <button onClick={onCreate}
                      className="w-full text-center py-6 rounded-xl border border-dashed border-neutral-200 text-[12px] text-neutral-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors">
                      + Create workflow
                    </button>
                  ) : (
                    <>
                      {featuredWorkflow && (
                        <FeaturedWorkflowCard
                          workflow={featuredWorkflow}
                          onClick={() => onSelect(featuredWorkflow.id)}
                          onPin={() => onPinWorkflow(featuredWorkflow.id, !featuredWorkflow.pinned)}
                        />
                      )}
                      {restWorkflows.map(w => (
                        <WorkflowRow
                          key={w.id}
                          workflow={w}
                          onClick={() => onSelect(w.id)}
                          onPin={() => onPinWorkflow(w.id, !w.pinned)}
                        />
                      ))}
                    </>
                  )}
                </div>

                {/* Team workflows */}
                <div className="space-y-1.5">
                  {teamWorkflows.length === 0 ? (
                    <p className="text-[12px] text-neutral-300 py-2 px-1">No shared workflows yet</p>
                  ) : (
                    teamWorkflows.map(w => (
                      <TeamWorkflowCard
                        key={w.id}
                        workflow={w}
                        onClick={() => onSelect(w.id)}
                      />
                    ))
                  )}
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Favorite card (pinned strip) ──────────────────────────────────────────────

function FavoriteCard({ workflow: w, onClick, onUnpin }: {
  workflow: Workflow; onClick: () => void; onUnpin: () => void;
}) {
  const colorBg = COLOR_MAP[w.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WIcon = ICON_MAP[w.icon ?? 'bolt'] ?? BoltIcon;
  const triggerLabel = w.trigger?.type === 'schedule'
    ? ('cron' in w.trigger && w.trigger.cron ? cronsToHuman(w.trigger.cron) : 'Scheduled')
    : 'Manual';

  return (
    <div
      className="group relative flex-shrink-0 w-[160px] rounded-xl border border-neutral-100 hover:border-neutral-200 hover:shadow-sm bg-white transition-all cursor-pointer p-3"
      onClick={onClick}
    >
      <div className={`w-8 h-8 rounded-lg ${colorBg} flex items-center justify-center mb-2`}>
        <WIcon className="w-4 h-4 text-white" />
      </div>
      <div className="text-[12.5px] font-medium text-neutral-800 leading-snug line-clamp-2 mb-0.5 pr-4">{w.name}</div>
      <div className="text-[11px] text-neutral-400">{triggerLabel}</div>
      <button
        onClick={e => { e.stopPropagation(); onUnpin(); }}
        title="Unpin"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-neutral-100"
      >
        <StarSolidIcon className="w-3 h-3 text-amber-400" />
      </button>
    </div>
  );
}

// ── Featured workflow card (Mine column) ──────────────────────────────────────

function FeaturedWorkflowCard({ workflow: w, onClick, onPin }: {
  workflow: Workflow; onClick: () => void; onPin: () => void;
}) {
  const colorBg = COLOR_MAP[w.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WIcon = ICON_MAP[w.icon ?? 'bolt'] ?? BoltIcon;
  const triggerLabel = w.trigger?.type === 'schedule'
    ? ('cron' in w.trigger && w.trigger.cron ? cronsToHuman(w.trigger.cron) : 'Scheduled')
    : 'Manual';

  return (
    <div
      className="group relative rounded-xl border border-neutral-100 hover:border-neutral-200 hover:shadow-sm bg-white transition-all cursor-pointer p-3.5"
      onClick={onClick}
    >
      <div className="flex items-start gap-3 mb-2.5">
        <div className={`w-8 h-8 rounded-lg ${colorBg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          <WIcon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0 pr-5">
          <div className="text-[13px] font-semibold text-neutral-800 leading-snug">{w.name}</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">{triggerLabel}</div>
        </div>
      </div>
      {w.description && (
        <p className="text-[11.5px] text-neutral-500 leading-relaxed line-clamp-3 mb-2">{w.description}</p>
      )}
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${w.status === 'active' ? 'bg-emerald-400' : 'bg-neutral-200'}`} />
        <span className="text-[10.5px] text-neutral-400">{w.status === 'active' ? 'Active' : w.status === 'paused' ? 'Paused' : 'Draft'}</span>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onPin(); }}
        title={w.pinned ? 'Unpin from favorites' : 'Pin to favorites'}
        className={`absolute top-2.5 right-2.5 p-1 rounded-md hover:bg-neutral-100 transition-opacity ${w.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        {w.pinned
          ? <StarSolidIcon className="w-3.5 h-3.5 text-amber-400" />
          : <StarOutlineIcon className="w-3.5 h-3.5 text-neutral-300" />
        }
      </button>
    </div>
  );
}

// ── Workflow row (Mine column — compact) ──────────────────────────────────────

function WorkflowRow({ workflow: w, onClick, onPin }: {
  workflow: Workflow; onClick: () => void; onPin?: () => void;
}) {
  const colorBg = COLOR_MAP[w.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WIcon = ICON_MAP[w.icon ?? 'bolt'] ?? BoltIcon;
  const triggerLabel = w.trigger?.type === 'schedule'
    ? ('cron' in w.trigger && w.trigger.cron ? cronsToHuman(w.trigger.cron) : 'Scheduled')
    : 'Manual';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-neutral-50 transition-colors text-left group cursor-pointer"
    >
      <div className={`w-6 h-6 rounded-md ${colorBg} flex items-center justify-center flex-shrink-0`}>
        <WIcon className="w-3 h-3 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-neutral-800 truncate">{w.name}</div>
        <div className="text-[10.5px] text-neutral-400">{triggerLabel}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onPin && (
          <button
            onClick={e => { e.stopPropagation(); onPin(); }}
            title={w.pinned ? 'Unpin' : 'Pin to favorites'}
            className={`p-0.5 rounded hover:bg-neutral-100 transition-opacity ${w.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            {w.pinned
              ? <StarSolidIcon className="w-2.5 h-2.5 text-amber-400" />
              : <StarOutlineIcon className="w-2.5 h-2.5 text-neutral-300" />
            }
          </button>
        )}
        <span className={`w-1.5 h-1.5 rounded-full ${w.status === 'active' ? 'bg-emerald-400' : 'bg-neutral-200'}`} />
      </div>
    </div>
  );
}

// ── Team workflow card (Team column) ──────────────────────────────────────────

function TeamWorkflowCard({ workflow: w, onClick }: {
  workflow: Workflow; onClick: () => void;
}) {
  const colorBg = COLOR_MAP[w.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WIcon = ICON_MAP[w.icon ?? 'bolt'] ?? BoltIcon;
  const triggerLabel = w.trigger?.type === 'schedule'
    ? ('cron' in w.trigger && w.trigger.cron ? cronsToHuman(w.trigger.cron) : 'Scheduled')
    : 'Manual';

  return (
    <div
      className="group relative rounded-xl border border-neutral-100 hover:border-neutral-200 hover:shadow-sm bg-white transition-all cursor-pointer p-3.5"
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5 mb-2">
        <div className={`w-7 h-7 rounded-lg ${colorBg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          <WIcon className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-neutral-800 leading-snug">{w.name}</div>
          {w.owner_name && (
            <div className="text-[10.5px] text-neutral-400 mt-0.5">Shared by {w.owner_name}</div>
          )}
        </div>
      </div>
      {w.description && (
        <p className="text-[11px] text-neutral-500 leading-snug line-clamp-2 mb-1.5">{w.description}</p>
      )}
      <div className="text-[10.5px] text-neutral-400">{triggerLabel}</div>
    </div>
  );
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
