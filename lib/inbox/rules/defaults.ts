// Seed default rules — adapted from Serif. Provider-aware: an inbox is seeded with the rules that
// make sense for ITS provider on connect, so a user never sees (or has to delete) rules that
// don't apply to their mailbox. Deterministic noise rules first (cheap), then AI rules.
// See docs/email-rules-engine-plan.md.

import type { InboxRule } from './types';

// Gmail-only deterministic rules (Gmail's native category labels).
const GMAIL_RULES: InboxRule[] = [
  {
    name: 'Gmail Promotions, Social & Forums',
    enabled: true, priority: 20, trigger: 'received', match_mode: 'any', ai_match: null,
    conditions: [
      { field: 'has_label', value: 'CATEGORY_PROMOTIONS' },
      { field: 'has_label', value: 'CATEGORY_SOCIAL' },
      { field: 'has_label', value: 'CATEGORY_FORUMS' },
    ],
    outcome: { set_type: 'marketing' }, source: 'default',
  },
  {
    name: 'Gmail Updates',
    enabled: true, priority: 30, trigger: 'received', match_mode: 'all', ai_match: null,
    conditions: [{ field: 'has_label', value: 'CATEGORY_UPDATES' }],
    outcome: { set_type: 'notifications' }, source: 'default',
  },
];

// Rules that apply to any provider.
const COMMON_RULES: InboxRule[] = [
  {
    name: 'No-reply / automated senders',
    enabled: true, priority: 10, trigger: 'received', match_mode: 'any', ai_match: null,
    conditions: [
      { field: 'from', value: 'no-reply' },
      { field: 'from', value: 'noreply' },
      { field: 'from', value: 'do-not-reply' },
      { field: 'from', value: 'donotreply' },
      { field: 'from', value: 'notifications@' },
      { field: 'from', value: 'mailer-daemon' },
    ],
    outcome: { set_type: 'notifications' }, source: 'default',
  },
  {
    name: 'Urgent — needs my attention',
    enabled: true, priority: 40, trigger: 'received', match_mode: 'all', conditions: [],
    ai_match: "Time-sensitive, blocking, or requires my direct attention — escalations, urgent customer issues, deal-critical asks, anything I must personally see immediately.",
    outcome: { set_type: 'needs_reply', escalate: { enabled: true } }, source: 'default',
  },
  {
    name: 'Needs reply',
    enabled: true, priority: 50, trigger: 'received', match_mode: 'all', conditions: [],
    ai_match: "The sender expects a reply, confirmation, solution, or action from me.",
    outcome: { set_type: 'needs_reply', auto_draft: { enabled: true } }, source: 'default',
  },
  {
    name: 'Meeting updates',
    enabled: true, priority: 60, trigger: 'received', match_mode: 'all', conditions: [],
    ai_match: "An automated update about my meetings or calendar events (rescheduled, cancelled, confirmed).",
    outcome: { set_type: 'meeting' }, source: 'default',
  },
  // ── M3 (work-surface, docs/work-surface-plan.md): the v1 AI TAXONOMY rules ("Marketing",
  // "Notifications", "FYI" as ai_match guesses) are RETIRED — describing what mail IS is now the
  // reasoned `mailKind` on the understanding (registry-grounded, judged once per email), not a
  // per-rule guess. RULES keep their real job: POSTURE — what needs the user (Urgent, Needs reply,
  // Meeting updates, Waiting, Done) — plus the cheap deterministic floors above. The classifier's
  // fyi fallback covers the rest. Your own rules always win over the kind (the precedence chain).
  {
    name: 'Waiting for reply',
    enabled: true, priority: 100, trigger: 'sent', match_mode: 'all', conditions: [],
    ai_match: "I sent a message and am waiting for the other party to respond.",
    outcome: { set_type: 'waiting_on' }, source: 'default',
  },
  {
    name: 'Done',
    enabled: true, priority: 110, trigger: 'sent', match_mode: 'all', conditions: [],
    ai_match: "The thread is complete and requires no further action from me.",
    outcome: { set_type: 'done' }, source: 'default',
  },
];

// The defaults to seed for a newly-connected inbox, by provider.
export function defaultRulesForProvider(provider: string): InboxRule[] {
  return provider === 'gmail' ? [...GMAIL_RULES, ...COMMON_RULES] : [...COMMON_RULES];
}

// Generic fallback (provider-specific rules self-guard via their conditions).
export const DEFAULT_RULES: InboxRule[] = [...GMAIL_RULES, ...COMMON_RULES];
