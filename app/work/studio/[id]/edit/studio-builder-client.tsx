'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  BoltIcon,
  WrenchScrewdriverIcon,
  SparklesIcon,
  UserCircleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckIcon,
  InformationCircleIcon,
  XMarkIcon,
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
} from '@heroicons/react/24/outline';
import type {
  Workflow, WorkflowStep, WorkflowTrigger, OutputConfig,
  ToolStep, AIStep, AgentStep,
} from '@/lib/workflows/types';
import { makeStepId } from '@/lib/workflows/types';
import { CRON_PRESETS } from '@/lib/workflows/schedule';

interface AgentOption {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
}

interface Props {
  userId: string;
  initialWorkflow: Workflow;
  agents: AgentOption[];
}

const WORKFLOW_ICONS = [
  { key: 'bolt',                     Icon: BoltIcon },
  { key: 'clock',                    Icon: ClockIcon },
  { key: 'envelope',                 Icon: EnvelopeIcon },
  { key: 'calendar-days',            Icon: CalendarDaysIcon },
  { key: 'document-text',            Icon: DocumentTextIcon },
  { key: 'magnifying-glass',         Icon: MagnifyingGlassIcon },
  { key: 'chart-bar',                Icon: ChartBarIcon },
  { key: 'arrow-path',               Icon: ArrowPathIcon },
  { key: 'newspaper',                Icon: NewspaperIcon },
  { key: 'globe-alt',                Icon: GlobeAltIcon },
  { key: 'table-cells',              Icon: TableCellsIcon },
  { key: 'inbox',                    Icon: InboxIcon },
  { key: 'megaphone',                Icon: MegaphoneIcon },
  { key: 'funnel',                   Icon: FunnelIcon },
  { key: 'presentation-chart-line',  Icon: PresentationChartLineIcon },
  { key: 'briefcase',                Icon: BriefcaseIcon },
  { key: 'cpu-chip',                 Icon: CpuChipIcon },
  { key: 'book-open',                Icon: BookOpenIcon },
];

const WORKFLOW_COLORS = [
  { key: 'indigo',  bg: 'bg-indigo-500',  ring: 'ring-indigo-500'  },
  { key: 'violet',  bg: 'bg-violet-500',  ring: 'ring-violet-500'  },
  { key: 'blue',    bg: 'bg-blue-500',    ring: 'ring-blue-500'    },
  { key: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { key: 'amber',   bg: 'bg-amber-500',   ring: 'ring-amber-500'   },
  { key: 'rose',    bg: 'bg-rose-500',    ring: 'ring-rose-500'    },
  { key: 'neutral', bg: 'bg-neutral-500', ring: 'ring-neutral-500' },
];

const AVAILABLE_TOOLS = [
  { id: 'get_urgent_emails', label: 'Fetch urgent unread emails', description: 'Pulls unread items from your inbox with sender, subject, preview.' },
  { id: 'get_calendar',      label: 'Fetch upcoming calendar',   description: 'Returns your next meetings with attendees and times.' },
  { id: 'read_kb_file',      label: 'Read a knowledge base file', description: 'Returns the full content of one KB file by id.' },
  { id: 'web_search',        label: 'Search the web',            description: 'Runs a web search (requires TAVILY_API_KEY to be set).' },
];

export function StudioBuilderClient({ initialWorkflow, agents }: Props) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [enhancingStepId, setEnhancingStepId] = useState<string | null>(null);
  const [enhancePendingStepId, setEnhancePendingStepId] = useState<string | null>(null);
  const [showStepsHelp, setShowStepsHelp] = useState(false);

  const patch = useCallback(<K extends keyof Workflow>(key: K, value: Workflow[K]) => {
    setWorkflow(w => ({ ...w, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: workflow.name,
          description: workflow.description,
          icon: workflow.icon,
          color: workflow.color,
          trigger: workflow.trigger,
          steps: workflow.steps,
          output_config: workflow.output_config,
          status: workflow.status,
        }),
      });
      if (res.ok) {
        const { workflow: saved } = await res.json();
        setWorkflow(saved);
        setSavedAt(new Date());
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Save failed' }));
        alert(error);
      }
    } finally {
      setSaving(false);
    }
  }, [workflow]);

  const saveAndClose = useCallback(async () => {
    await save();
    router.push(`/work?section=studio&workflow=${workflow.id}`);
  }, [save, router, workflow.id]);

  // Step manipulation
  const addStep = useCallback((type: WorkflowStep['type']) => {
    const base = { id: makeStepId() };
    let step: WorkflowStep;
    if (type === 'tool') {
      step = { ...base, type: 'tool', label: 'New tool step', tool: 'get_urgent_emails', config: {} } as ToolStep;
    } else if (type === 'ai') {
      step = { ...base, type: 'ai', label: 'New AI step', prompt: '', output_format: 'markdown', model_tier: 'fast' } as AIStep;
    } else {
      step = { ...base, type: 'agent', label: 'New agent step', agent_id: agents[0]?.id ?? '', prompt: '' } as AgentStep;
    }
    setWorkflow(w => ({ ...w, steps: [...w.steps, step] }));
  }, [agents]);

  const updateStep = useCallback((idx: number, partial: Partial<WorkflowStep>) => {
    setWorkflow(w => ({
      ...w,
      steps: w.steps.map((s, i) => i === idx ? ({ ...s, ...partial } as WorkflowStep) : s),
    }));
  }, []);

  const removeStep = useCallback((idx: number) => {
    setWorkflow(w => ({ ...w, steps: w.steps.filter((_, i) => i !== idx) }));
  }, []);

  const moveStep = useCallback((idx: number, delta: -1 | 1) => {
    setWorkflow(w => {
      const steps = [...w.steps];
      const target = idx + delta;
      if (target < 0 || target >= steps.length) return w;
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...w, steps };
    });
  }, []);

  const handleEnhanceStep = useCallback(async (
    stepId: string,
    prompt: string,
    stepLabel: string,
    context: { step_type: 'ai' | 'tool' | 'agent'; tool_type?: string; output_format?: string; model_tier?: string; field: 'prompt' | 'query' },
  ) => {
    if (!prompt.trim()) return;
    setEnhancingStepId(stepId);
    setEnhancePendingStepId(stepId);
    try {
      const res = await fetch('/api/workflows/enhance-step-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, step_label: stepLabel, workflow_name: workflow.name, ...context }),
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let firstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const { delta } = JSON.parse(payload) as { delta: string };
            if (!delta) continue;
            if (firstChunk) { setEnhancePendingStepId(null); firstChunk = false; }
            accumulated += delta;
            const acc = accumulated;
            setWorkflow(w => ({
              ...w,
              steps: w.steps.map(s => {
                if (s.id !== stepId) return s;
                if (context.field === 'query') return { ...s, config: { ...(s as ToolStep).config, query: acc } } as WorkflowStep;
                return { ...s, prompt: acc } as WorkflowStep;
              }),
            }));
          } catch { /* ignore parse errors */ }
        }
      }
    } finally {
      setEnhancingStepId(null);
      setEnhancePendingStepId(null);
    }
  }, [workflow.name]);

  return (
    <div className="flex h-screen bg-neutral-50">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-neutral-150 px-8 py-4">
          <div className="flex items-center justify-between">
            <Link
              href={`/work?section=studio&workflow=${workflow.id}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" />
              Back to workflow
            </Link>
            <div className="flex items-center gap-3">
              {savedAt && (
                <span className="text-[11.5px] text-emerald-600 inline-flex items-center gap-1">
                  <CheckIcon className="w-3.5 h-3.5" />
                  Saved {savedAt.toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12.5px] font-medium rounded-md transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={saveAndClose}
                disabled={saving}
                className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-[12.5px] font-medium rounded-md transition-colors disabled:opacity-50"
              >
                Save & close
              </button>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Identity */}
            <Panel title="Identity">
              {/* Preview + pickers row */}
              <div className="flex gap-5 mb-2">
                {/* Live preview */}
                {(() => {
                  const colorBg = WORKFLOW_COLORS.find(c => c.key === workflow.color)?.bg ?? 'bg-indigo-500';
                  const PreviewIcon = WORKFLOW_ICONS.find(i => i.key === workflow.icon)?.Icon ?? BoltIcon;
                  return (
                    <div className="flex-shrink-0 flex flex-col items-center gap-2 justify-center">
                      <div className={`w-14 h-14 rounded-2xl ${colorBg} flex items-center justify-center shadow-sm`}>
                        <PreviewIcon className="w-7 h-7 text-white" />
                      </div>
                      <span className="text-[11px] text-neutral-400 w-16 text-center truncate leading-tight">{workflow.name || 'Untitled'}</span>
                    </div>
                  );
                })()}
                <div className="w-px bg-neutral-100 self-stretch flex-shrink-0" />
                {/* Icon + Color pickers */}
                <div className="flex gap-4 flex-1">
                  <div className="flex-shrink-0">
                    <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide mb-1.5">Icon</p>
                    <div className="flex gap-1 flex-wrap" style={{ maxWidth: 224 }}>
                      {WORKFLOW_ICONS.map(({ key, Icon }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => patch('icon', key)}
                          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
                            workflow.icon === key
                              ? 'bg-neutral-200 ring-2 ring-neutral-400'
                              : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="w-px bg-neutral-100 flex-shrink-0" />
                  <div>
                    <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide mb-1.5">Color</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {WORKFLOW_COLORS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => patch('color', c.key)}
                          className={`w-5 h-5 rounded-full ${c.bg} transition-all flex-shrink-0 ${
                            workflow.color === c.key ? `ring-2 ring-offset-1 ${c.ring}` : 'opacity-60 hover:opacity-100'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <Field label="Name">
                <input
                  type="text"
                  value={workflow.name}
                  onChange={e => patch('name', e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
                />
              </Field>
              <Field label="Description">
                <input
                  type="text"
                  value={workflow.description ?? ''}
                  onChange={e => patch('description', e.target.value)}
                  placeholder="What does this workflow produce?"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
                />
              </Field>
            </Panel>

            {/* Trigger */}
            <Panel title="Trigger">
              <TriggerEditor
                trigger={workflow.trigger}
                onChange={t => patch('trigger', t)}
              />
            </Panel>

            {/* Steps */}
            <Panel title="Steps" headerRight={
              <button
                onClick={() => setShowStepsHelp(h => !h)}
                className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                <InformationCircleIcon className="w-4 h-4" />
              </button>
            }>
              {showStepsHelp && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-[12px] text-neutral-700 mb-1">
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-semibold text-neutral-800">How to build a workflow</span>
                    <button onClick={() => setShowStepsHelp(false)} className="text-neutral-400 hover:text-neutral-600 ml-2 flex-shrink-0">
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <ol className="space-y-1.5">
                    <li><span className="font-medium">1.</span> Add a <span className="font-medium">Tool</span> step to collect data — fetch emails, search the web, or read a document.</li>
                    <li><span className="font-medium">2.</span> Add an <span className="font-medium">AI</span> step to process it — summarise, extract, rewrite, or analyse.</li>
                    <li><span className="font-medium">3.</span> Set the <span className="font-medium">output</span> — send as a chat message or save as a document artifact.</li>
                  </ol>
                  <div className="mt-3 pt-3 border-t border-indigo-100">
                    <span className="text-neutral-500 font-medium">Example — Morning briefing:</span>
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[11.5px]">
                      <span className="bg-white border border-indigo-100 rounded px-2 py-0.5">Tool: Get urgent emails</span>
                      <span className="text-neutral-400">→</span>
                      <span className="bg-white border border-indigo-100 rounded px-2 py-0.5">AI: Summarise into 5 bullets</span>
                      <span className="text-neutral-400">→</span>
                      <span className="bg-white border border-indigo-100 rounded px-2 py-0.5">Output: Thread message</span>
                    </div>
                  </div>
                </div>
              )}
              {workflow.steps.length === 0 && (
                <div className="text-[12.5px] text-neutral-500 py-3 text-center bg-neutral-50 rounded border border-dashed border-neutral-200 mb-3">
                  Add steps below. Each step feeds its output into the next.
                </div>
              )}

              <div className="space-y-2">
                {workflow.steps.map((step, idx) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    index={idx}
                    total={workflow.steps.length}
                    agents={agents}
                    onUpdate={p => updateStep(idx, p)}
                    onRemove={() => removeStep(idx)}
                    onMove={delta => moveStep(idx, delta)}
                    isEnhancing={enhancingStepId === step.id}
                    isPending={enhancePendingStepId === step.id}
                    onEnhance={(prompt, label, ctx) => handleEnhanceStep(step.id, prompt, label, ctx)}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t-2 border-neutral-200">
                <span className="text-[12px] text-neutral-500 mr-1">Add step:</span>
                <AddStepButton icon={WrenchScrewdriverIcon} label="Tool" onClick={() => addStep('tool')} />
                <AddStepButton icon={SparklesIcon} label="AI" onClick={() => addStep('ai')} />
                <AddStepButton
                  icon={UserCircleIcon}
                  label="Agent"
                  onClick={() => addStep('agent')}
                  disabled={agents.length === 0}
                  title={agents.length === 0 ? 'Create a custom agent in Work first' : undefined}
                />
              </div>
            </Panel>

            {/* Output */}
            <Panel title="Output">
              <OutputEditor
                output={workflow.output_config}
                onChange={o => patch('output_config', o)}
              />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub components ────────────────────────────────────────────────────────────

function Panel({ title, children, headerRight }: { title: string; children: React.ReactNode; headerRight?: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-150 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-semibold text-neutral-900">{title}</h2>
        {headerRight}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-neutral-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function AddStepButton({
  icon: Icon, label, onClick, disabled, title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12px] font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function TriggerEditor({
  trigger, onChange,
}: {
  trigger: WorkflowTrigger;
  onChange: (t: WorkflowTrigger) => void;
}) {
  const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => onChange({ type: 'manual' })}
          className={`flex-1 px-3 py-2 text-[12.5px] font-medium rounded-md border transition-colors ${
            trigger.type === 'manual'
              ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
              : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          <BoltIcon className="w-4 h-4 inline mr-1.5" />
          Manual only
        </button>
        <button
          onClick={() => onChange({
            type: 'schedule',
            cron: 'cron' in trigger ? (trigger.cron ?? '0 9 * * *') : '0 9 * * *',
            timezone: 'timezone' in trigger ? (trigger.timezone ?? userTz) : userTz,
          })}
          className={`flex-1 px-3 py-2 text-[12.5px] font-medium rounded-md border transition-colors ${
            trigger.type === 'schedule'
              ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
              : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          On a schedule
        </button>
      </div>

      {trigger.type === 'schedule' && (
        <div className="pt-3 space-y-3">
          <Field label="Preset">
            <select
              value={trigger.cron ?? ''}
              onChange={e => onChange({ ...trigger, cron: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
            >
              {CRON_PRESETS.some(p => p.cron === trigger.cron) ? null : (
                <option value={trigger.cron ?? ''}>Custom: {trigger.cron}</option>
              )}
              {CRON_PRESETS.map(p => (
                <option key={p.cron} value={p.cron}>{p.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Custom cron (optional)">
            <input
              type="text"
              value={trigger.cron ?? ''}
              onChange={e => onChange({ ...trigger, cron: e.target.value })}
              placeholder="0 9 * * 1"
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
            />
          </Field>
          <Field label="Timezone">
            <input
              type="text"
              value={trigger.timezone ?? userTz}
              onChange={e => onChange({ ...trigger, timezone: e.target.value })}
              placeholder="Europe/Lisbon"
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
            />
          </Field>
        </div>
      )}
    </>
  );
}

function StepCard({
  step, index, total, agents, onUpdate, onRemove, onMove, isEnhancing, isPending, onEnhance,
}: {
  step: WorkflowStep;
  index: number;
  total: number;
  agents: AgentOption[];
  onUpdate: (p: Partial<WorkflowStep>) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  isEnhancing?: boolean;
  isPending?: boolean;
  onEnhance?: EnhanceFn;
}) {
  const Icon =
    step.type === 'tool'  ? WrenchScrewdriverIcon :
    step.type === 'ai'    ? SparklesIcon :
                            UserCircleIcon;

  const typeColor =
    step.type === 'tool'  ? 'bg-blue-50 text-blue-700 border-blue-200' :
    step.type === 'ai'    ? 'bg-violet-50 text-violet-700 border-violet-200' :
                            'bg-emerald-50 text-emerald-700 border-emerald-200';

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 bg-neutral-50 border-b border-neutral-200">
        <span className="text-[11px] text-neutral-400 w-5">{index + 1}.</span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border ${typeColor}`}>
          <Icon className="w-3 h-3" />
          {step.type.toUpperCase()}
        </span>
        <input
          type="text"
          value={step.label}
          onChange={e => onUpdate({ label: e.target.value })}
          className="flex-1 bg-transparent text-[13px] font-medium text-neutral-900 focus:outline-none"
        />
        <div className="flex items-center gap-0.5">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 hover:bg-neutral-200 rounded disabled:opacity-30">
            <ArrowUpIcon className="w-3.5 h-3.5 text-neutral-500" />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 hover:bg-neutral-200 rounded disabled:opacity-30">
            <ArrowDownIcon className="w-3.5 h-3.5 text-neutral-500" />
          </button>
          <button onClick={onRemove} className="p-1 hover:bg-red-50 rounded">
            <TrashIcon className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3 bg-white">
        {step.type === 'tool'  && <ToolStepFields  step={step as ToolStep}  onUpdate={onUpdate} isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} />}
        {step.type === 'ai'    && <AIStepFields    step={step as AIStep}    onUpdate={onUpdate} isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} />}
        {step.type === 'agent' && <AgentStepFields step={step as AgentStep} agents={agents} onUpdate={onUpdate} isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} />}
      </div>
    </div>
  );
}

type EnhanceFn = (prompt: string, label: string, context: { step_type: 'ai' | 'tool' | 'agent'; tool_type?: string; output_format?: string; model_tier?: string; field: 'prompt' | 'query' }) => void;

function ToolStepFields({ step, onUpdate, isEnhancing, isPending, onEnhance }: {
  step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void;
  isEnhancing?: boolean; isPending?: boolean; onEnhance?: EnhanceFn;
}) {
  const tool = AVAILABLE_TOOLS.find(t => t.id === step.tool);
  const query = (step.config.query as string) ?? '';
  return (
    <>
      <Field label="Tool">
        <select
          value={step.tool}
          onChange={e => onUpdate({ tool: e.target.value, config: {} })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
        >
          {AVAILABLE_TOOLS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {tool && <p className="text-[11.5px] text-neutral-500 mt-1">{tool.description}</p>}
      </Field>
      {step.tool === 'web_search' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11.5px] font-medium text-neutral-600">Search query</label>
            {onEnhance && (
              <button
                type="button"
                onClick={() => onEnhance(query, step.label, { step_type: 'tool', tool_type: 'web_search', field: 'query' })}
                disabled={isEnhancing || !query.trim()}
                className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <SparklesIcon className="w-3 h-3" />
                Enhance
              </button>
            )}
          </div>
          {isPending ? (
            <div className="w-full px-3 py-2 border border-neutral-200 rounded-md bg-neutral-50 space-y-2 min-h-[40px]">
              <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-3/4" />
              <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-full" />
            </div>
          ) : (
            <textarea
              value={query}
              onChange={e => onUpdate({ config: { ...step.config, query: e.target.value } })}
              placeholder="e.g. Germany Portugal business news today"
              rows={3}
              disabled={isEnhancing}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60"
            />
          )}
        </div>
      )}
      {step.tool === 'read_kb_file' && (
        <Field label="Knowledge file id">
          <input
            type="text"
            value={(step.config.file_id as string) ?? ''}
            onChange={e => onUpdate({ config: { ...step.config, file_id: e.target.value } })}
            placeholder="UUID from your knowledge base"
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] font-mono"
          />
        </Field>
      )}
    </>
  );
}

function AIStepFields({ step, onUpdate, isEnhancing, isPending, onEnhance }: {
  step: AIStep;
  onUpdate: (p: Partial<AIStep>) => void;
  isEnhancing?: boolean;
  isPending?: boolean;
  onEnhance?: EnhanceFn;
}) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11.5px] font-medium text-neutral-600">Instruction</label>
          {onEnhance && (
            <button
              type="button"
              onClick={() => onEnhance(step.prompt, step.label, { step_type: 'ai', output_format: step.output_format, model_tier: step.model_tier, field: 'prompt' })}
              disabled={isEnhancing || !step.prompt.trim()}
              className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <SparklesIcon className="w-3 h-3" />
              Enhance
            </button>
          )}
        </div>
        {isPending ? (
          <div className="w-full px-3 py-2 border border-neutral-200 rounded-md bg-neutral-50 space-y-2 min-h-[96px]">
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-3/4" />
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-full" />
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-2/3" />
          </div>
        ) : (
          <textarea
            value={step.prompt}
            onChange={e => onUpdate({ prompt: e.target.value })}
            placeholder="What should the AI do with the previous step outputs?"
            rows={4}
            disabled={isEnhancing}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60"
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Output format">
          <select
            value={step.output_format ?? 'markdown'}
            onChange={e => onUpdate({ output_format: e.target.value as AIStep['output_format'] })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
          >
            <option value="markdown">Formatted</option>
            <option value="text">Text only</option>
            <option value="json">Structured (JSON)</option>
          </select>
        </Field>
        <Field label="Model">
          <select
            value={step.model_tier ?? 'fast'}
            onChange={e => onUpdate({ model_tier: e.target.value as AIStep['model_tier'] })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
          >
            <option value="fast">Fast</option>
            <option value="reasoning">Thorough</option>
          </select>
        </Field>
      </div>
    </>
  );
}

function AgentStepFields({
  step, agents, onUpdate, isEnhancing, isPending, onEnhance,
}: {
  step: AgentStep;
  agents: AgentOption[];
  onUpdate: (p: Partial<AgentStep>) => void;
  isEnhancing?: boolean;
  isPending?: boolean;
  onEnhance?: EnhanceFn;
}) {
  return (
    <>
      <Field label="Agent">
        <select
          value={step.agent_id}
          onChange={e => onUpdate({ agent_id: e.target.value })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
        >
          {agents.length === 0 && <option value="">No custom agents — create one in Work first</option>}
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11.5px] font-medium text-neutral-600">Task for this agent</label>
          {onEnhance && (
            <button
              type="button"
              onClick={() => onEnhance(step.prompt, step.label, { step_type: 'agent', field: 'prompt' })}
              disabled={isEnhancing || !step.prompt.trim()}
              className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <SparklesIcon className="w-3 h-3" />
              Enhance
            </button>
          )}
        </div>
        {isPending ? (
          <div className="w-full px-3 py-2 border border-neutral-200 rounded-md bg-neutral-50 space-y-2 min-h-[96px]">
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-3/4" />
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-full" />
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-2/3" />
          </div>
        ) : (
          <textarea
            value={step.prompt}
            onChange={e => onUpdate({ prompt: e.target.value })}
            placeholder="What should this agent do, using the previous step outputs as input?"
            rows={4}
            disabled={isEnhancing}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60"
          />
        )}
      </div>
    </>
  );
}

function OutputEditor({
  output, onChange,
}: {
  output: OutputConfig;
  onChange: (o: OutputConfig) => void;
}) {
  return (
    <>
      <Field label="Destination">
        <select
          value={output.destination}
          onChange={e => onChange({ ...output, destination: e.target.value as OutputConfig['destination'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
        >
          <option value="thread_message">Message in thread</option>
          <option value="artifact">Document artifact</option>
        </select>
      </Field>
      {output.destination === 'artifact' && (
        <>
          <Field label="Artifact type">
            <select
              value={output.artifact_type ?? 'document'}
              onChange={e => onChange({ ...output, artifact_type: e.target.value as OutputConfig['artifact_type'] })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
            >
              <option value="document">Word document</option>
              <option value="email">Email draft</option>
            </select>
          </Field>
          <Field label="Title template">
            <input
              type="text"
              value={output.title_template ?? ''}
              onChange={e => onChange({ ...output, title_template: e.target.value })}
              placeholder="Weekly Briefing — {{date}}"
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]"
            />
            <p className="text-[11.5px] text-neutral-500 mt-1">
              Use <code className="bg-neutral-100 px-1 rounded">{'{{date}}'}</code>,{' '}
              <code className="bg-neutral-100 px-1 rounded">{'{{week_of}}'}</code>, or{' '}
              <code className="bg-neutral-100 px-1 rounded">{'{{workflow}}'}</code>.
            </p>
          </Field>
        </>
      )}
      <Field label="Notifications">
        <select
          value={output.notification_mode}
          onChange={e => onChange({ ...output, notification_mode: e.target.value as OutputConfig['notification_mode'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
        >
          <option value="inbox_card">Inbox card (badge + notification)</option>
          <option value="silent">Silent (no notification)</option>
          <option value="email_digest">Email digest (future)</option>
        </select>
      </Field>
    </>
  );
}
