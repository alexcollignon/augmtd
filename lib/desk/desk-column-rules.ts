/**
 * Desk column rule engine — pure, synchronous, no AI.
 *
 * Covers ~80% of cases with high confidence.
 * Returns confidence: 'low' for genuinely ambiguous items that need AI.
 */

import type { DeskColumn } from '@/lib/types/desk';

export interface ColumnRuleInput {
  sourceType: 'email' | 'meeting_action' | 'process_step';
  // Email signals
  workState?: string;
  itemType?: string;
  isUserLastSender?: boolean;
  hasPrepared?: boolean;
  // Meeting action signal
  title?: string;
  // Process step signal
  stepStatus?: string;
}

export interface ColumnRuleResult {
  column: DeskColumn;
  confidence: 'high' | 'low';
}

// Keywords that indicate the user is waiting on someone else.
// Trailing spaces on single words (e.g. 'ask ') prevent false matches
// on substrings like "task" or "pending review".
const DELEGATION_KEYWORDS = [
  'follow up with',
  'waiting for',
  'check with',
  'confirm with',
  'ask ',
  'pending ',
  'get response from',
  'remind ',
  'chase ',
  'waiting on',
  'get back from',
];

export function assignColumnByRules(input: ColumnRuleInput): ColumnRuleResult {
  const { sourceType } = input;

  // ── Process steps ──────────────────────────────────────────────────────────
  // Assignee IS the user (filtered at query time). Status is machine-controlled.
  // Always high confidence — never needs AI.
  if (sourceType === 'process_step') {
    return input.stepStatus === 'in_progress'
      ? { column: 'in_progress', confidence: 'high' }
      : { column: 'todo', confidence: 'high' };
  }

  // ── Meeting actions ────────────────────────────────────────────────────────
  // User owns this action item. Delegation keyword scan determines todo vs waiting.
  // Always high confidence — never needs AI.
  if (sourceType === 'meeting_action') {
    const titleLower = input.title?.toLowerCase() ?? '';
    const isDelegated = DELEGATION_KEYWORDS.some((kw) => titleLower.includes(kw));
    return isDelegated
      ? { column: 'waiting', confidence: 'high' }
      : { column: 'todo', confidence: 'high' };
  }

  // ── Emails ─────────────────────────────────────────────────────────────────
  // Priority order: first match wins.

  const { workState, itemType, isUserLastSender, hasPrepared } = input;

  // Strongest signal: prepared work exists → user must act regardless of work_state
  if (hasPrepared) {
    return { column: 'todo', confidence: 'high' };
  }

  // work_state-based rules
  if (workState === 'work_prepared') {
    return { column: 'todo', confidence: 'high' };
  }

  if (workState === 'decision_required') {
    return { column: 'todo', confidence: 'high' };
  }

  if (workState === 'reply_needed') {
    // Direction signal resolves this unambiguously
    return isUserLastSender
      ? { column: 'waiting', confidence: 'high' }
      : { column: 'todo', confidence: 'high' };
  }

  if (workState === 'noted' && isUserLastSender === true) {
    // User acknowledged/responded — ball is in their court
    return { column: 'waiting', confidence: 'high' };
  }

  // item_type-based rules (when work_state alone isn't clear)
  if (itemType === 'decision') {
    return { column: 'todo', confidence: 'high' };
  }

  if (itemType === 'review' && isUserLastSender === false) {
    // Document/proposal waiting for user's review
    return { column: 'todo', confidence: 'high' };
  }

  if (itemType === 'reply' && isUserLastSender === true) {
    return { column: 'waiting', confidence: 'high' };
  }

  if (itemType === 'reply' && isUserLastSender === false) {
    return { column: 'todo', confidence: 'high' };
  }

  // Catch-all: ambiguous cases (noted+received, fyi, notification, unknown)
  // → Pool default, send to AI with rich context
  return { column: 'pool', confidence: 'low' };
}
