'use client';

import { useState, useCallback } from 'react';
import {
  ArrowLeftIcon,
  TrashIcon,
  BoltIcon,
  WrenchScrewdriverIcon,
  SparklesIcon,
  UserCircleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckIcon,
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
  description?: string | null;
  color: string;
  icon: string;
}

interface Props {
  workflow: Workflow;
  agents: AgentOption[];
  onClose: (updated: Workflow) => void;
  onBack: () => void;
}

const AVAILABLE_TOOLS = [
  { id: 'get_urgent_emails', label: 'Fetch urgent unread emails', description: 'Pulls unread items from your inbox with sender, subject, preview.' },
  { id: 'get_calendar',      label: 'Fetch upcoming calendar',   description: 'Returns your next meetings with attendees and times.' },
  { id: 'read_kb_file',      label: 'Read a knowledge base file', description: 'Returns the full content of one KB file by id.' },
  { id: 'web_search',        label: 'Search the web',            description: 'Give it a topic and it finds relevant pages — like asking Google. Use this when you don\'t know which site has the info.' },
  { id: 'fetch_url',         label: 'Read a specific web page',  description: 'Reads the full current content of a URL every run. Good for pages without a feed — a pricing page, job board, or competitor site. Returns the whole page each time.' },
  { id: 'rss_feed',          label: 'Follow a news feed or blog', description: 'For sites that publish a feed (most news sites and blogs). Returns only new articles since your last run — no duplicates, clean titles and dates. Look for the RSS icon on the site, or try adding /feed to the URL.' },
];

export function StudioBuilder({ workflow: initialWorkflow, agents, onClose, onBack }: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const patch = useCallback(<K extends keyof Workflow>(key: K, value: Workflow[K]) => {
    setWorkflow(w => ({ ...w, [key]: value }));
  }, []);

  const save = useCallback(async (): Promise<Workflow | null> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: workflow.name,
          description: workflow.description,
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
        return saved;
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Save failed' }));
        alert(error);
        return null;
      }
    } finally {
      setSaving(false);
    }
  }, [workflow]);

  const saveAndClose = useCallback(async () => {
    const saved = await save();
    onClose(saved ?? workflow);
  }, [save, onClose, workflow]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="px-6 py-3 border-b border-neutral-100 flex-shrink-0 flex items-center justify-between bg-white">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          Back
        </button>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-[11.5px] text-emerald-600 inline-flex items-center gap-1">
              <CheckIcon className="w-3.5 h-3.5" />
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => save()}
            disabled={saving}
            className="px-3 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12px] font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={saveAndClose}
            disabled={saving}
            className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-[12px] font-medium rounded-md transition-colors disabled:opacity-50"
          >
            Save & close
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Identity */}
          <Panel title="Identity">
            <Field label="Name">
              <input
                type="text"
                value={workflow.name}
                onChange={e => patch('name', e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
              />
            </Field>
            <Field label="Description">
              <input
                type="text"
                value={workflow.description ?? ''}
                onChange={e => patch('description', e.target.value)}
                placeholder="What does this workflow produce?"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
              />
            </Field>
          </Panel>

          {/* Trigger */}
          <Panel title="Trigger">
            <TriggerEditor trigger={workflow.trigger} onChange={t => patch('trigger', t)} />
          </Panel>

          {/* Steps */}
          <Panel title="Steps">
            {workflow.steps.length === 0 && (
              <div className="text-[12.5px] text-neutral-500 py-3 text-center bg-neutral-50 rounded-lg border border-dashed border-neutral-200 mb-3">
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
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-neutral-100">
              <span className="text-[12px] text-neutral-500 mr-1">Add step:</span>
              <AddStepButton icon={WrenchScrewdriverIcon} label="Tool"  onClick={() => addStep('tool')} />
              <AddStepButton icon={SparklesIcon}          label="AI"    onClick={() => addStep('ai')} />
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
            <OutputEditor output={workflow.output_config} onChange={o => patch('output_config', o)} />
          </Panel>

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-2xl p-5">
      <h2 className="text-[13px] font-semibold text-neutral-900 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <label className="text-[11.5px] font-medium text-neutral-500">{label}</label>
        {hint && <span className="text-[10.5px] text-neutral-400">{hint}</span>}
      </div>
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
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[12px] font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function TriggerEditor({ trigger, onChange }: { trigger: WorkflowTrigger; onChange: (t: WorkflowTrigger) => void }) {
  const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => onChange({ type: 'manual' })}
          className={`flex-1 px-3 py-2 text-[12.5px] font-medium rounded-lg border transition-colors ${
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
          className={`flex-1 px-3 py-2 text-[12.5px] font-medium rounded-lg border transition-colors ${
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
          <p className="text-[11.5px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Workflows run once daily. Time is approximate — the dispatch fires at 9am UTC.
          </p>
          <Field label="Preset">
            <select
              value={trigger.cron ?? ''}
              onChange={e => onChange({ ...trigger, cron: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white"
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
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
            />
          </Field>
          <Field label="Timezone">
            <input
              type="text"
              value={trigger.timezone ?? userTz}
              onChange={e => onChange({ ...trigger, timezone: e.target.value })}
              placeholder="Europe/Lisbon"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
            />
          </Field>
        </div>
      )}
    </>
  );
}

function StepCard({ step, index, total, agents, onUpdate, onRemove, onMove }: {
  step: WorkflowStep; index: number; total: number; agents: AgentOption[];
  onUpdate: (p: Partial<WorkflowStep>) => void; onRemove: () => void; onMove: (delta: -1 | 1) => void;
}) {
  const Icon = step.type === 'tool' ? WrenchScrewdriverIcon : step.type === 'ai' ? SparklesIcon : UserCircleIcon;
  const typeColor =
    step.type === 'tool'  ? 'bg-blue-50 text-blue-700 border-blue-200' :
    step.type === 'ai'    ? 'bg-violet-50 text-violet-700 border-violet-200' :
                            'bg-emerald-50 text-emerald-700 border-emerald-200';
  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 bg-neutral-50 border-b border-neutral-200">
        <span className="text-[11px] text-neutral-400 w-5">{index + 1}.</span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border ${typeColor}`}>
          <Icon className="w-3 h-3" />{step.type.toUpperCase()}
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
        {step.type === 'tool'  && <ToolStepFields  step={step as ToolStep}  onUpdate={onUpdate} />}
        {step.type === 'ai'    && <AIStepFields    step={step as AIStep}    onUpdate={onUpdate} />}
        {step.type === 'agent' && <AgentStepFields step={step as AgentStep} agents={agents} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}

function ToolStepFields({ step, onUpdate }: { step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void }) {
  const tool = AVAILABLE_TOOLS.find(t => t.id === step.tool);
  return (
    <>
      <Field label="Tool">
        <select value={step.tool} onChange={e => onUpdate({ tool: e.target.value, config: {} })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
          {AVAILABLE_TOOLS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {tool && <p className="text-[11.5px] text-neutral-500 mt-1">{tool.description}</p>}
      </Field>
      {step.tool === 'web_search' && (
        <Field label="Search query">
          <textarea
            value={(step.config.query as string) ?? ''}
            onChange={e => onUpdate({ config: { ...step.config, query: e.target.value } })}
            placeholder="e.g. Germany Portugal business news today"
            rows={3}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
        </Field>
      )}
      {step.tool === 'fetch_url' && (
        <Field label="URLs to fetch" hint="One URL per line, max 5">
          <textarea
            value={Array.isArray(step.config.urls) ? (step.config.urls as string[]).join('\n') : (step.config.urls as string) ?? ''}
            onChange={e => onUpdate({ config: { ...step.config, urls: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })}
            placeholder={'https://example.com/pricing\nhttps://competitor.com/blog'}
            rows={3}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
        </Field>
      )}
      {step.tool === 'rss_feed' && (
        <>
          <Field label="Feed URLs" hint="One URL per line">
            <textarea
              value={Array.isArray(step.config.feeds) ? (step.config.feeds as string[]).join('\n') : (step.config.feeds as string) ?? ''}
              onChange={e => onUpdate({ config: { ...step.config, feeds: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })}
              placeholder={'https://hnrss.org/frontpage\nhttps://feeds.feedburner.com/example'}
              rows={3}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
          </Field>
          <Field label="Time window">
            <select value={(step.config.since as string) ?? 'last_run'}
              onChange={e => onUpdate({ config: { ...step.config, since: e.target.value } })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
              <option value="last_run">Since last run</option>
              <option value="24h">Past 24 hours</option>
              <option value="7d">Past 7 days</option>
            </select>
          </Field>
        </>
      )}
      {step.tool === 'read_kb_file' && (
        <Field label="Knowledge file id">
          <input type="text" value={(step.config.file_id as string) ?? ''}
            onChange={e => onUpdate({ config: { ...step.config, file_id: e.target.value } })}
            placeholder="UUID from your knowledge base"
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] font-mono" />
        </Field>
      )}
    </>
  );
}

function AIStepFields({ step, onUpdate }: { step: AIStep; onUpdate: (p: Partial<AIStep>) => void }) {
  return (
    <>
      <Field label="Instruction">
        <textarea value={step.prompt} onChange={e => onUpdate({ prompt: e.target.value })}
          placeholder="What should the AI do with the previous step outputs?"
          rows={4} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Output format">
          <select value={step.output_format ?? 'markdown'} onChange={e => onUpdate({ output_format: e.target.value as AIStep['output_format'] })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="markdown">Markdown</option>
            <option value="text">Plain text</option>
            <option value="json">JSON</option>
          </select>
        </Field>
        <Field label="Model">
          <select value={step.model_tier ?? 'fast'} onChange={e => onUpdate({ model_tier: e.target.value as AIStep['model_tier'] })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="fast">Fast (cheaper)</option>
            <option value="reasoning">Reasoning (better)</option>
          </select>
        </Field>
      </div>
    </>
  );
}

function AgentStepFields({ step, agents, onUpdate }: { step: AgentStep; agents: AgentOption[]; onUpdate: (p: Partial<AgentStep>) => void }) {
  return (
    <>
      <Field label="Agent">
        <select value={step.agent_id} onChange={e => onUpdate({ agent_id: e.target.value })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
          {agents.length === 0 && <option value="">No custom agents — create one in Work first</option>}
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Task for this agent">
        <textarea value={step.prompt} onChange={e => onUpdate({ prompt: e.target.value })}
          placeholder="What should this agent do, using the previous step outputs as input?"
          rows={4} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
      </Field>
    </>
  );
}

function OutputEditor({ output, onChange }: { output: OutputConfig; onChange: (o: OutputConfig) => void }) {
  return (
    <>
      <Field label="Destination">
        <select value={output.destination} onChange={e => onChange({ ...output, destination: e.target.value as OutputConfig['destination'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
          <option value="thread_message">Message in thread</option>
          <option value="artifact">Document artifact</option>
        </select>
      </Field>
      {output.destination === 'artifact' && (
        <>
          <Field label="Artifact type">
            <select value={output.artifact_type ?? 'document'} onChange={e => onChange({ ...output, artifact_type: e.target.value as OutputConfig['artifact_type'] })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
              <option value="document">Word document</option>
              <option value="email">Email draft</option>
            </select>
          </Field>
          <Field label="Title template">
            <input type="text" value={output.title_template ?? ''} onChange={e => onChange({ ...output, title_template: e.target.value })}
              placeholder="Weekly Briefing — {{date}}"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px]" />
            <p className="text-[11.5px] text-neutral-500 mt-1">
              Use <code className="bg-neutral-100 px-1 rounded">{'{{date}}'}</code>,{' '}
              <code className="bg-neutral-100 px-1 rounded">{'{{week_of}}'}</code>, or{' '}
              <code className="bg-neutral-100 px-1 rounded">{'{{workflow}}'}</code>.
            </p>
          </Field>
        </>
      )}
      <Field label="Notifications">
        <select value={output.notification_mode} onChange={e => onChange({ ...output, notification_mode: e.target.value as OutputConfig['notification_mode'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
          <option value="inbox_card">Inbox card (badge + notification)</option>
          <option value="silent">Silent (no notification)</option>
          <option value="email_digest">Email digest (future)</option>
        </select>
      </Field>
    </>
  );
}
