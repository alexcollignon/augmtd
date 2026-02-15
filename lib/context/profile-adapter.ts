/**
 * Profile Adapter
 *
 * Temporary adapter to bridge old UserContextProfile structure with new modular profiles.
 * This allows existing code to continue working while we migrate to the new structure.
 */

import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { ProfileLoader } from './profile-loader';
import { UserContextProfile, DEFAULT_USER_CONTEXT } from '@/lib/types/user-context';

/**
 * Load user context in old format (for backward compatibility)
 * This assembles the modular profiles into the old monolithic structure
 */
export async function getUserContextLegacy(
  userId: string,
  supabase?: SupabaseClient
): Promise<UserContextProfile | undefined> {
  const client = supabase || await createClient();

  try {
    // Load modular profiles
    const profiles = await ProfileLoader.loadProfiles(userId, [
      'identity',
      'email_communication',
      'domain_knowledge',
      'relationships',
    ]);

    // If no profiles exist, return undefined
    if (!profiles.identity && !profiles.email_communication) {
      return undefined;
    }

    // Assemble into old structure
    const legacy: UserContextProfile = {
      // Communication style from email_communication profile
      communicationStyle: {
        avgLength: profiles.email_communication?.avgLength || 0,
        toneVector: {
          formal: profiles.email_communication?.tone || 0.5,
          casual: 1 - (profiles.email_communication?.tone || 0.5),
          technical: 0.5,
          friendly: 0.6,
          direct: 0.5,
        },
        formalityScore: profiles.email_communication?.formalityScore || 0.5,
        greetingPatterns: profiles.email_communication?.greetingPatterns || [],
        signatureStyle: profiles.email_communication?.signature || null,
        emojiUsage: profiles.email_communication?.emojiUsage || 0,
        commonPhrases: profiles.email_communication?.commonPhrases || [],
      },

      // Role patterns from identity profile
      rolePatterns: {
        primaryRole: profiles.identity?.role || '',
        responsibilities: profiles.identity?.responsibilities || [],
        decisionMakingLevel: profiles.identity?.authority || 'unknown',
        respondsWhenInTo: 0.5,
        respondsWhenInCC: 0.5,
        mentionSensitivity: 0.5,
        explicitAssignmentRate: 0.5,
        positionSensitivity: {
          primary: 0.5,
          secondary: 0.5,
          cc: 0.5,
        },
        typicalSenders: [],
        confidenceScore: profiles.identity?._confidence || 0,
      },

      // Urgency sensitivity (placeholder - not in new structure yet)
      urgencySensitivity: {
        thresholdScore: 0.5,
        avgResponseTime: profiles.email_communication?.responsePatterns?.avgResponseTime || 0,
        deadlineAdherence: 0.5,
        urgencyKeywords: [],
      },

      // Relationship graph from relationships profile
      relationshipGraph: profiles.relationships?.contacts?.reduce((acc: any, contact: any) => {
        acc[contact.email] = {
          email: contact.email,
          importance: contact.importance,
          typicalTone: 'mixed',
          responseRate: 0.5,
          avgResponseTime: 0,
          lastInteraction: contact.lastInteraction,
          interactionCount: contact.interactionCount,
          topics: contact.topics,
        };
        return acc;
      }, {}) || {},

      // Delegation behavior (placeholder)
      delegationBehavior: {
        delegationRate: 0,
        typicalTargets: [],
        delegationTriggers: [],
        neverDelegates: [],
      },

      // Confidence metrics
      confidenceMetrics: {
        overallScore: calculateOverallConfidence(profiles),
        signalCount: profiles.email_communication?._signalCount || 0,
        lastUpdated: new Date().toISOString(),
        dimensionConfidence: {
          communicationStyle: (profiles.email_communication?._confidence || 0) / 100,
          rolePatterns: (profiles.identity?._confidence || 0) / 100,
          urgencySensitivity: 0,
          relationshipGraph: (profiles.relationships?._confidence || 0) / 100,
          delegationBehavior: 0,
        },
      },
    };

    return legacy;
  } catch (error) {
    console.error('[ProfileAdapter] Error loading context:', error);
    return undefined;
  }
}

/**
 * Initialize user context profiles (new modular structure)
 */
export async function initializeUserContext(
  userId: string,
  fullName: string,
  role: string,
  email: string,
  supabase?: SupabaseClient
): Promise<void> {
  await ProfileLoader.initializeUser(userId, fullName, role, email);
}

/**
 * Update email communication profile from learning
 */
export async function updateEmailCommunicationFromLearning(
  userId: string,
  updates: {
    signature?: string;
    tone?: number;
    avgLength?: number;
    commonPhrases?: string[];
  },
  supabase?: SupabaseClient
): Promise<void> {
  // Load current profile
  const current = await ProfileLoader.loadProfile(userId, 'email_communication');

  if (!current) {
    console.error('[ProfileAdapter] Email communication profile not found');
    return;
  }

  // Merge updates
  const updated = {
    ...current,
    ...updates,
  };

  // Save with incremented signal count
  await ProfileLoader.updateProfile(
    userId,
    'email_communication',
    updated,
    undefined,
    true // increment signal count
  );
}

// Helper to calculate overall confidence
// Note: Returns 0-1 value to match old UserContextProfile.confidenceMetrics.overallScore format
function calculateOverallConfidence(profiles: any): number {
  const scores = [
    profiles.identity?._confidence || 0,
    profiles.email_communication?._confidence || 0,
    profiles.relationships?._confidence || 0,
  ].filter(s => s > 0);

  if (scores.length === 0) return 0;

  // Average the scores (which are 0-100) and convert to 0-1
  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return average / 100;
}
