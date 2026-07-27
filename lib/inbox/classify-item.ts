// Single source of truth: every inbox item → one legible TYPE, organised by whose next move it
// is. The inbox and the Home both read this, so they can never drift. Each type carries its verb
// (the action) — "follow up" is the VERB on "waiting on", never a type, so it can't be confused
// with something you owe.

import { isNeedsReply, isCcOnlyBystander, type SignalItem } from './needs-reply';
import { isNoMoveNotice, rawMailKindOf } from './notice-demotion';
import { getUnderstanding } from './item-understanding';
import { DEFAULT_RULES } from './rules/defaults';
import { evaluateDeterministic } from './rules/evaluate';
import { LABEL_TO_TYPE, type RuleEmail, type InboxRule } from './rules/types';

export type ItemType = 'needs_reply' | 'to_do' | 'waiting_on' | 'reminder' | 'fyi' | 'hidden';
// Where a work item came from. The digest GROUPS by this; the inbox shows it as a cue. A meeting
// is a source, not a type — its outputs (action items) are typed to_do/waiting_on.
export type WorkSource = 'email' | 'meeting' | 'calendar';

// The user's rules, loaded once per session by the inbox page. Until then we fall back to the
// code defaults — so a user's *edited* deterministic rules drive classification, not just the
// seeds. (Deterministic only here; AI-match rules are evaluated at process time.)
let cachedRules: InboxRule[] | null = null;
export function setInboxRules(rules: InboxRule[] | null) { cachedRules = rules && rules.length ? rules : null; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = SignalItem & { status?: string | null; work_state?: string | null; source?: string | null; type_override?: string | null; rule_type?: string | null };

const OVERRIDABLE = new Set<ItemType>(['needs_reply', 'to_do', 'waiting_on', 'fyi']);

// Build the minimal email shape the rules engine evaluates against, from an inbox item.
function itemToRuleEmail(item: Item): RuleEmail | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (item.source_data ?? {}) as any;
  const from = String(sd.from || sd.from_address || '');
  if (!from) return null;
  return {
    direction: 'received', // inbox items are received mail (sent mail isn't an inbox item)
    from: from.toLowerCase(),
    to: (sd.to_addresses ?? []).map(String),
    cc: (sd.cc_addresses ?? []).map(String),
    subject: String(sd.subject ?? ''),
    body: String(sd.body ?? ''),
    labels: (sd.labels ?? sd.gmail_labels ?? []).map(String),
  };
}

// THE ONE demotion question, shared with every other surface (the brief's pools, the spine):
// is this a notice nobody owes a move on? Reasoned ownership first, raw kind tier, structural floor.
function noMoveConfirmed(item: Item): boolean {
  try {
    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    return isNoMoveNotice({
      u: getUnderstanding(item),
      rawKind: rawMailKindOf(sd),
      fromEmail: (sd.from_address as string) ?? (sd.from as string) ?? null,
      fromName: (sd.from_name as string) ?? null,
      subject: (sd.subject as string) ?? null,
      workState: item.work_state ?? null,
    });
  } catch { return true; } // law unavailable → keep the conservative demotion
}

export function classifyItem(item: Item, rules?: InboxRule[] | null): ItemType {
  // Resolved items never show.
  if (item.status === 'completed' || item.status === 'dismissed' || item.status === 'rejected') return 'hidden';

  // The user's correction wins over the AI's call.
  if (item.type_override && OVERRIDABLE.has(item.type_override as ItemType)) return item.type_override as ItemType;

  const ws = item.work_state;

  // A meeting action item is a to-do you own. The meeting is the SOURCE (sourceOf), not the type —
  // the digest groups it under its meeting; the inbox shows it under To do with a "from {meeting}" cue.
  if (item.source === 'meeting') return 'to_do';

  // Deterministic rules (the editable noise tier — no-reply/automated/marketing senders) run
  // first, so this junk never leaks into "Needs reply" or "To do". Rule-driven, not hardcoded.
  // THE NOTICE-LAW REFINEMENT (the Workspace-security-alert miss): a noise-tier match may demote
  // to awareness ONLY when nobody owes a move — the SAME ownership-keyed law every other surface
  // applies (isNoMoveNotice: a reasoned `you_owe` protects; action-worthy automated protects).
  // A no-reply sender whose mail the brain says YOU OWE action on falls THROUGH to the chain
  // below (→ to_do), instead of being silently filed as FYI by its sender shape. Rules stay
  // authoritative for their real verdicts (needs_reply/to_do/waiting_on are returned untouched);
  // only the junk-tier demotion gets the refinement — the precedence-chain law, never an AND.
  const ruleEmail = itemToRuleEmail(item);
  if (ruleEmail) {
    const matched = evaluateDeterministic(ruleEmail, rules ?? cachedRules ?? DEFAULT_RULES);
    if (matched?.outcome.set_type) {
      const t = LABEL_TO_TYPE[matched.outcome.set_type];
      if (t !== 'fyi') return t;
      if (noMoveConfirmed(item)) return 'fyi';
      // Somebody owes a move — the noise-tier demotion doesn't apply; continue down the chain.
    }
  }

  // A custom AI-match rule's verdict (computed at process time) — after deterministic, before heuristics.
  if (item.rule_type && item.rule_type in LABEL_TO_TYPE) {
    const t = LABEL_TO_TYPE[item.rule_type as keyof typeof LABEL_TO_TYPE];
    // A rule can match "needs reply" on a thread you're only CC'd on (the rule-match doesn't see
    // to/cc). Trust it only if you're personally in the loop; otherwise it's awareness.
    if (t === 'needs_reply' && isCcOnlyBystander(item)) return 'fyi';
    return t;
  }

  // Your move — the ball is in your court.
  if (isNeedsReply(item)) return 'needs_reply';

  // PRIMARY signal: the unified understanding. If it reasoned that the user is a bystander / one of
  // many / this is awareness-only, the item is FOR AWARENESS — visible as FYI, never promoted to a
  // to-do just because work_state is action/work_prepared (the group "Dear Team" case). This is the
  // reasoned relevance winning over the brittle work_state→to_do mapping. Legacy items (no
  // understanding) skip this and keep today's work_state-driven behavior.
  const u = getUnderstanding(item);
  if (u && (u.role === 'bystander' || u.role === 'one_of_many' || u.relevance === 'awareness')) {
    return ws === 'noise' ? 'hidden' : 'fyi';
  }

  // Their move — you're owed; the verb here is "follow up" (nudge).
  if (ws === 'waiting') return 'waiting_on';

  // Your move — a task or something you owe (non-reply action).
  if (ws === 'action_required' || ws === 'work_prepared' || ws === 'decision_required') return 'to_do';

  // Noise stays hidden; everything else is awareness.
  if (ws === 'noise') return 'hidden';
  return 'fyi';
}

// A reply draft is only ever warranted when the item GENUINELY owes a reply. Gate on the item's own
// classification — never on sender/subject keywords:
//   • `work_state === 'noted'` is the per-item FYI verdict (newsletter / notification / awareness).
//     An FYI item must NEVER get a reply draft, even if a rule happened to tag it needs_reply — a
//     newsletter you cannot meaningfully reply to shouldn't have a canned reply prepared for it.
//   • otherwise, defer to the shared `classifyItem` resolver: only `needs_reply` items are drafted.
// Used by BOTH the auto-draft sweep and every on-demand draft entry point so they can't drift.
export function shouldDraftReply(item: Item): boolean {
  if (item.work_state === 'noted') return false;   // FYI — respect the per-item classification
  return classifyItem(item) === 'needs_reply';
}

export type TypeConfig = {
  label: string;
  verb: string;
  description: string;
  dot: string;
  countBg: string;
  countText: string;
  /** Order in the list — your-move types first. */
  order: number;
};

// "your move" (needs_reply, to_do) first, then "their move" (waiting_on), then context.
export const TYPE_CONFIG: Record<Exclude<ItemType, 'hidden'>, TypeConfig> = {
  needs_reply: {
    label: 'Needs reply', verb: 'Reply',
    description: 'A real person is waiting on your response',
    dot: 'bg-rose-500', countBg: 'bg-rose-100', countText: 'text-rose-700', order: 0,
  },
  to_do: {
    label: 'To do', verb: 'Do',
    description: 'On your side — a task or something you owe',
    dot: 'bg-indigo-500', countBg: 'bg-indigo-100', countText: 'text-indigo-700', order: 1,
  },
  waiting_on: {
    label: 'Waiting on', verb: 'Follow up',
    description: "Someone owes you — nudge if it's gone quiet",
    dot: 'bg-amber-500', countBg: 'bg-amber-100', countText: 'text-amber-700', order: 2,
  },
  reminder: {
    label: 'Reminders', verb: 'Review',
    description: 'Worth recalling before your next touchpoint',
    dot: 'bg-violet-500', countBg: 'bg-violet-100', countText: 'text-violet-700', order: 3,
  },
  fyi: {
    label: 'For awareness', verb: 'Dismiss',
    description: 'For your information only',
    dot: 'bg-neutral-400', countBg: 'bg-neutral-100', countText: 'text-neutral-600', order: 4,
  },
};

export const TYPE_ORDER: Array<Exclude<ItemType, 'hidden'>> = ['needs_reply', 'to_do', 'waiting_on', 'reminder', 'fyi'];

// Source metadata + resolver — the digest groups by source; the inbox shows it as a cue.
export const SOURCE_META: Record<WorkSource, { label: string }> = {
  email: { label: 'Email' },
  meeting: { label: 'Meeting' },
  calendar: { label: 'Calendar' },
};
export function sourceOf(item: Item): WorkSource {
  return item.source === 'meeting' ? 'meeting' : 'email';
}

// Types a user can manually re-type an item to (reminder is system-derived from meetings, not a
// manual target).
export const RETYPE_OPTIONS: Array<Exclude<ItemType, 'hidden' | 'reminder'>> = ['needs_reply', 'to_do', 'waiting_on', 'fyi'];
