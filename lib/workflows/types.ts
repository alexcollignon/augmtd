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

export type OutputDestination =
  | 'thread_message'        // final output becomes an assistant message in the run's thread
  | 'artifact'              // final output materialised as a generated document
  | 'multiple_artifacts'    // final output is an array; each item becomes its own artifact
  | 'email_draft'           // final output drafted into the compose system (future)
  | 'living_document';      // replaces a pinned artifact on the workflow (future)

export type ArtifactType = 'document' | 'spreadsheet' | 'presentation' | 'email';

export type NotificationMode = 'inbox_card' | 'silent' | 'email_digest';

export interface OutputConfig {
  destination: OutputDestination;
  artifact_type?: ArtifactType;
  title_template?: string;        // e.g. "AHK Briefing — {{date}}"
  notification_mode: NotificationMode;
  notification_email_ids?: string[]; // connection IDs to send email digest to; empty = none selected yet
  output_language?: string;          // BCP-47 code — injected into all AI steps; default 'en'
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
