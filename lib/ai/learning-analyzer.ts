/**
 * Learning Signal Analyzer
 *
 * Analyzes user feedback (confirmations, rejections, etc.) to improve
 * confidence thresholds and role detection over time
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface LearningInsights {
  userConfirmationRate: number;
  rejectionRate: number;
  suggestedThreshold: number;
  rolePatternsAccuracy: Record<string, number>;
  positionAccuracy: {
    to: number;
    cc: number;
  };
}

/**
 * Analyze learning signals for a user to derive insights
 */
export async function analyzeLearningSignals(
  userId: string,
  supabase: SupabaseClient
): Promise<LearningInsights> {
  // Get all learning signals for this user
  const { data: signals } = await supabase
    .from('learning_signals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100); // Last 100 signals

  if (!signals || signals.length === 0) {
    // No data yet - return defaults
    return {
      userConfirmationRate: 0.5,
      rejectionRate: 0.5,
      suggestedThreshold: 0.4, // Default SUGGESTED threshold
      rolePatternsAccuracy: {},
      positionAccuracy: {
        to: 0.8,
        cc: 0.3,
      },
    };
  }

  // === CONFIRMATION/REJECTION RATES ===
  const confirmations = signals.filter(s => s.signal_type === 'suggestion_confirmed');
  const rejections = signals.filter(s => s.signal_type === 'suggestion_rejected');

  const totalSuggestions = confirmations.length + rejections.length;
  const confirmationRate = totalSuggestions > 0
    ? confirmations.length / totalSuggestions
    : 0.5;
  const rejectionRate = totalSuggestions > 0
    ? rejections.length / totalSuggestions
    : 0.5;

  // === SUGGESTED THRESHOLD ===
  // If user confirms >70% of suggestions → lower threshold (show more)
  // If user rejects >70% of suggestions → raise threshold (show less)
  let suggestedThreshold = 0.4; // Default

  if (totalSuggestions >= 10) { // Need at least 10 signals for adjustment
    if (confirmationRate > 0.7) {
      suggestedThreshold = 0.3; // More permissive
    } else if (rejectionRate > 0.7) {
      suggestedThreshold = 0.5; // More restrictive
    }
  }

  // === ROLE PATTERN ACCURACY ===
  const roleAccuracy: Record<string, number> = {};
  const roleConfirms: Record<string, number> = {};
  const roleTotal: Record<string, number> = {};

  [...confirmations, ...rejections].forEach(signal => {
    const role = signal.signal_data?.detected_role;
    if (!role) return;

    roleTotal[role] = (roleTotal[role] || 0) + 1;
    if (signal.signal_type === 'suggestion_confirmed') {
      roleConfirms[role] = (roleConfirms[role] || 0) + 1;
    }
  });

  for (const role in roleTotal) {
    roleAccuracy[role] = roleTotal[role] > 0
      ? (roleConfirms[role] || 0) / roleTotal[role]
      : 0;
  }

  // === POSITION ACCURACY (To vs CC) ===
  const toConfirms = confirmations.filter(s => s.signal_data?.position === 'to').length;
  const toRejects = rejections.filter(s => s.signal_data?.position === 'to').length;
  const ccConfirms = confirmations.filter(s => s.signal_data?.position === 'cc').length;
  const ccRejects = rejections.filter(s => s.signal_data?.position === 'cc').length;

  const toAccuracy = (toConfirms + toRejects) > 0
    ? toConfirms / (toConfirms + toRejects)
    : 0.8;

  const ccAccuracy = (ccConfirms + ccRejects) > 0
    ? ccConfirms / (ccConfirms + ccRejects)
    : 0.3;

  return {
    userConfirmationRate: confirmationRate,
    rejectionRate,
    suggestedThreshold,
    rolePatternsAccuracy: roleAccuracy,
    positionAccuracy: {
      to: toAccuracy,
      cc: ccAccuracy,
    },
  };
}

/**
 * Get personalized confidence threshold for a user
 */
export async function getPersonalizedThreshold(
  userId: string,
  supabase: SupabaseClient
): Promise<number> {
  const insights = await analyzeLearningSignals(userId, supabase);
  return insights.suggestedThreshold;
}

/**
 * Check if user tends to confirm items in this role
 */
export async function isRoleRelevantToUser(
  userId: string,
  detectedRole: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const insights = await analyzeLearningSignals(userId, supabase);

  const roleAccuracy = insights.rolePatternsAccuracy[detectedRole];

  // If we have data and accuracy is >60%, consider it relevant
  if (roleAccuracy !== undefined) {
    return roleAccuracy > 0.6;
  }

  // No data yet - assume relevant
  return true;
}
