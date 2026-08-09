// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CAPABILITY REGISTRY (proactive-team W1 — docs/proactive-team-plan.md).
//
// Two halves, ONE module, so the judge's verb space and the engine's hands can never drift:
//   • WORK_COMPONENTS — one row per component the plane can mount. THE JUDGE reads this list and
//     picks; each row now carries its `capability` binding (the CAPABILITY_MAP key that commits or
//     produces it), so "the judge can say it" and "the engine can do it" are declared side by side.
//   • CAPABILITY_MAP — the execution-character map (built / atomic-vs-judgment / irreversible),
//     formerly lib/home/capability-map.ts (now a re-export shim). The item-plan classifier, the
//     prepared-action router, and the owner proposer all read THIS.
//
// The W1 law: every work verb the judge can emit has a preparation path. `registryParity()` states
// it mechanically and the promise gate (P21) asserts it — a verb without hands is a build error,
// never a silent none.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { FeatureKey } from '@/lib/workspace/types';

export type WorkComponentKey =
  | 'message_only'     // the honest none — the message + the conversation, no fake work
  | 'reply_composer'   // a reply the user owes — the prepared draft prefilled
  | 'decision'         // a yes/no/route choice — numbered options, decline always last
  | 'document'         // a produced deliverable to review (coworker output, prep briefs)
  | 'send_file'        // send an EXISTING document — composer + the resolved attachment chip
  | 'invite'           // schedule — the prepared calendar invite
  | 'forward'          // pass the thread to a named third party
  | 'chase';           // a nudge for something someone else owes

export type WorkGate = 'send' | 'book' | 'share' | null;

/** One-room R2 — the component's INTERACTION CLASS, decided once here, never per-surface:
 *  'inline' renders inside a conversation turn (resolved in a glance/tap); 'stage' is a workspace
 *  that opens in the side panel FROM its inline card. */
export type WorkSurface = 'inline' | 'stage';

export const WORK_COMPONENTS: ReadonlyArray<{
  key: WorkComponentKey; gate: WorkGate; surface: WorkSurface;
  /** The CAPABILITY_MAP key whose executor COMMITS this component (null = nothing commits — an
   *  inline read/choice). The gate and the capability's `irreversible` must agree — parity checks it. */
  capability: string | null;
  when: string;
}> = [
  { key: 'message_only', gate: null, surface: 'inline', capability: null, when: 'nothing is owed by anyone — informational, the chat suffices' },
  { key: 'reply_composer', gate: 'send', surface: 'stage', capability: 'send_email', when: 'a real person awaits a reply FROM the user' },
  { key: 'decision', gate: null, surface: 'inline', capability: null, when: 'the real move is a CHOICE between a few concrete routes (accept/decline/redirect)' },
  { key: 'document', gate: null, surface: 'stage', capability: 'generate_document', when: 'a produced deliverable exists to review (research, a brief, a deck draft)' },
  { key: 'send_file', gate: 'send', surface: 'stage', capability: 'send_email', when: 'an EXISTING document must be sent/shared to someone' },
  { key: 'invite', gate: 'book', surface: 'inline', capability: 'send_calendar_invite', when: 'the move is scheduling a real meeting/call' },
  { key: 'forward', gate: 'send', surface: 'inline', capability: 'forward_email', when: 'the thread should go to a NAMED third party (the item names who it must reach)' },
  { key: 'chase', gate: 'send', surface: 'stage', capability: 'send_email', when: 'someone ELSE owes the user and a nudge is the move' },
];

/** Where a component renders — the stream renderer + the stage both read THIS, never a local map. */
export const surfaceOf = (key: WorkComponentKey): WorkSurface =>
  WORK_COMPONENTS.find((c) => c.key === key)?.surface ?? 'inline';

export const COMPONENT_KEYS: ReadonlySet<string> = new Set(WORK_COMPONENTS.map((c) => c.key));
export const gateOf = (key: WorkComponentKey): WorkGate => WORK_COMPONENTS.find((c) => c.key === key)?.gate ?? null;

/** The natural component for each work verb — STRUCTURAL coherence, not a second judgment: the
 *  model picks the WORK; when its component half drifts (e.g. "chase" + "message_only"), the
 *  registry supplies the consistent mount. `produce` maps to `document` (the deliverable to
 *  review); `none` is the only work whose component is message_only. */
export const componentForWork = (work: string): WorkComponentKey | null => (({
  none: 'message_only', reply: 'reply_composer', decide: 'decision', produce: 'document',
  send_file: 'send_file', schedule: 'invite', forward: 'forward', chase: 'chase',
} as Record<string, WorkComponentKey>)[work] ?? null);

/** Every work verb the judge may emit — derived here so the judge, the parity gate, and the pass
 *  share ONE list (a verb added here without a preparation path fails P21, by design). */
export const WORK_VERBS = ['reply', 'decide', 'produce', 'send_file', 'schedule', 'forward', 'chase', 'none'] as const;
export type WorkVerb = (typeof WORK_VERBS)[number];

/** Rendered for the judge's prompt — the registry IS the option list (never a hardcoded enum there). */
export const renderComponentOptions = (): string =>
  WORK_COMPONENTS.map((c) => `- "${c.key}": ${c.when}`).join('\n');

/** Bump when the verdict schema/prompt changes — cached verdicts self-invalidate. */
export const JUDGE_VERSION = 14; // 14: ATTACHABLE-REQUIRES — a require is a THING (document/file/link), never a confirmation/decision/answer (the "attach a confirmation of the time" ask, found live). 13: THE EXCERPT-HONESTY LAW — clips end at boundaries + declare themselves; the prompt rules a clip marker is OUR cutting, never source truncation (a normal email read as "cut off mid-sentence" — found live). 12: THE USER'S CLOCK — local day/hour, same-day expiry with a code-verified stated time, event-boundary sig. 11: the sender floor. 10: expired requires a STATED date. 9: `revisit` + open-ask fact. 8: `forward` + failure honesty.

// ── registryParity — the W1 structural law, stated mechanically for the P21 gate: every verb maps
// to a component; every gated component binds a BUILT capability whose irreversible flag agrees
// with the gate. Returns the violations (empty = lawful). ──
export function registryParity(): string[] {
  const out: string[] = [];
  for (const verb of WORK_VERBS) {
    const comp = componentForWork(verb);
    if (!comp || !COMPONENT_KEYS.has(comp)) out.push(`verb "${verb}" maps to no registered component`);
  }
  for (const c of WORK_COMPONENTS) {
    if (!c.gate) continue;
    const cap = c.capability ? CAPABILITY_MAP[c.capability] : null;
    if (!cap) out.push(`gated component "${c.key}" binds no capability`);
    else if (!cap.built) out.push(`gated component "${c.key}" binds an unbuilt capability "${c.capability}"`);
    else if (!cap.irreversible) out.push(`gated component "${c.key}" binds "${c.capability}" which is not marked irreversible — the gate and the map disagree`);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CAPABILITY MAP — the single, AGNOSTIC source of truth for what AUGMTD can actually DO today.
// (Moved here from lib/home/capability-map.ts in the W1 registry merge — that module is now a
// re-export shim, so every existing importer reads THIS one truth.)
//
// This is the SIBLING of `lib/workspace/tool-capabilities.ts` (`TOOL_FEATURE`): that map answers
// "which workspace feature gates this tool?"; THIS map answers "what is this capability's EXECUTION
// CHARACTER?" — is it built, is it atomic vs judgment, is it irreversible. The item-plan classifier
// (`lib/home/item-plan.ts`) grades every sub-task against THIS map instead of a hand-written prose
// blurb, so the two stay aligned by construction and the classifier prompt is DERIVED from the map.
//
// AGNOSTIC RULE (the design invariant): adding a capability = ONE entry here (+ its registered tool).
// The classifier prompt then lists it automatically — no per-capability branch anywhere.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── PLAN_VERSION — the auto-invalidation stamp for cached ITEM PLANS (`item_plans.version`). BUMP
// whenever the CAPABILITY_MAP or the classifier prompt/rules change. Co-located with JUDGE_VERSION
// so both invalidation stamps live in the ONE registry module — deliberately SEPARATE constants:
// they invalidate different caches (plans vs judgments) and coupling them would regenerate every
// item plan on a judge-prompt tweak (waste, not rigor).
export const PLAN_VERSION = 5; // 5: run_compute (Arc 1 — sandboxed code over the user's files; computed numbers, never asserted ones). 4: the parity law — send_prepared_reply + prepare_forward in the chief slice

// 'atomic'   → deterministic, no judgment → the System runs it directly (a `tool`/`ai` workflow step).
// 'judgment' → benefits from a coworker's voice/reasoning/skills → an `agent` step.
export type CapabilityKind = 'atomic' | 'judgment';

// Who may HOLD a capability (P6b): 'chief_of_staff' = the user's own conversational surfaces (rail /
// Home / entity chat — acts on the user's behalf with their consent in-channel); 'coworker' = the AI
// coworkers' agent loop; 'workflow' = Studio task steps. Personal-surface actions (dismissing YOUR
// inbox, remembering on YOUR deals) are chief_of_staff-only — a coworker never holds them.
export type CapabilityExposure = 'chief_of_staff' | 'coworker' | 'workflow';

export interface Capability {
  intent: string;               // human phrase the classifier matches a step's intent against
  tool: string;                 // registry key in lib/tools/* (or a route id for send-as-user paths)
  built: boolean;               // is the executor actually wired TODAY? false → grade [You] honestly
  kind: CapabilityKind;         // atomic → System runs it; judgment → suits a Coworker
  irreversible: boolean;        // send / post / create-invite → forces an approval gate
  feature?: FeatureKey | null;  // cross-ref to TOOL_FEATURE so a disabled feature also gates it
  blurb: string;                // one terse line rendered into the classifier prompt
  /** Which agents/surfaces may hold this tool. Absent = the pre-P6b default (coworker + workflow). */
  exposure?: CapabilityExposure[];
  /** A CONVERSATION-FLOW capability (dispatcher/ask) — real in chat loops, but never a plan STEP:
   *  excluded from the item-plan classifier prompt (a step graded "assign_to_coworker" would have
   *  no assembler path). */
  conversational?: boolean;
  /** MCP-backed capability (Phase 5D): served by a SELF-HOSTED MCP server mounted on AgentOS (never
   *  a hosted relay — sovereignty). Adoption recipe (infra/agentos/README.md): review + pin the
   *  server → verify TENANT-SAFETY (per-call auth via Nango, never startup credentials) → run on the
   *  box → AGENTOS_MCP_SERVERS → THEN this row. The registry stays the gate: an MCP tool without a
   *  row does not exist in the product. */
  mcp?: { server: string; tool: string };
}

// Keyed by the registry key (1:1 with the tools registry / TOOL_FEATURE so they can't drift).
export const CAPABILITY_MAP: Record<string, Capability> = {
  // ── Read / fetch (atomic, reversible) ──
  search_knowledge_base: {
    intent: 'search or read the knowledge base / Drive documents',
    tool: 'search_knowledge_base', built: true, kind: 'atomic', irreversible: false, feature: 'drive', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'search / read the knowledge base (Drive documents we have indexed)',
  },
  read_document: {
    intent: 'read a specific document or file we already have',
    tool: 'read_document', built: true, kind: 'atomic', irreversible: false, feature: 'drive', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'read a specific document/file we already have',
  },
  get_emails: {
    intent: 'read emails / look up an email thread in the inbox',
    tool: 'get_emails', built: true, kind: 'atomic', irreversible: false, feature: 'email', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'read the inbox / an email thread we have',
  },
  get_calendar: {
    intent: 'read the calendar / check availability of upcoming meetings',
    tool: 'get_calendar', built: true, kind: 'atomic', irreversible: false, feature: 'meetings',
    blurb: 'read the calendar (upcoming meetings / availability)',
  },
  get_meeting_context: {
    intent: 'read a meeting / transcript we recorded',
    tool: 'get_meeting_context', built: true, kind: 'atomic', irreversible: false, feature: 'meetings', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'read a meeting / transcript we recorded',
  },
  web_search: {
    intent: 'search the web / fetch a public web page',
    tool: 'web_search', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'search the web / fetch a public page',
  },
  deep_research: {
    intent: 'run multi-source deep research on a topic',
    tool: 'deep_research', built: true, kind: 'judgment', irreversible: false, feature: null,
    blurb: 'multi-source deep research on a topic',
  },
  find_team_work: {
    intent: "find or read a teammate coworker's recent work",
    tool: 'find_team_work', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: "find / read a teammate coworker's recent work",
  },
  slack_read_messages: {
    intent: 'read messages from a Slack channel',
    tool: 'slack_read_messages', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'read a Slack channel',
  },

  // ── Produce (reversible until sent) ──
  analyze: {
    intent: 'analyze / summarize / reason over content we already have',
    tool: 'ai', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'analyze / summarize / reason over content we already have',
  },
  compose_email: {
    intent: 'draft an email, reply, or message in the user\'s voice',
    tool: 'compose_email', built: true, kind: 'judgment', irreversible: false, feature: null,
    blurb: 'draft an email / reply / message (drafting only — sending is a separate step)',
  },
  generate_document: {
    intent: 'generate / produce a document or deliverable',
    tool: 'generate_document', built: true, kind: 'judgment', irreversible: false, feature: null,
    blurb: 'generate a document / deliverable',
  },

  // ── Compute (Arc 1, docs/one-surface-plan.md — the deliverable ceiling): model-written code in
  // the locked sandbox (infra/compute — no network, declared read-only inputs, hard caps). Atomic +
  // REVERSIBLE BY CONSTRUCTION (the room can't send); the trust laws generalized — numbers computed,
  // never asserted. ──
  run_compute: {
    intent: 'compute over files/data with code — parse or reconcile spreadsheets/PDFs/CSVs, verify numbers, transform data, produce a data file',
    tool: 'run_compute', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'RUN CODE over files/data we have (parse/verify/transform spreadsheets, PDFs, CSVs; compute numbers; produce a data file) — sandboxed, cannot send anything',
  },

  // ── THE PRODUCTION ARC step 1 (Aug 8) — the WORKFLOW STEP SPACE joins the one registry.
  // Workflows were the last consumer of the pre-registry flat toolkit: the picker, the step
  // executor, and generate-config each carried their own list. Now every pipeline step id has a
  // row here (exposure 'workflow'); the executor GATES on it (a tool without a row does not run);
  // the smoke parity check keeps picker/prompt lists from drifting. Reads reversible; the only
  // send-shaped step (slack_send) is irreversible → the coming APPROVAL STEP's gate. ──
  read_kb_file: {
    intent: 'read one knowledge-base file in full by id (a pipeline source)',
    tool: 'read_kb_file', built: true, kind: 'atomic', irreversible: false, feature: 'drive', exposure: ['workflow'],
    blurb: 'READ one knowledge-base file in full (pipeline source)',
  },
  fetch_url: {
    intent: 'read the full current content of a specific web page every run',
    tool: 'fetch_url', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['workflow'],
    blurb: 'READ a specific web page (date-stamped; never a news landing page — use rss_feed)',
  },
  rss_feed: {
    intent: 'follow a news or blog feed — new items only since last run, each with its publication date',
    tool: 'rss_feed', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['workflow'],
    blurb: 'FOLLOW an RSS/Atom feed (new items since last run, dated; category_filter for site-wide feeds)',
  },
  browser_fetch: {
    intent: 'fetch a JS-heavy page with a real browser when plain fetch fails',
    tool: 'browser_fetch', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['workflow'],
    blurb: 'FETCH a JS-rendered page with a headless browser (fallback for dynamic sites)',
  },
  get_pt_tenders: {
    intent: 'fetch Portuguese public tenders/contracts from Portal Base (Base.gov.pt)',
    tool: 'get_pt_tenders', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['workflow'],
    blurb: 'FETCH Portuguese public tenders from Base.gov.pt (day-window enforced code-side)',
  },
  get_workflow_output: {
    intent: "pull the latest output of another task/workflow as context (build on a teammate's work)",
    tool: 'get_workflow_output', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['workflow'],
    blurb: "USE another task's latest output as context (cross-task composition)",
  },
  slack_read_channel: {
    intent: 'read recent messages from a Slack channel as a pipeline source',
    tool: 'slack_read_channel', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['workflow'],
    blurb: 'READ a Slack channel (recent messages as pipeline input)',
  },
  slack_send: {
    intent: 'post a coworker-written message to a Slack channel from the pipeline output',
    tool: 'slack_send', built: true, kind: 'atomic', irreversible: true, feature: null, exposure: ['workflow'],
    blurb: 'SEND a Slack message from the pipeline (real post — the approval-gated send step)',
  },

  // ── THE DISPATCHER + THE SENSIBLE ASK (Aug 8 — production asks reach the team without the
  // user routing; decisions reach the user ONLY when consequential and non-inferable). Both
  // conversation-core: delegation is REVERSIBLE (work lands as a room report-back, nothing
  // external fires) so a clear fit ACTS with visible attribution; offer_choices is the loop's
  // ONE ask channel — actionable options, never a wall of questions. ──
  assign_to_coworker: {
    intent: "hand a production task (report, draft, research, analysis, post) to the best-fit coworker when the user didn't name one",
    tool: 'assign_to_coworker', built: true, kind: 'judgment', irreversible: false, feature: null, exposure: ['chief_of_staff'], conversational: true,
    blurb: 'ASSIGN produced work to the best-fit coworker and start it now (reversible — it reports back here)',
  },
  offer_choices: {
    intent: 'put one genuinely consequential, non-inferable decision to the user as tappable options',
    tool: 'offer_choices', built: true, kind: 'judgment', irreversible: false, feature: null, exposure: ['chief_of_staff'], conversational: true,
    blurb: 'ASK the user ONE consequential decision as tappable options (sparingly — never to confirm reversible acts)',
  },

  // ── Commit (irreversible → approval gate) ──
  send_email: {
    intent: 'send an email as the user (connected mailbox)',
    tool: 'send_email', built: true, kind: 'atomic', irreversible: true, feature: 'email',
    blurb: 'SEND an email as the user (connected mailbox)',
  },
  slack_post_message: {
    intent: 'post a message to a Slack channel',
    tool: 'slack_post_message', built: true, kind: 'atomic', irreversible: true, feature: null,
    blurb: 'POST a message to Slack',
  },
  send_calendar_invite: {
    intent: 'put a meeting on the calendar / send a calendar invite to attendees',
    tool: 'send_calendar_invite', built: true, kind: 'atomic', irreversible: true, feature: 'meetings',
    blurb: 'SEND a calendar invite / put a meeting on the calendar (real Google/Outlook event, notifies attendees)',
  },
  // ── S5 proof-of-agnosticism: one map row + a registered executor + a prepared-action surface makes
  // "forward the deck to finance" flip from [You] to [System]. proposeOwner / the classifier / the
  // assembler needed NO structural edits — they read this map. Real send → irreversible → approval gate.
  forward_email: {
    intent: 'forward an email we already have to a new recipient (e.g. forward the deck to finance)',
    tool: 'forward_email', built: true, kind: 'atomic', irreversible: true, feature: 'email',
    blurb: 'FORWARD an existing email to another recipient (real send as the user)',
  },

  // ── P6b — the personal-surface doables (chief-of-staff exposure ONLY; a coworker never resolves
  // the user's inbox or writes their deal memory). Executors in lib/tools/item-actions.ts — the SAME
  // implementations the API routes call. Reversible ones execute directly (undoable via /api/restore);
  // the irreversible flag on sends stays the structural approve gate.
  resolve_inbox_item: {
    intent: 'mark the current email/notice done or dismiss it from the Home',
    tool: 'resolve_inbox_item', built: true, kind: 'atomic', irreversible: false, feature: 'email',
    blurb: 'mark the current item done / dismiss it (reversible)', exposure: ['chief_of_staff'],
  },
  resolve_commitment: {
    intent: 'mark the current commitment or follow-up done or dismissed',
    tool: 'resolve_commitment', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'mark the current commitment done / dismissed (reversible)', exposure: ['chief_of_staff'],
  },
  find_file: {
    intent: 'find a document/file across the knowledge base, past attachments and connected drives',
    tool: 'find_file', built: true, kind: 'atomic', irreversible: false, feature: 'drive',
    blurb: 'find a file (KB, attachments, connected drives — read-only)', exposure: ['chief_of_staff', 'coworker', 'workflow'],
  },
  remember_fact: {
    intent: "save a durable fact/constraint onto this deal's memory",
    tool: 'remember_fact', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: "remember a durable fact on the deal (future drafts respect it)", exposure: ['chief_of_staff'],
  },
  propose_standing_task: {
    intent: 'the user asks for a RECURRING deliverable (weekly report, daily digest) — propose the standing task for confirmation',
    tool: 'propose_standing_task', built: true, kind: 'atomic', irreversible: false, feature: 'studio',
    blurb: 'propose a STANDING task ("weekly report on X") — places the confirm card; creates nothing by itself', exposure: ['chief_of_staff'],
  },
  steer_standing_task: {
    intent: 'feedback on a standing/recurring task ("less macro, more tenders") — bake it into the method so future runs inherit it',
    tool: 'steer_standing_task', built: true, kind: 'atomic', irreversible: false, feature: 'studio',
    blurb: 'apply feedback to a STANDING task\'s method (next runs inherit it) — only in the standing task\'s room', exposure: ['chief_of_staff'],
  },
  read_action_history: {
    intent: 'read the ledger of actions taken — what was sent, committed, done, delegated recently',
    tool: 'read_action_history', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'read the action ledger ("what was sent this week?", "what did we do on X?") — read-only', exposure: ['chief_of_staff'],
  },
  // ── MEMBERSHIP / PROJECT management (projecthood-plan P4) — the "manage my projects" verbs, in the
  // registry so every chat surface gets them at once. All reversible-or-logged; none send anything.
  move_item_to_project: {
    intent: 'move this item into a different project, or take it out of its project',
    tool: 'move_item_to_project', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: "move the open item to another project / out of its project ('this isn't part of X')", exposure: ['chief_of_staff'],
  },
  set_project_status: {
    intent: "change a project's lifecycle: done, archived, reopened, or not-a-project",
    tool: 'set_project_status', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: "mark a project done / archive / reopen / 'not a project'", exposure: ['chief_of_staff'],
  },
  merge_projects: {
    intent: 'merge two projects that are really one body of work',
    tool: 'merge_projects', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'merge two projects into one (everything moves to the kept one)', exposure: ['chief_of_staff'],
  },
  create_project: {
    intent: 'start a new project to track, optionally founded from the item being viewed',
    tool: 'create_project', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'start a new project ("start a project called X from this")', exposure: ['chief_of_staff'],
  },
  create_task_item: {
    intent: "add a task to the user's plate, optionally on a project",
    tool: 'create_task_item', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'add a task ("add a task on Acme: chase the signed NDA, due Friday")', exposure: ['chief_of_staff'],
  },
  // ── THE PARITY LAW (Aug 4): every verb the UI offers must be SAYABLE. "Send it" typed in the
  // room IS the user's explicit approval — it fires the SAME send door (exactly-once, logged),
  // behind a deterministic explicit-send floor. "Forward to X" prepares + points at the stage;
  // the approve click stays the commit.
  send_prepared_reply: {
    intent: 'send the ALREADY-DRAFTED reply on the current item — only when the user explicitly says to send',
    tool: 'send_prepared_reply', built: true, kind: 'atomic', irreversible: true, feature: 'email',
    blurb: 'send the prepared reply ("send it") — fires only on the user\'s own explicit send word', exposure: ['chief_of_staff'],
  },
  prepare_forward: {
    intent: 'prepare forwarding the current email to someone for review & approval (never sends by itself)',
    tool: 'prepare_forward', built: true, kind: 'atomic', irreversible: false, feature: 'email',
    blurb: 'prepare a forward ("forward this to Rita") — review & approve on the card before anything sends', exposure: ['chief_of_staff'],
  },
};

/** The capability slice a given surface/agent may hold — THE exposure filter (P6b). Absent exposure =
 *  the pre-P6b default (coworker + workflow), so existing tools' behavior is unchanged. */
export function capabilitiesFor(surface: CapabilityExposure): Capability[] {
  return Object.values(CAPABILITY_MAP).filter((c) =>
    c.built && (c.exposure ? c.exposure.includes(surface) : surface !== 'chief_of_staff'));
}

// Only the capabilities that are actually wired today drive the classifier prompt —
// conversation-flow capabilities (dispatcher/ask) and WORKFLOW-ONLY step tools excluded:
// neither is an item-plan step (a feed-follow belongs to pipelines, not an email's plan).
function builtCapabilities(): Capability[] {
  return Object.values(CAPABILITY_MAP).filter((c) =>
    c.built && !c.conversational && !(c.exposure && c.exposure.length === 1 && c.exposure[0] === 'workflow'));
}

/** THE WORKFLOW STEP GATE (production arc step 1): may this tool id run as a pipeline step?
 *  Absent exposure = the pre-P6b default (coworker + workflow). */
export function isWorkflowStepTool(id: string): boolean {
  const c = CAPABILITY_MAP[id];
  if (!c || !c.built) return false;
  const exp = c.exposure ?? ['coworker', 'workflow'];
  return exp.includes('workflow');
}

// ── The orchestration-board runtime helpers. A plan task carries a coarse `capability`
// (draft|analyze|fetch|send); these translate that coarse grade into the board's owner·state·action
// model WITHOUT re-deriving per-task logic — they read the SAME CAPABILITY_MAP the classifier grades
// against, so the panel and the classifier can't drift.
//
// A step's capability may match several map entries (e.g. `fetch` ↔ any of the read/fetch tools); we
// answer at the coarse level the plan actually stores. The map's own entries drive the character:
//   • 'draft'   → produce content, reversible (compose_email / generate_document / analyze).
//   • 'analyze' → reason over what we already have, reversible + atomic → AUGMTD can RUN it directly.
//   • 'fetch'   → read/look-up, reversible + atomic, but INSTANCE-honest (only when evidenced) — the
//                 classifier already downgrades an unevidenced fetch to [You], so a fetch step that
//                 survived as [System] is safe to run.
//   • 'send'    → irreversible commit → approval gate (never auto-fires).

// Is this coarse system capability an IRREVERSIBLE send (→ approval gate before it commits)?
export function isIrreversibleCapability(cap: PlanCapability): boolean {
  return cap === 'send';
}

// Can AUGMTD RUN this system step directly, right now, reversibly ("Hand to AUGMTD")? True for the
// reversible atomic produce/read capabilities (analyze / fetch). A `draft` is handled by the prepared
// composer surface (not this direct-run path); a `send` is gated. Grounded in the map's `irreversible`.
export function isDirectRunnableCapability(cap: PlanCapability): boolean {
  return cap === 'analyze' || cap === 'fetch';
}

// A convenience for the plan-capability type used by the helpers above (mirrors item-plan's).
type PlanCapability = 'draft' | 'analyze' | 'fetch' | 'send' | null;

// ── PROPOSED OWNER — the "Run the plan" model's core derivation. Given a step's actor + coarse
// capability, propose WHO should own it BEFORE the user reassigns. This is what makes coworkers
// actually SUGGESTED (they never were before — only AUGMTD/you).
//
//   • actor 'you'                    → 'you'   (no capability — the user's move)
//   • actor 'system' + JUDGMENT cap  → 'coworker' (draft/produce — voice/reasoning/skill work a
//                                       coworker is MEANT for; still AUGMTD-runnable if reassigned)
//   • actor 'system' + ATOMIC cap    → 'system' (send/fetch/analyze — deterministic, AUGMTD runs it)
//
// The judgment↔atomic split is DERIVED from the CAPABILITY_MAP's `kind`, not hand-coded: `draft` maps
// to the map's judgment producers (compose_email / generate_document), while `analyze`/`fetch`/`send`
// map to atomic entries. So adding a capability changes the proposal by construction — no branch here
// to keep in sync. `handedTo` (a step already delegated) is resolved by the caller (it's an explicit,
// not proposed, owner) — this answers the PROPOSAL for a not-yet-handed step.
export type ProposedOwner = 'system' | 'coworker' | 'you';

// The coarse-capability → CapabilityKind bridge, read from the map so the two can't drift. A `draft`
// step is judgment (the map's producers are judgment); the read/analyze/send coarse caps are atomic.
export function coarseCapabilityKind(cap: PlanCapability): CapabilityKind | null {
  if (cap === null) return null;
  if (cap === 'draft') {
    // Draft/produce → judgment: grounded in the map's producer entries (compose_email / generate_document).
    const producers = [CAPABILITY_MAP.compose_email, CAPABILITY_MAP.generate_document].filter(Boolean);
    return producers.some((c) => c.kind === 'judgment') ? 'judgment' : 'atomic';
  }
  // analyze / fetch / send → atomic (the map grades `analyze`, the read/fetch tools, and the sends atomic).
  return 'atomic';
}

// The proposal for a step that has NOT been explicitly handed to a coworker yet.
export function proposeOwner(actor: 'system' | 'you', cap: PlanCapability): ProposedOwner {
  if (actor === 'you') return 'you';
  return coarseCapabilityKind(cap) === 'judgment' ? 'coworker' : 'system';
}

/**
 * renderCapabilitySet — DERIVES the classifier's capability prompt block from the map.
 * Adding a `CAPABILITY_MAP` entry (built:true) makes it appear here automatically; no prose to edit.
 * Terse by design — the classifier reads this to decide [System] vs [You] and whether a step
 * commits (irreversible) or is prepared work (draft/fetch/analyze).
 */
export function renderCapabilitySet(): string {
  const caps = builtCapabilities();
  const lines = caps
    .map((c) => `- ${c.blurb}${c.irreversible ? '  (irreversible — a commit/send step)' : ''} → [System]`)
    .join('\n');

  return [
    `AUGMTD's REAL capabilities TODAY — grade each sub-task against THIS list, conservatively.`,
    ``,
    `WHAT WE (the SYSTEM) CAN DO — each of these is a built capability, grade the step [System]:`,
    lines,
    ``,
    `[You] = NO capability for it. Grade a step [You] (capability null) when it is:`,
    `- an external / tool action we have no capability above for (process a refund, look up a CRM/bank/invoice,`,
    `  sign a document, make a payment, place a call, update an external system);`,
    `- a decision, approval, or judgment that is the user's to make;`,
    `- anything physical, or anything in a system we don't have access to.`,
    `If NO capability above matches the step's intent → [You]. Do NOT invent a capability we don't list.`,
    ``,
    `INSTANCE HONESTY — a [System] grade is a PROMISE, it must be TRUE for THIS specific instance.`,
    `A read/fetch is only [System] when the thing to fetch is EVIDENCED in the item context (a real file,`,
    `a known recipient email). If a step depends on a specific file/attachment/document or a recipient`,
    `address you have NOT been shown exists → grade it [You] (the user attaches/confirms it), NOT a`,
    `confident [System] fetch. Instance reality beats category optimism. If UNSURE → [You].`,
  ].join('\n');
}
