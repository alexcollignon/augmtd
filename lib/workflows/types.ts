// ─── Workflow types ───────────────────────────────────────────────────────────
// Studio workflows: trigger + ordered steps + output destination.
// A run creates one work_thread that accumulates the workflow's output timeline.

import type { DocumentArtifact } from '@/lib/types/inbox';
export type { DocumentArtifact };

// ── Triggers ───────────────────────────────────────────────────────────────────

export type TriggerType = 'manual' | 'schedule';

export interface ManualTrigger {
  type: 'manual';
}

export interface ScheduleTrigger {
  type: 'schedule';
  cron: string;          // standard 5-field cron: "0 9 * * 1"
  timezone?: string;     // IANA tz: "Europe/Lisbon". Defaults to UTC.
  label?: string;        // human-readable: "Every Monday at 9am Lisbon"
}

export type WorkflowTrigger = ManualTrigger | ScheduleTrigger;

// ── Steps ──────────────────────────────────────────────────────────────────────

export type StepType = 'tool' | 'ai' | 'agent';

// Tool step — deterministic data fetch via the MCP registry or a built-in tool id.
export interface ToolStep {
  type: 'tool';
  id: string;                      // step id, stable across reorder
  label: string;                   // human label for the builder / run trace
  tool: string;                    // tool id (e.g. 'web_search', 'get_urgent_emails')
  config: Record<string, unknown>; // tool-specific params
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
}

// Agent step — reuses a custom agent's identity, instructions, KB, memory.
export interface AgentStep {
  type: 'agent';
  id: string;
  label: string;
  agent_id: string;                // references custom_agents.id
  prompt: string;                  // what we're asking this agent to do this step
}

export type WorkflowStep = ToolStep | AIStep | AgentStep;

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

export type ArtifactType = 'document' | 'spreadsheet' | 'presentation' | 'email';

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

export interface StepOutput {
  step_id: string;
  step_type: StepType;
  label: string;
  output: unknown;                  // string for ai/tool, object for agent with artifacts
  error?: string;
  duration_ms?: number;
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
