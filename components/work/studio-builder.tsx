'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
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
  ChevronDownIcon,
  InboxIcon as InboxOutlineIcon,
  LinkIcon,
  LockClosedIcon,
  EyeIcon,
  EyeSlashIcon,
  ComputerDesktopIcon,
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
  { id: 'web_search',        label: 'Search the web',            description: 'Give it a topic and it finds relevant pages — like asking Google. Use this when you don\'t know which site has the info.' },
  { id: 'fetch_url',         label: 'Read a specific web page',  description: 'Reads the full current content of a URL every run. Good for pages without a feed — a pricing page, job board, or competitor site. Returns the whole page each time.' },
  { id: 'rss_feed',          label: 'Follow a news feed or blog', description: 'For sites that publish a feed (most news sites and blogs). Returns only new articles since your last run — no duplicates, clean titles and dates. Look for the RSS icon on the site, or try adding /feed to the URL.' },
  { id: 'linkedin_post',     label: 'Generate LinkedIn posts',   description: 'Drafts 1–3 LinkedIn post variants from previous step content. Configure tone, format, length, language, and optionally a voice reference file.' },
];

type ToolIconEntry = { Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; bg: string };
function LinkedInSVG({ className }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
const TOOL_ICONS: Record<string, ToolIconEntry> = {
  get_urgent_emails: { Icon: InboxOutlineIcon,       bg: 'bg-blue-500'    },
  get_calendar:      { Icon: CalendarDaysIcon,       bg: 'bg-emerald-500' },
  read_kb_file:      { Icon: BookOpenIcon,           bg: 'bg-violet-500'  },
  web_search:        { Icon: MagnifyingGlassIcon,    bg: 'bg-amber-500'   },
  fetch_url:         { Icon: LinkIcon,               bg: 'bg-sky-500'     },
  rss_feed:          { Icon: NewspaperIcon,          bg: 'bg-orange-500'  },
  linkedin_post:     { Icon: LinkedInSVG,            bg: 'bg-[#0A66C2]'   },
  browser_fetch:     { Icon: LinkIcon,               bg: 'bg-sky-500'     },
};

function ToolPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  // browser_fetch is a variant of fetch_url — show fetch_url in the picker
  const displayValue = value === 'browser_fetch' ? 'fetch_url' : value;
  const selected = AVAILABLE_TOOLS.find(t => t.id === displayValue) ?? AVAILABLE_TOOLS[0];
  const meta = TOOL_ICONS[selected.id];

  function toggle() {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      const inBtn  = btnRef.current?.contains(target);
      const inDrop = dropRef.current?.contains(target);
      if (!inBtn && !inDrop) setOpen(false);
    }
    function onScroll(e: Event) {
      // Close on page scroll but not when scrolling inside the dropdown itself
      if (dropRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 border border-neutral-200 rounded-lg bg-white hover:border-neutral-300 transition-colors text-left"
      >
        {meta && (
          <span className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${meta.bg}`}>
            <meta.Icon className="w-3.5 h-3.5 text-white" />
          </span>
        )}
        <span className="flex-1 text-[13px] text-neutral-800">{selected.label}</span>
        <ChevronDownIcon className={`w-4 h-4 text-neutral-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && (
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 }}
          className="bg-white border border-neutral-200 rounded-lg shadow-xl overflow-y-auto max-h-[420px]"
        >
          {AVAILABLE_TOOLS.map(t => {
            const tm = TOOL_ICONS[t.id];
            const isSelected = t.id === displayValue;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-neutral-50 transition-colors text-left ${isSelected ? 'bg-neutral-50' : ''}`}
              >
                {tm && (
                  <span className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center mt-0.5 ${tm.bg}`}>
                    <tm.Icon className="w-3.5 h-3.5 text-white" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="text-[13px] text-neutral-800 leading-snug">{t.label}</div>
                  <div className="text-[11px] text-neutral-500 leading-snug mt-0.5">{t.description}</div>
                </div>
                {isSelected && <CheckIcon className="w-4 h-4 text-indigo-500 flex-shrink-0 ml-auto mt-0.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StudioBuilder({ workflow: initialWorkflow, agents, onClose, onBack }: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [enhancingStepId, setEnhancingStepId] = useState<string | null>(null);
  const [enhancePendingStepId, setEnhancePendingStepId] = useState<string | null>(null);
  const [showStepsHelp, setShowStepsHelp] = useState(false);

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

  const colorBg = WORKFLOW_COLORS.find(c => c.key === workflow.color)?.bg ?? 'bg-indigo-500';
  const PreviewIcon = WORKFLOW_ICONS.find(i => i.key === workflow.icon)?.Icon ?? BoltIcon;

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

      {/* Body — two-column like agent form */}
      <div className="flex flex-1 min-h-0 gap-4 p-4 overflow-hidden">

        {/* Left — Live preview */}
        <div className="w-[180px] flex-shrink-0 flex flex-col">
          <div className="rounded-2xl p-4 flex flex-col items-center gap-3 border border-neutral-100 bg-white shadow-sm">
            <div className={`w-14 h-14 rounded-2xl ${colorBg} flex items-center justify-center shadow-sm`}>
              <PreviewIcon className="w-7 h-7 text-white" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-neutral-900 text-[12.5px] leading-snug">{workflow.name || 'Untitled workflow'}</p>
              {workflow.description && (
                <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed line-clamp-3">{workflow.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Right — Config panels */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto pb-4">

          {/* Identity */}
          <Panel title="Identity">
            <div className="flex gap-4 mb-1">
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
                  isEnhancing={enhancingStepId === step.id}
                  isPending={enhancePendingStepId === step.id}
                  onEnhance={(prompt, label, ctx) => handleEnhanceStep(step.id, prompt, label, ctx)}
                  onSave={save}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t-2 border-neutral-200">
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

function Panel({ title, children, headerRight }: { title: string; children: React.ReactNode; headerRight?: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-semibold text-neutral-900">{title}</h2>
        {headerRight}
      </div>
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

function StepCard({ step, index, total, agents, onUpdate, onRemove, onMove, isEnhancing, isPending, onEnhance, onSave }: {
  step: WorkflowStep; index: number; total: number; agents: AgentOption[];
  onUpdate: (p: Partial<WorkflowStep>) => void; onRemove: () => void; onMove: (delta: -1 | 1) => void;
  isEnhancing?: boolean; isPending?: boolean; onSave?: () => void;
  onEnhance?: (prompt: string, label: string, context: { step_type: 'ai' | 'tool' | 'agent'; tool_type?: string; output_format?: string; model_tier?: string; field: 'prompt' | 'query' }) => void;
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
          placeholder="Step name"
          className="flex-1 bg-transparent text-[13px] font-medium text-neutral-900 placeholder-neutral-400 focus:outline-none"
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
        {step.type === 'tool'  && <ToolStepFields  step={step as ToolStep}  onUpdate={onUpdate} isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} onSave={onSave} />}
        {step.type === 'ai'    && <AIStepFields    step={step as AIStep}    onUpdate={onUpdate} isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} />}
        {step.type === 'agent' && <AgentStepFields step={step as AgentStep} agents={agents} onUpdate={onUpdate} isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} />}
      </div>
    </div>
  );
}

type EnhanceFn = (prompt: string, label: string, context: { step_type: 'ai' | 'tool' | 'agent'; tool_type?: string; output_format?: string; model_tier?: string; field: 'prompt' | 'query' }) => void;

function LinkedInPostFields({ step, onUpdate }: { step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void }) {
  const [kbFiles, setKbFiles] = useState<Array<{ id: string; filename: string }>>([]);
  useEffect(() => {
    fetch('/api/knowledge/files?limit=50').then(r => r.json()).then(d => setKbFiles(d.data ?? [])).catch(() => {});
  }, []);
  const cfg = step.config;
  const set = (k: string, v: unknown) => onUpdate({ config: { ...cfg, [k]: v } });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tone">
          <select value={(cfg.tone as string) ?? 'thought_leadership'} onChange={e => set('tone', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="thought_leadership">Thought leadership</option>
            <option value="conversational">Conversational</option>
            <option value="data_driven">Data-driven</option>
          </select>
        </Field>
        <Field label="Length">
          <select value={(cfg.length as string) ?? 'standard'} onChange={e => set('length', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="short">Short ~100w</option>
            <option value="standard">Standard ~200w</option>
            <option value="long">Long ~350w</option>
          </select>
        </Field>
        <Field label="Format">
          <select value={(cfg.format as string) ?? 'insight'} onChange={e => set('format', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="story">Story</option>
            <option value="insight">Insight</option>
            <option value="question">Question</option>
            <option value="list">List</option>
          </select>
        </Field>
        <Field label="Language">
          <select value={(cfg.language as string) ?? 'en'} onChange={e => set('language', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="pt">Portuguese</option>
          </select>
        </Field>
        <Field label="Variants">
          <select value={String(cfg.variants ?? 1)} onChange={e => set('variants', Number(e.target.value))}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="1">1 draft</option>
            <option value="2">2 drafts</option>
            <option value="3">3 drafts</option>
          </select>
        </Field>
        <Field label="Image prompt">
          <label className="flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-lg cursor-pointer">
            <input type="checkbox" checked={cfg.include_image_prompt === true} onChange={e => set('include_image_prompt', e.target.checked)}
              className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-[13px] text-neutral-700">Include visual prompt</span>
          </label>
        </Field>
      </div>
      {kbFiles.length > 0 && (
        <Field label="Voice reference" hint="Past posts or style guide">
          <select value={(cfg.voice_kb_file_id as string) ?? ''} onChange={e => set('voice_kb_file_id', e.target.value || undefined)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="">No voice reference</option>
            {kbFiles.map(f => <option key={f.id} value={f.id}>{f.filename}</option>)}
          </select>
        </Field>
      )}
    </>
  );
}

function FetchUrlAuth({ step, onUpdate, onSave }: { step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void; onSave?: () => void }) {
  const [showPw, setShowPw] = useState(false);
  const enabled = !!step.config.auth_enabled;
  const auth = (step.config.auth ?? {}) as { username?: string; password?: string };
  const hasCredentials = !!(auth.username || auth.password);

  function toggle() {
    // Preserve credentials when toggling off — only flip the enabled flag
    onUpdate({ config: { ...step.config, auth_enabled: !enabled } });
  }

  function clear() {
    const { auth_enabled, auth: _a, ...rest } = step.config;
    void auth_enabled; void _a;
    onUpdate({ config: rest });
  }

  function setField(field: 'username' | 'password', value: string) {
    onUpdate({ config: { ...step.config, auth_enabled: true, auth: { ...auth, [field]: value } } });
  }

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-neutral-50">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <LockClosedIcon className={`w-3.5 h-3.5 flex-shrink-0 ${enabled ? 'text-indigo-500' : 'text-neutral-400'}`} />
          <span className={`text-[12px] font-medium ${enabled ? 'text-indigo-600' : 'text-neutral-500'}`}>
            Authentication
          </span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${enabled ? 'bg-indigo-100 text-indigo-600' : 'bg-neutral-200 text-neutral-500'}`}>
            {enabled ? 'on' : 'off'}
          </span>
        </button>
        {hasCredentials && (
          <button
            type="button"
            onClick={clear}
            className="text-[11px] text-neutral-400 hover:text-red-500 transition-colors flex-shrink-0"
          >
            Clear
          </button>
        )}
      </div>
      {enabled && (
        <div className="px-3 py-3 space-y-2 border-t border-neutral-200">
          <input
            type="text"
            value={auth.username ?? ''}
            onChange={e => setField('username', e.target.value)}
            onBlur={() => onSave?.()}
            placeholder="Username or email"
            autoComplete="off"
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={auth.password ?? ''}
              onChange={e => setField('password', e.target.value)}
              onBlur={() => onSave?.()}
              placeholder="Password"
              autoComplete="new-password"
              className="w-full px-3 py-2 pr-9 border border-neutral-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
            >
              {showPw ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-neutral-400 leading-snug">
            Uses HTTP Basic Auth. For sites that require a browser login, check if your source offers a subscriber RSS feed instead.
          </p>
        </div>
      )}
    </div>
  );
}

function ToolStepFields({ step, onUpdate, isEnhancing, isPending, onEnhance, onSave }: {
  step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void;
  isEnhancing?: boolean; isPending?: boolean; onSave?: () => void; onEnhance?: EnhanceFn;
}) {
  const tool = AVAILABLE_TOOLS.find(t => t.id === step.tool);
  const query = (step.config.query as string) ?? '';
  return (
    <>
      <Field label="Tool">
        <ToolPicker value={step.tool} onChange={id => onUpdate({ tool: id, config: {} })} />
      </Field>
      {step.tool === 'web_search' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11.5px] font-medium text-neutral-500">Search query</label>
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
            <div className="w-full px-3 py-2 border border-neutral-200 rounded-lg bg-neutral-50 space-y-2 min-h-[72px]">
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
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60" />
          )}
        </div>
      )}
      {(step.tool === 'fetch_url' || step.tool === 'browser_fetch') && (() => {
        const isBrowser = step.tool === 'browser_fetch';
        const urlValue = isBrowser
          ? (step.config.url as string) ?? ''
          : Array.isArray(step.config.urls) ? (step.config.urls as string[]).join('\n') : (step.config.urls as string) ?? '';
        function toggleBrowser() {
          const next = isBrowser ? 'fetch_url' : 'browser_fetch';
          const firstUrl = isBrowser
            ? (step.config.url as string) ?? ''
            : (Array.isArray(step.config.urls) ? (step.config.urls as string[])[0] : step.config.urls as string) ?? '';
          onUpdate({
            tool: next,
            config: next === 'browser_fetch'
              ? { ...step.config, url: firstUrl, urls: undefined }
              : { ...step.config, urls: [step.config.url as string].filter(Boolean), url: undefined },
          });
        }
        return (
          <>
            <Field label="URL" hint={isBrowser ? undefined : 'One URL per line, max 5'}>
              <textarea
                value={urlValue}
                onChange={e => {
                  const val = e.target.value;
                  isBrowser
                    ? onUpdate({ config: { ...step.config, url: val.trim() } })
                    : onUpdate({ config: { ...step.config, urls: val.split('\n').map(s => s.trim()).filter(Boolean) } });
                }}
                placeholder={isBrowser ? 'https://portal.example.com/dashboard' : 'https://example.com/pricing'}
                rows={isBrowser ? 1 : 3}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
            </Field>
            <button type="button" onClick={toggleBrowser} className="flex items-center gap-2 text-left">
              <div className={`relative flex-shrink-0 w-8 h-4 rounded-full transition-colors ${isBrowser ? 'bg-indigo-500' : 'bg-neutral-300'}`}>
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${isBrowser ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-[12px] text-neutral-500">Page requires JavaScript to load <span className="text-neutral-400">(e.g. dashboards, search results)</span></span>
            </button>
            <FetchUrlAuth step={step} onUpdate={onUpdate} onSave={onSave} />
          </>
        );
      })()}
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

      {step.tool === 'linkedin_post' && <LinkedInPostFields step={step} onUpdate={onUpdate} />}
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
  type KbFile = { id: string; filename: string; folder_id?: string | null };
  type DriveFolder = { id: string; name: string; is_system: boolean };
  const [kbFiles, setKbFiles] = useState<KbFile[]>([]);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [kbOpen, setKbOpen] = useState((step.kb_file_ids?.length ?? 0) > 0);

  useEffect(() => {
    Promise.all([
      fetch('/api/knowledge/files?limit=50').then(r => r.json()).then(d => d.data ?? []),
      fetch('/api/drive/folders').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    ]).then(([files, folders]) => {
      setKbFiles(files);
      setDriveFolders(folders);
    }).catch(() => {});
  }, []);

  const selectedIds = step.kb_file_ids ?? [];
  function toggleKbFile(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    onUpdate({ kb_file_ids: next.length > 0 ? next : undefined });
  }

  const userFolders = driveFolders.filter(f => !f.is_system);
  const folderNameMap = new Map(userFolders.map(f => [f.id, f.name]));
  const kbByFolder = kbFiles.reduce<Record<string, KbFile[]>>((acc, f) => {
    const name = f.folder_id ? (folderNameMap.get(f.folder_id) ?? 'Other') : 'Unfiled';
    (acc[name] ??= []).push(f);
    return acc;
  }, {});
  const kbFolders = [
    ...userFolders.map(f => f.name).filter(n => kbByFolder[n]),
    ...(kbByFolder['Unfiled'] ? ['Unfiled'] : []),
  ];

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11.5px] font-medium text-neutral-500">Instruction</label>
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
          <div className="w-full px-3 py-2 border border-neutral-200 rounded-lg bg-neutral-50 space-y-2 min-h-[96px]">
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
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60"
          />
        )}
      </div>
      {kbFiles.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setKbOpen(o => !o)}
            className="flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
          >
            <DocumentTextIcon className="w-3.5 h-3.5" />
            Reference documents
            {selectedIds.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold leading-none">
                {selectedIds.length}
              </span>
            )}
            <span className="text-neutral-400 text-[10px] ml-0.5">{kbOpen ? '▲' : '▼'}</span>
          </button>
          {kbOpen && (
            <div className="mt-1.5 border border-neutral-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
              {kbFolders.map(folder => (
                <div key={folder}>
                  <div className="px-3 py-1.5 bg-neutral-50 border-b border-neutral-100 text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wide">
                    {folder}
                  </div>
                  {kbByFolder[folder].map(f => (
                    <label key={f.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-neutral-50 border-b border-neutral-100 last:border-0">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(f.id)}
                        onChange={() => toggleKbFile(f.id)}
                        className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-[12px] text-neutral-700 truncate">{f.filename}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Output format">
          <select value={step.output_format ?? 'markdown'} onChange={e => onUpdate({ output_format: e.target.value as AIStep['output_format'] })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="markdown">Formatted</option>
            <option value="text">Text only</option>
            <option value="json">Structured (JSON)</option>
          </select>
        </Field>
        <Field label="Model">
          <select value={step.model_tier ?? 'fast'} onChange={e => onUpdate({ model_tier: e.target.value as AIStep['model_tier'] })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
            <option value="fast">Fast</option>
            <option value="reasoning">Thorough</option>
          </select>
        </Field>
      </div>
    </>
  );
}

function AgentStepFields({ step, agents, onUpdate, isEnhancing, isPending, onEnhance }: {
  step: AgentStep; agents: AgentOption[]; onUpdate: (p: Partial<AgentStep>) => void;
  isEnhancing?: boolean; isPending?: boolean; onEnhance?: EnhanceFn;
}) {
  return (
    <>
      <Field label="Agent">
        <select value={step.agent_id} onChange={e => onUpdate({ agent_id: e.target.value })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white">
          {agents.length === 0 && <option value="">No custom agents — create one in Work first</option>}
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11.5px] font-medium text-neutral-500">Task for this agent</label>
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
          <div className="w-full px-3 py-2 border border-neutral-200 rounded-lg bg-neutral-50 space-y-2 min-h-[96px]">
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-3/4" />
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-full" />
            <div className="h-2.5 bg-neutral-200 rounded animate-pulse w-2/3" />
          </div>
        ) : (
          <textarea value={step.prompt} onChange={e => onUpdate({ prompt: e.target.value })}
            placeholder="What should this agent do, using the previous step outputs as input?"
            rows={4}
            disabled={isEnhancing}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60" />
        )}
      </div>
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
