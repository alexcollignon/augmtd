// Human-readable tool names for display contexts (e.g. usage breakdowns).
// Distinct from the "in-progress" chip phrasing in chat/route.ts and
// agentos-bridge.ts ("Checking inbox…") — this is for after-the-fact summaries,
// so plain noun form ("Check inbox") rather than a live gerund.
export const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web search',
  fetch_url: 'Read page',
  deep_research: 'Deep research',
  get_emails: 'Check inbox',
  get_email_body: 'Read email',
  get_meeting_context: 'Check calendar',
  search_knowledge_base: 'Search knowledge base',
  read_document: 'Read document',
  list_tasks: 'List tasks',
  create_task: 'Create task',
  get_task: 'Read task',
  update_task: 'Update task',
  run_task: 'Run task',
  duplicate_task: 'Duplicate task',
  delete_task: 'Delete task',
  share_task: 'Share task',
  list_team_tasks: 'List team tasks',
  use_task: 'Add team task',
  list_worker_documents: 'List documents',
  get_worker_document: 'Open document',
  generate_document: 'Generate document',
  compose_email: 'Draft email',
  send_email: 'Send email',
  send_calendar_invite: 'Send calendar invite',
  forward_email: 'Forward email',
  slack_list_channels: 'List Slack channels',
  slack_post_message: 'Post to Slack',
  slack_read_messages: 'Read Slack messages',
  slack_list_members: 'List Slack members',
  find_team_work: 'Find teammate work',
  read_team_work: 'Read teammate work',
  list_skills: 'List skills',
  apply_skill: 'Apply skill',
  request_clarification: 'Ask for clarification',
  present_linkedin_post: 'Present LinkedIn post',
  run_compute: 'Run computation',
};

export function humanizeToolName(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
