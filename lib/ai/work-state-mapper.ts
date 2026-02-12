/**
 * Work State Mapping
 *
 * Maps detected work signals to appropriate work states
 * based on the cognitive cost framework.
 */

import type { WorkSignals, WorkState } from '@/lib/types/recipient-detection';

// ==========================================
// MAIN MAPPING FUNCTION
// ==========================================

/**
 * Infer work state from detected signals
 *
 * Based on cognitive cost framework:
 * - WORK_PREPARED: Judgment now (email domain, can draft reply)
 * - ACTION_REQUIRED: Execution to prevent downside (external actions, high stakes)
 * - DECISION_REQUIRED: Choice under uncertainty (multiple options)
 * - WAITING: Blocked on external input
 * - NOTED: Awareness only (low stakes, informational)
 * - NOISE: Hidden completely (spam, irrelevant)
 */
export function inferWorkState(
  signals: WorkSignals,
  recipientRole: string, // 'primary_owner', 'reviewer', 'informed', etc.
  hasEmailExecutionTarget: boolean = true // Can this be handled via email reply?
): WorkState {

  // NOISE: Completely irrelevant
  if (recipientRole === 'irrelevant') {
    return 'noise';
  }

  // NOTED: Awareness only, no action needed
  if (isAwarenessOnly(signals)) {
    return 'noted';
  }

  // WAITING: Has obligation but blocked on something
  if (isWaitingState(signals)) {
    return 'waiting';
  }

  // DECISION_REQUIRED: Explicit choice under uncertainty
  if (isDecisionRequired(signals)) {
    return 'decision_required';
  }

  // ACTION_REQUIRED: External execution with high stakes
  if (isActionRequired(signals, hasEmailExecutionTarget)) {
    return 'action_required';
  }

  // WORK_PREPARED: Judgment via email (can draft reply)
  if (isWorkPrepared(signals, hasEmailExecutionTarget)) {
    return 'work_prepared';
  }

  // Default: If has obligation but doesn't fit other categories
  if (signals.hasObligation) {
    return 'work_prepared'; // Safe default for obligations
  }

  // Final fallback: awareness only
  return 'noted';
}

// ==========================================
// WORK STATE DETECTION LOGIC
// ==========================================

/**
 * Check if this is awareness only (NOTED)
 *
 * Criteria:
 * - Explicitly informational only, OR
 * - No obligation, decision, or task assignment
 * - Low work impact
 */
function isAwarenessOnly(signals: WorkSignals): boolean {
  // Explicit FYI
  if (signals.informationalOnly) {
    return true;
  }

  // No clear work signals
  if (
    !signals.hasObligation &&
    !signals.requiresDecision &&
    !signals.isTaskAssignment &&
    !signals.requiresApproval
  ) {
    return true;
  }

  // Has obligation but very weak
  if (
    signals.hasObligation &&
    signals.obligationStrength < 20 &&
    !signals.requiresJudgment
  ) {
    return true;
  }

  return false;
}

/**
 * Check if this is waiting state (WAITING)
 *
 * Criteria:
 * - Has obligation but blocked on external input
 * - Waiting for approval/response from others
 * - Follow-up email with no new action
 */
function isWaitingState(signals: WorkSignals): boolean {
  // Waiting for approval/response
  if (signals.requiresApproval && !signals.requiresDecision) {
    // If asking for approval, it's DECISION
    // If waiting for someone else's approval, it's WAITING
    // This is tricky - for now, treat approval as decision
    return false;
  }

  // Follow-up with no new obligation
  if (signals.isFollowUp && !signals.hasObligation) {
    return true;
  }

  // Mentions others doing work (we're just aware)
  if (signals.mentionsOthers && !signals.hasObligation) {
    return true;
  }

  return false;
}

/**
 * Check if this requires decision (DECISION_REQUIRED)
 *
 * Criteria:
 * - Explicit choice between options
 * - High judgment complexity
 * - Requires approval (yes/no decision)
 */
function isDecisionRequired(signals: WorkSignals): boolean {
  // Explicit decision needed
  if (signals.requiresDecision) {
    return true;
  }

  // Approval = decision (approve vs reject)
  if (signals.requiresApproval && signals.requiresJudgment) {
    return true;
  }

  // Very high judgment complexity suggests decision
  if (
    signals.requiresJudgment &&
    signals.judgmentComplexity >= 70 &&
    signals.hasObligation
  ) {
    return true;
  }

  return false;
}

/**
 * Check if this requires action (ACTION_REQUIRED)
 *
 * Criteria:
 * - Execution target is NOT email (external actions)
 * - High stakes / prevent downside
 * - Task assignment with external execution
 */
function isActionRequired(
  signals: WorkSignals,
  hasEmailExecutionTarget: boolean
): boolean {
  // Must have obligation
  if (!signals.hasObligation) {
    return false;
  }

  // Execution target is external (not email)
  if (!hasEmailExecutionTarget) {
    // High stakes external action
    if (signals.obligationStrength >= 50) {
      return true;
    }

    // Urgent external action
    if (signals.hasDeadline && signals.deadlineUrgency >= 70) {
      return true;
    }

    // Task assignment that's not email-based
    if (signals.isTaskAssignment) {
      return true;
    }
  }

  return false;
}

/**
 * Check if work can be prepared (WORK_PREPARED)
 *
 * Criteria:
 * - Execution target IS email (can draft reply)
 * - Has obligation + judgment
 * - Can prepare draft for user approval
 */
function isWorkPrepared(
  signals: WorkSignals,
  hasEmailExecutionTarget: boolean
): boolean {
  // Must have obligation
  if (!signals.hasObligation) {
    return false;
  }

  // Execution target is email (can draft)
  if (hasEmailExecutionTarget) {
    // Has judgment component (not just mechanical)
    if (signals.requiresJudgment || signals.obligationStrength >= 30) {
      return true;
    }

    // Task assignment via email
    if (signals.isTaskAssignment) {
      return true;
    }
  }

  return false;
}

// ==========================================
// PRIORITY CALCULATION
// ==========================================

/**
 * Calculate priority score (0-100) based on signals
 *
 * Priority factors:
 * 1. Deadline urgency (40%)
 * 2. Obligation strength (30%)
 * 3. Work state impact (20%)
 * 4. Judgment complexity (10%)
 */
export function calculatePriority(
  signals: WorkSignals,
  workState: WorkState,
  recipientRole: string
): number {
  let priority = 0;

  // Factor 1: Deadline urgency (0-40 points)
  if (signals.hasDeadline) {
    priority += (signals.deadlineUrgency / 100) * 40;
  }

  // Factor 2: Obligation strength (0-30 points)
  priority += (signals.obligationStrength / 100) * 30;

  // Factor 3: Work state impact (0-20 points)
  const workStateBonus = {
    action_required: 20,
    decision_required: 18,
    work_prepared: 15,
    waiting: 10,
    noted: 5,
    noise: 0,
  };
  priority += workStateBonus[workState] || 0;

  // Factor 4: Judgment complexity (0-10 points)
  if (signals.requiresJudgment) {
    priority += (signals.judgmentComplexity / 100) * 10;
  }

  // Boost for primary owner
  if (recipientRole === 'primary_owner') {
    priority *= 1.1; // 10% boost
  }

  // Reduce for informed/irrelevant
  if (recipientRole === 'informed') {
    priority *= 0.7; // 30% reduction
  }
  if (recipientRole === 'irrelevant') {
    priority *= 0.3; // 70% reduction
  }

  return Math.round(Math.min(100, Math.max(0, priority)));
}

// ==========================================
// WORK STATE DESCRIPTIONS
// ==========================================

/**
 * Get human-readable description of work state
 */
export function getWorkStateDescription(workState: WorkState): string {
  const descriptions: Record<WorkState, string> = {
    work_prepared: 'Draft reply prepared - review and send',
    action_required: 'External action needed - cannot draft reply',
    decision_required: 'Decision needed - review options',
    waiting: 'Waiting on external input - no action yet',
    noted: 'For awareness only - no action needed',
    noise: 'Filtered as noise',
  };

  return descriptions[workState] || 'Unknown work state';
}

/**
 * Get work state badge color
 */
export function getWorkStateBadgeColor(workState: WorkState): string {
  const colors: Record<WorkState, string> = {
    work_prepared: 'green',    // Ready to send
    action_required: 'red',    // Urgent external action
    decision_required: 'orange', // Needs thinking
    waiting: 'gray',           // Blocked
    noted: 'blue',             // FYI
    noise: 'gray',             // Hidden
  };

  return colors[workState] || 'gray';
}

// ==========================================
// BATCH MAPPING
// ==========================================

/**
 * Map multiple recipients' signals to work states
 */
export function inferWorkStatesBatch(
  recipientsSignals: Array<{
    email: string;
    role: string;
    signals: WorkSignals;
  }>
): Array<{
  email: string;
  workState: WorkState;
  priority: number;
}> {
  return recipientsSignals.map(recipient => ({
    email: recipient.email,
    workState: inferWorkState(
      recipient.signals,
      recipient.role,
      true // Default: assume email execution target
    ),
    priority: calculatePriority(
      recipient.signals,
      inferWorkState(recipient.signals, recipient.role, true),
      recipient.role
    ),
  }));
}

// ==========================================
// SIGNAL COMBINATION HELPERS
// ==========================================

/**
 * Check if signals indicate high-stakes work
 */
export function isHighStakes(signals: WorkSignals): boolean {
  return (
    signals.obligationStrength >= 70 ||
    signals.deadlineUrgency >= 80 ||
    (signals.requiresDecision && signals.judgmentComplexity >= 60)
  );
}

/**
 * Check if signals indicate urgent work
 */
export function isUrgent(signals: WorkSignals): boolean {
  return (
    signals.hasDeadline &&
    signals.deadlineUrgency >= 75
  );
}

/**
 * Check if signals indicate low-effort work
 */
export function isLowEffort(signals: WorkSignals): boolean {
  return (
    signals.hasObligation &&
    !signals.requiresJudgment &&
    !signals.requiresDecision &&
    signals.judgmentComplexity < 30 &&
    signals.obligationStrength < 50
  );
}

// ==========================================
// WORK STATE VALIDATION
// ==========================================

/**
 * Validate work state assignment makes sense given signals
 * Returns warnings if assignment seems incorrect
 */
export function validateWorkStateAssignment(
  workState: WorkState,
  signals: WorkSignals
): string[] {
  const warnings: string[] = [];

  // WORK_PREPARED should have obligation
  if (workState === 'work_prepared' && !signals.hasObligation) {
    warnings.push('WORK_PREPARED assigned but no obligation detected');
  }

  // NOTED should not have strong obligation
  if (workState === 'noted' && signals.obligationStrength > 50) {
    warnings.push('NOTED assigned but strong obligation detected');
  }

  // DECISION_REQUIRED should have decision or high judgment
  if (
    workState === 'decision_required' &&
    !signals.requiresDecision &&
    signals.judgmentComplexity < 50
  ) {
    warnings.push('DECISION_REQUIRED assigned but no clear decision/judgment');
  }

  return warnings;
}
