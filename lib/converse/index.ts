// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CONVERSATION CORE (P6b) — every chat surface (deep-dive rail, Home ask, entity ask) wires
// here; none owns logic. Agent-over-registry, not router-plus-executor:
//
//   • The FAST-PATH (the 80%): one cheap classification decides whether the turn is a simple COMMAND
//     ("dismiss this", "mark done", "find the deck", "have Max research X"), a QUESTION, or a
//     CORRECTION — commands dispatch DIRECTLY onto the registry executors (~1 small call total).
//   • The AGENT LOOP (the 20%): composite/open turns run a bounded function-calling loop holding the
//     CHIEF-OF-STAFF exposure slice of the capability registry (lib/home/capability-map.ts
//     `capabilitiesFor('chief_of_staff')`) — it composes, reasons, and calls tools mid-answer.
//
// SAFETY IS STRUCTURAL: the chief-of-staff slice holds reversible tools (resolve/find/remember)
// plus — THE PARITY LAW (Aug 4: every UI verb must be sayable) — exactly ONE send-shaped tool:
// send_prepared_reply. It never sends from here; it returns a `commit` the CLIENT fires through
// the one existing send door (route + hash guard + outcome log), and only behind a DETERMINISTIC
// explicit-send floor on the user's own words. prepare_forward prepares and points at the stage;
// the approve click stays the commit. Reversible acts are undoable via /api/restore.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { stripGroundingRefs } from '@/lib/utils/strip-grounding-refs';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { clipForPrompt, clipLabel, EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { clipWithRule, packContext } from '@/lib/utils/pack-context';
import { GROUND_EVIDENCE_RULE } from '@/lib/room/ground-evidence';
import { capabilitiesFor } from '@/lib/home/capability-map';
// THE PRESENTATION LAW (Sep 22) — the opt-IN permission to serve a tool's string as the answer
// lives on the registry row, not in a local set here. See the law's note below.
import { resultIsProse, resultIsPresentation, presentsCollectionKind } from '@/lib/work/surface-registry';
// WAVE 1 — THE COLLECTION CARD: the contract both halves read, and the builders that fill it.
import type { CollectionSpec } from '@/lib/present/collection';
import { isListingAsk } from '@/lib/present/listing-ask';
// WAVE 2 — THE EVENT CARD: one calendar object, the verbs its state allows, nothing fired from here.
import type { EventSpec } from '@/lib/present/event';
// THE CONFIRM CARD (stabilization W0.3b — HUMAN IN THE LOOP): the Home chat reads untrusted mail
// and the web, so a class-A change (run a task · a standing instruction · a remembered fact) is
// PREPARED here and applied only through /api/changes/[id]/apply on the user's own click.
import { changeSayLine, type ChangeSpec } from '@/lib/present/change';
import { prepareChange } from '@/lib/work/pending-change';
import { prepareEventActionDefinition, executePrepareEventAction } from '@/lib/tools/prepare-event-action';
import {
  executeResolveInboxItem, executeResolveCommitment, executeFindFile, executeRememberFact,
  resolveInboxItemDefinition, resolveCommitmentDefinition, findFileDefinition, rememberFactDefinition,
} from '@/lib/tools/item-actions';
import { getEmailsDefinition, executeGetEmails, getMeetingContextDefinition, checkCalendarDefinition, readActionHistoryDefinition, executeReadActionHistory, type ActionHistoryConfig, runComputeDefinition, executeRunCompute, type ComputeConfig } from '@/lib/tools';
// WAVE 1 — the two reads whose executors now hand back BOTH halves (the model's block and the
// struct the card is built from). The dispatch reads the data function; the thin string wrappers
// stay for every other caller.
import { readMeetingContext } from '@/lib/tools/get-meeting-context';
import { readCalendar } from '@/lib/tools/check-calendar';
// THE WEEKDAY FLOOR (Wave 1) — deterministic, applied at the one outermost answer seam below.
import { enforceWeekdayDatePairs } from '@/lib/utils/weekday-floor';
// THE TASK VERBS' ONE SET OF EXECUTORS (Sep 21) — the chief door calls the SAME functions the
// coworker door calls; only the scope (agentId null = the user's whole set) and the by-name
// resolution differ. A second implementation is how two doors start disagreeing.
import {
  setTasksStatusDefinition, executeSetTasksStatus, executeListTasks, executeGetTask,
  resolveTaskIdByName, spokenIsResumeNotRun,
} from '@/lib/tools/worker-tasks';
// THE DEED FLOOR (Sep 21) — the chief's answer is held to the turn's own mutation ledger.
import { deedFloorVerdict, deedAmendment, type DeedRecord } from '@/lib/work/deed-floor';
// THE REF IS ITS TAG (Sep 21) — the ask lane's resolver, mounted at this core's ONE exit so the
// ref-tag floor strips only what nobody resolved.
import { stripUnresolvedTags } from '@/lib/home/ask-refs';
// THE REACH VALVE (Sep 18) — the model's own judgment that a question needs a lookup.
import { REACH_CONTRACT, needsReach, sayInsteadOfSentinel } from '@/lib/converse/reach';
// HANDS FOR THE SCOPE (Sep 21) — THE OFFER LAW, the forward-motion floor, and the deterministic
// reply-target ladder. See lib/converse/hands.ts for the incident these three laws answer.
import {
  renderOfferLaw, unavailableToolResult, isAffirmation, endsInAnOffer, repeatsTheQuestion,
  FORWARD_MOTION_DIRECTIVE, pickReplyTarget, looksPasted, pastedAsSourceData,
  type ReplyCandidate,
} from '@/lib/converse/hands';
import { proposeStandingTaskDefinition } from '@/lib/work/standing-spec';
// EVERY THREAD, EVERY PRODUCER (threads plan, Sep 8): the invite card's producer is ONE tool
// contract + ONE execution body, shared with the coworker DM. It prepares and never sends — and
// the executor that DOES send is in no chat slice at all.
import { prepareCalendarInviteDefinition, executePrepareCalendarInvite, inviteCardLine } from '@/lib/tools/prepare-calendar-invite';
import { prepareBulkDeedDefinition, executePrepareBulkDeed } from '@/lib/tools/prepare-bulk-deed';
import { steerStandingTaskDefinition } from '@/lib/workflows/standing';
import { downloadKbFile } from '@/lib/knowledge/file-bucket';
import {
  executeMoveItemToProject, executeSetProjectStatus, executeMergeProjects, executeCreateProject, executeCreateTaskItem, resolveItemByDescription,
  moveItemToProjectDefinition, setProjectStatusDefinition, mergeProjectsDefinition, createProjectDefinition, createTaskItemDefinition,
} from '@/lib/tools/project-actions';

// KB content search for the chief loop — wraps the existing grounded KB context builder (retrieval,
// not a new capability; the registry row is `search_knowledge_base`).
const searchKnowledgeDefinition = {
  name: 'search_knowledge_base',
  description: "Search the user's knowledge base (indexed documents, meeting notes, uploads) by topic and read the matching content. Use to CHECK facts in documents.",
  input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

// THE PARITY LAW (Aug 4) — the two send-shaped verbs, sayable like every other verb.
const sendPreparedReplyDefinition = {
  name: 'send_prepared_reply',
  description: 'Send the ALREADY-DRAFTED reply on the current item. Use ONLY when the user explicitly says to send ("send it", "envia"). Never to create a draft.',
  input_schema: { type: 'object', properties: {}, required: [] },
};
// HANDS FOR THE SCOPE (Sep 21 — the pilot's dead-ended "yes please"): the Home chat could read a
// calendar and offer to write to someone, and then had NOTHING that writes to someone. `draft_reply`
// is that hand. It PREPARES and never sends: a matched inbox item's draft lands on the item (the
// one redraft lane, versioned + evaluated + composer-served), an unmatched one comes back as plain
// text the user copies. The send door stays exactly where it was — send_prepared_reply, behind the
// deterministic explicit-send floor.
const draftReplyDefinition = {
  name: 'draft_reply',
  description:
    'Draft a reply to a message for the user to review — the reply the CONVERSATION has been about. ' +
    'Use this whenever the user asks you to reply, respond, answer, write back or offer something to ' +
    'someone by email, and whenever they agree to an offer you made to do so. It never sends: it ' +
    'prepares the draft and hands it back.',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: "who the reply goes to — their name or address, in the user's words" },
      about: { type: 'string', description: 'the subject or topic of the message being replied to' },
      instruction: { type: 'string', description: 'what the reply must say or do, in one or two sentences, including any concrete details (times, options, figures) already settled in this conversation' },
    },
    required: ['instruction'],
  },
};
const prepareForwardDefinition = {
  name: 'prepare_forward',
  description: 'Prepare forwarding the current email to someone for the user to review & approve. Never sends by itself.',
  input_schema: { type: 'object', properties: { to: { type: 'string', description: 'recipient, when the user names one' } }, required: [] },
};

// ── THE TASK VERBS REACH THE HOME (Sep 21, CLASS 2 — "a verb has every conversational door").
// Live incident: the Home chat answered "I don't have a tool to pause workflows" while a coworker
// DM had been pausing them for months. The chief's slice is deliberately narrow — SEE what is
// automated, READ one, CHANGE ITS STATUS, RUN it now — and every one of them resolves BY NAME
// through the one ladder (a raw id is useless in conversation). Creation stays on the confirm card
// (propose_standing_task) and the full pipeline editor stays with the coworker who owns the task;
// both exemptions are written on their registry rows as `chiefExempt`. ──
const listTasksChiefDefinition = {
  name: 'list_tasks',
  // THE PRESENTATION LAW (Sep 22): the instruction to the MODEL lives here, in the description,
  // never inside the result string (that line shipped in an owner's chat bubble verbatim).
  description: "List the user's automated tasks — what is running, on what schedule, when it last ran, and which coworker owns it. Call whenever they ask what is automated, what is running, or before acting on a task they named. The result is DATA for you, not text to show: write the answer yourself, name tasks by NAME, and never repeat the ids.",
  input_schema: { type: 'object', properties: {} as Record<string, unknown>, required: [] as string[] },
};
const getTaskChiefDefinition = {
  name: 'get_task',
  description: "Read one task's full configuration (schedule, steps, output, triggers). Give the task's NAME as the user says it. The result is DATA for you — an internal dump of step ids, raw prompts and config: answer in your own words, and never show ids, prompts or JSON to the user.",
  input_schema: {
    type: 'object',
    properties: { task_name: { type: 'string', description: "the task's name, in the user's own words" } },
    required: ['task_name'],
  },
};
const runTaskChiefDefinition = {
  name: 'run_task',
  description: 'Run an existing task RIGHT NOW. Give the task\'s NAME as the user says it. Only on their explicit ask ("run the weekly briefing"). NOT for "resume" / "unpause" — that turns the schedule back on, which is set_tasks_status.',
  input_schema: {
    type: 'object',
    properties: { task_name: { type: 'string', description: "the task's name, in the user's own words" } },
    required: ['task_name'],
  },
};

// ── THE DISPATCHER + THE SENSIBLE ASK (Aug 8) — production asks reach the team without the user
// routing; decisions reach the user ONLY when consequential and non-inferable. ──
const assignToCoworkerDefinition = {
  name: 'assign_to_coworker',
  description: "Assign a production task (a report, draft, research, analysis, post) to the best-fit coworker on the user's team and start the work NOW. Use when the user asks for produced work WITHOUT naming who — pick the obvious fit yourself (writing/documents/reports/ops/admin/inbox/calendar → Clara, the chief of staff · research/analysis → Max · branding/design/LinkedIn → Luca). Reversible: the work reports back into this conversation; nothing external is sent.",
  input_schema: { type: 'object', properties: {
    coworker: { type: 'string', description: 'first name or role of the coworker' },
    task: { type: 'string', description: "the task in one clear sentence, in the user's own terms" },
  }, required: ['coworker', 'task'] },
};
const offerChoicesDefinition = {
  name: 'offer_choices',
  description: 'Put ONE genuinely consequential, non-inferable decision to the user as tappable options. Use SPARINGLY — never for choices you can infer from context, never to confirm reversible actions, at most once per turn. Each option is the exact message sent on their behalf when tapped.',
  input_schema: { type: 'object', properties: {
    question: { type: 'string', description: 'one short sentence stating the decision' },
    options: { type: 'array', items: { type: 'object', properties: {
      label: { type: 'string', description: '2-5 word button label' },
      say: { type: 'string', description: 'the message sent when tapped' },
    }, required: ['label', 'say'] } },
  }, required: ['question', 'options'] },
};

export type ConverseScope =
  | { kind: 'item'; itemKind: 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness'; itemId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'global' };

export type ConverseHistoryTurn = {
  role: 'user' | 'assistant'; text: string;
  /** REVISION-IN-PLACE (DH7): an assistant turn that produced a document carries its card ref,
   *  so "make the chart blue" resolves to THAT artifact and revises it instead of minting a
   *  second one. The client sends what it already renders. */
  artifact?: { id: string; threadId: string; title: string };
};

/** THE ATTACHED MATERIAL (Aug 10, the production hand-off): synchronously-extracted text of
 *  files the user attached WITH this message — rides the turn itself, so a "fill this in"
 *  never races the KB's background indexing. Images carry BYTES (THE MOMENT THEME: "brand
 *  this with the attached logo" builds the theme on the spot). Office files ≤1MB ALSO carry
 *  bytes (TEMPLATE-BY-EXAMPLE: "follow this template" needs the real file, not its text). */
export type ConverseAttachment = { name: string; text: string | null; image?: { dataB64: string; mime: string }; file?: { dataB64: string; ext: string } };

// ── THE PROGRESS CHANNEL (streaming ask, Aug 6): human labels for what the core is DOING right
// now — surfaced live over SSE so a long agent loop never reads as a dead "Thinking…". Labels
// speak consequence in the user's words (law 4), never tool names. One map — a new chief tool
// without a label falls back to the generic line, never to silence. ──
/** THE CONTEXT BUDGET (W2.7): the open loop's packed page (rules + transcript + grounding) and the
 *  loop's own honest ceiling above it (a retry prefix may ride on top of the packed page). */
const LOOP_CONTEXT_BUDGET = 8000;
/** A hand-back PREVIEW the user reads (and the next turn's history carries): cut at a sentence/word
 *  boundary with a plain ellipsis — never mid-word (the T2 class: a quoted mid-word cut read back as
 *  "the work stops at …"). The full text lives in the coworker's conversation. */
const previewOf = (t: string, max: number): string =>
  t.length <= max ? t : `${clipForPrompt(t, max).replace(` ${EXCERPT_MARK}`, '')}…`;
const LOOP_CONTEXT_CEILING = 9000;

const TOOL_PROGRESS: Record<string, string> = {
  find_file: 'Searching your files…',
  search_knowledge_base: 'Searching the knowledge base…',
  get_emails: 'Reading recent mail…',
  get_meeting_context: 'Pulling the meeting notes…',
  check_calendar: 'Checking your calendar…',
  read_action_history: 'Checking what was sent and done…',
  run_compute: 'Running the numbers…',
  resolve_inbox_item: 'Updating the item…',
  resolve_commitment: 'Updating the commitment…',
  remember_fact: 'Noting that down…',
  move_item_to_project: 'Filing it on the project…',
  set_project_status: 'Updating the project…',
  merge_projects: 'Merging the projects…',
  create_project: 'Creating the project…',
  create_task_item: 'Creating the task…',
  send_prepared_reply: 'Checking the prepared reply…',
  prepare_forward: 'Preparing the forward…',
  draft_reply: 'Writing the reply…',
  prepare_calendar_invite: 'Putting the invite together…',
  prepare_event_action: 'Pulling up that meeting…',
  prepare_bulk_deed: 'Working out exactly what that would do…',
  propose_standing_task: 'Drafting the standing task…',
  steer_standing_task: 'Adjusting how that task runs…',
};
const progressLabelFor = (tool: string) => TOOL_PROGRESS[tool] ?? 'Working on it…';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRESENTATION LAW (Sep 22, WAVE 0) — A TOOL RESULT IS DATA, NEVER THE ANSWER.
//
// The incident (owner screenshot, Home chat): "what workflows do I have in place?" put the
// executor's model-facing listing in the assistant's bubble verbatim — bracketed uuids, and the
// closing instruction "Refer to tasks by NAME when speaking to the user" — and PERSISTED it.
//
// The cause was the guard's polarity. The fast path served `dispatchCommand().say` as the answer
// and excused four tool names by OPT-OUT set; every read tool shipped after it leaked by default.
// Now the registry says which is which (`resultIs`, absent = 'data' = fail closed) and the return
// TYPE carries the same law: a data read comes back as `ToolData`, a shape `ConverseTurn` cannot
// absorb, so no future branch can serve one by accident.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A read's result: a block written FOR THE MODEL. It reaches a `role:'tool'` message and nowhere
 *  else — the agent loop composes the answer from it. */
export type ToolData = {
  modelText: string;
  /** WAVE 1 — THE COLLECTION CARD (Sep 22): the same read, STRUCTURED, for the kit to render —
   *  typed rows and a framing sentence composed by code (lib/present/collection.ts). W0 reserved
   *  this seam as `{kind, rows}` and left it unpopulated; Wave 1 fills it with the contract's own
   *  `CollectionSpec`, which is that shape plus the code-written framing and the re-read key.
   *  Its presence is what lets a pure LISTING ask skip the model entirely (see THE FAST PATH IS
   *  FAST AGAIN, below).
   *  WAVE 2 (Sep 22) widens it to the SINGLE-OBJECT card: `{kind:'event', spec}` — same seam, same
   *  law (it never reaches the model; the model reads `modelText` and nothing else). */
  present?: CollectionSpec | EventPresent;
};

/** THE EVENT CARD's half of `present` — one object, its facts, and the verbs code computed for it. */
export type EventPresent = { kind: 'event'; spec: EventSpec };
export const isEventPresent = (p: ToolData['present']): p is EventPresent =>
  !!p && (p as EventPresent).kind === 'event';
const isToolData = (o: ConverseTurn | ToolData | null): o is ToolData =>
  !!o && typeof (o as ToolData).modelText === 'string';

export type ConverseTurn = {
  say: string;
  /** THE REF IS ITS TAG (Sep 21): a ref the ask lane resolved carries the grounding tag it was
   *  resolved FROM, so the exit floor below can keep the notation that earned a chip and strip only
   *  the notation nobody resolved. Optional — most lanes serve refs with no tags at all. */
  refs: Array<{ id?: string; kind?: string; label: string; href: string | null; tag?: string }>;
  files?: Array<{ id: string; filename: string; source: string }>;
  /** Reversible actions the turn APPLIED (already done, undoable) — the surface confirms them. */
  applied?: Array<{ tool: string; title: string }>;
  /** The correction path's reworked draft (item scope) — the surface re-seeds its composer. */
  draft?: string | null;
  learned?: string[];
  entityName?: string | null;
  delegated?: { agentName: string; agentId?: string } | null;
  /** THE PARITY LAW (Aug 4): a chat-approved send — the CLIENT fires this through the one send
   *  door (/api/inbox/[id]/send-reply). Emitted ONLY behind the explicit-send floor. */
  commit?: { kind: 'send_reply'; itemId: string; body: string } | null;
  /** THE INVITE CARD (threads plan — THE CARD CONTRACT): a chat-born prepared invite, rendered
   *  INLINE by the same kit card every other producer lands. `id` is its stored payload's ref —
   *  the Send door reads THAT row, never these fields. Nothing is sent until the user clicks. */
  invite?: { id: string; invite: Record<string, unknown> } | null;
  /** THE BULK DEED (attention-plan A7): a chat-born deed over a held-quiet class, rendered INLINE
   *  by the kit's `bulk` card. `id` is the stored deed row's ref — the commit door reads THAT row
   *  and nothing else, so the model can never widen what it previewed. Nothing acts until the
   *  user clicks. */
  bulkDeed?: { id: string; deed: Record<string, unknown> } | null;
  /** THE EMAIL CARD (Sep 21 — the owner's convergence call). ONE field, two lanes, ONE rendering:
   *  a matched inbox item rides as `itemId` (the card reads that item's own prepared reply), and a
   *  STANDALONE draft — a message in no inbox of ours — rides as its stored row's `id` plus the
   *  payload for the first paint. The Send door reads the store, never these fields, and nothing
   *  is sent until the user clicks: the model returns a CARD and can never return a commit. */
  emailDraft?: { id: string; itemId?: string; draft?: Record<string, unknown> } | null;
  /** A verb whose review lives on a stage — the client summons it (forward/invite/reply). */
  openStage?: { stage: 'forward' | 'invite' | 'reply'; itemId: string } | null;
  /** THE SENSIBLE ASK (Aug 8): ONE consequential decision as tappable options — each tap SPEAKS
   *  its `say` through the composer (clicks are utterances). Ephemeral scaffolding, never persisted. */
  options?: Array<{ label: string; say: string }>;
  /** THE ONE CREATION CARD (Aug 10): a drafted standing task reviews INLINE in this
   *  conversation — Confirm fires the one create door; nothing runs until then. */
  workflowDraft?: Record<string, unknown> | null;
  /** ARTIFACTS-INTO-ORIGIN (Aug 9): the dispatched deliverable's REAL artifact rides back into
   *  the conversation that asked — the surface renders its card and opens the viewer, instead of
   *  pointing the user at another conversation. */
  artifact?: { id: string; title: string; threadId: string; agentName: string; type?: string } | null;
  /** MULTI-DELIVERABLE: every file the hand-off produced (a report AND a deck each get a card).
   *  THE TYPE IS STATED, NOT GUESSED (W4-C, Sep 22): `type` is THE ONE PRODUCTION DOOR's own
   *  verdict for the bytes (`document` · `presentation` · `spreadsheet` · `frame`) — it rides from
   *  `materializeDocument` through the delegation so the card wears the right kind and the right
   *  word, instead of the chat lane hard-coding "document" over a frame. */
  artifacts?: Array<{ id: string; title: string; threadId: string; agentName: string; type?: string }>;
  /** WAVE 1 — THE COLLECTION CARD (Sep 22): the user's OWN objects (workflows · documents ·
   *  recordings · a day of the calendar), rendered by the kit as ONE card. `id` is a render key;
   *  the spec carries its own re-read key (`spec.params`), because a persisted card is a POINTER
   *  and re-derives its rows on reload — never a stale snapshot. On a listing ask the card IS the
   *  turn (with `say` = the code-written framing); on an analytical one it rides BESIDE the prose. */
  collection?: { id: string; spec: CollectionSpec } | null;
  /** WAVE 2 — THE EVENT CARD (Sep 22): ONE meeting already on the user's calendar, rendered by the
   *  kit with the verbs its own state allows. `id` is the calendar_events id — the card's own
   *  re-read key (`GET /api/events/<id>/card`) and the address its verbs act through
   *  (`POST /api/events/<id>/deed`), because a persisted card is a POINTER, never a snapshot.
   *  NOTHING is fired from here: the spec may carry an ARMED proposal, and the user's click is the
   *  deed (THE HUMAN-IN-THE-LOOP LAW). */
  event?: { id: string; spec: EventSpec } | null;
  /** THE CONFIRM CARD (stabilization W0.3b): a class-A state change PREPARED for the user's click,
   *  rendered by the kit's approval card through ONE host (components/home/change-card.tsx). `id`
   *  is the pending-change row — the card's re-read address and the address its doors act through.
   *  NOTHING has applied: the click on the card is the deed (THE HUMAN-IN-THE-LOOP LAW). */
  change?: { id: string; spec: ChangeSpec } | null;
};

const linkKindOf = (s: Extract<ConverseScope, { kind: 'item' }>): 'inbox_item' | 'commitment' | 'meeting' =>
  s.itemKind === 'commitment' || s.itemKind === 'followup' ? 'commitment' : s.itemKind === 'meeting' ? 'meeting' : 'inbox_item';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DIALOGUE READ (converse arc — the bootcamp lesson): the room RENDERS as a conversation, so
// the responder must SEE the conversation. Found live: the founding engine proposed "bring in
// 'ZZ AI Bootcamp' (46 items)?", the user typed "only for the bootcamp", and this core —
// blind to the room's turns — answered "I don't see any bootcamp-related work". Two laws fix the
// class, not the case:
//   1. The core reads the room's recent turns (transcript) and its STANDING INTERACTIONS (a
//      founding proposal, an open ask) as machine-actionable state — a prose answer to a standing
//      question executes through the SAME door as its button (adoptEntity / the proceed stamp).
//   2. Names in the user's words resolve against the WHOLE registry (memory matches), not just the
//      open room — an empty new room must never make the brain look amnesiac.
// Plus the honesty floor: never assert the absence of something the dialogue or memory names.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type PendingInteraction =
  | { type: 'founding_proposal'; turnId: string; targetId: string; options: Array<{ label: string; sourceId: string }> }
  | { type: 'ask'; turnId: string; dedupeKey: string | null; items: string[] };

async function dialogueContext(
  client: SupabaseClient, userId: string, scope: ConverseScope,
): Promise<{ transcript: string; pending: PendingInteraction | null; roomKey: string | null }> {
  try {
    const { readRoomTurns, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = scope.kind === 'entity' ? scope.entityId
      : scope.kind === 'item'
        ? await roomKeyForItem(client, userId, linkKindOf(scope) === 'inbox_item' ? 'inbox' : linkKindOf(scope) === 'commitment' ? 'commitment' : 'meeting', scope.itemId)
        : null;
    if (!roomKey) return { transcript: '', pending: null, roomKey: null };
    const turns = await readRoomTurns(client, userId, roomKey, 10);
    if (!turns.length) return { transcript: '', pending: null, roomKey };
    const lines = turns.map((t) => {
      const who = t.role === 'user' ? 'user' : t.author?.name ? t.author.name.split(' ')[0] : 'assistant';
      const comp = t.component?.key === 'founding_proposal'
        ? ` [STANDING PROPOSAL — options: ${((t.component.state?.options as Array<{ label: string }> | undefined) ?? []).map((o) => `"${o.label}"`).join(', ')}]`
        : t.component?.key === 'input_checklist'
          ? ` [OPEN ASK — waiting on: ${((t.component.state?.items as string[] | undefined) ?? []).join('; ')}]`
          : '';
      // THE EXCERPT-HONESTY LAW (the Rene incident, Aug 17): a raw mid-word slice here made a
      // coworker read OUR budget cut as "the task description got cut off" and report itself
      // blocked. Every prompt-bound clip ends at a boundary and declares itself.
      return `[${who}] ${clipForPrompt(t.text.replace(/\s+/g, ' '), 220)}${comp}`;
    });
    // The LATEST standing interaction wins (one pending thing at a time — the room's own ask law).
    let pending: PendingInteraction | null = null;
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      const st = (t.component?.state ?? {}) as Record<string, unknown>;
      if (t.component?.key === 'founding_proposal' && Array.isArray(st.options) && (st.options as unknown[]).length) {
        pending = { type: 'founding_proposal', turnId: String(t.id), targetId: String(st.targetId ?? ''), options: st.options as Array<{ label: string; sourceId: string }> };
        break;
      }
      if (t.component?.key === 'input_checklist' && Array.isArray(st.items) && !st.proceeded) {
        pending = { type: 'ask', turnId: String(t.id), dedupeKey: t.key ?? null, items: (st.items as string[]).map(String) };
        break;
      }
    }
    return { transcript: `THE CONVERSATION SO FAR (this room, latest last; ${EXCERPT_RULE}):\n${lines.join('\n')}`, pending, roomKey };
  } catch { return { transcript: '', pending: null, roomKey: null }; }
}

/** MEMORY MATCHES — names in the user's words resolved against the WHOLE registry. THE
 *  DISTINCTIVE-TOKEN LAW (the same one the recognition veto learned): generic work-words
 *  ("assessment", "project", …) match every engagement in a specialist portfolio and prove
 *  nothing — asked about "the STC Bahrain assessment", the generic token once filled the cap
 *  with three OTHER assessments before "bahrain" was ever reached. Only distinctive tokens
 *  count; matches rank by how many they hit. */
async function registryMatches(client: SupabaseClient, userId: string, text: string, excludeEntityId: string | null): Promise<string> {
  try {
    const { GENERIC_WORK_WORDS } = await import('@/lib/entities/recognize');
    const tokens = [...new Set(text.toLowerCase().split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !GENERIC_WORK_WORDS.has(t) && !/^(ai|the|and|for|what|how|who|when|where|why|have|has|had|our|your|about|with|this|that|from|are|was|were|does|did|can|will|would)$/.test(t)))];
    if (!tokens.length) return '';
    const { data } = await client.from('work_entities').select('id, name, aliases, tracked')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(400);
    const scored: Array<{ label: string; n: number }> = [];
    for (const e of (data ?? []) as Array<{ id: string; name: string; aliases: string[] | null; tracked: boolean }>) {
      if (e.id === excludeEntityId) continue;
      const hay = `${e.name} ${(e.aliases ?? []).join(' ')}`.toLowerCase();
      const n = tokens.filter((t) => hay.includes(t)).length;
      if (n > 0) scored.push({ label: `"${e.name}"${e.tracked ? ' (a tracked project)' : ' (a known body of work)'}`, n });
    }
    const hits = scored.sort((a, b) => b.n - a.n).slice(0, 3).map((s) => s.label);
    return hits.length ? `MEMORY MATCHES elsewhere in the user's registry (they may be referring to these): ${hits.join(' · ')}` : '';
  } catch { return ''; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HONESTY FLOOR AT THE ANSWER DOOR — ONE implementation, EVERY answer door (Sep 13).
//
// Aug 4 gave the floor a seat inside the agent loop: no denial left THAT loop without a registry
// check. But the loop is one of four doors an answer can leave by — the entity-question path, the
// item-question path and the Home ask all return prose straight to the user, and each of them
// carried only the PROMPT rule. That is the site-list decay class the excerpt law already taught
// us: a law living in one branch is a law the next branch never learned. So the floor moved out of
// the loop and became this function, and every door calls it.
//
// THE POINTER RIDES IN THE DENIAL'S OWN BREATH (the Sep 13 repair). The old rescue appended
// "That said — …" under answers longer than 200 chars, which left the amnesia opener standing:
//   "I don't have any information on a kiteschool assessment in the ZZ Meridian Rollout context.
//    You may be referring to ZZ Kiteschool Pilot…"
// — substantively right and still a lie in its first sentence, which is the sentence a person
// reads. A denial about X, when memory holds a near-X, must SAY SO where it denies:
//   "Nothing on that here — the closest I hold is "ZZ Kiteschool Pilot"."
// So a PURE denial sentence is rewritten in place. A denial that PIVOTS into substance ("I don't
// have the exact date, but the report went out Tuesday…") is never surgically cut — it keeps its
// words and the pointer rides along behind, the Aug 10 protection unchanged.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const DENIAL_RE = /\b(?:don't|do not|no)\b[^.!?]{0,50}\b(?:information|record|data|details?|found|see|have)\b|couldn't find|does not (?:provide|have|contain)|not (?:available|found)/i;
/** The law as the mind reads it — ONE copy, every answering prompt in this module. */
const ANSWER_HONESTY_RULE =
  'RULE: never claim something does not exist or cannot be seen if THE CONVERSATION or MEMORY MATCHES ' +
  'below name it — reference it instead. When this room holds nothing on what they asked but a MEMORY ' +
  'MATCH does, do NOT open with "I don\'t have any information": say where it DOES live, in the same ' +
  'sentence — "Nothing on that here — the closest I hold is \'<name>\'."';
/** A denial that carries its own substance after a pivot — never cut, only supplemented. */
const DENIAL_PIVOT_RE = /\b(?:but|however|though|although|that said)\b/i;

async function honestyFloor(
  client: SupabaseClient, userId: string, say: string, text: string, excludeEntityId: string | null,
): Promise<string> {
  if (!say || !DENIAL_RE.test(say)) return say;
  try {
    const mm = await registryMatches(client, userId, text, excludeEntityId);
    if (!mm) return say;
    // THE MISFIRE GATE (Aug 10, found live): the pointer is a RECALL rescue — it fires only when
    // the DENIAL SENTENCE itself names something the registry holds. A capability/format denial
    // ("I don't have it in that exact format yet") whose message merely CONTAINS project names
    // must never grow a project pointer — it read as a non-sequitur.
    const names = [...mm.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const sentences = say.split(/(?<=[.!?])\s+/);
    const denialText = sentences.filter((s) => DENIAL_RE.test(s)).join(' ').toLowerCase();
    const denialNamesEntity = names.some((n) => n.toLowerCase().split(/[^a-z0-9]+/)
      .some((tok) => tok.length >= 4 && denialText.includes(tok)));
    if (!names.length || !denialNamesEntity) return say;
    const many = names.length > 1;
    const pointer = `this looks like ${mm.replace(/^MEMORY MATCHES[^:]*: /, '')}. ` +
      (many ? 'Their work lives on those projects — open one, or tell me what to pull from it.'
        : 'Its work lives on that project — open it, or tell me what to pull from it.');
    // IN THE DENIAL'S OWN BREATH: every PURE denial sentence is replaced by the pointer-carrying
    // form (the first one carries the names; a repeat denial just goes quiet rather than saying
    // the same pointer twice).
    let carried = false;
    const closest = `the closest I hold ${many ? 'are' : 'is'} ${names.slice(0, 2).map((n) => `"${n}"`).join(' and ')}`;
    /** Does THIS sentence deny something the registry holds? (the misfire gate, per sentence) */
    const aboutAMatch = (s: string) => names.some((n) => n.toLowerCase().split(/[^a-z0-9]+/)
      .some((tok) => tok.length >= 4 && s.toLowerCase().includes(tok)));
    const rewritten = sentences.map((s) => {
      if (!DENIAL_RE.test(s) || DENIAL_PIVOT_RE.test(s) || !aboutAMatch(s)) return s;
      if (carried) return ''; // a REPEAT amnesia claim about the same held name — the pointer already stands.
      carried = true;
      return `Nothing on that here — ${closest}.`;
    }).filter(Boolean);
    if (carried) {
      const rest = rewritten.join(' ').trim();
      // When the rewrite is ALL that is left, the pointer's guidance completes the answer; when the
      // model's own remaining sentences already say where to go, it would only repeat them.
      const tail = many
        ? 'Their work lives on those projects — open one, or tell me what to pull from it.'
        : 'Its work lives on that project — open it, or tell me what to pull from it.';
      return rest === `Nothing on that here — ${closest}.` ? `${rest} ${tail}` : rest;
    }
    // Every denial pivoted into substance: keep the answer whole, ride the pointer behind it.
    return say.length <= 200 ? `Nothing directly on file here — but ${pointer}` : `${say}\n\nThat said — ${pointer}`;
  } catch { return say; /* the floor is an enhancement — the honest answer still returns */ }
}

/** The item's entity (the deal the conversation is scoped to), when linked. */
async function entityOfScope(client: SupabaseClient, userId: string, scope: ConverseScope): Promise<string | null> {
  if (scope.kind === 'entity') return scope.entityId;
  if (scope.kind !== 'item') return null;
  const { data } = await client.from('entity_links').select('entity_id')
    .eq('user_id', userId).eq('item_kind', linkKindOf(scope)).eq('item_id', scope.itemId).not('entity_id', 'is', null).maybeSingle();
  return (data?.entity_id as string) ?? null;
}

// ── The fast-path verdict — ONE classification over the registry-derived command list. ──
type Verdict = {
  command: { tool: string; args: Record<string, unknown> } | null;
  question: boolean;
  facts: string[];
  delegate: { coworker: string; task: string; revises?: boolean } | null;
  open: boolean; // composite / doesn't fit → the agent loop
};

async function classifyTurn(client: SupabaseClient, userId: string, scope: ConverseScope, text: string, transcript = ''): Promise<Verdict> {
  // The command list is DERIVED from the chief-of-staff registry slice — the router can only route to
  // what's registered (adding a capability row updates this prompt automatically; the one-truth law).
  // A capability marked `loopOnly` is NOT offered here: this router invents its own arguments from a
  // one-line blurb, and some arguments ARE the deed (Sep 21 — see the field's own note).
  const commands = capabilitiesFor('chief_of_staff')
    .filter((c) => !c.loopOnly)
    .map((c) => `- ${c.tool}: ${c.blurb}`).join('\n');
  const inItem = scope.kind === 'item';
  const prompt =
    `You are the router of a work assistant's chat. The user typed a note${inItem ? ' while viewing ONE work item' : ''}. ` +
    // THE DIALOGUE READ: the router sees the conversation, so a note referencing "it"/"that"/"the
    // bootcamp" resolves against what was just said, never against thin air.
    (transcript ? `${clipForPrompt(transcript, 1200)}\n\n` : '') +
    `Classify it. Available direct COMMANDS (from the capability registry):\n${commands}\n\n` +
    `Return ONLY JSON:\n` +
    `{"command":{"tool":"<registry tool>","args":{...}}|null,` +
    `"question":true|false,"facts":["0-3 durable facts worth remembering on this deal"],` +
    `"delegate":{"coworker":"<name>","task":"<what>","revises":true|false}|null,"open":true|false}\n` +
    `Rules:\n` +
    `- "command" ONLY for a plain single action the registry lists (e.g. "dismiss this" → resolve_inbox_item ` +
    `{"resolution":"dismiss"}; "mark it done" → {"resolution":"complete"}; "find the pricing deck" → find_file ` +
    `{"query":"pricing deck"}; "this isn't part of this project / remove it from the project" → ` +
    `move_item_to_project {"project_name":"none"}; "move this to Acme" → move_item_to_project ` +
    `{"project_name":"Acme"}; "put the Acme invoice email into Admin" → move_item_to_project ` +
    `{"project_name":"Admin","item_description":"Acme invoice"}; "start a project called Acme Pilot ` +
    `from this" → create_project {"name":"Acme Pilot"}; "add a task: chase the signed NDA by Friday" → ` +
    `create_task_item {"text":"Chase the signed NDA","due_date":"<that Friday>"}; "send it" / "send the reply" → ` +
    `send_prepared_reply {}; "reply to Sam offering both slots" / "write back and say yes" → draft_reply ` +
    `{"to":"Sam","instruction":"<what the reply must say, with the concrete details already settled>"} — ` +
    `it prepares the draft, it never sends; "forward this to Rita" → prepare_forward {"to":"Rita"};"set up a meeting with Sam ` +
    `Thursday 11h" / "book a call with them next week" → prepare_calendar_invite {"request":"<their words>"} — ` +
    `it prepares the card, it never sends); "archive all the notices" / "unsubscribe from the newsletters" → ` +
    `prepare_bulk_deed {"verb":"archive","group":"notices"} — it prepares the card, it never acts). ` +
    `Ambiguous / multi-step → null.\n` +
    `- "question" = the note primarily ASKS (status/info/advice). A correction/instruction is NOT a question.\n` +
    `- "facts" = durable constraints/preferences/numbers to remember; a one-off phrasing tweak is NOT one.\n` +
    `- "delegate" when a named coworker/assistant is explicitly asked — AND for PRODUCED work ` +
    `(fill in / complete a document, draft a report or long deliverable, write up material from ` +
    `pasted source) even when no coworker is named: pick the fit — Clara (chief of staff: writing, documents, ops, admin), ` +
    `Max (research, analysis), Luca (branding, design, LinkedIn) — and put the WHOLE job in ` +
    `"task". A question, a quick command, or a short reply tweak is NOT produced work. ` +
    `"revises" = true ONLY when the task MODIFIES the document this conversation just produced ` +
    `(change a chart, add a section, rework the tone of "the report") — new work is revises:false.\n` +
    (inItem ? `- A DRAFT INSTRUCTION (rewrite/shorten/soften/add something to the reply or follow-up being drafted here) is a CORRECTION, not open — return command:null, question:false, open:false; the draft is reworked on that path.\n` : '') +
    `- "open" = true when the note needs COMPOSITION (several actions, or an action the registry doesn't list).\n` +
    `THE NOTE: ${text}`;
  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, { model, max_tokens: 500, temperature: 0, messages: [{ role: 'user', content: prompt }] });
    const raw = res.choices?.[0]?.message?.content ?? '';
    const o = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<Verdict> & { command?: { tool?: string; args?: Record<string, unknown> } | null };
    return {
      command: o.command?.tool ? { tool: String(o.command.tool), args: o.command.args ?? {} } : null,
      question: o.question === true,
      facts: Array.isArray(o.facts) ? o.facts.filter((f): f is string => typeof f === 'string' && !!f.trim()).slice(0, 3) : [],
      delegate: o.delegate && typeof (o.delegate as { coworker?: string }).coworker === 'string'
        ? { coworker: String((o.delegate as { coworker: string }).coworker), task: String((o.delegate as { task?: string }).task ?? ''), revises: (o.delegate as { revises?: unknown }).revises === true }
        : null,
      open: o.open === true,
    };
  } catch { return { command: null, question: false, facts: [], delegate: null, open: true }; }
}

/** The pool the reply/forward matcher ranks: the user's OPEN inbox work. Deliberately pending-only
 *  and recency-ordered — a resolved thread is not something the user is being asked to answer. The
 *  cap is loud in shape (the deck's own saturation lesson): 120 rows is far past what any real
 *  "reply to X" resolves against, and the ladder refuses rather than guesses when it is crowded. */
async function loadReplyCandidates(client: SupabaseClient, userId: string): Promise<ReplyCandidate[]> {
  try {
    const { data } = await client.from('inbox_items')
      .select('id, work_title, source_data')
      .eq('user_id', userId).eq('status', 'pending')
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(120);
    return ((data ?? []) as Array<Record<string, unknown>>).map((it) => {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      return {
        id: String(it.id),
        title: String(it.work_title ?? ''),
        fromName: String(sd.from_name ?? ''),
        fromAddress: String(sd.from_address ?? sd.from ?? ''),
        subject: String(sd.subject ?? ''),
        body: String(sd.body ?? ''),
      };
    }).filter((c) => c.fromAddress || c.subject || c.title);
  } catch { return []; }
}

// THE EXPLICIT-SEND FLOOR (deterministic, Aug 4): chat may fire the send door ONLY when the user's
// OWN words contain a send verb — a model mis-map must never mail anything. EN/PT/DE/ES forms.
const EXPLICIT_SEND = /\b(send|ship|fire (it|off)|envi[ae]\w*|manda\w*|schick\w*|verschick\w*)\b/i;

// The send/forward target: the open item, or — in an ENTITY room — the deal's single drafted
// pending email (two+ candidates → name them, never guess).
async function sendTargetOf(
  client: SupabaseClient, userId: string, scope: ConverseScope,
): Promise<{ itemId: string; draftBody: string } | { ambiguous: string[] } | null> {
  if (scope.kind === 'item') {
    if (linkKindOf(scope) !== 'inbox_item') return null;
    const { data: it } = await client.from('inbox_items').select('id, source_data')
      .eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
    const body = String(((it?.source_data as Record<string, unknown> | undefined)?.draft as { body?: string } | undefined)?.body ?? '').trim();
    return body ? { itemId: scope.itemId, draftBody: body } : null;
  }
  if (scope.kind !== 'entity') return null;
  const { data: links } = await client.from('entity_links').select('item_id')
    .eq('user_id', userId).eq('entity_id', scope.entityId).eq('item_kind', 'inbox_item').limit(60);
  const ids = (links ?? []).map((l) => l.item_id as string);
  if (!ids.length) return null;
  const { data: items } = await client.from('inbox_items').select('id, work_title, source_data, status')
    .in('id', ids).eq('user_id', userId).eq('status', 'pending');
  const drafted = ((items ?? []) as Array<Record<string, unknown>>)
    .map((it) => ({ id: String(it.id), title: String(it.work_title ?? ''), body: String(((it.source_data as Record<string, unknown>)?.draft as { body?: string } | undefined)?.body ?? '').trim() }))
    .filter((x) => x.body);
  if (drafted.length === 1) return { itemId: drafted[0].id, draftBody: drafted[0].body };
  if (drafted.length > 1) return { ambiguous: drafted.map((d) => d.title || d.id).slice(0, 4) };
  return null;
}

/** A collection is an ENHANCEMENT: a builder that fails hands back nothing and the read still
 *  answers. Never throws (the card can be absent; the answer can not). */
async function buildCollectionSafe(
  client: SupabaseClient, userId: string, kind: NonNullable<ReturnType<typeof presentsCollectionKind>>,
  params?: Record<string, string | number | boolean>,
): Promise<CollectionSpec | null> {
  try {
    const { buildCollection } = await import('@/lib/present/build');
    return await buildCollection(client, userId, kind, params);
  } catch { return null; }
}

// ── Registry dispatch — the ONE place a chat command becomes an execution. Only the chief-of-staff
// slice is reachable; an unknown/unexposed tool is refused (exposure is enforced here, structurally).
async function dispatchCommand(
  client: SupabaseClient, userId: string, scope: ConverseScope, tool: string, args: Record<string, unknown>,
  userText = '',
  /** The conversation the turn happens in — a preparer that must read the thread (the invite card)
   *  gets the SAME merged transcript every other reader sees, plus the room it belongs to. */
  convo: { transcript?: string; roomKey?: string | null } = {},
  /** THE TURN'S DEED LEDGER (Sep 21) — a mutating branch pushes what it OBSERVED, so the loop's
   *  final answer can be held to a count the code actually measured. */
  deeds: DeedRecord[] = [],
): Promise<ConverseTurn | ToolData | null> {
  const allowed = new Set(capabilitiesFor('chief_of_staff').map((c) => c.tool));
  if (!allowed.has(tool)) return null;
  const ctx = { client, userId };

  // ── THE TASK VERBS (Sep 21, CLASS 2). ONE set of executors, shared with the coworker door; the
  // chief's difference is scope (the user's WHOLE set, agentId null) and BY-NAME resolution.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = client as any;
  // THE PRESENTATION LAW: the two READS below hand back `modelText` — their executors write a
  // listing/config dump for the model (ids, raw step prompts, config JSON), never a sentence for
  // the person. The three DEEDS keep `say`: their lines are hand-written here or in the executor's
  // own ledger, and a deed confirmation must stay instant.
  if (tool === 'list_tasks') {
    // ONE READ, TWO RENDERINGS (Wave 1): the block for the model, and the typed card for the kit.
    // Both derive from the SAME exported query (`readTaskRows`), so they cannot describe different
    // sets; the builder's own read also gathers the material-door facts the card's verbs need.
    const [modelText, spec] = await Promise.all([
      executeListTasks(null, userId, admin),
      buildCollectionSafe(client, userId, 'workflows', { scope: 'all' }),
    ]);
    return { modelText, ...(spec ? { present: spec } : {}) };
  }
  if (tool === 'get_task' || tool === 'run_task') {
    const spoken = String(args.task_name ?? args.name ?? '').trim();
    if (!spoken) {
      const ask = 'Which task? Name it and I\'ll look.';
      return tool === 'get_task' ? { modelText: ask } : { say: ask, refs: [] };
    }
    const hit = await resolveTaskIdByName(spoken, null, userId, admin);
    if ('error' in hit) return tool === 'get_task' ? { modelText: hit.error } : { say: hit.error, refs: [] };
    if (tool === 'get_task') return { modelText: await executeGetTask(hit.id, userId, admin) };
    // "RESUME X" IS A STATUS DEED, NOT A RUN (Sep 21, found live: the model served "resume the X
    // task" with run_task and STARTED a real run). Code decides from the user's own words.
    if (spokenIsResumeNotRun(userText)) {
      const out = await executeSetTasksStatus({ status: 'active', scope: 'named', names: [hit.name] }, null, userId, admin, userText);
      deeds.push({ tool: 'set_tasks_status', kind: 'status', ok: out.changed > 0, count: out.changed });
      return { say: out.text, refs: [] };
    }
    // A RUN SPENDS AND MAY DELIVER → THE CONFIRM CARD (stabilization W0.3b). Nothing starts here;
    // the apply door runs executeRunTask with this exact id on the user's click. No deed is
    // recorded — a prepared change is not a deed, and the floor must not credit it as one.
    const prepared = await prepareChange(client, userId, { tool: 'run_task', args: { task_id: hit.id }, lane: 'home_chat', roomKey: convo.roomKey ?? null });
    if (!prepared) return { say: `I couldn't prepare a run of "${hit.name}" just now — nothing started. Try again in a moment.`, refs: [] };
    return { say: changeSayLine(prepared.spec), refs: [], change: { id: prepared.spec.id, spec: prepared.spec } };
  }
  if (tool === 'set_tasks_status') {
    const status = args.status === 'active' ? 'active' : 'paused';
    const out = await executeSetTasksStatus({
      status,
      scope: args.scope === 'all' ? 'all' : args.scope === 'named' ? 'named' : undefined,
      names: Array.isArray(args.names) ? (args.names as string[]) : undefined,
    }, null, userId, admin, userText);
    deeds.push({ tool: 'set_tasks_status', kind: 'status', ok: out.changed > 0, count: out.changed });
    return { say: out.text, refs: [] };
  }

  // ── THE DISPATCHER: a clear-fit production ask ACTS (delegation is reversible — the work
  // reports back; nothing external fires) with visible attribution. ──
  if (tool === 'assign_to_coworker') {
    const cw = String(args.coworker ?? '').trim();
    const task = String(args.task ?? '').trim();
    if (!cw || !task) return { say: 'I need who and what for the hand-off — name the task in one line.', refs: [] };
    return runCoworkerDelegation(client, userId, scope, cw, task, userText);
  }
  // ── THE SENSIBLE ASK: the loop's ONE decision door — malformed asks fall back to prose. ──
  if (tool === 'offer_choices') {
    const q = clipLabel(String(args.question ?? ''), 200);
    const options = (Array.isArray(args.options) ? args.options : [])
      .map((o) => ({ label: String((o as { label?: string }).label ?? '').trim().slice(0, 40), say: clipLabel(String((o as { say?: string }).say ?? ''), 200) }))
      .filter((o) => o.label && o.say).slice(0, 4);
    if (!q || options.length < 2) return null;
    return { say: q, refs: [], options };
  }
  // ── THE PARITY LAW verbs (Aug 4) ──
  if (tool === 'send_prepared_reply') {
    // The floor: no explicit send word in the user's OWN text → never fire; offer the confirm.
    if (!EXPLICIT_SEND.test(userText)) {
      return { say: 'Say "send it" and it goes — or tell me what to change first.', refs: [] };
    }
    const target = await sendTargetOf(client, userId, scope);
    if (!target) return { say: "Nothing is drafted here yet — tell me the angle and I'll draft it first.", refs: [] };
    if ('ambiguous' in target) return { say: `More than one draft is ready — which one: ${target.ambiguous.join(' · ')}?`, refs: [] };
    // The CLIENT fires the one send door (route + exactly-once hash + outcome log) with this body.
    return { say: 'Sending it now…', refs: [], commit: { kind: 'send_reply', itemId: target.itemId, body: target.draftBody } };
  }
  // ── THE INVITE CARD (threads plan — EVERY THREAD, EVERY PRODUCER): the plain prompt's producer.
  // It PREPARES through the same grounding the proactive pass uses, stores the payload, and hands
  // the card back on the turn. Nothing sends here; the card's Send is the user's click, through
  // the commit door. A time nobody stated comes back EMPTY and the card asks for it.
  if (tool === 'prepare_calendar_invite') {
    const card = await executePrepareCalendarInvite(client, userId, {
      request: (String(args.request ?? '').trim() || userText).trim(),
      transcript: convo.transcript ?? '',
      entityId: scope.kind === 'entity' ? scope.entityId : await entityOfScope(client, userId, scope),
      roomKey: convo.roomKey ?? null,
    });
    // A card that cannot survive a reload is not offered — the conversation says so plainly
    // instead of rendering a button that dies with the tab (truth before presentation).
    if (!card) return { say: "I couldn't put the invite together just now — say the time and who's on it and I'll try again.", refs: [] };
    return {
      say: inviteCardLine(card.invite), refs: [],
      invite: { id: card.id, invite: card.invite as unknown as Record<string, unknown> },
    };
  }
  // ── THE EVENT CARD (Wave 2, Sep 22): "decline the 3pm" finally has hands. It RESOLVES the
  // meeting deterministically, builds the card, and arms a verb only when the user's own words
  // named one — the calendar's version of the explicit-send floor. Nothing here reaches a provider:
  // the deed fires from the card, through /api/events/[id]/deed, which re-derives the permission
  // for itself and claims the commit door.
  if (tool === 'prepare_event_action') {
    const out = await executePrepareEventAction(client, userId, {
      which: typeof args.which === 'string' ? args.which : undefined,
      verb: typeof args.verb === 'string' ? args.verb : undefined,
      userText,
    });
    return { modelText: out.modelText, ...(out.present ? { present: out.present } : {}) };
  }
  // ── THE BULK DEED (attention-plan A7's parity clause): the spoken half of the ledger's verb
  // buttons. It routes through the SAME `prepareBulkDeed`, so a said deed and a clicked deed are
  // the same stored row. It PREVIEWS ONLY — `commitBulkDeed` is unreachable from this path.
  if (tool === 'prepare_bulk_deed') {
    const out = await executePrepareBulkDeed(client, userId, {
      verb: String(args.verb ?? ''),
      group: typeof args.group === 'string' ? args.group : null,
      // The self-address is only the calendar fact's self-skip; this lane has no user row in hand,
      // and its absence narrows nothing the deed acts on (the class derivation is the same).
      selfEmail: null,
    });
    if (!out.ok) return { say: out.line, refs: [] };
    return {
      say: out.line, refs: [],
      bulkDeed: { id: out.card.id, deed: out.card.deed as unknown as Record<string, unknown> },
    };
  }
  // ── THE DRAFT-REPLY DOOR (Sep 21) — deterministic resolution first, the one drafter behind it. ──
  if (tool === 'draft_reply') {
    const instruction = (String(args.instruction ?? '').trim() || userText).trim();
    const to = String(args.to ?? args.recipient ?? '').trim();
    const about = String(args.about ?? args.subject ?? args.topic ?? '').trim();
    // On an OPEN email the target is not a question — it is what the user is looking at.
    if (scope.kind === 'item' && linkKindOf(scope) === 'inbox_item') {
      const body = await redraftItemDraft(client, userId, scope, instruction, { persist: true }).catch(() => null);
      return body
        ? { say: "I've drafted the reply — it's ready to review and send.", refs: [], draft: body }
        : { say: "I couldn't put a draft together on this one — tell me the angle and I'll try again.", refs: [] };
    }
    const pasteSource = looksPasted(userText) ? userText
      : looksPasted(convo.transcript ?? '') ? String(convo.transcript) : '';
    const match = pickReplyTarget(await loadReplyCandidates(client, userId), { to, about, pasted: pasteSource || userText });
    if (match.kind === 'many') {
      // AMBIGUITY IS A REFUSAL BY LISTING (the house law) — never a guess with the user's mail.
      return { say: `Which one should I answer: ${match.candidates.map((c) => `"${(c.subject || c.title).slice(0, 60)}"`).join(' · ')}?`, refs: [] };
    }
    if (match.kind === 'one') {
      const c = match.candidate;
      const body = await redraftItemDraft(client, userId, { kind: 'item', itemKind: 'email', itemId: c.id }, instruction, { persist: true }).catch(() => null);
      if (body) {
        return {
          say: `Drafted the reply to ${c.fromName || c.fromAddress || 'them'} — it's on "${(c.subject || c.title).slice(0, 60)}", ready to review and send.`,
          refs: [{ id: c.id, kind: 'inbox_item', label: (c.subject || c.title).slice(0, 60), href: `/item/${c.id}?kind=email` }],
          draft: body,
          // ONE CARD, EVERY THREAD: the matched item's prepared reply mounts HERE too — the same
          // component the item room mounts, reading the same draft. The conversation that wrote it
          // is where it should be reviewable.
          emailDraft: { id: c.id, itemId: c.id },
        };
      }
    }
    // NONE — the message is not in our inbox (another mailbox, a paste). The SAME drafter writes it,
    // and it lands on THE SAME CARD: the standalone lane, whose one extra question is which mailbox
    // sends. (It used to travel as delimited plain text to copy-paste — a fourth rendering of an
    // email, and the only one the user could not send. The owner's call, Sep 21.)
    const sd = pastedAsSourceData(pasteSource);
    if (sd) {
      const { generateReplyDraft } = await import('@/lib/inbox/draft-reply');
      const body = await generateReplyDraft(userId, sd, client,
        `THE USER'S STEERING NOTE (fold this into the reply — it overrides anything conflicting): ${instruction}`).catch(() => '');
      if (body?.trim()) {
        const { prepareStandaloneEmail } = await import('@/lib/prepare/standalone-reply');
        const card = await prepareStandaloneEmail(client, userId, {
          body, source: sd, hintText: pasteSource, roomKey: convo.roomKey ?? null,
        }).catch(() => null);
        // A card that cannot survive a reload is not offered — the words still reach the user.
        if (card) {
          return {
            say: `Here's the reply${sd.from_name ? ` to ${String(sd.from_name)}` : ''} — check the sender and the wording, then send it from here.`,
            refs: [],
            emailDraft: { id: card.id, draft: card.draft as unknown as Record<string, unknown> },
          };
        }
        return { say: `Here's the reply — I couldn't keep it as a card just now, so copy it before you leave:\n\n${body.trim()}`, refs: [] };
      }
    }
    return { say: "I couldn't tell which message to answer — paste it here, or open it and ask me from there.", refs: [] };
  }
  if (tool === 'prepare_forward') {
    if (scope.kind === 'item' && linkKindOf(scope) === 'inbox_item') {
      const to = String(args.to ?? '').trim();
      return {
        say: `Opening the forward for review${to ? ` — add ${to} if it isn't already on it` : ''}. Approve there and it goes.`,
        refs: [], openStage: { stage: 'forward', itemId: scope.itemId },
      };
    }
    if (scope.kind === 'entity') {
      // In the deal room: point at the single candidate email's stage (the word is the deed).
      const { data: links } = await client.from('entity_links').select('item_id')
        .eq('user_id', userId).eq('entity_id', scope.entityId).eq('item_kind', 'inbox_item').limit(60);
      const ids = (links ?? []).map((l) => l.item_id as string);
      const { data: items } = ids.length
        ? await client.from('inbox_items').select('id, work_title').in('id', ids).eq('user_id', userId).eq('status', 'pending').order('last_activity_at', { ascending: false, nullsFirst: false }).limit(2)
        : { data: [] };
      const rows = (items ?? []) as Array<{ id: string; work_title: string | null }>;
      if (rows.length === 1) return { say: 'Opening the forward for review — approve there and it goes.', refs: [], openStage: { stage: 'forward', itemId: rows[0].id } };
      if (rows.length > 1) return { say: `Which email should I forward: ${rows.map((r) => `"${String(r.work_title ?? '').slice(0, 50)}"`).join(' · ')}?`, refs: [] };
      return { say: 'No open email on this project to forward.', refs: [] };
    }
    // THE HOME SCOPE IS NOT A DEAD END (Sep 21): this used to `return null` — a silent nothing the
    // model papered over with "I can't prepare a forward from this view", then re-asked its own
    // question. The Home resolves its target through the SAME matcher the draft door uses, so a
    // named email is forwardable from here; only a genuinely unresolvable one speaks, and it speaks
    // an alternative rather than a refusal.
    const fwdMatch = pickReplyTarget(await loadReplyCandidates(client, userId), {
      to: String(args.to ?? ''), about: userText, pasted: userText,
    });
    if (fwdMatch.kind === 'one') {
      return { say: 'Opening the forward for review — approve there and it goes.', refs: [], openStage: { stage: 'forward', itemId: fwdMatch.candidate.id } };
    }
    if (fwdMatch.kind === 'many') {
      return { say: `Which email should I forward: ${fwdMatch.candidates.map((c) => `"${(c.subject || c.title).slice(0, 60)}"`).join(' · ')}?`, refs: [] };
    }
    return { say: "I couldn't find that email in your inbox to forward. Open it and say it there, or tell me who it's from and I'll look again — I can also write the message from scratch.", refs: [] };
  }
  if (tool === 'resolve_inbox_item' && scope.kind === 'item' && linkKindOf(scope) === 'inbox_item') {
    const resolution = args.resolution === 'complete' ? 'complete' as const : 'dismiss' as const;
    const r = await executeResolveInboxItem(ctx, { itemId: scope.itemId, resolution, reason: (args.reason as string) ?? null });
    if (!r.ok) return { say: r.error ?? "I couldn't do that.", refs: [] };
    return { say: `${resolution === 'complete' ? 'Done — marked it handled' : 'Dismissed it'}. You can undo from the activity log.`, refs: [], applied: [{ tool, title: r.title ?? 'item' }] };
  }
  if (tool === 'resolve_commitment' && scope.kind === 'item' && linkKindOf(scope) === 'commitment') {
    const resolution = args.resolution === 'done' ? 'done' as const : 'dismissed' as const;
    const r = await executeResolveCommitment(ctx, { commitmentId: scope.itemId, resolution });
    if (!r.ok) return { say: r.error ?? "I couldn't do that.", refs: [] };
    return { say: `${resolution === 'done' ? 'Marked it done' : 'Dismissed it'}. Undo lives in the activity log.`, refs: [], applied: [{ tool, title: r.title ?? 'commitment' }] };
  }
  if (tool === 'find_file') {
    const entityId = await entityOfScope(client, userId, scope);
    const r = await executeFindFile(ctx, { query: String(args.query ?? ''), entityId });
    if (!r.files.length) {
      // THE HONESTY FLOOR at the search door too (the kiteschool class): before claiming nothing,
      // check whether the NAME resolves in the registry — "no file" is not "never heard of it".
      const mm = await registryMatches(client, userId, String(args.query ?? ''), scope.kind === 'entity' ? scope.entityId : null);
      if (mm) return { say: `No matching FILE — but this looks like ${mm.replace(/^MEMORY MATCHES[^:]*: /, '')}. Open that project for its work and documents, or tell me what to pull from it.`, refs: [] };
      return { say: "I couldn't find a matching file in the knowledge base, past attachments, or connected drives.", refs: [] };
    }
    return { say: `Found ${r.files.length === 1 ? 'this' : 'these'}:`, refs: [], files: r.files };
  }
  if (tool === 'propose_standing_task') {
    // THE SPEC CARD (Arc 2): saying prepares — the spec lands as a durable card in the work's
    // room; NOTHING is created until the user confirms on it. Room resolution: this room, the
    // item's room, or (global) the entity the request names.
    const request = (String(args.request ?? '').trim() || userText).trim();
    if (scope.kind === 'global') {
      // THE ONE CREATION CARD (coherence slice #2): from the Home chat the draft reviews
      // INLINE — no pointer to another room, no project required (cards travel, objects
      // don't). The full generator drafts the real pipeline the card shows.
      const { generateWorkflowConfig } = await import('@/lib/workflows/generate-config');
      const g = await generateWorkflowConfig(request, userId, client);
      if (!g) return { say: "I couldn't draft that — name the sources, the schedule, and what it should produce.", refs: [] };
      return {
        say: `Here's the plan for "${g.name}" — nothing runs until you confirm on the card.${g.overlap_note ? ` One heads-up: ${g.overlap_note}` : ''}`,
        refs: [],
        workflowDraft: { ...g, token: crypto.randomUUID() },
      };
    }
    const { buildStandingSpec } = await import('@/lib/work/standing-spec');
    const spec = await buildStandingSpec(client, userId, request);
    if ('error' in spec) {
      // The spec validator is cron-only — a REACTION request said in a room ("whenever X
      // happens…") falls through to the one creation card instead of a dead "can't set that
      // up" (the card grammar covers every trigger type).
      const { generateWorkflowConfig } = await import('@/lib/workflows/generate-config');
      const g = await generateWorkflowConfig(request, userId, client);
      if (g) {
        return {
          say: `Here's the plan for "${g.name}" — nothing runs until you confirm on the card.`,
          refs: [],
          workflowDraft: { ...g, token: crypto.randomUUID() },
        };
      }
      return { say: `I can't set that up yet — ${spec.error}.`, refs: [] };
    }
    let roomKey: string | null = null; let roomLabel = 'this room';
    if (scope.kind === 'entity') roomKey = scope.entityId;
    else if (scope.kind === 'item') {
      const { roomKeyForItem } = await import('@/lib/room/turns');
      const ik = linkKindOf(scope) === 'inbox_item' ? 'inbox' as const : linkKindOf(scope) === 'commitment' ? 'commitment' as const : 'meeting' as const;
      roomKey = await roomKeyForItem(client, userId, ik, scope.itemId);
    } else {
      const { findEntityFocus } = await import('@/lib/home/ask');
      const { data: ents } = await client.from('work_entities').select('id, name, aliases')
        .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(60);
      const f = findEntityFocus(request, (ents ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>);
      if (f) { roomKey = f.id; roomLabel = `the ${f.name} room`; }
    }
    if (!roomKey) {
      return { say: `Here's what I'd set up: "${spec.name}" — ${spec.cadenceLabel}, ${spec.ownerName} producing ${spec.deliverable} Which project does it belong to? Name it (or ask from that project's room) and I'll place the confirm card there.`, refs: [] };
    }
    const { writeRoomTurn } = await import('@/lib/room/turns');
    const dedupeKey = `standing-spec:${crypto.randomUUID().slice(0, 8)}`;
    await writeRoomTurn(client, userId, roomKey, {
      role: 'system',
      text: `Standing task proposed: "${spec.name}" — ${spec.cadenceLabel}, owned by ${spec.ownerName.split(' ')[0]}. Nothing runs until you confirm on the card.`,
      dedupeKey,
      component: { key: 'standing_spec', state: { ...spec, status: 'pending' } },
    });
    void roomLabel; // room scopes only now — global returns the inline card above
    return {
      say: `Here's the setup: "${spec.name}" — ${spec.cadenceLabel}, ${spec.ownerName.split(' ')[0]} producing it. Confirm on the card and the first run lands ${spec.firstRun ? spec.firstRun.slice(0, 10) : 'on schedule'}.`,
      refs: [],
    };
  }
  if (tool === 'steer_standing_task') {
    // ROOM FEEDBACK MUTATES THE METHOD (Arc 2 stage 4): only meaningful in a standing
    // commitment's own room — the executor verifies the source structurally.
    if (scope.kind !== 'item' || linkKindOf(scope) !== 'commitment') {
      return { say: 'Say that in the standing task\'s own room and I\'ll bake it into the method.', refs: [] };
    }
    // A PERSISTENT INSTRUCTION → THE CONFIRM CARD (stabilization W0.3b): the model-chosen
    // `instruction` used to land in worker_instructions on the spot. It is now PREPARED, shown
    // verbatim on the card, and applied only on the user's click (the SAME executor, at the door).
    const prepared = await prepareChange(client, userId, {
      tool: 'steer_standing_task', args: { commitmentId: scope.itemId, instruction: String(args.instruction ?? userText) },
      lane: 'home_chat', roomKey: convo.roomKey ?? null,
    });
    if (!prepared) return { say: "I couldn't prepare that just now — nothing was changed. Try again in a moment.", refs: [] };
    return { say: changeSayLine(prepared.spec), refs: [], change: { id: prepared.spec.id, spec: prepared.spec } };
  }
  if (tool === 'run_compute') {
    // THE SANDBOX FROM THE HOME (Aug 6): "what's 17.5% of 84,300?" computes in the locked room.
    // The fast-path can't author code (found live: it dispatched with NO script → a dead-end
    // refusal) — a missing script triggers ONE codegen step (with THE CLOCK) from the user's own
    // words; a genuine non-compute ask declines honestly.
    const cfg = { ...(args as unknown as ComputeConfig) };
    if (!cfg.script?.trim()) {
      try {
        const { aiCall } = await import('@/lib/ai/call');
        const day = new Date().toISOString().slice(0, 10);
        const res = await aiCall<{ script?: string; skip?: string }>({
          userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 700, source: 'task_preparation',
          prompt: `Today is ${day}. The user asked: "${clipWithRule(userText, 300)}"\n` +
            `If this is a COMPUTATION (arithmetic, dates, data transforms), write ONE Python script that computes it ` +
            `and prints each result on a line starting "FINDINGS: " (stdlib + pandas available; NO network; no files ` +
            `unless provided). Otherwise decline.\nJSON only: {"script":"…"} OR {"skip":"<why>"}`,
        });
        if (res.json?.script?.trim()) cfg.script = res.json.script;
        // Data tool, data shape — even on the decline path: the loop owns every sentence this
        // branch can produce, so no half of run_compute can ever be served raw.
        else return { modelText: `Not a computation — ${clipLabel(String(res.json?.skip ?? 'no numbers or file were given'), 140)}.` };
      } catch { return { modelText: 'The computation could not be set up (codegen failed). Say so plainly and ask for the concrete numbers or the file.' }; }
    }
    // THE PRESENTATION LAW: the digest is written FOR THE MODEL — it carries instructions ("do NOT
    // estimate the result by hand"), environment variable names, tool names and raw stdout/stderr.
    const digest = await executeRunCompute(cfg, userId, client);
    return { modelText: digest };
  }
  if (tool === 'read_action_history') {
    // The history read (one-surface § context controls): "what was sent this week?" answered from
    // the real ledgers. The digest carries its own boundary line (through-the-platform only) and an
    // instruction addressed to the model, so it is DATA — the loop writes the sentence.
    const digest = await executeReadActionHistory(args as ActionHistoryConfig, userId, client);
    return { modelText: digest };
  }
  if (tool === 'remember_fact' && scope.kind !== 'global') {
    // A PERSISTENT RULE ON MEMORY → THE CONFIRM CARD (stabilization W0.3b — the memory-poisoning
    // class): the fact is PREPARED and shown verbatim; executeRememberFact runs only at the apply
    // door, on the user's click.
    const prepared = await prepareChange(client, userId, {
      tool: 'remember_fact',
      args: scope.kind === 'entity'
        ? { fact: String(args.fact ?? ''), entityId: scope.entityId }
        : { fact: String(args.fact ?? ''), linkKind: linkKindOf(scope), itemId: scope.itemId },
      lane: 'home_chat', roomKey: convo.roomKey ?? null,
    });
    if (!prepared) return { say: "I couldn't prepare that note just now — nothing was remembered. Try again in a moment.", refs: [] };
    return { say: changeSayLine(prepared.spec), refs: [], change: { id: prepared.spec.id, spec: prepared.spec } };
  }
  // MEMBERSHIP / PROJECT management (P4/S3) — the manage verbs, same executors as the click paths.
  if (tool === 'move_item_to_project') {
    // Tolerant arg keys — the fast-path classifier improvises ("project_name"/"project"/"name"/"to").
    const pn = (args.project_name ?? args.projectName ?? args.project ?? args.name ?? args.to ?? null) as string | null;
    const desc = String(args.item_description ?? args.item ?? '').trim();
    // Which item? An explicit description resolves ANYWHERE (S3); otherwise the open item (item scope).
    let target: { linkKind: 'inbox_item' | 'commitment' | 'meeting'; itemId: string } | null =
      scope.kind === 'item' && !desc ? { linkKind: linkKindOf(scope), itemId: scope.itemId } : null;
    if (!target && desc) {
      const hit = await resolveItemByDescription(client, userId, desc);
      if (hit && 'ambiguous' in hit) return { say: `A few things match — did you mean: ${hit.ambiguous.join(' · ')}?`, refs: [] };
      if (hit) target = { linkKind: hit.linkKind, itemId: hit.itemId };
    }
    if (!target) return { say: desc ? `I couldn't find anything matching "${desc}".` : 'Which item do you mean?', refs: [] };
    const r = await executeMoveItemToProject(ctx, { ...target, projectName: pn });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: 'membership' }] } : {}) };
  }
  if (tool === 'create_task_item') {
    // In a room / on a linked item, the task defaults to THAT deal (no name needed).
    const entityId = scope.kind === 'entity' ? scope.entityId : scope.kind === 'item' ? await entityOfScope(client, userId, scope) : null;
    const r = await executeCreateTaskItem(ctx, {
      text: String(args.text ?? args.task ?? args.description ?? ''),
      dueDate: (args.due_date as string) ?? null,
      projectName: (args.project_name as string) ?? null,
      entityId: (args.project_name ? null : entityId),
    });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: 'task' }] } : {}) };
  }
  if (tool === 'create_project') {
    const nm = String(args.name ?? args.project_name ?? '').trim();
    const attach = scope.kind === 'item' && args.attach_current_item !== false
      ? { linkKind: linkKindOf(scope), itemId: scope.itemId } : null;
    const r = await executeCreateProject(ctx, { name: nm, description: (args.description as string) ?? null, attach });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: nm }] } : {}) };
  }
  if (tool === 'set_project_status') {
    let name = String(args.project_name ?? args.projectName ?? args.project ?? args.name ?? '').trim();
    if (!name && scope.kind === 'entity') {
      const { data: ent } = await client.from('work_entities').select('name').eq('id', scope.entityId).maybeSingle();
      name = String(ent?.name ?? '');
    }
    if (!name) return { say: 'Which project do you mean?', refs: [] };
    const rawAct = String(args.status_action ?? args.action ?? args.status ?? 'done').toLowerCase();
    const act = (['done', 'archive', 'reopen', 'mute'].find((a) => rawAct.includes(a)) ?? 'done') as 'done' | 'archive' | 'reopen' | 'mute';
    const r = await executeSetProjectStatus(ctx, { projectName: name, action: act });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: name }] } : {}) };
  }
  if (tool === 'merge_projects') {
    const r = await executeMergeProjects(ctx, { keepName: String(args.keep_name ?? args.keep ?? ''), mergeName: String(args.merge_name ?? args.merge ?? args.into ?? '') });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: 'merge' }] } : {}) };
  }
  // READ tools (P7a — retrieval-capable grounding): the chief can GO LOOK like a coworker can.
  if (tool === 'get_emails') {
    const text = await executeGetEmails({ filter: args.filter, from: args.from, since: args.since ?? '30d', mode: 'search' }, userId, client).catch(() => '');
    // THE READ BUDGET (W2.7): packed by email, cuts declared — never a raw slice mid-message.
    const { packEmailsRead } = await import('@/lib/converse/read-budget');
    return { modelText: (text && packEmailsRead(text)) || 'No matching emails found.' };
  }
  if (tool === 'get_meeting_context') {
    // ONE READ, TWO RENDERINGS: `readMeetingContext` returns the model's block AND the typed rows.
    const since = String(args.since ?? '30d');
    const read = await readMeetingContext({ since, include: args.include ?? 'summaries', filter: args.filter }, userId, client)
      .catch(() => null);
    // THE READ BUDGET (W2.7): packed BY MEETING, cuts declared — and the card shows exactly the
    // meetings the model saw (a row it never read is a claim it cannot stand behind).
    const { packMeetingRead } = await import('@/lib/converse/read-budget');
    const packed = read ? packMeetingRead(read.blocks) : null;
    const text = packed?.text ?? '';
    const { recordingSpec } = await import('@/lib/present/build');
    return {
      modelText: text || 'No matching meetings found.',
      ...(read ? { present: recordingSpec(read.meetings.filter((m) => packed!.seen.has(m.id)), { since }) } : {}),
    };
  }
  // THE READ-SIDE CALENDAR VERB (Wave 1): every line it returns — busy/free, weekdays, clock times,
  // proposed slots — is CODE's, so the loop relays truth instead of composing availability from memory.
  if (tool === 'check_calendar') {
    // ONE READ, TWO RENDERINGS: `readCalendar` returns the model's block AND the schedule window
    // the card's rows are built from — so a rendered day and a printed line are the same day.
    const read = await readCalendar({
      from_date: args.from_date, to_date: args.to_date,
      propose_slots: args.propose_slots, duration_minutes: args.duration_minutes, count: args.count,
      // THE FRESH READ (Sep 21): the tool has always carried `refresh` and this dispatch dropped
      // it on the floor — "I just added it, check again" re-read the same stale cache and the
      // answer was confidently wrong twice. The arg reaches its executor.
      refresh: args.refresh === true,
    }, userId, client).catch(() => null);
    if (!read) return { modelText: "I couldn't read the calendar just now." };
    if ('refusal' in read) return { modelText: read.refusal };
    const { calendarSpec } = await import('@/lib/present/build');
    // THE READ BUDGET (W2.7): the FREE SLOTS (the verified answer) survive first, day detail
    // yields earliest-last, every cut declared — and the card renders the days the model saw.
    const { packCalendarRead } = await import('@/lib/converse/read-budget');
    const packed = packCalendarRead(read);
    return {
      modelText: packed.text || "I couldn't read the calendar just now.",
      present: calendarSpec(read.win.days.filter((d) => packed.seenDays.has(d.dayStr)), {
        hasCalendar: read.win.hasCalendar, from: read.fromDayStr, to: read.toDayStr,
      }),
    };
  }
  if (tool === 'search_knowledge_base') {
    try {
      const { buildKBContext } = await import('@/lib/knowledge/build-kb-context');
      const query = String(args.query ?? '');
      // THE READ BUDGET (W2.7): the context is packed BY FILE at the read's budget — so the card
      // below can show exactly the files that reached the model, never one it never saw.
      const { READ_BUDGET } = await import('@/lib/converse/read-budget');
      const kb = await buildKBContext(userId, query, client, { fileLimit: 4, maxTotalChars: READ_BUDGET });
      const text = typeof kb === 'string' ? kb : ((kb as { context?: string })?.context ?? '');
      if ((text || '').trim()) {
        // ONE READ, TWO RENDERINGS: the card is built from the groups this very context was
        // rendered from — never a second search that could rank differently.
        const { documentSpec } = await import('@/lib/present/build');
        const seen = new Set(typeof kb === 'string' ? [] : (kb.packedFileIds ?? []));
        const groups = typeof kb === 'string' ? [] : (kb.groups ?? []).filter((g) => seen.has(g.fileId));
        // THE FLOOR IS NOT ONLY FOR AN EMPTY SHELF (Sep 22, the kiteschool class re-manifested): a
        // populated KB always returns SOMETHING, so the nearest-neighbour files used to be served as
        // the answer and the NAMED body of work denied. The registry pointer rides a hit too.
        const mm = await registryMatches(client, userId, query, scope.kind === 'entity' ? scope.entityId : null);
        return {
          modelText: text + (mm
            ? `\n\n${mm}\nNone of the files above carry the distinctive part of this query — NAME that match instead of denying you have anything on it.`
            : ''),
          ...(groups.length ? { present: documentSpec(groups, query) } : {}),
        };
      }
      // The honesty floor (the kiteschool class): an empty KB result still checks the registry.
      const mm = await registryMatches(client, userId, String(args.query ?? ''), scope.kind === 'entity' ? scope.entityId : null);
      if (mm) return { modelText: `Nothing in the knowledge base — but this looks like ${mm.replace(/^MEMORY MATCHES[^:]*: /, '')}. Its work lives on that project.` };
      return { modelText: 'Nothing matching in the knowledge base.' };
    } catch { return { modelText: 'Nothing matching in the knowledge base.' }; }
  }
  return null;
}

// ── THE ONE DELEGATION EXECUTOR — shared by the named-coworker verdict path ("have Max…") and
// the dispatcher's assign_to_coworker tool. Delegation is REVERSIBLE (work lands as a room
// report-back; nothing external fires), so it acts directly — with visible attribution. ──
const OFFICE_EXT = /\.(docx|pptx|xlsx)$/i;

/** TEMPLATE-BY-EXAMPLE (DH5b): when the request says "follow this template / same format",
 *  resolve the example FILE — an attached office file's bytes first (the common case), else a
 *  named knowledge-base document ("use the template from <name>"). Null = no template. */
async function resolveTemplateFile(
  admin: SupabaseClient, userId: string, requestText: string, attachments: ConverseAttachment[],
): Promise<{ bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx' } | null> {
  try {
    if (!/\btemplate\b|same (format|structure|layout|design)|follow(ing)? (the|this) (format|structure|layout|design|template)|like (the|this) (attached|example)/i.test(requestText)) return null;
    // 1 — an attached office file with bytes IS the example.
    const att = attachments.find((a) => a.file?.dataB64 && OFFICE_EXT.test(a.name));
    if (att?.file) {
      const ext = att.name.split('.').pop()!.toLowerCase() as 'docx' | 'pptx' | 'xlsx';
      return { bytes: Buffer.from(att.file.dataB64, 'base64'), ext };
    }
    // 2 — a NAMED knowledge-base document ("the template from <name>"). Filename-token match,
    // newest first; the file must be storage-backed (a drive-connector row has no bytes here).
    const m = requestText.match(/template (?:from|of|in)\s+(?:the\s+)?["“']?([^"”'.,;\n]{3,60})/i);
    if (!m) return null;
    const tokens = m[1].trim().split(/\s+/).filter((t) => t.length > 2).slice(0, 4);
    if (!tokens.length) return null;
    let q = admin.from('knowledge_files').select('id, filename, storage_path, origin')
      .eq('user_id', userId).not('storage_path', 'is', null)
      .order('created_at', { ascending: false }).limit(5);
    for (const t of tokens) q = q.ilike('filename', `%${t}%`);
    const { data: rows } = await q;
    const row = (rows ?? []).find((r) => OFFICE_EXT.test(String(r.filename)));
    if (!row?.storage_path) return null;
    // THE ROW'S OWN BUCKET (Sep 14, lib/knowledge/file-bucket.ts) — this blind two-bucket probe
    // never looked in email-attachments, so a template that arrived by mail was invisible here.
    const got = await downloadKbFile(admin, row);
    if (!got || got.bytes.length > 8 * 1024 * 1024) return null;
    const ext = String(row.filename).split('.').pop()!.toLowerCase() as 'docx' | 'pptx' | 'xlsx';
    return { bytes: got.bytes, ext };
  } catch { return null; }
}

async function runCoworkerDelegation(
  client: SupabaseClient, userId: string, scope: ConverseScope, coworkerWant: string, task: string, userText: string,
  transcript = '', material = '',
  themeOverride: import('@/lib/documents/theme').DocTheme | null = null,
  attachments: ConverseAttachment[] = [],
  revisePrior: { id: string; threadId: string; title: string } | null = null,
): Promise<ConverseTurn> {
  try {
    // THE DATA-FACTS PASS (the data-by-code lane): tabular material gets its statistics computed
    // IN THE SANDBOX before the coworker writes — the facts ride the material as the
    // authoritative numbers. Deterministic; a compute failure just proceeds without facts.
    const tab = attachments.find((a) => a.text && (/\.(csv|xlsx)$/i.test(a.name) || /^[^,\n]{1,60}(,[^,\n]{1,60}){2,}\n/.test(a.text)));
    let dataFacts: string | null = null;
    try {
      if (tab?.text) {
        const { computeDataFacts } = await import('@/lib/compute/data-facts');
        dataFacts = await computeDataFacts(client, userId, { request: `${task} — ${clipForPrompt(userText, 300)}`, csvText: tab.text, filename: tab.name });
        if (dataFacts) {
          material += `\n\nCOMPUTED FACTS (sandboxed code ran over ${tab.name} — these numbers are AUTHORITATIVE; use them VERBATIM and never derive your own):\n${dataFacts}`;
        }
      }
    } catch { /* facts are an enhancement — the delegation proceeds */ }
    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // REVISION-IN-PLACE (DH7): fetch the prior artifact's CURRENT bytes so the compile job opens
    // and modifies the real file. Resolution failure just means a fresh build (never a dead turn).
    let revise: { artifactId: string; threadId: string; title: string; bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx' } | null = null;
    if (revisePrior) {
      try {
        // OWNERSHIP FLOOR: the ids arrive from the client — the thread must be THIS user's
        // (admin client bypasses RLS; an unscoped read would let a crafted history revise
        // another user's artifact).
        const { data: th } = await admin.from('work_threads').select('artifacts').eq('id', revisePrior.threadId).eq('user_id', userId).single();
        const row = (Array.isArray(th?.artifacts) ? (th!.artifacts as Array<{ id?: string; storage_path?: string }>) : [])
          .find((r) => r?.id === revisePrior.id);
        const ext = String(row?.storage_path ?? '').split('.').pop()?.toLowerCase();
        if (row?.storage_path && (ext === 'docx' || ext === 'pptx' || ext === 'xlsx')) {
          const { data: dl } = await admin.storage.from('work-artifacts').download(String(row.storage_path));
          if (dl) revise = { artifactId: revisePrior.id, threadId: revisePrior.threadId, title: revisePrior.title, bytes: Buffer.from(await dl.arrayBuffer()), ext };
        }
      } catch { /* fresh build */ }
    }
    // TEMPLATE-BY-EXAMPLE (DH5b): an attached office file or a named KB document the request
    // says to mirror. Never doubles as the revision target (current.* wins that seat).
    const templateFile = revise ? null : await resolveTemplateFile(admin, userId, `${task} ${userText.slice(0, 400)}`, attachments);
    const { data: workers } = await client.from('custom_agents').select('id, name, worker_role').eq('user_id', userId).eq('is_worker', true).eq('is_active', true);
    const want = coworkerWant.toLowerCase();
    const worker = (workers ?? []).find((w) => String(w.name).toLowerCase().startsWith(want) || String(w.worker_role ?? '').toLowerCase().includes(want));
    if (worker) {
      const [{ buildItemContext }, { buildDelegationPrompt, runDelegation }, { data: prof }] = await Promise.all([
        import('@/lib/home/item-context'), import('@/lib/home/delegate'),
        client.from('profiles').select('full_name').eq('id', userId).single(),
      ]);
      const itemCtx = scope.kind === 'item' ? await buildItemContext(client, userId, scope.itemKind, scope.itemId) : null;
      const prompt = buildDelegationPrompt({
        kind: scope.kind === 'item' ? scope.itemKind : 'email',
        itemContext: itemCtx?.text || '',
        step: { text: task, detail: `The user asked for this in chat: "${userText}"` +
          // The hand-off carries its conversation — a task worded as "do it" resolves against
          // what was just discussed instead of arriving at the coworker as thin air.
          (transcript ? `\nTHE CONVERSATION THIS CAME FROM (resolve "it"/"that" against it):\n${clipForPrompt(transcript, 4000)}` : '') +
          // …and the user's attached material rides WHOLE — the work is usually ON these files.
          (material ? `\n\nTHE ATTACHED MATERIAL (the user attached these files with the request — work on their actual content):\n${clipForPrompt(material, 18000)}` : '') },
      });
      const out = await runDelegation({
        supabase: admin, userId, worker: { id: worker.id as string, name: String(worker.name), worker_role: (worker.worker_role as string) ?? null, is_worker: true },
        // A LABEL IS NOT AN EXCERPT: this raw slice cut the classifier's task mid-word
        // ("…'Last Week's Highlights' s") and the hand-back quoted OUR cut back at the user.
        prompt, itemLabel: clipLabel(task, 80),
        firstName: (prof?.full_name as string | undefined)?.split(' ')[0] ?? null,
        ...(themeOverride ? { themeOverride } : {}),
        // THE COMPILER TIER (DH6/DH7): charts, in-place revision, and template-following compile
        // the deliverable file in the sandbox (render-verified); the template tier stays the floor.
        ...(tab?.text || revise || templateFile
          ? { compile: { csvText: tab?.text ?? null, computedFacts: dataFacts, request: `${task} — ${clipForPrompt(userText, 500)}` } } : {}),
        ...(revise ? { revise } : {}),
        ...(templateFile ? { templateFile } : {}),
        ...(scope.kind === 'item' ? { pool: { kind: scope.itemKind, entityId: scope.itemId }, provenance: { item: task.slice(0, 80), steered: true } } : {}),
      });
      // FIX 3 — a needs_input outcome is an ASK, not work in flight: say so plainly (the
      // checklist already landed in the room as the coworker's own turn).
      if (out?.needsInput?.length) return { say: `${String(worker.name).split(' ')[0]} needs something from you first: ${out.needsInput.join('; ')}. It's listed in the room — attach or answer here.`, refs: [], delegated: { agentName: String(worker.name), agentId: String(worker.id) } };
      if (out) {
        // THE LOOP CLOSES IN PLACE (Aug 8, owner flag): the delegation runs synchronously — by
        // the time we speak, the work EXISTS. ARTIFACTS-INTO-ORIGIN (Aug 9): when the work
        // materialized as a real document, its card rides THIS turn and the viewer opens HERE —
        // the origin conversation holds the deliverable, never a pointer to another one.
        const first = String(worker.name).split(' ')[0];
        const report = String(out.reportText || '').trim();
        if (out.artifact) {
          const say = report
            ? `${previewOf(report, 700)}`
            : `${first} finished — the document is ready.`;
          return {
            say, refs: [], delegated: { agentName: String(worker.name), agentId: String(worker.id) },
            artifact: { ...out.artifact, agentName: String(worker.name) },
            ...(out.artifacts && out.artifacts.length > 1 ? { artifacts: out.artifacts.map((a) => ({ ...a, agentName: String(worker.name) })) } : {}),
          };
        }
        const say = report
          ? `${previewOf(report, 700)}\n\n(The full version is in your ${first} conversation.)`
          : `${first} finished — the work is in your ${first} conversation.`;
        return { say, refs: [], delegated: { agentName: String(worker.name), agentId: String(worker.id) } };
      }
    }
    return { say: "I couldn't find that coworker on your team.", refs: [] };
  } catch { return { say: "The hand-off didn't go through — try again in a moment.", refs: [] }; }
}

// ── The bounded AGENT LOOP (the 20%) — function-calling over the chief-of-staff toolset. ──
/** THE CHIEF DOOR'S TOOL SET, exported (Sep 21) so the door-parity gate can DERIVE it instead of
 *  grepping for it — a gate that reads source text is a gate that can be fooled by a rename. */
export const CHIEF_TOOL_DEFS = [listTasksChiefDefinition, getTaskChiefDefinition, runTaskChiefDefinition, setTasksStatusDefinition,
  resolveInboxItemDefinition, resolveCommitmentDefinition, findFileDefinition, rememberFactDefinition, getEmailsDefinition, getMeetingContextDefinition, checkCalendarDefinition, searchKnowledgeDefinition, moveItemToProjectDefinition, setProjectStatusDefinition, mergeProjectsDefinition, createProjectDefinition, createTaskItemDefinition, sendPreparedReplyDefinition, draftReplyDefinition, prepareForwardDefinition, prepareCalendarInviteDefinition, prepareEventActionDefinition, prepareBulkDeedDefinition, readActionHistoryDefinition, proposeStandingTaskDefinition, steerStandingTaskDefinition, runComputeDefinition, assignToCoworkerDefinition, offerChoicesDefinition];

/** THE HOLD WINDOW (see THE STREAM NEVER RETYPES, inside the loop). Long enough that a
 *  preamble-then-tool turn resolves inside it — a model that is about to call a tool emits its
 *  tool-call deltas within the first second — and short enough that a genuine answer (which takes
 *  several seconds to write) is still watched being written. */
const STREAM_HOLD_MS = 1200;

async function agentLoop(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string, grounding: string,
  history?: ConverseHistoryTurn[],
  onProgress?: (label: string) => void,
  material = '',
  onToken?: (t: string) => void,
  convo: { transcript?: string; roomKey?: string | null } = {},
): Promise<ConverseTurn & { exhausted?: boolean }> {
  const { toOpenAITool } = await import('@/lib/tools');
  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  // THE SOVEREIGN LEAK AUDIT (Aug 10): the chief's toolset respects workspace features — a
  // corporate workspace (email off) never exposes mailbox verbs, so the model can't offer them.
  let toolDefs = CHIEF_TOOL_DEFS;
  try {
    const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
    const { TOOL_FEATURE } = await import('@/lib/workspace/tool-capabilities');
    const feats = await getWorkspaceFeatures(userId, client) as unknown as Record<string, boolean>;
    toolDefs = CHIEF_TOOL_DEFS.filter((d) => {
      const req = TOOL_FEATURE[(d as { name: string }).name];
      return !req || feats?.[req] !== false;
    });
  } catch { /* features unreadable → full set (fail open; the executors keep their own gates) */ }
  // ── THE CLOCK REACHES THE CHAT LANE (Wave 1, Sep 18) — the loop ran DATELESS while every other
  // lane carried the date (lib/workflows/execute-step.ts's dateLine is the idiom). A dateless model
  // coin-flips weekday↔date pairs and reasons about "next week" from nothing. The line is computed
  // in the USER'S zone (the one derivation, shared with the windowed calendar read). ──
  let dateLine = '';
  try {
    const { userTimezone } = await import('@/lib/calendar/schedule-window');
    const tz = await userTimezone(client, userId);
    const now = new Date();
    const dayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
    const label = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dayStr}T12:00:00Z`));
    const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(now);
    dateLine =
      `TODAY is ${label} — it is ${clock} in the user's local time (${tz}). Reason about "today", "this week" ` +
      `and "next week" from THAT date. Weekday names for dates come from your tools/context — if a date's ` +
      `weekday is not stated there, do not guess it. For anything about availability, free time or ` +
      `scheduling, call check_calendar first: never state availability from memory. When the user ` +
      `says they have just changed, added or deleted something in their calendar, call it with ` +
      `refresh:true so the read comes from the provider and not from a cached view.\n\n`;
  } catch { /* the clock is an enhancement — an unreadable zone must never break the turn */ }
  const applied: ConverseTurn['applied'] = [];
  // THE TURN'S DEED LEDGER — what the dispatcher OBSERVED, for the floor at the answer below.
  const deeds: DeedRecord[] = [];
  const files: NonNullable<ConverseTurn['files']> = [];
  // SPEAK → SHOW (Wave 1, the opening contract): an ANALYTICAL turn answers in prose AND hands
  // over the objects it reasoned about. The LAST presenting read wins — it is the one the answer
  // was composed from; nothing here changes what the model sees (that stays `modelText`).
  let collection: NonNullable<ConverseTurn['collection']> | null = null;
  // …and the same for the SINGLE-OBJECT card (Wave 2): an analytical turn about one meeting answers
  // in prose and hands the event over, verbs and all. The last one built wins, for the same reason.
  let event: NonNullable<ConverseTurn['event']> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: 'system', content:
      dateLine +
      `You are the user's chief of staff inside their work platform. You hold a SMALL set of reversible tools ` +
      `(resolving items, finding files, remembering facts, reading the action ledger of what was sent/done) — ` +
      `use them when the user asks. You never CREATE ` +
      `and send anything in one motion: send_prepared_reply fires ONLY the already-drafted reply and ONLY when ` +
      `the user's own words explicitly say send; prepare_forward and prepare_calendar_invite only PREPARE — they ` +
      `hand the user a card to review, and the approve stays with them. When the user asks you to reply to, ` +
      `answer, write back to or offer something to someone by email — or agrees to your own offer to do so — ` +
      `call draft_reply with the concrete details this conversation has already settled; it prepares the draft ` +
      `and sends nothing. When they ask to set up, schedule or book ` +
      `a meeting, call prepare_calendar_invite and keep your line to ONE sentence: the card carries the detail. ` +
      // WAVE 2 — the calendar verbs are sayable: an EXISTING meeting is an object with its own
      // actions, and the card computes which ones its state allows. The model chooses the meeting,
      // never the permission, and nothing fires until the user clicks.
      `When they talk about a meeting that ALREADY EXISTS — "what's my 3pm?", "decline the standup", ` +
      `"move my call with Sam to Thursday 10:00", "cancel tomorrow's sync" — call prepare_event_action ` +
      `with their own words; it shows the meeting with the actions it allows and changes nothing by ` +
      `itself. Keep your line to ONE sentence; the card carries the rest. ` +
      `When they ask to clear, archive, unsubscribe from or bin a WHOLE GROUP you are holding quiet, call ` +
      `prepare_bulk_deed — it only previews; the card states what would happen and their click is the commit. ` +
      `Ground every claim in the ` +
      `CONTEXT below; when it doesn't cover something, say so plainly. PLAIN PROSE, no markdown, 1-4 sentences.\n\n` +
      `THE TEAM (assign production work with assign_to_coworker): Clara — chief of staff: ops, admin, inbox, ` +
      `calendar, writing, documents, reports, and anything that spans the team · Max — research, analysis · ` +
      `Luca — branding, design, LinkedIn. When the user asks ` +
      `for PRODUCED work (a report, draft, analysis, post) without naming who, assign the obvious fit ` +
      `YOURSELF and say who's on it — the work is reversible and reports back here; never ask permission ` +
      `for a hand-off. THE SENSIBLE ASK: offer_choices is for ONE genuinely consequential decision you ` +
      `cannot infer (ambiguous scope that changes the work, two truly equal owners, a choice with external ` +
      `impact) — NEVER to confirm reversible steps, never for what context already answers, at most one ` +
      `ask per turn. Asking for the sake of asking is a failure.\n\n` +
      // ONE LAW, ONE COPY (Sep 8): the loop reads THE ONE GROUNDING, so it must read the one law
      // about the world's record too — an answer ranking the board above the world contradicts the
      // very brief the evidence settled (lib/room/ground-evidence.ts). Self-gating: a page with no
      // GROUND EVIDENCE block is untouched by it.
      `${GROUND_EVIDENCE_RULE}\n\n` +
      // THE OFFER LAW (Sep 21) — DERIVED from the very toolDefs this loop holds, AFTER the
      // workspace-feature filter above, so the promise the mind is allowed to make and the hands
      // it actually has are the same list by construction. A hand-written block would drift the
      // day a tool is added or a feature is switched off; this one cannot.
      `${renderOfferLaw(toolDefs)}\n\n` +
      // THE CONTEXT BUDGET (W2.7): the caller PACKS the context (preamble + grounding, by
      // priority, cuts declared) — this is only the honest ceiling, never a silent tail-chop.
      `--- CONTEXT ---\n${clipWithRule(grounding, LOOP_CONTEXT_CEILING)}` },
    // THE PANEL CONVERSATION as real turns (Aug 10, the amnesia class): a follow-up ("yes
    // please" · "in bullet points" · "ask Sofia to do it") resolves against what was just
    // said — before this the loop saw ONLY the newest message and asked what "it" meant.
    ...(history ?? []).slice(-8).map((t) => ({ role: t.role, content: clipWithRule(t.text, 4000) })),
    // THE ATTACHED MATERIAL rides as its own turn — full fidelity, never squeezed into the
    // grounding budget (the work is usually ON these files).
    ...(material ? [{ role: 'user', content: `Here is the material I attached:\n\n${material}` }] : []),
    { role: 'user', content: text },
  ];
  for (let i = 0; i < 4; i++) {
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // THE STREAM NEVER RETYPES (Sep 21 — the pilot: "it types the text twice, once, then deletes
    // it and then writes it again")
    //
    // The old design assumed "the models emit content OR a tool call". Current models do both:
    // they write a near-complete answer and THEN call a tool. The client was told to WIPE its
    // preview (a NUL sentinel) so the preamble wouldn't linger — so the user watched a whole
    // answer get typed, erased, and typed again.
    //
    // The constraint is real: tool_call deltas arrive at the END of an iteration's content, so
    // there is no up-front way to know whether what is streaming is the answer or a preamble.
    // Designs considered: (a) hold everything until the iteration ends — correct, but it kills the
    // live typing the pilot likes on the common single-iteration answer; (b) a CHARACTER budget —
    // fails for exactly this incident, whose preamble was hundreds of characters.
    //
    // CHOSEN: a TIME-BOXED HOLD plus an APPEND-ONLY law.
    //   • Content is buffered and NOT forwarded until HOLD_MS has passed with no tool-call delta
    //     seen. A preamble-then-tool turn resolves well inside that window, so its text NEVER
    //     enters the answer bubble at all — it surfaces once on the PROGRESS channel, which is
    //     transient by contract and is retracted by nobody.
    //   • Once flushing begins, nothing is ever retracted. A tool call arriving after the flush
    //     leaves the words standing and the later content APPENDS; the `done` frame then replaces
    //     the preview in place, without a typing animation. Growth and a settle — never an erase.
    // The NUL sentinel is therefore no longer emitted (the client keeps handling it for any other
    // producer, and for a client that has not yet reloaded).
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msg: any = null;
    try {
      if (!onToken) throw new Error('no-stream');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream: any = await ai.chat.completions.create({
        model, max_tokens: 700, temperature: 0.2, messages, tools: toolDefs.map(toOpenAITool), stream: true,
      });
      const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
      let content = '';
      let held = '';
      let flushing = false;
      let sawToolDelta = false;
      const startedAt = Date.now();
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          if (flushing) onToken(delta.content);
          else {
            held += delta.content;
            if (!sawToolDelta && Date.now() - startedAt >= STREAM_HOLD_MS) { flushing = true; onToken(held); held = ''; }
          }
        }
        for (const tc of delta.tool_calls ?? []) {
          sawToolDelta = true;
          const ti = tc.index ?? 0;
          if (!toolCalls[ti]) toolCalls[ti] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) toolCalls[ti].id = tc.id;
          if (tc.function?.name) toolCalls[ti].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[ti].function.arguments += tc.function.arguments;
        }
      }
      // The iteration ended still holding: now we KNOW which it was. No tool call → it is the
      // answer and it flushes whole. A tool call → the held words were a preamble and they go to
      // the transient progress channel, never the bubble (nothing to retract, because nothing
      // was ever shown).
      if (held) {
        if (toolCalls.length) onProgress?.(clipForPrompt(held.replace(/\s+/g, ' '), 90));
        else onToken(held);
      }
      msg = { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
    } catch {
      const res = await aiCreate(ai, { model, max_tokens: 700, temperature: 0.2, messages, tools: toolDefs.map(toOpenAITool) });
      msg = res.choices?.[0]?.message;
    }
    if (!msg) break;
    const calls = (msg.tool_calls ?? []) as Array<{ id: string; function: { name: string; arguments: string } }>;
    // THE SENTINEL IS RETIRED (Sep 21 — see THE STREAM NEVER RETYPES above). Preamble text is now
    // withheld from the bubble by the hold window instead of being WIPED out of it after the fact,
    // so there is nothing left to retract and no reset is sent. The non-streaming fallback showed
    // no preview either, so it owes none.
    if (!calls.length) {
      const raw = (msg.content ?? '').trim() || 'Done.';
      // THE HONESTY FLOOR AT THE ANSWER DOOR (Aug 4, found by the P30 gate; hoisted Sep 13 so the
      // question doors carry it too): no denial leaves ANY answer door without a registry check.
      const say = await honestyFloor(client, userId, raw, text, scope.kind === 'entity' ? scope.entityId : null);
      // THE DEED FLOOR AT THE CHIEF'S ANSWER (Sep 21). The same predicate the coworker lane runs,
      // wired here as an AMENDMENT ONLY — never a corrective round: this loop's streaming law is
      // "growth and a settle, never an erase" (THE STREAM NEVER RETYPES above), and re-running the
      // turn would retype an answer the user has already watched arrive. Appending is growth; a
      // claim the ledger cannot carry ships with the count the code actually measured beside it.
      const { breach } = deedFloorVerdict(say, deeds);
      return { say: breach ? say + deedAmendment(breach) : say, refs: [], applied, files: files.length ? files : undefined,
        ...(collection ? { collection } : {}), ...(event ? { event } : {}) };
    }
    messages.push(msg);
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* empty */ }
      onProgress?.(progressLabelFor(call.function.name));
      const out = await dispatchCommand(client, userId, scope, call.function.name, args, text, convo, deeds);
      // THE PRESENTATION LAW: a data read has no surface half at all — it only ever becomes the
      // tool message below, which is exactly what this loop is for.
      const turn = isToolData(out) ? null : out;
      if (isToolData(out) && out.present) {
        if (isEventPresent(out.present)) event = { id: out.present.spec.id, spec: out.present.spec };
        else collection = { id: crypto.randomUUID(), spec: out.present };
      }
      if (turn?.applied) applied.push(...turn.applied);
      if (turn?.files) files.push(...turn.files);
      // A commit/stage/options/delegation signal ends the loop — the client (or the coworker)
      // owns the next step; the loop never talks past its own hand-off.
      if (turn?.commit || turn?.openStage || turn?.options || turn?.delegated || turn?.invite || turn?.bulkDeed || turn?.emailDraft || turn?.change) return { ...turn, applied: applied.length ? applied : turn.applied };
      // THE NULL IS NEVER SILENT (Sep 21): a dispatcher that cannot serve this scope used to hand
      // back `{error:'tool unavailable in this context'}` — five words the model improvised over
      // ("I can't prepare a forward from this view…") before re-asking its own question. The
      // result now NAMES the actions that ARE available here, derived from the same filtered
      // toolDefs the mind was given, and forbids both fabrication and the re-ask.
      // A data read rides as its OWN text (the block the executor wrote for this exact purpose),
      // clipped under the excerpt law so a cut declares itself; everything else rides as the JSON
      // of the turn the dispatcher composed.
      messages.push({
        role: 'tool', tool_call_id: call.id,
        content: isToolData(out)
          ? clipForPrompt(out.modelText, 4000)
          : clipWithRule(JSON.stringify(turn ?? unavailableToolResult(call.function.name, toolDefs)), 1500),
      });
    }
  }
  // Loop exhausted without a final answer: NEVER the bare shrug (found live: "I couldn't finish
  // that one." beside a competitor's finished document). The caller hands the work off instead.
  return { say: applied.length ? 'Done.' : '', refs: [], applied, files: files.length ? files : undefined, exhausted: !applied.length };
}

/** THE VIEWING ANCHOR (P7a, structural): whatever the user is looking at is ALWAYS in the grounding —
 *  the system must be physically unable to contradict the document on screen. */
async function viewingExcerpt(client: SupabaseClient, userId: string, scope: ConverseScope): Promise<string> {
  if (scope.kind !== 'item') return '';
  try {
    if (linkKindOf(scope) === 'inbox_item') {
      const { data: it } = await client.from('inbox_items').select('work_title, source_data').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
      if (!it) return '';
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const atts = Array.isArray(sd.attachments) ? (sd.attachments as Array<{ filename?: string }>).map((a) => a.filename).filter(Boolean) : [];
      return `THE ITEM THE USER IS VIEWING RIGHT NOW (your answer MUST be consistent with it):\n` +
        `From: ${(sd.from_name as string) || (sd.from as string) || ''}\nSubject: ${(sd.subject as string) || it.work_title || ''}\n` +
        (atts.length ? `Attachments: ${atts.join(', ')}\n` : '') +
        `Body: ${clipForPrompt(String(sd.body || '').replace(/\s+/g, ' '), 900)}\n(${EXCERPT_RULE})`;
    }
    if (linkKindOf(scope) === 'commitment') {
      const { data: c } = await client.from('commitments').select('description, counterparty, due_date').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
      return c ? `THE COMMITMENT THE USER IS VIEWING: ${c.description}${c.counterparty ? ` (with ${c.counterparty})` : ''}${c.due_date ? ` due ${c.due_date}` : ''}` : '';
    }
    const { data: m } = await client.from('meeting_transcripts').select('title, summary').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
    return m ? `THE MEETING THE USER IS VIEWING: ${m.title}\n${clipWithRule(String(m.summary || ''), 700)}` : '';
  } catch { return ''; }
}

/** THE PANEL TRANSCRIPT (Aug 10 — the amnesia class, found live): the chat panel's own
 *  conversation, rendered for EVERY path — router, agent loop, delegation — not just the
 *  question path. Global scope has no room turns (dialogueContext returns empty), so without
 *  this the classifier and the loop saw ONLY the newest message: "yes please" arrived with no
 *  yes-please-able thing in sight, and a reformat request couldn't see the answer it was
 *  reformatting. Assistant turns keep more length — they're what follow-ups operate ON. */
function panelTranscript(history: ConverseHistoryTurn[] | undefined): string {
  if (!history?.length) return '';
  // THE EXCERPT-HONESTY LAW (the Rene incident, Aug 17): the assistant-line hard cut at 900 chars
  // broke mid-word ("…move forward after qu"), and the delegated coworker read OUR cut as a
  // truncated task — then confabulated the quote. Boundary clips + a declared marker, and the
  // rule rides the header so a tail-clip of the whole block can never strip it.
  const lines = history.slice(-8).map((t) =>
    `[${t.role === 'user' ? 'user' : 'assistant'}] ${clipForPrompt(t.text.replace(/\s+/g, ' '), t.role === 'assistant' ? 900 : 1200)}`);
  return `THE CHAT SO FAR (this panel, latest last; ${EXCERPT_RULE}):\n${lines.join('\n')}`;
}

// THE REF-TAG FLOOR (forward-motion law #3, found live: "[F3] [L3] is waiting for your response
// [L2]" reached the user's eyes): grounding notation is OURS — a tag the model echoed but nobody
// resolved into a real link is stripped at the ONE core exit, so no caller can leak it. The
// negative lookahead spares markdown links; [CONFIRM: …] doesn't match the letter+digits shape.
const GROUNDING_TAG_RE = /\s?\[(?:[EFLCRKW]\d+)\](?!\()/g;

// ── THE FLOOR'S OWN RULE, NOW EXPRESSIBLE (Sep 21). GROUNDING_TAG_RE was written when NOTHING
// resolved tags, so "a tag nobody resolved into a real link is stripped" could only be implemented
// as "strip them all" — and once the ask lane started resolving them (lib/home/ask-refs.ts), the
// correctly-placed chips were erased on the way out and only MALFORMED brackets survived (which is
// how the wrong-chip incident became visible at all).
//
// Two lanes, stated:
//   · NO REF CARRIES A TAG (every lane but the ask doors: the agent loop, delegation, item scope,
//     every command reply) → the ORIGINAL floor runs, byte for byte, lookahead and all. Nothing
//     resolved, so nothing can be kept, and the REF-TAG FLOOR cannot regress.
//   · A REF CARRIES ITS TAG → the shared resolver keeps exactly the tags it served and strips the
//     rest (unknown id, grouped, over-cap). The resolver has no markdown lookahead, so a link's own
//     bracket `[F3](…)` is PARKED across the strip and put back — a link is never notation.
const MARKDOWN_TAG_RE = /\[[EFLCRKW]\d+(?:\s*,\s*[EFLCRKW]\d+)*\]\(/g;
function stripGroundingNotation(say: string, refs: ConverseTurn['refs']): string {
  // THE DEED-REF FLOOR (Sep 22 — W3.4a): board refs like `[commit:<uuid>]` never reach prose.
  say = stripGroundingRefs(say);
  if (!refs?.some((r) => r.tag)) return say.replace(GROUNDING_TAG_RE, '');
  const parked: string[] = [];
  const guarded = say.replace(MARKDOWN_TAG_RE, (m) => { parked.push(m); return `«md${parked.length - 1}»`; });
  if (!parked.length) return stripUnresolvedTags(say, refs);
  return stripUnresolvedTags(guarded, refs).replace(/«md(\d+)»/g, (_m, i) => parked[Number(i)] ?? '');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A PREVIEW IS NOT A DEED (Sep 10 — the tab-latency correction)
//
// `redraftItemDraft` IS the redraft lane: ONE drafter (`generateReplyDraft` / `generateNudgeDraft`,
// which carry THE ONE GROUNDING — the attached-documents block included, T26.2), ONE instruction
// composition, and the persistence sitting BEHIND `persist`. Nothing here is a second drafter.
//
//   persist: true  — the deed. The prior draft VERSIONS into item_deliverables, the new body lands
//                    as the next version, the evaluator reviews it, and the serving pointer
//                    (`inbox_items.source_data.draft`) MOVES. This is what a picked steer earns.
//   persist: false — the preview. The SAME words, and every write site above is skipped: no
//                    version row, no steered row, no evaluator pass, no pointer move, no stamp.
//                    Nothing anywhere records that this call happened.
//
// The preview exists so the card can pre-generate the direction tabs a user has NOT picked. Under
// the persisting form that would rewrite the room's prepared reply once per unpicked direction —
// the deck, the room brief and the next visit would all speak a draft nobody chose. So the law is:
// pre-generation flows ONLY through the preview lane; the persisting door stays forbidden for a
// direction nobody picked (gate T24.11b).
async function redraftItemDraft(
  client: SupabaseClient, userId: string, scope: Extract<ConverseScope, { kind: 'item' }>, text: string,
  opts: { persist: boolean; learned?: string[] },
): Promise<string | null> {
  const { persist, learned } = opts;
  const facts = learned?.length ? `\nDURABLE FACTS on this work: ${learned.join(' · ')}` : '';
  if (linkKindOf(scope) === 'inbox_item') {
    const { data: item } = await client.from('inbox_items').select('source_data').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd = (item?.source_data ?? {}) as Record<string, any>;
    if (!(sd.from || sd.from_address)) return null;
    const { generateReplyDraft } = await import('@/lib/inbox/draft-reply');
    const instr = `THE USER'S STEERING NOTE (fold this into the reply — it overrides anything conflicting): ${text}` + facts;
    const body = await generateReplyDraft(userId, sd, client, instr);
    if (!body) return null;
    if (!persist) return body; // ← THE PREVIEW RETURNS HERE: every write below is structurally out of reach.
    // J3 — a rework is a NEW VERSION, never a mutation: the prior draft is RETAINED in the
    // pool (version_of rows are ledger-only; the reader skips them), the new body lands as
    // the next version, and only then does the serving pointer (sd.draft) move.
    if (sd.draft?.body) {
      await client.from('item_deliverables').insert({
        user_id: userId, kind: 'email', entity_id: scope.itemId, type: 'draft',
        title: 'Reply draft — prior version', content: String(sd.draft.body), ref: null,
        metadata: { version_of: 'reply_draft', superseded: true },
      }).then(() => {}, () => {});
    }
    await client.from('item_deliverables').insert({
      user_id: userId, kind: 'email', entity_id: scope.itemId, type: 'draft',
      title: 'Reply draft — steered', content: body, ref: null,
      metadata: { version_of: 'reply_draft', steered: true },
    }).then(() => {}, () => {});
    // J3 — the evaluator reviews reworks like ambient work (same reviewer, same annotations).
    const { evaluateDeliverable } = await import('@/lib/prepare/evaluate');
    const review = await evaluateDeliverable(client, userId, {
      content: body, task: `Reply to ${String(sd.from_name ?? sd.from ?? sd.from_address ?? '')} re: ${String(sd.subject ?? '')}`,
      recipient: String(sd.from ?? sd.from_address ?? '') || null,
      entityId: await entityOfScope(client, userId, scope), kind: 'reply',
    }).catch(() => ({ verdict: 'pass' as const, objection: null }));
    await client.from('inbox_items').update({ source_data: { ...sd, draft: { ...(sd.draft ?? {}), body, generated_at: new Date().toISOString(), steered: true, law_version: (await import('@/lib/inbox/attachment-context')).DRAFT_LAW_VERSION, ...(review.verdict !== 'pass' ? { review } : {}) } } }).eq('id', scope.itemId);
    return body;
  }
  if (linkKindOf(scope) === 'commitment') {
    const { data: c } = await client.from('commitments').select('id, description, counterparty').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
    if (!c) return null;
    const { generateNudgeDraft } = await import('@/lib/inbox/draft-reply');
    const instr = `THE USER'S STEERING NOTE (fold this in — it overrides anything conflicting): ${text}` + facts;
    const body = await generateNudgeDraft(userId, { counterparty: (c.counterparty as string) ?? null, description: String(c.description), ageDays: 0, instructions: instr }, client);
    if (!body) return null;
    if (!persist) return body; // ← THE PREVIEW RETURNS HERE: nothing below runs.
    // J3 — the evaluator reviews reworks like ambient work; the pool append IS the version
    // history (prior nudge rows are never touched).
    const { evaluateDeliverable } = await import('@/lib/prepare/evaluate');
    const review = await evaluateDeliverable(client, userId, {
      content: body, task: `Nudge about: ${String(c.description)}`,
      recipient: (c.counterparty as string) ?? null,
      entityId: await entityOfScope(client, userId, scope), kind: 'nudge',
    }).catch(() => ({ verdict: 'pass' as const, objection: null }));
    await client.from('item_deliverables').insert({
      user_id: userId, kind: 'commitment', entity_id: scope.itemId, type: 'draft',
      title: clipLabel(`Nudge — ${String(c.counterparty ?? '').split('<')[0].trim() || 'follow-up'}`, 100),
      content: body, ref: null, metadata: { steered: true, ...(review.verdict !== 'pass' ? { review } : {}) },
    }).then(() => {}, () => {});
    return body;
  }
  return null;
}

/** THE entry — every chat surface calls this with its scope. */
export async function converse(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string,
  opts: { history?: ConverseHistoryTurn[]; attachments?: ConverseAttachment[]; onProgress?: (label: string) => void; onToken?: (t: string) => void; preview?: boolean } = {},
): Promise<ConverseTurn> {
  // THE PREVIEW LANE short-circuits HERE — above the classifier, above every branch that can write.
  // A preview is only ever a redraft of one item's prepared work, so it never needs the router; and
  // sitting above it is what makes "writes nothing" structural rather than a list of skipped flags.
  if (opts.preview) {
    if (scope.kind !== 'item') return { say: '', refs: [], draft: null };
    const body = await redraftItemDraft(client, userId, scope, text, { persist: false }).catch(() => null);
    return { say: '', refs: [], draft: body };
  }
  const turn = await converseInner(client, userId, scope, text, opts);
  // THE WEEKDAY FLOOR at THE ONE ANSWER DOOR (Wave 1, Sep 18): every path — the agent loop's final
  // answer, the question paths (Home ask / entity ask / item ask), the command replies and the
  // exhaustion hand-off — returns THROUGH here, so one application covers the lane. A weekday is
  // arithmetic over a date; code corrects the pairing the model invented (the pilot chat got all
  // three of its proposed weekday↔date pairs wrong). Only unambiguous pairs are touched.
  // THE SENTINEL NEVER SERVES (Sep 18, the reach valve): NEEDS_REACH is a contract token between our
  // prompts and our code. If one ever survives to here — the loop was unavailable, a call errored —
  // it is replaced with an honest one-liner. Sitting at the one answer door makes that structural
  // rather than a list of guarded returns.
  // THE ANCHOR LAW REACHES THE LANE (Sep 21): the floor's precedence chain needs the USER'S OWN
  // recent words to know whether a weekday was THEIRS ("either thursday or friday") or the model's
  // own derivation. Only USER turns ride — an assistant turn would let the model's invented weekday
  // be read back as a user claim and launder itself into the anchor position.
  const userWords = [text, ...(opts.history ?? []).filter((h) => h.role === 'user').slice(-3).map((h) => h.text)]
    .filter(Boolean).join('\n');
  // THE REF-TAG FLOOR, RE-POINTED (Sep 21): same site, same shape, same weekday floor wrapped
  // around it — the strip itself now keeps a tag whose ref was SERVED (see stripGroundingNotation
  // above). Refs empty → identical behaviour to the old `.replace(GROUNDING_TAG_RE, '')`.
  if (turn?.say) turn.say = enforceWeekdayDatePairs(stripGroundingNotation(turn.say, turn.refs), { userText: userWords });
  if (turn?.say) turn.say = sayInsteadOfSentinel(turn.say);
  return turn;
}

async function converseInner(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string,
  opts: { history?: ConverseHistoryTurn[]; attachments?: ConverseAttachment[]; onProgress?: (label: string) => void; onToken?: (t: string) => void } = {},
): Promise<ConverseTurn> {
  // THE ATTACHED MATERIAL, rendered once for every consumer (classifier note · loop message ·
  // delegation prompt). Full fidelity where it matters; the classifier only needs the names.
  const material = (opts.attachments ?? [])
    .filter((a) => a.text?.trim())
    .map((a) => `[ATTACHED FILE: ${a.name}]\n${clipWithRule(a.text!, 15000)}`)
    .join('\n\n');
  const materialNames = (opts.attachments ?? []).map((a) => a.name).join(', ');

  // ── THE MOMENT THEME (owner, Aug 11 — "not a set-in-stone ask; could be for something
  // specific in that moment"): a branding word + an attached image builds a theme ON THE SPOT
  // for THIS request's deliverables; "always/from now on" ALSO saves it as the user's durable
  // theme; "reset document branding" clears the saved one. Deterministic — no AI, no config. ──
  let momentTheme: import('@/lib/documents/theme').DocTheme | null = null;
  try {
    const imgAtt = (opts.attachments ?? []).find((a) => a.image?.dataB64);
    const brandIntent = /\b(brand(ing)?|logo|letterhead|our colou?rs|company colou?rs|house style)\b/i.test(text);
    if (/\b(reset|remove|clear)\b.{0,24}\b(brand(ing)?|letterhead|document theme)\b/i.test(text)) {
      const { saveUserTheme } = await import('@/lib/documents/theme');
      await saveUserTheme(client, userId, null);
      return { say: 'Document branding cleared — deliverables go back to the standard look.', refs: [], applied: [{ tool: 'set_document_theme', title: 'branding cleared' }] };
    }
    if (imgAtt?.image && brandIntent) {
      const { themeFromLogoBuffer, logoFromBuffer, saveUserTheme } = await import('@/lib/documents/theme');
      momentTheme = await themeFromLogoBuffer(Buffer.from(imgAtt.image.dataB64, 'base64'), imgAtt.image.mime);
      // THE DUAL-LOGO COVER (the STC-benchmark ask): TWO attached logos + a branding word →
      // author × client co-brand; the second mark sits opposite the first on header/cover.
      const img2 = (opts.attachments ?? []).find((a) => a.image?.dataB64 && a !== imgAtt);
      if (momentTheme && img2?.image) {
        momentTheme.logo2 = await logoFromBuffer(Buffer.from(img2.image.dataB64, 'base64'), img2.image.mime);
      }
      if (momentTheme && /\b(always|every (doc|report|deliverable)|from now on|going forward|by default)\b/i.test(text)) {
        await saveUserTheme(client, userId, momentTheme);
      }
    }
  } catch { /* theming is an overlay — the ask proceeds unthemed */ }
  const [dlg, viewing] = await Promise.all([
    dialogueContext(client, userId, scope),
    viewingExcerpt(client, userId, scope),
  ]);
  // ONE merged conversation view for every downstream reader (room narrations + the panel's own
  // turns; global scope has only the latter — before this it had NEITHER on non-question paths).
  const transcript = [dlg.transcript, panelTranscript(opts.history)].filter(Boolean).join('\n\n');

  // 0a — THE TRANSITION FAST-PATH (THE MACHINE, experience-spec Part "THE MACHINE"): a structured
  // action is a TRANSITION, never a conversation. The steer route stamps decision enactments with
  // the DECISION MADE sentinel; on an item scope that routes STRAIGHT to the draft-rework lane
  // (the reply/nudge home — versioned, evaluated, composer-served), bypassing classification,
  // standing interactions, and every path that could answer a button with a question.
  const isTransition = scope.kind === 'item' && text.startsWith('DECISION MADE — ');

  // 0 — A STANDING INTERACTION is pending: first decide whether this note ANSWERS it (the bootcamp
  // law — a person replying under a question is answering the question until proven otherwise).
  // A yes executes through the SAME door as the button; ambiguity gets ONE clarifier ANCHORED on
  // the pending thing; a no falls through to the normal flow (which now sees the transcript).
  if (dlg.pending && !isTransition) {
    try {
      const p = dlg.pending;
      const pendingDesc = p.type === 'founding_proposal'
        ? `A PROPOSAL is standing: bring existing work into this project. Options:\n${p.options.map((o, i) => `${i}. ${o.label}`).join('\n')}`
        : `An ASK is standing: the work is waiting on the user for: ${p.items.join('; ')}. (The user can also say "go ahead" to proceed with what's available.)`;
      const { aiCall } = await import('@/lib/ai/call');
      const res = await aiCall<{ responds?: boolean; option?: number | null; go_ahead?: boolean; unclear?: string | null }>({
        userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 150, source: 'brain_synthesis',
        prompt: `${transcript ? `${transcript}\n\n` : ''}${pendingDesc}\n\nTHE USER JUST TYPED: "${text}"\n\n` +
          `Is this note an ANSWER to the standing ${p.type === 'founding_proposal' ? 'proposal' : 'ask'} (accepting, choosing, scoping, or declining it) — or something else entirely?\n` +
          `JSON only: {"responds":true|false,${p.type === 'founding_proposal' ? '"option":<option number accepted, or null if declined/unclear>,' : '"go_ahead":true|false,'}"unclear":"<ONE short clarifying question anchored on the pending thing, ONLY if responds but you cannot act>"}`,
      });
      if (res.json?.responds === true) {
        if (p.type === 'founding_proposal') {
          const idx = typeof res.json.option === 'number' ? res.json.option : null;
          const pick = idx !== null ? p.options[idx] : (p.options.length === 1 ? p.options[0] : null);
          if (pick && p.targetId) {
            const { adoptEntity } = await import('@/lib/entities/adopt');
            const r = await adoptEntity(client, userId, p.targetId, pick.sourceId);
            if (r.ok) {
              void import('@/lib/entities/state').then(({ refreshEntityState }) => refreshEntityState(client, userId, p.targetId, { force: true })).catch(() => {});
              void import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
              return { say: `Done — brought "${r.sourceName}" in. ${r.total ?? 0} items now live here.`, refs: [], applied: [{ tool: 'adopt_entity', title: r.sourceName ?? 'adoption' }] };
            }
            return { say: `I couldn't complete that merge — try the button on the proposal, and I'll look into why.`, refs: [] };
          }
          if (res.json.unclear) return { say: clipLabel(String(res.json.unclear), 200), refs: [] };
        }
        if (p.type === 'ask' && res.json.go_ahead === true) {
          // The SAME lifecycle the go-ahead button stamps: proceeded on the turn, the visible
          // decision, and the engine re-runs with what's available (work-with-what-you-have).
          const { data: turn } = await client.from('room_turns').select('id, component, dedupe_key').eq('id', p.turnId).eq('user_id', userId).maybeSingle();
          if (turn) {
            const comp = (turn.component ?? {}) as { key?: string; state?: Record<string, unknown> };
            await client.from('room_turns').update({
              component: { ...comp, state: { ...(comp.state ?? {}), proceeded: true, proceeded_at: new Date().toISOString() } },
            }).eq('id', turn.id);
            const m = /^(?:requires|delegate):([^:]+)/.exec(String(turn.dedupe_key ?? ''));
            if (m) {
              const itemId = m[1];
              void (async () => {
                try {
                  const { buildWorkItems } = await import('@/lib/work-items/model');
                  const { prepareOneItem } = await import('@/lib/prepare/pass');
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const items = await buildWorkItems(client, userId, { todayStr, skipReconcile: true });
                  const w = items.find((x) => x.entityId === itemId);
                  if (w) await prepareOneItem(client, userId, w);
                } catch { /* the go-ahead already landed */ }
              })();
            }
            return { say: "Going ahead with what's available — I'll work around the gaps and note them honestly.", refs: [], applied: [{ tool: 'proceed_ask', title: 'go-ahead' }] };
          }
        }
        if (res.json.unclear) return { say: clipLabel(String(res.json.unclear), 200), refs: [] };
      }
    } catch { /* the pending read is a refinement — the normal flow below still sees the transcript */ }
  }

  // REVISION-IN-PLACE (DH7): the conversation's most recent document card — the classifier is
  // told it exists (so "make the chart blue" reads as a revision, not new work), and the
  // delegation door revises THAT artifact instead of minting a second one.
  const prior = [...(opts.history ?? [])].reverse().find((h) => h.artifact)?.artifact ?? null;
  // The classifier sees the attachment NAMES (a fill-in/produce ask over attached files IS
  // produced work); the full text stays with the paths that do the work. A TRANSITION skips
  // classification entirely — its verdict is structural (the correction/rework branch).
  const verdict = isTransition
    ? { command: null, question: false, facts: [], delegate: null, open: false } as Verdict
    : await classifyTurn(client, userId, scope,
    materialNames ? `${text}\n(THE USER ATTACHED FILES WITH THIS MESSAGE: ${materialNames})` : text,
    prior ? `${transcript}\n(THIS CONVERSATION PRODUCED A DOCUMENT: "${prior.title}" — its card is still open in the panel.)` : transcript);

  // THE ADDRESSED-COWORKER FLOOR (Aug 9, found live: "Sofia, put together a one-page overview…"
  // classified as create_task_item — the addressed hand-off became a to-do on the user's OWN
  // plate). Deterministic: a message that OPENS by addressing a real coworker by name IS a
  // hand-off — the address outranks whatever the classifier mapped. Roster-read, never a
  // hardcoded name list.
  if (!verdict.delegate) {
    const m = text.trim().match(/^([A-Za-zÀ-ÿ]+)\s*[,:—-]\s+(.{8,})/);
    if (m) {
      try {
        const { data: ws } = await client.from('custom_agents').select('name')
          .eq('user_id', userId).eq('is_worker', true).eq('is_active', true);
        const addressed = (ws ?? []).find((w) => String((w as { name: string }).name).split(' ')[0].toLowerCase() === m[1].toLowerCase());
        if (addressed) verdict.delegate = { coworker: m[1], task: m[2].trim() };
      } catch { /* the classifier's verdict stands */ }
    }
  }
  // ── THE FORWARD-MOTION LAW, STRUCTURALLY (Sep 21, the pilot's dead-ended "yes please") ──
  // The assistant offered ("would you like me to offer both options to them?"), the user agreed,
  // and the turn was routed as if it were a fresh QUESTION — so it answered with a question of its
  // own. An agreement to the assistant's OWN offer is an INSTRUCTION: it belongs on the path that
  // has hands. Deterministic and narrow (a bare affirmation, under a turn that ends in a question),
  // and it never touches the item scope, whose affirmations already mean "rework the draft".
  const lastAssistant = [...(opts.history ?? [])].reverse().find((h) => h.role === 'assistant')?.text ?? '';
  const answeringAnOffer = scope.kind !== 'item' && !!lastAssistant
    && endsInAnOffer(lastAssistant) && isAffirmation(text);
  if (answeringAnOffer && !verdict.command && !verdict.delegate) { verdict.question = false; verdict.open = true; }

  // A hand-off OUTRANKS a command (same bug, second face: the classifier returned BOTH
  // delegate AND create_task_item, and the command fast-path ran first — the addressed
  // work landed on the user's own plate instead of the coworker's).
  if (verdict.delegate) verdict.command = null;

  /** The DATA read the router named and the fast path refused to serve (THE PRESENTATION LAW). It
   *  is a stated lookup, so it opens the reach valve below — the loop is told to GO AND GET it. */
  let skippedDataRead: string | null = null;
  // 1 — COMMAND fast-path: direct registry dispatch (~1 extra small call total).
  // THE PRESENTATION LAW (Sep 22, WAVE 0): this path serves the dispatcher's `say` AS the answer,
  // so it may only run for a tool whose result IS an answer — a line hand-written for the person.
  // The permission is opt-IN and lives on the registry row (`resultIs: 'prose'`); everything else
  // is DATA and falls through to the agent loop, which reads it as a tool result and composes.
  // Before, the guard was an opt-OUT set of four names here, and the read tools shipped after it
  // leaked their model-facing blocks into the bubble (the list_tasks incident, Sep 21).
  // A skipped data command is COMPOSITE by definition — marking the turn open keeps it out of the
  // item-scope correction door below, whose job is reworking a draft, not answering a lookup.
  if (verdict.command && resultIsProse(verdict.command.tool)) {
    opts.onProgress?.(progressLabelFor(verdict.command.tool));
    const out = await dispatchCommand(client, userId, scope, verdict.command.tool, verdict.command.args, text, { transcript, roomKey: dlg.roomKey });
    // The type makes the law unbreakable: a data result is not a ConverseTurn and cannot be served.
    if (out && !isToolData(out)) return out;
  } else if (verdict.command && resultIsPresentation(verdict.command.tool)) {
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // THE OBJECT CARD'S FAST PATH (Wave 2, Sep 22).
    //
    // A `presentation` result is a CARD plus ONE sentence COMPOSED BY CODE from the object's own
    // facts (lib/present/event-build.ts `eventFraming`) — arithmetic and the contract's own verb
    // words, with no model anywhere near it. So it is servable exactly like `prose`, and the
    // registry says which is which rather than a branch deciding. `modelText` still never reaches
    // a person on any OTHER path: for a data read it stays a tool message, as before.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    opts.onProgress?.(progressLabelFor(verdict.command.tool));
    const out = await dispatchCommand(client, userId, scope, verdict.command.tool, verdict.command.args, text, { transcript, roomKey: dlg.roomKey });
    if (isToolData(out)) {
      const present = out.present;
      if (isEventPresent(present)) {
        return { say: out.modelText, refs: [], event: { id: present.spec.id, spec: present.spec } };
      }
      // A refusal-by-listing (or an unfound object) has no card and is still CODE's sentence.
      return { say: out.modelText, refs: [] };
    }
    if (out) return out;
  } else if (verdict.command) {
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // THE FAST PATH IS FAST AGAIN — WITHOUT THE LEAK (Wave 1, Sep 22).
    //
    // W0's law ("a tool result is DATA, never the answer") sent every data read through the agent
    // loop, so "what workflows do I have" went from ~1s to a full model round — the right answer,
    // at the price of the cheapest question in the product. THE COLLECTION CARD pays it back: when
    // the read ALSO hands back a `CollectionSpec`, a pure LISTING ask is answered by the card
    // alone — `say` is the framing sentence COMPOSED BY CODE from the rows, the rows are typed,
    // and NOTHING model-facing exists on this path because no model was asked to compose.
    //
    // It is deliberately narrow: an ANALYTICAL ask falls through to the loop (a judgment over the
    // data is not a list of it), and so does a read that produced no spec. A slower right answer
    // beats a faster wrong card.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    const kind = presentsCollectionKind(verdict.command.tool);
    if (kind && isListingAsk(text)) {
      opts.onProgress?.(progressLabelFor(verdict.command.tool));
      const out = await dispatchCommand(client, userId, scope, verdict.command.tool, verdict.command.args, text, { transcript, roomKey: dlg.roomKey });
      // A COLLECTION, STRUCTURALLY: this branch is reached only for a collection-presenting tool,
      // and the narrowing says so in the type rather than trusting that (Wave 2 widened `present`).
      const present = isToolData(out) ? out.present : undefined;
      const spec = present && !isEventPresent(present) ? present : undefined;
      // THE FRAMING IS THE ONLY SENTENCE THIS PATH MAY SERVE — never `modelText`, whose whole job
      // is to be read by a model. An empty collection still answers honestly (its emptyLine is the
      // card's, the framing is the turn's), so a truthful "nothing yet" is a card too.
      if (spec) return { say: spec.framing, refs: [], collection: { id: crypto.randomUUID(), spec } };
    }
    skippedDataRead = verdict.command.tool;
    // THE SKIPPED READ IS STILL A LOOKUP (Sep 22, found by the T17 replay the same hour the law
    // shipped): killing the leak must not make the answer hollow. The router naming a data tool IS
    // the judgment that this turn needs a registry read — so the turn goes to the tool-bearing loop
    // and nowhere else. Left as a `question`, it fell to the TOOLLESS answering pass, which read the
    // brain snapshot, found no workflows in it, and confessed ("I don't have a complete picture of
    // what workflows you actually have") while the verb to look sat one branch away. The loop reads
    // the same grounding AND holds the tool; `open` keeps it out of the item-scope redraft door.
    verdict.question = false;
    verdict.open = true;
  }

  // 2 — DELEGATE: "have Max research X" → the real delegation engine (prepare + report back).
  if (verdict.delegate) {
    return runCoworkerDelegation(client, userId, scope, verdict.delegate.coworker, verdict.delegate.task, text, transcript, material, momentTheme, opts.attachments ?? [],
      verdict.delegate.revises === true ? prior : null);
  }

  // 3 — QUESTION: grounded answer from the scope's memory — the whole brain (global), the deal's
  // memory (entity / linked item), or the item's own context. ONE core; the graders stay
  // single-source. The DIALOGUE + registry MEMORY MATCHES ride the grounding, with the honesty
  // floor: never assert the absence of something they name (the bootcamp "I don't see any
  // bootcamp-related work" class — one turn after the engine itself named 46 items of it).
  //
  // THE REACH VALVE (Sep 18): these sub-paths are TOOLLESS, so a question needing a lookup could only
  // ever end in an honest refusal — confinement, not service. Each prompt now carries ONE contract
  // clause (lib/converse/reach.ts): when answering well needs something outside the context it was
  // handed, the mind replies with the sentinel alone. Code recognises only that token and escalates
  // to the tool-bearing agent loop below — ONE escalation, whose turn is final. THE MODEL decides it
  // needs reach; no code ever reads the user's words to route them. The sentinel check runs BEFORE
  // honestyFloor so the floor never spends a call on — or mutates — a contract token.
  // THE SKIPPED READ OPENS THE VALVE (Sep 22, found by the R3 replay the same hour): routing a data
  // command to the loop is not enough — without the reach note the loop answers from the grounding
  // it was handed and CONFESSES its edge ("my calendar view runs through the 5th"), exactly the
  // confinement the valve exists to break. The router naming a read IS the lookup request.
  let escalateToReach = !!skippedDataRead;
  if (verdict.question) {
    const scopeEntity = scope.kind === 'entity' ? scope.entityId : null;
    const matches = await registryMatches(client, userId, text, scopeEntity);
    const dialogueBlock = [
      ANSWER_HONESTY_RULE,
      transcript, matches,
    ].filter(Boolean).join('\n');
    if (scope.kind === 'global') {
      opts.onProgress?.('Looking across your work…');
      const { answerHomeQuestion } = await import('@/lib/home/ask');
      const { answer, refs } = await answerHomeQuestion(client, userId, text, opts.history ?? []);
      if (needsReach(answer)) escalateToReach = true;
      else return { say: sayInsteadOfSentinel(await honestyFloor(client, userId, answer, text, null)), refs };
    }
    if (!escalateToReach) {
      const entityId = await entityOfScope(client, userId, scope);
      if (entityId) {
        const { answerEntityQuestion } = await import('@/lib/entities/ask');
        const { answer, refs } = await answerEntityQuestion(client, userId, entityId, text, opts.history ?? [],
          { viewing: [dialogueBlock, viewing].filter(Boolean).join('\n\n') });
        if (needsReach(answer)) escalateToReach = true;
        else return { say: sayInsteadOfSentinel(await honestyFloor(client, userId, answer, text, scopeEntity)), refs };
      } else if (scope.kind === 'item') {
        const { buildItemContext } = await import('@/lib/home/item-context');
        const ctx = await buildItemContext(client, userId, scope.itemKind, scope.itemId);
        const { aiCall } = await import('@/lib/ai/call');
        const res = await aiCall<{ answer?: string }>({
          userId, supabase: client, shape: { output: 'json' }, maxTokens: 300, temperature: 0.2, source: 'brain_synthesis',
          prompt: `Answer STRICTLY from this context — plainly, a couple of sentences; if it doesn't cover the question, say so. PLAIN PROSE.\n${dialogueBlock ? `${dialogueBlock}\n` : ''}${viewing ? `${viewing}\n` : ''}--- CONTEXT ---\n${clipWithRule(ctx?.text || '', 3000)}\n--- QUESTION ---\n${text}\n${REACH_CONTRACT}\nReturn ONLY JSON: {"answer":"..."}`,
        });
        const answer = String(res.json?.answer || "I don't have enough on that here.");
        if (needsReach(answer)) escalateToReach = true;
        else return { say: sayInsteadOfSentinel(await honestyFloor(client, userId, answer, text, null)), refs: [] };
      }
    }
    if (escalateToReach) opts.onProgress?.('Looking that up…');
  }

  // 4 — CORRECTION with durable facts (item scope): remember + rework the draft.
  // An escalated question is NOT a correction: it falls through to the loop, never to this door.
  if (scope.kind === 'item' && !verdict.open && !escalateToReach) {
    const turn: ConverseTurn = { say: '', refs: [] };
    if (verdict.facts.length) {
      for (const f of verdict.facts) {
        const r = await executeRememberFact({ client, userId }, { fact: f, linkKind: linkKindOf(scope), itemId: scope.itemId });
        if (r.ok) { turn.learned = [...(turn.learned ?? []), f]; turn.entityName = r.entityName ?? turn.entityName; }
      }
    }
    // Rework the prepared draft with the guidance (email → reply draft; followup/commitment → nudge).
    // ONE LANE, TWO CONSEQUENCES: `redraftItemDraft` IS the redraft path — this door asks it for the
    // PERSISTING form (a picked steer is a deed), the preview door asks it for the same words with
    // nothing written. See A PREVIEW IS NOT A DEED above the helper.
    try {
      const body = await redraftItemDraft(client, userId, scope, text, { persist: true, learned: turn.learned });
      if (body) turn.draft = body;
    } catch { /* non-fatal — memory still landed */ }
    const bits: string[] = [];
    if (turn.draft) bits.push(isTransition ? 'Done — the reply enacting your choice is ready to review' : 'I reworked the draft with that');
    if (turn.learned?.length) bits.push(turn.entityName ? `noted it on ${turn.entityName}` : 'noted it for next time');
    turn.say = bits.length ? `${bits.join(', ')}.` : 'Got it.';
    return turn;
  }

  // 5 — OPEN / composite → the agent loop, grounded in THE ONE GROUNDING (Aug 5, the one-system
  // arc): the same assembled page the responder and the question path read — the loop can never
  // reason from a thinner slice of the truth than the panel it sits beside.
  let grounding = '';
  const entityId = await entityOfScope(client, userId, scope);
  if (entityId || scope.kind === 'item') {
    try {
      const { assembleRoomGrounding } = await import('@/lib/room/grounding');
      const g = await assembleRoomGrounding(client, userId,
        entityId ? { kind: 'entity', entityId } : { kind: 'item', itemKind: linkKindOf(scope as Extract<ConverseScope, { kind: 'item' }>) === 'inbox_item' ? 'inbox' : linkKindOf(scope as Extract<ConverseScope, { kind: 'item' }>) === 'commitment' ? 'commitment' : 'meeting', itemId: (scope as Extract<ConverseScope, { kind: 'item' }>).itemId });
      grounding = g.text;
    } catch { /* fall through to the item/global fallbacks below */ }
  }
  if (!grounding && scope.kind === 'item') {
    const { buildItemContext } = await import('@/lib/home/item-context');
    const ctx = await buildItemContext(client, userId, scope.itemKind, scope.itemId);
    grounding = ctx?.text || '';
  } else if (scope.kind === 'global') {
    // Global open turns hold the SAME brain snapshot the Home ask answers from (one read, one
    // truth) — WITH the one-grounding focus (Aug 5): the question threads through, so a named
    // entity's full room page rides along; the wider slice keeps the appended focus block alive.
    const { buildBrainSnapshot } = await import('@/lib/home/ask');
    grounding = (await buildBrainSnapshot(client, userId, text)).text;
  }
  // The agent loop sees the conversation + registry matches too (one law, every path), under the
  // same honesty floor.
  const matches = await registryMatches(client, userId, text, scope.kind === 'entity' ? scope.entityId : null);
  // THE ESCALATION CARRIES ITS REASON (Sep 18, found live by the R3 gate): escalating silently put
  // the loop in front of the SAME confined context the answering pass had just judged insufficient —
  // and told to "ground every claim in the CONTEXT below; when it doesn't cover something, say so
  // plainly", it dutifully confessed a second time. The valve opened and nothing came through. The
  // note is a FACT THE MODEL ITSELF PRODUCED one call earlier (it asked for reach), not a reading of
  // the user's words — the law holds: the system reasons, code only carries what it decided.
  // THE PHANTOM OFFER dies here (found by the reach gates, Sep 18): on a workspace whose feature
  // map withholds the calendar verb, the escalated loop's toolset is filtered — an instruction to
  // "call check_calendar" would make it promise a check it structurally cannot perform. The note
  // matches the tools the loop will actually hold: reach where the verb exists, plain honesty
  // where it doesn't (the sovereign copy law: capability shapes vocabulary).
  let reachCalendarHeld = true;
  if (escalateToReach) {
    try {
      const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
      const feats = await getWorkspaceFeatures(userId, client) as unknown as Record<string, boolean>;
      reachCalendarHeld = feats?.meetings !== false;
    } catch { /* unreadable features → assume held (the loop's own filter still governs) */ }
  }
  const reachNote = escalateToReach
    ? `A LOOKUP WAS ALREADY REQUESTED FOR THIS TURN: ${skippedDataRead
        ? `this turn was routed here because answering it needs the ${skippedDataRead} read`
        : 'the answering pass judged that the context below does NOT cover this question'}` +
      `. USE YOUR TOOLS to go and get what it needs before you answer — ` +
      (reachCalendarHeld
        ? `for anything about the calendar, availability or free time that means calling check_calendar ` +
          `for the dates in question, even when they fall outside any window the context states. `
        : `note that this workspace has NO calendar access, so for anything about the calendar, ` +
          `availability or free time, say plainly that calendar access isn't set up here — never ` +
          `guess, and never offer to check it. `) +
      `Do NOT answer from the context alone, do NOT say you cannot see something a tool can fetch, ` +
      `and do NOT offer to check: checking is what you are doing.`
    : '';
  // THE CONTEXT BUDGET (W2.7, found by reading the seam): the loop used to receive
  // `preamble + grounding` and tail-chop the concatenation at 4,000 chars — so a long room
  // transcript silently ate the whole grounding (the "wider 7,000-char" snapshot never reached the
  // model at all). The page is PACKED now: the rules and the reach note stand whole, registry
  // matches and the viewed item next, the grounding after them, and the room transcript yields
  // first — from its OLDEST end (keepTail: latest last). Every cut and drop declares itself.
  const [transcriptHead, ...transcriptBody] = String(dlg.transcript || '').split('\n');
  const packedContext = packContext([
    { id: 'honesty', text: ANSWER_HONESTY_RULE, priority: 1000 },
    { id: 'reach', text: reachNote, priority: 1000 },
    // THE FORWARD-MOTION LAW as the mind reads it — the agreement IS the instruction.
    { id: 'forward', text: answeringAnOffer ? FORWARD_MOTION_DIRECTIVE : '', priority: 1000 },
    { id: 'transcript-head', text: transcriptHead ?? '', priority: 900 },
    { id: 'transcript', label: 'the older room transcript', text: transcriptBody.join('\n'), glue: '\n', priority: 100, keepTail: true, minChars: 600 },
    { id: 'matches', text: matches, priority: 800 },
    { id: 'viewing', text: viewing, priority: 700 },
    { id: 'grounding', label: 'the room grounding', text: grounding, priority: 500, minChars: 1500 },
  ], LOOP_CONTEXT_BUDGET).text;
  // The PANEL conversation rides as REAL messages (not a squeezed grounding block) — a follow-up
  // operates on the prior answer at full fidelity, the way any chat model expects. The room
  // narration transcript stays in the preamble (room callers don't always carry panel history).
  let loopTurn = await agentLoop(client, userId, scope, text, packedContext,
    opts.history, opts.onProgress, material, opts.onToken, { transcript, roomKey: dlg.roomKey });
  // NEVER RE-ASK WHAT YOU JUST ASKED (Sep 21) — the prompt directive above carries the law; this is
  // the deterministic floor under it, because a law is only alive while something enforces it. If an
  // affirmation came back as a near-verbatim repeat of the very question it answered, the turn is
  // spent ONE more time with the failure named. The retry is TOKENLESS: the first attempt already
  // streamed, and the `done` frame is what the user finally reads.
  if (answeringAnOffer && loopTurn.say && repeatsTheQuestion(lastAssistant, loopTurn.say)) {
    const retry = await agentLoop(client, userId, scope, text,
      `${FORWARD_MOTION_DIRECTIVE}\nYOU HAVE ALREADY RE-ASKED THIS QUESTION ONCE. Do not ask it again — ` +
      `act on what the conversation already states, or say in one sentence what you cannot do and what ` +
      `you are doing instead.\n\n${packedContext}`,
      opts.history, opts.onProgress, material, undefined, { transcript, roomKey: dlg.roomKey })
      .catch(() => null);
    if (retry?.say && !repeatsTheQuestion(lastAssistant, retry.say)) loopTurn = retry;
  }
  // THE EXHAUSTION HAND-OFF (Aug 10, found live: the loop's old bare "I couldn't finish that
  // one." beside a competitor's finished document): when the inline loop can't land the work,
  // the work — WITH the user's full material and the conversation — goes to the production
  // engine instead. Failure = delegation, never a dead end. Clara is the produce default
  // (the drafting assistant — Sofia retired Aug 14, her lane folded into Clara); a named
  // coworker would have taken the fast-path long before here.
  if (loopTurn.exhausted) {
    opts.onProgress?.('This needs real production — handing it to the team…');
    const handed = await runCoworkerDelegation(client, userId, scope, 'clara',
      clipForPrompt(text.replace(/\s+/g, ' '), 80), text, transcript, material, momentTheme, opts.attachments ?? []);
    if (handed.delegated) return handed;
    return { say: "I couldn't finish this one inline, and the hand-off didn't go through either — try again in a moment, or name a coworker (\"Max: …\") to take it.", refs: [] };
  }
  return loopTurn;
}
