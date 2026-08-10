import type { WorkspaceFeatures, FeatureKey } from './types';

// ─── Single source of truth: tool/step → required workspace feature ────────────
// `null` = always available (web, research, producing deliverables, team/task/skill
// tools, and integrations that gate themselves via connection or agent_tool_settings).
// Every surface — coworker chat offer, the [TOOLS] prompt, the studio builder picker,
// generate-config, the executors, and /api/work/mentions — reads THIS map, so they can
// never drift. Adding a tool or integration = one line here. Adding a workspace feature
// = a new key in WorkspaceFeatures + mapping the relevant tools to it.
export const TOOL_FEATURE: Record<string, FeatureKey | null> = {
  // ── Email (inbox) ──
  get_emails: 'email',
  get_urgent_emails: 'email',
  get_email_body: 'email',
  // The chief's mailbox verbs (Aug 10, the sovereign leak audit): sending/forwarding rides the
  // user's CONNECTED mailbox — feature-gated like every other email tool.
  send_prepared_reply: 'email',
  prepare_forward: 'email',

  // ── Meetings / calendar ──
  get_meeting_context: 'meetings',
  get_calendar: 'meetings',
  send_calendar_invite: 'meetings',

  // ── Drive / knowledge base ──
  search_knowledge_base: 'drive',
  read_kb_file: 'drive',
  read_document: 'drive',

  // ── Always available (web/research, producing deliverables, composition) ──
  web_search: null,
  fetch_url: null,
  browser_fetch: null,
  deep_research: null,
  rss_feed: null,
  get_pt_tenders: null,
  linkedin_post: null,
  present_linkedin_post: null,
  get_workflow_output: null,
  generate_document: null,
  run_compute: null,
  propose_standing_task: 'studio',
  steer_standing_task: 'studio',
  read_action_history: null,

  // ── Cross-coworker / tasks / skills / documents (always; the coworker section itself is gated elsewhere) ──
  find_team_work: null,
  read_team_work: null,
  list_worker_documents: null,
  get_worker_document: null,
  list_tasks: null, create_task: null, get_task: null, update_task: null,
  duplicate_task: null, delete_task: null, run_task: null,
  share_task: null, list_team_tasks: null, use_task: null,
  list_skills: null, apply_skill: null,

  // ── Integrations that gate themselves (connection / agent_tool_settings), not a workspace feature ──
  slack_list_channels: null, slack_post_message: null, slack_read_messages: null, slack_list_members: null,
  slack_read_channel: null, slack_send: null,
  compose_email: null,
};

/** Is this tool/step allowed under the given workspace features? Unknown tools → allowed. */
export function isToolAllowed(tool: string, features: WorkspaceFeatures): boolean {
  const req = TOOL_FEATURE[tool];
  if (req == null) return true;
  return features[req] !== false;
}

/** Filter a list of tool names to those allowed under the workspace features. */
export function allowedTools(names: string[], features: WorkspaceFeatures): string[] {
  return names.filter(n => isToolAllowed(n, features));
}
