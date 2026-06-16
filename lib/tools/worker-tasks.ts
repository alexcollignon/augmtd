import { generateWorkflowConfig } from '@/lib/workflows/generate-config';
import { computeNextRun } from '@/lib/workflows/schedule';
import { runWorkflow } from '@/lib/workflows/run-workflow';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkflowStep, OutputConfig, WorkflowTrigger } from '@/lib/workflows/types';

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
  description: "Edit any aspect of an existing task in response to user feedback. Use for: renaming, changing schedule, output language, task instructions (tone/persona), status (pause/resume), or updating step prompts when the user gives content/style feedback. Always call get_task first to read the current config. Act immediately — do not ask the user to confirm first.",
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
      worker_instructions: { type: 'string', description: 'Task-specific tone or persona instructions that override the worker default for this task only' },
      steps: {
        type: 'array',
        description: 'Full replacement steps array. Only use when adjusting step prompts in response to content/style feedback. Pass the complete steps array from get_task with the relevant prompts changed.',
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

  // Compute next_run_at for scheduled triggers
  let nextRunAt: string | null = null;
  const trigger = generated.trigger as { type: string; cron?: string; timezone?: string };
  if (trigger.type === 'schedule' && trigger.cron) {
    const d = computeNextRun(trigger.cron, trigger.timezone);
    if (d) nextRunAt = d.toISOString();
  }

  const { data: workflow, error } = await adminClient
    .from('workflows')
    .insert({
      user_id: userId,
      company_id: (membership as { company_id?: string } | null)?.company_id ?? null,
      agent_id: agentId,
      name: generated.name,
      description: generated.description,
      icon: 'bolt',
      color: 'indigo',
      status: 'active',
      trigger: generated.trigger,
      steps: generated.steps,
      output_config: generated.output_config,
      next_run_at: nextRunAt,
    })
    .select('id, name, trigger')
    .single();

  if (error || !workflow) {
    return 'Task pipeline was generated but could not be saved. Please try again.';
  }

  const row = workflow as { id: string; name: string; trigger: { type: string; cron?: string; label?: string } };
  const schedule = formatSchedule(row.trigger);
  return `Task created: **${row.name}** — ${schedule}\nID: ${row.id}\n\nI've built a full pipeline for this. It'll run automatically on schedule and deliver results to your inbox. You can edit the steps anytime in the Tasks tab → Advanced settings.`;
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
    if (s.type === 'tool') return `  ${i + 1}. [tool] ${s.label} — ${s.tool}`;
    if (s.type === 'ai') return `  ${i + 1}. [ai] ${s.label}\n     prompt: ${s.prompt.slice(0, 200)}${s.prompt.length > 200 ? '…' : ''}`;
    if (s.type === 'agent') return `  ${i + 1}. [agent] ${s.label} — agent_id: ${s.agent_id}`;
    return `  ${i + 1}. [unknown]`;
  }).join('\n');

  const oc = t.output_config ?? {};
  const outputInfo = [
    `destination: ${oc.destination ?? 'thread_message'}`,
    oc.output_language ? `language: ${oc.output_language}` : null,
    oc.title_template ? `title: ${oc.title_template}` : null,
  ].filter(Boolean).join(', ');

  return [
    `Task: ${t.name} [${t.id}]`,
    t.description ? `Description: ${t.description}` : null,
    `Status: ${t.status}`,
    `Schedule: ${trigger}`,
    `Output: ${outputInfo}`,
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
    worker_instructions?: string;
    steps?: WorkflowStep[];
  },
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const { data: existing } = await adminClient
    .from('workflows')
    .select('name, status, trigger, output_config')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!existing) return 'Task not found or you do not have permission to modify it.';

  const row = existing as { name: string; status: string; trigger: WorkflowTrigger; output_config: OutputConfig };
  const update: Record<string, unknown> = {};
  const changes: string[] = [];

  if (fields.name !== undefined) { update.name = fields.name; changes.push(`renamed to "${fields.name}"`); }
  if (fields.description !== undefined) { update.description = fields.description; changes.push('description updated'); }
  if (fields.status !== undefined) { update.status = fields.status; changes.push(fields.status === 'active' ? 'resumed' : 'paused'); }
  if (fields.steps !== undefined) { update.steps = fields.steps; changes.push('steps updated'); }
  if (fields.worker_instructions !== undefined) { update.worker_instructions = fields.worker_instructions; changes.push('task instructions updated'); }

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

  if (fields.output_language !== undefined) {
    update.output_config = { ...(row.output_config ?? {}), output_language: fields.output_language };
    changes.push(`output language set to ${fields.output_language}`);
  }

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

  // Fire-and-forget — results post back into sourceThreadId when done
  void runWorkflow({ workflowId: taskId, runId, triggerSource: 'manual', runnerId: userId, sourceThreadId });

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
