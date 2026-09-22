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
  // …and the draft door (Sep 21): it reads the user's inbox to find the message being answered,
  // so it is a mailbox verb like the rest — a sovereign workspace never sees it offered.
  draft_reply: 'email',

  // ── Meetings / calendar ──
  get_meeting_context: 'meetings',
  get_calendar: 'meetings',
  // The chief's read-side availability verb (Wave 1) — it only READS the calendar, but a workspace
  // without meetings has no calendar to read, and a tool that could speak "you're free Thursday"
  // there would be a claim the account cannot deliver.
  check_calendar: 'meetings',
  send_calendar_invite: 'meetings',
  // The invite CARD's producer (chat, both surfaces). It prepares and never sends — but it is a
  // calendar verb, so a workspace without meetings never sees it offered (the tier law: capability
  // shapes content; a chip is a claim).
  prepare_calendar_invite: 'meetings',
  // The EVENT CARD's producer (Wave 2, Sep 22) — same reasoning, one object over: it prepares a
  // card over a meeting that already exists and never writes; a workspace without meetings has no
  // calendar for it to read, so it is never offered there.
  prepare_event_action: 'meetings',

  // ── Bulk deeds over the held-quiet ledger (attention-plan A7) ──
  // The deed PREVIEWS and never acts; the commit is the user's click. Gated on `email` because
  // every class it acts on is built from mail — on an email-off workspace the ledger holds nothing
  // for it to name, and a tool that could speak "archive the newsletters" there would be a claim
  // the account cannot deliver (the sovereign copy law: capability shapes vocabulary).
  prepare_bulk_deed: 'email',

  // ── Drive / knowledge base ──
  search_knowledge_base: 'drive',
  read_kb_file: 'drive',
  read_kb_folder: 'drive',
  read_document: 'drive',

  // ── Always available (web/research, producing deliverables, composition) ──
  web_search: null,
  fetch_url: null,
  browser_fetch: null,
  deep_research: null,
  rss_feed: null,
  get_pt_tenders: null,
  match_to_profiles: 'drive',           // reads a folder of profile documents in the knowledge base
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
  // ── TASKS ARE THE STUDIO FEATURE (Sep 21). They sat on `null` (always on) while their siblings
  // propose_standing_task / steer_standing_task were 'studio'-gated — so a Studio-off workspace
  // could pause a task through a coworker and could not propose one through the chief. Aligned to
  // 'studio' after checking every live workspace: exactly one has `studio: false` and it has ZERO
  // members, so nothing running loses a verb.
  list_tasks: 'studio', create_task: 'studio', get_task: 'studio', update_task: 'studio',
  duplicate_task: 'studio', delete_task: 'studio', run_task: 'studio',
  share_task: 'studio', list_team_tasks: 'studio', use_task: 'studio',
  supply_run_input: 'studio',
  // THE BULK STATUS DEED (Sep 21) — one server-side loop, one per-item ledger; same gate as its siblings.
  set_tasks_status: 'studio',
  list_skills: null, apply_skill: null,
  // The remaining conversational door, stated so the map covers every chat tool (a missing row is
  // "always on" — true here, but silence is how drift starts).
  request_clarification: null,

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
