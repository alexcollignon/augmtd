'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  ChevronRightIcon,
  LockClosedIcon,
  BuildingOfficeIcon,
  IdentificationIcon,
  Cog6ToothIcon,
  PlusIcon,
  EllipsisVerticalIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import type {
  Workflow, WorkflowStep, WorkflowTrigger, OutputConfig,
  ToolStep, AIStep, AgentStep, SharingMode,
} from '@/lib/workflows/types';
import { makeStepId } from '@/lib/workflows/types';
import { SharingModeSelector } from '@/components/work/sharing-mode-selector';

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
  { id: 'get_emails',          label: 'Fetch emails',              description: 'Pull emails from your inbox — filter by mode, time window, sender, keywords or topic.' },
  { id: 'get_meeting_context', label: 'Fetch meeting context',     description: 'Returns recent meeting summaries, attendees, notes and action items.' },
  { id: 'get_calendar',        label: 'Fetch upcoming calendar',   description: 'Returns your next meetings with attendees and times.' },
  { id: 'read_kb_file',        label: 'Read a knowledge base file',description: 'Returns the full content of one KB file by id.' },
  { id: 'web_search',          label: 'Search the web',            description: 'Give it a topic and it finds relevant pages — like asking Google.' },
  { id: 'fetch_url',           label: 'Read a web page',           description: 'Reads the full current content of a URL every run.' },
  { id: 'rss_feed',            label: 'Follow a news feed or blog',description: 'Returns only new articles since your last run — no duplicates.' },
  { id: 'get_pt_tenders',      label: 'Portuguese public tenders', description: 'Fetches contracts and announcements from Portal Base (Base.gov.pt).' },
  { id: 'linkedin_post',       label: 'Generate LinkedIn posts',   description: 'Drafts 1–3 LinkedIn post variants from previous step content.' },
  { id: 'deep_research',       label: 'Deep research',             description: 'Takes topics from the previous step and researches each one in depth using AI + web search. Returns cited findings.' },
  { id: 'get_workflow_output', label: 'Read workflow output',      description: 'Reads the output of another workflow and passes it as context to the next step. Compose workflows together.' },
];

const TOOL_GROUPS = [
  { label: 'Your workspace', ids: ['get_emails', 'get_meeting_context', 'get_calendar', 'read_kb_file'] },
  { label: 'Web & research', ids: ['web_search', 'fetch_url', 'rss_feed', 'get_pt_tenders', 'deep_research'] },
  { label: 'Social media',   ids: ['linkedin_post'] },
];

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  get_emails:           EnvelopeIcon,
  get_urgent_emails:    EnvelopeIcon,
  get_meeting_context:  CalendarDaysIcon,
  get_calendar:         CalendarDaysIcon,
  read_kb_file:         DocumentTextIcon,
  web_search:           MagnifyingGlassIcon,
  fetch_url:            GlobeAltIcon,
  browser_fetch:        GlobeAltIcon,
  rss_feed:             NewspaperIcon,
  linkedin_post:        MegaphoneIcon,
  get_pt_tenders:       BuildingOfficeIcon,
  deep_research:        MagnifyingGlassIcon,
  get_workflow_output:  ArrowPathIcon,
};

const TOOL_STYLES: Record<string, { bg: string; logo?: string }> = {
  get_emails:           { bg: 'bg-rose-500' },
  get_urgent_emails:    { bg: 'bg-rose-500' },
  get_meeting_context:  { bg: 'bg-teal-500' },
  get_calendar:         { bg: 'bg-blue-500' },
  read_kb_file:         { bg: 'bg-violet-500' },
  web_search:        { bg: 'bg-amber-500' },
  fetch_url:         { bg: 'bg-sky-500' },
  browser_fetch:     { bg: 'bg-sky-500' },
  rss_feed:          { bg: 'bg-orange-500' },
  linkedin_post:     { bg: 'bg-[#0A66C2]' },
  get_pt_tenders:    { bg: 'bg-emerald-600' },
  deep_research:        { bg: 'bg-indigo-600' },
  get_workflow_output:  { bg: 'bg-teal-500' },
};

const STEP_TYPE_COLORS = {
  tool:  { bg: 'bg-blue-500',    activeBg: 'bg-blue-50',    activeText: 'text-blue-700' },
  ai:    { bg: 'bg-violet-500',  activeBg: 'bg-violet-50',  activeText: 'text-violet-700' },
  agent: { bg: 'bg-emerald-500', activeBg: 'bg-emerald-50', activeText: 'text-emerald-700' },
};

const STEP_TYPE_ICONS = {
  tool:  WrenchScrewdriverIcon,
  ai:    SparklesIcon,
  agent: UserCircleIcon,
};

type ActivePanel = 'identity' | 'trigger' | 'output' | { stepId: string };
type EnhanceFn = (prompt: string, label: string, context: { step_type: 'ai' | 'tool' | 'agent'; tool_type?: string; output_format?: string; model_tier?: string; field: 'prompt' | 'query' }) => void;
type ChatMsg = { role: 'user' | 'assistant'; content: string; patched?: boolean };

export function StudioBuilder({ workflow: initialWorkflow, agents, onClose, onBack }: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>('identity');
  const [enhancingStepId, setEnhancingStepId] = useState<string | null>(null);
  const [enhancePendingStepId, setEnhancePendingStepId] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [showAssistant, setShowAssistant] = useState(false);

  const resolvedPanel: ActivePanel = (() => {
    if (typeof activePanel === 'object') {
      if (!workflow.steps.some(s => s.id === activePanel.stepId)) return 'identity';
    }
    return activePanel;
  })();

  const activeStepIndex = typeof resolvedPanel === 'object'
    ? workflow.steps.findIndex(s => s.id === resolvedPanel.stepId)
    : -1;

  const patch = useCallback(<K extends keyof Workflow>(key: K, value: Workflow[K]) => {
    setWorkflow(w => ({ ...w, [key]: value }));
  }, []);

  const patchBulk = useCallback((updates: Partial<Workflow>) => {
    setWorkflow(w => ({ ...w, ...updates }));
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

  const startTestRun = useCallback(async () => {
    const saved = await save();
    const wfId = (saved ?? workflow).id;
    const res = await fetch(`/api/workflows/${wfId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    }).catch(() => null);
    if (res?.ok) {
      const { run_id } = await res.json();
      setTestRunId(run_id);
    }
  }, [save, workflow]);

  const addStep = useCallback((type: WorkflowStep['type'], insertAt?: number) => {
    const id = makeStepId();
    let step: WorkflowStep;
    if (type === 'tool') {
      step = { id, type: 'tool', label: 'New tool step', tool: 'get_emails', config: {} } as ToolStep;
    } else if (type === 'ai') {
      step = { id, type: 'ai', label: 'New AI step', prompt: '', output_format: 'markdown', model_tier: 'fast' } as AIStep;
    } else {
      step = { id, type: 'agent', label: 'New agent step', agent_id: agents[0]?.id ?? '', prompt: '' } as AgentStep;
    }
    setWorkflow(w => {
      const steps = [...w.steps];
      if (insertAt !== undefined) steps.splice(insertAt, 0, step);
      else steps.push(step);
      return { ...w, steps };
    });
    setActivePanel({ stepId: id });
  }, [agents]);

  const updateStep = useCallback((stepId: string, partial: Partial<WorkflowStep>) => {
    setWorkflow(w => ({
      ...w,
      steps: w.steps.map(s => s.id === stepId ? ({ ...s, ...partial } as WorkflowStep) : s),
    }));
  }, []);

  const removeStep = useCallback((stepId: string) => {
    setWorkflow(w => ({ ...w, steps: w.steps.filter(s => s.id !== stepId) }));
  }, []);

  const moveStep = useCallback((stepId: string, delta: -1 | 1) => {
    setWorkflow(w => {
      const idx = w.steps.findIndex(s => s.id === stepId);
      if (idx === -1) return w;
      const steps = [...w.steps];
      const target = idx + delta;
      if (target < 0 || target >= steps.length) return w;
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...w, steps };
    });
  }, []);

  const handleEnhanceStep = useCallback(async (
    stepId: string, prompt: string, stepLabel: string,
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
          } catch { /* ignore */ }
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
      <header className="h-12 px-4 border-b border-neutral-100 flex-shrink-0 flex items-center bg-white gap-4">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <button onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-neutral-700 transition-colors flex-shrink-0">
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            Back
          </button>
          <div className="w-px h-4 bg-neutral-200 flex-shrink-0" />
          <div className={`w-6 h-6 rounded-md ${colorBg} flex items-center justify-center flex-shrink-0`}>
            <PreviewIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[13px] font-semibold text-neutral-800 truncate">{workflow.name || 'Untitled'}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 bg-neutral-100 px-2 py-1 rounded-md">
            <LockClosedIcon className="w-3 h-3" />
            Private
          </span>
          {savedAt && (
            <span className="text-[11px] text-neutral-400">
              Autosaved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-1 justify-end">
          <button
            onClick={() => setShowAssistant(v => !v)}
            title={showAssistant ? 'Hide AI assistant' : 'Open AI assistant'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 border text-[12px] font-medium rounded-md transition-colors ${
              showAssistant
                ? 'border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
            }`}
          >
            <SparklesIcon className="w-3.5 h-3.5" />
            AI
          </button>
          <button onClick={startTestRun} disabled={saving || workflow.steps.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 text-neutral-700 text-[12px] font-medium rounded-md hover:bg-neutral-50 transition-colors disabled:opacity-40">
            <BoltIcon className="w-3.5 h-3.5" />
            Test run
          </button>
          <button onClick={() => save()} disabled={saving}
            className="px-3 py-1.5 border border-neutral-200 text-neutral-700 text-[12px] font-medium rounded-md hover:bg-neutral-50 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={saveAndClose} disabled={saving}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-medium rounded-md transition-colors disabled:opacity-50">
            Save & close
          </button>
        </div>
      </header>

      {/* 3-column body */}
      <div className="flex-1 flex overflow-hidden">
        {/* AI Assistant column */}
        {showAssistant && (
          <div className="flex-none w-[27%] min-w-[220px] max-w-[320px] border-r border-neutral-100 bg-white flex flex-col overflow-hidden">
            <AIAssistantPanel workflow={workflow} onPatch={patchBulk} onClose={() => setShowAssistant(false)} />
          </div>
        )}

        {/* Visual workflow center */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-neutral-50/60 flex justify-center">
          <VisualWorkflowColumn
            workflow={workflow}
            activePanel={resolvedPanel}
            agents={agents}
            onSelectPanel={setActivePanel}
            onAddStep={addStep}
          />
        </div>

        {/* Right config panel (or test run panel) */}
        <div className="flex-none w-[36%] min-w-[260px] max-w-[420px] border-l border-neutral-100 bg-white overflow-y-auto relative">
          <div className="px-4 py-5 space-y-5">
            {resolvedPanel === 'identity' && (
              <IdentitySection workflow={workflow} patch={patch} />
            )}
            {resolvedPanel === 'trigger' && (
              <div className="space-y-6">
                <div className="flex items-start gap-2.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    workflow.trigger.type === 'schedule' ? 'bg-amber-500' : 'bg-neutral-400'
                  }`}>
                    {workflow.trigger.type === 'schedule'
                      ? <ClockIcon className="w-5 h-5 text-white" />
                      : <BoltIcon className="w-5 h-5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10.5px] text-neutral-400 uppercase tracking-wide font-semibold mb-0.5">Trigger · Step</div>
                    <div className="text-[18px] font-semibold text-neutral-900 leading-tight">
                      {workflow.trigger.type === 'manual' ? 'Manual trigger' : triggerShortTitle(workflow.trigger)}
                    </div>
                  </div>
                </div>
                <div className="border-t border-neutral-100" />
                <TriggerEditor trigger={workflow.trigger} onChange={t => patch('trigger', t)} />
              </div>
            )}
            {resolvedPanel === 'output' && (
              <div className="space-y-5">
                <SectionHeader title="Output" subtitle="What happens when the workflow finishes?" />
                <OutputEditor output={workflow.output_config} onChange={o => patch('output_config', o)} />
              </div>
            )}
            {typeof resolvedPanel === 'object' && activeStepIndex !== -1 && (() => {
              const step = workflow.steps[activeStepIndex];
              return (
                <StepConfigSection
                  step={step}
                  index={activeStepIndex}
                  total={workflow.steps.length}
                  agents={agents}
                  isEnhancing={enhancingStepId === step.id}
                  isPending={enhancePendingStepId === step.id}
                  onUpdate={p => updateStep(step.id, p)}
                  onEnhance={(prompt, label, ctx) => handleEnhanceStep(step.id, prompt, label, ctx)}
                  onRemove={() => removeStep(step.id)}
                  onMove={d => moveStep(step.id, d)}
                  currentWorkflowId={workflow.id}
                />
              );
            })()}
          </div>

          {/* Test run panel — slides over the config panel */}
          {testRunId && (
            <TestRunPanel
              workflowId={workflow.id}
              runId={testRunId}
              steps={workflow.steps}
              onClose={async () => {
                // Clean up the test run record
                await fetch(`/api/workflows/${workflow.id}/runs/${testRunId}`, { method: 'DELETE' }).catch(() => {});
                setTestRunId(null);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Test run panel ────────────────────────────────────────────────────────────

type StepOutput = { step_type: string; label: string; output?: unknown; error?: string };

function TestRunPanel({ workflowId, runId, steps, onClose }: {
  workflowId: string;
  runId: string;
  steps: WorkflowStep[];
  onClose: () => void;
}) {
  const [status, setStatus] = useState<'queued' | 'running' | 'succeeded' | 'failed'>('queued');
  const [stepOutputs, setStepOutputs] = useState<StepOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      const res = await fetch(`/api/workflows/${workflowId}/runs/${runId}`).catch(() => null);
      if (!res?.ok) return;
      const { run } = await res.json();
      setStatus(run.status);
      if (run.step_outputs) setStepOutputs(run.step_outputs);
      if (run.error) setError(run.error);
      if (run.status === 'succeeded' || run.status === 'failed') {
        clearInterval(intervalRef.current!);
      }
    };
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => clearInterval(intervalRef.current!);
  }, [workflowId, runId]);

  const isDone = status === 'succeeded' || status === 'failed';

  return (
    <div className="absolute inset-0 bg-white flex flex-col z-10">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-neutral-100 flex-shrink-0">
        <BoltIcon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-neutral-800 flex-1">Test run</span>
        {!isDone && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className="w-3 h-3 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
            Running…
          </span>
        )}
        {isDone && (
          <span className={`text-[11px] font-medium ${status === 'succeeded' ? 'text-emerald-600' : 'text-red-500'}`}>
            {status === 'succeeded' ? '✓ Complete' : '✗ Failed'}
          </span>
        )}
        {isDone && (
          <button onClick={onClose}
            className="ml-1 text-[11px] text-neutral-400 hover:text-neutral-700 border border-neutral-200 rounded-md px-2.5 py-1 transition-colors">
            Close
          </button>
        )}
      </div>

      {/* Steps */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {steps.map((step, i) => {
          const out = stepOutputs[i];
          const isRunning = !isDone && stepOutputs.length === i;
          const isPending = !out && !isRunning;
          const isExpanded = expanded[i];

          const outputText = out
            ? (typeof out.output === 'string' ? out.output : JSON.stringify(out.output, null, 2))
            : null;

          return (
            <div key={step.id} className={`rounded-xl border transition-colors ${
              out?.error ? 'border-red-200 bg-red-50' : out ? 'border-emerald-100 bg-emerald-50/40' : isRunning ? 'border-indigo-100 bg-indigo-50/40' : 'border-neutral-100 bg-neutral-50'
            }`}>
              <button
                onClick={() => out && setExpanded(e => ({ ...e, [i]: !e[i] }))}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
                disabled={!out}>
                {/* Status indicator */}
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  {isRunning ? (
                    <span className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
                  ) : out?.error ? (
                    <span className="w-3 h-3 rounded-full bg-red-400" />
                  ) : out ? (
                    <CheckIcon className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <span className={`w-2 h-2 rounded-full ${isPending ? 'bg-neutral-300' : 'bg-neutral-300'}`} />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-medium ${isPending ? 'text-neutral-400' : 'text-neutral-800'}`}>
                    {step.label}
                  </div>
                  {out && !out.error && outputText && !isExpanded && (
                    <div className="text-[10.5px] text-neutral-500 truncate mt-0.5">
                      {outputText.slice(0, 80)}
                    </div>
                  )}
                  {out?.error && (
                    <div className="text-[10.5px] text-red-500 truncate mt-0.5">{out.error}</div>
                  )}
                </div>
                {out && !out.error && (
                  <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                )}
              </button>
              {isExpanded && outputText && (
                <div className="px-3.5 pb-3 text-[11px] text-neutral-600 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto border-t border-neutral-100 pt-2.5 mt-0">
                  {outputText.slice(0, 2000)}{outputText.length > 2000 ? '\n…' : ''}
                </div>
              )}
            </div>
          );
        })}

        {/* Overall error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[12px] text-red-600">
            {error}
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="px-4 py-3 border-t border-neutral-100 flex-shrink-0">
        <p className="text-[10.5px] text-neutral-400">Test output is not saved to inbox or history.</p>
      </div>
    </div>
  );
}

// ── Visual workflow components ────────────────────────────────────────────────

function AIAssistantPanel({ workflow, onPatch, onClose }: {
  workflow: Workflow;
  onPatch: (p: Partial<Workflow>) => void;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
          workflow,
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply ?? 'Something went wrong.',
        patched: !!data.patch,
      }]);
      if (data.patch) onPatch(data.patch);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2.5 border-b border-neutral-100 flex-shrink-0 flex items-center justify-between">
        <button type="button" onClick={() => setMessages([])}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-500 hover:text-neutral-800 transition-colors">
          <PlusIcon className="w-3.5 h-3.5" />
          New conversation
        </button>
        {onClose && (
          <button type="button" onClick={onClose}
            className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-700 transition-colors">
            <ChevronDownIcon className="w-3.5 h-3.5 rotate-90" />
          </button>
        )}
      </div>

      {/* Messages / greeting */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div>
            <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center mb-3">
              <SparklesIcon className="w-4 h-4 text-white" />
            </div>
            <p className="text-[15px] font-semibold text-neutral-900 leading-snug">How can I help?</p>
            <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">Ask me to change or improve this workflow.</p>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'user' ? (
                  <div className="max-w-[80%] bg-neutral-100 rounded-2xl rounded-br-sm px-4 py-2.5">
                    <p className="text-[13.5px] text-neutral-800 leading-relaxed whitespace-pre-wrap">{m.content}</p>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-[13.5px] text-neutral-800 leading-relaxed">{m.content}</p>
                    {m.patched && (
                      <div className="flex items-center gap-1 text-[11.5px] text-emerald-600 font-medium">
                        <CheckIcon className="w-3.5 h-3.5" />
                        Applied to workflow
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-1 pt-1">
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 flex-shrink-0">
        <div className="rounded-2xl bg-white shadow-sm border border-neutral-200 overflow-hidden">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything..."
            rows={1}
            disabled={loading}
            className="w-full px-4 pt-3 pb-1 text-[14px] text-neutral-800 placeholder:text-neutral-400 bg-transparent outline-none resize-none leading-relaxed disabled:opacity-50"
          />
          <div className="flex items-center px-3 pb-3 pt-1">
            <div className="ml-auto">
              <button type="button" onClick={send} disabled={!input.trim() || loading}
                className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-30 hover:bg-indigo-700 transition-colors">
                <PaperAirplaneIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineAddButton({ insertAt, agents, onAdd }: {
  insertAt: number;
  agents: AgentOption[];
  onAdd: (type: WorkflowStep['type'], at: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);
  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-5 h-5 rounded-full border-2 border-dashed border-neutral-300 flex items-center justify-center hover:border-indigo-400 hover:bg-indigo-50 transition-all group">
        <PlusIcon className="w-2.5 h-2.5 text-neutral-400 group-hover:text-indigo-500" />
      </button>
      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 bg-white border border-neutral-200 rounded-xl shadow-xl z-50 overflow-hidden min-w-[150px]">
          {([
            { type: 'tool' as const,  Icon: WrenchScrewdriverIcon, label: 'Tool step',  disabled: false },
            { type: 'ai' as const,    Icon: SparklesIcon,          label: 'AI step',    disabled: false },
            { type: 'agent' as const, Icon: UserCircleIcon,        label: 'Agent step', disabled: agents.length === 0 },
          ] as const).map(({ type, Icon, label, disabled }) => (
            <button key={type}
              onClick={() => { if (!disabled) { onAdd(type, insertAt); setOpen(false); } }}
              disabled={disabled}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-neutral-50 disabled:opacity-40 transition-colors">
              <Icon className="w-4 h-4 text-neutral-500" />
              <span className="text-[12.5px] text-neutral-700">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineDivider({ insertAt, agents, onAdd }: {
  insertAt: number;
  agents: AgentOption[];
  onAdd: (type: WorkflowStep['type'], at: number) => void;
}) {
  return (
    <div className="flex flex-col items-center flex-shrink-0">
      <div className="w-px h-2 bg-neutral-200" />
      <InlineAddButton insertAt={insertAt} agents={agents} onAdd={onAdd} />
      <div className="w-px h-2 bg-neutral-200" />
    </div>
  );
}

function VisualWorkflowColumn({
  workflow, activePanel, agents, onSelectPanel, onAddStep,
}: {
  workflow: Workflow;
  activePanel: ActivePanel;
  agents: AgentOption[];
  onSelectPanel: (p: ActivePanel) => void;
  onAddStep: (type: WorkflowStep['type'], insertAt?: number) => void;
}) {
  return (
    <div className="flex flex-col items-center py-8 px-6 w-full max-w-[420px]">
      {/* Header */}
      <div className="w-full mb-5">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-[14px] font-semibold text-neutral-900">Workflow</h2>
        </div>
        <p className="text-[11px] text-neutral-400">
          {workflow.steps.length} step{workflow.steps.length !== 1 ? 's' : ''} · click any step to edit
        </p>
      </div>

      {/* Trigger */}
      <TriggerFlowCard
        trigger={workflow.trigger}
        active={activePanel === 'trigger'}
        onClick={() => onSelectPanel('trigger')}
      />

      {/* Steps with inline add dividers */}
      {workflow.steps.map((step, idx) => (
        <div key={step.id} className="flex flex-col items-center w-full">
          <InlineDivider insertAt={idx} agents={agents} onAdd={onAddStep} />
          <StepFlowCard
            step={step}
            index={idx}
            active={typeof activePanel === 'object' && activePanel.stepId === step.id}
            onClick={() => onSelectPanel({ stepId: step.id })}
          />
        </div>
      ))}

      <InlineDivider insertAt={workflow.steps.length} agents={agents} onAdd={onAddStep} />

      {/* Output */}
      <OutputFlowCard
        output={workflow.output_config}
        stepNum={workflow.steps.length + 2}
        active={activePanel === 'output'}
        onClick={() => onSelectPanel('output')}
      />
    </div>
  );
}

function FlowConnector() {
  return (
    <div className="flex flex-col items-center flex-shrink-0">
      <div className="w-px h-4 bg-neutral-200" />
      <div className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
      <div className="w-px h-4 bg-neutral-200" />
    </div>
  );
}

function TriggerFlowCard({ trigger, active, onClick }: {
  trigger: WorkflowTrigger; active: boolean; onClick: () => void;
}) {
  const title = trigger.type === 'manual'
    ? 'Manual trigger'
    : (() => { try { return triggerShortTitle(trigger); } catch { return 'Scheduled'; } })();
  return (
    <div role="button" tabIndex={0}
      onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`w-full flex items-center gap-3 px-4 py-3.5 bg-white rounded-xl border-2 cursor-pointer transition-all ${
        active ? 'border-indigo-400 shadow-md' : 'border-neutral-100 hover:border-neutral-200 shadow-sm'
      }`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
        trigger.type === 'schedule' ? 'bg-amber-100' : 'bg-neutral-100'
      }`}>
        {trigger.type === 'schedule'
          ? <ClockIcon className="w-4 h-4 text-amber-600" />
          : <BoltIcon className="w-4 h-4 text-neutral-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-0.5">Trigger</div>
        <div className="text-[13px] font-semibold text-neutral-800 truncate">{title}</div>
      </div>
      <ChevronRightIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
    </div>
  );
}

function StepFlowCard({ step, index: _index, active, onClick }: {
  step: WorkflowStep; index: number; active: boolean;
  onClick: () => void;
}) {
  const colors = STEP_TYPE_COLORS[step.type];
  const TypeIcon = STEP_TYPE_ICONS[step.type];
  const toolId = step.type === 'tool' ? (step as ToolStep).tool : null;
  const toolStyle = toolId ? (TOOL_STYLES[toolId] ?? null) : null;
  const bgClass = toolStyle ? toolStyle.bg : colors.bg;
  const isLinkedIn = toolId === 'linkedin_post';

  const subtitle = (() => {
    if (step.type === 'tool') {
      const t = AVAILABLE_TOOLS.find(x => x.id === (step as ToolStep).tool);
      const toolLabel = t?.label ?? (step as ToolStep).tool;
      const cfg = (step as ToolStep).config;
      const detail = (cfg.query as string) || (cfg.url as string) || (cfg.topic as string) || (cfg.keywords as string) || '';
      return detail ? `${toolLabel} · ${detail.length > 38 ? detail.slice(0, 38) + '…' : detail}` : toolLabel;
    }
    if (step.type === 'ai') {
      const p = (step as AIStep).prompt?.trim();
      const snippet = p ? (p.length > 42 ? p.slice(0, 42) + '…' : p) : 'No instruction yet';
      return `AI · ${snippet}`;
    }
    const p = (step as AgentStep).prompt?.trim();
    const snippet = p ? (p.length > 42 ? p.slice(0, 42) + '…' : p) : 'No task yet';
    return `Agent · ${snippet}`;
  })();

  return (
    <div role="button" tabIndex={0}
      onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`w-full flex items-center gap-3 px-4 py-3.5 bg-white rounded-xl border-2 cursor-pointer transition-all ${
        active ? 'border-indigo-400 shadow-md' : 'border-neutral-100 hover:border-neutral-200 shadow-sm'
      }`}
    >
      <div className={`w-9 h-9 rounded-xl ${bgClass} flex items-center justify-center flex-shrink-0`}>
        {isLinkedIn ? (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="white" aria-hidden="true">
            <path d="M6.94 5a2 2 0 1 1-4-.002 2 2 0 0 1 4 .002zM7 8.48H3V21h4V8.48zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91l.04-1.68z"/>
          </svg>
        ) : (
          <TypeIcon className="w-4 h-4 text-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-neutral-800 truncate leading-tight">{step.label || '(unnamed)'}</div>
        <div className="text-[11.5px] text-neutral-400 truncate leading-tight mt-0.5">{subtitle}</div>
      </div>
      <ChevronRightIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
    </div>
  );
}

function OutputFlowCard({ output, stepNum: _stepNum, active, onClick }: {
  output: OutputConfig; stepNum: number; active: boolean; onClick: () => void;
}) {
  const destTitle: Record<string, string> = {
    thread_message: 'Send to inbox',
    artifact: 'Create document',
    multiple_artifacts: 'Create documents',
    email_draft: 'Draft email',
    living_document: 'Update document',
  };
  const notifLabel: Record<string, string> = {
    inbox_card: 'badge + notification',
    silent: 'silent',
    email_digest: 'email digest',
  };
  const title = output.title_template || destTitle[output.destination] || 'Output';
  const subtitle = `${destTitle[output.destination] ?? output.destination} · ${notifLabel[output.notification_mode] ?? output.notification_mode}`;
  return (
    <div role="button" tabIndex={0}
      onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`w-full flex items-center gap-3 px-4 py-3.5 bg-white rounded-xl border-2 cursor-pointer transition-all ${
        active ? 'border-indigo-400 shadow-md' : 'border-neutral-100 hover:border-neutral-200 shadow-sm'
      }`}
    >
      <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
        <EnvelopeIcon className="w-4 h-4 text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-0.5">Output</div>
        <div className="text-[13px] font-semibold text-neutral-800 truncate leading-tight">{title}</div>
        <div className="text-[11.5px] text-neutral-400 truncate mt-0.5">{subtitle}</div>
      </div>
      <ChevronRightIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
    </div>
  );
}

// ── Config sections ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[20px] font-semibold text-neutral-900">{title}</h2>
      {subtitle && <p className="text-[13px] text-neutral-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function IdentitySection({ workflow, patch }: {
  workflow: Workflow; patch: <K extends keyof Workflow>(k: K, v: Workflow[K]) => void;
}) {
  const colorBg = WORKFLOW_COLORS.find(c => c.key === workflow.color)?.bg ?? 'bg-indigo-500';
  const PreviewIcon = WORKFLOW_ICONS.find(i => i.key === workflow.icon)?.Icon ?? BoltIcon;
  return (
    <div className="space-y-6">
      <SectionHeader title="Identity" subtitle="Name and appearance of this workflow." />
      <div className="space-y-4">
        {/* Icon preview + colour row */}
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl ${colorBg} flex items-center justify-center shadow-sm transition-colors flex-shrink-0`}>
            <PreviewIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex gap-1.5 flex-wrap flex-1">
            {WORKFLOW_COLORS.map(c => (
              <button key={c.key} type="button" onClick={() => patch('color', c.key)}
                className={`w-5 h-5 rounded-full ${c.bg} transition-all ${
                  workflow.color === c.key ? `ring-2 ring-offset-1 ${c.ring}` : 'opacity-50 hover:opacity-90'
                }`} />
            ))}
          </div>
        </div>

        {/* Icon picker grid */}
        <div className="flex gap-1 flex-wrap">
          {WORKFLOW_ICONS.map(({ key, Icon }) => (
            <button key={key} type="button" onClick={() => patch('icon', key)}
              className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                workflow.icon === key ? 'bg-neutral-200 text-neutral-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600'
              }`}>
              <Icon className="w-3 h-3" />
            </button>
          ))}
        </div>

        {/* Name, description, sharing */}
        <Field label="Name">
          <input type="text" value={workflow.name} onChange={e => patch('name', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
        </Field>
        <Field label="Description">
          <input type="text" value={workflow.description ?? ''} onChange={e => patch('description', e.target.value)}
            placeholder="What does this workflow produce?"
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
        </Field>
        {workflow.is_owned_by_me !== false && (
          <Field label="Team sharing">
            <SharingModeSelector
              value={(workflow.sharing_mode as SharingMode | null | undefined) ?? null}
              onChange={mode => patch('sharing_mode', mode)}
            />
          </Field>
        )}
      </div>
    </div>
  );
}

function StepConfigSection({
  step, index, total, agents, isEnhancing, isPending, onUpdate, onEnhance, onRemove, onMove, currentWorkflowId,
}: {
  step: WorkflowStep; index: number; total: number; agents: AgentOption[];
  isEnhancing?: boolean; isPending?: boolean;
  onUpdate: (p: Partial<WorkflowStep>) => void;
  onEnhance?: EnhanceFn;
  onRemove?: () => void;
  onMove?: (d: -1 | 1) => void;
  currentWorkflowId?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const colors = STEP_TYPE_COLORS[step.type];
  const TypeIcon = STEP_TYPE_ICONS[step.type];
  const typeLabel = { tool: 'Tool', ai: 'AI', agent: 'Agent' }[step.type];

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpen]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5">
        <div className={`w-9 h-9 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          <TypeIcon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] text-neutral-400 uppercase tracking-wide font-semibold mb-0.5">
            {typeLabel} · Step {index + 1}
          </div>
          <input
            type="text"
            value={step.label}
            onChange={e => onUpdate({ label: e.target.value })}
            className="text-[18px] font-semibold text-neutral-900 bg-transparent w-full placeholder-neutral-300 leading-tight border-b border-transparent hover:border-neutral-300 focus:border-indigo-400 focus:outline-none transition-colors"
            placeholder="Step name"
          />
        </div>
        {(onRemove || onMove) && (
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button type="button" onClick={() => setMenuOpen(o => !o)}
              className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-400 transition-colors">
              <EllipsisVerticalIcon className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-xl z-50 overflow-hidden min-w-[140px]">
                {onMove && (
                  <>
                    <button type="button" onClick={() => { onMove(-1); setMenuOpen(false); }}
                      disabled={index === 0}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 transition-colors">
                      <ArrowUpIcon className="w-3.5 h-3.5 text-neutral-400" />
                      Move up
                    </button>
                    <button type="button" onClick={() => { onMove(1); setMenuOpen(false); }}
                      disabled={index === total - 1}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 transition-colors">
                      <ArrowDownIcon className="w-3.5 h-3.5 text-neutral-400" />
                      Move down
                    </button>
                    <div className="border-t border-neutral-100" />
                  </>
                )}
                {onRemove && (
                  <button type="button" onClick={() => { onRemove(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-red-600 hover:bg-red-50 transition-colors">
                    <TrashIcon className="w-3.5 h-3.5" />
                    Delete step
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-neutral-100" />
      {step.type === 'tool' && (
        <ToolStepFields step={step as ToolStep} onUpdate={onUpdate as (p: Partial<ToolStep>) => void}
          isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} currentWorkflowId={currentWorkflowId} />
      )}
      {step.type === 'ai' && (
        <AIStepFields step={step as AIStep} onUpdate={onUpdate as (p: Partial<AIStep>) => void}
          isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} />
      )}
      {step.type === 'agent' && (
        <AgentStepFields step={step as AgentStep} agents={agents} onUpdate={onUpdate as (p: Partial<AgentStep>) => void}
          isEnhancing={isEnhancing} isPending={isPending} onEnhance={onEnhance} />
      )}
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="block text-[11.5px] font-medium text-neutral-600">{label}</label>
        {hint && <span className="text-[10.5px] text-neutral-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ── TriggerEditor helpers ─────────────────────────────────────────────────────

type Freq = 'hourly' | 'every4h' | 'every8h' | 'every12h' | 'daily' | 'weekly' | 'monthly';

const FREQ_LABELS: Record<Freq, string> = {
  hourly: 'Hourly', every4h: 'Every 4h', every8h: 'Every 8h', every12h: 'Every 12h',
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
};

const COMMON_TZS = [
  'UTC', 'Europe/Lisbon', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Warsaw', 'Europe/Helsinki',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Tokyo', 'Australia/Sydney',
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseCronHuman(cron: string): { freq: Freq; days: number[]; hour: number; minute: number; dom: number } {
  const [, hr, domF, , dow] = (cron ?? '0 9 * * *').trim().split(/\s+/);
  const stepBase = hr.match(/^(\d+)\/(\d+)$/);
  if (stepBase) {
    const base = parseInt(stepBase[1], 10), step = parseInt(stepBase[2], 10);
    const freq = step === 4 ? 'every4h' : step === 8 ? 'every8h' : 'every12h';
    return { freq, days: [], hour: base, minute: 0, dom: 1 };
  }
  if (hr === '*')    return { freq: 'hourly',   days: [], hour: 0, minute: 0, dom: 1 };
  if (hr === '*/4')  return { freq: 'every4h',  days: [], hour: 0, minute: 0, dom: 1 };
  if (hr === '*/8')  return { freq: 'every8h',  days: [], hour: 0, minute: 0, dom: 1 };
  if (hr === '*/12') return { freq: 'every12h', days: [], hour: 0, minute: 0, dom: 1 };
  const hour   = parseInt(hr, 10);
  const domNum = parseInt(domF, 10);
  if (domF !== '*') return { freq: 'monthly', days: [], hour: isNaN(hour) ? 9 : hour, minute: 0, dom: isNaN(domNum) ? 1 : domNum };
  if (dow === '*')  return { freq: 'daily',   days: [], hour: isNaN(hour) ? 9 : hour, minute: 0, dom: 1 };
  const days = dow.split(',').map(Number).filter(n => n >= 0 && n <= 6);
  return { freq: 'weekly', days, hour: isNaN(hour) ? 9 : hour, minute: 0, dom: 1 };
}

function buildCron(freq: Freq, days: number[], hour: number, _minute: number, dom: number): string {
  const h = hour;
  if (freq === 'hourly')   return `0 * * * *`;
  if (freq === 'every4h')  return h === 0 ? `0 */4 * * *`  : `0 ${h}/4 * * *`;
  if (freq === 'every8h')  return h === 0 ? `0 */8 * * *`  : `0 ${h}/8 * * *`;
  if (freq === 'every12h') return h === 0 ? `0 */12 * * *` : `0 ${h}/12 * * *`;
  if (freq === 'daily')    return `0 ${h} * * *`;
  if (freq === 'monthly')  return `0 ${h} ${dom} * *`;
  const d = days.length > 0 ? days.sort((a, b) => a - b).join(',') : '1';
  return `0 ${h} * * ${d}`;
}

function fmtHour12(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}${suffix}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function cronPreview(freq: Freq, days: number[], hour: number, _minute: number, dom: number, tz: string): string {
  const t = fmtHour12(hour);
  const tzShort = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  if (freq === 'hourly')   return `Every hour · ${tzShort}`;
  if (freq === 'every4h')  return `Every 4 hours from ${t} · ${tzShort}`;
  if (freq === 'every8h')  return `Every 8 hours from ${t} · ${tzShort}`;
  if (freq === 'every12h') return `Every 12 hours from ${t} · ${tzShort}`;
  if (freq === 'daily')    return `Every day at ${t} · ${tzShort}`;
  if (freq === 'monthly')  return `${ordinal(dom)} of every month at ${t} · ${tzShort}`;
  const dayNames = (days.length > 0 ? days.sort((a, b) => a - b) : [1]).map(d => DOW_LABELS[d]).join(', ');
  return `Every ${dayNames} at ${t} · ${tzShort}`;
}

function triggerShortTitle(trigger: WorkflowTrigger): string {
  if (trigger.type === 'manual') return 'Manual trigger';
  const { freq, days, hour, dom } = parseCronHuman(trigger.cron ?? '0 9 * * *');
  const t = `${String(hour).padStart(2, '0')}:00`;
  if (freq === 'hourly')   return 'Every hour';
  if (freq === 'every4h')  return `Every 4h from ${t}`;
  if (freq === 'every8h')  return `Every 8h from ${t}`;
  if (freq === 'every12h') return `Every 12h from ${t}`;
  if (freq === 'daily')    return `Every day · ${t}`;
  if (freq === 'monthly')  return `${ordinal(dom)} of month · ${t}`;
  const dayNames = (days.length > 0 ? days.sort((a, b) => a - b) : [1]).map(d => DOW_LABELS[d]).join(', ');
  return `Every ${dayNames} · ${t}`;
}

function TriggerEditor({ trigger, onChange }: { trigger: WorkflowTrigger; onChange: (t: WorkflowTrigger) => void }) {
  const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const parsed = parseCronHuman(trigger.type === 'schedule' ? (trigger.cron ?? '0 9 * * *') : '0 9 * * *');
  const [freq, setFreq] = useState<Freq>(parsed.freq);
  const [days, setDays] = useState<number[]>(parsed.days);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [dom, setDom] = useState(parsed.dom);
  const [tz, setTz] = useState(trigger.type === 'schedule' ? (trigger.timezone ?? userTz) : userTz);

  const emit = (f: Freq, d: number[], h: number, m: number, domVal: number, z: string) =>
    onChange({ type: 'schedule', cron: buildCron(f, d, h, m, domVal), timezone: z });

  const handleFreq = (f: Freq) => { setFreq(f); emit(f, days, hour, minute, dom, tz); };
  const handleDay  = (d: number) => {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
    setDays(next); emit(freq, next, hour, minute, dom, tz);
  };
  const handleHour = (h: number) => { setHour(h); emit(freq, days, h, minute, dom, tz); };
  const handleDom  = (d: number) => { setDom(d);  emit(freq, days, hour, minute, d, tz); };
  const handleTz   = (z: string) => { setTz(z);   emit(freq, days, hour, minute, dom, z); };

  return (
    <>
      <div className="flex gap-2">
        <button onClick={() => onChange({ type: 'manual' })}
          className={`flex-1 px-3 py-2 text-[12.5px] font-medium rounded-md border transition-colors ${
            trigger.type === 'manual' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
          }`}>
          <BoltIcon className="w-4 h-4 inline mr-1.5" />
          Manual only
        </button>
        <button onClick={() => { const cron = buildCron(freq, days, hour, minute, dom); onChange({ type: 'schedule', cron, timezone: tz }); }}
          className={`flex-1 px-3 py-2 text-[12.5px] font-medium rounded-md border transition-colors ${
            trigger.type === 'schedule' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
          }`}>
          On a schedule
        </button>
      </div>

      {trigger.type === 'schedule' && (
        <div className="pt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FREQ_LABELS) as Freq[]).map(f => (
              <button key={f} onClick={() => handleFreq(f)}
                className={`px-2.5 py-1 text-[12px] font-medium rounded-md border transition-colors ${
                  freq === f ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                }`}>
                {FREQ_LABELS[f]}
              </button>
            ))}
          </div>

          {freq === 'weekly' && (
            <div className="flex gap-1.5">
              {DOW_LABELS.map((label, i) => (
                <button key={i} onClick={() => handleDay(i)}
                  className={`w-9 h-9 text-[12px] font-medium rounded-full border transition-colors ${
                    days.includes(i) ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {(freq === 'every4h' || freq === 'every8h' || freq === 'every12h') && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-500">Starting at</span>
              <input type="time" step="3600" value={`${String(hour).padStart(2, '0')}:00`}
                onChange={e => { const [h] = e.target.value.split(':').map(Number); if (!isNaN(h)) handleHour(h); }}
                className="px-2 py-1.5 border border-neutral-200 rounded-md text-[13px] bg-white" />
            </div>
          )}

          {freq === 'monthly' && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-500">On the</span>
              <select value={dom} onChange={e => handleDom(parseInt(e.target.value, 10))}
                className="px-2 py-1.5 border border-neutral-200 rounded-md text-[13px] bg-white">
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{ordinal(d)}</option>
                ))}
              </select>
            </div>
          )}

          {(freq === 'daily' || freq === 'weekly' || freq === 'monthly') && (
            <input type="time" step="3600" value={`${String(hour).padStart(2, '0')}:00`}
              onChange={e => { const [h] = e.target.value.split(':').map(Number); if (!isNaN(h)) handleHour(h); }}
              className="px-2 py-1.5 border border-neutral-200 rounded-md text-[13px] bg-white" />
          )}

          <select value={tz} onChange={e => handleTz(e.target.value)}
            className="w-full px-2 py-1.5 border border-neutral-200 rounded-md text-[13px] bg-white">
            {COMMON_TZS.includes(tz) ? null : <option value={tz}>{tz}</option>}
            {COMMON_TZS.map(z => <option key={z} value={z}>{z}</option>)}
          </select>

          <p className="text-[12px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-md px-3 py-2">
            {cronPreview(freq, days, hour, minute, dom, tz)}
          </p>
        </div>
      )}
    </>
  );
}

// ── Tool sub-components ───────────────────────────────────────────────────────

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
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="thought_leadership">Thought leadership</option>
            <option value="conversational">Conversational</option>
            <option value="data_driven">Data-driven</option>
          </select>
        </Field>
        <Field label="Length">
          <select value={(cfg.length as string) ?? 'standard'} onChange={e => set('length', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="short">Short ~100w</option>
            <option value="standard">Standard ~200w</option>
            <option value="long">Long ~350w</option>
          </select>
        </Field>
        <Field label="Format">
          <select value={(cfg.format as string) ?? 'insight'} onChange={e => set('format', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="story">Story</option>
            <option value="insight">Insight</option>
            <option value="question">Question</option>
            <option value="list">List</option>
          </select>
        </Field>
        <Field label="Language">
          <select value={(cfg.language as string) ?? 'en'} onChange={e => set('language', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="pt">Portuguese</option>
          </select>
        </Field>
        <Field label="Variants">
          <select value={String(cfg.variants ?? 1)} onChange={e => set('variants', Number(e.target.value))}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="1">1 draft</option>
            <option value="2">2 drafts</option>
            <option value="3">3 drafts</option>
          </select>
        </Field>
        <Field label="Image prompt">
          <label className="flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-md cursor-pointer">
            <input type="checkbox" checked={cfg.include_image_prompt === true} onChange={e => set('include_image_prompt', e.target.checked)}
              className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-[13px] text-neutral-700">Include visual prompt</span>
          </label>
        </Field>
      </div>
      {kbFiles.length > 0 && (
        <Field label="Voice reference">
          <select value={(cfg.voice_kb_file_id as string) ?? ''} onChange={e => set('voice_kb_file_id', e.target.value || undefined)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="">No voice reference</option>
            {kbFiles.map(f => <option key={f.id} value={f.id}>{f.filename}</option>)}
          </select>
        </Field>
      )}
    </>
  );
}

function ToolPickerIcon({ toolId, size = 'md' }: { toolId: string; size?: 'sm' | 'md' }) {
  const style = TOOL_STYLES[toolId] ?? { bg: 'bg-neutral-400' };
  const Icon = TOOL_ICONS[toolId] ?? WrenchScrewdriverIcon;
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const iconDim = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div className={`${dim} rounded-lg ${style.bg} flex items-center justify-center flex-shrink-0`}>
      {toolId === 'linkedin_post' ? (
        <svg viewBox="0 0 24 24" className={iconDim} fill="white" aria-hidden="true">
          <path d="M6.94 5a2 2 0 1 1-4-.002 2 2 0 0 1 4 .002zM7 8.48H3V21h4V8.48zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91l.04-1.68z"/>
        </svg>
      ) : (
        <Icon className={`${iconDim} text-white`} />
      )}
    </div>
  );
}

function ToolPicker({ value, onChange }: { value: string; onChange: (toolId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const displayId = value === 'browser_fetch' ? 'fetch_url' : (value === 'get_urgent_emails' ? 'get_emails' : value);
  const current = AVAILABLE_TOOLS.find(t => t.id === displayId);
  const q = search.toLowerCase();
  const filtered = AVAILABLE_TOOLS.filter(t =>
    !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  );

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    setOpen(o => !o);
    setSearch('');
  };

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!dropRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function ToolRow({ t }: { t: typeof AVAILABLE_TOOLS[number] }) {
    const isSelected = t.id === displayId;
    return (
      <button type="button" onClick={() => { onChange(t.id); setOpen(false); setSearch(''); }}
        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-neutral-50'}`}>
        <ToolPickerIcon toolId={t.id} size="md" />
        <div className="min-w-0 flex-1">
          <div className={`text-[13px] font-medium leading-tight ${isSelected ? 'text-indigo-700' : 'text-neutral-800'}`}>{t.label}</div>
          <div className="text-[11px] text-neutral-400 leading-snug mt-0.5">{t.description}</div>
        </div>
        {isSelected && <CheckIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0 ml-1" />}
      </button>
    );
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={handleOpen}
        className="w-full flex items-center gap-2.5 px-3 py-2 border border-neutral-200 rounded-lg bg-white text-left hover:bg-neutral-50 transition-colors">
        <ToolPickerIcon toolId={displayId} size="sm" />
        <span className="text-[13px] text-neutral-800 flex-1 truncate">{current?.label ?? value}</span>
        <ChevronDownIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
      </button>
      {open && createPortal(
        <div ref={dropRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 300), zIndex: 9999 }}
          className="bg-white border border-neutral-200 rounded-xl shadow-xl overflow-hidden">
          {/* Search */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg">
              <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search actions…"
                className="flex-1 text-[12.5px] bg-transparent outline-none text-neutral-800 placeholder:text-neutral-400" />
            </div>
          </div>
          {/* List */}
          <div className="max-h-80 overflow-y-auto pb-1.5">
            {q ? (
              filtered.length === 0
                ? <p className="px-4 py-3 text-[12px] text-neutral-400">No results</p>
                : filtered.map(t => <ToolRow key={t.id} t={t} />)
            ) : (
              TOOL_GROUPS.map(g => {
                const groupTools = g.ids.map(id => AVAILABLE_TOOLS.find(t => t.id === id)!).filter(Boolean);
                return (
                  <div key={g.label}>
                    <div className="px-3 pt-3 pb-1">
                      <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-widest">{g.label}</span>
                    </div>
                    {groupTools.map(t => <ToolRow key={t.id} t={t} />)}
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function KbFilePickerField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [files, setFiles] = useState<Array<{ id: string; filename: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/knowledge/files?limit=100')
      .then(r => r.json())
      .then(d => setFiles(d.data ?? []))
      .finally(() => setLoading(false));
  }, []);
  return (
    <Field label="Document">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-indigo-300">
        <option value="">{loading ? 'Loading…' : files.length === 0 ? 'No documents found' : 'Select a document…'}</option>
        {files.map(f => <option key={f.id} value={f.id}>{f.filename}</option>)}
      </select>
    </Field>
  );
}

function InlineToolGrid({ value, onChange }: { value: string; onChange: (toolId: string) => void }) {
  const displayId = value === 'browser_fetch' ? 'fetch_url' : (value === 'get_urgent_emails' ? 'get_emails' : value);
  const groups = [
    { label: 'Your Workspace',  ids: ['get_emails', 'get_meeting_context', 'get_calendar', 'read_kb_file'] },
    { label: 'Web & Research',  ids: ['web_search', 'fetch_url', 'rss_feed', 'get_pt_tenders', 'deep_research'] },
    { label: 'Social & Output', ids: ['linkedin_post'] },
    { label: 'Pipeline',        ids: ['get_workflow_output'] },
  ];
  return (
    <div className="space-y-3">
      {groups.map(g => {
        const tools = g.ids.map(id => AVAILABLE_TOOLS.find(t => t.id === id)!).filter(Boolean);
        return (
          <div key={g.label}>
            <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5">{g.label}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {tools.map(t => {
                const isSelected = t.id === displayId;
                return (
                  <button key={t.id} type="button"
                    onClick={() => onChange(t.id)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-200'
                        : 'bg-white border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                    }`}>
                    <ToolPickerIcon toolId={t.id} size="sm" />
                    <span className={`text-[11.5px] font-medium leading-tight truncate ${isSelected ? 'text-indigo-800' : 'text-neutral-700'}`}>
                      {t.label}
                    </span>
                    {isSelected && <CheckIcon className="w-3 h-3 text-indigo-500 flex-shrink-0 ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToolStepFields({ step, onUpdate, isEnhancing, isPending, onEnhance, currentWorkflowId }: {
  step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void;
  isEnhancing?: boolean; isPending?: boolean; onEnhance?: EnhanceFn;
  currentWorkflowId?: string;
}) {
  const query = (step.config.query as string) ?? '';
  const isFetchBased = step.tool === 'fetch_url' || step.tool === 'browser_fetch';
  const auth = step.config.auth as { username: string; password: string } | undefined;

  return (
    <>
      <Field label="Choose a tool">
        <InlineToolGrid value={step.tool} onChange={toolId => onUpdate({ tool: toolId, config: {} })} />
      </Field>
      {step.tool === 'web_search' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11.5px] font-medium text-neutral-600">Search query</label>
            {onEnhance && (
              <button type="button"
                onClick={() => onEnhance(query, step.label, { step_type: 'tool', tool_type: 'web_search', field: 'query' })}
                disabled={isEnhancing || !query.trim()}
                className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors">
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
            <textarea value={query} onChange={e => onUpdate({ config: { ...step.config, query: e.target.value } })}
              placeholder="e.g. Germany Portugal business news today" rows={3} disabled={isEnhancing}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60" />
          )}
        </div>
      )}
      {isFetchBased && (
        <>
          <Field label="URLs to read" hint="One URL per line, max 5">
            <textarea
              value={Array.isArray(step.config.urls) ? (step.config.urls as string[]).join('\n') : (step.config.urls as string) ?? ''}
              onChange={e => onUpdate({ config: { ...step.config, urls: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })}
              placeholder={'https://example.com/pricing\nhttps://competitor.com/blog'} rows={3}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
          </Field>
          <label className="flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-md cursor-pointer bg-neutral-50">
            <input type="checkbox" checked={step.tool === 'browser_fetch'}
              onChange={e => onUpdate({ tool: e.target.checked ? 'browser_fetch' : 'fetch_url', config: step.config })}
              className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-[12.5px] text-neutral-700">Page requires JavaScript to load (e.g. dashboards, search results)</span>
          </label>
          <div>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" checked={!!auth}
                onChange={e => onUpdate({ config: { ...step.config, auth: e.target.checked ? { username: '', password: '' } : undefined } })}
                className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-600">
                <LockClosedIcon className="w-3.5 h-3.5" />
                Basic authentication (for paywalled pages)
              </span>
            </label>
            {auth && (
              <div className="grid grid-cols-2 gap-2 pl-6">
                <input type="text" placeholder="Username" value={auth.username ?? ''}
                  onChange={e => onUpdate({ config: { ...step.config, auth: { ...auth, username: e.target.value } } })}
                  className="px-3 py-2 border border-neutral-200 rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                <input type="password" placeholder="Password" value={auth.password ?? ''}
                  onChange={e => onUpdate({ config: { ...step.config, auth: { ...auth, password: e.target.value } } })}
                  className="px-3 py-2 border border-neutral-200 rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
            )}
          </div>
        </>
      )}
      {step.tool === 'rss_feed' && (
        <>
          <Field label="Feed URLs" hint="One URL per line">
            <textarea
              value={Array.isArray(step.config.feeds) ? (step.config.feeds as string[]).join('\n') : (step.config.feeds as string) ?? ''}
              onChange={e => onUpdate({ config: { ...step.config, feeds: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })}
              placeholder={'https://hnrss.org/frontpage\nhttps://feeds.feedburner.com/example'} rows={3}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
          </Field>
          <Field label="Time window">
            <select value={(step.config.since as string) ?? 'last_run'}
              onChange={e => onUpdate({ config: { ...step.config, since: e.target.value } })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
              <option value="last_run">Since last run</option>
              <option value="24h">Past 24 hours</option>
              <option value="7d">Past 7 days</option>
            </select>
          </Field>
        </>
      )}
      {step.tool === 'read_kb_file' && (
        <KbFilePickerField
          value={(step.config.file_id as string) ?? ''}
          onChange={id => onUpdate({ config: { ...step.config, file_id: id } })}
        />
      )}
      {(step.tool === 'get_emails' || step.tool === 'get_urgent_emails') && (
        <GetEmailsFields step={step} onUpdate={onUpdate} />
      )}
      {step.tool === 'get_meeting_context' && <GetMeetingContextFields step={step} onUpdate={onUpdate} />}
      {step.tool === 'linkedin_post' && <LinkedInPostFields step={step} onUpdate={onUpdate} />}
      {step.tool === 'get_pt_tenders' && <PtTendersFields step={step} onUpdate={onUpdate} />}
      {step.tool === 'deep_research' && <DeepResearchFields step={step} onUpdate={onUpdate} />}
      {step.tool === 'get_workflow_output' && (
        <WorkflowOutputFields step={step} onUpdate={onUpdate} currentWorkflowId={currentWorkflowId ?? ''} />
      )}
    </>
  );
}

function GetEmailsFields({ step, onUpdate }: { step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void }) {
  const cfg = step.config;
  const set = (k: string, v: unknown) => onUpdate({ config: { ...cfg, [k]: v } });
  const keywords = Array.isArray(cfg.keywords) ? (cfg.keywords as string[]).join(', ') : (cfg.keywords as string) ?? '';
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mode">
          <select value={(cfg.mode as string) ?? 'recent'} onChange={e => set('mode', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="recent">Recent</option>
            <option value="urgent">Urgent (unread)</option>
            <option value="all">All (no time filter)</option>
          </select>
        </Field>
        <Field label="Time window">
          <select value={(cfg.since as string) ?? '7d'} onChange={e => set('since', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
            disabled={(cfg.mode as string) === 'all'}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </Field>
      </div>
      <Field label="From (sender filter)" hint="Optional — partial match">
        <input type="text" value={(cfg.from as string) ?? ''}
          onChange={e => set('from', e.target.value || undefined)}
          placeholder="e.g. john@acme.com or Acme Corp"
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
      </Field>
      <Field label="Topic" hint="Optional — free-text">
        <input type="text" value={(cfg.topic as string) ?? ''}
          onChange={e => set('topic', e.target.value || undefined)}
          placeholder="e.g. invoice payment contract"
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
      </Field>
      <Field label="Keywords" hint="Comma-separated, OR logic">
        <input type="text" value={keywords}
          onChange={e => {
            const list = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            set('keywords', list.length > 0 ? list : undefined);
          }}
          placeholder="e.g. proposal, contract, urgent"
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max emails">
          <input type="number" min={1} max={50} value={(cfg.limit as number) ?? 15}
            onChange={e => set('limit', Number(e.target.value))}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
        </Field>
        <Field label="Unread only">
          <label className="flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-md cursor-pointer h-full">
            <input type="checkbox" checked={cfg.unread_only === true} onChange={e => set('unread_only', e.target.checked || undefined)}
              className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-[13px] text-neutral-700">Yes</span>
          </label>
        </Field>
      </div>
    </>
  );
}

function GetMeetingContextFields({ step, onUpdate }: { step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void }) {
  const cfg = step.config;
  const set = (k: string, v: unknown) => onUpdate({ config: { ...cfg, [k]: v } });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lookback window">
          <select value={(cfg.since as string) ?? '30d'} onChange={e => set('since', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="7d">Last 7 days</option>
            <option value="14d">Last 14 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </Field>
        <Field label="Include">
          <select value={(cfg.include as string) ?? 'summaries'} onChange={e => set('include', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="summaries">Summaries</option>
            <option value="notes">Notes + actions</option>
            <option value="both">Both</option>
          </select>
        </Field>
      </div>
      <Field label="With person" hint="Optional — partial name or email">
        <input type="text" value={(cfg.with_person as string) ?? ''}
          onChange={e => set('with_person', e.target.value || undefined)}
          placeholder="e.g. Sarah or sarah@company.com"
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max meetings">
          <input type="number" min={1} max={30} value={(cfg.limit as number) ?? 10}
            onChange={e => set('limit', Number(e.target.value))}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
        </Field>
        <Field label="Upcoming meetings">
          <label className="flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-md cursor-pointer h-full">
            <input type="checkbox" checked={cfg.include_upcoming === true} onChange={e => set('include_upcoming', e.target.checked || undefined)}
              className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-[13px] text-neutral-700">Include</span>
          </label>
        </Field>
      </div>
    </>
  );
}

function PtTendersFields({ step, onUpdate }: { step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void }) {
  return (
    <>
      <Field label="Days back">
        <select value={String(step.config.days ?? 7)} onChange={e => onUpdate({ config: { ...step.config, days: Number(e.target.value) } })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </Field>
      <Field label="Data">
        <select value={(step.config.endpoint as string) ?? 'both'} onChange={e => onUpdate({ config: { ...step.config, endpoint: e.target.value } })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="both">Contracts + Announcements</option>
          <option value="contracts">Awarded contracts only</option>
          <option value="announcements">Open announcements only</option>
        </select>
      </Field>
      <Field label="CPV prefix filter" hint="Optional — e.g. 45, 72">
        <input type="text" value={(step.config.cpv_prefix as string) ?? ''}
          onChange={e => onUpdate({ config: { ...step.config, cpv_prefix: e.target.value || undefined } })}
          placeholder="Leave blank to include all categories"
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
      </Field>
      <Field label="Minimum value (€)" hint="Optional">
        <input type="number" value={(step.config.min_value as number) ?? ''}
          onChange={e => onUpdate({ config: { ...step.config, min_value: e.target.value ? Number(e.target.value) : undefined } })}
          placeholder="e.g. 50000" min={0}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
      </Field>
    </>
  );
}

function DeepResearchFields({ step, onUpdate }: { step: ToolStep; onUpdate: (p: Partial<ToolStep>) => void }) {
  const queriesRaw = Array.isArray(step.config.queries)
    ? (step.config.queries as string[]).join('\n')
    : (step.config.queries as string) ?? '';

  return (
    <>
      <Field label="Research focus" hint="What makes a topic relevant for this workflow">
        <input
          type="text"
          value={(step.config.focus as string) ?? ''}
          onChange={e => onUpdate({ config: { ...step.config, focus: e.target.value } })}
          placeholder="e.g. German-Portuguese bilateral business and investment"
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
        />
      </Field>
      <Field label="Explicit queries" hint="One per line. Leave blank to extract topics from the previous step automatically.">
        <textarea
          value={queriesRaw}
          onChange={e => {
            const lines = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
            onUpdate({ config: { ...step.config, queries: lines.length > 0 ? lines : undefined } });
          }}
          placeholder={'OpenAI competitor pricing changes\nAnthropic model releases this week'}
          rows={3}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max topics">
          <input
            type="number"
            min={1} max={10}
            value={(step.config.max_topics as number) ?? 6}
            onChange={e => onUpdate({ config: { ...step.config, max_topics: Number(e.target.value) } })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]"
          />
        </Field>
        <Field label="Searches per topic">
          <input
            type="number"
            min={1} max={5}
            value={(step.config.max_searches as number) ?? 3}
            onChange={e => onUpdate({ config: { ...step.config, max_searches: Number(e.target.value) } })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Output language">
          <select
            value={(step.config.language as string) ?? 'en'}
            onChange={e => onUpdate({ config: { ...step.config, language: e.target.value } })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="pt">Português</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="it">Italiano</option>
            <option value="nl">Nederlands</option>
          </select>
        </Field>
        <Field label="Model">
          <select
            value={(step.config.model as string) ?? 'fast'}
            onChange={e => onUpdate({ config: { ...step.config, model: e.target.value } })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
          >
            <option value="fast">Fast (Haiku)</option>
            <option value="thorough">Thorough (Sonnet)</option>
          </select>
        </Field>
      </div>
      <p className="text-[11px] text-neutral-400 leading-relaxed">
        Runs on AWS Bedrock (EU) — data stays within AWS infrastructure regardless of your account tier.
      </p>
    </>
  );
}

function WorkflowOutputFields({
  step, onUpdate, currentWorkflowId,
}: {
  step: ToolStep;
  onUpdate: (p: Partial<ToolStep>) => void;
  currentWorkflowId: string;
}) {
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/workflows')
      .then(r => r.json())
      .then(d => setWorkflows((d.workflows ?? []).filter((w: { id: string }) => w.id !== currentWorkflowId)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentWorkflowId]);

  const sourceId = (step.config.source_workflow_id as string) ?? '';
  const runCount = (step.config.run_count as number) ?? 1;
  const outputOnly = step.config.output_only !== false;

  return (
    <>
      <Field label="Source workflow">
        <select
          value={sourceId}
          onChange={e => onUpdate({ config: { ...step.config, source_workflow_id: e.target.value } })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
        >
          <option value="">
            {loading ? 'Loading…' : workflows.length === 0 ? 'No other workflows yet' : 'Select a workflow…'}
          </option>
          {workflows.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </Field>

      <Field label="What to read">
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: true,  label: 'Final output', hint: 'The finished result of the last step' },
            { value: false, label: 'All step data', hint: 'Raw data from every step (RSS, searches, etc.)' },
          ] as { value: boolean; label: string; hint: string }[]).map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onUpdate({ config: { ...step.config, output_only: opt.value } })}
              className={`flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-all ${
                outputOnly === opt.value
                  ? 'bg-indigo-50 border-indigo-200'
                  : 'bg-white border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <span className={`text-[12px] font-semibold ${outputOnly === opt.value ? 'text-indigo-800' : 'text-neutral-700'}`}>
                {opt.label}
              </span>
              <span className="text-[11px] text-neutral-400 leading-snug">{opt.hint}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="How many runs">
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 1, label: 'Latest only' },
            { value: 3, label: 'Last 3' },
            { value: 7, label: 'Last 7' },
          ] as { value: number; label: string }[]).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onUpdate({ config: { ...step.config, run_count: opt.value } })}
              className={`px-2 py-2 rounded-lg border text-[12px] font-medium transition-all ${
                runCount === opt.value
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                  : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

function AIStepFields({ step, onUpdate, isEnhancing, isPending, onEnhance }: {
  step: AIStep; onUpdate: (p: Partial<AIStep>) => void;
  isEnhancing?: boolean; isPending?: boolean; onEnhance?: EnhanceFn;
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
    ]).then(([files, folders]) => { setKbFiles(files); setDriveFolders(folders); }).catch(() => {});
  }, []);

  const selectedIds = step.kb_file_ids ?? [];
  const toggleKbFile = (id: string) => {
    const next = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    onUpdate({ kb_file_ids: next.length > 0 ? next : undefined });
  };

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
          <label className="text-[11.5px] font-medium text-neutral-600">Instruction</label>
          {onEnhance && (
            <button type="button"
              onClick={() => onEnhance(step.prompt, step.label, { step_type: 'ai', output_format: step.output_format, model_tier: step.model_tier, field: 'prompt' })}
              disabled={isEnhancing || !step.prompt.trim()}
              className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors">
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
          <textarea value={step.prompt} onChange={e => onUpdate({ prompt: e.target.value })}
            placeholder="What should the AI do with the previous step outputs?"
            rows={4} disabled={isEnhancing}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60" />
        )}
      </div>
      {kbFiles.length > 0 && (
        <div>
          <button type="button" onClick={() => setKbOpen(o => !o)}
            className="flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-500 hover:text-neutral-700 transition-colors">
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
            <div className="mt-1.5 border border-neutral-200 rounded-md overflow-hidden max-h-48 overflow-y-auto">
              {kbFolders.map(folder => (
                <div key={folder}>
                  <div className="px-3 py-1.5 bg-neutral-50 border-b border-neutral-100 text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wide">{folder}</div>
                  {kbByFolder[folder].map(f => (
                    <label key={f.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-neutral-50 border-b border-neutral-100 last:border-0">
                      <input type="checkbox" checked={selectedIds.includes(f.id)} onChange={() => toggleKbFile(f.id)}
                        className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
                      <span className="text-[12px] text-neutral-700 truncate">{f.filename}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <Field label="Output format">
        <div className="flex rounded-lg border border-neutral-200 overflow-hidden">
          {([
            { value: 'markdown', label: 'Markdown' },
            { value: 'text',     label: 'Bullet list' },
            { value: 'json',     label: 'Structured' },
          ] as const).map(({ value: v, label }) => (
            <button key={v} type="button"
              onClick={() => onUpdate({ output_format: v })}
              className={`flex-1 px-2 py-1.5 text-[11.5px] font-medium transition-colors border-r border-neutral-200 last:border-0 ${
                (step.output_format ?? 'markdown') === v
                  ? 'bg-indigo-500 text-white'
                  : 'bg-white text-neutral-600 hover:bg-neutral-50'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Model">
        <select value={step.model_tier ?? 'fast'} onChange={e => onUpdate({ model_tier: e.target.value as AIStep['model_tier'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="fast">Fast · standard quality</option>
          <option value="reasoning">Thorough · higher quality</option>
        </select>
      </Field>
    </>
  );
}

function AgentStepFields({
  step, agents, onUpdate, isEnhancing, isPending, onEnhance,
}: {
  step: AgentStep; agents: AgentOption[]; onUpdate: (p: Partial<AgentStep>) => void;
  isEnhancing?: boolean; isPending?: boolean; onEnhance?: EnhanceFn;
}) {
  return (
    <>
      <Field label="Agent">
        <select value={step.agent_id} onChange={e => onUpdate({ agent_id: e.target.value })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          {agents.length === 0 && <option value="">No custom agents — create one first</option>}
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11.5px] font-medium text-neutral-600">Task for this agent</label>
          {onEnhance && (
            <button type="button"
              onClick={() => onEnhance(step.prompt, step.label, { step_type: 'agent', field: 'prompt' })}
              disabled={isEnhancing || !step.prompt.trim()}
              className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors">
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
          <textarea value={step.prompt} onChange={e => onUpdate({ prompt: e.target.value })}
            placeholder="What should this agent do, using the previous step outputs as input?"
            rows={4} disabled={isEnhancing}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 disabled:opacity-60" />
        )}
      </div>
    </>
  );
}

function OutputEditor({ output, onChange }: { output: OutputConfig; onChange: (o: OutputConfig) => void }) {
  const [connections, setConnections] = useState<{ id: string; provider: string; email: string }[]>([]);

  useEffect(() => {
    if (output.notification_mode !== 'email_digest') return;
    fetch('/api/connections').then(r => r.json()).then(d => setConnections(d.connections ?? [])).catch(() => {});
  }, [output.notification_mode]);

  const toggleEmailId = (id: string) => {
    const current = output.notification_email_ids ?? [];
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    onChange({ ...output, notification_email_ids: next });
  };

  return (
    <>
      <Field label="Destination">
        <select value={output.destination} onChange={e => onChange({ ...output, destination: e.target.value as OutputConfig['destination'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="thread_message">Message in thread</option>
          <option value="artifact">Document artifact</option>
        </select>
      </Field>
      {output.destination === 'artifact' && (
        <>
          <Field label="Artifact type">
            <select value={output.artifact_type ?? 'document'} onChange={e => onChange({ ...output, artifact_type: e.target.value as OutputConfig['artifact_type'] })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
              <option value="document">Word document</option>
              <option value="email">Email draft</option>
            </select>
          </Field>
          <Field label="Title template">
            <input type="text" value={output.title_template ?? ''} onChange={e => onChange({ ...output, title_template: e.target.value })}
              placeholder="Weekly Briefing — {{date}}"
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
            <p className="text-[11.5px] text-neutral-500 mt-1">
              Use <code className="bg-neutral-100 px-1 rounded">{'{{date}}'}</code>,{' '}
              <code className="bg-neutral-100 px-1 rounded">{'{{week_of}}'}</code>, or{' '}
              <code className="bg-neutral-100 px-1 rounded">{'{{workflow}}'}</code>.
            </p>
          </Field>
        </>
      )}
      <Field label="Output language" hint="All AI steps in this workflow write in this language">
        <select value={output.output_language ?? 'en'} onChange={e => onChange({ ...output, output_language: e.target.value || undefined })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="pt">Português</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
          <option value="it">Italiano</option>
          <option value="nl">Nederlands</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
        </select>
      </Field>
      <Field label="Notifications">
        <select value={output.notification_mode} onChange={e => onChange({ ...output, notification_mode: e.target.value as OutputConfig['notification_mode'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="inbox_card">Inbox card (badge + notification)</option>
          <option value="silent">Silent (no notification)</option>
          <option value="email_digest">Email digest</option>
        </select>
      </Field>
      {output.notification_mode === 'email_digest' && connections.length > 0 && (
        <Field label="Send to">
          <div className="space-y-1.5">
            {connections.map(c => {
              const checked = (output.notification_email_ids ?? []).includes(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => toggleEmailId(c.id)}
                    className="w-3.5 h-3.5 rounded accent-indigo-600" />
                  <span className="text-[13px] text-neutral-700 truncate">{c.email}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${c.provider === 'gmail' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                    {c.provider === 'gmail' ? 'Gmail' : 'Outlook'}
                  </span>
                </label>
              );
            })}
          </div>
        </Field>
      )}
    </>
  );
}
