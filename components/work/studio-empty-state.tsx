'use client';

import { useState } from 'react';
import { PaperAirplaneIcon, EnvelopeIcon, CalendarIcon, DocumentTextIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
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
  onGenerateFromDescription: (description: string) => Promise<void>;
}

export function StudioEmptyState({ onCreate, onUseTemplate, onGenerateFromDescription }: Props) {
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-16">
      <div className="w-full max-w-[540px]">

        {/* Heading */}
        <div className="animate-prompt-in" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
          <h1 className="text-[26px] font-semibold text-neutral-800 tracking-tight mb-1.5 text-center">
            Automate your work
          </h1>
          <p className="text-[13.5px] text-neutral-400 mb-8 leading-relaxed text-center">
            Describe what to automate — the AI builds the workflow for you to review.
          </p>
        </div>

        {/* Generate from description — chat-input-bar style */}
        <div className="mb-8 animate-prompt-in" style={{ animationDelay: '60ms', animationFillMode: 'both' }}>
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden focus-within:border-indigo-300 focus-within:shadow-md transition-all">
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); setError(null); }}
              onKeyDown={handleKeyDown}
              disabled={generating}
              placeholder="e.g. Every Monday, search for AI news in Germany and Portugal and send me a 5-bullet digest"
              rows={3}
              className="w-full px-4 pt-4 pb-2 text-[13.5px] resize-none focus:outline-none placeholder:text-neutral-300 disabled:opacity-50 leading-relaxed bg-transparent"
            />
            <div className="flex items-center justify-end px-4 pb-3 pt-1">
              {generating ? (
                <div className="w-7 h-7 rounded-full bg-neutral-200 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-pulse" />
                </div>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!description.trim()}
                  className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
                >
                  <PaperAirplaneIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {error && (
            <p className="mt-2 text-[12px] text-red-500 px-1">{error}</p>
          )}
        </div>

        {/* Templates */}
        <div className="mb-6 animate-prompt-in" style={{ animationDelay: '120ms', animationFillMode: 'both' }}>
          <div className="grid grid-cols-2 gap-2">
            {WORKFLOW_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => onUseTemplate(t)}
                className="group text-left p-4 rounded-2xl bg-neutral-50 hover:bg-neutral-100 transition-colors"
              >
                <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${t.iconBg} ${t.iconColor} mb-3`}>
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
        </div>

        {/* Start from scratch */}
        <div className="text-center animate-prompt-in" style={{ animationDelay: '180ms', animationFillMode: 'both' }}>
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
