// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAPABILITY MAP — the single, AGNOSTIC source of truth for what AUGMTD can actually DO today.
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

import type { FeatureKey } from '@/lib/workspace/types';

// ── PLAN_VERSION — the auto-invalidation stamp. Persisted on each `item_plans` row (the `version`
// column). BUMP THIS whenever the CAPABILITY_MAP or the classifier prompt/rules change: a cached plan
// whose stored `version !== PLAN_VERSION` is treated as STALE by `POST /api/items/plan` and silently
// regenerated + re-stamped on next open — so there's no manual cache-bust / row-delete anymore.
// (Bumped for the stage-2 classification engine + editable-plan work.)
// (Bumped to 2 for the relevance-gated generation — awareness items must NOT keep a phantom reply step,
// so stale pre-gate plans regenerate on next open.)
export const PLAN_VERSION = 2;

// 'atomic'   → deterministic, no judgment → the System runs it directly (a `tool`/`ai` workflow step).
// 'judgment' → benefits from a coworker's voice/reasoning/skills → an `agent` step.
export type CapabilityKind = 'atomic' | 'judgment';

export interface Capability {
  intent: string;               // human phrase the classifier matches a step's intent against
  tool: string;                 // registry key in lib/tools/* (or a route id for send-as-user paths)
  built: boolean;               // is the executor actually wired TODAY? false → grade [You] honestly
  kind: CapabilityKind;         // atomic → System runs it; judgment → suits a Coworker
  irreversible: boolean;        // send / post / create-invite → forces an approval gate
  feature?: FeatureKey | null;  // cross-ref to TOOL_FEATURE so a disabled feature also gates it
  blurb: string;                // one terse line rendered into the classifier prompt
}

// Keyed by the registry key (1:1 with the tools registry / TOOL_FEATURE so they can't drift).
export const CAPABILITY_MAP: Record<string, Capability> = {
  // ── Read / fetch (atomic, reversible) ──
  search_knowledge_base: {
    intent: 'search or read the knowledge base / Drive documents',
    tool: 'search_knowledge_base', built: true, kind: 'atomic', irreversible: false, feature: 'drive',
    blurb: 'search / read the knowledge base (Drive documents we have indexed)',
  },
  read_document: {
    intent: 'read a specific document or file we already have',
    tool: 'read_document', built: true, kind: 'atomic', irreversible: false, feature: 'drive',
    blurb: 'read a specific document/file we already have',
  },
  get_emails: {
    intent: 'read emails / look up an email thread in the inbox',
    tool: 'get_emails', built: true, kind: 'atomic', irreversible: false, feature: 'email',
    blurb: 'read the inbox / an email thread we have',
  },
  get_calendar: {
    intent: 'read the calendar / check availability of upcoming meetings',
    tool: 'get_calendar', built: true, kind: 'atomic', irreversible: false, feature: 'meetings',
    blurb: 'read the calendar (upcoming meetings / availability)',
  },
  get_meeting_context: {
    intent: 'read a meeting / transcript we recorded',
    tool: 'get_meeting_context', built: true, kind: 'atomic', irreversible: false, feature: 'meetings',
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
};

// Only the capabilities that are actually wired today drive the classifier prompt.
function builtCapabilities(): Capability[] {
  return Object.values(CAPABILITY_MAP).filter((c) => c.built);
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
