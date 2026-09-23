// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONFIRM POLICY (stabilization W0.3b — PART II invariant 1, HUMAN IN THE LOOP)
//
// THE HOLE (Sep 22): every lane that reads UNTRUSTED content (inbound mail via get_emails, the web
// via fetch_url/web_search, Slack reads, the knowledge base) also held tools that CHANGE STATE with
// no human click — a repointed deliverable recipient, a deleted task, a poisoned memory, a rewritten
// standing instruction. An injected email could do any of them through the model.
//
// THE LAW: from a tool-bearing lane, a state change of class A is PREPARED, never applied. The tool
// stores a pending change and hands the model a sentence that says "prepared, awaiting the click";
// the change becomes real ONLY through `POST /api/changes/[id]/apply`, on the user's own click,
// through the SAME executor the tool would have used, behind the commit door.
//
// THIS FILE IS THE ONE PLACE the classification lives. The three runtimes (native worker chat, the
// Home converse core, the AgentOS internal route) each ask `confirmClassOf(tool, args)` — never a
// private list of their own — and the gate (scripts/smoke-confirm-cards.ts) reads the class-A set
// from here to prove every runtime routes each class-A tool through the prepare path.
//
// PURE and leaf: zero IO, zero React. The SUMMARY of a change is COMPOSED BY CODE here from the
// tool's own arguments and the facts the store looked up (a task's name, an entity's name) — a
// model never writes the sentence a person confirms.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { isDmTarget } from '@/lib/tools/slack-target';

/** A = prepared, never applied until the click · B = safe to apply from a tool-bearing lane. */
export type ConfirmClass = 'confirm' | 'apply';

export type ConfirmPolicyRow = {
  cls: ConfirmClass;
  /** Why — written for the reader of this table, and read back by the gate's report. */
  reason: string;
};

/**
 * THE TABLE. A tool absent from it is treated as class A (confirm) by `confirmClassOf` — FAIL
 * CLOSED: a new mutating tool that nobody classified cannot slip into "apply".
 *
 * Class A (confirm):
 *   update_task           recipients/destination/output, schedule, instructions, steps — every field
 *                         but a bare status flip (see `updateTaskNeedsConfirm`)
 *   delete_task           irreversible
 *   share_task            widens who can read a pipeline (its prompts, its recipients)
 *   run_task              spends AI and may DELIVER to the task's configured recipients; injected
 *                         text triggering a run is the abuse class, so it confirms from every lane
 *   steer_standing_task   a persistent instruction on a standing task (worker_instructions)
 *   remember_fact         a persistent rule on an entity's memory (memory poisoning)
 *   slack_post_message    (W0.3c) an OUTWARD post in the user's name to people outside this app —
 *                         posts are sends; the lanes that hold it also read Slack/web/mail, so an
 *                         injected "post this to #general" must stop at a card. Class A from EVERY
 *                         chat lane (native worker chat + the AgentOS box).
 *
 * NOT IN THIS TABLE, by design:
 *   workflow `slack_send` steps and a task's Slack/email HOME — a user-authored, scheduled pipeline
 *                         step is the STANDING APPROVAL of the owner who built it; a run fires it
 *                         with no chat lane in between. A chat lane that would REPOINT such a step
 *                         (channel, text, destination) goes through update_task, already class A.
 *   send_calendar_invite · forward_email — not offered to any chat lane (workflow steps and the
 *                         prepared-card execute door only). Left unlisted they FAIL CLOSED here.
 *
 * Class B (apply) — each with the property that makes it safe:
 *   set_tasks_status      reversible by its own mirror, user-scoped, and decided by the USER'S OWN
 *                         WORDS in code (the direction/"all" floors) — not by the model's extraction
 *   update_task (status)  the same flip, one task, verified after write
 *   create_task           already a DRAFT behind the one creation card (nothing runs until Confirm)
 *   propose_standing_task already the spec card (SAYING PREPARES, COMMITTING STAYS EXPLICIT)
 *   duplicate_task        a PAUSED copy under the user's own account; reachable by no one else
 *   use_task              a PAUSED copy of a teammate's shared task
 *   supply_run_input      answers a run the user owns; every later gate of that run still parks
 *                         (A SUPPLY IS AN ANSWER, NOT AN ARRIVAL)
 *   compose_email         a DRAFT card; the Send is the user's click on the card (sendCoworkerEmail)
 *   prepare_calendar_invite · prepare_event_action · prepare_forward
 *                         PREPARE a card; the deed fires from the card's own door, never the tool
 *   present_linkedin_post display-only — it publishes nothing
 *   send_prepared_reply   hands the CLIENT a commit it fires through the one send route only when
 *                         the user's OWN words pass the EXPLICIT_SEND floor (code, not the model)
 *   reads                 list_tasks · get_task · list_team_tasks · list_worker_documents ·
 *                         get_worker_document · list_skills · apply_skill · slack_list_channels ·
 *                         slack_read_messages · slack_list_members
 */
export const CONFIRM_POLICY: Readonly<Record<string, ConfirmPolicyRow>> = {
  update_task: { cls: 'confirm', reason: 'recipients, destination, schedule, instructions and steps change what a task DELIVERS and to WHOM' },
  delete_task: { cls: 'confirm', reason: 'irreversible' },
  share_task: { cls: 'confirm', reason: 'widens who can read the pipeline and its recipients' },
  run_task: { cls: 'confirm', reason: 'spends AI and may deliver to configured recipients; injected text must not start a run' },
  steer_standing_task: { cls: 'confirm', reason: 'a persistent instruction on a standing task' },
  remember_fact: { cls: 'confirm', reason: 'a persistent rule on an entity’s memory' },
  slack_post_message: { cls: 'confirm', reason: 'an outward post in the user’s name; injected text must not reach a Slack channel' },

  set_tasks_status: { cls: 'apply', reason: 'reversible by its own mirror; direction and scope decided from the user’s own words in code' },
  create_task: { cls: 'apply', reason: 'already a draft behind the one creation card' },
  propose_standing_task: { cls: 'apply', reason: 'already the spec card — nothing is created until Confirm' },
  duplicate_task: { cls: 'apply', reason: 'a paused copy under the user’s own account' },
  use_task: { cls: 'apply', reason: 'a paused copy of a shared task' },
  supply_run_input: { cls: 'apply', reason: 'answers a run the user owns; later gates still park' },
  list_tasks: { cls: 'apply', reason: 'read' },
  get_task: { cls: 'apply', reason: 'read' },
  list_team_tasks: { cls: 'apply', reason: 'read' },
  list_worker_documents: { cls: 'apply', reason: 'read' },
  get_worker_document: { cls: 'apply', reason: 'read' },
  list_skills: { cls: 'apply', reason: 'read' },
  apply_skill: { cls: 'apply', reason: 'read' },
  compose_email: { cls: 'apply', reason: 'a draft card — the Send is the user’s click on the card' },
  prepare_calendar_invite: { cls: 'apply', reason: 'prepares a card; the invite fires only from the card’s Send' },
  prepare_event_action: { cls: 'apply', reason: 'prepares a card; the deed fires only from the card’s own door' },
  prepare_forward: { cls: 'apply', reason: 'opens the forward stage; approve stays the commit' },
  present_linkedin_post: { cls: 'apply', reason: 'display-only — publishes nothing' },
  send_prepared_reply: { cls: 'apply', reason: 'the client fires the send only when the user’s own words pass the EXPLICIT_SEND floor' },
  slack_list_channels: { cls: 'apply', reason: 'read' },
  slack_read_messages: { cls: 'apply', reason: 'read' },
  slack_list_members: { cls: 'apply', reason: 'read' },
};

/** The class-A set, derived from the table — the gate enumerates this, never a list of its own. */
export const CONFIRM_TOOLS: readonly string[] = Object.entries(CONFIRM_POLICY)
  .filter(([, r]) => r.cls === 'confirm').map(([t]) => t);

/** The fields of update_task that are NOT a bare status flip. Anything here → confirm. */
const STATUS_ONLY_KEYS = new Set(['task_id', 'status']);

/** A status-only update is the reversible flip class B already covers; every other field confirms. */
export function updateTaskNeedsConfirm(args: Record<string, unknown>): boolean {
  return Object.entries(args).some(([k, v]) => v !== undefined && !STATUS_ONLY_KEYS.has(k));
}

/** THE ONE QUESTION every runtime asks. Unknown tools FAIL CLOSED to 'confirm'. */
export function confirmClassOf(tool: string, args: Record<string, unknown> = {}): ConfirmClass {
  if (tool === 'update_task') return updateTaskNeedsConfirm(args) ? 'confirm' : 'apply';
  return CONFIRM_POLICY[tool]?.cls ?? 'confirm';
}

// ─── THE SUMMARY IS COMPOSED BY CODE ──────────────────────────────────────────────────────────────

/** The facts the store looked up before composing — never model prose. */
export type ChangeFacts = {
  /** The task's / standing task's current name, when the change is about one. */
  taskName?: string | null;
  /** The entity a remembered fact would land on. */
  entityName?: string | null;
  /** A Slack channel's display name ("#general"), looked up from its id — absent → the id shows. */
  channelName?: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown, n = 140): string => clip(String(v ?? '').trim(), n);

/** The output-config fields update_task may carry, each rendered as one change line. */
const OUTPUT_LINES: Array<[string, (v: unknown) => string]> = [
  ['output_email_to', (v) => (str(v) ? `Email recipients → ${str(v, 200)}` : 'Email recipients cleared (→ you)')],
  ['output_destination', (v) => `Delivers to → ${str(v)}`],
  ['output_slack_channel', (v) => `Slack channel → ${str(v)}`],
  ['output_artifact_type', (v) => `Document type → ${str(v)}`],
  ['output_title', (v) => `Title → "${str(v)}"`],
  ['output_report_mode', (v) => `Report → ${str(v)}`],
  ['output_language', (v) => `Language → ${str(v)}`],
  ['output_email_as_attachment', (v) => `Email delivery → ${v ? 'attachment' : 'body'}`],
  ['output_email_body_instructions', () => 'Email body instructions updated'],
  ['output_slack_announcement', () => 'Slack announcement updated'],
  ['output_notification', (v) => `Report → ${str(v)}`],
];

/**
 * ONE summary sentence + the detail lines a person confirms against. Pure: every string is derived
 * from the arguments and the looked-up facts, so the card can never show a claim the executor
 * would not make.
 */
export function describeChange(
  tool: string, args: Record<string, unknown>, facts: ChangeFacts = {},
): { summary: string; lines: string[] } {
  const task = facts.taskName ? `"${clip(facts.taskName, 80)}"` : 'this task';
  switch (tool) {
    case 'update_task': {
      const lines: string[] = [];
      if (typeof args.name === 'string') lines.push(`Rename → "${str(args.name, 80)}"`);
      if (typeof args.description === 'string') lines.push('Description updated');
      if (args.status === 'active' || args.status === 'paused') lines.push(`Status → ${args.status}`);
      if (args.trigger && typeof args.trigger === 'object') lines.push('Schedule changed');
      if (args.add_trigger_doors !== undefined) lines.push('Event doors added');
      if (args.remove_trigger_doors !== undefined) lines.push('Event doors removed');
      if (args.add_input_docs !== undefined) lines.push('Reference documents pinned');
      if (args.remove_input_docs !== undefined) lines.push('Reference documents unpinned');
      if (typeof args.input_accept_material === 'boolean') lines.push(`Accepts material at run time → ${args.input_accept_material ? 'yes' : 'no'}`);
      if (args.daily_run_limit !== undefined) lines.push(`Daily event limit → ${str(args.daily_run_limit, 10)}`);
      for (const [k, render] of OUTPUT_LINES) if (args[k] !== undefined) lines.push(render(args[k]));
      if (typeof args.worker_instructions === 'string') lines.push(`Task instructions → "${str(args.worker_instructions, 160)}"`);
      if (args.skill_names !== undefined) lines.push('Skills pinned');
      if (args.step_patch && typeof args.step_patch === 'object') {
        const sp = args.step_patch as Record<string, unknown>;
        lines.push(`Step edited${typeof sp.label === 'string' ? ` — "${str(sp.label, 60)}"` : ''}`);
      }
      if (Array.isArray(args.steps)) lines.push(`Pipeline replaced (${args.steps.length} steps)`);
      const head = lines[0] ?? 'Settings changed';
      return {
        summary: `Change ${task}: ${lines.length > 1 ? `${lines.length} settings` : head.toLowerCase()}`,
        lines,
      };
    }
    case 'delete_task':
      return { summary: `Delete ${task} permanently`, lines: ['This cannot be undone.'] };
    case 'share_task':
      return args.action === 'unshare'
        ? { summary: `Stop sharing ${task} with your team`, lines: ['Teammates will no longer see or copy it.'] }
        : { summary: `Share ${task} with your team`, lines: ['Teammates can read its steps and copy it.'] };
    case 'run_task':
      return { summary: `Run ${task} now`, lines: ['One run starts; it delivers wherever the task is set to deliver.'] };
    case 'steer_standing_task':
      return {
        summary: `Add a standing instruction to ${task}`,
        lines: [`"${str(args.instruction, 400)}"`, 'Every future run inherits it.'],
      };
    case 'remember_fact':
      return {
        summary: `Remember on ${facts.entityName ? `"${clip(facts.entityName, 80)}"` : 'this project'}`,
        lines: [`"${str(args.fact, 200)}"`, 'Future drafts respect it.'],
      };
    case 'slack_post_message': {
      // THE CARD NAMES WHERE AND WHAT, VERBATIM. The text is clipped for DISPLAY only — the stored
      // args carry the full message, and that is what the executor posts on Apply.
      const raw = String(args.channel ?? '').trim();
      const dm = isDmTarget(raw);
      const where = dm ? 'a direct message to you' : (facts.channelName ? clip(facts.channelName, 80) : clip(raw, 80) || 'Slack');
      const inThread = typeof args.thread_ts === 'string' && args.thread_ts.trim() !== '';
      const text = String(args.text ?? '').trim();
      const lines = [
        dm ? 'To: you (Slack DM)' : `Channel: ${where}`,
        ...(inThread ? ['As a reply in an existing thread'] : []),
        `"${clip(text, 600)}"`,
        dm ? 'Sent as your coworker’s Slack app.' : 'Posted as your coworker’s Slack app, labelled as yours.',
      ];
      return {
        summary: dm ? 'Send you a Slack DM' : inThread ? `Reply in a thread on ${where}` : `Post to ${where} on Slack`,
        lines,
      };
    }
    default:
      return { summary: `Apply ${tool.replace(/_/g, ' ')}`, lines: [] };
  }
}
