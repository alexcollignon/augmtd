/**
 * Work Patterns Service
 *
 * Handles saving and loading work pattern preferences to context_profiles table
 */

import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  OnboardingData,
  WorkPatternsProfileData,
  WorkflowRecord,
  IdentityProfileData,
  WorkBlueprint,
} from '@/lib/types/work-blueprints';
import { getBlueprintById } from '@/lib/blueprints/blueprint-library';

/**
 * Save onboarding data to user profiles
 */
export async function saveOnboardingData(
  userId: string,
  data: OnboardingData,
  supabase?: SupabaseClient
): Promise<void> {
  const client = supabase || (await createClient());

  try {
    // Get existing identity profile to merge with
    const { data: existing } = await client
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', userId)
      .eq('profile_type', 'identity')
      .single();

    // Merge new data with existing profile data
    const mergedData = {
      ...(existing?.profile_data || {}),
      jobRole: data.jobRole,
      department: data.department,
    };

    // Update identity profile with merged data
    const { error: upsertError } = await client
      .from('context_profiles')
      .upsert({
        user_id: userId,
        profile_type: 'identity',
        profile_data: mergedData,
        confidence_score: 95.0, // High confidence - explicit from user
        learned_from_count: 1,
      }, {
        onConflict: 'user_id,profile_type',
      });

    if (upsertError) {
      console.error('[WorkPatternsService] Failed to upsert identity profile:', upsertError);
      throw upsertError;
    }

    // Create or update work_patterns profile (empty initially)
    await client
      .from('context_profiles')
      .upsert({
        user_id: userId,
        profile_type: 'work_patterns',
        profile_data: {
          selectedBlueprints: [],
          customBlueprints: [],
          blueprintUsage: {},
        },
        confidence_score: 95.0,
        learned_from_count: 1,
      })
      .match({ user_id: userId, profile_type: 'work_patterns' });

    console.log('[WorkPatternsService] Saved onboarding data for user:', userId);
  } catch (error) {
    console.error('[WorkPatternsService] Error saving onboarding data:', error);
    throw error;
  }
}

/**
 * Load user's selected work patterns
 */
export async function getUserWorkPatterns(
  userId: string,
  supabase?: SupabaseClient
): Promise<WorkPatternsProfileData | null> {
  const client = supabase || (await createClient());

  try {
    const { data, error } = await client
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', userId)
      .eq('profile_type', 'work_patterns')
      .single();

    if (error || !data) {
      console.log('[WorkPatternsService] No work patterns found for user:', userId);
      return null;
    }

    return data.profile_data as WorkPatternsProfileData;
  } catch (error) {
    console.error('[WorkPatternsService] Error loading work patterns:', error);
    return null;
  }
}

/**
 * Load user's identity profile (job role, department, seniority)
 */
export async function getUserIdentity(
  userId: string,
  supabase?: SupabaseClient
): Promise<IdentityProfileData | null> {
  const client = supabase || (await createClient());

  try {
    const { data, error } = await client
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', userId)
      .eq('profile_type', 'identity')
      .single();

    if (error || !data) {
      console.log('[WorkPatternsService] No identity found for user:', userId);
      return null;
    }

    return data.profile_data as IdentityProfileData;
  } catch (error) {
    console.error('[WorkPatternsService] Error loading identity:', error);
    return null;
  }
}

/**
 * Check if user has completed onboarding
 */
export async function hasCompletedOnboarding(
  userId: string,
  supabase?: SupabaseClient
): Promise<boolean> {
  const identity = await getUserIdentity(userId, supabase);
  return !!(identity?.jobRole && identity?.department);
}

/**
 * Get user's blueprints (selected + custom)
 */
export async function getUserBlueprints(
  userId: string,
  supabase?: SupabaseClient
): Promise<WorkBlueprint[]> {
  const patterns = await getUserWorkPatterns(userId, supabase);

  if (!patterns) {
    return [];
  }

  const blueprints: WorkBlueprint[] = [];

  // Add selected blueprints from library
  for (const blueprintId of patterns.selectedBlueprints) {
    const blueprint = getBlueprintById(blueprintId);
    if (blueprint) {
      blueprints.push(blueprint);
    }
  }

  // Add custom blueprints
  if (patterns.customBlueprints) {
    blueprints.push(...patterns.customBlueprints);
  }

  return blueprints;
}

/**
 * Increment blueprint usage count
 */
export async function trackBlueprintUsage(
  userId: string,
  blueprintId: string,
  supabase?: SupabaseClient
): Promise<void> {
  const client = supabase || (await createClient());

  try {
    const patterns = await getUserWorkPatterns(userId, client);

    if (!patterns) {
      return;
    }

    const updatedUsage = {
      ...patterns.blueprintUsage,
      [blueprintId]: (patterns.blueprintUsage[blueprintId] || 0) + 1,
    };

    await client
      .from('context_profiles')
      .update({
        profile_data: {
          ...patterns,
          blueprintUsage: updatedUsage,
        },
      })
      .eq('user_id', userId)
      .eq('profile_type', 'work_patterns');

    console.log('[WorkPatternsService] Tracked blueprint usage:', blueprintId);
  } catch (error) {
    console.error('[WorkPatternsService] Error tracking blueprint usage:', error);
  }
}

/**
 * Add custom blueprint created by user
 */
export async function addCustomBlueprint(
  userId: string,
  blueprint: WorkBlueprint,
  supabase?: SupabaseClient
): Promise<void> {
  const client = supabase || (await createClient());

  try {
    const patterns = await getUserWorkPatterns(userId, client);

    if (!patterns) {
      throw new Error('User work patterns not found');
    }

    const updatedCustom = [...patterns.customBlueprints, blueprint];

    await client
      .from('context_profiles')
      .update({
        profile_data: {
          ...patterns,
          customBlueprints: updatedCustom,
        },
      })
      .eq('user_id', userId)
      .eq('profile_type', 'work_patterns');

    console.log('[WorkPatternsService] Added custom blueprint:', blueprint.name);
  } catch (error) {
    console.error('[WorkPatternsService] Error adding custom blueprint:', error);
    throw error;
  }
}

/**
 * Update work_patterns profile from a finalized work thread plan.
 * Called after each AI message that produces a plan update.
 * Non-fatal — errors are logged but not thrown.
 */
export async function updateWorkPatternsFromThread(
  userId: string,
  threadId: string,
  threadTitle: string,
  plan: {
    deliverable_type?: string;
    deliverable_description?: string;
    steps?: Array<{ skill?: string }>;
    inputs?: Array<{ name?: string }>;
  },
  supabase?: SupabaseClient
): Promise<void> {
  const client = supabase || (await createClient());

  try {
    // Extract workflow signal from plan
    const skills = [
      ...new Set(
        (plan.steps || []).map((s) => s.skill).filter(Boolean) as string[]
      ),
    ];
    const commonInputs = (plan.inputs || [])
      .map((i) => i.name)
      .filter(Boolean) as string[];

    const record: WorkflowRecord = {
      threadId,
      name: threadTitle,
      purpose: plan.deliverable_description || '',
      deliverableType: plan.deliverable_type || 'document',
      skills,
      commonInputs,
      updatedAt: new Date().toISOString(),
    };

    // Load existing work_patterns profile
    const { data: existing } = await client
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', userId)
      .eq('profile_type', 'work_patterns')
      .single();

    const current: WorkPatternsProfileData = {
      selectedBlueprints: [],
      customBlueprints: [],
      blueprintUsage: {},
      recentWorkflows: [],
      deliverableTypes: {},
      commonSkills: [],
      ...(existing?.profile_data || {}),
    };

    // Update or insert the workflow record (keyed by threadId)
    const idx = current.recentWorkflows.findIndex((w) => w.threadId === threadId);
    if (idx >= 0) {
      current.recentWorkflows[idx] = record;
    } else {
      current.recentWorkflows.unshift(record); // newest first
    }
    current.recentWorkflows = current.recentWorkflows.slice(0, 20);

    // Recalculate deliverable type counts from all stored workflows
    const deliverableTypes: Record<string, number> = {};
    for (const w of current.recentWorkflows) {
      if (w.deliverableType) {
        deliverableTypes[w.deliverableType] = (deliverableTypes[w.deliverableType] || 0) + 1;
      }
    }

    // Recalculate top skills by frequency across all stored workflows
    const skillCounts: Record<string, number> = {};
    for (const w of current.recentWorkflows) {
      for (const skill of w.skills || []) {
        skillCounts[skill] = (skillCounts[skill] || 0) + 1;
      }
    }
    const commonSkills = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skill]) => skill);

    await client
      .from('context_profiles')
      .upsert(
        {
          user_id: userId,
          profile_type: 'work_patterns',
          profile_data: {
            ...current,
            recentWorkflows: current.recentWorkflows,
            deliverableTypes,
            commonSkills,
          },
          confidence_score: 90.0,
          learned_from_count: current.recentWorkflows.length,
        },
        { onConflict: 'user_id,profile_type' }
      );

    console.log('[WorkPatternsService] Updated work_patterns from thread:', threadId);
  } catch (error) {
    console.error('[WorkPatternsService] Error updating work_patterns:', error);
    // Non-fatal — don't throw
  }
}
