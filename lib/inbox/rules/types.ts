// Email rules engine — types. A rule drives classification (label) + actions (outcome).
// See docs/email-rules-engine-plan.md.

import type { ItemType } from '../classify-item';

// The full label set a rule can apply. Broader than the in-app display types so the (later)
// Gmail/Outlook write-back is legible; mapped back to ItemType for in-app grouping.
export type RuleLabel = 'needs_reply' | 'to_do' | 'waiting_on' | 'meeting' | 'fyi' | 'notifications' | 'marketing' | 'done';

export type RuleTrigger = 'received' | 'sent';
export type MatchMode = 'all' | 'any';

export type ConditionField =
  | 'from' | 'not_from' | 'to' | 'not_to' | 'cc' | 'not_cc'
  | 'subject_contains' | 'subject_excludes' | 'body_contains' | 'body_excludes'
  | 'has_label' | 'has_no_label';

export type Condition = { field: ConditionField; value: string };

export type RuleOutcome = {
  set_type?: RuleLabel;
  /** THE LABEL FLIP: a rule's KIND OVERRIDE — the user's durable correction of what mail from
   *  this match IS ("this sender is never marketing", "this domain is a customer"). Applied as
   *  `source_data.kind_override`, which outranks the reasoned `understanding.mailKind` in the
   *  ONE resolver (lib/inbox/rules/write-back.ts `resolveKind`). Rules stay posture-authoritative
   *  via set_type; set_kind is the correction channel, never the default classifier. */
  set_kind?: 'receipt' | 'newsletter' | 'notification' | 'calendar' | 'cold_outreach' | 'customer' | 'team' | 'personal';
  auto_draft?: { enabled: boolean; instructions?: string };
  mark_read?: boolean;
  archive?: boolean;
  forward_to?: string;
  escalate?: { enabled: boolean; instructions?: string };
  trash?: boolean;
};

export type InboxRule = {
  id?: string;
  name: string;
  enabled: boolean;
  priority: number;            // lower = first
  trigger: RuleTrigger;
  match_mode: MatchMode;
  conditions: Condition[];     // deterministic filters (empty when ai_match is set)
  ai_match: string | null;     // natural-language match; null = deterministic
  outcome: RuleOutcome;
  source: 'default' | 'user' | 'workspace';
};

// Minimal email shape the engine evaluates against.
export type RuleEmail = {
  direction: RuleTrigger;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  labels: string[];            // provider labels/categories (e.g. CATEGORY_PROMOTIONS)
};

// How a rule label maps to the in-app display type (grouping in inbox + Home).
export const LABEL_TO_TYPE: Record<RuleLabel, ItemType> = {
  needs_reply: 'needs_reply',
  to_do: 'to_do',
  waiting_on: 'waiting_on',
  meeting: 'fyi', // a "meeting updates" email is awareness; real meetings are a SOURCE, not this type
  fyi: 'fyi',
  notifications: 'fyi', // noise tier — shown under awareness in-app (its own label only for write-back)
  marketing: 'fyi',
  done: 'hidden',
};
