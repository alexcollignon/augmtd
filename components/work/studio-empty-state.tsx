'use client';

import { EnvelopeIcon, CalendarIcon, DocumentTextIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type { Workflow } from '@/lib/workflows/types';
import { makeStepId } from '@/lib/workflows/types';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  cadence: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  workflow: Omit<Workflow, 'id' | 'user_id' | 'icon' | 'color' | 'last_run_at' | 'next_run_at' | 'created_at' | 'updated_at'>;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'morning-briefing',
    name: 'Morning briefing',
    description: 'Urgent emails summarised into a concise daily briefing',
    cadence: 'Daily at 8am',
    icon: <EnvelopeIcon className="w-4 h-4" />,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-500',
    workflow: {
      name: 'Morning briefing',
      description: 'Summarise urgent emails into a daily briefing',
      status: 'draft',
      trigger: { type: 'schedule', cron: '0 8 * * *', label: 'Daily at 8am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch urgent emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write morning briefing', prompt: 'You have been given a list of urgent unread emails. Write a concise morning briefing summarising the key items requiring attention today, grouped by priority. Use clear headings and bullet points.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'meeting-prep',
    name: 'Meeting prep',
    description: 'Talking points and context for today\'s upcoming meetings',
    cadence: 'Daily at 7am',
    icon: <CalendarIcon className="w-4 h-4" />,
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-500',
    workflow: {
      name: 'Meeting prep',
      description: 'Prepare notes for today\'s meetings',
      status: 'draft',
      trigger: { type: 'schedule', cron: '0 7 * * *', label: 'Daily at 7am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch today\'s calendar', tool: 'get_calendar', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write prep notes', prompt: 'You have been given a list of upcoming meetings. For each meeting today, write brief preparation notes: who is attending, likely agenda based on the title, and 2–3 suggested talking points or questions. Be concise and practical.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'weekly-roundup',
    name: 'Weekly roundup',
    description: 'Email activity reviewed and action items surfaced as a document',
    cadence: 'Mondays at 9am',
    icon: <DocumentTextIcon className="w-4 h-4" />,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    workflow: {
      name: 'Weekly roundup',
      description: 'Review emails and surface key action items',
      status: 'draft',
      trigger: { type: 'schedule', cron: '0 9 * * 1', label: 'Mondays at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Fetch unread emails', tool: 'get_urgent_emails', config: {} },
        { id: makeStepId(), type: 'ai', label: 'Write weekly roundup', prompt: 'You have been given recent unread emails. Write a weekly roundup that: (1) highlights the most important threads, (2) lists clear action items with owners, (3) notes anything that can be archived or ignored. Format as a clean, scannable document.', output_format: 'markdown', model_tier: 'reasoning' },
      ],
      output_config: { destination: 'artifact', artifact_type: 'document', title_template: 'Weekly Roundup — {{week_of}}', notification_mode: 'inbox_card' },
    },
  },
  {
    id: 'news-pulse',
    name: 'News pulse',
    description: 'Web search curated into a daily industry news digest',
    cadence: 'Daily at 9am',
    icon: <MagnifyingGlassIcon className="w-4 h-4" />,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    workflow: {
      name: 'News pulse',
      description: 'Search the web and curate a daily news digest',
      status: 'draft',
      trigger: { type: 'schedule', cron: '0 9 * * *', label: 'Daily at 9am' },
      steps: [
        { id: makeStepId(), type: 'tool', label: 'Search latest news', tool: 'web_search', config: { query: 'latest business news today' } },
        { id: makeStepId(), type: 'ai', label: 'Curate news digest', prompt: 'You have been given web search results. Curate a concise news digest with the 5 most relevant items. For each: headline, 1-sentence summary, and why it matters. Skip duplicates and low-quality sources.', output_format: 'markdown', model_tier: 'fast' },
      ],
      output_config: { destination: 'thread_message', notification_mode: 'inbox_card' },
    },
  },
];

interface Props {
  onCreate: () => void;
  onUseTemplate: (template: WorkflowTemplate) => void;
}

export function StudioEmptyState({ onCreate, onUseTemplate }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-16">
      <div className="w-full max-w-[520px]">

        {/* Heading */}
        <h1 className="text-[22px] font-semibold text-neutral-700 tracking-tight mb-1.5">
          Automate your work
        </h1>
        <p className="text-[13.5px] text-neutral-400 mb-8 leading-relaxed">
          Workflows run on a schedule and push prepared work to your inbox.
        </p>

        {/* Template cards */}
        <div className="grid grid-cols-2 gap-2.5">
          {WORKFLOW_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onUseTemplate(t)}
              className="group text-left p-4 rounded-2xl border border-neutral-100 bg-white hover:border-neutral-200 hover:shadow-sm transition-all"
            >
              <div className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${t.iconBg} ${t.iconColor} mb-3`}>
                {t.icon}
              </div>
              <div className="text-[13px] font-semibold text-neutral-800 leading-snug mb-1">
                {t.name}
              </div>
              <div className="text-[12px] text-neutral-500 leading-snug mb-3">
                {t.description}
              </div>
              <div className="text-[11px] font-medium text-neutral-400">
                {t.cadence}
              </div>
            </button>
          ))}
        </div>

        {/* Start from scratch */}
        <div className="mt-5 text-center">
          <button
            onClick={onCreate}
            className="text-[12.5px] text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Start from scratch →
          </button>
        </div>

      </div>
    </div>
  );
}
