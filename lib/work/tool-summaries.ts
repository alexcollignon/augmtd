// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TOOL CHIP, ONE TABLE (Sep 22, WAVE 0 — THE PRESENTATION LAW's second instance).
//
// Two coworker lanes run the SAME executors and disagreed about how to show their results: the
// native loop hand-writes a summary per tool ("Found 3 tasks", "Task updated"), while the AgentOS
// bridge shipped `text.split('\n')[0]` — THE FIRST RAW LINE of whatever the executor returned — as
// the chip, and persisted it in work_messages.metadata.tool_calls. So on the bridge the chip for
// `list_tasks` read "Tasks (4):" and the chip for a KB search read the top of a context block.
//
// One table, both lanes. The law: a chip is text WE wrote. An unknown tool gets its label, never
// its result — silence about a tool we don't recognise is honest; its raw output is not.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Human labels for the in-flight chip (what the tool is DOING). Shared by the native loop and the
 *  AgentOS bridge — the bridge's own shorter copy was a second table that had already drifted
 *  (`get_meeting_context` read "Checking calendar" there and "Checking meetings & calendar" here). */
export const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: 'Searching knowledge base',
  read_document: 'Reading document',
  get_emails: 'Checking emails',
  get_email_body: 'Reading email',
  get_meeting_context: 'Checking meetings & calendar',
  check_calendar: 'Checking the calendar',
  deep_research: 'Researching…',
  web_search: 'Searching the web',
  fetch_url: 'Reading page',
  run_compute: 'Running the numbers',
  request_clarification: 'Preparing options',
  generate_document: 'Generating document',
  list_tasks: 'Checking tasks',
  create_task: 'Building task pipeline…',
  get_task: 'Reading task config',
  update_task: 'Updating task',
  set_tasks_status: 'Updating tasks',
  duplicate_task: 'Duplicating task',
  delete_task: 'Deleting task',
  run_task: 'Running task…',
  supply_run_input: 'Answering the run',
  share_task: 'Sharing task with team',
  list_team_tasks: 'Checking team tasks',
  use_task: 'Adding task from team…',
  list_worker_documents: 'Checking documents',
  get_worker_document: 'Retrieving document…',
  compose_email: 'Drafting email…',
  prepare_calendar_invite: 'Putting the invite together…',
  prepare_event_action: 'Pulling up that meeting…',
  present_linkedin_post: 'Preparing LinkedIn post…',
  find_team_work: 'Checking a teammate’s work',
  read_team_work: 'Reading a teammate’s work',
  slack_list_channels: 'Checking Slack channels',
  slack_post_message: 'Preparing a Slack post',
  slack_read_messages: 'Reading Slack',
  slack_list_members: 'Checking Slack members',
  list_skills: 'Checking skills',
  apply_skill: 'Applying a skill',
};

/** The in-flight label. An unknown tool reads as its own name, de-underscored — never blank. */
export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name.replace(/_/g, ' ');

/** Did the executor say it could not do the thing? Deterministic and narrow — it reads only the
 *  sentences OUR executors write, so a chip can say "not done" without quoting the reason. */
const failed = (text: string): boolean =>
  /^(?:failed |could not |couldn'?t |i could ?n'?t |i couldn'?t |no worker context|task not found|nothing to update)/i.test(text.trim());

/**
 * DID THE CALL WORK? — the one outcome read, shared by both coworker runtimes (lib/work/trace.ts's
 * `ok`). It reads ONLY the sentences our own executors write, exactly as `summarizeToolResult`
 * does, so the trace line's "Couldn't reach the calendar" and the chip's "Task not updated" can
 * never disagree about the same call. Conservative by construction: anything it cannot read as a
 * refusal is a success — a trace that cried failure on an unfamiliar sentence would be the lie.
 */
export function toolResultOk(name: string, result: unknown): boolean {
  const text = typeof result === 'string' ? result : '';
  if (!text.trim()) return true;
  if (failed(text)) return false;
  // Two executors report their refusal as a plain sentence with no refusal opening — the same two
  // `summarizeToolResult` special-cases above.
  if (name === 'delete_task') return /permanently deleted/.test(text);
  if (name === 'run_task') return /is now running|is already running/.test(text);
  return true;
}

/** Rows counted out of a listing whose header our own executors write ("Tasks (4):"). */
const countIn = (text: string, head: RegExp): number | null => {
  const m = text.match(head);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * THE CHIP IS OURS — a short summary of a tool's result, written here, never lifted from it.
 * Curated per tool where the count is worth saying; otherwise the tool's own label. The result
 * string is read ONLY through the narrow shapes our executors produce (a header count, a failure
 * opening) — never echoed.
 */
export function summarizeToolResult(name: string, result: unknown): string {
  const text = typeof result === 'string' ? result : '';
  const label = TOOL_LABELS[name];
  if (!text.trim()) return label ? `${label.replace(/…$/, '')} — done` : 'Done';

  switch (name) {
    case 'list_tasks': {
      const n = countIn(text, /^Tasks \((\d+)\)/);
      return n === null ? 'Checked tasks' : n > 0 ? `Found ${n} task${n === 1 ? '' : 's'}` : 'No tasks found';
    }
    case 'get_task': return failed(text) ? 'Task not found' : 'Task config retrieved';
    case 'create_task': return failed(text) ? 'Task not created' : 'Task drafted — awaiting your confirm';
    case 'update_task': return failed(text) ? 'Task not updated' : 'Task updated';
    case 'duplicate_task': return failed(text) ? 'Task not duplicated' : 'Task duplicated';
    case 'delete_task': return /permanently deleted/.test(text) ? 'Task deleted' : 'Task not deleted';
    case 'run_task': return /is now running|is already running/.test(text) ? 'Task started' : 'Task not started';
    case 'set_tasks_status': return failed(text) ? 'Nothing changed' : 'Tasks updated';
    case 'share_task': return failed(text) ? 'Sharing unchanged' : 'Task sharing updated';
    case 'list_team_tasks': return 'Team tasks listed';
    case 'use_task': return failed(text) ? 'Task not added' : 'Task added from team';
    case 'supply_run_input': return failed(text) ? 'Not supplied' : 'Handed to the run';
    case 'search_knowledge_base': return /no (?:relevant|matching)/i.test(text) ? 'No relevant documents found' : 'Searched the knowledge base';
    case 'read_document': return failed(text) ? 'Document not found' : 'Document read';
    case 'get_emails': return /^no emails|no matching emails/i.test(text) ? 'No matching emails found' : 'Inbox checked';
    case 'get_email_body': return failed(text) ? 'Email not found' : 'Email read';
    case 'get_meeting_context': return /^no processed/i.test(text) ? 'No meetings found' : 'Meeting context retrieved';
    case 'check_calendar': return 'Calendar checked';
    case 'run_compute': return failed(text) ? 'Compute failed' : 'Computed';
    case 'generate_document': return failed(text) ? 'Generation failed' : 'Document created';
    case 'compose_email': return failed(text) ? 'Email not drafted' : 'Drafted an email';
    case 'prepare_calendar_invite': return failed(text) ? 'Invite not prepared' : 'Prepared a calendar invite';
    // THE EVENT CARD (Wave 2): the chip says the meeting was pulled up — never WHICH verb is armed,
    // because the armed verb is a thing the user is about to decide, not a thing that happened.
    case 'prepare_event_action': return failed(text) ? 'Meeting not found' : 'Pulled up the meeting';
    case 'present_linkedin_post': return 'Presented LinkedIn post';
    case 'deep_research': return 'Research complete';
    case 'web_search': return 'Web search done';
    case 'fetch_url': return 'Page read';
    default:
      // AN UNKNOWN TOOL NEVER SPEAKS ITS RESULT. Its label (or its name) is all the chip says.
      return label ? `${label.replace(/…$/, '')} — done` : 'Done';
  }
}
