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
  // THE ONE NAME LADDER (Sep 21) — the bulk status deed and the chief's by-name doors resolve
  // through the SAME resolver the door authoring uses: exact → unique containment → refusal.
  matchWorkflowName,
} from '@/lib/workflows/author-doors';
import { readWorkflowInputs, writeWorkflowInputs, type WorkflowInputs } from '@/lib/workflows/inputs';
import {
  clampFireLimit, fireLimitClampNote, readFireLimit, writeFireLimit,
  FIRE_LIMIT_MIN, FIRE_LIMIT_MAX, FIRE_LIMIT_DEFAULT,
} from '@/lib/workflows/fire-limit';
import { normalizeTriggers, doorLabel, TRIGGER_SOURCES, type ReactionDoor } from '@/lib/workflows/trigger-sources';

// ── THE DOOR FILTERS, TAUGHT FROM THE REGISTRY (relay canvas W5, law 3) ─────────────────────────
// The chat tools and generate-config are the two authoring doors; both learn the FIELD VOCABULARY
// from `filterFields`, so neither can offer a field the sanitiser would then drop. Compact form —
// an argument description is a sentence, not a catalogue page.
const FILTER_VOCAB = TRIGGER_SOURCES
  .filter((s) => (s.filterFields?.length ?? 0) > 0)
  .map((s) => `${s.key}: ${s.filterFields!.map((f) => `${f.key} (${f.ops.join('/')})`).join(', ')}`)
  .join(' · ');

const FILTER_ARG = {
  type: 'array',
  description: `Optional. EXACT conditions checked in code before any judgement — cheaper and more predictable than "when", so PREFER them for anything structural the user states ("from careers@acme.test" → from_address is/domain_is; "subject mentions application" → subject contains). Fields by source — ${FILTER_VOCAB}. All filters must pass (AND); they combine with "when", which should then carry only what is genuinely fuzzy. Never invent a field or a value the user didn't state.`,
  items: {
    type: 'object',
    properties: {
      field: { type: 'string', description: 'A field of THIS door\'s source (see the list above).' },
      op: { type: 'string', enum: ['is', 'contains', 'domain_is'], description: '"is" = exact match · "contains" = substring · "domain_is" = the address\'s domain.' },
      value: { type: 'string', description: "The value in the user's own words — an address, a domain, a word, a file extension." },
    },
    required: ['field', 'op', 'value'],
  },
} as const;

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const listTasksDefinition = {
  name: 'list_tasks',
  // THE PRESENTATION LAW (Sep 22): the "refer to tasks by NAME" instruction lives HERE, in the
  // description the model reads, and no longer inside the result string a surface could display.
  description: "List this worker's scheduled tasks. Call when the user asks what's automated, what tasks are running, what's scheduled, or wants to manage existing automations. The result is DATA for you, not text to show: refer to tasks by NAME when speaking to the user, and use the ids only when another tool asks for one.",
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
            filters: FILTER_ARG,
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
  description: "Edit any aspect of an existing task in response to user feedback. Use for: renaming, changing schedule, output settings, task instructions (tone/persona), status (pause/resume), or updating step content when the user gives feedback. Always call get_task first to read the current config. Use step_patch to edit a single step by its id — identify the right step from the labels and prompts you read. Call it directly — do not ask the user to confirm in words first: a status change applies at once, and every other change is PREPARED as a confirm card the user applies with one click (the result tells you which happened; never say a prepared change is done).",
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
            filters: FILTER_ARG,
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
      output_title: { type: 'string', description: 'Title template for a document. Use {{date}} for the run date, {{week_of}} for the week. Example: "Weekly Market Briefing — {{week_of}}"' },
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
          // THE CASE STATION'S KEY (relay canvas W4 + the stated case, Aug 25) — the two shapes,
          // described the same way both authoring doors describe them. Setting one CLEARS the other.
          case_instruction: { type: 'string', description: 'For a "case" step: what identifies a case, when it DIFFERS per event ("the job opening named in the application"). Setting this clears case_name.' },
          case_name: { type: 'string', description: 'For a "case" step: the ONE case every run files under, when the user named a specific opening/client/matter ("the Customer Service Representative opening"). Setting this clears case_instruction.' },
          // THE INPUT STATION (relay canvas, THE WAVE) — the station that stops the run and asks the
          // USER for something only they have at run time.
          ask: { type: 'string', description: 'For an "input" step: what the run asks the user for, in their own words ("this week\'s numbers from the finance system").' },
          accepts: { type: 'string', enum: ['text', 'doc', 'both'], description: 'For an "input" step: what the user may hand over — paste ("text"), a knowledge document ("doc"), or either ("both", the default).' },
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
  description: 'Prepare an immediate manual run of an existing task. Call when the user asks to run, execute, or trigger a task RIGHT NOW. Use list_tasks to find the task ID first. The run is PREPARED as a confirm card — it starts only when the user clicks Apply on it; say it is ready to confirm, never that it is running. NOT for "resume" / "unpause" / "turn it back on" — those mean the schedule goes back on, which is set_tasks_status.',
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
  description: "Share one of your tasks with your team (or stop sharing it). Shared tasks appear in teammates' workers under 'From the team' — they can copy them. Call when the user says 'share this task', 'let the team use it', 'make it available', or 'stop sharing'. The change is PREPARED as a confirm card and applies only on the user's click — never say it is shared until they have.",
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BULK STATUS DEED (Sep 21 — the incident's own verb).
//
// "Pause all workflows" used to force the model into an N-call loop with NOTHING reconciling N
// intents to N results: one call got eaten by the turn dedupe, the other succeeded, and the reply
// said "both are paused". The loop is now SERVER-SIDE and the answer is a PER-ITEM LEDGER — the
// count in the sentence is a count the code observed, one row at a time, verified after each write.
//
// REVERSIBLE BY CONSTRUCTION (its own mirror resumes what it paused), which is why it may act on the
// user's explicit words, exactly as update_task's status field already does. DESTRUCTIVE bulk is
// deliberately absent: delete_task stays single-item.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const setTasksStatusDefinition = {
  name: 'set_tasks_status',
  description:
    "Pause or resume tasks in ONE action. Use this whenever the user speaks about more than one task at once " +
    "(\"pause all my workflows\", \"pause everything\", \"resume the two briefings\") and for a single task named in words " +
    "(\"pause the weekly briefing\") — never a chain of update_task calls. Tasks are matched BY NAME, so you do not need " +
    "their ids. \"Resume\" / \"unpause\" / \"turn it back on\" mean status \"active\" HERE — they never mean run_task. " +
    "It returns a per-item ledger: report exactly what it says, naming each task, and never a count it did not give you.",
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'paused'], description: '"paused" stops the task from running; "active" resumes it.' },
      scope: {
        type: 'string', enum: ['all', 'named'],
        description: '"all" = every task in view (the user said "all", "everything"). "named" = only the tasks listed in names. Defaults to "named" when names are given.',
      },
      names: {
        type: 'array', items: { type: 'string' },
        description: "The tasks to act on, as the USER says them (names, never ids). Required when scope is \"named\".",
      },
    },
    required: ['status'],
  },
};

export const deleteTaskDefinition = {
  name: 'delete_task',
  description: 'Permanently delete a task. Call only when the user explicitly asks to delete or remove a task. Irreversible — the deletion is PREPARED as a confirm card and happens only when the user clicks Apply on it; never say it is deleted until they have.',
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

// ── THE SAYABLE SUPPLY (relay canvas, THE WAVE part 2 — THE PARITY LAW: every UI verb is sayable).
// A run parked at an input station is answered on the deck by a paste box. It must also be
// answerable by SAYING the thing to a coworker, because that is where the person already is when
// they have it ("here are this week's numbers"). Same deed, same rules — the executor calls
// `answerInputStation`, THE ONE implementation the resume door calls.
//
// THE HUMAN-IN-THE-LOOP LAW IS UNTOUCHED: supplying material to a run the user owns is the user's
// own deed, spoken in their own words. The run re-enters SEEDED, so every later approval gate still
// parks — an answer to a question has never passed a decision.
export const supplyRunInputDefinition = {
  name: 'supply_run_input',
  description:
    "Give a paused task run the material it stopped to ask for. Call this when the user hands you something a run is waiting on — pasted text, figures, a brief, or a file they attached ('here are the numbers', 'here's the JD'). An attached file lands in the user's Knowledge automatically, so supply it by name with kb_file_name. If you don't know which run is waiting, omit run_id and it resolves the one parked run; if several are waiting it will tell you which, and you should ask the user which one they mean. Supplying continues the run from where it stopped.",
  input_schema: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'Optional. The paused run to answer. Omit it when the user did not name one — the tool resolves the single run waiting for input, and refuses (naming them) if there is more than one.',
      },
      text: {
        type: 'string',
        description: "The material itself, in the user's own words — what they pasted or told you. Do not summarise or rewrite it; the run reads exactly what you pass. Use this OR kb_file_name.",
      },
      kb_file_name: {
        type: 'string',
        description: "The name of a document in the user's Knowledge to hand over — including a file they just attached to this conversation (attachments land in Knowledge under their own filename). Use this OR text.",
      },
      pin: {
        type: 'boolean',
        description: 'Only with kb_file_name. True when the user says this document should be used for EVERY future run (standing reference), not just this one.',
      },
    },
    required: [] as string[],
  },
};

/** Documents matching a spoken name, LADDERED (exact → containment) — AMBIGUITY IS A REFUSAL, so
 *  every rung returns ALL its matches and the caller refuses on more than one. */
async function knowledgeDocsByName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any, userId: string, name: string,
): Promise<Array<{ id: string; filename: string }>> {
  const q = name.trim();
  if (!q) return [];
  const sel = 'id, filename';
  let { data } = await adminClient.from('knowledge_files')
    .select(sel).eq('user_id', userId).ilike('filename', q).limit(6);
  if (!(data ?? []).length) {
    ({ data } = await adminClient.from('knowledge_files')
      .select(sel).eq('user_id', userId).ilike('filename', `%${q}%`).limit(6));
  }
  return (data ?? []) as Array<{ id: string; filename: string }>;
}

export async function executeSupplyRunInput(
  args: { run_id?: string; text?: string; kb_file_name?: string; pin?: boolean },
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  const docName = typeof args.kb_file_name === 'string' ? args.kb_file_name.trim() : '';

  // ONE OF, NEVER NEITHER, NEVER GUESSED: two kinds of material in one answer would leave the
  // person unsure which one the run actually read.
  if (!text && !docName) {
    return 'I need the material itself — either what the user pasted (text) or the name of a document in their Knowledge (kb_file_name).';
  }
  if (text && docName) {
    return 'Send one or the other: the pasted text, or the document name. Ask the user which one the run should read.';
  }

  const { answerInputStation, parkedInputStationsFor } = await import('@/lib/workflows/input-station');

  // WHICH RUN. Named → that one. Unnamed → the ONE parked station; several is a refusal that names
  // them, because picking for the person would put their material on the wrong run.
  let runId = typeof args.run_id === 'string' ? args.run_id.trim() : '';
  if (!runId) {
    const parked = await parkedInputStationsFor(adminClient, userId);
    if (parked.length === 0) {
      return 'Nothing is paused waiting for material right now — no run is asking for anything.';
    }
    if (parked.length > 1) {
      const list = parked.map((p) => `• "${p.workflowName}" is asking for ${p.ask} (run ${p.runId})`).join('\n');
      return `More than one run is waiting for something:\n${list}\nAsk the user which one this is for, then call again with that run_id.`;
    }
    runId = parked[0].runId;
  }

  // WHICH DOCUMENT (when one was named) — laddered, and ambiguity refuses with the candidates.
  let kbFileId: string | undefined;
  if (docName) {
    const docs = await knowledgeDocsByName(adminClient, userId, docName);
    if (docs.length === 0) {
      return `I can't find a document called "${docName}" in the user's Knowledge. If they attached it just now, use its exact filename; otherwise ask them to paste the content instead.`;
    }
    if (docs.length > 1) {
      const list = docs.map((d) => `• ${d.filename}`).join('\n');
      return `More than one document matches "${docName}":\n${list}\nAsk the user which one they mean, then call again with the exact filename.`;
    }
    kbFileId = docs[0].id;
  }

  const answered = await answerInputStation(adminClient, {
    runId, callerId: userId,
    input: { ...(text ? { text } : {}), ...(kbFileId ? { kbFileId } : {}), ...(args.pin ? { pin: true } : {}) },
  });
  if (!answered.ok) {
    return answered.status === 404
      ? "I couldn't find that paused run — ask the user to point at it from their deck."
      : answered.error;
  }

  // THE RE-ENTRY happens in the dispatcher's own window: this tool runs inside a 60s chat route,
  // and a real run takes minutes. The claim is already durable — the run cannot be answered twice
  // even if the kick is late, and the standing backstop restarts a kick that never landed.
  const base = (process.env.AUGMTD_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  await fetch(`${base}/api/internal/run-workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AGENTOS_SECRET ?? ''}` },
    body: JSON.stringify({ workflowId: answered.workflowId, runId, runnerId: userId, resumeSeeded: true }),
  }).catch(() => {});

  const what = answered.docName ? `"${answered.docName}"` : 'what you gave me';
  return `Sent ${what} to "${answered.workflowName}", which was asking for ${answered.ask} — the run picked up from there and will finish on its own.`
    + (answered.pinned ? ' It is also pinned to that workflow now, so every future run reads it.' : '');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatSchedule(trigger: { type: string; cron?: string; label?: string }): string {
  if (trigger.type === 'manual') return 'manual trigger only';
  return trigger.label ?? trigger.cron ?? 'scheduled';
}

export function formatLastRun(iso: string | null): string {
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

/** ONE READ, TWO RENDERINGS (Wave 1, Sep 22 — the collection card). The task listing has two
 *  consumers now: the model (the block below) and the kit's collection card (typed rows). They read
 *  THE SAME query through this function, so the card can never describe a set the model was not
 *  shown — the drift this extraction exists to make impossible. */
export type TaskListRow = {
  id: string;
  name: string;
  status: string;
  trigger: { type: string; cron?: string; label?: string };
  last_run_at: string | null;
  agent_id: string | null;
  /** The coworker who owns it, resolved — null on the coworker door (it is always the asker's own). */
  ownerName: string | null;
};

export async function readTaskRows(
  agentId: string | null,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<TaskListRow[]> {
  let q = adminClient
    .from('workflows')
    .select('id, name, status, trigger, last_run_at, agent_id')
    .eq('user_id', userId);
  if (agentId) q = q.eq('agent_id', agentId);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error || !data) return [];
  const rows = data as Array<Omit<TaskListRow, 'ownerName'>>;
  // THE OWNER RIDES THE ROW on the chief's door — "pause the weekly briefing" is answerable only if
  // the answer can say whose it is.
  const owners = agentId ? {} : await agentNames(rows.map((r) => r.agent_id), adminClient);
  return rows.map((r) => ({ ...r, ownerName: (!agentId && r.agent_id && owners[r.agent_id]) || null }));
}

/** THE CHIEF'S SEAT (Sep 21, CLASS 2): `agentId` is now OPTIONAL. A coworker asks for its own
 *  tasks; the chief of staff asks for the user's WHOLE set and needs each row to name the coworker
 *  who owns it — same executor, same user scope, one filter's difference. */
export async function executeListTasks(
  agentId: string | null,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<string> {
  const rows = await readTaskRows(agentId, userId, adminClient);

  if (rows.length === 0) {
    return agentId
      ? 'No tasks found for this worker. Use create_task to set one up.'
      : 'No tasks set up yet. Ask one of your coworkers to build one.';
  }

  const lines = rows.map(t => {
    const dot = t.status === 'active' ? '●' : '○';
    const owner = t.ownerName ? ` — ${t.ownerName}` : '';
    return `${dot} [${t.id}] ${t.name}${owner} — ${formatSchedule(t.trigger)} — ${formatLastRun(t.last_run_at)} [${t.status}]`;
  });

  // THE PRESENTATION LAW (Sep 22): this listing is DATA — it carries ids because the id-taking
  // tools need them, and it is never served to a person (the chief dispatcher returns it as
  // `modelText`; see lib/converse/index.ts). The instruction that used to close it ("Refer to tasks
  // by NAME when speaking to the user…") shipped in an owner's chat bubble verbatim: an instruction
  // to the model belongs in the TOOL DESCRIPTION, never in a string a surface might display.
  return `Tasks (${rows.length}):\n${lines.join('\n')}`;
}

/** agent_id → coworker name, for the chief's listing. Best-effort: a missing name just omits it. */
async function agentNames(
  ids: Array<string | null>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (!unique.length) return {};
  try {
    const { data } = await adminClient.from('custom_agents').select('id, name').in('id', unique);
    const out: Record<string, string> = {};
    for (const a of (data ?? []) as Array<{ id: string; name: string | null }>) {
      if (a.name) out[a.id] = a.name;
    }
    return out;
  } catch { return {}; }
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
    // THE CASE STATION says its key and WHICH SHAPE it is — a step the model cannot read is a step
    // it will happily replace with something else (it used to print "[unknown]").
    if (s.type === 'case') {
      const stated = (s.case_name ?? '').trim();
      return `  ${i + 1}. [case] id:${s.id} label:"${s.label}"\n     `
        + (stated ? `case_name (one standing case): ${stated}` : `case_instruction (the case each event names): ${s.case_instruction ?? ''}`);
    }
    // THE INPUT STATION says what it asks for and what it takes — a station the model cannot read
    // is a station it will happily replace with something else.
    if (s.type === 'input') {
      return `  ${i + 1}. [input] id:${s.id} label:"${s.label}"\n     `
        + `ask (what the run asks YOU for, each run): ${s.ask ?? ''}\n     accepts: ${s.accepts ?? 'both'}`;
    }
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
    step_patch?: {
      step_id: string; label?: string; prompt?: string; config?: Record<string, unknown>;
      case_instruction?: string; case_name?: string;
      ask?: string; accepts?: 'text' | 'doc' | 'both';
    };
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
    const { step_id, label, prompt, config, case_instruction, case_name, ask, accepts } = fields.step_patch;
    const steps = [...(row.steps ?? [])];
    const idx = steps.findIndex(s => s.id === step_id);
    if (idx === -1) return `Step "${step_id}" not found. Call get_task to see current step ids.`;
    const step = { ...steps[idx] } as WorkflowStep & Record<string, unknown>;
    if (label !== undefined) step.label = label;
    if (prompt !== undefined && (step.type === 'ai' || step.type === 'agent')) step.prompt = prompt;
    if (config !== undefined && step.type === 'tool') step.config = { ...(step.config as Record<string, unknown> ?? {}), ...config };
    // EXACTLY ONE CASE KEY LIVES ON A CASE STEP — setting either shape clears the other, so two
    // competing keys can never sit on one station (the Studio toggle's law, said in code).
    if (step.type === 'case' && case_name !== undefined) { step.case_name = case_name; step.case_instruction = ''; }
    else if (step.type === 'case' && case_instruction !== undefined) { step.case_instruction = case_instruction; step.case_name = ''; }
    // THE INPUT STATION's two fields — only ever on an input step (a stray `ask` must not land on a
    // handoff, whose `ask` means something else: a decision, not material).
    if (step.type === 'input' && ask !== undefined) step.ask = ask;
    if (step.type === 'input' && accepts !== undefined) step.accepts = accepts;
    steps[idx] = step as WorkflowStep;
    update.steps = steps;
    changes.push(`step "${steps[idx].label}" updated`);
  }

  if (fields.steps !== undefined) { update.steps = fields.steps; changes.push('pipeline steps replaced'); }

  if (Object.keys(update).length === 0 && pendingInputs === undefined && pendingLimit === undefined) {
    return 'Nothing to update — no fields provided.';
  }

  // ── VERIFY AFTER WRITE (Sep 21, CLASS 1B) — a PostgREST `.update().eq('id')` that matches ZERO
  // rows is not an error: it returns cleanly and the sentence below used to claim the change. The
  // write now RE-READS the row and reports the OBSERVED state; a write that moved nothing SAYS SO.
  let observed: Record<string, unknown> | null = null;
  if (Object.keys(update).length > 0) {
    const { error } = await adminClient
      .from('workflows')
      .update(update)
      .eq('id', taskId)
      .eq('user_id', userId);

    // ERRORS ARE NEVER RAW (Sep 22): a transport/Postgres message is written for an engineer's
    // console, not for the person — the detail goes to console.error, the sentence stays ours.
    if (error) { console.error('[worker-tasks] update_task failed', error); return `Failed to update "${row.name}" — nothing was changed. Try again in a moment.`; }

    const { data: after } = await adminClient
      .from('workflows')
      .select('id, name, status')
      .eq('id', taskId)
      .eq('user_id', userId)
      .maybeSingle();
    observed = (after ?? null) as Record<string, unknown> | null;
    if (!observed) {
      return `Failed to update "${row.name}": the task no longer exists (nothing was changed).`;
    }
    if (fields.status !== undefined && observed.status !== fields.status) {
      return `Failed to update "${row.name}": it is still ${String(observed.status)}, not ${fields.status}. Nothing was changed.`;
    }
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
  // The sentence speaks the OBSERVED name and, when status was the change, the OBSERVED status.
  const finalName = (observed?.name as string) ?? fields.name ?? row.name;
  const statusLine = fields.status !== undefined && observed ? ` It is now ${String(observed.status)}.` : '';
  return `"${finalName}" updated — ${changes.join(', ')}.${statusLine}${notesTail ? ` ${notesTail}` : ''}`;
}

/**
 * A SPOKEN NAME → one task id (Sep 21, CLASS 2). The chief of staff talks about tasks by name; a
 * tool that only takes an id is useless in conversation. Same ladder, same refusal-by-listing.
 * `agentId` null = the user's whole set (the chief's seat).
 */
export async function resolveTaskIdByName(
  spoken: string,
  agentId: string | null,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
): Promise<{ id: string; name: string } | { error: string }> {
  let q = adminClient.from('workflows').select('id, name').eq('user_id', userId);
  if (agentId) q = q.eq('agent_id', agentId);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) { console.error('[worker-tasks] resolveTaskIdByName read failed', error); return { error: "I couldn't read your tasks just now — try again in a moment." }; }
  const rows = ((data ?? []) as Array<{ id: string; name: string | null }>)
    .filter((r) => !!r.id && !!r.name)
    .map((r) => ({ id: r.id, name: (r.name as string).trim() }));
  if (!rows.length) return { error: 'There are no tasks set up yet.' };
  const m = matchWorkflowName(rows, spoken);
  if (m.hit) return m.hit;
  if (m.miss === 'ambiguous') {
    return { error: `More than one of your tasks matches "${spoken}" — ${rows.filter((r) => r.name.toLowerCase().includes(spoken.toLowerCase())).map((r) => `"${r.name}"`).join(' · ')}. Which one?` };
  }
  return { error: `I don't have a task called "${spoken}". You have: ${rows.map((r) => `"${r.name}"`).join(' · ')}.` };
}

// ── THE DIRECTION WORDS + THE ALL WORDS, in the four languages this repo already speaks. Used ONLY
// to overrule a model's extraction with what the user plainly said — never to invent an argument. ──
const RESUME_WORDS =
  /\b(?:resume[sd]?|resuming|re-?activate[sd]?|re-?enable[sd]?|un-?pause[sd]?|turn (?:it |them |these |those )?back on|switch (?:it |them )?back on|retoma(?:r|m)?|reativar|ativar|fortsetzen|reaktivieren|wieder aktivieren|reprendre|réactiver)\b/i;
const PAUSE_WORDS =
  /\b(?:pause[sd]?|pausing|stop|halt|suspend|disable[sd]?|turn (?:it |them |these |those )?off|pausar|parar|suspender|desativar|pausier(?:en|e|st|t)|anhalten|stoppen|deaktivieren|mettre en pause|suspendre|désactiver)\b/i;
const ALL_WORDS =
  /\b(?:all|every|everything|each of (?:them|these|those)|both|the lot|todas?|todos?|tudo|ambas|ambos|alle[sn]?|beide|tous|toutes|tout|les deux)\b/i;
/** A CARVE-OUT ("all except the briefing"). The exception is invisible to a scope+status pair, so a
 *  bulk that carries one would act on exactly the task the user asked to spare. */
const EXCEPT_WORDS =
  /\b(?:except|excepting|but not|apart from|other than|aside from|ausser|außer|exceto|excepto|salvo|menos que|sauf|hormis)\b/i;
/** A NEGATED direction ("don't pause the weekly one"). Which way it points is a guess, and a guess
 *  here is a deed on work the user just told us to leave alone. */
const NEGATION_WORDS =
  /(?:\b(?:do ?n'?t|do not|never|nicht|keine?|não|nao)\b|\bne\b[^.!?]{0,30}\bpas\b)/i;

/** What the two dangerous arguments of the bulk status deed resolve to, decided from the user's own
 *  words. A refusal carries the CLASS it refused on — gates assert the class, copy stays free. */
export type TasksStatusPlan =
  | { act: true; status: 'active' | 'paused'; scope: 'all' | 'named'; names: string[] }
  | { act: false; code: 'exception' | 'negation' | 'mixed' | 'unnamed'; why: string };

/**
 * THE BULK STATUS FLOORS — pure, so their whole truth table is gateable without a database.
 *
 * ⚠️ THEY FAIL CLOSED (Sep 21, second pass). The first cut read "no words heard" as permission:
 * `allWasSaid = !said || ALL_WORDS.test(said)` made an EMPTY message satisfy the all-word floor, and
 * the AgentOS door calls this executor with no user text at all — so a model emitting
 * `{status:'paused'}` with no names would have paused every workflow the user owns, through a door
 * where nobody had said anything. Now: a bulk over EVERYTHING needs the user's own all-word AND
 * their own direction word, together, in this message. With nothing heard, only EXPLICITLY NAMED
 * targets may move; with neither names nor heard words the deed REFUSES BY LISTING.
 *
 * `knownNames` is not decoration: a task called "All Hands Digest" puts an all-word in every
 * sentence that names it, so known names are removed from the text before any word floor reads it.
 */
export function planTasksStatusDeed(args: {
  status: 'active' | 'paused';
  scope?: 'all' | 'named';
  names?: string[];
  userText?: string;
  knownNames?: readonly string[];
}): TasksStatusPlan {
  const names = (Array.isArray(args.names) ? args.names : [])
    .map((n) => String(n ?? '').trim()).filter(Boolean);

  let said = String(args.userText ?? '').toLowerCase();
  const known = [...(args.knownNames ?? [])]
    .map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first — a name inside a name still comes out
  for (const n of known) said = said.split(n).join(' ');
  said = said.trim();

  const wantsResume = RESUME_WORDS.test(said);
  const wantsPause = PAUSE_WORDS.test(said);

  // ── FLOOR 0: A CARVED-OUT, NEGATED OR TWO-DIRECTION LINE IS NOT ONE DEED. Each of these is a
  // sentence whose meaning cannot survive the {status, scope, names} shape — so it is refused by
  // listing rather than flattened into whichever half the model happened to extract.
  if (said && EXCEPT_WORDS.test(said)) {
    return { act: false, code: 'exception', why: 'I won\'t act on an "all except" — I\'d have to guess what to leave out.' };
  }
  if (said && NEGATION_WORDS.test(said)) {
    return { act: false, code: 'negation', why: 'There\'s a "not" in there and I won\'t guess which way it points.' };
  }
  if (wantsResume && wantsPause) {
    return { act: false, code: 'mixed', why: 'You named both directions in one line, and I won\'t split them by guessing.' };
  }

  // ── FLOOR 1: THE DIRECTION IS THE USER'S WORD. Heard, it wins over the model's extraction; not
  // heard, the model's direction stands — but only for targets the user explicitly named (below).
  const status: 'active' | 'paused' = wantsResume ? 'active'
    : wantsPause ? 'paused'
    : args.status === 'active' ? 'active' : 'paused';

  // ── FLOOR 2: NAMES ARE THE MOST SPECIFIC THING SAID. With names in hand the deed acts on THOSE,
  // whatever scope came back — a model that says "all" while naming two tasks meant the two.
  if (names.length) return { act: true, status, scope: 'named', names };

  // ── FLOOR 3: "ALL" MUST BE SAID, WITH A DIRECTION, IN THIS MESSAGE. Anything less refuses.
  const allWasSaid = !!said && ALL_WORDS.test(said);
  const directionHeard = wantsResume || wantsPause;
  if (args.scope !== 'named' && allWasSaid && directionHeard) return { act: true, status, scope: 'all', names: [] };
  return { act: false, code: 'unnamed', why: '' };
}

/**
 * "RESUME" IS THE MIRROR OF "PAUSE", NOT "RUN NOW" (Sep 21, found by the live replay: "resume the X
 * task" was served by `run_task` — it STARTED a real run, which can spend money and send mail, when
 * the person only wanted the schedule turned back on). The disambiguation is code's, from the
 * user's own words: a resume word with no run-now word is a STATUS deed.
 */
export const spokenIsResumeNotRun = (userText: string): boolean =>
  RESUME_WORDS.test(userText) && !/\b(?:run|runs|execute|trigger|kick(?:ing)? off|right now|immediately)\b/i.test(userText);

/** What the bulk status deed OBSERVED. `text` is the per-item ledger the model must report; the
 *  counts are what the deed floor checks the reply's arithmetic against. */
export interface BulkStatusOutcome {
  text: string;
  /** Rows re-read at the requested status AFTER a write — the only number anyone may claim. */
  changed: number;
  /** Rows already at the requested status (a truthful no-op, named separately). */
  alreadyThere: number;
  failed: number;
  /** True when nothing was attempted (no match / ambiguity) — a refusal, not a deed. */
  refused: boolean;
}

/**
 * THE BULK STATUS DEED. Loops SERVER-side over the resolved set, writes one row at a time, RE-READS
 * each row, and returns a named ledger. Names resolve through the ONE ladder (`matchWorkflowName`:
 * exact → unique containment → refusal); AMBIGUITY IS A REFUSAL BY LISTING, never a guess.
 *
 * `agentId` scopes the set the way the caller's door sees it: a coworker acts on ITS OWN tasks (the
 * same set its list_tasks shows); the chief passes null and acts across the user's whole set.
 * Another user's workflows are unreachable by construction — every query is `.eq('user_id', userId)`.
 */
export async function executeSetTasksStatus(
  input: { status: 'active' | 'paused'; scope?: 'all' | 'named'; names?: string[] },
  agentId: string | null,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  /** THE USER'S OWN WORDS (the EXPLICIT_SEND floor's idiom) — a bulk deed's two most dangerous
   *  arguments are decided HERE, in code, from what the person actually said, never from a model's
   *  extraction. Found live: a "resume X" turn came back from the router as status=paused with no
   *  names, which would have paused every task the user owns. */
  userText = '',
): Promise<BulkStatusOutcome> {
  let q = adminClient
    .from('workflows')
    .select('id, name, status, trigger, next_run_at')
    .eq('user_id', userId);
  if (agentId) q = q.eq('agent_id', agentId);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) {
    console.error('[worker-tasks] set_tasks_status read failed', error);
    return { text: "I couldn't read your tasks just now, so nothing was changed. Try again in a moment.", changed: 0, alreadyThere: 0, failed: 0, refused: true };
  }

  type Row = { id: string; name: string; status: string; trigger: { type?: string; cron?: string; timezone?: string } | null; next_run_at: string | null };
  const all = ((data ?? []) as Row[]).filter((r) => !!r.name);
  if (!all.length) {
    return { text: 'There are no tasks to change.', changed: 0, alreadyThere: 0, failed: 0, refused: true };
  }

  // ── THE FLOORS, decided on the user's own words against the set that actually exists. They run
  // AFTER the read because a task's own name can contain a command word (see planTasksStatusDeed).
  const listing = `You have: ${all.map((r) => `"${r.name}"`).join(' · ')}.`;
  const plan = planTasksStatusDeed({
    status: input.status, scope: input.scope, names: input.names,
    userText, knownNames: all.map((r) => r.name),
  });
  if (!plan.act) {
    return {
      text: plan.code === 'unnamed'
        ? `Which one${all.length > 1 ? 's' : ''}? ${listing} Name them, or say "all".`
        : `${plan.why} ${listing} Name the ones to change, or say "all" to cover every one.`,
      changed: 0, alreadyThere: 0, failed: 0, refused: true,
    };
  }
  const { status, scope } = plan;
  const spokenNames = plan.names;
  const verb = status === 'paused' ? 'Paused' : 'Resumed';
  const past = status === 'paused' ? 'paused' : 'active';

  let targets: Row[] = [];
  const refusals: string[] = [];
  if (scope === 'all') {
    targets = all;
  } else {
    for (const spoken of spokenNames) {
      const m = matchWorkflowName(all, spoken);
      if (m.hit) {
        if (!targets.some((t) => t.id === m.hit.id)) targets.push(m.hit as Row);
      } else if (m.miss === 'ambiguous') {
        const candidates = all.filter((r) => r.name.toLowerCase().includes(spoken.toLowerCase())).map((r) => `"${r.name}"`);
        refusals.push(`More than one of your tasks matches "${spoken}"${candidates.length ? ` — ${candidates.join(' · ')}` : ''}. Which one?`);
      } else {
        refusals.push(`I don't have a task called "${spoken}". You have: ${all.map((r) => `"${r.name}"`).join(' · ')}.`);
      }
    }
  }

  if (!targets.length) {
    return {
      text: refusals.join(' ') || 'Nothing matched, so nothing was changed.',
      changed: 0, alreadyThere: 0, failed: 0, refused: true,
    };
  }

  const moved: string[] = [];
  const already: string[] = [];
  const failed: string[] = [];

  for (const row of targets) {
    if (row.status === status) { already.push(row.name); continue; }
    const update: Record<string, unknown> = { status };
    // Resuming a SCHEDULED task with no next run would leave it silently dead (the July dead-month
    // class) — the schedule is recomputed here, through the engine's own helper.
    if (status === 'active' && row.trigger?.type === 'schedule' && row.trigger.cron && !row.next_run_at) {
      const d = computeNextRun(row.trigger.cron, row.trigger.timezone);
      if (d) update.next_run_at = d.toISOString();
    }
    const { error: upErr } = await adminClient
      .from('workflows').update(update).eq('id', row.id).eq('user_id', userId);
    if (upErr) { console.error('[worker-tasks] status write failed', row.id, upErr); failed.push(`${row.name} (the write did not go through)`); continue; }
    // VERIFY AFTER WRITE — the ledger counts rows READ BACK at the new status, never rows we asked to move.
    const { data: after } = await adminClient
      .from('workflows').select('status').eq('id', row.id).eq('user_id', userId).maybeSingle();
    if ((after as { status?: string } | null)?.status === status) moved.push(row.name);
    else failed.push(`${row.name} (still ${(after as { status?: string } | null)?.status ?? 'missing'})`);
  }

  const parts: string[] = [];
  if (moved.length) parts.push(`${verb} ${moved.length}: ${moved.map((n) => `"${n}"`).join(' · ')}.`);
  if (already.length) parts.push(`Already ${past} (${already.length}): ${already.map((n) => `"${n}"`).join(' · ')}.`);
  if (failed.length) parts.push(`Failed (${failed.length}): ${failed.join(' · ')}.`);
  if (refusals.length) parts.push(refusals.join(' '));
  if (!parts.length) parts.push('Nothing needed changing.');

  return {
    text: parts.join(' '),
    changed: moved.length,
    alreadyThere: already.length,
    failed: failed.length,
    refused: false,
  };
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
    console.error('[worker-tasks] run_task insert failed', runErr);
    return `I couldn't start "${row.name}" just now — nothing is running. Try again in a moment.`;
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

  if (error || !copy) { console.error('[worker-tasks] duplicate_task failed', error); return `Failed to duplicate "${row.name}" — nothing was created. Try again in a moment.`; }

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

    if (error) { console.error('[worker-tasks] share_task failed', error); return `I couldn't share "${name}" just now — it is still private.`; }
    return `"${name}" is now shared with your team. They can find it in their Tasks tab under "From the team" and copy it to their workers.`;
  } else {
    const { error } = await adminClient
      .from('workflows')
      .update({ sharing_mode: null, shared_with_company: false })
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) { console.error('[worker-tasks] unshare_task failed', error); return `I couldn't make "${name}" private just now — it is still shared.`; }
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
    console.error('[worker-tasks] use_task fork failed', err);
    return 'I could not copy that team task across just now — nothing was added.';
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

  if (error) { console.error('[worker-tasks] delete_task failed', error); return 'I could not delete that task just now — it is still there.'; }

  // VERIFY AFTER WRITE (Sep 21) — the same discipline as update: a delete that matched nothing is
  // not an error, so the claim is grounded in a re-read, never in the absence of one.
  const { data: still } = await adminClient
    .from('workflows').select('id').eq('id', taskId).eq('user_id', userId).maybeSingle();
  if (still) return `Failed to delete "${(task as { name: string }).name}" — it is still there. Nothing was removed.`;

  return `"${(task as { name: string }).name}" has been permanently deleted.`;
}
