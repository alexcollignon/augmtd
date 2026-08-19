import { generateWorkflowConfig } from '@/lib/workflows/generate-config';
import { computeNextRun } from '@/lib/workflows/schedule';
import { resolveSkillIdsByName, normalizeSkillNames } from '@/lib/tools/worker-skills';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkflowStep, OutputConfig, WorkflowTrigger } from '@/lib/workflows/types';
import { normalizeOutput } from '@/lib/workflows/types';
import type { WorkflowDraft } from '@/lib/workflows/draft-marker';

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const listTasksDefinition = {
  name: 'list_tasks',
  description: "List this worker's scheduled tasks. Call when the user asks what's automated, what tasks are running, what's scheduled, or wants to manage existing automations.",
  input_schema: {
    type: 'object',
    properties: {} as Record<string, unknown>,
    required: [] as string[],
  },
};

export const createTaskDefinition = {
  name: 'create_task',
  description: 'Create a new scheduled automation task for this worker. Call when the user asks to set up, schedule, or automate something recurring. The system builds a full multi-step pipeline automatically from the description.',
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Plain-language description of what the task should do and when. Be specific: include sources, what to produce, and the schedule. Example: "Every Monday at 8am, scan my inbox for client emails and write a brief."',
      },
      skill_names: {
        type: 'array',
        items: { type: 'string' },
        description: "Optional. Names of skills (from the library — see list_skills) to enforce on this task's output. Omit to use the worker's assigned skills automatically.",
      },
    },
    required: ['description'],
  },
};

export const getTaskDefinition = {
  name: 'get_task',
  description: "Read the full config of one of your tasks — steps, schedule, output language, task instructions. Call this before editing anything so you have the current state.",
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID of the task (use list_tasks to get IDs)' },
    },
    required: ['task_id'],
  },
};

export const updateTaskDefinition = {
  name: 'update_task',
  description: "Edit any aspect of an existing task in response to user feedback. Use for: renaming, changing schedule, output settings, task instructions (tone/persona), status (pause/resume), or updating step content when the user gives feedback. Always call get_task first to read the current config. Use step_patch to edit a single step by its id — identify the right step from the labels and prompts you read. Act immediately — do not ask the user to confirm first.",
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID of the task to update' },
      name: { type: 'string', description: 'New task name' },
      description: { type: 'string', description: 'New task description' },
      status: { type: 'string', enum: ['active', 'paused'], description: 'Pause or resume the task' },
      trigger: {
        type: 'object',
        description: 'New trigger — include full object. For schedules: { type: "schedule", cron: "0 9 * * 1", timezone: "Europe/Lisbon", label: "Every Monday at 9am" }',
        properties: {
          type: { type: 'string', enum: ['manual', 'schedule'] },
          cron: { type: 'string' },
          timezone: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['type'],
      },
      output_language: { type: 'string', description: 'BCP-47 language code for output. Examples: "de" (German), "pt" (Portuguese), "fr" (French), "es" (Spanish)' },
      output_destination: { type: 'string', enum: ['message', 'document', 'slack', 'email'], description: "The deliverable's single home. message = a message in the run thread; document = a saved document in Documents/Drive; slack = posted to a Slack channel; email = emailed. The app always keeps a record regardless." },
      output_artifact_type: { type: 'string', enum: ['document', 'spreadsheet', 'presentation', 'email'], description: 'Document type — only when output_destination is document' },
      output_title: { type: 'string', description: 'Title template for a document. Use {{date}} for the run date, {{week_of}} for the week. Example: "AHK Briefing — {{week_of}}"' },
      output_slack_channel: { type: 'string', description: 'Slack channel (#name or id) when output_destination=slack, or "@me" to DM the user privately. For a document, the channel to also drop a link in. Resolve names via slack_list_channels.' },
      output_report_mode: { type: 'string', enum: ['each_run', 'digest', 'silent'], description: 'How proactively you report back after a run. each_run = message the user after every run (default); digest = periodic summary; silent = no report.' },
      output_email_to: { type: 'string', description: 'When output_destination=email: comma-separated recipient address(es) to send the deliverable to (any address — no inbox connection needed). Leave/clear to email the user themselves.' },
      output_email_as_attachment: { type: 'boolean', description: 'When output_destination=email: true to send the deliverable as a Word-document attachment (kept in Documents + Drive) instead of as the email body.' },
      output_email_body_instructions: { type: 'string', description: 'When emailing as an attachment: optional guidance for how the coworker should write the short email body.' },
      output_slack_announcement: { type: 'string', description: 'For a document that also posts to Slack: an INSTRUCTION for how to announce it in the channel — the coworker writes the message from this + the document (e.g. "post a 2-line summary and tag <@Sam> to review"). Leave empty for a simple link.' },
      worker_instructions: { type: 'string', description: 'Task-specific tone or persona instructions that override the worker default for this task only' },
      skill_names: {
        type: 'array',
        items: { type: 'string' },
        description: "Names of skills (from the library — see list_skills) to enforce on this task's output. Pass an empty array to clear pinned skills and fall back to the worker's assigned skills.",
      },
      step_patch: {
        type: 'object',
        description: 'Edit a single step by its id. Read the step ids from get_task, identify the right step from its label and prompt, then patch only what needs to change. Safer than replacing the full steps array.',
        properties: {
          step_id: { type: 'string', description: 'The id field of the step to patch (from get_task output)' },
          label: { type: 'string', description: 'New label for this step' },
          prompt: { type: 'string', description: 'New prompt for ai or agent steps' },
          config: { type: 'object', description: 'New config fields for tool steps — merged into existing config' },
        },
        required: ['step_id'],
      },
      steps: {
        type: 'array',
        description: 'Full replacement steps array. Use only when restructuring the entire pipeline (adding/removing/reordering steps). For editing a single step prompt or config, use step_patch instead.',
        items: { type: 'object' },
      },
    },
    required: ['task_id'],
  },
};

export const runTaskDefinition = {
  name: 'run_task',
  description: 'Trigger an immediate manual run of an existing task. Call when the user asks to run, execute, or trigger a task right now. Use list_tasks to find the task ID first.',
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID of the task to run (use list_tasks to get IDs)' },
    },
    required: ['task_id'],
  },
};

export const duplicateTaskDefinition = {
  name: 'duplicate_task',
  description: 'Duplicate an existing task. Creates a copy with "Copy of" prefix, paused by default. Use when the user wants to create a variant of an existing task — e.g. same pipeline for a different language, audience, or schedule.',
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID of the task to duplicate (use list_tasks to get IDs)' },
      name: { type: 'string', description: 'Name for the duplicate. Defaults to "Copy of [original name]"' },
    },
    required: ['task_id'],
  },
};

export const shareTaskDefinition = {
  name: 'share_task',
  description: "Share one of your tasks with your team (or stop sharing it). Shared tasks appear in teammates' workers under 'From the team' — they can copy them. Call when the user says 'share this task', 'let the team use it', 'make it available', or 'stop sharing'.",
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID of the task to share (use list_tasks to get IDs)' },
      action: { type: 'string', enum: ['share', 'unshare'], description: '"share" makes it visible to the team; "unshare" makes it private again' },
    },
    required: ['task_id', 'action'],
  },
};

export const listTeamTasksDefinition = {
  name: 'list_team_tasks',
  description: "List tasks shared by your teammates that you can copy to your own task list. Call when the user asks what the team has shared, wants to see team tasks, or wants to use a task from a colleague.",
  input_schema: {
    type: 'object',
    properties: {} as Record<string, unknown>,
    required: [] as string[],
  },
};

export const useTaskDefinition = {
  name: 'use_task',
  description: "Copy a shared team task to your own task list. Call after list_team_tasks to get the task ID. Creates a paused copy under this worker that the user can then activate or edit.",
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID of the shared team task to copy (use list_team_tasks to get IDs)' },
    },
    required: ['task_id'],
  },
};

export const deleteTaskDefinition = {
  name: 'delete_task',
  description: 'Permanently delete a task. Call only when the user explicitly asks to delete or remove a task. Irreversible — confirm the task name before proceeding.',
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'ID of the task to delete (use list_tasks to get IDs)' },
    },
    required: ['task_id'],
  },
};

export const listWorkerDocumentsDefinition = {
  name: 'list_worker_documents',
  description: "List documents and reports you've produced from your tasks. Call when the user asks what you've created, wants to see your outputs, or asks about past work. Returns artifact IDs you can pass to get_worker_document.",
  input_schema: {
    type: 'object',
    properties: {} as Record<string, unknown>,
    required: [] as string[],
  },
};

export const getWorkerDocumentDefinition = {
  name: 'get_worker_document',
  description: "Retrieve the full content of a document you've produced and attach it to this conversation. Call when the user asks you to show, share, explain, revise, or work with a specific document. The document appears as a preview chip in the chat.",
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: {
        type: 'string',
        description: 'Artifact ID from list_worker_documents or your document history context',
      },
    },
    required: ['artifact_id'],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSchedule(trigger: { type: string; cron?: string; label?: string }): string {
  if (trigger.type === 'manual') return 'manual trigger only';
  return trigger.label ?? trigger.cron ?? 'scheduled';
}

function formatLastRun(iso: string | null): string {
  if (!iso) return 'never run';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'ran < 1h ago';
  if (h < 24) return `ran ${h}h ago`;
  return `ran ${Math.floor(h / 24)}d ago`;
}

type AdminClient = Record<string, unknown> & {
  from: (table: string) => unknown;
};

// ─── Executors ────────────────────────────────────────────────────────────────

export async function executeListTasks(
  agentId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data, error } = await adminClient
    .from('workflows')
    .select('id, name, status, trigger, last_run_at')
    .eq('agent_id', agentId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) {
    return 'No tasks found for this worker. Use create_task to set one up.';
  }

  const rows = data as Array<{
    id: string;
    name: string;
    status: string;
    trigger: { type: string; cron?: string; label?: string };
    last_run_at: string | null;
  }>;

  const lines = rows.map(t => {
    const dot = t.status === 'active' ? '●' : '○';
    return `${dot} [${t.id}] ${t.name} — ${formatSchedule(t.trigger)} — ${formatLastRun(t.last_run_at)} [${t.status}]`;
  });

  return `Tasks (${rows.length}):\n${lines.join('\n')}\n\nUse task IDs when calling update_task or delete_task.`;
}

export async function executeCreateTask(
  description: string,
  agentId: string,
  userId: string,
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  skillNames?: string[] | string,
): Promise<string> {
  // Fetch worker persona to shape the pipeline's AI step
  const { data: agent } = await adminClient
    .from('custom_agents')
    .select('name, description, instructions')
    .eq('id', agentId)
    .single();

  // Company name for context
  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id, companies(name)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  const companyRaw = (membership as Record<string, unknown> | null)?.companies;
  const companyName = companyRaw
    ? (Array.isArray(companyRaw) ? (companyRaw[0] as { name?: string })?.name : (companyRaw as { name?: string })?.name) ?? null
    : null;

  const generated = await generateWorkflowConfig(description, userId, supabase, {
    companyName,
    workerContext: agent ?? null,
  });

  if (!generated) {
    return 'Could not generate a task from that description. Try being more specific — include what sources to use, what to produce, and when to run it.';
  }

  // Resolve any pinned skill names → ids (omit → task uses the worker's assigned skills)
  const skillIds = skillNames !== undefined
    ? await resolveSkillIdsByName(adminClient, userId, normalizeSkillNames(skillNames))
    : [];

  // THE ONE CREATION CARD (coherence slice #2, Aug 10) — saying prepares, committing stays
  // explicit: create_task no longer inserts. It DRAFTS, and the draft rides a marker the chat
  // runtimes turn into the review card; the user's Confirm fires the ONE create door
  // (POST /api/workflows — where entity adoption and everything else already lives).
  const { encodeWorkflowDraftMarker } = await import('@/lib/workflows/draft-marker');
  const { randomUUID } = await import('crypto');
  const schedule = formatSchedule(generated.trigger as { type: string; cron?: string; label?: string });
  const overlapLine = generated.overlap_note ? `\nOne heads-up: ${generated.overlap_note}` : '';
  // THE UNRESOLVED-PERSON NOTE (processes arc Phase B): a handoff named someone the roster
  // couldn't resolve — say it in the sentence AND ride it on the marker, so the card can speak it.
  const personLine = generated.needs_person_note ? `\n${generated.needs_person_note}` : '';
  const draftPayload: WorkflowDraft & { needs_person_note?: string | null } = {
    name: generated.name,
    description: generated.description ?? null,
    trigger: generated.trigger as { type: string; cron?: string; label?: string; timezone?: string; when?: string },
    steps: generated.steps as Array<{ type: string; label?: string; tool?: string }>,
    output_config: generated.output_config,
    worker_instructions: generated.worker_instructions ?? null,
    overlap_note: generated.overlap_note ?? null,
    needs_person_note: generated.needs_person_note ?? null,
    ...(skillIds.length > 0 ? { skill_ids: skillIds } : {}),
    agent_id: agentId,
    token: randomUUID(),
  };
  const marker = encodeWorkflowDraftMarker(draftPayload);
  return `Here's the plan for **${generated.name}** — ${schedule}. Nothing runs until you confirm on the card.${overlapLine}${personLine}\n${marker}`;
}

export async function executeGetTask(
  taskId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: task } = await adminClient
    .from('workflows')
    .select('id, name, description, status, trigger, steps, output_config, worker_instructions, last_run_at, next_run_at')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) return 'Task not found or you do not have permission to view it.';

  const t = task as {
    id: string; name: string; description: string | null; status: string;
    trigger: WorkflowTrigger; steps: WorkflowStep[]; output_config: OutputConfig;
    worker_instructions: string | null; last_run_at: string | null; next_run_at: string | null;
  };

  const trigger = t.trigger.type === 'manual'
    ? 'manual trigger'
    : `schedule: ${(t.trigger as { label?: string; cron?: string }).label ?? (t.trigger as { cron?: string }).cron ?? 'scheduled'}`;

  const stepsText = (t.steps ?? []).map((s, i) => {
    if (s.type === 'tool') return `  ${i + 1}. [tool] id:${s.id} label:"${s.label}" tool:${s.tool}\n     config: ${JSON.stringify(s.config ?? {})}`;
    if (s.type === 'ai') return `  ${i + 1}. [ai] id:${s.id} label:"${s.label}"\n     prompt: ${s.prompt}`;
    if (s.type === 'agent') return `  ${i + 1}. [agent] id:${s.id} label:"${s.label}" agent_id:${s.agent_id}\n     prompt: ${s.prompt}`;
    return `  ${i + 1}. [unknown]`;
  }).join('\n\n');

  const oc = t.output_config ?? {};
  const norm = normalizeOutput(oc as OutputConfig);
  const outputLines = [
    `  home: ${norm.home}`,
    norm.home === 'document' && oc.artifact_type ? `  document_type: ${oc.artifact_type}` : null,
    oc.title_template ? `  title_template: ${oc.title_template}` : null,
    norm.slackChannel ? `  slack_channel: ${norm.slackChannel}${norm.home === 'document' && norm.linkOut.slack ? ' (link-out)' : ''}` : null,
    norm.linkOut.email ? `  also: emailed` : null,
    `  report: ${norm.reportMode}`,
    norm.outputLanguage ? `  language: ${norm.outputLanguage}` : null,
  ].filter(Boolean).join('\n');

  return [
    `Task: ${t.name} [${t.id}]`,
    t.description ? `Description: ${t.description}` : null,
    `Status: ${t.status}`,
    `Schedule: ${trigger}`,
    `Output:\n${outputLines}`,
    t.worker_instructions ? `Task instructions: ${t.worker_instructions}` : null,
    `Steps (${(t.steps ?? []).length}):\n${stepsText || '  (no steps)'}`,
  ].filter(Boolean).join('\n');
}

export async function executeUpdateTask(
  taskId: string,
  fields: {
    name?: string;
    description?: string;
    status?: 'active' | 'paused';
    trigger?: WorkflowTrigger;
    output_language?: string;
    output_destination?: string;
    output_artifact_type?: string;
    output_title?: string;
    output_slack_channel?: string;
    output_report_mode?: string;
    output_slack_announcement?: string;
    output_email_to?: string;
    output_email_as_attachment?: boolean;
    output_email_body_instructions?: string;
    output_notification?: string;  // legacy alias → report_mode
    worker_instructions?: string;
    skill_names?: string[] | string;
    step_patch?: { step_id: string; label?: string; prompt?: string; config?: Record<string, unknown> };
    steps?: WorkflowStep[];
  },
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: existing } = await adminClient
    .from('workflows')
    .select('name, status, trigger, output_config, steps')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!existing) return 'Task not found or you do not have permission to modify it.';

  const row = existing as { name: string; status: string; trigger: WorkflowTrigger; output_config: OutputConfig; steps: WorkflowStep[] };
  const update: Record<string, unknown> = {};
  const changes: string[] = [];

  if (fields.name !== undefined) { update.name = fields.name; changes.push(`renamed to "${fields.name}"`); }
  if (fields.description !== undefined) { update.description = fields.description; changes.push('description updated'); }
  if (fields.status !== undefined) { update.status = fields.status; changes.push(fields.status === 'active' ? 'resumed' : 'paused'); }
  if (fields.worker_instructions !== undefined) { update.worker_instructions = fields.worker_instructions; changes.push('task instructions updated'); }

  if (fields.skill_names !== undefined) {
    const skillIds = await resolveSkillIdsByName(adminClient, userId, normalizeSkillNames(fields.skill_names));
    update.skill_ids = skillIds;
    changes.push(skillIds.length > 0 ? `skills pinned (${skillIds.length})` : 'skills cleared (using assigned)');
  }

  if (fields.trigger !== undefined) {
    update.trigger = fields.trigger;
    if (fields.trigger.type === 'schedule' && (fields.trigger as { cron?: string }).cron) {
      const d = computeNextRun((fields.trigger as { cron: string }).cron, (fields.trigger as { timezone?: string }).timezone);
      update.next_run_at = d ? d.toISOString() : null;
    } else {
      update.next_run_at = null;
    }
    changes.push('schedule updated');
  }

  // output_config — merge all output fields together in one patch
  const hasOutputChange = fields.output_language !== undefined
    || fields.output_destination !== undefined
    || fields.output_artifact_type !== undefined
    || fields.output_title !== undefined
    || fields.output_slack_channel !== undefined
    || fields.output_report_mode !== undefined
    || fields.output_slack_announcement !== undefined
    || fields.output_email_to !== undefined
    || fields.output_email_as_attachment !== undefined
    || fields.output_email_body_instructions !== undefined
    || fields.output_notification !== undefined;

  if (hasOutputChange) {
    const oc = { ...(row.output_config ?? {}) } as OutputConfig;
    if (fields.output_language !== undefined) { oc.output_language = fields.output_language; changes.push(`language → ${fields.output_language}`); }
    if (fields.output_destination !== undefined) { oc.destination = fields.output_destination as OutputConfig['destination']; changes.push(`home → ${fields.output_destination}`); }
    if (fields.output_artifact_type !== undefined) { oc.artifact_type = fields.output_artifact_type as OutputConfig['artifact_type']; changes.push(`document type → ${fields.output_artifact_type}`); }
    if (fields.output_title !== undefined) { oc.title_template = fields.output_title; changes.push(`title → "${fields.output_title}"`); }
    if (fields.output_slack_channel !== undefined) {
      oc.slack_channel = fields.output_slack_channel;
      // On a document, a channel means "also drop a link there" (link-out, not the home).
      if ((oc.destination ?? '') === 'document') oc.link_out = { ...(oc.link_out ?? {}), slack: true };
      changes.push(`Slack channel → ${fields.output_slack_channel}`);
    }
    if (fields.output_report_mode !== undefined) { oc.report_mode = fields.output_report_mode as OutputConfig['report_mode']; changes.push(`report → ${fields.output_report_mode}`); }
    if (fields.output_email_to !== undefined) {
      oc.email_to = fields.output_email_to.split(',').map(s => s.trim()).filter(Boolean);
      changes.push(oc.email_to.length ? `email recipients → ${oc.email_to.join(', ')}` : 'email recipients cleared (→ you)');
    }
    if (fields.output_email_as_attachment !== undefined) { oc.email_as_attachment = fields.output_email_as_attachment; changes.push(`email delivery → ${fields.output_email_as_attachment ? 'attachment' : 'body'}`); }
    if (fields.output_email_body_instructions !== undefined) { oc.email_body_instructions = fields.output_email_body_instructions; changes.push('email body instructions updated'); }
    if (fields.output_slack_announcement !== undefined) { oc.slack_announcement = fields.output_slack_announcement; changes.push('Slack announcement updated'); }
    // legacy alias
    if (fields.output_notification !== undefined) { oc.report_mode = (fields.output_notification === 'silent' ? 'silent' : 'each_run'); changes.push(`report → ${oc.report_mode}`); }
    update.output_config = oc;
  }

  // step_patch — targeted single-step edit by id
  if (fields.step_patch !== undefined) {
    const { step_id, label, prompt, config } = fields.step_patch;
    const steps = [...(row.steps ?? [])];
    const idx = steps.findIndex(s => s.id === step_id);
    if (idx === -1) return `Step "${step_id}" not found. Call get_task to see current step ids.`;
    const step = { ...steps[idx] } as WorkflowStep & Record<string, unknown>;
    if (label !== undefined) step.label = label;
    if (prompt !== undefined && (step.type === 'ai' || step.type === 'agent')) step.prompt = prompt;
    if (config !== undefined && step.type === 'tool') step.config = { ...(step.config as Record<string, unknown> ?? {}), ...config };
    steps[idx] = step as WorkflowStep;
    update.steps = steps;
    changes.push(`step "${steps[idx].label}" updated`);
  }

  if (fields.steps !== undefined) { update.steps = fields.steps; changes.push('pipeline steps replaced'); }

  if (Object.keys(update).length === 0) return 'Nothing to update — no fields provided.';

  const { error } = await adminClient
    .from('workflows')
    .update(update)
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) return `Failed to update "${row.name}": ${error.message}`;

  return `"${fields.name ?? row.name}" updated — ${changes.join(', ')}.`;
}

export async function executeRunTask(
  taskId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  sourceThreadId?: string,
): Promise<string> {
  const { data: task } = await adminClient
    .from('workflows')
    .select('id, name, steps, status')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) return 'Task not found or you do not have permission to run it.';

  const row = task as { id: string; name: string; steps: unknown[]; status: string };

  if (!row.steps || row.steps.length === 0) {
    return `"${row.name}" has no steps configured yet. Edit it in the Tasks tab first.`;
  }

  // Check for an already-running run
  const { data: existing } = await adminClient
    .from('workflow_runs')
    .select('id')
    .eq('workflow_id', taskId)
    .in('status', ['queued', 'running'])
    .limit(1);

  if (existing && existing.length > 0) {
    return `"${row.name}" is already running. I'll let you know when it finishes.`;
  }

  const { data: run, error: runErr } = await adminClient
    .from('workflow_runs')
    .insert({
      workflow_id: taskId,
      user_id: userId,
      status: 'queued',
      triggered_by: 'manual',
    })
    .select('id')
    .single();

  if (runErr || !run) {
    return `Failed to start "${row.name}": ${runErr?.message ?? 'unknown error'}`;
  }

  const runId = (run as { id: string }).id;

  // Dispatch to the dedicated internal endpoint (its own 800s window via after()) — the
  // chat/AgentOS routes are maxDuration=60, so running inline here gets killed mid-run.
  // We await only the 202 (the endpoint then runs the workflow in the background).
  const base = (process.env.AUGMTD_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  await fetch(`${base}/api/internal/run-workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AGENTOS_SECRET ?? ''}` },
    body: JSON.stringify({ workflowId: taskId, runId, runnerId: userId, sourceThreadId }),
  }).catch(() => {});

  return `"${row.name}" is now running. Results will appear in your inbox when it completes.`;
}

function formatAge(iso: string | null): string {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export async function executeListWorkerDocuments(
  agentId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: workflows } = await adminClient
    .from('workflows')
    .select('id, name')
    .eq('agent_id', agentId)
    .eq('user_id', userId);

  if (!workflows || workflows.length === 0) {
    return 'No tasks found — nothing has been produced yet.';
  }

  const workflowIds = workflows.map((w: { id: string }) => w.id);
  const nameMap: Record<string, string> = Object.fromEntries(
    workflows.map((w: { id: string; name: string }) => [w.id, w.name])
  );

  const { data: threads } = await adminClient
    .from('work_threads')
    .select('id, artifacts, workflow_id, created_at')
    .eq('user_id', userId)
    .in('workflow_id', workflowIds)
    .not('artifacts', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!threads || threads.length === 0) {
    return 'No documents produced yet. Run a task to generate output.';
  }

  type ArtRow = { id?: string; title: string; type: string };
  const docs = (threads as Array<{ id: string; artifacts: ArtRow[] | null; workflow_id: string | null; created_at: string }>)
    .flatMap(t => {
      const arts: ArtRow[] = Array.isArray(t.artifacts) ? t.artifacts : [];
      return arts.filter(a => a.id).map(a => ({
        artifactId: a.id!,
        title: a.title,
        type: a.type,
        taskName: t.workflow_id ? (nameMap[t.workflow_id] ?? 'Task') : 'Task',
        threadId: t.id,
        age: formatAge(t.created_at),
      }));
    });

  if (docs.length === 0) return 'No documents produced yet.';

  const lines = docs.slice(0, 20).map(d =>
    `- "${d.title}" · ${d.taskName} · ${d.age} · artifact_id: ${d.artifactId}`
  );

  return `Your documents (${docs.length} total):\n${lines.join('\n')}\n\nCall get_worker_document with an artifact_id to retrieve and show the full content.`;
}

export async function executeGetWorkerDocument(
  artifactId: string,
  agentId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<{ content: string; artifact: { id: string; title: string; type: string; generated_at: string; storage_path?: string } | null }> {
  const { data: workflows } = await adminClient
    .from('workflows')
    .select('id')
    .eq('agent_id', agentId)
    .eq('user_id', userId);

  const workflowIds = (workflows ?? []).map((w: { id: string }) => w.id);

  // Search across all threads for this agent — includes run_task output threads
  const { data: threads } = await adminClient
    .from('work_threads')
    .select('id, artifacts, workflow_id')
    .eq('user_id', userId)
    .in('workflow_id', workflowIds.length > 0 ? workflowIds : ['__none__'])
    .not('artifacts', 'is', null);

  type ArtRow = { id?: string; title: string; type: string; generated_at?: string; storage_path?: string; content?: unknown };
  for (const t of (threads ?? []) as Array<{ id: string; artifacts: ArtRow[] | null }>) {
    const arts: ArtRow[] = Array.isArray(t.artifacts) ? t.artifacts : [];
    const found = arts.find(a => a.id === artifactId);
    if (!found) continue;

    let textContent = '';
    if (found.type === 'document' && found.content) {
      const doc = found.content as { title: string; subtitle?: string; sections: Array<{ heading: string; paragraphs: string[] }> };
      const lines = [doc.title];
      if (doc.subtitle) lines.push(doc.subtitle);
      for (const s of doc.sections ?? []) {
        lines.push(`\n## ${s.heading}`);
        for (const p of s.paragraphs ?? []) lines.push(p);
      }
      textContent = lines.join('\n\n');
    } else if (found.type === 'email' && found.content) {
      const ec = found.content as { subject: string; body: string; to?: string };
      textContent = `Subject: ${ec.subject}${ec.to ? `\nTo: ${ec.to}` : ''}\n\n${ec.body}`;
    } else {
      textContent = `${found.title} (${found.type}) — binary file, cannot preview text`;
    }

    const MAX = 10000;
    const truncated = textContent.length > MAX
      ? textContent.slice(0, MAX) + '\n\n[...document truncated for context...]'
      : textContent;

    return {
      content: `DOCUMENT: "${found.title}"\n${'─'.repeat(40)}\n${truncated}`,
      artifact: {
        id: found.id!,
        title: found.title,
        type: found.type,
        generated_at: found.generated_at ?? new Date().toISOString(),
        storage_path: found.storage_path,
      },
    };
  }

  return { content: `Document with artifact_id "${artifactId}" not found. Call list_worker_documents to see available documents.`, artifact: null };
}

export async function executeDuplicateTask(
  taskId: string,
  agentId: string,
  userId: string,
  newName: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: src } = await adminClient
    .from('workflows')
    .select('name, description, icon, color, trigger, steps, output_config, worker_instructions')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!src) return 'Task not found or you do not have permission to duplicate it.';

  const row = src as { name: string; description: string | null; icon: string; color: string; trigger: WorkflowTrigger; steps: WorkflowStep[]; output_config: OutputConfig; worker_instructions: string | null };

  let nextRunAt: string | null = null;
  const trigger = row.trigger as { type: string; cron?: string; timezone?: string };
  if (trigger.type === 'schedule' && trigger.cron) {
    const d = computeNextRun(trigger.cron, trigger.timezone);
    if (d) nextRunAt = d.toISOString();
  }

  const { data: copy, error } = await adminClient
    .from('workflows')
    .insert({
      user_id: userId,
      agent_id: agentId,
      name: newName ?? `Copy of ${row.name}`,
      description: row.description,
      icon: row.icon,
      color: row.color,
      trigger: row.trigger,
      steps: row.steps,
      output_config: row.output_config,
      worker_instructions: row.worker_instructions,
      status: 'paused',
      next_run_at: nextRunAt,
    })
    .select('id, name')
    .single();

  if (error || !copy) return `Failed to duplicate "${row.name}": ${error?.message ?? 'unknown error'}`;

  const c = copy as { id: string; name: string };
  return `Duplicated as **"${c.name}"** (ID: ${c.id}) — paused. Tell me what to change and I'll update it right away.`;
}

export async function executeShareTask(
  taskId: string,
  action: 'share' | 'unshare',
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: task } = await adminClient
    .from('workflows')
    .select('name')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) return 'Task not found or you do not own this task.';
  const name = (task as { name: string }).name;

  if (action === 'share') {
    const { data: membership } = await adminClient
      .from('company_members')
      .select('company_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!membership?.company_id) {
      return 'You are not part of a company workspace. Task sharing requires a team account.';
    }

    const { error } = await adminClient
      .from('workflows')
      .update({ sharing_mode: 'live', company_id: membership.company_id, shared_with_company: true })
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) return `Failed to share "${name}": ${error.message}`;
    return `"${name}" is now shared with your team. They can find it in their Tasks tab under "From the team" and copy it to their workers.`;
  } else {
    const { error } = await adminClient
      .from('workflows')
      .update({ sharing_mode: null, shared_with_company: false })
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) return `Failed to unshare "${name}": ${error.message}`;
    return `"${name}" is now private. It will no longer appear for teammates.`;
  }
}

export async function executeListTeamTasks(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: membership } = await adminClient
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!membership?.company_id) {
    return 'You are not part of a company workspace. Team task sharing requires a team account.';
  }

  const { data, error } = await adminClient
    .from('workflows')
    .select('id, name, trigger, user_id')
    .eq('sharing_mode', 'live')
    .eq('company_id', membership.company_id)
    .neq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) {
    return 'No team tasks are shared yet. Teammates can share their own tasks with the team from the Tasks tab (three-dot menu → Share with team).';
  }

  const userIds = [...new Set((data as Array<{ user_id: string }>).map(t => t.user_id))];
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);
  const nameMap: Record<string, string> = {};
  (profiles ?? []).forEach((p: { id: string; full_name: string | null }) => {
    nameMap[p.id] = p.full_name ?? 'Teammate';
  });

  const rows = data as Array<{ id: string; name: string; trigger: { type: string; label?: string; cron?: string }; user_id: string }>;
  const lines = rows.map(t => {
    const schedule = t.trigger.label ?? (t.trigger.type === 'schedule' ? (t.trigger.cron ?? 'scheduled') : 'manual');
    return `- [${t.id}] ${t.name} — ${schedule} — shared by ${nameMap[t.user_id] ?? 'Teammate'}`;
  });

  return `Team tasks (${rows.length}):\n${lines.join('\n')}\n\nCall use_task with a task ID to copy it to your own list.`;
}

export async function executeUseTask(
  sourceTaskId: string,
  agentId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { forkTaskForWorker } = await import('@/lib/workflows/clone-workflow');

  let clonedId: string;
  try {
    clonedId = await forkTaskForWorker(adminClient, sourceTaskId, userId, agentId);
  } catch (err) {
    return `Could not use task: ${(err as Error).message}`;
  }

  const { data: copy } = await adminClient
    .from('workflows')
    .select('name')
    .eq('id', clonedId)
    .single();

  const name = (copy as { name: string } | null)?.name ?? 'task';
  return `Added **"${name}"** to your tasks (ID: ${clonedId}) — paused. Tell me what to adjust or say "resume" to activate it.`;
}

export async function executeDeleteTask(
  taskId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: task } = await adminClient
    .from('workflows')
    .select('name')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) return 'Task not found or you do not have permission to delete it.';

  const { error } = await adminClient
    .from('workflows')
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) return `Failed to delete task: ${error.message}`;

  return `"${(task as { name: string }).name}" has been permanently deleted.`;
}
