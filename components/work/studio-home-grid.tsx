'use client';

import { useState } from 'react';
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
} from '@heroicons/react/24/outline';
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
    id: 'morning-briefing', name: 'Morning briefing', description: '', cadence: 'Daily at 8am',
    icon: <EnvelopeIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Morning briefing', description: 'Summarise urgent emails into a daily briefing',
      status: 'draft', trigger: { type: 'schedule', cron: '0 8 * * *', label: 'Daily at 8am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch urgent emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write morning briefing', prompt: 'Write a concise morning briefing summarising key items requiring attention today, grouped by priority.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'meeting-prep', name: 'Meeting prep', description: '', cadence: 'Daily at 7am',
    icon: <CalendarDaysIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Meeting prep', description: 'Prepare notes for today\'s meetings',
      status: 'draft', trigger: { type: 'schedule', cron: '0 7 * * *', label: 'Daily at 7am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch today\'s calendar', tool: 'get_calendar', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write prep notes', prompt: 'For each meeting today, write brief preparation notes: attendees, likely agenda, and 2–3 talking points.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'weekly-roundup', name: 'Weekly roundup', description: '', cadence: 'Mondays 9am',
    icon: <DocumentTextIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'Weekly roundup', description: 'Review emails and surface key action items',
      status: 'draft', trigger: { type: 'schedule', cron: '0 9 * * 1', label: 'Mondays at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch unread emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write weekly roundup', prompt: 'Write a weekly roundup with the most important threads, clear action items, and anything to archive.', output_format: 'markdown', model_tier: 'reasoning' },
      ],
      output_config: { destination: 'artifact', artifact_type: 'document', title_template: 'Weekly Roundup — {{week_of}}', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'news-pulse', name: 'News pulse', description: '', cadence: 'Daily at 9am',
    icon: <MagnifyingGlassIcon className="w-4 h-4" />, iconBg: '', iconColor: '',
    workflow: {
      name: 'News pulse', description: 'Search the web and curate a daily news digest',
      status: 'draft', trigger: { type: 'schedule', cron: '0 9 * * *', label: 'Daily at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Search latest news', tool: 'web_search', config: { query: 'latest business news today' } },
        { id: makeStepId(), type: 'ai', label: 'Curate news digest', prompt: 'Curate a concise news digest with the 5 most relevant items — headline, 1-sentence summary, and why it matters.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
];

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'morning-briefing': EnvelopeIcon,
  'meeting-prep':     CalendarDaysIcon,
  'weekly-roundup':   DocumentTextIcon,
  'news-pulse':       MagnifyingGlassIcon,
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  myWorkflows: Workflow[];
  teamWorkflows: Workflow[];
  userFirstName?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onUseTemplate: (template: WorkflowTemplate) => void;
  onGenerateFromDescription: (description: string) => Promise<void>;
}

export function StudioHomeGrid({
  myWorkflows, teamWorkflows, userFirstName, onSelect, onCreate, onUseTemplate, onGenerateFromDescription,
}: Props) {
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const hasWorkflows = myWorkflows.length > 0 || teamWorkflows.length > 0;
  const headline = userFirstName ? `Good to see you, ${userFirstName}` : 'Automate your work';

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-[640px] flex flex-col gap-6">

        {/* Headline */}
        <div className="text-center">
          <h1 className="text-[20px] font-semibold text-neutral-800 tracking-tight">{headline}</h1>
          <p className="text-[13px] text-neutral-400 mt-1">
            {hasWorkflows ? 'Pick a workflow or describe a new one.' : 'Describe what you want to automate.'}
          </p>
        </div>

        {/* NL generation input — always primary */}
        <div>
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden focus-within:border-indigo-300 focus-within:shadow-md transition-all">
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleGenerate(); } }}
              disabled={generating}
              placeholder="Describe a workflow to build…"
              rows={2}
              className="w-full px-4 pt-3.5 pb-1.5 text-[13px] resize-none focus:outline-none placeholder:text-neutral-300 disabled:opacity-50 bg-transparent leading-relaxed"
            />
            <div className="flex items-center justify-end px-3 pb-2.5">
              {generating ? (
                <div className="w-6 h-6 rounded-full bg-neutral-200 flex items-center justify-center">
                  <span className="w-1 h-1 bg-neutral-400 rounded-full animate-pulse" />
                </div>
              ) : (
                <button onClick={handleGenerate} disabled={!description.trim()}
                  className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-25 hover:bg-indigo-700 transition-colors">
                  <PaperAirplaneIcon className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
        </div>

        {/* Two-column: Workflows + Templates */}
        <div className={`grid gap-6 ${hasWorkflows ? 'grid-cols-2' : 'grid-cols-1'}`}>

          {/* Workflows column */}
          {hasWorkflows && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">Workflows</span>
                <button onClick={onCreate}
                  className="inline-flex items-center gap-1 text-[11.5px] text-neutral-400 hover:text-neutral-700 transition-colors">
                  <PlusIcon className="w-3 h-3" />
                  New
                </button>
              </div>
              <div className="space-y-0.5">
                {myWorkflows.map(w => <WorkflowRow key={w.id} workflow={w} onClick={() => onSelect(w.id)} />)}
                {teamWorkflows.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5 pt-2 pb-1">
                      <UsersIcon className="w-3 h-3 text-neutral-300" />
                      <span className="text-[10.5px] font-semibold text-neutral-300 uppercase tracking-widest">Team</span>
                    </div>
                    {teamWorkflows.map(w => <WorkflowRow key={w.id} workflow={w} onClick={() => onSelect(w.id)} showOwner />)}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Templates column */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">Templates</span>
            </div>
            <div className="space-y-0.5">
              {QUICK_TEMPLATES.map(t => {
                const TIcon = TEMPLATE_ICONS[t.id] ?? BoltIcon;
                return (
                  <button key={t.id} onClick={() => onUseTemplate(t)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-neutral-50 transition-colors text-left">
                    <div className="w-6 h-6 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <TIcon className="w-3.5 h-3.5 text-neutral-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-neutral-700 truncate">{t.name}</div>
                      <div className="text-[11px] text-neutral-400">{t.cadence}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {!hasWorkflows && (
              <div className="mt-4 text-center">
                <button onClick={onCreate} className="text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors">
                  Start from scratch →
                </button>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}

// ── Workflow row ──────────────────────────────────────────────────────────────

function WorkflowRow({ workflow: w, onClick, showOwner }: {
  workflow: Workflow; onClick: () => void; showOwner?: boolean;
}) {
  const colorBg = COLOR_MAP[w.color ?? 'indigo'] ?? 'bg-indigo-500';
  const WIcon = ICON_MAP[w.icon ?? 'bolt'] ?? BoltIcon;
  const triggerLabel = w.trigger?.type === 'schedule'
    ? ('cron' in w.trigger && w.trigger.cron ? cronsToHuman(w.trigger.cron) : 'Scheduled')
    : 'Manual';

  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 transition-colors text-left group">
      <div className={`w-7 h-7 rounded-lg ${colorBg} flex items-center justify-center flex-shrink-0`}>
        <WIcon className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-neutral-800 truncate">
          {w.name}
          {showOwner && w.owner_name && (
            <span className="ml-1.5 text-[11px] text-neutral-400 font-normal">by {w.owner_name}</span>
          )}
        </div>
        <div className="text-[11px] text-neutral-400">{triggerLabel}</div>
      </div>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${w.status === 'active' ? 'bg-emerald-400' : 'bg-neutral-200'}`} />
    </button>
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
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNames = dow.split(',').map(d => days[parseInt(d)] ?? d).join(', ');
  return `${dayNames} · ${hLabel}`;
}
