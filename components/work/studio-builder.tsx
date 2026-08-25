'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { toast } from 'sonner';
import { isToolAllowed } from '@/lib/workspace/tool-capabilities';
import { DEFAULT_FEATURES, type WorkspaceFeatures } from '@/lib/workspace/types';

// Workspace feature flags (cached across the builder) — disable steps whose feature is off.
let _featuresCache: WorkspaceFeatures | null = null;
function useWorkspaceFeatures(): WorkspaceFeatures {
  const [features, setFeatures] = useState<WorkspaceFeatures>(_featuresCache ?? DEFAULT_FEATURES);
  useEffect(() => {
    if (_featuresCache) return;
    fetch('/api/workspace/features').then(r => r.json()).then(d => {
      if (d.features) { _featuresCache = d.features; setFeatures(d.features); }
    }).catch(() => {});
  }, []);
  return features;
}
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
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
  HandRaisedIcon,
  UsersIcon,
  XMarkIcon,
  DocumentPlusIcon,
  MicrophoneIcon,
  ArrowPathRoundedSquareIcon,
  Square2StackIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline';
import type {
  Workflow, WorkflowStep, WorkflowTrigger, OutputConfig,
  ToolStep, AIStep, AgentStep, SharingMode,
  VerifyStep, ApprovalStep, HandoffStep, GateVerdict, GateFinding,
} from '@/lib/workflows/types';
import { makeStepId, normalizeOutput } from '@/lib/workflows/types';
import {
  TRIGGER_SOURCES, triggerSource, normalizeTriggers, doorLabel,
  filterFieldsFor, describeFilters, FILTER_OP_LABEL,
  type ReactionDoor, type TriggerSourceKey, type DoorFilter, type DoorFilterOp, type FilterFieldDef,
} from '@/lib/workflows/trigger-sources';
import { builtinChecksFor, GATE_BUILTIN_LINES } from '@/lib/workflows/builtin-checks';
import type {
  WorkflowInputDoc as LibWorkflowInputDoc, WorkflowInputs as LibWorkflowInputs,
} from '@/lib/workflows/inputs';
// THE THROTTLE (relay canvas W3b) — ONE CAP, ONE HOME: the floors and the default are the
// ENGINE's constants, imported, never re-typed here (a second copy of 1–100 is a second law).
import {
  FIRE_LIMIT_DEFAULT, FIRE_LIMIT_MIN, FIRE_LIMIT_MAX, clampFireLimit, type FireLimit,
} from '@/lib/workflows/fire-limit';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { SharingModeSelector } from '@/components/work/sharing-mode-selector';
import { LINKEDIN_FRAMEWORKS } from '@/lib/tools/linkedin-post';

interface AgentOption {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  is_worker?: boolean;
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

// ── THE WHEN BLOCK (THE RELAY CANVAS, W1 — docs/relay-canvas-plan.md) ─────────
// Law 3: the SOURCE LIST lives in lib/workflows/trigger-sources.ts and nowhere else. All this
// surface owns is the icon-name → component mapping (a shared module cannot import heroicons
// components); an unmapped icon name degrades to the bolt, it never drops the row.
const TRIGGER_SOURCE_ICON: Record<string, typeof BoltIcon> = {
  EnvelopeIcon,
  DocumentPlusIcon,
  MicrophoneIcon,
  ArrowPathRoundedSquareIcon,
};
function sourceIcon(iconName: string | undefined): typeof BoltIcon {
  return (iconName && TRIGGER_SOURCE_ICON[iconName]) || BoltIcon;
}

// ── THE INPUTS TRAY (THE RELAY CANVAS, W2 — docs/relay-canvas-plan.md, law 7) ─
// A workflow's reference material (a policy, a template) is CONFIG, not a buried skill — so it
// is drawn on the rail, hanging off the WHEN block on a dashed connector: what the run WORKS
// WITH, beside what it DOES. Served on the workflow GET as `inputs`, written through the same
// PATCH every other builder edit rides — one door, no second endpoint. The picker reads the ONE
// knowledge-file source the chat composer's @-mention already reads.
// The shape is the ENGINE's (lib/workflows/inputs.ts) — type-only, so no server graph rides in.
type WorkflowInputDoc = LibWorkflowInputDoc;
type WorkflowInputs = LibWorkflowInputs;

/** Whatever the route served, read as the shape the tray edits. A malformed read is an empty tray. */
function normalizeInputs(raw: unknown): WorkflowInputs {
  const o = (raw ?? {}) as { docs?: unknown; acceptMaterial?: unknown };
  const docs = Array.isArray(o.docs)
    ? (o.docs as Array<Record<string, unknown>>)
        .filter(d => d && typeof d.kbFileId === 'string' && (d.kbFileId as string).length > 0)
        .map(d => ({ kbFileId: String(d.kbFileId), name: typeof d.name === 'string' && d.name.trim() ? String(d.name) : 'Document' }))
    : [];
  return { docs, acceptMaterial: o.acceptMaterial === true };
}

// The doors column is additive (jsonb, may not exist in every environment yet), so the builder
// carries it as an extension of Workflow rather than waiting on the shared type. `inputs` rides
// the same way: `undefined` = not yet read (never write it), `null`/object = known.
type WorkflowDraft = Workflow & {
  triggers?: ReactionDoor[];
  inputs?: WorkflowInputs | null;
  /** THE THROTTLE (W3b) — served on the workflow GET; `undefined` = not yet read (never write it). */
  fireLimit?: FireLimit;
};

/** Whatever the route served, read as the throttle. Absence IS the default — the store keeps no
 *  "unset" value, so a malformed or missing read is the platform default, never a zero. */
function normalizeFireLimit(raw: unknown): FireLimit {
  const o = (raw ?? null) as { dailyFires?: unknown; isDefault?: unknown } | null;
  if (!o || o.dailyFires === undefined || o.dailyFires === null) {
    return { dailyFires: FIRE_LIMIT_DEFAULT, isDefault: true };
  }
  const value = clampFireLimit(o.dailyFires).value;
  return { dailyFires: value, isDefault: o.isDefault === true || value === FIRE_LIMIT_DEFAULT };
}

// THE SUBPROCESS STATION (relay canvas W3, law 5) — a step that hands the baton to ANOTHER
// workflow: the parent parks, the child runs its own rail with its own gate, its deliverable
// resumes the parent. Named off the union rather than off the engine's exported symbol, so the
// surface binds to the SCHEMA, not to a name.
type ProcessStep = Extract<WorkflowStep, { type: 'workflow' }>;
type CaseStepDraft = Extract<WorkflowStep, { type: 'case' }>;
// THE INPUT STATION (relay canvas, THE WAVE) — the station that stops the run and ASKS the person
// for what only they have at run time. Named off the union, like every other station's draft type.
type InputStepDraft = Extract<WorkflowStep, { type: 'input' }>;

// The `workflow` door binds a workflow_id — the picker reads the user's own tasks (self excluded).
// THE SUBPROCESS STATION (W3) reads the SAME list through the SAME cache, so a workflow named
// once is named the same at both doors. It needs two more served facts to be honest about what it
// may include: the row's status (a draft cannot be run by a parent) and whether the row ALREADY
// contains a process (law 5's depth cap of one, refused at authoring time rather than at run time).
type WorkflowOption = { id: string; name: string; status?: string; containsProcess: boolean };
let _wfOptionsCache: WorkflowOption[] | null = null;
function useWorkflowOptions(): WorkflowOption[] {
  const [options, setOptions] = useState<WorkflowOption[]>(_wfOptionsCache ?? []);
  useEffect(() => {
    if (_wfOptionsCache) return;
    fetch('/api/workflows').then(r => r.json()).then((d: {
      workflows?: Array<{ id: string; name: string; is_owned_by_me?: boolean; status?: string; steps?: unknown }>;
    }) => {
      const list = (d.workflows ?? [])
        .filter(w => w.is_owned_by_me !== false)
        .map(w => ({
          id: w.id,
          name: w.name,
          status: w.status,
          containsProcess: Array.isArray(w.steps)
            && (w.steps as Array<{ type?: string }>).some(s => s?.type === 'workflow'),
        }));
      _wfOptionsCache = list;
      setOptions(list);
    }).catch(() => {});
  }, []);
  return options;
}

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
  { id: 'get_workflow_output', label: "Use a coworker's task",      description: "Pulls the latest output of another coworker's task and passes it as context. Build on what a teammate already produced." },
  { id: 'slack_read_channel',  label: 'Read a Slack channel',      description: 'Returns recent messages from a Slack channel this coworker is in — to summarize, digest, or act on. Config: channel (#name or id), limit.' },
  { id: 'slack_send',          label: 'Send a Slack message',      description: 'Posts a message to a channel, written by this coworker from your instruction + what the pipeline produced. Notify a team, tag people. Config: channel + instruction.' },
  { id: 'run_compute',         label: 'Compute over files/data',   description: 'Runs code in a locked sandbox over your files (spreadsheets, PDFs, CSVs) or prior step data — parse, reconcile, verify numbers, produce a data file. Cannot send anything.' },
];

const TOOL_GROUPS = [
  { label: 'Gather',      ids: ['get_emails', 'get_meeting_context', 'get_calendar', 'read_kb_file', 'web_search', 'fetch_url', 'rss_feed', 'get_pt_tenders', 'deep_research', 'slack_read_channel'] },
  { label: 'Compute',     ids: ['run_compute'] },
  { label: 'Collaborate', ids: ['get_workflow_output'] },
  { label: 'Act',         ids: ['slack_send'] },
  // linkedin_post deprecated from the picker — superseded by the LinkedIn coworker + a LinkedIn skill (still runs for existing tasks).
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
  slack_read_channel:   ChatBubbleLeftRightIcon,
  slack_send:           PaperAirplaneIcon,
  run_compute:          CpuChipIcon,
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
  slack_read_channel:   { bg: 'bg-[#4A154B]' },
  slack_send:           { bg: 'bg-[#4A154B]' },
  run_compute:          { bg: 'bg-neutral-800' },
};

const STEP_TYPE_COLORS = {
  tool:  { bg: 'bg-blue-500',    activeBg: 'bg-blue-50',    activeText: 'text-blue-700' },
  ai:    { bg: 'bg-violet-500',  activeBg: 'bg-violet-50',  activeText: 'text-violet-700' },
  agent: { bg: 'bg-emerald-500', activeBg: 'bg-emerald-50', activeText: 'text-emerald-700' },
  verify:   { bg: 'bg-teal-600',  activeBg: 'bg-teal-50',  activeText: 'text-teal-700' },
  approval: { bg: 'bg-amber-500', activeBg: 'bg-amber-50', activeText: 'text-amber-700' },
  handoff:  { bg: 'bg-violet-500', activeBg: 'bg-violet-50', activeText: 'text-violet-700' },
  workflow: { bg: 'bg-violet-600', activeBg: 'bg-violet-50', activeText: 'text-violet-700' },
  // THE CASE STATION (W4) — a normalizer, not a producer: it wears the tool family's blue.
  case: { bg: 'bg-blue-500', activeBg: 'bg-indigo-50', activeText: 'text-indigo-700' },
};

const STEP_TYPE_ICONS = {
  tool:  WrenchScrewdriverIcon,
  ai:    SparklesIcon,
  agent: UserCircleIcon,
  verify:   ShieldCheckIcon,
  approval: HandRaisedIcon,
  handoff:  UsersIcon,
  workflow: Square2StackIcon,
  case: ArrowsRightLeftIcon,
};

// ── THE PINNED STATION (guardrails v1.1) ──────────────────────────────────────
// The delivery gate is a STATION, not a list member: exactly one, always seated after the last
// content step and before any trailing approval steps. Applied on every steps MUTATION (never on
// load — opening a saved workflow must not rewrite it), so the label "Checked before delivery"
// can never become a false claim by drift.
function seatGate(steps: WorkflowStep[]): WorkflowStep[] {
  const firstVerify = steps.find(s => s.type === 'verify');
  if (!firstVerify) return steps;
  const rest = steps.filter(s => s.type !== 'verify');
  let at = rest.length;
  // THE HUMAN STATIONS COME AFTER THE CHECK: a trailing approval OR handoff is a person waiting
  // on the draft — they must see a CHECKED one. seatGate moves only the verify station; the
  // handoff itself sits where the author placed it and stays reorderable.
  while (at > 0 && (rest[at - 1].type === 'approval' || rest[at - 1].type === 'handoff')) at--;
  const next = [...rest.slice(0, at), firstVerify, ...rest.slice(at)];
  const unchanged = next.length === steps.length && next.every((s, i) => s === steps[i]);
  return unchanged ? steps : next;
}

// THE PROTECTIVE DEFAULT — the tools that bring OUTSIDE material into the pipeline. When the
// user's own action introduces one (or an external delivery home), the gate seats itself.
const EXTERNAL_MATERIAL_TOOLS = new Set([
  'rss_feed', 'web_search', 'fetch_url', 'deep_research', 'get_pt_tenders', 'browser_fetch',
]);

function withGate(steps: WorkflowStep[]): WorkflowStep[] {
  if (steps.some(s => s.type === 'verify')) return steps;
  const gate: VerifyStep = { id: makeStepId(), type: 'verify', label: 'Check before delivery', rules: [] };
  return [...steps, gate];
}

type ActivePanel = 'identity' | 'trigger' | 'output' | { stepId: string };
type EnhanceFn = (prompt: string, label: string, context: { step_type: 'ai' | 'tool' | 'agent'; tool_type?: string; output_format?: string; model_tier?: string; field: 'prompt' | 'query' }) => void;
type ChatMsg = { role: 'user' | 'assistant'; content: string; patched?: boolean };

export function StudioBuilder({ workflow: initialWorkflow, agents, onClose, onBack }: Props) {
  const [workflow, setWorkflow] = useState<WorkflowDraft>(initialWorkflow);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>('identity');
  const [enhancingStepId, setEnhancingStepId] = useState<string | null>(null);
  const [enhancePendingStepId, setEnhancePendingStepId] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [showAssistant, setShowAssistant] = useState(true);

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

  // An explicit removal of the gate is the human's decision — it sticks for the session.
  const gateDismissedRef = useRef(false);
  const autoSeat = useCallback((steps: WorkflowStep[]) =>
    seatGate(gateDismissedRef.current ? steps : withGate(steps)), []);

  // ── THE WHEN BLOCK's two independent writes (the destroyer-bug floor) ───────
  // The primary (manual/schedule) and the event doors are DIFFERENT config. Editing one never
  // reads, rewrites, or drops the other: setPrimary touches `trigger` only, setDoors touches
  // `triggers` only — except for THE LEGACY MIGRATION, which is explicit in both directions:
  // a pre-W1 `trigger:{type:'reaction'}` normalizes to a mail door, and the first write of
  // either half lands `trigger:{type:'manual'}` + that door in `triggers` IN THE SAME UPDATE.
  // Nothing here can leave a reaction behind.
  const setPrimary = useCallback((t: WorkflowTrigger) => {
    setWorkflow(w => {
      if (w.trigger?.type !== 'reaction') return { ...w, trigger: t };
      const { doors } = normalizeTriggers(w);   // folds the legacy reaction into a mail door
      return { ...w, trigger: t, triggers: doors };
    });
  }, []);

  const setDoors = useCallback((doors: ReactionDoor[]) => {
    setWorkflow(w => ({
      ...w,
      triggers: doors,
      // The doors list the editor hands back ALREADY contains the folded legacy door, so the
      // legacy carrier can retire — never before, never silently.
      trigger: w.trigger?.type === 'reaction' ? { type: 'manual' } : w.trigger,
    }));
  }, []);

  // THE TRAY'S ONE READ. `inputs` is additive config the page's SSR'd row does not carry, so the
  // builder hydrates it once from the workflow GET — the same door that serves it everywhere
  // else. It NEVER overwrites an edit the user already made (undefined = not yet read).
  const workflowId = initialWorkflow.id;
  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/${workflowId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (dead || !j) return;
        // `null` is the route's own word for NEVER CONFIGURED — kept as null so a save doesn't
        // write an empty tray nobody asked for. The rail draws its ghost line either way.
        const served = (j.workflow as { inputs?: unknown } | undefined)?.inputs ?? j.inputs ?? null;
        // THE THROTTLE rides the SAME one read (W3b) — one door, no second endpoint.
        const servedLimit = (j.workflow as { fireLimit?: unknown } | undefined)?.fireLimit ?? j.fireLimit ?? null;
        setWorkflow(w => ({
          ...w,
          ...(w.inputs === undefined ? { inputs: served === null ? null : normalizeInputs(served) } : {}),
          ...(w.fireLimit === undefined ? { fireLimit: normalizeFireLimit(servedLimit) } : {}),
        }));
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [workflowId]);

  const setInputs = useCallback((next: WorkflowInputs) => {
    setWorkflow(w => ({ ...w, inputs: next }));
  }, []);

  // THE THROTTLE (W3b) — the field holds a real number at all times; the FLOORS are the engine's.
  // `isDefault` is derived from the value itself, exactly as the store reads it back (writing the
  // default DELETES the row), so the "(default)" word can never disagree with what is stored.
  const setFireLimit = useCallback((n: number) => {
    const value = clampFireLimit(n).value;
    setWorkflow(w => ({ ...w, fireLimit: { dailyFires: value, isDefault: value === FIRE_LIMIT_DEFAULT } }));
  }, []);

  const patchBulk = useCallback((updates: Partial<Workflow>) => {
    setWorkflow(w => {
      const next = { ...w, ...updates };
      // The assistant patches steps like any other mutation — the station re-seats.
      if (updates.steps) next.steps = seatGate(updates.steps);
      return next;
    });
  }, []);

  // `statusOverride` exists for THE ACTIVATION DOOR below — state updates are async, so the
  // activating save must carry the new status itself rather than race a setState.
  const save = useCallback(async (statusOverride?: Workflow['status']): Promise<Workflow | null> => {
    setSaving(true);
    try {
      // ONE PERSISTENCE PATH for the WHEN block: both halves are written from the SAME normalized
      // read on EVERY save, so `trigger` and `triggers` can never shear — and a legacy reaction
      // trigger MIGRATES here (primary manual + its mail door) instead of being overwritten away.
      const { primary, doors } = normalizeTriggers(workflow);
      const triggerToSave: WorkflowTrigger = primary.type === 'schedule'
        ? { type: 'schedule', cron: primary.cron ?? '0 9 * * *', ...(primary.timezone ? { timezone: primary.timezone } : {}), ...(primary.label ? { label: primary.label } : {}) }
        : { type: 'manual' };
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: workflow.name,
          description: workflow.description,
          icon: workflow.icon,
          color: workflow.color,
          trigger: triggerToSave,
          triggers: doors,
          steps: workflow.steps,
          output_config: workflow.output_config,
          status: statusOverride ?? workflow.status,
          agent_id: workflow.agent_id ?? null,
          worker_instructions: workflow.worker_instructions ?? null,
          skill_ids: workflow.skill_ids ?? [],
          // The tray rides the existing save — but only once it has been READ (undefined) and only
          // when there is a tray to write (null = never configured; writing it would be a no-op
          // delete). Sending an unhydrated value would let a save wipe material we never saw.
          ...(workflow.inputs ? { inputs: workflow.inputs } : {}),
          // THE THROTTLE rides the same save, and only once READ (undefined = never seen). It is
          // sent even at the default — the store's own rule is that the default DELETES the row,
          // so "back to 20" must be sayable, not a value that can only ever go up.
          ...(workflow.fireLimit ? { fire_limit: workflow.fireLimit.dailyFires } : {}),
        }),
      });
      if (res.ok) {
        const payload = await res.json() as {
          workflow: WorkflowDraft; fireLimit?: unknown; fire_limit_clamped?: boolean;
        };
        const saved = payload.workflow;
        // A response that doesn't echo the additive column must not erase the doors we just wrote.
        setWorkflow(saved.triggers === undefined ? { ...saved, triggers: doors } : saved);
        // The same rule for the tray: a response that doesn't echo `inputs` must not erase it.
        if (saved.inputs === undefined && workflow.inputs !== undefined) {
          const keep = workflow.inputs;
          setWorkflow(w => ({ ...w, inputs: keep }));
        }
        // THE THROTTLE, same rule — the row echo carries no fireLimit, so the read must survive
        // the save. A CLAMPED echo is the server's word: the field takes it, and we SAY it.
        if (workflow.fireLimit !== undefined) {
          const served = payload.fireLimit ?? saved.fireLimit;
          const kept = served !== undefined ? normalizeFireLimit(served) : workflow.fireLimit;
          setWorkflow(w => ({ ...w, fireLimit: kept }));
          if (payload.fire_limit_clamped) {
            toast.message(`Kept within ${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX} — now ${kept.dailyFires} event runs a day.`);
          }
        }
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

  // THE ACTIVATION DOOR (found live: "Adjust in Studio" creates a DRAFT, the ledger row says
  // "finish it in Studio", and Studio had no way to finish — a dead-end loop of the lying-door
  // class). A draft's primary action turns it on EXPLICITLY — the word is the deed; no save
  // ever flips status silently.
  const saveAndActivate = useCallback(async () => {
    const saved = await save('active');
    onClose(saved ?? { ...workflow, status: 'active' });
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
      step = { id, type: 'ai', label: 'New writing step', prompt: '', output_format: 'markdown', model_tier: 'fast' } as AIStep;
    } else if (type === 'verify') {
      step = { id, type: 'verify', label: 'Check before delivery', rules: [] } as VerifyStep;
    } else if (type === 'approval') {
      step = { id, type: 'approval', label: 'Your approval' } as ApprovalStep;
    } else if (type === 'handoff') {
      step = { id, type: 'handoff', label: 'Wait on a person', assignee_user_id: '', ask: '', sla_hours: undefined } as HandoffStep;
    } else if (type === 'workflow') {
      // Born UNPICKED — the label is the child's own name, written on the pick, never guessed.
      step = { id, type: 'workflow', label: '', workflow_id: '' } as ProcessStep;
    } else if (type === 'input') {
      // Born with its verb as the label and NOTHING to ask yet; readiness rule 10 speaks until the
      // author writes the question. `accepts` starts at 'both' — the paste box AND the pin door.
      step = { id, type: 'input', label: 'Ask me for something', ask: '', accepts: 'both' } as InputStepDraft;
    } else if (type === 'case') {
      // THE CASE STATION (W4) — born with its verb as the label and NOTHING to recognize yet;
      // readiness rule 8 speaks until the author says what identifies a case.
      step = { id, type: 'case', label: 'File it under its record', case_instruction: '' } as CaseStepDraft;
    } else {
      step = { id, type: 'agent', label: 'Hand off to a teammate', agent_id: agents[0]?.id ?? '', prompt: '' } as AgentStep;
    }
    setWorkflow(w => {
      const steps = [...w.steps];
      if (insertAt !== undefined) steps.splice(insertAt, 0, step);
      else steps.push(step);
      const external = step.type === 'tool' && EXTERNAL_MATERIAL_TOOLS.has((step as ToolStep).tool);
      return { ...w, steps: external ? autoSeat(steps) : seatGate(steps) };
    });
    setActivePanel({ stepId: id });
  }, [agents, autoSeat]);

  const updateStep = useCallback((stepId: string, partial: Partial<WorkflowStep>) => {
    setWorkflow(w => {
      const steps = w.steps.map(s => s.id === stepId ? ({ ...s, ...partial } as WorkflowStep) : s);
      const target = steps.find(s => s.id === stepId);
      const nextTool = (partial as Partial<ToolStep>).tool;
      // A tool CHANGED INTO external material is the user's own action — seat the gate.
      const external = target?.type === 'tool' && !!nextTool && EXTERNAL_MATERIAL_TOOLS.has(nextTool);
      return { ...w, steps: external ? autoSeat(steps) : seatGate(steps) };
    });
  }, [autoSeat]);

  const removeStep = useCallback((stepId: string) => {
    setWorkflow(w => {
      if (w.steps.find(s => s.id === stepId)?.type === 'verify') gateDismissedRef.current = true;
      return { ...w, steps: seatGate(w.steps.filter(s => s.id !== stepId)) };
    });
  }, []);

  // The gate is a station — it never reorders. Everything else swaps, then the station re-seats.
  const moveStep = useCallback((stepId: string, delta: -1 | 1) => {
    setWorkflow(w => {
      const idx = w.steps.findIndex(s => s.id === stepId);
      if (idx === -1 || w.steps[idx].type === 'verify') return w;
      const steps = [...w.steps];
      const target = idx + delta;
      if (target < 0 || target >= steps.length) return w;
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...w, steps: seatGate(steps) };
    });
  }, []);

  // An external delivery home is external material leaving — the gate seats itself on the switch.
  const patchOutput = useCallback((o: OutputConfig) => {
    setWorkflow(w => {
      const before = normalizeOutput(w.output_config).home;
      const after = normalizeOutput(o).home;
      const wentExternal = after !== before && (after === 'email' || after === 'slack');
      return { ...w, output_config: o, steps: wentExternal ? autoSeat(w.steps) : w.steps };
    });
  }, [autoSeat]);

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
          {workflow.status === 'draft' ? (
            <button onClick={saveAndActivate} disabled={saving}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-medium rounded-md transition-colors disabled:opacity-50">
              Save & turn on
            </button>
          ) : (
            <button onClick={saveAndClose} disabled={saving}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-medium rounded-md transition-colors disabled:opacity-50">
              Save & close
            </button>
          )}
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
            onUpdateStep={updateStep}
            onInputsChange={setInputs}
          />
        </div>

        {/* Right config panel (or test run panel) */}
        <div className="flex-none w-[36%] min-w-[260px] max-w-[420px] border-l border-neutral-100 bg-white overflow-y-auto relative">
          <div className="px-4 py-5 space-y-5">
            {resolvedPanel === 'identity' && (
              <IdentitySection workflow={workflow} patch={patch} agents={agents} />
            )}
            {resolvedPanel === 'trigger' && (
              <WhenSection workflow={workflow} selfId={workflow.id} onPrimary={setPrimary} onDoors={setDoors} onFireLimit={setFireLimit} />
            )}
            {resolvedPanel === 'output' && (
              <div className="space-y-5">
                <SectionHeader title="Output" subtitle="What happens when the workflow finishes?" />
                <OutputEditor output={workflow.output_config} onChange={patchOutput} />
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
                  onMove={step.type === 'verify' ? undefined : d => moveStep(step.id, d)}
                  stepCheckCount={workflow.steps.filter(
                    s => (s.type === 'tool' || s.type === 'ai') && !!(s as ToolStep | AIStep).check?.trim(),
                  ).length}
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

type StepOutput = { step_type: string; label: string; output?: unknown; error?: string; verdict?: GateVerdict };

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
                {out?.verdict && <VerdictChip verdict={out.verdict} />}
                {out && !out.error && (
                  <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                )}
              </button>
              {isExpanded && (out?.verdict || outputText) && (
                <div className="border-t border-neutral-100 pt-2.5">
                  {/* A clean gate still owes a receipt — say what it looked at and found. */}
                  {out?.verdict && out.verdict.status === 'passed'
                    && out.verdict.reported === true && out.verdict.findings.length === 0 && (
                    <div className="px-3.5 pb-2 text-[10.5px] text-neutral-400">
                      Checked against this run&apos;s sources — nothing needed fixing.
                    </div>
                  )}
                  {/* The receipts first — what the gate did — then the draft it produced. */}
                  {out?.verdict && out.verdict.findings.length > 0 && (
                    <div className="px-3.5 pb-2.5 space-y-2">
                      {out.verdict.findings.map((f, fi) => <FindingRow key={fi} finding={f} />)}
                    </div>
                  )}
                  {out?.verdict && out.verdict.reported === false && (
                    <div className="px-3.5 pb-2 text-[10.5px] text-neutral-400">
                      (the check reported only code-computed findings this run)
                    </div>
                  )}
                  {outputText && (
                    <div className="px-3.5 pb-3 text-[11px] text-neutral-600 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {outputText.slice(0, 2000)}{outputText.length > 2000 ? '\n…' : ''}
                    </div>
                  )}
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

// ── The verdict, in outcome tense (guardrails arc) ────────────────────────────
// Same chip shape as the Studio's configuration-tense chip; here it says what the gate DID.
// Test mode never parks, so a blocked verdict reads "would be held" — an honest simulation.
const FINDING_SOURCE_LABEL: Record<string, string> = {
  numbers: 'Built-in · numbers',
  grounding: 'Built-in · sources',
  citation: 'Built-in · citations',
  structure: 'Built-in · structure',
  dates: 'Built-in · dates',
  brief: 'Built-in · brief',
};

function VerdictChip({ verdict }: { verdict: GateVerdict }) {
  const n = verdict.findings.length;
  const { text, cls } =
    verdict.status === 'blocked'
      ? { text: '⏸ Would be held', cls: 'bg-amber-500 text-white' }
      : verdict.status === 'corrected'
        ? { text: `✎ Corrected · ${n}`, cls: 'bg-teal-600 text-white' }
        : { text: '✓ Passed', cls: 'bg-teal-100 text-teal-700' };
  return (
    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cls}`}>
      {text}
    </span>
  );
}

// What the gate DID with this finding — the receipt's verb, said plainly (v1.2 transparency).
const FINDING_ACTION_LABEL: Record<GateFinding['action'], string> = {
  corrected: 'fixed',
  removed: 'removed',
  masked: 'masked',
  blocked: 'blocked',
};

function FindingRow({ finding }: { finding: GateFinding }) {
  const isRule = finding.source === 'rule';
  const actionWord = FINDING_ACTION_LABEL[finding.action];
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${isRule ? 'text-indigo-600' : 'text-teal-700'}`}>
          {isRule
            ? (finding.stepLabel
                ? `Your rule · from "${finding.stepLabel}"`
                : `Your rule${finding.rule ? ` · ${finding.rule}` : ''}`)
            : (FINDING_SOURCE_LABEL[finding.source] ?? 'Built-in')}
        </span>
        {actionWord && (
          <span className={`text-[9.5px] font-semibold uppercase tracking-wide rounded-full px-1.5 ${
            finding.action === 'blocked' ? 'bg-amber-100 text-amber-700' : 'bg-teal-50 text-teal-700'
          }`}>
            {actionWord}
          </span>
        )}
      </div>
      {isRule && finding.stepLabel && finding.rule && (
        <div className="text-[11px] text-neutral-500 leading-snug">{finding.rule}</div>
      )}
      {finding.quote && (
        <div className="font-mono text-[11px] text-neutral-600 leading-snug break-words">{finding.quote}</div>
      )}
      {finding.note && (
        <div className="text-[11px] text-neutral-500 leading-snug">{finding.note}</div>
      )}
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
            { type: 'tool' as const,  Icon: WrenchScrewdriverIcon, label: 'Tool step',          disabled: false },
            { type: 'ai' as const,    Icon: SparklesIcon,          label: 'Write / produce',    disabled: false },
            { type: 'agent' as const, Icon: UserCircleIcon,        label: 'Hand off to a teammate', disabled: agents.length === 0 },
            { type: 'handoff' as const, Icon: UsersIcon,           label: 'Wait on a person',   disabled: false },
            // THE SUBPROCESS STATION (W3) — a whole workflow, standing on this rail as one block.
            { type: 'workflow' as const, Icon: Square2StackIcon,   label: 'Include a process',  disabled: false },
            // THE CASE STATION (W4) — the normalizer verb, in the SAME one list as every other
            // structural step: what arrived gets filed against the thing it belongs to.
            { type: 'case' as const, Icon: ArrowsRightLeftIcon,    label: 'File it under its record',   disabled: false },
            // THE INPUT STATION (THE WAVE) — the run stops and asks YOU for something only you have.
            { type: 'input' as const, Icon: HandRaisedIcon,        label: 'Ask me for something',       disabled: false },
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
  workflow, activePanel, agents, onSelectPanel, onAddStep, onUpdateStep, onInputsChange,
}: {
  workflow: WorkflowDraft;
  activePanel: ActivePanel;
  agents: AgentOption[];
  onSelectPanel: (p: ActivePanel) => void;
  onAddStep: (type: WorkflowStep['type'], insertAt?: number) => void;
  onUpdateStep: (stepId: string, partial: Partial<WorkflowStep>) => void;
  onInputsChange: (next: WorkflowInputs) => void;
}) {
  // THE POSITIONAL BRIEF (v1.2): the gate enforces the prompt of the step FEEDING it — the
  // nearest preceding ai/agent step before the first verify gate. Only THAT step may claim it.
  const feedingStepId = (() => {
    const gateIdx = workflow.steps.findIndex(s => s.type === 'verify');
    if (gateIdx < 0) return null;
    for (let i = gateIdx - 1; i >= 0; i--) {
      const s = workflow.steps[i];
      if (s.type === 'ai' || s.type === 'agent') return s.id;
    }
    return null;
  })();

  // NO LYING DOORS below the seated gate: the + offers every insertable step type (stale note
  // fixed Aug 24 — it long predates handoff/⧉ process/case), and
  // seatGate re-seats every one of them ABOVE the gate — so an add button between the gate and
  // the output would teleport whatever it inserts. Positions past the gate render a plain
  // connector instead. (No gate → every position is honest and keeps its +.)
  const verifyIdx = workflow.steps.findIndex(s => s.type === 'verify');
  const canAddAt = (at: number) => verifyIdx < 0 || at <= verifyIdx;

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

      {/* WHEN — the intake block: every door that can start this run, converging on step one */}
      <WhenFlowBlock
        workflow={workflow}
        active={activePanel === 'trigger'}
        onClick={() => onSelectPanel('trigger')}
      />

      {/* WORKS WITH — the inputs tray hangs off the rail on a dashed connector (law 7): reference
          material the run reads, drawn beside the line rather than as a step on it. */}
      <InputsTray inputs={workflow.inputs} onChange={onInputsChange} />

      {/* Steps with inline add dividers — gates (verify/approval) render as pill stations */}
      {workflow.steps.map((step, idx) => {
        const isActive = typeof activePanel === 'object' && activePanel.stepId === step.id;
        return (
          <div key={step.id} className="flex flex-col items-center w-full">
            {canAddAt(idx)
              ? <InlineDivider insertAt={idx} agents={agents} onAdd={onAddStep} />
              : <FlowConnector />}
            {step.type === 'verify' || step.type === 'approval' || step.type === 'handoff' || step.type === 'input' ? (
              <GateFlowNode
                step={step}
                active={isActive}
                onClick={() => onSelectPanel({ stepId: step.id })}
              />
            ) : step.type === 'workflow' ? (
              <SubprocessFlowBlock
                step={step as ProcessStep}
                active={isActive}
                onClick={() => onSelectPanel({ stepId: step.id })}
              />
            ) : step.type === 'case' ? (
              <CaseFlowBlock
                step={step as CaseStepDraft}
                active={isActive}
                onClick={() => onSelectPanel({ stepId: step.id })}
              />
            ) : (
              <StepFlowCard
                step={step}
                index={idx}
                active={isActive}
                onClick={() => onSelectPanel({ stepId: step.id })}
                onUpdate={p => onUpdateStep(step.id, p)}
                feedsGate={step.id === feedingStepId}
              />
            )}
          </div>
        );
      })}

      {canAddAt(workflow.steps.length)
        ? <InlineDivider insertAt={workflow.steps.length} agents={agents} onAdd={onAddStep} />
        : <FlowConnector />}

      {/* THE DASHED SLOT — the opt-in door for the gate, only while no verify step exists. */}
      {!workflow.steps.some(s => s.type === 'verify') && (
        <AddCheckSlot onAdd={() => onAddStep('verify', workflow.steps.length)} />
      )}

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

// ── THE WHEN BLOCK on the rail ────────────────────────────────────────────────
// Law 6, drawn: every door that can start a run stands side by side and CONVERGES on step one.
// One entry keeps the single-tile look (a lone door needs no fan); two or more earn the fan.
type WhenEntry = { key: string; Icon: typeof BoltIcon; text: string; tone: 'door' | 'clock' | 'manual' };

function clipDoor(s: string, max = 34): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** What a door SAYS on a chip: the authored label, else its filters and/or its judged condition.
 *  An authored label always wins — a label is data, and the user's own words outrank ours. */
function doorChipWord(d: ReactionDoor, sourceLabel?: string): string {
  const authored = d.label?.trim();
  if (authored) return authored;
  const filters = describeFilters(d);
  const when = d.when?.trim();
  if (filters && when) return `${filters} — ${when}`;
  if (filters) return filters;
  if (when) return `${sourceLabel ?? 'On event'} — ${when}`;
  return doorLabel(d);
}

function whenEntries(workflow: WorkflowDraft): WhenEntry[] {
  const { primary, doors } = normalizeTriggers(workflow);
  const entries: WhenEntry[] = doors.map((d, i) => {
    const def = triggerSource(d.source);
    return {
      key: `door-${i}`,
      Icon: sourceIcon(def?.icon),
      // The registry says what a door IS; the chip only adds the user's own condition.
      // W5 — a FILTERS-ONLY door has no condition to speak, so it speaks its filters instead
      // ("Sender domain is acme.test"). The chip already wears the source's icon, so repeating
      // "An email arrives" would spend the chip's whole width saying what the icon says.
      text: clipDoor(doorChipWord(d, def?.label)),
      tone: 'door' as const,
    };
  });
  if (primary.type === 'schedule') {
    const title = (() => {
      try { return triggerShortTitle({ type: 'schedule', cron: primary.cron ?? '0 9 * * *', timezone: primary.timezone }); }
      catch { return 'On a schedule'; }
    })();
    entries.push({ key: 'schedule', Icon: ClockIcon, text: title, tone: 'clock' });
  }
  if (entries.length === 0) entries.push({ key: 'manual', Icon: BoltIcon, text: 'Manual — you run it', tone: 'manual' });
  return entries;
}

function WhenFlowBlock({ workflow, active, onClick }: {
  workflow: WorkflowDraft; active: boolean; onClick: () => void;
}) {
  const entries = whenEntries(workflow);
  const many = entries.length > 1;

  const chipTone = (tone: WhenEntry['tone']) =>
    tone === 'door'   ? { shell: 'border-indigo-200 bg-white',  disc: 'bg-indigo-50 text-indigo-600' }
    : tone === 'clock' ? { shell: 'border-amber-200 bg-white',  disc: 'bg-amber-50 text-amber-600' }
                       : { shell: 'border-neutral-200 bg-white', disc: 'bg-neutral-100 text-neutral-500' };

  if (!many) {
    const only = entries[0];
    const tone = chipTone(only.tone);
    return (
      <div role="button" tabIndex={0}
        onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}
        className={`w-full flex items-center gap-3 px-4 py-3.5 bg-white rounded-xl border-2 cursor-pointer transition-all ${
          active ? 'border-indigo-400 shadow-md' : 'border-neutral-100 hover:border-neutral-200 shadow-sm'
        }`}
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tone.disc}`}>
          <only.Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-0.5">When</div>
          <div className="text-[13px] font-semibold text-neutral-800 truncate">{only.text}</div>
        </div>
        <ChevronRightIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
      </div>
    );
  }

  const n = entries.length;
  const unit = 100;
  const mid = (n * unit) / 2;
  return (
    <div role="button" tabIndex={0}
      onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`w-full rounded-xl border-2 px-3 pt-2.5 pb-1 cursor-pointer transition-all bg-white ${
        active ? 'border-indigo-400 shadow-md' : 'border-neutral-100 hover:border-neutral-200 shadow-sm'
      }`}
    >
      <div className="text-[10px] font-semibold text-indigo-500 uppercase tracking-widest text-center mb-2">When</div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {entries.map(e => {
          const tone = chipTone(e.tone);
          return (
            <span key={e.key}
              className={`inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg border text-[11.5px] font-medium text-neutral-700 ${tone.shell}`}>
              <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${tone.disc}`}>
                <e.Icon className="w-2.5 h-2.5" />
              </span>
              <span className="truncate">{e.text}</span>
            </span>
          );
        })}
      </div>
      {/* the intake fan — many doors, one run */}
      <svg className="w-full h-6 mt-1" viewBox={`0 0 ${n * unit} 24`} preserveAspectRatio="none" fill="none" aria-hidden>
        {entries.map((e, i) => {
          const x = i * unit + unit / 2;
          return <path key={e.key} d={`M ${x} 1 C ${x} 15 ${mid} 8 ${mid} 23`} stroke="#c7d2fe" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
    </div>
  );
}

// ── THE INPUTS TRAY on the rail (THE RELAY CANVAS, W2) ────────────────────────
// Drawn as the mockup's "Works with": a dashed-bordered tray hanging off the line on a dashed
// connector — dashed everywhere on purpose, because nothing in it is a step. Pinned documents
// ride every run as staged material; the toggle says whether a hand-run may carry more.
// An empty tray is ONE GHOST LINE, never a section with nothing in it.
function InputsTray({ inputs, onChange }: {
  inputs: WorkflowInputs | null | undefined;
  onChange: (next: WorkflowInputs) => void;
}) {
  const addRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Not yet read from the server: draw nothing rather than an empty claim.
  if (inputs === undefined) return null;

  const docs = inputs?.docs ?? [];
  const accepts = inputs?.acceptMaterial === true;
  const empty = docs.length === 0 && !accepts;

  const emit = (next: Partial<WorkflowInputs>) =>
    onChange({ docs, acceptMaterial: accepts, ...next });

  const picker = (
    <InputsDocPicker
      anchorRef={addRef}
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      docs={docs}
      accepts={accepts}
      onToggleDoc={(doc) => emit({
        docs: docs.some(d => d.kbFileId === doc.kbFileId)
          ? docs.filter(d => d.kbFileId !== doc.kbFileId)
          : [...docs, doc],
      })}
      onToggleAccepts={(v) => emit({ acceptMaterial: v })}
    />
  );

  if (empty) {
    return (
      <div className="w-full flex justify-end -mt-1">
        <button
          ref={addRef}
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-200 bg-white/60 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-600 hover:border-neutral-300 transition-colors"
        >
          <PlusIcon className="w-3 h-3" />
          Works with — pin a document
        </button>
        {picker}
      </div>
    );
  }

  return (
    <div className="w-full flex justify-end items-start">
      {/* the dashed connector back to the line */}
      <svg width="40" height="28" viewBox="0 0 40 28" fill="none" className="mt-3 flex-shrink-0" aria-hidden>
        <path d="M0 3 C22 3 14 22 40 22" stroke="#e5e5e5" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
      <div className="mt-2 w-[196px] rounded-xl border border-dashed border-neutral-200 bg-white/70 px-2.5 py-2">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400 mb-1.5">Works with</div>

        {docs.map(d => (
          <div key={d.kbFileId} className="group flex items-center gap-1.5 mb-1 rounded-lg border border-dashed border-neutral-200 bg-white px-2 py-1">
            <DocumentTextIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
            <span className="flex-1 truncate text-[11.5px] text-neutral-600" title={d.name}>{d.name}</span>
            <button
              type="button"
              title="Unpin"
              onClick={() => emit({ docs: docs.filter(x => x.kbFileId !== d.kbFileId) })}
              className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-neutral-600 transition-opacity"
            >
              <XMarkIcon className="w-3 h-3" />
            </button>
          </div>
        ))}

        <button
          ref={addRef}
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          <PlusIcon className="w-3 h-3" />
          Pin a document
        </button>

        {/* The toggle's state is a CLAIM about how this workflow can be run — so it is spoken on
            the rail even though the control that sets it lives in the tray's editor. */}
        {accepts && (
          <div className="mt-1.5 pt-1.5 border-t border-dashed border-neutral-200 text-[10.5px] text-neutral-400 leading-snug">
            Accepts material at run time
          </div>
        )}
      </div>
      {picker}
    </div>
  );
}

// The tray's editor. THE PICKER REUSES THE ONE KNOWLEDGE SOURCE the chat composer's @-mention
// already reads (/api/workers/mentions?types=document → knowledge_files) — no second KB door.
function InputsDocPicker({ anchorRef, open, onClose, docs, accepts, onToggleDoc, onToggleAccepts }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  docs: WorkflowInputDoc[];
  accepts: boolean;
  onToggleDoc: (doc: WorkflowInputDoc) => void;
  onToggleAccepts: (v: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<WorkflowInputDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/workers/mentions?types=document&q=${encodeURIComponent(q.trim())}`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          if (dead) return;
          const rows = (j?.results ?? []) as Array<{ id: string; label: string }>;
          setResults(rows.map(r => ({ kbFileId: r.id, name: r.label })));
        })
        .catch(() => { if (!dead) setResults([]); })
        .finally(() => { if (!dead) setLoading(false); });
    }, q ? 200 : 0);
    return () => { dead = true; clearTimeout(t); };
  }, [open, q]);

  return (
    <AnchoredPopover anchorRef={anchorRef} open={open} onClose={onClose} align="right" width={264}>
      {/* THE OVERLAY LAW: AnchoredPopover is a positioned SHELL — the consumer paints the panel.
          A bare div renders transparent over the rail (found live, Aug 24). */}
      <div className="p-2 bg-white border border-neutral-200 rounded-xl shadow-xl">
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search your knowledge…"
          className="w-full text-[12px] rounded-lg border border-neutral-200 focus:border-indigo-300 focus:outline-none px-2 py-1.5"
        />
        <div className="mt-1.5 max-h-56 overflow-y-auto">
          {loading && <div className="px-2 py-2 text-[11px] text-neutral-400">Looking…</div>}
          {!loading && results.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-neutral-400">
              {q ? 'Nothing in Knowledge matches that.' : 'Nothing in Knowledge yet — upload a file there first.'}
            </div>
          )}
          {!loading && results.map(r => {
            const pinned = docs.some(d => d.kbFileId === r.kbFileId);
            return (
              <button
                key={r.kbFileId}
                type="button"
                onClick={() => onToggleDoc(r)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-neutral-50 text-left"
              >
                <DocumentTextIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                <span className="flex-1 truncate text-[12px] text-neutral-700" title={r.name}>{r.name}</span>
                {pinned && <CheckIcon className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
        <label className="mt-1.5 pt-2 px-1 flex items-start gap-2 border-t border-neutral-100 cursor-pointer">
          <input
            type="checkbox"
            checked={accepts}
            onChange={e => onToggleAccepts(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-neutral-300 text-indigo-600 focus:ring-0"
          />
          <span className="text-[11px] text-neutral-600 leading-snug">
            Accepts material at run time
            <span className="block text-[10.5px] text-neutral-400">Run now can carry a file or pasted text</span>
          </span>
        </label>
      </div>
    </AnchoredPopover>
  );
}

// ── The gate station (guardrails arc, docs/guardrails-plan.md) ────────────────
// verify/approval are not steps that DO work — they are stations the work passes through. One
// shape, two families: teal for the check, amber for the human hold. Narrower than a step card
// so the connector reads as a line the run travels down.
function GateFlowNode({ step, active, onClick }: {
  step: WorkflowStep; active: boolean; onClick: () => void;
}) {
  const isVerify = step.type === 'verify';
  // THE PERSON STATION (handoff arc): a third family — violet, wearing the assignee's name. An
  // unassigned handoff says so plainly (amber warning tint) rather than looking finished.
  const isHandoff = step.type === 'handoff';
  const handoff = isHandoff ? (step as HandoffStep) : null;
  const unassigned = isHandoff && !handoff?.assignee_user_id;
  // THE INPUT STATION (relay canvas, THE WAVE): a FOURTH family on the same pill — the run stops
  // here and asks the person. Indigo (it is the user's own turn, not a hold and not a check); an
  // unasked station wears the amber hint idiom, the sentence readiness rule 10 will speak.
  const isInput = step.type === 'input';
  const inputAsk = isInput ? String((step as { ask?: string }).ask ?? '').trim() : '';
  const rules = isVerify ? ((step as VerifyStep).rules ?? []) : [];
  const instruction = (step as { instruction?: string }).instruction?.trim();

  const title = isVerify
    ? 'Checked before delivery'
    : isHandoff
      ? (step.label?.trim() || 'Wait on a person')
      : isInput
        ? (step.label?.trim() || 'Ask me for something')
        : 'Your approval';
  const handoffSub = handoff?.assignee_name
    ? `waits on ${handoff.assignee_name}${handoff.sla_hours ? ` · ${handoff.sla_hours}h SLA` : ''}`
    : 'no person chosen yet';
  const sub = isInput
    ? (inputAsk ? (inputAsk.length > 46 ? inputAsk.slice(0, 46) + '…' : inputAsk) : 'what should it ask you for?')
    : isHandoff
    ? handoffSub
    : instruction
      ? (instruction.length > 46 ? instruction.slice(0, 46) + '…' : instruction)
      : isVerify
        ? 'checks & fixes the draft against this run’s sources'
        : 'pauses here — nothing goes out until you OK it';

  const shell = isInput
    ? (inputAsk
        ? `bg-indigo-50 text-indigo-800 ${active ? 'border-indigo-400 shadow-md' : 'border-indigo-200 hover:border-indigo-300'}`
        : `bg-amber-50 text-amber-800 ${active ? 'border-amber-400 shadow-md' : 'border-amber-300 hover:border-amber-400'}`)
    : isVerify
    ? `bg-teal-50 text-teal-800 ${active ? 'border-teal-400 shadow-md' : 'border-teal-200 hover:border-teal-300'}`
    : isHandoff
      ? (unassigned
          ? `bg-amber-50 text-amber-800 ${active ? 'border-amber-400 shadow-md' : 'border-amber-300 hover:border-amber-400'}`
          : `bg-violet-50 text-violet-800 ${active ? 'border-violet-400 shadow-md' : 'border-violet-200 hover:border-violet-300'}`)
      : `bg-amber-50 text-amber-800 ${active ? 'border-amber-400 shadow-md' : 'border-amber-200 hover:border-amber-300'}`;
  const disc = isInput ? (inputAsk ? 'bg-indigo-500' : 'bg-amber-500')
    : isVerify ? 'bg-teal-600' : isHandoff ? (unassigned ? 'bg-amber-500' : 'bg-violet-500') : 'bg-amber-500';
  const Icon = isVerify ? ShieldCheckIcon : isHandoff ? UsersIcon
    : isInput ? ChatBubbleLeftRightIcon : HandRaisedIcon;

  return (
    <div className="w-full flex justify-center">
      <div role="button" tabIndex={0}
        onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}
        className={`w-[88%] flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-full border-2 cursor-pointer transition-all ${shell}`}
      >
        <div className={`w-7 h-7 rounded-full ${disc} flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold truncate leading-tight">{title}</div>
          <div className="text-[11px] opacity-70 truncate leading-tight">{sub}</div>
        </div>
        {isVerify && (
          rules.length > 0 ? (
            <span className="flex-shrink-0 text-[11px] font-medium bg-teal-100 text-teal-700 rounded-full px-2 py-0.5">
              + {rules.length} of your rule{rules.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="flex-shrink-0 text-[11px] text-teal-600/60">no rules yet</span>
          )
        )}
      </div>
    </div>
  );
}

// ── THE SUBPROCESS STATION on the rail (relay canvas W3, laws 4+5) ────────────
// A COMPOUND BLOCK, not a step card and not a pill: violet, double-bordered (the outline is the
// second rail — this block has a rail of its own), the CHILD'S OWN NAME as the title, and one
// meta line saying what it is. It carries its own receipt like every other block (law 4): an
// unpicked process says so in the amber hint idiom rather than standing as a finished claim.
function SubprocessFlowBlock({ step, active, onClick }: {
  step: ProcessStep; active: boolean; onClick: () => void;
}) {
  const picked = !!step.workflow_id;
  const title = picked ? (step.label?.trim() || 'A process') : 'Include a process';
  const meta = picked
    ? 'its own workflow — runs inside this one'
    : 'no process chosen yet';

  const shell = picked
    ? `bg-violet-50 border-violet-200 ${active ? 'outline-violet-400 shadow-md' : 'outline-violet-200'}`
    : `bg-amber-50 border-amber-300 ${active ? 'outline-amber-400 shadow-md' : 'outline-amber-300'}`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border cursor-pointer transition-all outline outline-1 outline-offset-[3px] ${shell}`}
    >
      <div className={`w-8 h-8 rounded-lg bg-white border flex items-center justify-center flex-shrink-0 ${picked ? 'border-violet-200' : 'border-amber-200'}`}>
        <Square2StackIcon className={`w-4 h-4 ${picked ? 'text-violet-600' : 'text-amber-600'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-semibold truncate leading-tight ${picked ? 'text-violet-700' : 'text-amber-800'}`}>{title}</div>
        <div className={`text-[11.5px] truncate leading-tight mt-0.5 ${picked ? 'text-neutral-500' : 'text-amber-700/80'}`}>{meta}</div>
      </div>
      <ChevronRightIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${picked ? 'text-violet-300' : 'text-amber-400'}`} />
    </div>
  );
}

// ── THE CASE BLOCK on the rail (relay canvas W4) ──────────────────────────────────────────────
// The normalizer's grammar, drawn: the tool family's shell (it FILES what arrived, it does not
// produce), the step's own label as the title, and a small `case` chip that says what kind of
// station this is at a glance. A blank instruction wears the amber hint idiom — the same
// sentence readiness rule 8 will speak — rather than standing as a finished claim.
function CaseFlowBlock({ step, active, onClick }: {
  step: CaseStepDraft; active: boolean; onClick: () => void;
}) {
  // Either shape is a key (Aug 25) — the STATED case leads when there is one, since it is what
  // every run of this workflow will actually file under.
  const key = step.case_name?.trim() || step.case_instruction?.trim() || '';
  const meta = key
    ? (key.length > 46 ? `${key.slice(0, 46)}…` : key)
    : 'what identifies a case? e.g. “the job opening named in the application”';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`w-full flex items-center gap-3 px-4 py-3.5 bg-white rounded-xl border-2 cursor-pointer transition-all ${
        active ? 'border-indigo-400 shadow-md'
        : key ? 'border-neutral-100 hover:border-neutral-200 shadow-sm'
        : 'border-amber-200 hover:border-amber-300 shadow-sm'
      }`}
    >
      <div className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
        <ArrowsRightLeftIcon className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-neutral-800 truncate leading-tight">
            {step.label?.trim() || 'File it under its record'}
          </span>
          <span className="flex-shrink-0 text-[10px] rounded-full px-1.5 py-[1px] bg-indigo-50 text-indigo-600">case</span>
        </div>
        <div className={`text-[11.5px] truncate leading-tight mt-0.5 ${key ? 'text-neutral-400' : 'text-amber-700/90'}`}>
          {meta}
        </div>
      </div>
      <ChevronRightIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
    </div>
  );
}

// The opt-in slot — an ADDITIONAL affordance beside the normal dividers, shown only while the
// workflow has no gate. Clicking inserts the verify step and opens its panel.
function AddCheckSlot({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="w-full flex flex-col items-center">
      <button type="button" onClick={onAdd}
        className="w-[88%] flex items-center justify-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-neutral-300 text-neutral-500 text-[11.5px] hover:border-teal-300 hover:text-teal-700 hover:bg-teal-50/40 transition-colors">
        <ShieldCheckIcon className="w-3.5 h-3.5" />
        Add a check before delivery
      </button>
      <div className="w-px h-4 bg-neutral-200" />
    </div>
  );
}

// The edge chip — THE SHIELD NODE (guardrails v1.1 → v1.2 symmetry). Not visibility-only any
// more: it is the door to the step's OWN ask. BOTH tool and ai steps author a `check` here
// (identical contract, enforced by the ONE delivery gate, attributed back to this step).
// The "your instruction is the brief" claim is POSITIONAL — only the ai step FEEDING the gate
// gets it (feedsGate), because that is the only prompt the gate actually enforces.
function BuiltinChecksChip({ step, onUpdate, feedsGate = false }: {
  step: WorkflowStep;
  onUpdate?: (p: Partial<WorkflowStep>) => void;
  feedsGate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const checks = builtinChecksFor(step);
  const isTool = step.type === 'tool';
  const isAi = step.type === 'ai';
  if (!isTool && !isAi) return null;

  const check = (step as ToolStep | AIStep).check?.trim();
  const aiPrompt = isAi ? (step as AIStep).prompt?.trim() : undefined;
  const canAuthor = !!onUpdate;

  const commit = () => {
    const clean = draft.trim().slice(0, 200);
    if (!clean || !onUpdate) return;
    onUpdate({ check: clean } as Partial<WorkflowStep>);
    setDraft('');
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        title={check ? 'Your check on this step' : 'Checks on this step'}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={`absolute top-1/2 -translate-y-1/2 -right-3 w-[25px] h-[25px] rounded-full border flex items-center justify-center shadow-sm transition-colors ${
          check
            ? 'bg-teal-50 border-teal-300'
            : `bg-white ${open ? 'border-teal-300' : 'border-teal-100 hover:border-teal-300'}`
        }`}
      >
        <ShieldCheckIcon className="w-3.5 h-3.5 text-teal-600" />
      </button>
      <AnchoredPopover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={272}>
        <div
          onClick={e => e.stopPropagation()}
          className="bg-white border border-neutral-200 rounded-xl shadow-xl overflow-hidden"
        >
          {checks && (
            <>
              <div className="px-3 pt-3 pb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-700">{checks.title}</span>
              </div>
              <div className="px-3 pb-2.5 space-y-1.5">
                {checks.lines.map((line, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <CheckIcon className="w-3 h-3 text-teal-500 flex-shrink-0 mt-[3px]" />
                    <span className="text-[11.5px] text-neutral-600 leading-snug">{line}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* THE STEP'S OWN ASK — authored here, enforced at the one delivery gate. */}
          {canAuthor && (
            <div className={checks ? 'border-t border-neutral-100 px-3 py-2.5' : 'px-3 pt-3 pb-2.5'}>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">
                Also check on this step
              </span>
              {check ? (
                <div className="flex items-start gap-2 bg-teal-50/60 border border-teal-100 rounded-lg px-2.5 py-1.5">
                  <span className="flex-1 min-w-0 text-[11.5px] text-neutral-700 leading-snug break-words">{check}</span>
                  <button type="button" title="Remove this check"
                    onClick={() => onUpdate?.({ check: undefined } as Partial<WorkflowStep>)}
                    className="flex-shrink-0 p-0.5 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={draft}
                    maxLength={200}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
                    placeholder={'e.g. only use this week’s items'}
                    className="flex-1 min-w-0 px-2.5 py-1.5 border border-neutral-200 rounded-lg text-[12px] bg-white outline-none focus:border-indigo-300"
                  />
                  <button type="button" disabled={!draft.trim()} onClick={commit}
                    className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-30 transition-colors">
                    Add
                  </button>
                </div>
              )}
            </div>
          )}

          {/* THE POSITIONAL CLAIM — only the ai step feeding a gate has its prompt enforced. */}
          {isAi && feedsGate && aiPrompt && (
            <div className="border-t border-neutral-100 px-3 py-2.5">
              <span className="text-[11px] text-neutral-500 leading-snug">
                Its instruction is the brief — enforced by the delivery check:
                {' '}&ldquo;{aiPrompt.slice(0, 90)}{aiPrompt.length > 90 ? '…' : ''}&rdquo;
              </span>
            </div>
          )}

          <div className="px-3 py-2 border-t border-neutral-100">
            <span className="text-[10px] text-neutral-400">
              {canAuthor
                ? 'Built-ins always on · your check is enforced at the delivery gate'
                : 'Always on · part of the engine'}
            </span>
          </div>
        </div>
      </AnchoredPopover>
    </>
  );
}

function StepFlowCard({ step, index: _index, active, onClick, onUpdate, feedsGate = false }: {
  step: WorkflowStep; index: number; active: boolean;
  onClick: () => void;
  onUpdate?: (p: Partial<WorkflowStep>) => void;
  feedsGate?: boolean;
}) {
  const colors = STEP_TYPE_COLORS[step.type as keyof typeof STEP_TYPE_COLORS] ?? STEP_TYPE_COLORS.tool;
  const TypeIcon = STEP_TYPE_ICONS[step.type as keyof typeof STEP_TYPE_ICONS] ?? STEP_TYPE_ICONS.tool;
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
    if (step.type === 'verify') {
      const ins = (step as { instruction?: string }).instruction?.trim();
      return `Built-in check · corrects the draft against the sources${ins ? ` · ${ins.slice(0, 30)}…` : ''}`;
    }
    if (step.type === 'approval') {
      const ins = (step as { instruction?: string }).instruction?.trim();
      return `Pauses for your approval${ins ? ` · ${ins.slice(0, 34)}` : ' before continuing'}`;
    }
    if (step.type === 'handoff') {
      const h = step as HandoffStep;
      return h.assignee_name ? `Waits on ${h.assignee_name}` : 'Waits on a person — none chosen yet';
    }
    const p = (step as AgentStep).prompt?.trim();
    const snippet = p ? (p.length > 42 ? p.slice(0, 42) + '…' : p) : 'No task yet';
    return `Agent · ${snippet}`;
  })();

  return (
    <div role="button" tabIndex={0}
      onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`relative w-full flex items-center gap-3 px-4 py-3.5 bg-white rounded-xl border-2 cursor-pointer transition-all ${
        active ? 'border-indigo-400 shadow-md' : 'border-neutral-100 hover:border-neutral-200 shadow-sm'
      }`}
    >
      <BuiltinChecksChip step={step} onUpdate={onUpdate} feedsGate={feedsGate} />
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
  const norm = normalizeOutput(output);
  const homeTitle: Record<string, string> = {
    message: 'Message in thread',
    document: 'Create document',
    slack: `Post to ${norm.slackChannel ?? 'Slack'}`,
    email: 'Email it',
  };
  const reportLabel: Record<string, string> = {
    each_run: 'reports each run',
    digest: 'digest',
    silent: 'silent',
  };
  const title = output.title_template || homeTitle[norm.home] || 'Output';
  const subtitle = `${homeTitle[norm.home] ?? norm.home}${norm.home === 'document' && norm.linkOut.slack ? ` + link in ${norm.slackChannel ?? 'Slack'}` : ''} · ${reportLabel[norm.reportMode]}`;
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

function IdentitySection({ workflow, patch, agents }: {
  workflow: Workflow;
  patch: <K extends keyof Workflow>(k: K, v: Workflow[K]) => void;
  agents: AgentOption[];
}) {
  const colorBg = WORKFLOW_COLORS.find(c => c.key === workflow.color)?.bg ?? 'bg-indigo-500';
  const PreviewIcon = WORKFLOW_ICONS.find(i => i.key === workflow.icon)?.Icon ?? BoltIcon;

  const [skills, setSkills] = useState<Array<{ id: string; name: string; when_to_use: string | null }>>([]);
  useEffect(() => {
    fetch('/api/skills')
      .then(r => r.json())
      .then(({ skills: lib }) => setSkills((lib ?? []).map((s: { id: string; name: string; when_to_use: string | null }) => ({ id: s.id, name: s.name, when_to_use: s.when_to_use }))))
      .catch(() => {});
  }, []);
  const selectedSkillIds = new Set(workflow.skill_ids ?? []);
  const toggleSkill = (id: string) => {
    const next = new Set(selectedSkillIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    patch('skill_ids', [...next]);
  };

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
        {/* THE OWNER (B2) — the accountability layer. Distinct from the EXECUTION identity, which
            stays the creator's forever; this row moves who CARRIES the workflow, nothing else.
            Only on a persisted workflow (there is no id to PUT against before the first save). */}
        {workflow.is_owned_by_me !== false && workflow.id && (
          <Field label="Owner" hint="who carries this workflow">
            <WorkflowOwnerRow workflowId={workflow.id} />
          </Field>
        )}
        {/* THE BASELINE — authored, never guessed. One number, the Metrics tab's only honest
            source of "time saved". */}
        <Field label="Manual time (minutes)" hint="powers the Metrics tab">
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={String(
              (workflow.output_config as unknown as { estimated_manual_minutes?: number } | null)
                ?.estimated_manual_minutes ?? '',
            )}
            onChange={e => {
              const raw = e.target.value.trim();
              const n = Math.round(Number(raw));
              const next = { ...(workflow.output_config ?? {}) } as Record<string, unknown>;
              if (!raw || !Number.isFinite(n) || n <= 0) delete next.estimated_manual_minutes;
              else next.estimated_manual_minutes = n;
              patch('output_config', next as unknown as Workflow['output_config']);
            }}
            placeholder="e.g. 45"
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
          />
          <p className="text-[11px] text-neutral-400 mt-1">How long this takes you by hand. Left empty, the Metrics tab shows no time saved — never a guessed one.</p>
        </Field>
        {workflow.is_owned_by_me !== false && (
          <Field label="Team sharing">
            <SharingModeSelector
              value={(workflow.sharing_mode as SharingMode | null | undefined) ?? null}
              onChange={mode => patch('sharing_mode', mode)}
            />
          </Field>
        )}
        {(() => {
          const workers = agents.filter(a => a.is_worker);
          if (workers.length === 0) return null;
          return (
            <Field label="Assigned worker">
              <select
                value={workflow.agent_id ?? ''}
                onChange={e => patch('agent_id', e.target.value || null)}
                className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 bg-white"
              >
                <option value="">None — run as generic workflow</option>
                {workers.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {workflow.agent_id && (
                <p className="text-[11px] text-indigo-500 mt-1">
                  The final AI step will run in {workers.find(w => w.id === workflow.agent_id)?.name ?? 'this worker'}&apos;s voice, using their instructions, memory, and knowledge base.
                </p>
              )}
            </Field>
          );
        })()}
        {workflow.agent_id && (
          <Field label="Task instructions">
            <textarea
              value={workflow.worker_instructions ?? ''}
              onChange={e => patch('worker_instructions', e.target.value || null)}
              placeholder="Optional — task-specific tone, persona, or style that overrides the worker's default. E.g. 'Write in the style of a German financial journalist. Be terse and data-driven.'"
              rows={3}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 resize-none leading-relaxed"
            />
            <p className="text-[11px] text-neutral-400 mt-1">Only applies to this task — does not change the worker&apos;s core identity.</p>
          </Field>
        )}
        {workflow.agent_id && skills.length > 0 && (
          <Field label="Skills to apply">
            <div className="flex flex-wrap gap-1.5">
              {skills.map(s => {
                const on = selectedSkillIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSkill(s.id)}
                    title={s.when_to_use ?? undefined}
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-medium transition-colors ${
                      on ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">Enforced on this task&apos;s output. Leave empty to use the worker&apos;s assigned skills.</p>
          </Field>
        )}
      </div>
    </div>
  );
}

function StepConfigSection({
  step, index, total, agents, isEnhancing, isPending, onUpdate, onEnhance, onRemove, onMove,
  stepCheckCount = 0, currentWorkflowId,
}: {
  step: WorkflowStep; index: number; total: number; agents: AgentOption[];
  isEnhancing?: boolean; isPending?: boolean;
  onUpdate: (p: Partial<WorkflowStep>) => void;
  onEnhance?: EnhanceFn;
  onRemove?: () => void;
  onMove?: (d: -1 | 1) => void;
  stepCheckCount?: number;
  currentWorkflowId?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const colors = STEP_TYPE_COLORS[step.type as keyof typeof STEP_TYPE_COLORS] ?? STEP_TYPE_COLORS.tool;
  const TypeIcon = STEP_TYPE_ICONS[step.type as keyof typeof STEP_TYPE_ICONS] ?? STEP_TYPE_ICONS.tool;
  const typeLabel = ({ tool: 'Tool', ai: 'Produce', agent: 'Hand off', verify: 'Check', approval: 'Approval', handoff: 'Wait on a person', workflow: 'Process', case: 'Case' } as Record<string, string>)[step.type] ?? step.type;

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
      {step.type === 'verify' && (
        <VerifyStepFields step={step as VerifyStep} onUpdate={onUpdate as (p: Partial<VerifyStep>) => void}
          stepCheckCount={stepCheckCount} />
      )}
      {step.type === 'approval' && (
        <div className="p-4 space-y-3">
          <p className="text-[12.5px] text-neutral-500 leading-relaxed">
            The run pauses here and waits for your go-ahead — you approve or hold it back from the Workflows page. Nothing is delivered until you approve.
          </p>
          <Field label="Extra rules (optional)" hint={'what you\u2019re deciding'}>
            <textarea
              value={(step as { instruction?: string }).instruction ?? ''}
              onChange={e => (onUpdate as (p: Record<string, unknown>) => void)({ instruction: e.target.value })}
              rows={2}
              className="w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white resize-none"
            />
          </Field>
        </div>
      )}
      {step.type === 'handoff' && (
        <HandoffStepFields step={step as HandoffStep} onUpdate={onUpdate as (p: Partial<HandoffStep>) => void} />
      )}
      {step.type === 'workflow' && (
        <SubprocessStepFields
          step={step as ProcessStep}
          onUpdate={onUpdate as (p: Partial<ProcessStep>) => void}
          currentWorkflowId={currentWorkflowId ?? ''}
        />
      )}
      {step.type === 'case' && (
        <CaseStepFields step={step as CaseStepDraft} onUpdate={onUpdate as (p: Partial<CaseStepDraft>) => void} />
      )}
      {step.type === 'input' && (
        <InputStepFields step={step as InputStepDraft} onUpdate={onUpdate as (p: Partial<InputStepDraft>) => void} />
      )}
    </div>
  );
}

// ── THE INPUT STATION'S PANEL (relay canvas, THE WAVE) ────────────────────────────────────────
// TWO things to say: the QUESTION the run will ask, and what the person may hand over. The
// boundary law is stated here, where it is authored — a station that asks for something the
// machine could fetch is a chore, not a gate.
function InputStepFields({ step, onUpdate }: {
  step: InputStepDraft;
  onUpdate: (p: Partial<InputStepDraft>) => void;
}) {
  const accepts = step.accepts ?? 'both';
  return (
    <div className="p-4 space-y-3">
      <p className="text-[12.5px] text-neutral-500 leading-relaxed">
        The run stops here and asks you for this, on your deck. What you send becomes the run&apos;s
        material and everything after it works from it. Use this only for what you alone have at
        run time — things that arrive on their own belong in a trigger, and standing references
        (a policy, a template) belong in <span className="text-neutral-600">Works with</span>.
      </p>
      <Field label="What it asks you for" hint="in your own words">
        <textarea
          value={step.ask ?? ''}
          onChange={e => onUpdate({ ask: e.target.value })}
          rows={2}
          placeholder="this week&#39;s numbers from the finance system"
          className="w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white resize-none placeholder-neutral-300"
        />
      </Field>
      <Field label="What you can send" hint="both, unless you know">
        <div className="flex gap-1 p-0.5 bg-neutral-100 rounded-lg">
          {([
            { key: 'both', label: 'Paste or a document' },
            { key: 'text', label: 'Paste only' },
            { key: 'doc', label: 'A document only' },
          ] as const).map(o => (
            <button
              key={o.key}
              type="button"
              onClick={() => onUpdate({ accepts: o.key })}
              className={`flex-1 text-[12px] px-2 py-1.5 rounded-md transition-colors ${
                accepts === o.key ? 'bg-white text-neutral-800 shadow-sm font-medium' : 'text-neutral-500 hover:text-neutral-700'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

// ── THE CASE STATION'S PANEL (relay canvas W4) ────────────────────────────────────────────────
// ONE thing to say: what identifies a case, in the author's own words. The station matches first
// against the cases this workflow already opened and only founds a new one when nothing matches —
// so the sentence here is a RECOGNITION key, not a naming template. The label lives in the header
// input above (every station's idiom); the blank-instruction hint is readiness rule 8's own
// sentence, said here first, where it can be fixed.
function CaseStepFields({ step, onUpdate }: {
  step: CaseStepDraft;
  onUpdate: (p: Partial<CaseStepDraft>) => void;
}) {
  // THE TWO SHAPES, SAID OUT LOUD (Aug 25). Deliberately NOT auto-detected from one field: "the
  // Customer Service Representative opening" and "the job opening named in the application" are
  // both plain English, and guessing which one the author meant would put words in their mouth —
  // the difference decides whether every run files under ONE case or under the case each event
  // names. Two options, one field, and only the chosen key is ever stored.
  const stated = !!step.case_name?.trim();
  const blank = !step.case_instruction?.trim() && !stated;
  const pick = (toStated: boolean) => onUpdate(toStated
    ? { case_name: step.case_name ?? '', case_instruction: '' }
    : { case_name: '', case_instruction: step.case_instruction ?? '' });
  return (
    <div className="p-4 space-y-3">
      <p className="text-[12.5px] text-neutral-500 leading-relaxed">
        Each run carries one thing. This step files it against the case it belongs to — matching a
        case you already have, or opening a new one when it names a case nobody opened yet. From
        here on, the run sees everything that case has accumulated.
      </p>
      <div className="flex gap-1 p-0.5 bg-neutral-100 rounded-lg">
        {[
          { key: false, label: "It's named in each event" },
          { key: true, label: 'Always the same case' },
        ].map(o => (
          <button
            key={String(o.key)}
            type="button"
            onClick={() => pick(o.key)}
            className={`flex-1 text-[12px] px-2 py-1.5 rounded-md transition-colors ${
              stated === o.key ? 'bg-white text-neutral-800 shadow-sm font-medium' : 'text-neutral-500 hover:text-neutral-700'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
      {stated ? (
        <Field label="The case everything files under" hint="its name, in your own words">
          <textarea
            value={step.case_name ?? ''}
            onChange={e => onUpdate({ case_name: e.target.value })}
            rows={2}
            placeholder="the Customer Service Representative opening"
            className="w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white resize-none placeholder-neutral-300"
          />
        </Field>
      ) : (
        <Field label="What identifies a case" hint="in your own words">
          <textarea
            value={step.case_instruction ?? ''}
            onChange={e => onUpdate({ case_instruction: e.target.value })}
            rows={3}
            placeholder="the job opening named in the application"
            className="w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white resize-none placeholder-neutral-300"
          />
        </Field>
      )}
      {blank && (
        <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          The &lsquo;file it under its record&rsquo; step needs to know what identifies a case.
        </p>
      )}
    </div>
  );
}

// ── THE SUBPROCESS STATION'S PANEL (relay canvas W3, law 5) ───────────────────────────────────
// One decision and no more: WHICH process runs here. The label is the child's own name, written
// on the pick (never typed twice, never guessed) — so the block on the rail always says what the
// run will actually do.
//
// THE EXCLUSIONS ARE HONEST, NOT HIDDEN (law 5's floors, authored-side): a workflow that cannot
// be a child still appears — greyed, with the reason on the row — because a missing name reads as
// a bug, while a named refusal teaches the rule:
//   · ITSELF — a process cannot contain itself (the circular reference, refused at the door).
//   · A DRAFT — an unpublished workflow has nothing to deliver back.
//   · ONE LEVEL DEEP — a workflow that already contains a process cannot be nested under another
//     (the depth cap; the engine's readiness refuses it too — this is the same law, said earlier).
function SubprocessStepFields({ step, onUpdate, currentWorkflowId }: {
  step: ProcessStep;
  onUpdate: (p: Partial<ProcessStep>) => void;
  currentWorkflowId: string;
}) {
  const options = useWorkflowOptions();
  const rows = options.map(o => ({
    ...o,
    refusal:
      o.id === currentWorkflowId ? 'this one — a process cannot contain itself'
      : o.status === 'draft' ? '(still a draft — nothing to deliver back yet)'
      : o.containsProcess ? '(contains a process — one level deep)'
      : null,
  }));
  const chosen = rows.find(r => r.id === step.workflow_id) ?? null;

  return (
    <div className="p-4 space-y-3">
      <p className="text-[12.5px] text-neutral-500 leading-relaxed">
        This step hands the baton to another workflow. It runs its own rail — its own steps, its own
        check, its own people — and when it delivers, this one picks up where it stopped.
      </p>

      <Field label="Which process" hint="its name becomes this step's name">
        <div className="space-y-1">
          {rows.length === 0 && (
            <div className="text-[12px] text-neutral-400 px-1 py-1.5">No other workflows yet.</div>
          )}
          {rows.map(r => {
            const disabled = !!r.refusal;
            const picked = r.id === step.workflow_id;
            return (
              <button
                key={r.id}
                type="button"
                disabled={disabled}
                onClick={() => onUpdate({ workflow_id: r.id, label: r.name })}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                  picked ? 'bg-violet-50 border-violet-200'
                  : disabled ? 'bg-neutral-50 border-neutral-100 cursor-not-allowed'
                  : 'bg-white border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <Square2StackIcon className={`w-4 h-4 flex-shrink-0 ${picked ? 'text-violet-600' : 'text-neutral-300'}`} />
                <span className={`text-[12.5px] truncate ${disabled ? 'text-neutral-400' : picked ? 'text-violet-800 font-medium' : 'text-neutral-700'}`}>
                  {r.name}
                </span>
                {r.refusal && <span className="ml-auto flex-shrink-0 text-[11px] text-neutral-400">{r.refusal}</span>}
                {picked && <CheckIcon className="ml-auto w-3.5 h-3.5 text-violet-600 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </Field>

      {!step.workflow_id && (
        <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No process chosen yet — this step has nothing to run.
        </p>
      )}
      {chosen && (
        <Link
          href={`/workflows/${chosen.id}`}
          className="inline-block text-[12px] text-neutral-500 hover:text-violet-700 transition-colors"
        >
          Open {chosen.name} →
        </Link>
      )}
    </div>
  );
}

// ── THE PERSON STATION'S PANEL (handoff arc, docs/processes-plan.md Phase B) ──────────────────
// Three things and no more: WHO holds it, WHAT they're deciding, and HOW LONG before the coworker
// chases. The roster is the workspace's own members (/api/meetings/teammates — the same source the
// share picker reads); the display name is SNAPSHOTTED on pick so a later rename can't leave the
// step unreadable, while `assignee_user_id` stays the truth the engine authorizes against.
const SLA_CHOICES: Array<{ value: string; label: string }> = [
  { value: '', label: 'No SLA — wait as long as it takes' },
  { value: '4', label: '4 hours' },
  { value: '8', label: '8 hours' },
  { value: '24', label: '24 hours' },
  { value: '48', label: '48 hours' },
  { value: '72', label: '72 hours' },
];

type Teammate = { userId: string; name: string; email: string };

// ── THE OWNER ROW (processes B2) — mirrors the deep-dive header's affordance, same roster, same
// PUT. The workflow's EXECUTION identity is untouched: this names who is accountable, nothing more.
function WorkflowOwnerRow({ workflowId }: { workflowId: string }) {
  const [owner, setOwner] = useState<{ userId: string; name: string; explicit: boolean } | null>(null);
  const [mates, setMates] = useState<Teammate[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/${workflowId}/owner`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!dead && j?.owner?.userId) setOwner(j.owner); })
      .catch(() => {});
    void fetch('/api/meetings/teammates')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('roster'))))
      .then(j => { if (!dead) setMates((j?.teammates ?? []) as Teammate[]); })
      .catch(() => { if (!dead) { setMates([]); setFailed(true); } });
    return () => { dead = true; };
  }, [workflowId]);

  if (!owner) {
    return <div className="text-[12.5px] text-neutral-400">Loading…</div>;
  }
  if (failed) {
    return <div className="text-[12.5px] text-neutral-500">Owned by {owner.explicit ? owner.name : 'you'} — could not load your workspace to change it.</div>;
  }

  const pick = async (userId: string) => {
    if (!userId || saving) return;
    const m = (mates ?? []).find(x => x.userId === userId);
    const name = m?.name;
    const before = owner;
    setSaving(true);
    setOwner({ userId, name: name ?? 'you', explicit: true });
    try {
      const r = await fetch(`/api/workflows/${workflowId}/owner`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUserId: userId, ownerName: name }),
      });
      if (!r.ok) { setOwner(before); toast.error(r.status === 403 ? 'Only the owner can hand this over.' : 'That change did not land — try again.'); return; }
      const j = await r.json().catch(() => null);
      if (j?.owner?.userId) setOwner(j.owner);
      toast.success(name ? `${name} owns this workflow now.` : 'You own this workflow now.');
    } catch { setOwner(before); toast.error('That change did not land — try again.'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <select
        value={owner.userId}
        disabled={saving || mates === null}
        onChange={e => void pick(e.target.value)}
        className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
      >
        {/* The current holder is always nameable, even when they aren't in the teammate roster
            (the roster excludes the caller by design). */}
        <option value={owner.userId}>{(mates ?? []).some(m => m.userId === owner.userId) ? owner.name : 'Me'}</option>
        {(mates ?? []).filter(m => m.userId !== owner.userId).map(m => (
          <option key={m.userId} value={m.userId}>{m.name}</option>
        ))}
      </select>
      <p className="text-[11px] text-neutral-400 mt-1">Accountability only — runs still execute with the creator&apos;s mailbox, coworkers, and connections.</p>
    </>
  );
}

function HandoffStepFields({ step, onUpdate }: {
  step: HandoffStep;
  onUpdate: (p: Partial<HandoffStep>) => void;
}) {
  const [mates, setMates] = useState<Teammate[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    void fetch('/api/meetings/teammates')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('roster'))))
      .then(j => { if (!dead) setMates((j?.teammates ?? []) as Teammate[]); })
      .catch(() => { if (!dead) { setMates([]); setFailed(true); } });
    return () => { dead = true; };
  }, []);

  const pick = (userId: string) => {
    const m = (mates ?? []).find(x => x.userId === userId);
    onUpdate({ assignee_user_id: userId, assignee_name: m?.name ?? undefined });
  };

  return (
    <div className="p-4 space-y-4">
      <Field label="Person" hint="who holds this step">
        {mates === null ? (
          <div className="text-[12.5px] text-neutral-400">Loading your workspace…</div>
        ) : failed ? (
          <div className="text-[12.5px] text-neutral-500">Could not load your workspace right now — reopen this step to try again.</div>
        ) : mates.length === 0 ? (
          <div className="text-[12.5px] text-neutral-500">No teammates in your workspace yet.</div>
        ) : (
          <select
            value={step.assignee_user_id ?? ''}
            onChange={e => pick(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
          >
            <option value="">Choose a person…</option>
            {mates.map(m => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
        )}
      </Field>

      <Field label="The ask">
        <textarea
          value={step.ask ?? ''}
          onChange={e => onUpdate({ ask: e.target.value })}
          rows={3}
          placeholder="What are they deciding or reviewing?"
          className="w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white resize-none placeholder-neutral-400"
        />
      </Field>

      <Field label="Chase after" hint="optional">
        <select
          value={step.sla_hours ? String(step.sla_hours) : ''}
          onChange={e => onUpdate({ sla_hours: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
        >
          {SLA_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>

      <p className="text-[11.5px] text-neutral-400 leading-relaxed">
        The run pauses here. They get it on their deck (and by email); the coworker chases after the SLA.
      </p>
    </div>
  );
}

// ── The gate panel (guardrails arc) ───────────────────────────────────────────
// Three layers, shown in the order of their authority: the engine's own floors (locked, truthful
// — GATE_BUILTIN_LINES), then the user's rules (the only steerable layer), then the legacy free
// text. The footnote states the escalation honestly: fix → note → redo once → hold.
const STARTER_RULES = [
  'Hide personal data — names, emails, phone numbers',
  'Never include internal pricing or margins',
  'Keep the tone professional',
];

function VerifyStepFields({ step, onUpdate, stepCheckCount = 0 }: {
  step: VerifyStep;
  onUpdate: (p: Partial<VerifyStep>) => void;
  stepCheckCount?: number;
}) {
  const rules = step.rules ?? [];
  const [draft, setDraft] = useState('');

  const addRule = (text: string) => {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    if (rules.length >= 10) return;
    if (rules.some(r => r.trim().toLowerCase() === clean.toLowerCase())) return;
    onUpdate({ rules: [...rules, clean] });
  };
  const removeRule = (i: number) => onUpdate({ rules: rules.filter((_, x) => x !== i) });

  const starters = STARTER_RULES.filter(
    s => !rules.some(r => r.trim().toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-neutral-500 leading-relaxed">
        Before delivery, the final draft is checked against the original material this run
        gathered — numbers recomputed, claims verified, your rules enforced. What can be proven
        wrong is fixed and noted; what can&apos;t be fixed is held for you instead of delivering.
      </p>

      {/* Locked built-ins */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">
            Always checked — built in
          </span>
          <span className="text-[10px] text-neutral-400">built in</span>
        </div>
        <div className="bg-teal-50/40 border border-teal-100 rounded-xl px-3 py-2.5 space-y-1.5">
          {GATE_BUILTIN_LINES.map((line, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <CheckIcon className="w-3 h-3 text-teal-500 flex-shrink-0 mt-[3px]" />
              <span className="text-[11.5px] text-neutral-600 leading-snug">{line}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Your rules */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">Your rules</span>
          <span className="text-[10px] text-neutral-400">{rules.length}/10</span>
        </div>

        {rules.length > 0 && (
          <div className="space-y-1 mb-2">
            {rules.map((r, i) => (
              <div key={i} className="flex items-start gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
                <span className="flex-1 min-w-0 text-[12px] text-neutral-700 leading-snug break-words">{r}</span>
                <button type="button" onClick={() => removeRule(i)} title="Remove rule"
                  className="flex-shrink-0 p-0.5 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            maxLength={200}
            disabled={rules.length >= 10}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addRule(draft); setDraft(''); }
            }}
            placeholder="Add a rule in your own words…"
            className="flex-1 min-w-0 px-3 py-2 border border-neutral-200 rounded-lg text-[13px] bg-white outline-none focus:border-indigo-300 disabled:opacity-50"
          />
          <button type="button"
            disabled={!draft.trim() || rules.length >= 10}
            onClick={() => { addRule(draft); setDraft(''); }}
            className="flex-shrink-0 px-3 py-2 rounded-lg text-[12px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-30 transition-colors">
            Add
          </button>
        </div>

        {/* Authoring is contextual, enforcement is single — say where the other asks live. */}
        {stepCheckCount > 0 && (
          <p className="text-[11px] text-neutral-400 mt-2 leading-snug">
            Also enforcing {stepCheckCount} step check{stepCheckCount === 1 ? '' : 's'} — edit them on their steps.
          </p>
        )}

        {starters.length > 0 && rules.length < 10 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {starters.map(s => (
              <button key={s} type="button" onClick={() => addRule(s)}
                className="inline-flex items-center rounded-full bg-indigo-50 text-indigo-600 text-[11px] px-2.5 py-1 hover:bg-indigo-100 transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legacy free-text guidance — still honored by the engine */}
      <Field label="Extra guidance (optional)" hint={'e.g. "cite only .gov sources"'}>
        <textarea
          value={step.instruction ?? ''}
          onChange={e => onUpdate({ instruction: e.target.value })}
          rows={2}
          className="w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white resize-none"
        />
      </Field>

      <p className="text-[11px] text-neutral-400 leading-relaxed border-t border-neutral-100 pt-3">
        If a rule is broken, it gets fixed and noted. If it can&apos;t be fixed, the step is redone
        once — and if it still fails, the run is held for your review instead of delivering.
      </p>
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
  if (trigger.type === 'reaction') return trigger.label ?? 'When it happens';
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

// ════════════════════════════════════════════════════════════════════════════
// THE WHEN BLOCK — the editor (THE RELAY CANVAS, W1)
//
// Three sections, THREE INDEPENDENT CONFIGS:
//   1. Runs on demand — a standing truth, not a button (law 6: manual is always available).
//   2. On a schedule  — the primary clock (`workflow.trigger`); at most one (next_run_at is singular).
//   3. When something happens — the EVENT DOORS (`workflow.triggers`), rendered from the registry.
// Editing any one of them never writes the others: the destroyer bug (one Manual click erasing a
// reaction trigger) is structurally impossible here — there is no shared toggle any more.
// ════════════════════════════════════════════════════════════════════════════
function WhenSection({ workflow, selfId, onPrimary, onDoors, onFireLimit }: {
  workflow: WorkflowDraft;
  selfId: string;
  onPrimary: (t: WorkflowTrigger) => void;
  onDoors: (doors: ReactionDoor[]) => void;
  onFireLimit: (n: number) => void;
}) {
  const features = useWorkspaceFeatures();
  const wfOptions = useWorkflowOptions();
  const { primary, doors } = normalizeTriggers(workflow);
  const scheduled = primary.type === 'schedule';
  const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  const addRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const setDoor = (i: number, partial: Partial<ReactionDoor>) =>
    onDoors(doors.map((d, idx) => idx === i ? { ...d, ...partial } : d));
  const removeDoor = (i: number) => onDoors(doors.filter((_, idx) => idx !== i));
  const addDoor = (source: TriggerSourceKey) => { onDoors([...doors, { type: 'reaction', source }]); setPickerOpen(false); };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center flex-shrink-0 mt-0.5">
          <BoltIcon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] text-neutral-400 uppercase tracking-wide font-semibold mb-0.5">When</div>
          <div className="text-[18px] font-semibold text-neutral-900 leading-tight">What starts this workflow</div>
        </div>
      </div>
      <div className="border-t border-neutral-100" />

      {/* 1 — RUNS ON DEMAND: always true, so it is a sentence, never a choice. */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-100">
        <BoltIcon className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-neutral-700">Runs on demand</div>
          <p className="text-[11.5px] text-neutral-500 leading-snug">
            You can always run this yourself — from here, from the task list, or by asking a coworker.
          </p>
        </div>
      </div>

      {/* 2 — ON A SCHEDULE: the primary clock. Off = manual primary; the doors are untouched. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClockIcon className="w-4 h-4 text-amber-500" />
            <span className="text-[12.5px] font-medium text-neutral-700">On a schedule</span>
          </div>
          <button type="button"
            onClick={() => onPrimary(scheduled ? { type: 'manual' } : { type: 'schedule', cron: '0 9 * * *', timezone: userTz })}
            className={`px-2.5 py-1 text-[11.5px] font-medium rounded-md border transition-colors ${
              scheduled ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'
            }`}>
            {scheduled ? 'On' : 'Off'}
          </button>
        </div>
        {scheduled
          ? <ScheduleEditor trigger={{ type: 'schedule', cron: primary.cron ?? '0 9 * * *', timezone: primary.timezone }} onChange={onPrimary} />
          : <p className="text-[11.5px] text-neutral-400">No clock — this one waits to be asked, or for a door below.</p>}
      </div>

      {/* 3 — WHEN SOMETHING HAPPENS: the event doors, rendered from the registry (law 3). */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <ArrowPathRoundedSquareIcon className="w-4 h-4 text-indigo-500" />
          <span className="text-[12.5px] font-medium text-neutral-700">When something happens</span>
        </div>
        <p className="text-[11.5px] text-neutral-400 mb-2.5 leading-snug">
          Any door fires its own run, carrying the one thing that arrived.
        </p>

        <div className="space-y-2">
          {doors.map((door, i) => {
            const def = triggerSource(door.source);
            const Icon = sourceIcon(def?.icon);
            const needsWhen = def?.needsWhen !== false;
            const filters = door.filters ?? [];
            // W5 — FIREABLE = a judged condition OR at least one deterministic filter (the same
            // rule readiness enforces; the two must never disagree about what is ready).
            const blank = needsWhen ? (!door.when?.trim() && filters.length === 0) : !door.workflow_id;
            return (
              <div key={`${door.source}-${i}`} className="rounded-lg border border-neutral-200 px-2.5 py-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-5 h-5 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3 h-3" />
                  </span>
                  <span className="text-[12px] font-medium text-neutral-700 flex-1 min-w-0 truncate">{def?.label ?? door.source}</span>
                  <button type="button" onClick={() => removeDoor(i)} title="Remove this door"
                    className="p-0.5 text-neutral-300 hover:text-red-500 transition-colors flex-shrink-0">
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* THE FILTERS — exact, decided in code, before any judgement. Chips + one small
                    menu; never a query builder (the calm grammar the owner asked for). */}
                {needsWhen && (
                  <DoorFilterRow
                    source={door.source}
                    filters={filters}
                    onChange={next => setDoor(i, { filters: next.length ? next : undefined })}
                  />
                )}
                {needsWhen ? (
                  <input
                    value={door.when ?? ''}
                    onChange={e => setDoor(i, { when: e.target.value })}
                    // With filters seated, the judged condition is REFINEMENT — the placeholder says
                    // so, so nobody reads a blank box as an unfinished door.
                    placeholder={filters.length
                      ? 'and when (optional): a condition to judge on top…'
                      : (WHEN_PLACEHOLDER[door.source] ?? 'when …')}
                    className="w-full px-2 py-1.5 border border-neutral-200 rounded-md text-[12.5px] bg-white outline-none focus:border-indigo-300"
                  />
                ) : (
                  <select
                    value={door.workflow_id ?? ''}
                    onChange={e => setDoor(i, { workflow_id: e.target.value || undefined })}
                    className="w-full px-2 py-1.5 border border-neutral-200 rounded-md text-[12.5px] bg-white outline-none focus:border-indigo-300">
                    <option value="">Choose a workflow…</option>
                    {wfOptions.filter(o => o.id !== selfId).map(o => (
                      <option key={o.id} value={o.id}>{o.name || 'Untitled'}</option>
                    ))}
                  </select>
                )}
                {blank && (
                  <p className="mt-1 text-[11px] text-amber-600">
                    {needsWhen ? 'This door needs a condition or a filter before it can fire.' : 'Pick the workflow whose delivery opens this door.'}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button ref={addRef} type="button" onClick={() => setPickerOpen(v => !v)}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-neutral-600 border border-dashed border-neutral-300 rounded-md hover:bg-neutral-50 hover:text-neutral-800 transition-colors">
          <PlusIcon className="w-3.5 h-3.5" />
          Add a door
        </button>
        <AnchoredPopover anchorRef={addRef} open={pickerOpen} onClose={() => setPickerOpen(false)} align="left" width={252}>
          {/* THE OVERLAY LAW: the shell is transparent — the consumer paints the panel. */}
          <div className="py-1 bg-white border border-neutral-200 rounded-xl shadow-xl overflow-hidden">
            {TRIGGER_SOURCES.map(src => {
              const allowed = src.feature === null || features[src.feature] !== false;
              const Icon = sourceIcon(src.icon);
              return (
                <button key={src.key} type="button" disabled={!allowed}
                  title={allowed ? '' : 'This door needs a feature that\'s off for this workspace'}
                  onClick={() => { if (allowed) addDoor(src.key); }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <Icon className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                  <span className="text-[12.5px] text-neutral-700">{src.label}</span>
                </button>
              );
            })}
          </div>
        </AnchoredPopover>

        {/* THE THROTTLE, NEVER A SHREDDER (W3b) — only where there is something to throttle: a
            doorless workflow has no event runs to pace, so this control does not exist for it
            (no dead chrome). The floors are the engine's; the promise is that nothing is lost. */}
        {doors.length > 0 && (
          <ThrottleRow limit={workflow.fireLimit} onChange={onFireLimit} />
        )}
      </div>
    </div>
  );
}

// THE THROTTLE control — a stepper on a real number. The field never holds "unset": absence is the
// platform default, and the "(default)" word is worn only while the number IS the default.
function ThrottleRow({ limit, onChange }: { limit?: FireLimit; onChange: (n: number) => void }) {
  const value = limit?.dailyFires ?? FIRE_LIMIT_DEFAULT;
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = (raw: string) => {
    const n = Number(raw.trim());
    if (!Number.isFinite(n)) { setText(String(value)); return; }
    onChange(n);                       // clamped by the ONE clamp, never a second range here
  };
  const step = (d: number) => onChange(value + d);

  return (
    <div className="mt-3 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-100">
      <div className="flex items-center gap-1.5 text-[12.5px] text-neutral-700">
        <span>Up to</span>
        <button type="button" onClick={() => step(-1)} disabled={value <= FIRE_LIMIT_MIN}
          title="One fewer a day"
          className="w-6 h-6 rounded-md border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed leading-none">−</button>
        <input
          type="number" inputMode="numeric" min={FIRE_LIMIT_MIN} max={FIRE_LIMIT_MAX}
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
          aria-label="Event runs a day"
          className="w-14 px-1.5 py-1 text-center border border-neutral-200 rounded-md text-[12.5px] bg-white outline-none focus:border-indigo-300"
        />
        <button type="button" onClick={() => step(1)} disabled={value >= FIRE_LIMIT_MAX}
          title="One more a day"
          className="w-6 h-6 rounded-md border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed leading-none">+</button>
        <span>event runs a day</span>
        {limit?.isDefault && <span className="text-[11px] text-neutral-400">(default)</span>}
      </div>
      <p className="mt-1 text-[11.5px] text-neutral-500 leading-snug">
        Extra ones wait for tomorrow.
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// THE DOOR FILTERS (relay canvas W5) — the exact half of a door, said in chips.
//
// The grammar, deliberately small (the owner's ask: easy to understand, 80/20, no clutter):
//   · what EXISTS renders as a removable chip in the registry's own words ("Sender domain is
//     acme.test") — reading a door never requires opening an editor;
//   · what you ADD comes through ONE quiet "+ filter" → a menu of THIS SOURCE'S fields (law 3:
//     rendered from `filterFields`, never a hardcoded list) → one inline row;
//   · the operator is a WORD, not a control, whenever the field offers only one — a select that
//     can only say one thing is chrome.
// No boolean toggles, no groups, no nesting: filters are AND by law, so there is nothing to choose.
// ════════════════════════════════════════════════════════════════════════════
function DoorFilterRow({ source, filters, onChange }: {
  source: TriggerSourceKey;
  filters: DoorFilter[];
  onChange: (next: DoorFilter[]) => void;
}) {
  const fields = filterFieldsFor(source);
  const addRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<DoorFilter | null>(null);

  if (!fields.length) return null;                 // a source with nothing structural to filter on

  const fieldLabel = (key: string) => fields.find(f => f.key === key)?.label ?? key;
  const opsFor = (key: string): DoorFilterOp[] => fields.find(f => f.key === key)?.ops ?? [];

  const begin = (f: FilterFieldDef) => {
    setDraft({ field: f.key, op: f.ops[0], value: '' });
    setMenuOpen(false);
  };
  const commit = () => {
    const d = draft;
    if (!d) return;
    const value = d.value.trim();
    if (!value) { setDraft(null); return; }        // a blank filter is no filter — never stored
    const key = (x: DoorFilter) => `${x.field}|${x.op}|${x.value.toLowerCase()}`;
    const next = { ...d, value };
    onChange(filters.some(x => key(x) === key(next)) ? filters : [...filters, next]);
    setDraft(null);
  };

  return (
    <div className="mb-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {filters.map((f, i) => (
          <span key={`${f.field}-${f.op}-${i}`}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-neutral-100 border border-neutral-200 text-[11px] text-neutral-600">
            <span className="truncate max-w-[190px]">
              {fieldLabel(f.field)} {FILTER_OP_LABEL[f.op]} <span className="text-neutral-800">{f.value}</span>
            </span>
            <button type="button" title="Remove this filter"
              onClick={() => onChange(filters.filter((_, idx) => idx !== i))}
              className="p-0.5 text-neutral-300 hover:text-red-500 transition-colors">
              <XMarkIcon className="w-3 h-3" />
            </button>
          </span>
        ))}
        {!draft && (
          <button ref={addRef} type="button" onClick={() => setMenuOpen(v => !v)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 transition-colors">
            <PlusIcon className="w-3 h-3" />
            filter
          </button>
        )}
      </div>

      <AnchoredPopover anchorRef={addRef} open={menuOpen} onClose={() => setMenuOpen(false)} align="left" width={216}>
        <div className="py-1 bg-white border border-neutral-200 rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 pt-1 pb-1.5 text-[10.5px] uppercase tracking-wide text-neutral-400 font-semibold">
            Only when
          </div>
          {fields.map(f => (
            <button key={f.key} type="button" onClick={() => begin(f)}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left hover:bg-neutral-50 transition-colors">
              <span className="text-[12.5px] text-neutral-700">{f.label}</span>
              <span className="text-[11px] text-neutral-400">{f.ops.map(o => FILTER_OP_LABEL[o]).join(' / ')}</span>
            </button>
          ))}
        </div>
      </AnchoredPopover>

      {draft && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[11.5px] text-neutral-500 flex-shrink-0">{fieldLabel(draft.field)}</span>
          {opsFor(draft.field).length > 1 ? (
            <select value={draft.op}
              onChange={e => setDraft({ ...draft, op: e.target.value as DoorFilterOp })}
              className="px-1.5 py-1 border border-neutral-200 rounded-md text-[11.5px] bg-white outline-none focus:border-indigo-300">
              {opsFor(draft.field).map(o => <option key={o} value={o}>{FILTER_OP_LABEL[o]}</option>)}
            </select>
          ) : (
            // ONE op means there is nothing to pick — it is said as a word.
            <span className="text-[11.5px] text-neutral-500 flex-shrink-0">{FILTER_OP_LABEL[draft.op]}</span>
          )}
          <input autoFocus
            value={draft.value}
            onChange={e => setDraft({ ...draft, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') setDraft(null);
            }}
            onBlur={commit}
            placeholder={FILTER_VALUE_HINT[`${source}.${draft.field}`] ?? ''}
            aria-label={`${fieldLabel(draft.field)} ${FILTER_OP_LABEL[draft.op]}`}
            className="flex-1 min-w-0 px-2 py-1 border border-neutral-200 rounded-md text-[11.5px] bg-white outline-none focus:border-indigo-300"
          />
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={commit} title="Add this filter"
            className="px-1.5 py-1 rounded-md text-[11.5px] text-indigo-600 hover:bg-indigo-50 transition-colors flex-shrink-0">✓</button>
        </div>
      )}
    </div>
  );
}

// A value hint per (source, field) — an EXAMPLE only; the registry stays the field catalogue and an
// unlisted key simply gets no hint (never a fabricated one).
const FILTER_VALUE_HINT: Record<string, string> = {
  'mail.from_address': 'careers@acme.test  ·  acme.test',
  'mail.subject': 'application',
  'file.filename': 'CV',
  'file.ext': 'pdf',
  'meeting.title': 'client call',
};

// The door's own grammar — the sentence a person completes. Keyed by registry source; an
// unlisted source degrades to the generic prompt (the registry stays the catalogue).
const WHEN_PLACEHOLDER: Record<string, string> = {
  mail:    'when it looks like a new application',
  file:    'when it is a signed contract',
  meeting: 'when it was a client call',
};

function ScheduleEditor({ trigger, onChange }: { trigger: WorkflowTrigger; onChange: (t: WorkflowTrigger) => void }) {
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
      {trigger.type === 'schedule' && (
        <div className="pt-1 space-y-3">
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
      {/* Instructions */}
      <Field label="Instructions" hint="optional">
        <textarea
          value={(cfg.instructions as string) ?? ''}
          onChange={e => set('instructions', e.target.value || undefined)}
          rows={3}
          placeholder="Voice, audience, rules… e.g. Write from a hiring manager's perspective. No LinkedIn clichés. Short sentences."
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </Field>

      {/* Vocabulary */}
      <Field label="Vocabulary to seed" hint="optional">
        <input
          type="text"
          value={(cfg.vocabulary as string) ?? ''}
          onChange={e => set('vocabulary', e.target.value || undefined)}
          placeholder="data sovereignty, unified context, context-switching cost…"
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </Field>

      {/* Content framework */}
      <Field label="Content framework" hint="optional">
        <select
          value={(cfg.framework as string) ?? ''}
          onChange={e => set('framework', e.target.value || undefined)}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white"
        >
          <option value="">No framework</option>
          {LINKEDIN_FRAMEWORKS.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        {(() => {
          const fw = LINKEDIN_FRAMEWORKS.find(f => f.id === (cfg.framework as string));
          return fw ? <p className="mt-1.5 text-[11px] text-neutral-400 leading-relaxed">{fw.description}</p> : null;
        })()}
      </Field>

      {/* Quick parameters */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tone" hint="optional">
          <select value={(cfg.tone as string) ?? ''} onChange={e => set('tone', e.target.value || undefined)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="">Default</option>
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
        <Field label="Language">
          <select value={(cfg.language as string) ?? 'en'} onChange={e => set('language', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="pt">Portuguese</option>
          </select>
        </Field>
        <Field label="Drafts">
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
        <Field label="Voice reference" hint="optional">
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
  const features = useWorkspaceFeatures();
  const displayId = value === 'browser_fetch' ? 'fetch_url' : (value === 'get_urgent_emails' ? 'get_emails' : value);
  const groups = [
    { label: 'Gather',      ids: ['get_emails', 'get_meeting_context', 'get_calendar', 'read_kb_file', 'web_search', 'fetch_url', 'rss_feed', 'get_pt_tenders', 'deep_research', 'slack_read_channel'] },
    { label: 'Compute',     ids: ['run_compute'] },
    { label: 'Collaborate', ids: ['get_workflow_output'] },
    { label: 'Act',         ids: ['slack_send'] },
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
                const allowed = isToolAllowed(t.id, features);
                return (
                  <button key={t.id} type="button" disabled={!allowed}
                    title={allowed ? '' : 'This step needs a feature that\'s off for this workspace'}
                    onClick={() => { if (allowed) onChange(t.id); }}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all ${
                      !allowed
                        ? 'bg-neutral-50 border-neutral-200 opacity-40 cursor-not-allowed'
                        : isSelected
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

  const [changingTool, setChangingTool] = useState(false);
  const selectedTool = AVAILABLE_TOOLS.find(t => t.id === (step.tool === 'browser_fetch' ? 'fetch_url' : step.tool === 'get_urgent_emails' ? 'get_emails' : step.tool));

  return (
    <>
      {/* Tool selector — full grid when picking, compact chip when configured */}
      {changingTool || !selectedTool ? (
        <Field label="Choose a tool">
          <InlineToolGrid value={step.tool} onChange={toolId => { onUpdate({ tool: toolId, config: {} }); setChangingTool(false); }} />
        </Field>
      ) : (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-neutral-200 bg-neutral-50">
          <ToolPickerIcon toolId={selectedTool.id} size="sm" />
          <span className="text-[12.5px] font-medium text-neutral-700 flex-1 truncate">{selectedTool.label}</span>
          <button type="button" onClick={() => setChangingTool(true)}
            className="text-[11px] text-neutral-400 hover:text-indigo-600 transition-colors flex-shrink-0">
            Change
          </button>
        </div>
      )}
      {!changingTool && (<>
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
      {step.tool === 'slack_read_channel' && (
        <>
          <SlackChannelField label="Channel to read" value={(step.config.channel as string) ?? ''} onChange={v => onUpdate({ config: { ...step.config, channel: v } })} />
          <Field label="How many messages" hint="Most recent (max 100)">
            <input type="number" min={1} max={100} value={(step.config.limit as number) ?? 30}
              onChange={e => onUpdate({ config: { ...step.config, limit: Number(e.target.value) || 30 } })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
          </Field>
          <Field label="Time window">
            <select value={String((step.config.days as number) ?? 0)}
              onChange={e => onUpdate({ config: { ...step.config, days: Number(e.target.value) } })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
              <option value="0">All recent</option>
              <option value="1">Past 24 hours</option>
              <option value="7">Past 7 days</option>
              <option value="30">Past 30 days</option>
            </select>
          </Field>
        </>
      )}
      {step.tool === 'slack_send' && (
        <>
          <SlackChannelField label="Channel" value={(step.config.channel as string) ?? ''} onChange={v => onUpdate({ config: { ...step.config, channel: v } })} />
          <Field label="What to say" hint="The coworker writes the message from this + what the pipeline produced. Tag people with <@Name>.">
            <textarea
              value={(step.config.instruction as string) ?? ''}
              onChange={e => onUpdate({ config: { ...step.config, instruction: e.target.value } })}
              placeholder={'Post a 2-line summary of the brief and tag <@teammate> to review.'}
              rows={3}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y" />
          </Field>
        </>
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
      </>)}
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

interface SlackChannel { id: string; name: string; is_private: boolean }

function SlackChannelField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [state, setState] = useState<{ connected: boolean; channels: SlackChannel[]; loaded: boolean }>({ connected: false, channels: [], loaded: false });
  useEffect(() => {
    fetch('/api/integrations/slack/channels').then(r => r.json())
      .then(d => setState({ connected: Boolean(d.connected), channels: d.channels ?? [], loaded: true }))
      .catch(() => setState({ connected: false, channels: [], loaded: true }));
  }, []);
  if (state.loaded && !state.connected) {
    return (
      <Field label={label}>
        <p className="text-[11.5px] text-amber-600">
          Slack isn&apos;t connected. <a href="/settings?tab=connections" className="underline">Connect it</a> to post to a channel.
        </p>
      </Field>
    );
  }
  return (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
        <option value="">Select a channel…</option>
        <option value="@me">📩 Direct message to you</option>
        {state.channels.map(c => (
          <option key={c.id} value={c.is_private ? c.id : `#${c.name}`}>{c.is_private ? '🔒 ' : '#'}{c.name}</option>
        ))}
      </select>
      <p className="text-[11px] text-neutral-400 mt-1">DMs you privately, or posts to a channel (invite @AUGMTD to private ones).</p>
    </Field>
  );
}

function OutputEditor({ output, onChange }: { output: OutputConfig; onChange: (o: OutputConfig) => void }) {
  const [connections, setConnections] = useState<{ id: string; provider: string; email: string }[]>([]);
  const norm = normalizeOutput(output);
  const home = norm.home;
  const linkSlack = home === 'document' && Boolean(output.link_out?.slack);

  useEffect(() => {
    if (home !== 'email') return;
    fetch('/api/connections').then(r => r.json()).then(d => setConnections(d.connections ?? [])).catch(() => {});
  }, [home]);

  const toggleEmailId = (id: string) => {
    const current = output.email_recipient_ids ?? output.notification_email_ids ?? [];
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    onChange({ ...output, email_recipient_ids: next });
  };

  return (
    <>
      <Field label="Where it goes" hint="The app always keeps a record regardless">
        <select value={home} onChange={e => onChange({ ...output, destination: e.target.value as OutputConfig['destination'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="message">Message in thread</option>
          <option value="document">Document (saved to Drive)</option>
          <option value="slack">Slack channel</option>
          <option value="email">Email</option>
        </select>
      </Field>

      {home === 'slack' && (
        <SlackChannelField label="Channel" value={output.slack_channel ?? ''} onChange={v => onChange({ ...output, slack_channel: v })} />
      )}

      {(home === 'document' || home === 'email') && (
        <Field label={home === 'email' ? 'Subject line' : 'Title template'}>
          <input type="text" value={output.title_template ?? ''} onChange={e => onChange({ ...output, title_template: e.target.value })}
            placeholder="Weekly Briefing — {{date}}"
            className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px]" />
          <p className="text-[11.5px] text-neutral-500 mt-1">
            Use <code className="bg-neutral-100 px-1 rounded">{'{{date}}'}</code>,{' '}
            <code className="bg-neutral-100 px-1 rounded">{'{{week_of}}'}</code>, or{' '}
            <code className="bg-neutral-100 px-1 rounded">{'{{workflow}}'}</code>.
          </p>
        </Field>
      )}

      {home === 'document' && (
        <>
          <Field label="Document type">
            {/* THE EXPLICIT FRAME OUTPUT (frames plan, THE FRAME SERIES): configured here, the
                production door is FORCED to the frame lane — no title-word lottery. One artifact
                identity per workflow; each run updates it in place and keeps the older versions. */}
            <select value={output.artifact_type ?? 'document'} onChange={e => onChange({ ...output, artifact_type: e.target.value as OutputConfig['artifact_type'] })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
              <option value="document">Word document</option>
              <option value="email">Email draft</option>
              <option value="frame">Frame — a live dashboard, updated every run</option>
            </select>
          </Field>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={linkSlack}
              onChange={e => onChange({ ...output, link_out: { ...(output.link_out ?? {}), slack: e.target.checked } })}
              className="w-3.5 h-3.5 rounded accent-indigo-600" />
            <span className="text-[12.5px] text-neutral-700">Also drop a link in a Slack channel</span>
          </label>
          {linkSlack && (
            <>
              <SlackChannelField label="Link channel" value={output.slack_channel ?? ''} onChange={v => onChange({ ...output, slack_channel: v })} />
              <Field label="How to announce it" hint="The coworker writes the channel message from this + the document. Leave blank for a simple link.">
                <textarea
                  value={output.slack_announcement ?? ''}
                  onChange={e => onChange({ ...output, slack_announcement: e.target.value })}
                  placeholder={'e.g. Post a 2-line summary highlighting the top risk, and tag <@teammate> to review.'}
                  rows={2}
                  className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y" />
              </Field>
            </>
          )}
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

      <Field label="Report back" hint="How the coworker tells you what it did">
        <select value={norm.reportMode} onChange={e => onChange({ ...output, report_mode: e.target.value as OutputConfig['report_mode'] })}
          className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
          <option value="each_run">After every run</option>
          <option value="digest">Periodic digest</option>
          <option value="silent">Silent (no message)</option>
        </select>
      </Field>

      {home === 'email' && (
        <Field label="Send to" hint="The coworker emails these addresses (anyone — no inbox connection needed). Leave empty to email you.">
          <EmailRecipientsField value={output.email_to ?? []} onChange={v => onChange({ ...output, email_to: v })} />
          {connections.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] text-neutral-400">Or a connected mailbox:</p>
              {connections.map(c => {
                const checked = (output.email_recipient_ids ?? output.notification_email_ids ?? []).includes(c.id);
                return (
                  <label key={c.id} className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={checked} onChange={() => toggleEmailId(c.id)}
                      className="w-3.5 h-3.5 rounded accent-indigo-600" />
                    <span className="text-[13px] text-neutral-700 truncate">{c.email}</span>
                  </label>
                );
              })}
            </div>
          )}
        </Field>
      )}

      {home === 'email' && (
        <Field label="Delivery">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={!!output.email_as_attachment}
              onChange={e => onChange({ ...output, email_as_attachment: e.target.checked })}
              className="w-3.5 h-3.5 rounded accent-indigo-600" />
            <span className="text-[13px] text-neutral-700">Send as an attachment</span>
          </label>
          <p className="text-[11.5px] text-neutral-400 mt-1">
            {output.email_as_attachment
              ? 'The deliverable is attached as a document; the email body is a short note.'
              : 'The deliverable is the email body.'}
          </p>
        </Field>
      )}

      {home === 'email' && output.email_as_attachment && (
        <>
          <Field label="Attachment type">
            <select value={output.artifact_type ?? 'document'} onChange={e => onChange({ ...output, artifact_type: e.target.value as OutputConfig['artifact_type'] })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] bg-white">
              <option value="document">Word document</option>
            </select>
          </Field>
          <Field label="Email body instructions (optional)">
            <textarea value={output.email_body_instructions ?? ''} onChange={e => onChange({ ...output, email_body_instructions: e.target.value })}
              rows={3}
              placeholder="How the email body should read (optional)"
              className="w-full px-3 py-2 border border-neutral-200 rounded-md text-[13px] resize-y" />
            <p className="text-[11.5px] text-neutral-500 mt-1">Leave empty for a simple cover note.</p>
          </Field>
        </>
      )}
    </>
  );
}

function EmailRecipientsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = (raw: string) => { const v = raw.trim().replace(/[,;]+$/, ''); if (v && !value.includes(v)) onChange([...value, v]); setInput(''); };
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1.5 focus-within:border-indigo-300">
      {value.map(addr => (
        <span key={addr} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-100 text-[12px] text-neutral-700">
          {addr}
          <button onClick={() => onChange(value.filter(a => a !== addr))} className="text-neutral-400 hover:text-neutral-600">×</button>
        </span>
      ))}
      <input value={input} onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); } }}
        onBlur={() => add(input)}
        placeholder={value.length ? '' : 'email@example.com'}
        className="flex-1 min-w-[140px] bg-transparent text-[13px] text-neutral-800 placeholder:text-neutral-400 outline-none py-0.5" />
    </div>
  );
}
