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
  { key: 'send_file', gate: 'send', surface: 'stage', capability: 'send_email', when: 'an EXISTING document must be sent/shared to someone WHO ASKED THE USER FOR IT (the requester is the recipient); passing a thread/document ON to a NAMED THIRD PARTY is forward, never this' },
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
export const JUDGE_VERSION = 21; // 21: THE KIND FLOOR (W8.3 — THE LIST SAYS ONLY WHAT WAS JUDGED) — the notice law's class, one kind wider, structurally before AI (lib/work/kind-floor.ts): an UNSOLICITED kind (cold_outreach, newsletter) owes nothing until the user has written into the thread, and a NOTICE kind (notification, receipt) owes nothing without a you_owe key. Found live: a cold-outreach pitch judged `schedule` and listed as real, alive work. 20: THE SEAT LAW (threads-plan · THE OPENING CONTRACT clause 4) — the judge is handed WHO WAS ADDRESSED (the CC-only seat, stamped at sync since July 8) and ruled on it: a request addressed To: a third party with the user in CC is that party's work, never the user's debt or a reply/chase/requires, unless the body names the user directly. Found live: the sender asked the To: recipient for THAT person's CV and the user, in CC, was served "You owe <sender>" plus a checklist asking for the user's own CV. 19: THE SELF-RECOGNITION FLOOR (Q1, attention-plan PART III) — mail from the user's OWN coworkers (the address registry's own role local-parts on the coworker domain) can never judge as a counterparty ask: it is a POINTER to work that already stands, judged `none` with no disposition, structurally before any AI. Found live on the reference account: the deck's top rows were our own reminder mail and ONE shortlist ask stood FOUR times. 18: THE SEND-FILE/FORWARD BOUNDARY — send_file's `when` was a strict superset of the forward case, and on the bedrock tier the judge preferred it (verdict said send_file while its own reason spoke forwarding → a reply-shaped draft addressed to NOBODY; P21 live, tier-scoped — standard-tier models drew the line unprompted). The boundary now lives in the component's own `when`: the requester is send_file's recipient; a NAMED THIRD PARTY is forward's. 17: the wait-until clamp — ALREADY-BOOKED needs the calendar block and never converts a reconnect-after item into answered (those are none+revisit; P25 caught the dilution). 16: THE BOOKED-CALENDAR FACT — the judge sees the user's real bookings with the item's sender; a schedule verdict on an already-booked meeting judges none/answered (found live: the lane floor stripped the duplicate invite but the verdict persisted). 15: THE ASK-DIRECTION FLOOR — an open engine ask is OUR ask to the USER, never the counterparty's debt (ask-journey D8, found live: the judge flipped produce→chase and the pass drafted a nudge asking the counterparty to send the deliverable WE owed HER). 14: ATTACHABLE-REQUIRES — a require is a THING (document/file/link), never a confirmation/decision/answer (the "attach a confirmation of the time" ask, found live). 13: THE EXCERPT-HONESTY LAW — clips end at boundaries + declare themselves; the prompt rules a clip marker is OUR cutting, never source truncation (a normal email read as "cut off mid-sentence" — found live). 12: THE USER'S CLOCK — local day/hour, same-day expiry with a code-verified stated time, event-boundary sig. 11: the sender floor. 10: expired requires a STATED date. 9: `revisit` + open-ask fact. 8: `forward` + failure honesty.

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
  /** Does the executor WRITE? (Sep 21, THE CONSTANT DEDUPE KEY — see lib/work/tool-dedupe.ts.)
   *  Distinct from `irreversible`: pausing a task is reversible AND a mutation. A chat loop may
   *  serve a repeated READ from its turn cache; it may never serve a repeated WRITE, because the
   *  second write is the second deed. Absent = a read (unregistered tools fail closed at the
   *  reader, not here). */
  mutates?: boolean;
  feature?: FeatureKey | null;  // cross-ref to TOOL_FEATURE so a disabled feature also gates it
  blurb: string;                // one terse line rendered into the classifier prompt
  /** Which agents/surfaces may hold this tool. Absent = the pre-P6b default (coworker + workflow). */
  exposure?: CapabilityExposure[];
  /** NOT ROUTABLE BY THE SCHEMA-LESS ROUTER (Sep 21). The chief's fast path classifies a turn
   *  against a list of `- tool: blurb` lines and invents the ARGUMENTS itself — there is no schema
   *  there. Found live: "resume the X task" came back as {status:'paused'} with no names, which
   *  would have paused every task the user owns. A capability whose arguments carry consequence
   *  says so here and is served ONLY by the agent loop, which holds the real JSON schema. The
   *  string is the reason, written down. */
  loopOnly?: string;
  /** THE PRESENTATION LAW (Sep 22 — "a tool result is DATA, never the answer"). What this tool's
   *  executor returns:
   *    'data'  → a block written FOR THE MODEL (a listing, a config dump, a compute digest, a KB
   *              context block). It may reach a `role:'tool'` message and NOTHING else — the chief's
   *              command fast path refuses to serve it, and the dispatcher returns it as
   *              `{ modelText }`, a shape `ConverseTurn` cannot absorb.
   *    'prose' → a sentence HAND-WRITTEN FOR THE PERSON in this repo's own voice (a deed
   *              confirmation, a refusal by listing, an ambiguity question). Only these may be
   *              served straight as the answer.
   *  ABSENT = 'data' — the law FAILS CLOSED, so a tool added tomorrow cannot leak by omission. The
   *  incident this answers: `list_tasks`' model-facing listing (uuids in brackets plus the line
   *  "Refer to tasks by NAME when speaking to the user") was served verbatim as the assistant's
   *  bubble and persisted into room_turns, because the old guard was an OPT-OUT set of four names.
   *  WAVE 2 (Sep 22) adds a third, for the OBJECT CARD lane:
   *    'presentation' → a CARD plus ONE framing sentence COMPOSED BY CODE from the object's own
   *              facts (lib/present/event-build.ts `eventFraming`). No model wrote it, so it may be
   *              served as the answer exactly like 'prose' — the distinction is that it arrives with
   *              a card beside it, and the registry says so rather than a branch guessing. */
  resultIs?: 'data' | 'prose' | 'presentation';
  /** THE COLLECTION SEAM (Wave 1, Sep 22 — docs/component-map.md §6). This read ALSO hands back a
   *  typed `CollectionSpec` (lib/present/collection.ts + build.ts): the user's own objects, rendered
   *  as one card instead of described in prose. Only meaningful on a `resultIs:'data'` row — the
   *  card is the DATA half; the prose half never reaches the person either way. Naming a kind here
   *  does NOT make the card the whole answer: a pure listing ask serves the card alone, an
   *  analytical one keeps the agent loop and carries the card beside its prose
   *  (lib/present/listing-ask.ts).
   *  WAVE 2 (Sep 22): `'event'` is not a collection — it is the SINGLE-OBJECT card
   *  (lib/present/event.ts's `EventSpec`), whose rows are one object and whose verbs are computed by
   *  code from that object's state. It rides the same field because the question a caller asks is
   *  the same one ("does this tool hand back something the kit can render?"); `presentsCollectionKind`
   *  below is the narrowed reader for the collection builders. */
  presents?: 'workflows' | 'documents' | 'recordings' | 'calendar' | 'event';
  /** THE DOOR-PARITY ESCAPE HATCH (Sep 21). A conversational verb a COWORKER holds but the chief
   *  deliberately does not must say WHY, in writing, here — `doorParity()` fails on a silent
   *  asymmetry. The reason is the record of the decision, not a mute exception. */
  chiefExempt?: string;
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
    resultIs: 'data', presents: 'documents',
  },
  read_document: {
    intent: 'read a specific document or file we already have',
    tool: 'read_document', built: true, kind: 'atomic', irreversible: false, feature: 'drive', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'read a specific document/file we already have',
    resultIs: 'data',
  },
  get_emails: {
    intent: 'read emails / look up an email thread in the inbox',
    tool: 'get_emails', built: true, kind: 'atomic', irreversible: false, feature: 'email', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'read the inbox / an email thread we have',
    resultIs: 'data',
  },
  get_calendar: {
    intent: 'read the calendar / check availability of upcoming meetings',
    tool: 'get_calendar', built: true, kind: 'atomic', irreversible: false, feature: 'meetings',
    blurb: 'read the calendar (upcoming meetings / availability)',
  },
  // THE READ-SIDE CALENDAR VERB (Wave 1, Sep 18): the chief could prepare an invite but could not
  // LOOK at the calendar — so it answered availability questions from a today-only context and called
  // two booked weeks free. Exposed to the chief AND the coworker lane (a coworker asked to schedule
  // needs the same verb, and the DM route registers it), and `conversational` so it never enters the
  // item-plan classifier: it has no workflow assembler path, and a step graded to it would dead-end.
  check_calendar: {
    intent: "read the user's calendar for a date range / check availability / find free slots",
    tool: 'check_calendar', built: true, kind: 'atomic', irreversible: false, feature: 'meetings',
    exposure: ['chief_of_staff', 'coworker'], conversational: true,
    blurb: "read the calendar for a date range (busy/free per day, optional free-slot proposals) — ALWAYS before any availability claim",
    resultIs: 'data', presents: 'calendar',
  },
  get_meeting_context: {
    intent: 'read a meeting / transcript we recorded',
    tool: 'get_meeting_context', built: true, kind: 'atomic', irreversible: false, feature: 'meetings', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'read a meeting / transcript we recorded',
    resultIs: 'data', presents: 'recordings',
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
    tool: 'compose_email', built: true, kind: 'judgment', irreversible: false, mutates: true, feature: null,
    blurb: 'draft an email / reply / message (drafting only — sending is a separate step)',
  },
  generate_document: {
    intent: 'generate / produce a document or deliverable',
    tool: 'generate_document', built: true, kind: 'judgment', irreversible: false, mutates: true, feature: null,
    blurb: 'generate a document / deliverable',
  },

  // ── Compute (Arc 1, docs/one-surface-plan.md — the deliverable ceiling): model-written code in
  // the locked sandbox (infra/compute — no network, declared read-only inputs, hard caps). Atomic +
  // REVERSIBLE BY CONSTRUCTION (the room can't send); the trust laws generalized — numbers computed,
  // never asserted. ──
  run_compute: {
    intent: 'compute over files/data with code — parse or reconcile spreadsheets/PDFs/CSVs, verify numbers, transform data, produce a data file',
    tool: 'run_compute', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null, exposure: ['chief_of_staff', 'coworker', 'workflow'],
    blurb: 'RUN CODE over files/data we have (parse/verify/transform spreadsheets, PDFs, CSVs; compute numbers; produce a data file) — sandboxed, cannot send anything',
    resultIs: 'data',
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
  read_kb_folder: {
    intent: 'read EVERY file in a named knowledge-base folder in full — the folder is the source of truth for this work',
    tool: 'read_kb_folder', built: true, kind: 'atomic', irreversible: false, feature: 'drive', exposure: ['workflow'],
    blurb: 'READ every file in a knowledge-base FOLDER by name (deterministic, no omissions — never semantic search)',
  },
  fetch_url: {
    intent: 'read the full current content of a specific web page every run',
    // Also a COWORKER chat verb (it always was, in the route's literal list — the row said workflow
    // only; Sep 21, door parity, the drift this arc exists to make impossible).
    tool: 'fetch_url', built: true, kind: 'atomic', irreversible: false, feature: null, exposure: ['coworker', 'workflow'],
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
  match_to_profiles: {
    intent: 'match the previous step\'s items against a folder of files and report who fits',
    tool: 'match_to_profiles', built: true, kind: 'judgment', irreversible: false, feature: 'drive', exposure: ['workflow'],
    blurb: 'MATCH TO FILES — the previous step\'s items against a knowledge-base folder holding one file per candidate (evidence-checked rationale, each item reported once)',
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
    tool: 'slack_send', built: true, kind: 'atomic', irreversible: true, mutates: true, feature: null, exposure: ['workflow'],
    blurb: 'SEND a Slack message from the pipeline (real post — the approval-gated send step)',
  },

  // ── THE DISPATCHER + THE SENSIBLE ASK (Aug 8 — production asks reach the team without the
  // user routing; decisions reach the user ONLY when consequential and non-inferable). Both
  // conversation-core: delegation is REVERSIBLE (work lands as a room report-back, nothing
  // external fires) so a clear fit ACTS with visible attribution; offer_choices is the loop's
  // ONE ask channel — actionable options, never a wall of questions. ──
  assign_to_coworker: {
    intent: "hand a production task (report, draft, research, analysis, post) to the best-fit coworker when the user didn't name one",
    tool: 'assign_to_coworker', built: true, kind: 'judgment', irreversible: false, mutates: true, feature: null, exposure: ['chief_of_staff'], conversational: true,
    blurb: 'ASSIGN produced work to the best-fit coworker and start it now (reversible — it reports back here)',
    resultIs: 'prose',
  },
  offer_choices: {
    intent: 'put one genuinely consequential, non-inferable decision to the user as tappable options',
    tool: 'offer_choices', built: true, kind: 'judgment', irreversible: false, feature: null, exposure: ['chief_of_staff'], conversational: true,
    blurb: 'ASK the user ONE consequential decision as tappable options (sparingly — never to confirm reversible acts)',
    resultIs: 'prose',
  },

  // ── Commit (irreversible → approval gate) ──
  send_email: {
    intent: 'send an email as the user (connected mailbox)',
    tool: 'send_email', built: true, kind: 'atomic', irreversible: true, mutates: true, feature: 'email',
    blurb: 'SEND an email as the user (connected mailbox)',
  },
  slack_post_message: {
    intent: 'post a message to a Slack channel',
    tool: 'slack_post_message', built: true, kind: 'atomic', irreversible: true, mutates: true, feature: null,
    blurb: 'POST a message to Slack',
  },
  send_calendar_invite: {
    intent: 'put a meeting on the calendar / send a calendar invite to attendees',
    tool: 'send_calendar_invite', built: true, kind: 'atomic', irreversible: true, mutates: true, feature: 'meetings',
    blurb: 'SEND a calendar invite / put a meeting on the calendar (real Google/Outlook event, notifies attendees)',
  },
  // ── S5 proof-of-agnosticism: one map row + a registered executor + a prepared-action surface makes
  // "forward the deck to finance" flip from [You] to [System]. proposeOwner / the classifier / the
  // assembler needed NO structural edits — they read this map. Real send → irreversible → approval gate.
  forward_email: {
    intent: 'forward an email we already have to a new recipient (e.g. forward the deck to finance)',
    tool: 'forward_email', built: true, kind: 'atomic', irreversible: true, mutates: true, feature: 'email',
    blurb: 'FORWARD an existing email to another recipient (real send as the user)',
  },

  // ── P6b — the personal-surface doables (chief-of-staff exposure ONLY; a coworker never resolves
  // the user's inbox or writes their deal memory). Executors in lib/tools/item-actions.ts — the SAME
  // implementations the API routes call. Reversible ones execute directly (undoable via /api/restore);
  // the irreversible flag on sends stays the structural approve gate.
  resolve_inbox_item: {
    intent: 'mark the current email/notice done or dismiss it from the Home',
    tool: 'resolve_inbox_item', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'email',
    blurb: 'mark the current item done / dismiss it (reversible)', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  resolve_commitment: {
    intent: 'mark the current commitment or follow-up done or dismissed',
    tool: 'resolve_commitment', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null,
    blurb: 'mark the current commitment done / dismissed (reversible)', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  find_file: {
    intent: 'find a document/file across the knowledge base, past attachments and connected drives',
    tool: 'find_file', built: true, kind: 'atomic', irreversible: false, feature: 'drive',
    blurb: 'find a file (KB, attachments, connected drives — read-only)', exposure: ['chief_of_staff', 'coworker', 'workflow'],
    resultIs: 'prose',
  },
  remember_fact: {
    intent: "save a durable fact/constraint onto this deal's memory",
    tool: 'remember_fact', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null,
    blurb: "remember a durable fact on the deal (future drafts respect it)", exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  propose_standing_task: {
    intent: 'the user asks for a RECURRING deliverable (weekly report, daily digest) — propose the standing task for confirmation',
    tool: 'propose_standing_task', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: 'propose a STANDING task ("weekly report on X") — places the confirm card; creates nothing by itself', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  steer_standing_task: {
    intent: 'feedback on a standing/recurring task ("less macro, more tenders") — bake it into the method so future runs inherit it',
    tool: 'steer_standing_task', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: 'apply feedback to a STANDING task\'s method (next runs inherit it) — only in the standing task\'s room', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  read_action_history: {
    intent: 'read the ledger of actions taken — what was sent, committed, done, delegated recently',
    tool: 'read_action_history', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'read the action ledger ("what was sent this week?", "what did we do on X?") — read-only', exposure: ['chief_of_staff'],
    resultIs: 'data',
  },
  // ── MEMBERSHIP / PROJECT management (projecthood-plan P4) — the "manage my projects" verbs, in the
  // registry so every chat surface gets them at once. All reversible-or-logged; none send anything.
  move_item_to_project: {
    intent: 'move this item into a different project, or take it out of its project',
    tool: 'move_item_to_project', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null,
    blurb: "move the open item to another project / out of its project ('this isn't part of X')", exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  set_project_status: {
    intent: "change a project's lifecycle: done, archived, reopened, or not-a-project",
    tool: 'set_project_status', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null,
    blurb: "mark a project done / archive / reopen / 'not a project'", exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  merge_projects: {
    intent: 'merge two projects that are really one body of work',
    tool: 'merge_projects', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null,
    blurb: 'merge two projects into one (everything moves to the kept one)', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  create_project: {
    intent: 'start a new project to track, optionally founded from the item being viewed',
    tool: 'create_project', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null,
    blurb: 'start a new project ("start a project called X from this")', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  create_task_item: {
    intent: "add a task to the user's plate, optionally on a project",
    tool: 'create_task_item', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: null,
    blurb: 'add a task ("add a task on Acme: chase the signed NDA, due Friday")', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  // ── THE PARITY LAW (Aug 4): every verb the UI offers must be SAYABLE. "Send it" typed in the
  // room IS the user's explicit approval — it fires the SAME send door (exactly-once, logged),
  // behind a deterministic explicit-send floor. "Forward to X" prepares + points at the stage;
  // the approve click stays the commit.
  send_prepared_reply: {
    intent: 'send the ALREADY-DRAFTED reply on the current item — only when the user explicitly says to send',
    tool: 'send_prepared_reply', built: true, kind: 'atomic', irreversible: true, mutates: true, feature: 'email',
    blurb: 'send the prepared reply ("send it") — fires only on the user\'s own explicit send word', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },
  // EVERY THREAD, EVERY PRODUCER (threads plan, Sep 8): the invite card's producer, sayable. It
  // PREPARES the same card the proactive pass prepares and returns it on the turn — the Send stays
  // the user's click, through the commit door. Reversible by construction (nothing leaves), which
  // is exactly why the sending capability (`send_calendar_invite`, irreversible) stays out of chat.
  prepare_calendar_invite: {
    intent: 'prepare a calendar invite from what the conversation says (never sends by itself)',
    tool: 'prepare_calendar_invite', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'meetings',
    blurb: 'prepare a calendar invite CARD ("set up a meeting with Sam Thursday 11h") — the user reviews, picks the time and sends',
    // The coworker DM route registers the SAME definition + executor (see the import note in
    // app/api/work/threads/[id]/chat/route.ts); the exposure row now says so (Sep 21, door parity).
    exposure: ['chief_of_staff', 'coworker'], conversational: true,
    resultIs: 'prose',
  },
  // THE EVENT CARD (Wave 2, Sep 22 — docs/component-map.md §4: "RSVP, update and cancel are
  // UI-button-only: no registry row, no chat tool, no activity log, no commit-door claim"). This is
  // the row that ends that. It PREPARES one existing meeting as a card wearing the verbs its own
  // state allows; the deed fires from the card, through /api/events/[id]/deed, which re-derives the
  // permission and claims the commit door. Reversible by construction here — nothing leaves — which
  // is exactly why no committing calendar verb is exposed to chat at all.
  // `conversational: true` keeps it out of `builtCapabilities()` (the item-plan classifier prompt),
  // so no PLAN_VERSION bump is owed — the precedent stated on prepare_calendar_invite above.
  prepare_event_action: {
    intent: 'show one existing calendar event as a card with the actions its state allows — accept/maybe/decline, reschedule, cancel (never acts by itself)',
    tool: 'prepare_event_action', built: true, kind: 'atomic', irreversible: false, mutates: false, feature: 'meetings',
    blurb: 'show ONE meeting already on the calendar as a card ("decline the 3pm", "move my call with Sam to Thursday 10:00", "what\'s my 3pm?") — the card carries the verbs; the user\'s click is the deed',
    exposure: ['chief_of_staff', 'coworker'], conversational: true,
    resultIs: 'presentation', presents: 'event',
  },
  // THE BULK DEED (attention-plan A7's parity clause): the ledger's natural verbs, sayable. It
  // PREPARES the same stored deed row the ledger's own buttons prepare and returns it on the turn —
  // the commit stays the user's click, through the one commit door. Reversible by construction
  // (nothing acts), which is exactly why no committing capability is exposed to chat at all.
  // NOTE: `conversational: true` keeps it out of `builtCapabilities()` (the item-plan classifier
  // prompt), so no PLAN_VERSION bump is owed — the same reasoning the invite entry stands on.
  prepare_bulk_deed: {
    intent: 'preview a bulk deed over a group the agent is holding quiet (never acts by itself)',
    tool: 'prepare_bulk_deed', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'email',
    blurb: 'preview a bulk deed ("archive all the notices", "unsubscribe from the newsletters") — the card states what would happen and the user commits it',
    exposure: ['chief_of_staff'], conversational: true,
    resultIs: 'prose',
  },
  // HANDS FOR THE SCOPE (Sep 21 — the pilot's dead-ended "yes please"): the chat could OFFER to
  // write to someone and held nothing that writes. `draft_reply` prepares the reply and hands it
  // back; the send door is unchanged (send_prepared_reply, explicit-send floor). Reversible by
  // construction — nothing leaves. `conversational: true` keeps it out of builtCapabilities(), so
  // no PLAN_VERSION bump is owed (the same reasoning the invite/bulk-deed rows stand on).
  draft_reply: {
    intent: 'draft the reply the conversation has been about, for the user to review (never sends by itself)',
    tool: 'draft_reply', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'email',
    blurb: 'draft a reply ("reply to them offering both slots") — it prepares the draft; sending stays the user\'s explicit word',
    exposure: ['chief_of_staff'], conversational: true,
    resultIs: 'prose',
  },
  prepare_forward: {
    intent: 'prepare forwarding the current email to someone for review & approval (never sends by itself)',
    tool: 'prepare_forward', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'email',
    blurb: 'prepare a forward ("forward this to Rita") — review & approve on the card before anything sends', exposure: ['chief_of_staff'],
    resultIs: 'prose',
  },

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE CONVERSATIONAL DOORS JOIN THE REGISTRY (Sep 21 — CLASS 2: "a verb has every conversational
  // door"). Live incident: the Home chat answered "I don't have a tool to pause workflows" while a
  // coworker DM had paused them for months. Cause: NOT ONE task verb was a row here. The coworker
  // door built its list with a literal push; the chief door derives from this map — so the map, the
  // thing every parity gate reads, never knew these verbs existed, and the gates could not see the
  // hole they were built to see.
  //
  // Every row below is `conversational: true`: they are chat verbs, never item-plan steps, so
  // `builtCapabilities()` excludes them and NO PLAN_VERSION bump is owed (the precedent stated on
  // prepare_calendar_invite / prepare_bulk_deed / draft_reply above).
  //
  // A verb a coworker holds and the chief does NOT must carry a written `chiefExempt` — doorParity()
  // fails on a silent asymmetry.
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  // ── Tasks: the chief's slice — see what is automated, read one, change its status, run it now.
  // All four resolve BY NAME on the chief side (a raw id is useless in conversation).
  list_tasks: {
    intent: 'list the automated tasks that exist and whether they are running',
    tool: 'list_tasks', built: true, kind: 'atomic', irreversible: false, feature: 'studio',
    blurb: "list the automated tasks ('what's running?')",
    exposure: ['chief_of_staff', 'coworker'], conversational: true,
    resultIs: 'data', presents: 'workflows',
  },
  get_task: {
    intent: 'read one task\'s full configuration (schedule, steps, output, doors)',
    tool: 'get_task', built: true, kind: 'atomic', irreversible: false, feature: 'studio',
    blurb: "read one task's configuration ('what does the weekly briefing actually do?')",
    exposure: ['chief_of_staff', 'coworker'], conversational: true,
    resultIs: 'data',
  },
  // THE BULK DEED OVER TASKS (Sep 21 — the incident's own verb). "Pause all workflows" used to force
  // an N-call model loop with NOTHING reconciling N intents to N results; one round got eaten by the
  // dedupe and the reply claimed both. This verb loops SERVER-side and returns a per-item ledger, so
  // the count in the sentence is a count the code observed. Reversible by construction (its own
  // mirror resumes) — which is why it may act on the user's explicit words, and why DESTRUCTIVE bulk
  // (delete) is deliberately NOT here: delete stays single-item.
  set_tasks_status: {
    intent: 'pause or resume tasks in one deed — all of them, or the ones the user names',
    tool: 'set_tasks_status', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: "pause or resume tasks in one go ('pause all my workflows', 'resume the weekly briefing')",
    exposure: ['chief_of_staff', 'coworker'], conversational: true,
    loopOnly: 'its arguments (which direction, and whether "all" was meant) carry the whole deed — ' +
      'they need the tool schema, not a blurb. The executor keeps its own user-words floors as well.',
    resultIs: 'prose',
  },
  run_task: {
    intent: 'run an existing task right now',
    tool: 'run_task', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: "run an existing task now ('run the weekly briefing')",
    exposure: ['chief_of_staff', 'coworker'], conversational: true,
    resultIs: 'prose',
  },

  // ── Tasks: the coworker-only slice. Each says WHY the chief does not hold it.
  create_task: {
    intent: 'build a new automated task from a plain description',
    tool: 'create_task', built: true, kind: 'judgment', irreversible: false, mutates: true, feature: 'studio',
    blurb: 'build a new automated task from a description',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'the chief creates standing work through propose_standing_task — the ONE confirm card ' +
      '(SAYING PREPARES, COMMITTING STAYS EXPLICIT). A second creation path from the Home would bypass it.',
  },
  update_task: {
    intent: 'edit an existing task — schedule, output, instructions, steps, status',
    tool: 'update_task', built: true, kind: 'judgment', irreversible: false, mutates: true, feature: 'studio',
    blurb: 'edit an existing task (schedule, output, instructions, a step)',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'editing a pipeline needs its steps in view; the chief steers standing work through ' +
      'steer_standing_task (the method) and changes status through set_tasks_status. The full editor ' +
      'belongs to the coworker who owns the task, and to Studio.',
  },
  duplicate_task: {
    intent: 'copy an existing task as the basis for a variant',
    tool: 'duplicate_task', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: 'copy a task as the basis for a variant',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'a duplicate is only useful alongside the edit that makes it different — it rides with update_task.',
  },
  delete_task: {
    intent: 'delete a task permanently',
    tool: 'delete_task', built: true, kind: 'atomic', irreversible: true, mutates: true, feature: 'studio',
    blurb: 'delete a task permanently',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'DESTRUCTIVE and irreversible: it stays single-item, in the room that holds the task, ' +
      'never a Home-chat verb and never part of a bulk deed.',
  },
  share_task: {
    intent: 'share a task with the team, or stop sharing it',
    tool: 'share_task', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: 'share a task with the team / stop sharing it',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'a team-library verb that belongs with the coworker who owns the task; the Home never lists the library.',
  },
  list_team_tasks: {
    intent: 'see the tasks teammates have shared',
    tool: 'list_team_tasks', built: true, kind: 'atomic', irreversible: false, feature: 'studio',
    blurb: 'see tasks teammates have shared',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'the team library is browsed where a task is adopted — beside use_task, on the coworker.',
  },
  use_task: {
    intent: "copy a teammate's shared task into your own list",
    tool: 'use_task', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: "copy a teammate's shared task into your own list",
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'adoption lands the task ON a coworker, so it is asked of that coworker.',
  },
  supply_run_input: {
    intent: 'hand a parked run the material it stopped to ask for',
    tool: 'supply_run_input', built: true, kind: 'atomic', irreversible: false, mutates: true, feature: 'studio',
    blurb: 'hand a parked run the paste or document it is waiting for',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'an input station raises its own deck ask with a deep link to the run; the supply is ' +
      'answered there or in the run\'s own room, never blind from the Home.',
  },

  // ── The coworker's own reading room: its documents, its skills, its teammates' work. Chief-exempt
  // as a class — the Home reads the SAME material through search_knowledge_base / find_file.
  list_worker_documents: {
    intent: "list the documents this coworker has produced",
    tool: 'list_worker_documents', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: "list the documents this coworker has produced", exposure: ['coworker'], conversational: true,
    chiefExempt: 'scoped to ONE coworker\'s own output; the Home reads across everything through find_file / search_knowledge_base.',
  },
  get_worker_document: {
    intent: "read one document this coworker produced",
    tool: 'get_worker_document', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: "read one document this coworker produced", exposure: ['coworker'], conversational: true,
    chiefExempt: 'same scope as list_worker_documents — the Home reads documents through read_document.',
  },
  read_team_work: {
    intent: "read one of a teammate coworker's recent outputs",
    tool: 'read_team_work', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: "read a teammate coworker's output in full", exposure: ['coworker'], conversational: true,
    chiefExempt: 'cross-coworker pickup is how COWORKERS build on each other; the Home asks the owner.',
  },
  list_skills: {
    intent: 'list the reusable skills in the library',
    tool: 'list_skills', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'list the skills library', exposure: ['coworker'], conversational: true,
    chiefExempt: 'a skill is HOW a coworker works — the library is consulted by the coworker applying it.',
  },
  apply_skill: {
    intent: 'pull one skill from the library and follow it for this response',
    tool: 'apply_skill', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'apply one named skill from the library', exposure: ['coworker'], conversational: true,
    chiefExempt: 'the chief does not produce in a coworker\'s voice; it hands the work over (assign_to_coworker).',
  },

  // ── The coworker chat's remaining reads/renders.
  get_email_body: {
    intent: 'read the full body of one email already identified in the inbox',
    tool: 'get_email_body', built: true, kind: 'atomic', irreversible: false, feature: 'email',
    blurb: 'read one email in full (after get_emails found it)',
    exposure: ['coworker'], conversational: true,
    chiefExempt: 'the chief already receives the message it is answering about IN its grounding (the ' +
      'viewing anchor / the one room grounding) — a second reading verb would be a second source of truth.',
  },
  slack_list_channels: {
    intent: 'list the Slack channels this coworker can reach',
    tool: 'slack_list_channels', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'list reachable Slack channels', exposure: ['coworker'], conversational: true,
    chiefExempt: 'Slack is per-coworker (one app per coworker, its own identity) — the chief holds no Slack app.',
  },
  slack_list_members: {
    intent: 'list the members of a Slack workspace/channel',
    tool: 'slack_list_members', built: true, kind: 'atomic', irreversible: false, feature: null,
    blurb: 'list Slack members (to resolve a mention)', exposure: ['coworker'], conversational: true,
    chiefExempt: 'same as slack_list_channels — the connection belongs to the coworker.',
  },
  request_clarification: {
    intent: 'put a confirmation card up before producing a file',
    tool: 'request_clarification', built: true, kind: 'judgment', irreversible: false, feature: null,
    blurb: 'confirm what to produce before generating a file', exposure: ['coworker'], conversational: true,
    chiefExempt: 'the chief\'s decision door is offer_choices — one asking grammar per surface, not two.',
  },
  present_linkedin_post: {
    intent: 'present a finished post as a reviewable card (display only)',
    tool: 'present_linkedin_post', built: true, kind: 'judgment', irreversible: false, feature: null,
    blurb: 'present a finished post as a reviewable card (never publishes)', exposure: ['coworker'], conversational: true,
    chiefExempt: 'a render card for the coworker who wrote the post; the Home hands post work over instead.',
  },
};

/** The capability slice a given surface/agent may hold — THE exposure filter (P6b). Absent exposure =
 *  the pre-P6b default (coworker + workflow), so existing tools' behavior is unchanged. */
export function capabilitiesFor(surface: CapabilityExposure): Capability[] {
  return Object.values(CAPABILITY_MAP).filter((c) =>
    c.built && (c.exposure ? c.exposure.includes(surface) : surface !== 'chief_of_staff'));
}

/** The tool ids a door may hold, in registry order — what `buildChatTools` and the chief loop READ
 *  instead of keeping a literal list of their own (Sep 21, CLASS 2). */
export function doorToolIds(surface: CapabilityExposure): string[] {
  return capabilitiesFor(surface).map((c) => c.tool);
}

/**
 * THE DERIVED DOOR-PARITY LAW (Sep 21) — the sibling of `registryParity()`, for the CONVERSATIONAL
 * doors. Asserted by the promise gate (P21b) with the doors' real definition sets.
 *
 *   1. Every tool a door actually offers has a registry row (the hole that hid the task verbs).
 *   2. A row whose exposure names a door is actually offered there (a row that lies the other way).
 *   3. A TASK-CLASS verb a coworker holds and the chief does not must carry a written `chiefExempt`.
 *
 * ⚠️ WHAT THIS LAW DOES NOT YET COVER (Sep 21, written down rather than implied):
 *   • Rule 1 is FREE BY CONSTRUCTION on the coworker arm — `buildChatTools` iterates this very
 *     registry, so that door cannot offer a tool without a row. The rule earns its keep on the
 *     chief arm and on any future door that keeps a list of its own.
 *   • THERE IS NO AGENTOS ARM. The Python worker mirror (infra/agentos/tools_*.py) is a THIRD door
 *     and nothing here compares it to the registry, so a drift there is invisible to this function.
 *     Known gaps found by review, stated as a gap rather than silently carried: `read_document`,
 *     `get_email_body` and `request_clarification` have coworker exposure here and no Python tool —
 *     a coworker on the box simply cannot reach them. Closing it means a real third arm (the door
 *     set read from the Python source) plus a box redeploy; not built in this pass.
 *
 * Returns the violations (empty = lawful).
 */
export function doorParity(doors: { chief: readonly string[]; coworker: readonly string[] }): string[] {
  const out: string[] = [];
  const sets: Array<[CapabilityExposure, ReadonlySet<string>]> = [
    ['chief_of_staff', new Set(doors.chief)],
    ['coworker', new Set(doors.coworker)],
  ];
  for (const [surface, offered] of sets) {
    for (const name of offered) {
      const cap = CAPABILITY_MAP[name];
      if (!cap) { out.push(`the ${surface} door offers "${name}", which has no registry row`); continue; }
      const exp = cap.exposure ?? ['coworker', 'workflow'];
      if (!exp.includes(surface)) out.push(`the ${surface} door offers "${name}", whose row does not expose it there`);
    }
    for (const cap of capabilitiesFor(surface)) {
      // Only CONVERSATIONAL rows claim a chat door; a plan/workflow capability (analyze, send_email,
      // the pipeline sources) is legitimately absent from a chat tool list.
      if (!cap.conversational) continue;
      if (!offered.has(cap.tool)) out.push(`"${cap.tool}" claims ${surface} exposure but that door does not offer it`);
    }
  }
  // 3 — the asymmetry must be WRITTEN. Scoped to the task class: the verbs this law was found on.
  const chief = new Set(doors.chief);
  for (const cap of capabilitiesFor('coworker')) {
    if (!cap.conversational || !TASK_CLASS_TOOLS.has(cap.tool)) continue;
    if (chief.has(cap.tool)) continue;
    if (!cap.chiefExempt?.trim()) out.push(`task verb "${cap.tool}" has a coworker door and no chief door, with no written chiefExempt reason`);
  }
  return out;
}

// ── THE PRESENTATION LAW (Sep 22, WAVE 0 — "a tool result is DATA, never the answer") ──────────
// The guard that let the incident through was an OPT-OUT Set of four tool names living in the
// conversation core; every read tool added after it leaked by default. The registry is the agnostic
// home, and the default is the SAFE one: a row that says nothing returns data.

/** Is this tool's result a sentence written for the PERSON? Absent row / absent field = no —
 *  the law fails closed, so a tool nobody classified can never be served as an answer. */
export const resultIsProse = (tool: string): boolean => CAPABILITY_MAP[tool]?.resultIs === 'prose';

/** WAVE 2 (Sep 22): does this tool return an OBJECT CARD plus a code-written framing sentence?
 *  Like `prose` it may be served as the answer (no model wrote the sentence); unlike prose it also
 *  carries a card. Absent row / absent field = no — the same fail-closed default. */
export const resultIsPresentation = (tool: string): boolean => CAPABILITY_MAP[tool]?.resultIs === 'presentation';

/** Every chief-slice tool must SAY which it returns — silence is how the class comes back. */
export function presentationParity(): string[] {
  return capabilitiesFor('chief_of_staff')
    .filter((c) => c.resultIs !== 'data' && c.resultIs !== 'prose' && c.resultIs !== 'presentation')
    .map((c) => `chief-slice tool "${c.tool}" declares no resultIs (data | prose | presentation)`);
}

/** THE COLLECTION SEAM (Wave 1, Sep 22): which collection this tool can ALSO hand back as a card —
 *  null for every tool that has none. Read by the conversation core's fast path and by nothing else. */
export const presentsKind = (tool: string): Capability['presents'] | null =>
  CAPABILITY_MAP[tool]?.presents ?? null;

/** The COLLECTION kinds only (Wave 2, Sep 22) — the narrowed reader the collection builders take,
 *  so adding the single-object `event` kind above cannot widen `buildCollection`'s input by type. */
export const presentsCollectionKind = (
  tool: string,
): 'workflows' | 'documents' | 'recordings' | 'calendar' | null => {
  const k = CAPABILITY_MAP[tool]?.presents;
  return !k || k === 'event' ? null : k;
};

/** A presenting tool must be a read whose kind the contract actually knows, and its result kind must
 *  match what it presents: a COLLECTION is the data half of a read (`resultIs:'data'`), an OBJECT
 *  CARD is a presentation (`resultIs:'presentation'` — a card plus a code-written sentence). A kind
 *  the builders cannot build is a promise the product can't keep. The known-kind half is asserted in
 *  the gate (which holds the contract's own lists). */
export function presentsParity(): string[] {
  const out: string[] = [];
  for (const c of Object.values(CAPABILITY_MAP)) {
    if (!c.presents) continue;
    if (c.presents === 'event') {
      if (c.resultIs !== 'presentation') out.push(`tool "${c.tool}" presents an object card but declares resultIs="${c.resultIs ?? 'absent'}" (an object card is a PRESENTATION)`);
      continue;
    }
    if (c.resultIs !== 'data') out.push(`tool "${c.tool}" presents a collection but declares resultIs="${c.resultIs ?? 'absent'}" (a card is the DATA half of a read)`);
  }
  return out;
}

/** The task-management verb family — the class the door-parity law was found on. */
export const TASK_CLASS_TOOLS: ReadonlySet<string> = new Set([
  'list_tasks', 'get_task', 'create_task', 'update_task', 'run_task', 'duplicate_task', 'delete_task',
  'share_task', 'list_team_tasks', 'use_task', 'supply_run_input', 'set_tasks_status',
]);

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
