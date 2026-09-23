// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AGENTOS TOOL VOCABULARY (stabilization W4.2 — AGENTOS PARITY)
//
// THE HOLE: the AgentOS box is a THIRD conversational door. Its Python `@tool`s
// (infra/agentos/tools_{tasks,data,integrations}.py) call back into two internal routes
// (app/api/internal/agentos/{tasks,tools}/route.ts) that wrap the SAME executors the native worker
// loop uses — but nothing compared the three. Every arc ended with "AgentOS box redeploy pending"
// and a Python mirror that had quietly drifted (a missing arg, a docstring still promising an
// immediate run after the run became a confirm card, a tool the native door grew and the box never
// learned).
//
// THIS FILE is the ONE machine-readable statement of what the AgentOS lane exposes, per worker role:
// each tool's wire arguments (names, types, required), the internal route + action it maps to, its
// confirm class (lib/work/confirm-policy.ts) and its workspace feature gate
// (lib/workspace/tool-capabilities.ts TOOL_FEATURE). It is DERIVED, not re-typed:
//   • the arguments come from the native coworker door's own definitions (COWORKER_CHAT_TOOLS),
//     translated through the declared wire aliases below;
//   • the confirm class comes from `CONFIRM_POLICY` (the one policy);
//   • the feature gate comes from `TOOL_FEATURE` (the one map);
//   • the tool SET is the coworker door (`doorToolIds('coworker')` ∩ the chat table) minus the
//     declared native-only rows, plus the declared AgentOS-only rows.
// What is declared by hand here is only what no TS source knows: which internal route serves a
// tool, which Python module holds it, the wire aliases where a runtime renames an argument, and the
// honest gap lists. `scripts/agentos-contract.ts` checks every one of those declarations against
// the Python source and the route source — a declaration that lies fails the gate.
//
// PURE: no IO. Imported by scripts (the contract + the parity smoke), never by a request path.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { COWORKER_CHAT_TOOLS, WORKER_ONLY_CHAT_TOOLS } from '@/lib/work/chat-tool-defs';
import { doorToolIds } from '@/lib/work/surface-registry';
import { CONFIRM_POLICY } from '@/lib/work/confirm-policy';
import { TOOL_FEATURE } from '@/lib/workspace/tool-capabilities';
import type { FeatureKey } from '@/lib/workspace/types';

// ─── Worker roles ─────────────────────────────────────────────────────────────────────────────────

/** The AgentOS agent ids the box serves (= custom_agents.worker_role; the bridge routes by it). */
export const AGENTOS_WORKER_ROLES = ['personal_assistant', 'branding_expert', 'research_analyst'] as const;
export type WorkerRole = typeof AGENTOS_WORKER_ROLES[number];

/** Legacy role keys still readable in persisted rows/turns; the box must NOT serve them as agents. */
export const LEGACY_ROLE_ALIASES: Readonly<Record<string, WorkerRole | null>> = {
  linkedin_drafter: 'branding_expert', // renamed Aug 2026 (sweep-rename-branding-role.ts)
  content_manager: null,               // Sofia, retired Aug 14 — no successor agent
};

/** The persona each role must carry. `labelPhrase` must appear (case-insensitive) in the prompt so the
 *  box persona says the same job the UI label says (lib/workers/roles.ts ROLE_LABELS). */
export const ROLE_PERSONA: Readonly<Record<WorkerRole, { name: string; labelPhrase: string }>> = {
  personal_assistant: { name: 'Clara', labelPhrase: 'chief of staff' },
  branding_expert: { name: 'Luca', labelPhrase: 'LinkedIn expert' },
  research_analyst: { name: 'Max', labelPhrase: 'research' },
};

// ─── Types ────────────────────────────────────────────────────────────────────────────────────────

export type ArgType = 'string' | 'number' | 'boolean' | 'array' | 'object';
export type AgentosRoute = 'tasks' | 'tools';
export type PyModule = 'tools_tasks' | 'tools_data' | 'tools_integrations';
/** 'unclassified' = not in CONFIRM_POLICY (the policy only classifies task/memory mutations; the
 *  lanes do not consult it for these — `confirmClassOf` would fail such a name closed to 'confirm'). */
export type VocabConfirm = 'confirm' | 'apply' | 'unclassified';

export interface VocabArg {
  /** The key as it travels to the internal route (`args.<key>` / `config.<key>`). */
  wire: string;
  type: ArgType;
  required: boolean;
  /** Where the arg is declared: the native door's schema, or an AgentOS-only extra. */
  origin: 'native' | 'agentos';
}

export interface VocabRow {
  name: string;
  /** The internal route + action the Python tool POSTs to. The action is always the tool name. */
  route: AgentosRoute;
  action: string;
  module: PyModule;
  args: VocabArg[];
  /** Python parameter → wire key, where the Python name differs (identity otherwise). */
  pyAliases: Readonly<Record<string, string>>;
  /** Python-declared types that intentionally differ from the wire type (the executor accepts both). */
  pyTypes: Readonly<Record<string, ArgType>>;
  confirm: VocabConfirm;
  feature: FeatureKey | null;
  roles: readonly WorkerRole[];
  /** True when the native coworker door offers it too. */
  native: boolean;
}

// ─── The hand declarations (each one checked by scripts/agentos-contract.ts) ─────────────────────

/** Which internal route + Python module serves each AgentOS tool. */
const PLACEMENT: Readonly<Record<string, { route: AgentosRoute; module: PyModule }>> = (() => {
  const t = (module: PyModule, route: AgentosRoute) => ({ route, module });
  const tasks = t('tools_tasks', 'tasks');
  const data = t('tools_data', 'tools');
  const integ = t('tools_integrations', 'tools');
  return {
    list_tasks: tasks, create_task: tasks, get_task: tasks, update_task: tasks, run_task: tasks,
    set_tasks_status: tasks, supply_run_input: tasks, duplicate_task: tasks, share_task: tasks,
    list_team_tasks: tasks, use_task: tasks, delete_task: tasks, list_worker_documents: tasks,
    get_worker_document: tasks, list_skills: tasks, apply_skill: tasks,
    get_emails: data, get_meeting_context: data, check_calendar: data, prepare_event_action: data,
    search_knowledge_base: data, web_search: data, fetch_url: data, deep_research: data,
    generate_document: data, run_compute: data, find_team_work: data, read_team_work: data,
    slack_list_channels: integ, slack_post_message: integ, slack_read_messages: integ,
    slack_list_members: integ, compose_email: integ, present_linkedin_post: integ,
  };
})();

/**
 * NATIVE → WIRE renames. The native worker loop renames some schema args before the executor
 * (chat route: get_emails `filter` → `topic`); the wire key is what the executor reads, so both
 * runtimes are compared there.
 */
const NATIVE_WIRE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  get_emails: { filter: 'topic' },
};

/** PYTHON → WIRE renames (a Python keyword/readability clash). */
const PY_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  get_emails: { from_sender: 'from' },
};

/** Python types that intentionally differ from the native schema — the executor accepts both. */
const PY_TYPES: Readonly<Record<string, Readonly<Record<string, ArgType>>>> = {
  create_task: { skill_names: 'string' },  // normalizeSkillNames: "a, b" or ["a","b"]
  update_task: { skill_names: 'string' },
};

/** Wire args only the AgentOS lane sends (the executor reads them; the native schema does not offer them). */
const AGENTOS_EXTRA_ARGS: Readonly<Record<string, readonly Omit<VocabArg, 'origin'>[]>> = {
  get_emails: [{ wire: 'mode', type: 'string', required: false }],
  generate_document: [{ wire: 'grounding', type: 'string', required: false }],
  // run_task forwards the DM thread from run_context so a future card can anchor to it; the route
  // ignores it today (the run is PREPARED, never started from here).
  run_task: [{ wire: 'thread_id', type: 'string', required: false }],
};

/**
 * AGENTOS-ONLY rows — tools the box exposes that the native door does not offer as a model tool.
 * Each carries its full arg list (there is no native schema to derive from) and its reason.
 */
export const AGENTOS_ONLY: Readonly<Record<string, { reason: string; args: readonly Omit<VocabArg, 'origin'>[] }>> = {
  deep_research: {
    reason: 'the native loop executes deep_research BEFORE the model loop (never model-invoked); the box has no pre-loop hook, so it is a tool there',
    args: [
      { wire: 'focus', type: 'string', required: true },
      { wire: 'model', type: 'string', required: false },
    ],
  },
};

/**
 * NATIVE-ONLY — coworker-door tools the box does not carry, each with its reason. A row here is a
 * DECLARED gap, not a silent one: the contract fails if one of these grows a Python tool without
 * leaving this list (stale), and fails if a coworker-door tool is in neither the box nor this list.
 */
export const NATIVE_ONLY: Readonly<Record<string, string>> = {
  read_document: 'GAP — no Python tool and no tools-route case; a box coworker cannot open a KB file past its search excerpt (needs a route case + @tool + redeploy)',
  get_email_body: 'GAP — no Python tool and no tools-route case; a box coworker reads inbox summaries only (needs a route case + @tool + redeploy)',
  request_clarification: 'native-loop UI protocol (a confirmation card before file generation); the box emits no such frame — generate_document is called directly there',
  prepare_calendar_invite: 'GAP (stated in tools_tasks.py since Sep 8) — the invite CARD producer; needs a tools-route case + @tool + redeploy',
};

/**
 * INTERNAL-ROUTE actions no Python tool reaches, each with its reason. Empty today: every case in
 * both switches is a Python tool.
 */
export const ROUTE_NATIVE_ONLY: Readonly<Record<string, string>> = {};

/**
 * KNOWN DISPATCH GAPS — found by the contract, reported, not yet fixed (the route files are fenced).
 * The contract reports these as KNOWN (non-fatal) and FAILS when one is no longer true (stale).
 */
export const KNOWN_GAPS: Readonly<Record<string, string>> = {
};

// ─── Derivation ───────────────────────────────────────────────────────────────────────────────────

const typeOf = (schema: unknown): ArgType => {
  const t = (schema as { type?: string } | null)?.type;
  return t === 'number' || t === 'integer' ? 'number'
    : t === 'boolean' ? 'boolean'
      : t === 'array' ? 'array'
        : t === 'object' ? 'object'
          : 'string';
};

function confirmOf(name: string): VocabConfirm {
  return CONFIRM_POLICY[name]?.cls ?? 'unclassified';
}

function featureOf(name: string): FeatureKey | null {
  return TOOL_FEATURE[name] ?? null;
}

/** The coworker door's worker tool set (what a seeded coworker is offered natively, pre source/feature gates). */
export function nativeWorkerDoorTools(): string[] {
  return doorToolIds('coworker').filter((id) => Boolean(COWORKER_CHAT_TOOLS[id]));
}

/** THE VOCABULARY — every tool the AgentOS lane exposes, one row each, derived. */
export function agentosVocabulary(): VocabRow[] {
  const rows: VocabRow[] = [];
  const nativeIds = nativeWorkerDoorTools().filter((id) => !(id in NATIVE_ONLY));
  for (const name of nativeIds) {
    const place = PLACEMENT[name];
    if (!place) continue; // the contract reports an unplaced native tool (neither box nor NATIVE_ONLY)
    const def = COWORKER_CHAT_TOOLS[name];
    const rename = NATIVE_WIRE[name] ?? {};
    const req = new Set(def.input_schema.required ?? []);
    const args: VocabArg[] = Object.entries(def.input_schema.properties).map(([k, s]) => ({
      wire: rename[k] ?? k, type: typeOf(s), required: req.has(k), origin: 'native' as const,
    }));
    for (const x of AGENTOS_EXTRA_ARGS[name] ?? []) {
      if (!args.some((a) => a.wire === x.wire)) args.push({ ...x, origin: 'agentos' });
    }
    rows.push({
      name, route: place.route, action: name, module: place.module, args,
      pyAliases: PY_ALIASES[name] ?? {}, pyTypes: PY_TYPES[name] ?? {},
      confirm: confirmOf(name), feature: featureOf(name), roles: AGENTOS_WORKER_ROLES, native: true,
    });
  }
  for (const [name, only] of Object.entries(AGENTOS_ONLY)) {
    const place = PLACEMENT[name];
    if (!place) continue;
    rows.push({
      name, route: place.route, action: name, module: place.module,
      args: only.args.map((a) => ({ ...a, origin: 'agentos' as const })),
      pyAliases: PY_ALIASES[name] ?? {}, pyTypes: PY_TYPES[name] ?? {},
      confirm: confirmOf(name), feature: featureOf(name), roles: AGENTOS_WORKER_ROLES, native: false,
    });
  }
  return rows;
}

/** Tools the contract must see declared somewhere: the placement table's keys (for unplaced-tool reports). */
export const PLACED_TOOLS: readonly string[] = Object.keys(PLACEMENT);

/** Re-exported so the contract reads the SAME worker-only split the native door applies. */
export { WORKER_ONLY_CHAT_TOOLS };
