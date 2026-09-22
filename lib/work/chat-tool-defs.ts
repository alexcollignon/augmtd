// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COWORKER DOOR'S TOOL TABLE (Sep 21 — CLASS 2: "a verb has every conversational door").
//
// Before: `buildChatTools` in the chat route pushed its tools as LITERALS, including a whole
// `if (isWorker)` block of task verbs that appeared in NO registry row. The chief door derives its
// slice from the registry — so the registry, the one thing every parity gate reads, did not know
// the task verbs existed, and the Home chat could honestly say "I don't have a tool to pause
// workflows" while a coworker had been pausing them for months.
//
// Now the door READS THE REGISTRY (`doorToolIds('coworker')`) and looks each id up in the table
// below. A tool with no row is not offered; a row the table cannot serve is not a chat tool (an
// `analyze`/`send_email`/pipeline-source capability legitimately has no chat definition). Drift is
// impossible rather than merely detectable, and `doorParity()` proves the two halves agree.
//
// The two SPLITS that are not the registry's business stay here, declared:
//   • SOURCE_GATE — which user-selected source (kb/inbox/calendar/web) a read tool belongs to.
//   • WORKER_ONLY — which tools only a SEEDED COWORKER holds (a user's own custom agent is not a
//     coworker and never managed tasks, Slack, skills or the team library).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import {
  webSearchDefinition, fetchUrlDefinition,
  getEmailsDefinition, getMeetingContextDefinition, checkCalendarDefinition,
  slackListChannelsDefinition, slackPostMessageDefinition, slackReadMessagesDefinition, slackListMembersDefinition,
  findTeamWorkDefinition, readTeamWorkDefinition,
  composeEmailDefinition, runComputeDefinition,
} from '@/lib/tools';
import {
  listTasksDefinition, createTaskDefinition, getTaskDefinition, updateTaskDefinition,
  duplicateTaskDefinition, deleteTaskDefinition, runTaskDefinition, setTasksStatusDefinition,
  shareTaskDefinition, listTeamTasksDefinition, useTaskDefinition, supplyRunInputDefinition,
  listWorkerDocumentsDefinition, getWorkerDocumentDefinition,
} from '@/lib/tools/worker-tasks';
import { listSkillsDefinition, applySkillDefinition } from '@/lib/tools/worker-skills';
import { prepareCalendarInviteDefinition } from '@/lib/tools/prepare-calendar-invite';
import { prepareEventActionDefinition } from '@/lib/tools/prepare-event-action';
import { doorToolIds } from '@/lib/work/surface-registry';
import { isToolAllowed } from '@/lib/workspace/tool-capabilities';
import type { WorkspaceFeatures } from '@/lib/workspace/types';

export interface NeutralTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ── The definitions that live nowhere else (previously inline in the route). ──

const searchKnowledgeBaseDefinition: NeutralTool = {
  name: 'search_knowledge_base',
  description: "Search indexed files and Drive documents for relevant content.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Specific search query' } },
    required: ['query'],
  },
};

const readDocumentDefinition: NeutralTool = {
  name: 'read_document',
  description: "Read the full content of a specific document. Call after search_knowledge_base finds a relevant file and you need more detail than the search excerpt.",
  input_schema: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'File ID from search results' },
      filename: { type: 'string', description: 'Filename (for display)' },
    },
    required: ['file_id', 'filename'],
  },
};

const getEmailBodyDefinition: NeutralTool = {
  name: 'get_email_body',
  description: "Read the full body of a specific email by ID. Call after get_emails identifies the email you need.",
  input_schema: {
    type: 'object',
    properties: { email_id: { type: 'string', description: 'The email ID from get_emails results' } },
    required: ['email_id'],
  },
};

const requestClarificationDefinition: NeutralTool = {
  name: 'request_clarification',
  description: "Present a confirmation card before generating a file. Call ONLY when: (1) the user's message explicitly requested a file artifact using words like 'document', 'Word doc', 'spreadsheet', 'presentation', 'deck', 'PDF', 'file', 'to download', 'to send as' AND (2) you have searched and found relevant content. Content type alone is never enough — 'write a press release / report / proposal / summary' does NOT qualify. Do NOT call when searches returned nothing — respond conversationally instead.",
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        minLength: 10,
        description: 'A STATEMENT of what you will create — must be declarative, not a question. Example: "I\'ll create a pricing summary using the three documents I found."',
      },
      sources: {
        type: 'array',
        description: 'Documents/items found. Use EXACT full filenames from search results.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string', minLength: 3, description: 'EXACT full filename from search results — never abbreviated' },
            type: { type: 'string', enum: ['kb', 'email', 'calendar'] },
          },
          required: ['id', 'title', 'type'],
        },
      },
      options: {
        type: 'array',
        description: 'Optional choice groups (max 3) for genuinely ambiguous decisions.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
            default: { type: 'string' },
          },
          required: ['key', 'label', 'choices'],
        },
      },
    },
    required: ['question'],
  },
};

const generateDocumentDefinition: NeutralTool = {
  name: 'generate_document',
  description: "Generate a downloadable file artifact. Call ONLY when the user explicitly asked for a file using words like 'document', 'Word doc', 'spreadsheet', 'presentation', 'deck', 'PDF', 'file', 'to download', 'to send as'. Content type alone is never a trigger — 'write a press release / report / proposal / summary / draft an email' always produces inline text, not a file. Only 'create a press release document' / 'I need a Word report' / 'make me a presentation' triggers this tool.",
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['word', 'excel', 'pptx', 'email'], description: 'File format. "word" = user asked for a Word doc / document / report to download. "excel" = user asked for a spreadsheet / tracker / budget. "pptx" = user asked for a presentation / deck / slides. "email" = user explicitly asked to send an email or open a draft in their mail client — NOT for "write an email about X" (that goes inline).' },
      instructions: { type: 'string', description: 'Detailed instructions: purpose, audience, key sections, tone, specific data to include.' },
    },
    required: ['type', 'instructions'],
  },
};

const presentLinkedinPostDefinition: NeutralTool = {
  name: 'present_linkedin_post',
  description: "Present a finished LinkedIn post to the user as a rich, reviewable card (faithful preview, character count, the \"see more\" fold). Call this whenever you've written a LinkedIn post for the user — put the post text HERE, not in your chat reply. Display-only (it does not publish). Provide 1–3 variants only if you genuinely drafted alternatives. After calling it, keep your chat reply to a short intro line.",
  input_schema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        description: '1–3 post options.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The full post text.' },
            hashtags: { type: 'array', items: { type: 'string' }, description: 'Optional hashtags (without #).' },
          },
          required: ['text'],
        },
      },
    },
    required: ['variants'],
  },
};

/** registry tool id → the definition the coworker door offers for it. */
export const COWORKER_CHAT_TOOLS: Record<string, NeutralTool> = {
  search_knowledge_base: searchKnowledgeBaseDefinition,
  read_document: readDocumentDefinition,
  get_emails: getEmailsDefinition as NeutralTool,
  get_email_body: getEmailBodyDefinition,
  get_meeting_context: getMeetingContextDefinition as NeutralTool,
  check_calendar: checkCalendarDefinition as NeutralTool,
  web_search: webSearchDefinition as NeutralTool,
  fetch_url: fetchUrlDefinition as NeutralTool,
  run_compute: runComputeDefinition as NeutralTool,
  request_clarification: requestClarificationDefinition,
  generate_document: generateDocumentDefinition,
  // Worker-only (see WORKER_ONLY_CHAT_TOOLS below)
  list_tasks: listTasksDefinition as NeutralTool,
  create_task: createTaskDefinition as NeutralTool,
  get_task: getTaskDefinition as NeutralTool,
  update_task: updateTaskDefinition as NeutralTool,
  set_tasks_status: setTasksStatusDefinition as NeutralTool,
  duplicate_task: duplicateTaskDefinition as NeutralTool,
  delete_task: deleteTaskDefinition as NeutralTool,
  run_task: runTaskDefinition as NeutralTool,
  supply_run_input: supplyRunInputDefinition as NeutralTool,
  share_task: shareTaskDefinition as NeutralTool,
  list_team_tasks: listTeamTasksDefinition as NeutralTool,
  use_task: useTaskDefinition as NeutralTool,
  list_worker_documents: listWorkerDocumentsDefinition as NeutralTool,
  get_worker_document: getWorkerDocumentDefinition as NeutralTool,
  list_skills: listSkillsDefinition as NeutralTool,
  apply_skill: applySkillDefinition as NeutralTool,
  slack_list_channels: slackListChannelsDefinition as NeutralTool,
  slack_post_message: slackPostMessageDefinition as NeutralTool,
  slack_read_messages: slackReadMessagesDefinition as NeutralTool,
  slack_list_members: slackListMembersDefinition as NeutralTool,
  find_team_work: findTeamWorkDefinition as NeutralTool,
  read_team_work: readTeamWorkDefinition as NeutralTool,
  compose_email: composeEmailDefinition as NeutralTool,
  prepare_calendar_invite: prepareCalendarInviteDefinition as NeutralTool,
  prepare_event_action: prepareEventActionDefinition as NeutralTool,
  present_linkedin_post: presentLinkedinPostDefinition,
};

/** Which user-selected SOURCE a read tool rides on (unlisted = always offered). */
const SOURCE_GATE: Record<string, string> = {
  search_knowledge_base: 'kb', read_document: 'kb',
  get_emails: 'inbox', get_email_body: 'inbox',
  get_meeting_context: 'calendar', check_calendar: 'calendar',
  web_search: 'web', fetch_url: 'web',
};

/** Tools only a SEEDED COWORKER holds — a user's own custom agent never managed tasks, Slack,
 *  skills or the team library, and that split predates the registry. */
export const WORKER_ONLY_CHAT_TOOLS: ReadonlySet<string> = new Set([
  'list_tasks', 'create_task', 'get_task', 'update_task', 'set_tasks_status', 'duplicate_task',
  'delete_task', 'run_task', 'supply_run_input', 'share_task', 'list_team_tasks', 'use_task',
  'list_worker_documents', 'get_worker_document', 'list_skills', 'apply_skill',
  'slack_list_channels', 'slack_post_message', 'slack_read_messages', 'slack_list_members',
  'find_team_work', 'read_team_work', 'compose_email', 'prepare_calendar_invite',
  'prepare_event_action', 'present_linkedin_post',
]);

/**
 * THE COWORKER DOOR'S TOOL LIST, derived. Registry order; source-gated; worker-gated; then the
 * workspace-feature filter (the one map, unchanged).
 *
 * NOTE: `deep_research` is executed directly BEFORE the AI loop, never model-invoked, so it is
 * deliberately absent from the table above and from this list.
 */
export function buildCoworkerTools(
  sources: string[], isWorker: boolean, features: WorkspaceFeatures,
): NeutralTool[] {
  const out: NeutralTool[] = [];
  for (const id of doorToolIds('coworker')) {
    const def = COWORKER_CHAT_TOOLS[id];
    if (!def) continue;                                        // a non-chat capability (analyze, pipeline sources…)
    if (!isWorker && WORKER_ONLY_CHAT_TOOLS.has(id)) continue;
    const src = SOURCE_GATE[id];
    if (src && !sources.includes(src)) continue;
    if (!isToolAllowed(id, features)) continue;
    out.push(def);
  }
  return out;
}
