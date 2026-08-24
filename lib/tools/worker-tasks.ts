import { generateWorkflowConfig } from '@/lib/workflows/generate-config';
import { computeNextRun } from '@/lib/workflows/schedule';
import { resolveSkillIdsByName, normalizeSkillNames } from '@/lib/tools/worker-skills';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkflowStep, OutputConfig, WorkflowTrigger } from '@/lib/workflows/types';
import { normalizeOutput } from '@/lib/workflows/types';
import type { WorkflowDraft } from '@/lib/workflows/draft-marker';
import {
  authorDoors, doorCatalogueOneLine, doorNote, doorsForStorage, describeDoors,
  authorInputs, inputNote, inputsForStorage, describeInputs,
} from '@/lib/workflows/author-doors';
import { readWorkflowInputs, writeWorkflowInputs, type WorkflowInputs } from '@/lib/workflows/inputs';
import {
  clampFireLimit, fireLimitClampNote, readFireLimit, writeFireLimit,
  FIRE_LIMIT_MIN, FIRE_LIMIT_MAX, FIRE_LIMIT_DEFAULT,
} from '@/lib/workflows/fire-limit';
import { normalizeTriggers, doorLabel, type ReactionDoor } from '@/lib/workflows/trigger-sources';

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
      trigger_doors: {
        type: 'array',
        description: `Optional. The EVENT DOORS — the ways this task can start besides its schedule. One entry per distinct way ("when applications arrive by email OR someone uploads a CV" = two doors). Available sources: ${doorCatalogueOneLine()}. Never put a schedule here (timing goes in the description; a task holds only one).`,
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['mail', 'file', 'meeting', 'workflow'], description: 'Which door.' },
            when: { type: 'string', description: 'For mail/file/meeting: the condition in plain words, judged against each arriving event.' },
            workflow_name: { type: 'string', description: 'For source "workflow": the NAME of an existing task that should feed this one (never an id — the system resolves the name).' },
            label: { type: 'string', description: 'Optional short human rendering of the door.' },
          },
          required: ['source'],
        },
      },
      input_doc_names: {
        type: 'array',
        items: { type: 'string' },
        description: "Optional. The INPUTS TRAY — names of documents in the user's knowledge base this task should read as STANDING reference on every run (a policy, template, rubric, brand guide). Give the NAME as the user says it — never an id; the system resolves it and says so if it can't find one. Omit when nothing is pinned.",
      },
      input_accept_material: {
        type: 'boolean',
        description: 'Optional. True when the work is done ON something handed over at run time ("when I upload a CV", "paste the transcript and…") — it opens a material box on Run-now. Standing reference documents go in input_doc_names instead.',
      },
      daily_run_limit: {
        type: 'number',
        description: `Optional. THE THROTTLE — how many EVENT RUNS a day this task may start (${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX}; default ${FIRE_LIMIT_DEFAULT}). Set it only when the user states a pace ("at most 3 a day"). Extra events queue — they wait for the next day, nothing is ever dropped. Out-of-range numbers are kept within ${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX} and said out loud.`,
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
      add_trigger_doors: {
        type: 'array',
        description: `ADD event doors — the ways this task can start besides its schedule. ADDITIVE: doors already on the task are kept, so "also run it when a file lands" adds one door and touches nothing else. Available sources: ${doorCatalogueOneLine()}. Never put a schedule here — use "trigger" for timing (a task holds only one schedule).`,
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['mail', 'file', 'meeting', 'workflow'], description: 'Which door.' },
            when: { type: 'string', description: 'For mail/file/meeting: the condition in plain words, judged against each arriving event.' },
            workflow_name: { type: 'string', description: 'For source "workflow": the NAME of an existing task that should feed this one (never an id).' },
            label: { type: 'string', description: 'Optional short human rendering of the door.' },
          },
          required: ['source'],
        },
      },
      remove_trigger_doors: {
        type: 'array',
        items: { type: 'string' },
        description: `REMOVE event doors. Each entry is either a source key (${doorCatalogueOneLine()}) — which removes every door of that kind — or text matching the door's condition or label as get_task shows it. Doors you don't name are kept.`,
      },
      add_input_docs: {
        type: 'array',
        items: { type: 'string' },
        description: "ADD documents to the INPUTS TRAY — the standing reference this task reads on every run. ADDITIVE: documents already pinned are kept, so \"also use the brand guide\" pins one and touches nothing else. Give NAMES as the user says them (never ids); the system resolves them against their knowledge base and says so if it can't find one.",
      },
      remove_input_docs: {
        type: 'array',
        items: { type: 'string' },
        description: 'REMOVE documents from the inputs tray. Each entry is text matching a pinned document name as get_task shows it. Documents you don\'t name are kept.',
      },
      input_accept_material: {
        type: 'boolean',
        description: 'Whether the task accepts material handed over at run time (a CV, a transcript, a draft) — it opens a material box on Run-now. Standing reference documents go in add_input_docs instead.',
      },
      daily_run_limit: {
        type: 'number',
        description: `THE THROTTLE — how many EVENT RUNS a day this task may start (${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX}; default ${FIRE_LIMIT_DEFAULT}). Use it when the user asks for a different pace ("keep it to 5 a day", "let it run more"). Extra events queue — they wait for the next day, nothing is ever dropped. Out-of-range numbers are kept within ${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX} and said out loud.`,
      },
      output_language: { type: 'string', description: 'BCP-47 language code for output. Examples: "de" (German), "pt" (Portuguese), "fr" (French), "es" (Spanish)' },
      output_destination: { type: 'string', enum: ['message', 'document', 'slack', 'email'], description: "The deliverable's single home. message = a message in the run thread; document = a saved document in Documents/Drive; slack = posted to a Slack channel; email = emailed. The app always keeps a record regardless." },
      output_artifact_type: { type: 'string', enum: ['document', 'spreadsheet', 'presentation', 'email', 'frame'], description: 'Document type — only when output_destination is document. frame = a live interactive dashboard that updates in place with every run (versions kept).' },
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

/** THE DEFENSIVE DOOR READ (relay canvas W1): `workflows.triggers` is additive and may be absent
 *  in an environment where the migration hasn't been applied — a select naming a missing column
 *  errors (42703) and PostgREST hands back data:null, so the read must be its own try/catch and
 *  must SAY whether the column exists. `null` = no column (never "no doors"). */
async function readDoorsRaw(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any, taskId: string, userId: string,
): Promise<{ ok: boolean; triggers: unknown }> {
  try {
    const { data, error } = await adminClient
      .from('workflows').select('triggers').eq('id', taskId).eq('user_id', userId).single();
    if (error || !data) return { ok: false, triggers: null };
    return { ok: true, triggers: (data as { triggers?: unknown }).triggers ?? null };
  } catch {
    return { ok: false, triggers: null };
  }
}

/** The normalized doors of one task (legacy `trigger` reaction folds in, per THE ONE READER). */
async function readDoors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any, taskId: string, userId: string, trigger: unknown,
): Promise<ReactionDoor[]> {
  const raw = await readDoorsRaw(adminClient, taskId, userId);
  return normalizeTriggers({ trigger, triggers: raw.triggers }).doors;
}

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
  /** THE EVENT DOORS said out loud (relay canvas W1, law 1) — sanitised here, merged with any the
   *  generator authored from the description itself. */
  triggerDoors?: unknown,
  /** THE INPUTS TRAY said out loud (relay canvas W2, law 7) — same shape of merge: spoken document
   *  names ride the SAME resolver the generator used, on top of what the description pinned. */
  inputDocNames?: unknown,
  inputAcceptMaterial?: boolean,
  /** THE THROTTLE said out loud (relay canvas W3b) — clamped here, and the correction is SPOKEN.
   *  It overrides whatever pace the description itself authored (the user's explicit number wins). */
  dailyRunLimit?: unknown,
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
  // THE SPOKEN DOORS: whatever the coworker said explicitly rides the SAME sanitiser the generator
  // used, merged onto the doors the description itself authored (dedupe lives in the sanitiser).
  let doors: ReactionDoor[] = generated.triggers ?? [];
  let doorNoteLine: string | null = generated.needs_door_note ?? null;
  if (triggerDoors !== undefined) {
    try {
      const authored = await authorDoors(triggerDoors, { supabase, userId, existing: doors });
      doors = authored.doors;
      doorNoteLine = doorNote([...(doorNoteLine ? [doorNoteLine] : []), ...authored.notes]);
    } catch { /* the draft stands with the generator's doors */ }
  }

  // THE SPOKEN INPUTS: the tray the description authored, plus whatever the coworker named out
  // loud — one resolver, one merge (dedupe by file id lives in authorInputs).
  let inputs = generated.inputs ?? null;
  let inputNoteLine: string | null = generated.needs_input_note ?? null;
  if (inputDocNames !== undefined || inputAcceptMaterial !== undefined) {
    try {
      const authored = await authorInputs(
        { doc_names: inputDocNames, accept_material: inputAcceptMaterial },
        { supabase, userId, existing: inputs?.docs ?? [], acceptMaterialDefault: inputs?.acceptMaterial ?? false },
      );
      inputs = inputsForStorage(authored);
      inputNoteLine = inputNote([...(inputNoteLine ? [inputNoteLine] : []), ...authored.notes]);
    } catch { /* the draft stands with the generator's tray */ }
  }

  // THE SPOKEN THROTTLE: an explicit number from the coworker's own argument outranks the pace the
  // description authored; both ride the ONE clamp, and a moved number is SAID (never silently
  // accepted as given). Unsaid = null = the platform default, which is not config at all.
  let fireLimit: number | null = generated.fire_limit ?? null;
  if (dailyRunLimit !== undefined && dailyRunLimit !== null && dailyRunLimit !== '') {
    const { value, clamped } = clampFireLimit(dailyRunLimit);
    fireLimit = value;
    if (clamped) {
      doorNoteLine = doorNote([
        ...(doorNoteLine ? [doorNoteLine] : []),
        fireLimitClampNote(dailyRunLimit, value),
      ]);
    }
  }

  const { encodeWorkflowDraftMarker } = await import('@/lib/workflows/draft-marker');
  const { randomUUID } = await import('crypto');
  const schedule = formatSchedule(generated.trigger as { type: string; cron?: string; label?: string });
  const overlapLine = generated.overlap_note ? `\nOne heads-up: ${generated.overlap_note}` : '';
  // THE UNRESOLVED-PERSON NOTE (processes arc Phase B): a handoff named someone the roster
  // couldn't resolve — say it in the sentence AND ride it on the marker, so the card can speak it.
  const personLine = generated.needs_person_note ? `\n${generated.needs_person_note}` : '';
  // THE DROPPED-DOOR NOTE rides the same way (a refused door is stated, never silently lost).
  const doorNoteText = doorNoteLine ? `\n${doorNoteLine}` : '';
  const doorLine = doors.length ? ` Doors: ${describeDoors(doors)}.` : '';
  // THE INPUTS TRAY speaks the same way — what it reads, and what it couldn't find.
  const inputNoteText = inputNoteLine ? `\n${inputNoteLine}` : '';
  const inputLine = inputs ? ` Reads: ${describeInputs(inputs)}.` : '';
  // THE UNRESOLVED-PROCESS NOTE rides the same way (W3): a refused subprocess station is stated.
  const stepNoteText = generated.needs_step_note ? `\n${generated.needs_step_note}` : '';
  // THE THROTTLE speaks only when it isn't the default — a stated pace is a claim to confirm;
  // the platform default is not news.
  const limitLine = fireLimit !== null && fireLimit !== FIRE_LIMIT_DEFAULT
    ? ` Up to ${fireLimit} event runs a day — extra ones wait for tomorrow.`
    : '';
  const draftPayload: WorkflowDraft & {
    needs_person_note?: string | null;
    triggers?: ReactionDoor[];
    needs_door_note?: string | null;
    inputs?: WorkflowInputs | null;
    needs_input_note?: string | null;
    needs_step_note?: string | null;
    fire_limit?: number | null;
  } = {
    name: generated.name,
    description: generated.description ?? null,
    trigger: generated.trigger as { type: string; cron?: string; label?: string; timezone?: string; when?: string },
    steps: generated.steps as Array<{ type: string; label?: string; tool?: string }>,
    output_config: generated.output_config,
    worker_instructions: generated.worker_instructions ?? null,
    overlap_note: generated.overlap_note ?? null,
    needs_person_note: generated.needs_person_note ?? null,
    ...(doors.length ? { triggers: doors } : {}),
    needs_door_note: doorNoteLine,
    ...(inputs ? { inputs } : {}),
    needs_input_note: inputNoteLine,
    needs_step_note: generated.needs_step_note ?? null,
    ...(fireLimit !== null ? { fire_limit: fireLimit } : {}),
    ...(skillIds.length > 0 ? { skill_ids: skillIds } : {}),
    agent_id: agentId,
    token: randomUUID(),
  };
  const marker = encodeWorkflowDraftMarker(draftPayload);
  return `Here's the plan for **${generated.name}** — ${schedule}.${doorLine}${inputLine}${limitLine} Nothing runs until you confirm on the card.${overlapLine}${personLine}${doorNoteText}${inputNoteText}${stepNoteText}\n${marker}`;
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

  // THE EVENT DOORS, read defensively — the `triggers` column is additive and may not exist yet
  // (a select naming a missing column returns data:null, the silent-column trap). No column →
  // the legacy fold still speaks whatever `trigger` carries.
  const doors = await readDoors(adminClient, taskId, userId, t.trigger);
  // THE INPUTS TRAY (relay canvas W2) — its own store; `null` means never configured, and the
  // line says "none" rather than pretending the tray doesn't exist as a thing to configure.
  const inputs = await readWorkflowInputs(adminClient as SupabaseClient, userId, taskId);
  // THE THROTTLE (relay canvas W3b) — its own store; absent means the platform default, and the
  // line SAYS "(default)" so the model never reads a default as a number somebody chose.
  const fireLimit = await readFireLimit(adminClient as SupabaseClient, userId, taskId);

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
    `Event doors: ${describeDoors(doors)}`,
    `Inputs: ${describeInputs(inputs)}`,
    `Daily event limit: ${fireLimit.dailyFires}${fireLimit.isDefault ? ' (default)' : ''} — extra events wait for the next day`,
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
    /** ADDITIVE door verbs (relay canvas W1) — never a full replace: a coworker saying "also run it
     *  when a file lands" must not clobber the doors it never mentioned. */
    add_trigger_doors?: unknown;
    remove_trigger_doors?: string[] | string;
    /** ADDITIVE inputs-tray verbs (relay canvas W2) — same law as the doors: "also read the brand
     *  guide" pins one document and leaves the rest of the tray alone. */
    add_input_docs?: unknown;
    remove_input_docs?: string[] | string;
    input_accept_material?: boolean;
    /** THE THROTTLE (relay canvas W3b) — event runs a day; its own store, clamped at the write. */
    daily_run_limit?: unknown;
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

  // ── THE EVENT DOORS, ADDITIVELY (relay canvas W1, law 1) ─────────────────────────────────────
  // add/remove verbs, never a full replace — a door the coworker didn't mention survives. The ONE
  // sanitiser decides what may be stored; storage mirrors the workflows PATCH (normalized, or NULL
  // when empty, so `triggers is not null` stays a real discovery filter).
  let doorNoteLine: string | null = null;
  if (fields.add_trigger_doors !== undefined || fields.remove_trigger_doors !== undefined) {
    const raw = await readDoorsRaw(adminClient, taskId, userId);
    if (!raw.ok) {
      return `I can't change how "${row.name}" starts yet — event doors aren't available in this workspace. Its schedule and steps are untouched.`;
    }
    // THE LEGACY FOLD is preserved on write: a pre-W1 reaction trigger reads as a mail door, and
    // storing the normalized list keeps it (the destroyer-bug floor — an edit never eats a trigger).
    let doors = normalizeTriggers({ trigger: row.trigger, triggers: raw.triggers }).doors;

    const removals = (Array.isArray(fields.remove_trigger_doors)
      ? fields.remove_trigger_doors
      : typeof fields.remove_trigger_doors === 'string' ? [fields.remove_trigger_doors] : [])
      .map(s => String(s ?? '').trim().toLowerCase()).filter(Boolean);
    if (removals.length) {
      const before = doors.length;
      doors = doors.filter(d => !removals.some(r =>
        r === d.source
        || doorLabel(d).toLowerCase().includes(r)
        || (d.when ?? '').toLowerCase().includes(r)));
      const gone = before - doors.length;
      if (gone > 0) changes.push(`${gone} door${gone !== 1 ? 's' : ''} removed`);
      else doorNoteLine = "I couldn't find a door matching that — nothing was removed.";
    }

    if (fields.add_trigger_doors !== undefined) {
      const beforeAdd = doors.length;
      const authored = await authorDoors(fields.add_trigger_doors, {
        supabase: adminClient as SupabaseClient,
        userId,
        existing: doors,
        selfWorkflowId: taskId,
      });
      doors = authored.doors;
      const added = doors.length - beforeAdd;
      if (added > 0) changes.push(`${added} door${added !== 1 ? 's' : ''} added`);
      doorNoteLine = doorNote([...(doorNoteLine ? [doorNoteLine] : []), ...authored.notes]);
    }

    update.triggers = doorsForStorage(doors);
    if (!changes.some(c => c.includes('door'))) changes.push(`doors: ${describeDoors(doors)}`);
  }

  // ── THE INPUTS TRAY, ADDITIVELY (relay canvas W2, law 7) ─────────────────────────────────────
  // add/remove verbs on the SAME additive law as the doors. The tray is its own store, so the
  // resolution happens here and the WRITE waits until the row update has succeeded (the [id] PATCH
  // precedent) — a failed row edit must not leave the tray describing a workflow that didn't change.
  let inputNoteLine: string | null = null;
  let pendingInputs: WorkflowInputs | null | undefined;
  if (fields.add_input_docs !== undefined || fields.remove_input_docs !== undefined || fields.input_accept_material !== undefined) {
    const current = await readWorkflowInputs(adminClient as SupabaseClient, userId, taskId);
    let docs = current?.docs ?? [];

    const removals = (Array.isArray(fields.remove_input_docs)
      ? fields.remove_input_docs
      : typeof fields.remove_input_docs === 'string' ? [fields.remove_input_docs] : [])
      .map(s => String(s ?? '').trim().toLowerCase()).filter(Boolean);
    if (removals.length) {
      const before = docs.length;
      docs = docs.filter(d => !removals.some(r => d.name.toLowerCase().includes(r) || r.includes(d.name.toLowerCase())));
      const gone = before - docs.length;
      if (gone > 0) changes.push(`${gone} document${gone !== 1 ? 's' : ''} unpinned`);
      else inputNoteLine = "I couldn't find a pinned document matching that — nothing was unpinned.";
    }

    const authored = await authorInputs(
      { doc_names: fields.add_input_docs, accept_material: fields.input_accept_material },
      { supabase: adminClient as SupabaseClient, userId, existing: docs, acceptMaterialDefault: current?.acceptMaterial ?? false },
    );
    const added = authored.docs.length - docs.length;
    if (added > 0) changes.push(`${added} document${added !== 1 ? 's' : ''} pinned`);
    if (fields.input_accept_material !== undefined && authored.acceptMaterial !== (current?.acceptMaterial ?? false)) {
      changes.push(authored.acceptMaterial ? 'accepts material at run time' : 'no longer accepts run-time material');
    }
    inputNoteLine = inputNote([...(inputNoteLine ? [inputNoteLine] : []), ...authored.notes]);
    pendingInputs = inputsForStorage(authored);
    if (!changes.some(c => /document|material/.test(c))) changes.push(`inputs: ${describeInputs(pendingInputs)}`);
  }

  // ── THE THROTTLE (relay canvas W3b) ─────────────────────────────────────────────────────────
  // Its own store (item_plans kind 'workflow_limit'), so it resolves here and LANDS after the row
  // update succeeds — the tray's precedent. Out of range CLAMPS and is SAID; unsaid touches nothing.
  let limitNoteLine: string | null = null;
  let pendingLimit: number | undefined;
  if (fields.daily_run_limit !== undefined && fields.daily_run_limit !== null && fields.daily_run_limit !== '') {
    const { value, clamped } = clampFireLimit(fields.daily_run_limit);
    pendingLimit = value;
    if (clamped) limitNoteLine = fireLimitClampNote(fields.daily_run_limit, value);
    changes.push(`up to ${value} event runs a day${value === FIRE_LIMIT_DEFAULT ? ' (the default)' : ''}`);
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

  if (Object.keys(update).length === 0 && pendingInputs === undefined && pendingLimit === undefined) {
    return 'Nothing to update — no fields provided.';
  }

  if (Object.keys(update).length > 0) {
    const { error } = await adminClient
      .from('workflows')
      .update(update)
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) return `Failed to update "${row.name}": ${error.message}`;
  }

  // THE TRAY lands after the row (its own store; ownership was proven by the load above). A store
  // failure is SAID — the tray is never silently unchanged while the sentence claims it moved.
  if (pendingInputs !== undefined) {
    const res = await writeWorkflowInputs(adminClient as SupabaseClient, userId, taskId, pendingInputs ?? { docs: [], acceptMaterial: false });
    if (!res.ok) inputNoteLine = inputNote([...(inputNoteLine ? [inputNoteLine] : []), `I couldn't save the inputs — ${res.error}.`]);
  }

  // THE THROTTLE lands the same way — after the row, through the ENGINE'S OWN WRITE (never a second
  // writer), and a store failure is SAID rather than left as a sentence claiming a pace that isn't.
  if (pendingLimit !== undefined) {
    const res = await writeFireLimit(adminClient as SupabaseClient, userId, taskId, pendingLimit);
    if (!res.ok) {
      limitNoteLine = [limitNoteLine, `I couldn't save the daily limit — ${res.error}.`].filter(Boolean).join(' ');
    }
  }

  const notesTail = [doorNoteLine, inputNoteLine, limitNoteLine].filter(Boolean).join(' ');
  return `"${fields.name ?? row.name}" updated — ${changes.join(', ')}.${notesTail ? ` ${notesTail}` : ''}`;
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
