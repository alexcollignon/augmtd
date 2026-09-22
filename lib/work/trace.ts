// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRACE LINE — THE RECEIPT LAYER, IN ONE VOCABULARY (Sep 22).
//
// A coworker that reads your calendar, your Knowledge and your inbox before answering must SAY SO.
// Until now it could not: the only surface that ever rendered a tool chip was the /workers chat tab,
// retired Sep 22 (docs/retirement-census.md "Harvested" §1), and its chips were a second grammar —
// bordered pills beside the bubble. The receipt is not a widget. It is THE MUTED EVENT LINE the
// timeline already owns ("deltas, not events"): one line while the work runs, one line after.
//
// THE WORDING IS OURS AND IT IS HERE. This table is the trace's ONLY vocabulary. A tool that is not
// in it renders NOTHING — never its raw id, never the model's prose, never the executor's own first
// line (the drift `lib/work/tool-summaries.ts` was written to end). Silence about a tool we have no
// word for is honest; `search_knowledge_base` in a sentence a person reads is not.
//
// WHY A THIRD TABLE BESIDE TOOL_LABELS AND summarizeToolResult. They answer different questions:
//   · TOOL_LABELS            — what is happening (the in-flight chip's label)
//   · summarizeToolResult    — what this call FOUND ("Found 3 tasks") — per-call, quantitative
//   · TRACE_WORDING (here)   — what the coworker DID, in a sentence that folds with its siblings
// A fold needs phrases that survive being joined ("Checked the calendar · searched Knowledge"),
// which a count-bearing summary cannot do. Three questions, three tables, zero echoing.
//
// PURE and leaf: zero IO, zero React, zero imports. Read by both server runtimes (to persist) and
// by the thread kit (to render), so it can never drift into two spellings.
//
// ⚠️ WHERE IT IS NOT YET (Sep 22, deliberate): the HOME chat — the chief's own lane. Its door
// (`app/api/home/ask/route.ts`) streams `progress` labels and `token`s and emits no tool frames at
// all, so there is nothing to trace without first giving that lane the frames. That is its own
// slice; the kit piece, the wording table and the persist helper are lane-agnostic and already
// take it the day the frames exist.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What PERSISTS on an assistant turn: the tool and whether it worked. NEVER args, NEVER results —
 *  a receipt says what was consulted, and a stored argument is a second copy of the user's data. */
export type TraceEntry = { tool: string; ok?: boolean };

/** The three words a tool can wear in a trace line. `doing` is present tense (the call is open),
 *  `done` past tense (it settled), `failed` the honest word when it did not. */
export type TraceWords = { doing: string; done: string; failed: string };

/**
 * THE ONE TABLE. Keys track `TOOL_LABELS` in lib/work/tool-summaries.ts — when a tool is added
 * there, it earns a row here or it stays silent in the trace (silence is the safe default, so the
 * absence is never a lie). Written in the product's voice: a colleague reporting, not a log line.
 */
export const TRACE_WORDING: Record<string, TraceWords> = {
  // ── reading what the user already has ──────────────────────────────────────────────────────
  search_knowledge_base: { doing: 'Searching Knowledge…', done: 'Searched Knowledge', failed: 'Couldn’t search Knowledge' },
  read_document: { doing: 'Reading the document…', done: 'Read the document', failed: 'Couldn’t read the document' },
  list_worker_documents: { doing: 'Checking the documents…', done: 'Checked the documents', failed: 'Couldn’t reach the documents' },
  get_worker_document: { doing: 'Retrieving the document…', done: 'Retrieved the document', failed: 'Couldn’t retrieve the document' },
  get_emails: { doing: 'Checking your inbox…', done: 'Checked your inbox', failed: 'Couldn’t reach your inbox' },
  get_email_body: { doing: 'Reading the email…', done: 'Read the email', failed: 'Couldn’t read the email' },
  get_meeting_context: { doing: 'Checking your meetings…', done: 'Checked your meetings', failed: 'Couldn’t reach your meetings' },
  check_calendar: { doing: 'Checking the calendar…', done: 'Checked the calendar', failed: 'Couldn’t reach the calendar' },

  // ── reaching outside ───────────────────────────────────────────────────────────────────────
  deep_research: { doing: 'Researching…', done: 'Researched the web', failed: 'Couldn’t finish the research' },
  web_search: { doing: 'Searching the web…', done: 'Searched the web', failed: 'Couldn’t search the web' },
  fetch_url: { doing: 'Reading the page…', done: 'Read the page', failed: 'Couldn’t read the page' },

  // ── making something ───────────────────────────────────────────────────────────────────────
  run_compute: { doing: 'Running the numbers…', done: 'Ran the numbers', failed: 'Couldn’t run the numbers' },
  generate_document: { doing: 'Writing the document…', done: 'Wrote the document', failed: 'Couldn’t write the document' },
  compose_email: { doing: 'Drafting the email…', done: 'Drafted the email', failed: 'Couldn’t draft the email' },
  prepare_calendar_invite: { doing: 'Putting the invite together…', done: 'Prepared the invite', failed: 'Couldn’t prepare the invite' },
  prepare_event_action: { doing: 'Pulling up the meeting…', done: 'Pulled up the meeting', failed: 'Couldn’t find the meeting' },
  present_linkedin_post: { doing: 'Preparing the post…', done: 'Prepared the post', failed: 'Couldn’t prepare the post' },
  request_clarification: { doing: 'Preparing options…', done: 'Prepared options', failed: 'Couldn’t prepare options' },

  // ── the workflows lane ─────────────────────────────────────────────────────────────────────
  list_tasks: { doing: 'Checking your workflows…', done: 'Checked your workflows', failed: 'Couldn’t read your workflows' },
  get_task: { doing: 'Reading the workflow…', done: 'Read the workflow', failed: 'Couldn’t read the workflow' },
  create_task: { doing: 'Drafting the workflow…', done: 'Drafted the workflow', failed: 'Couldn’t draft the workflow' },
  update_task: { doing: 'Updating the workflow…', done: 'Updated the workflow', failed: 'Couldn’t update the workflow' },
  set_tasks_status: { doing: 'Updating your workflows…', done: 'Updated your workflows', failed: 'Couldn’t update your workflows' },
  duplicate_task: { doing: 'Duplicating the workflow…', done: 'Duplicated the workflow', failed: 'Couldn’t duplicate the workflow' },
  delete_task: { doing: 'Deleting the workflow…', done: 'Deleted the workflow', failed: 'Couldn’t delete the workflow' },
  run_task: { doing: 'Starting the workflow…', done: 'Started the workflow', failed: 'Couldn’t start the workflow' },
  supply_run_input: { doing: 'Handing it to the run…', done: 'Handed it to the run', failed: 'Couldn’t hand it to the run' },
  share_task: { doing: 'Sharing the workflow…', done: 'Shared the workflow', failed: 'Couldn’t share the workflow' },
  list_team_tasks: { doing: 'Checking the team’s workflows…', done: 'Checked the team’s workflows', failed: 'Couldn’t read the team’s workflows' },
  use_task: { doing: 'Adding the team’s workflow…', done: 'Added the team’s workflow', failed: 'Couldn’t add the team’s workflow' },

  // ── the team and its rooms ─────────────────────────────────────────────────────────────────
  find_team_work: { doing: 'Checking a teammate’s work…', done: 'Checked a teammate’s work', failed: 'Couldn’t reach a teammate’s work' },
  read_team_work: { doing: 'Reading a teammate’s work…', done: 'Read a teammate’s work', failed: 'Couldn’t read a teammate’s work' },
  slack_list_channels: { doing: 'Checking Slack channels…', done: 'Checked Slack channels', failed: 'Couldn’t reach Slack' },
  slack_read_messages: { doing: 'Reading Slack…', done: 'Read Slack', failed: 'Couldn’t reach Slack' },
  slack_post_message: { doing: 'Posting to Slack…', done: 'Posted to Slack', failed: 'Couldn’t post to Slack' },
  slack_list_members: { doing: 'Checking Slack members…', done: 'Checked Slack members', failed: 'Couldn’t reach Slack' },

  // ── method ─────────────────────────────────────────────────────────────────────────────────
  list_skills: { doing: 'Checking your skills…', done: 'Checked your skills', failed: 'Couldn’t read your skills' },
  apply_skill: { doing: 'Applying a skill…', done: 'Applied a skill', failed: 'Couldn’t apply the skill' },
};

/** THE ONLY DOOR TO THE WORDS. `null` for a tool we have no word for — the caller renders NOTHING
 *  rather than falling back to the id (the fallback IS the leak this table exists to prevent). */
export function traceWording(tool: string): TraceWords | null {
  return TRACE_WORDING[tool] ?? null;
}

/** One entry's phrase: present tense while the call is open, past tense once it settled, the honest
 *  word when it failed. `null` for an unknown tool — it contributes nothing to the line. */
export function tracePhrase(entry: TraceEntry): string | null {
  const w = traceWording(entry.tool);
  if (!w) return null;
  if (entry.ok === undefined) return w.doing;
  return entry.ok ? w.done : w.failed;
}

/** How many phrases a folded line shows before it counts the rest. A receipt is a glance. */
export const TRACE_LINE_CAP = 5;
/** How many entries may persist on one turn — a runaway loop never becomes a paragraph. */
export const TRACE_MAX = 12;

/** Lower-cases the opening letter of a joined phrase ("Searched Knowledge" → "searched Knowledge").
 *  Only the FIRST character, so the proper nouns inside a phrase survive ("read Slack"). */
const joinCase = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * THE FOLDED LINE — "Checked the calendar · searched Knowledge · read the thread".
 *
 * Order of EXECUTION (never alphabetical, never grouped by outcome — the reader is following what
 * happened). Repeats fold: a tool consulted three times says its word once. A failure never folds
 * into a success, because the key carries the outcome — "couldn't reach the calendar" is exactly
 * the thing a dedupe must not swallow.
 *
 * Returns `null` when nothing is sayable — an empty entry list, or one made entirely of tools this
 * table has no word for. A null line renders NOTHING (never an empty muted row).
 */
export function traceLine(entries: TraceEntry[], opts: { cap?: number } = {}): string | null {
  const cap = opts.cap ?? TRACE_LINE_CAP;
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const e of entries ?? []) {
    const key = `${e.tool}|${e.ok === undefined ? '?' : e.ok ? '1' : '0'}`;
    if (seen.has(key)) continue;
    const phrase = tracePhrase(e);
    if (!phrase) continue;          // an unknown tool is silent, not an id
    seen.add(key);
    phrases.push(phrase);
  }
  if (!phrases.length) return null;
  const shown = phrases.slice(0, cap);
  const rest = phrases.length - shown.length;
  const line = shown.map((p, i) => (i === 0 ? p : joinCase(p))).join(' · ');
  return rest > 0 ? `${line} · and ${rest} more` : line;
}

/**
 * THE ONE WRITER of `work_messages.metadata.trace` — the native DM route and the AgentOS bridge
 * both persist through THIS function, so the two coworker lanes cannot store two shapes.
 *
 * What goes in: the turn's tool calls IN EXECUTION ORDER with the outcome the executor observed.
 * What comes out: `{tool, ok}` and nothing else — no arguments, no results, no summaries. A trace
 * is a receipt, and a receipt that carries the payload is a copy of the payload.
 */
export function buildTrace(calls: Array<{ name: string; ok: boolean }>): TraceEntry[] {
  const seen = new Set<string>();
  const out: TraceEntry[] = [];
  for (const c of calls ?? []) {
    if (!c?.name || !traceWording(c.name)) continue;   // unsayable → unstored
    const key = `${c.name}|${c.ok ? '1' : '0'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tool: c.name, ok: !!c.ok });
    if (out.length >= TRACE_MAX) break;
  }
  return out;
}

/** Structural validation at the read end — a malformed stored trace renders nothing. */
export function isTraceEntry(v: unknown): v is TraceEntry {
  const e = v as TraceEntry | null;
  return !!e && typeof e === 'object' && typeof e.tool === 'string'
    && (e.ok === undefined || typeof e.ok === 'boolean');
}
