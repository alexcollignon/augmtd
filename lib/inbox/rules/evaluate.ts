// Email rules engine — evaluation. Deterministic (synchronous, no AI) now; AI-match runs at
// process time in Phase 3. First matching rule (by priority) wins.

import type { InboxRule, RuleEmail, Condition } from './types';

const contains = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());
const anyContains = (list: string[], needle: string) => list.some(s => contains(s, needle));

function matchCondition(email: RuleEmail, c: Condition): boolean {
  const v = c.value;
  switch (c.field) {
    case 'from': return contains(email.from, v);
    case 'not_from': return !contains(email.from, v);
    case 'to': return anyContains(email.to, v);
    case 'not_to': return !anyContains(email.to, v);
    case 'cc': return anyContains(email.cc, v);
    case 'not_cc': return !anyContains(email.cc, v);
    case 'subject_contains': return contains(email.subject, v);
    case 'subject_excludes': return !contains(email.subject, v);
    case 'body_contains': return contains(email.body, v);
    case 'body_excludes': return !contains(email.body, v);
    case 'has_label': return email.labels.includes(v);
    case 'has_no_label': return !email.labels.includes(v);
    default: return false;
  }
}

export function matchesFilters(email: RuleEmail, rule: InboxRule): boolean {
  if (!rule.conditions.length) return false;
  const results = rule.conditions.map(c => matchCondition(email, c));
  return rule.match_mode === 'all' ? results.every(Boolean) : results.some(Boolean);
}

// Deterministic-only pass (no AI). Returns the first matching rule for this email's direction.
export function evaluateDeterministic(email: RuleEmail, rules: InboxRule[]): InboxRule | null {
  const candidates = rules
    .filter(r => r.enabled && !r.ai_match && r.trigger === email.direction)
    .sort((a, b) => a.priority - b.priority);
  for (const rule of candidates) {
    if (matchesFilters(email, rule)) return rule;
  }
  return null;
}

// Phase 3: evaluateAiMatch(email, rules, aiClient) runs the AI-match rules at PROCESS time
// (after deterministic rules miss) and persists the resulting type on the item. Not wired yet —
// classification still uses the in-app heuristics for the AI-ish call until then.
