// ─── Workflow types ───────────────────────────────────────────────────────────
// Studio workflows: trigger + ordered steps + output destination.
// A run creates one work_thread that accumulates the workflow's output timeline.

import type { DocumentArtifact } from '@/lib/types/inbox';
export type { DocumentArtifact };

// ── Triggers ───────────────────────────────────────────────────────────────────

export type TriggerType = 'manual' | 'schedule' | 'reaction';

export interface ManualTrigger {
  type: 'manual';
}

export interface ScheduleTrigger {
  type: 'schedule';
  cron: string;          // standard 5-field cron: "0 9 * * 1"
  timezone?: string;     // IANA tz: "Europe/Lisbon". Defaults to UTC.
  label?: string;        // human-readable: "Every Monday at 9am Lisbon"
}

// STANDING REACTION (production arc step 6) — the brain as a trigger: a judged condition over
// the event stream ("when a tender matching the client's profile lands"). The reasoning sits at
// the trigger EDGE; what fires is the fixed pipeline. Judged conservatively at the sync tail
// (lib/workflows/reactions.ts); scope = the workflow's entity edge; exactly-once per event;
// honest daily cap.
export interface ReactionTrigger {
  type: 'reaction';
  when: string;          // the condition, in plain words — judged against each new event
  label?: string;        // human-readable: "When a matching tender lands"
}

export type WorkflowTrigger = ManualTrigger | ScheduleTrigger | ReactionTrigger;

// ── Steps ──────────────────────────────────────────────────────────────────────

export type StepType = 'tool' | 'ai' | 'agent' | 'approval' | 'verify' | 'handoff' | 'workflow';

// Tool step — deterministic data fetch via the MCP registry or a built-in tool id.
export interface ToolStep {
  type: 'tool';
  id: string;                      // step id, stable across reorder
  label: string;                   // human label for the builder / run trace
  tool: string;                    // tool id (e.g. 'web_search', 'get_urgent_emails')
  config: Record<string, unknown>; // tool-specific params
  /** GUARDRAILS v1.1: the user's optional per-step ask ("only this week's mail"), authored on the
   *  step's shield node but ENFORCED BY THE ONE GATE — aggregated into the verify prompt with
   *  attribution, never a per-step mini-verifier (the one-verifier law). ≤200 chars. */
  check?: string;
}

// AI step — inline intelligence transformation. No identity, no memory.
export interface AIStep {
  type: 'ai';
  id: string;
  label: string;
  prompt: string;                  // instruction — can reference previous step outputs
  output_format?: 'text' | 'markdown' | 'json';
  model_tier?: 'fast' | 'reasoning'; // maps to summarization vs conversation task type
  kb_file_ids?: string[];          // optional KB files to inject as reference documents
  /** false = never inject the worker's identity/voice into this step, even as the
   *  final step. For mechanical passes (verification gates) where a persona would
   *  fight the instruction — a verifier must preserve the draft, not restyle it. */
  use_worker_identity?: boolean;
  /** GUARDRAILS v1.2: the user's optional per-step ask, same contract as ToolStep.check —
   *  authored on the step's shield node, ENFORCED BY THE ONE GATE with attribution. Distinct from
   *  `prompt` (what to make, hoped for): a check is what must be TRUE, verified with a receipt.
   *  ≤200 chars. */
  check?: string;
}

// Agent step — reuses a custom agent's identity, instructions, KB, memory.
export interface AgentStep {
  type: 'agent';
  id: string;
  label: string;
  agent_id: string;                // references custom_agents.id
  prompt: string;                  // what we're asking this agent to do this step
}

// Approval step — THE HUMAN GATE (production arc step 2, the Executor-validated shape): the run
// PARKS here (`awaiting_approval`, outputs snapshotted), the ask lands in the standing
// commitment's room + on the deck as due-today debt, and an explicit approve RESUMES the run
// where it stopped; reject ends it honestly. OPT-IN BY CONSTRUCTION (the pilot outcome
// contract): only a workflow that explicitly CONTAINS this step ever pauses — never
// retrofitted onto existing steps, never implied by a send.
export interface ApprovalStep {
  type: 'approval';
  id: string;
  label: string;
  /** What the approver is deciding — rendered on the ask ("Review the briefing before it goes to the client list"). */
  instruction?: string;
}

// Verify step — THE STRUCTURAL VERIFICATION GATE (production arc step 3): the AHK arc's
// hand-built gate promoted into the ENGINE — one implementation, versioned, never copy-pasted
// into workflow prompts again. The step treats the PREVIOUS output as THE DRAFT and everything
// before it as SOURCE MATERIAL: the arithmetic floor recomputes the draft's computable claims
// BY CODE first, then one persona-free reasoned pass deletes/corrects ungrounded claims, fixes
// citations to real source URLs, keeps structure EXACTLY, and never modernizes dates. Output =
// the corrected draft (feeds delivery/approval).
export interface VerifyStep {
  type: 'verify';
  id: string;
  label: string;
  /** Optional extra domain rules for this workflow ("cite only .gov sources", …). */
  instruction?: string;
  /** THE GUARDRAILS ARC (Aug 14, docs/guardrails-plan.md): the user's own policy rules, plain
   *  language, one list at the ONE gate (never per-step fragments — two competing verifiers).
   *  Each ≤200 chars, list ≤10. Enforced by the gate beside the built-in checks; every finding
   *  that enforces one carries the rule's text back on the verdict. */
  rules?: string[];
}

// Handoff step — THE HUMAN GATE THAT BELONGS TO A TEAMMATE (processes arc Phase B,
// docs/processes-plan.md): the run parks here and waits on a specific workspace member —
// their deck gets the ask, THEY hold the gate (canResumeRun), decisions log with waited-time.
// Sits WHERE PLACED (seatGate moves only verify — a mid-pipeline review→publish is legitimate).
// Test runs auto-pass. REASSIGN deferred to B2 — a per-run override needs its own store.
export interface HandoffStep {
  type: 'handoff';
  id: string;
  label: string;
  /** The workspace member who holds this gate (auth user id). */
  assignee_user_id: string;
  /** Display name snapshot at authoring time (the roster can rename; the step stays legible). */
  assignee_name?: string;
  /** What they're being asked to do/decide — rendered on their deck ask and the drawer card. */
  ask?: string;
  /** Hours before the coworker chases (sweepHandoffSLAs). Absent = no SLA chase. */
  sla_hours?: number;
}

// Subprocess step — A SUBPROCESS IS A HANDOFF TO A MACHINE (relay canvas W3, law 5,
// docs/relay-canvas-plan.md). The parent parks at the ⧉ station through the SAME awaiting
// machinery as the human gates; the child runs its own rail with its OWN gate/owner/SLA; its
// completion resumes the parent with its deliverable as this step's output (the
// get_workflow_output semantics, awaited instead of read from history).
// FLOORS: depth cap 1 (a child may not itself contain a workflow step — the door check refuses,
// which also makes circularity impossible beyond self-reference, which readiness refuses);
// test mode NEVER fires the real child (it reads the child's latest delivered output).
export interface SubprocessStep {
  type: 'workflow';
  id: string;
  /** The CHILD'S NAME at authoring time — surfaces render the station without a lookup. */
  label: string;
  /** The workflow this station hands the baton to. */
  workflow_id: string;
}

export type WorkflowStep =
  | ToolStep | AIStep | AgentStep | ApprovalStep | VerifyStep | HandoffStep | SubprocessStep;

// ── Output ─────────────────────────────────────────────────────────────────────

// The single HOME of a deliverable — where it lives + is consumed.
export type OutputHome = 'message' | 'document' | 'slack' | 'email';

// Legacy destination values (still read from old rows via normalizeOutput).
export type OutputDestination =
  | OutputHome
  | 'thread_message'        // → message
  | 'artifact'              // → document
  | 'multiple_artifacts'    // → document
  | 'email_draft'           // → message (never shipped)
  | 'living_document';      // → document

// 'frame' = AN EXPLICIT OUTPUT, NOT A WORD LOTTERY (frames plan, THE FRAME SERIES): configuring it
// FORCES the production door onto the frame lane instead of hoping the title contains "dashboard".
export type ArtifactType = 'document' | 'spreadsheet' | 'presentation' | 'email' | 'frame';

// How proactively the coworker reports back after a run.
export type ReportMode = 'each_run' | 'digest' | 'silent';

// Legacy — superseded by ReportMode (read via normalizeOutput).
export type NotificationMode = 'inbox_card' | 'silent' | 'email_digest';

export interface OutputConfig {
  destination: OutputDestination;
  artifact_type?: ArtifactType;
  title_template?: string;            // e.g. "AHK Briefing — {{date}}"
  slack_channel?: string;             // home=slack, or document link-out target (id or #name)
  email_recipient_ids?: string[];     // home=email, or document email link-out (connected mailboxes)
  email_to?: string[];                // home=email: free-text recipient addresses (any address)
  email_cc?: string[];                // home=email: free-text cc addresses
  email_as_attachment?: boolean;      // home=email: send the deliverable as a document attachment (artifact_type) instead of as the body
  email_body_instructions?: string;   // home=email + attachment: optional guidance for the coworker on how to draft the short email body
  link_out?: { slack?: boolean; email?: boolean };  // DOCUMENT-only pointer fan-out (a link, never a copy)
  slack_announcement?: string;        // template for the document → Slack link-out post ({{title}}, {{link}}, {{date}}; supports <@Name>)
  report_mode?: ReportMode;           // coworker report-back cadence (default each_run)
  output_language?: string;           // BCP-47 code — injected into all AI steps; default 'en'
  /** THE METRICS BASELINE (authored, never guessed): the user's own "how long does this take me
   *  manually?" in minutes — powers the Metrics tab's time-saved line, which is ALWAYS labeled
   *  as their estimate. Absent = the tab invites it; no default, no fabrication. */
  estimated_manual_minutes?: number;
  // ── legacy (read-only back-compat) ──
  notification_mode?: NotificationMode;
  notification_email_ids?: string[];
}

// Runtime-canonical output, derived from any (old or new) OutputConfig.
export interface NormalizedOutput {
  home: OutputHome;
  artifactType: ArtifactType;
  titleTemplate?: string;
  slackChannel?: string;
  emailRecipientIds: string[];
  emailTo: string[];
  emailCc: string[];
  emailAsAttachment: boolean;
  emailBodyInstructions?: string;
  linkOut: { slack: boolean; email: boolean };
  slackAnnouncement?: string;
  reportMode: ReportMode;
  outputLanguage?: string;
}

/** Map any OutputConfig (legacy or new) to the canonical runtime shape. One source of truth. */
export function normalizeOutput(c: OutputConfig | null | undefined): NormalizedOutput {
  const oc = (c ?? {}) as OutputConfig;
  const d = String(oc.destination ?? '');
  let home: OutputHome;
  if (d === 'message' || d === 'document' || d === 'slack' || d === 'email') home = d;
  else if (d === 'thread_message' || d === 'email_draft') home = d === 'email_draft' ? 'message' : 'message';
  else if (d === 'artifact' || d === 'multiple_artifacts' || d === 'living_document') home = 'document';
  else home = 'message';

  const reportMode: ReportMode = oc.report_mode
    ?? (oc.notification_mode === 'silent' ? 'silent' : 'each_run');

  const linkOut = {
    slack: Boolean(oc.link_out?.slack),
    // legacy: email_digest on a document meant "email the doc" → email link-out
    email: Boolean(oc.link_out?.email) || (home === 'document' && oc.notification_mode === 'email_digest'),
  };

  return {
    home,
    artifactType: (oc.artifact_type as ArtifactType) ?? 'document',
    titleTemplate: oc.title_template,
    slackChannel: oc.slack_channel,
    emailRecipientIds: oc.email_recipient_ids ?? oc.notification_email_ids ?? [],
    emailTo: oc.email_to ?? [],
    emailAsAttachment: oc.email_as_attachment ?? false,
    emailBodyInstructions: oc.email_body_instructions,
    emailCc: oc.email_cc ?? [],
    linkOut,
    slackAnnouncement: oc.slack_announcement,
    reportMode,
    outputLanguage: oc.output_language,
  };
}

// ── Workflow record ────────────────────────────────────────────────────────────

export type WorkflowStatus = 'draft' | 'active' | 'paused';

export type SharingMode = 'live';

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  output_config: OutputConfig;
  last_run_at: string | null;
  next_run_at: string | null;
  /** Set when the task paused ITSELF after consecutive unreviewed runs (vs a manual pause). Cleared on any resume. */
  auto_paused_at?: string | null;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  agent_id?: string | null;
  worker_instructions?: string | null;
  skill_ids?: string[];            // task-pinned skills; empty → use the worker's assigned skills
  // Team sharing (populated by API)
  company_id?: string | null;
  shared_with_company?: boolean;
  sharing_mode?: SharingMode | null;
  is_owned_by_me?: boolean;
  owner_name?: string | null;
}

// ── Run record ─────────────────────────────────────────────────────────────────

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type TriggerSource = 'schedule' | 'event' | 'manual';

// ── THE STRUCTURED VERDICT (guardrails arc) ──────────────────────────────────
// The verify gate stops being mute: beside the corrected draft it reports WHAT it did, each
// finding quoting the draft's own words. Rides StepOutput.verdict → workflow_runs.step_outputs
// (jsonb) → the runs API / TestRunPanel / activity tab with zero route changes.

export type GateFindingSource =
  | 'numbers'     // the arithmetic floor — recomputed by code
  | 'grounding'   // claim not supported by the run's sources
  | 'citation'    // citation didn't point at a real source URL
  | 'structure'   // draft structure repaired (sections/headings)
  | 'dates'       // old material presented as current
  | 'brief'       // the producing step's own prompt, unhonored (language/length/format it stated)
  | 'rule';       // one of the user's rules

export interface GateFinding {
  source: GateFindingSource;
  /** The user rule's text — present iff source === 'rule'. */
  rule?: string;
  /** GUARDRAILS v1.1: when the enforced rule was a per-step check, the label of the step that
   *  authored it ("Fetch emails") — the finding points back at its step. */
  stepLabel?: string;
  /** The draft's own words at the violation (≤160 chars). The gate describes, never invents. */
  quote: string;
  action: 'corrected' | 'removed' | 'masked' | 'blocked';
  /** What changed / why it stopped (≤200 chars). */
  note?: string;
}

export interface GateVerdict {
  /** VERIFY_GATE_VERSION at judgment time. */
  version: number;
  /** `blocked` is honored ONLY when a finding cites a user rule — code-enforced downgrade. */
  status: 'passed' | 'corrected' | 'blocked';
  findings: GateFinding[];
  /** false = the model omitted the verdict sentinel; findings are the deterministic floor only —
   *  an honest partial, never a fabricated pass. */
  reported: boolean;
  /** This verdict came after the one guardrail retry of the producing step. */
  retried?: boolean;
}

export interface StepOutput {
  step_id: string;
  step_type: StepType;
  label: string;
  output: unknown;                  // string for ai/tool, object for agent with artifacts
  error?: string;
  duration_ms?: number;
  /** Set on verify steps only — the gate's structured receipt (guardrails arc). */
  verdict?: GateVerdict;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  user_id: string;
  status: RunStatus;
  triggered_by: TriggerSource;
  thread_id: string | null;
  step_outputs: StepOutput[];
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  artifacts?: DocumentArtifact[]; // populated by GET /runs — sourced from linked work_thread
}

// ── Notification ───────────────────────────────────────────────────────────────

export interface WorkflowNotification {
  id: string;
  workflow_run_id: string;
  workflow_id: string;
  user_id: string;
  title: string;
  summary: string | null;
  seen: boolean;
  created_at: string;
}

// ── Default shapes ─────────────────────────────────────────────────────────────

export const DEFAULT_TRIGGER: WorkflowTrigger = { type: 'manual' };

export const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  destination: 'thread_message',
  notification_mode: 'inbox_card',
};

export function makeStepId(): string {
  return `step_${Math.random().toString(36).slice(2, 10)}`;
}
