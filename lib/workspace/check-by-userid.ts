import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeFeatures, type FeatureKey, type WorkspaceFeatures, DEFAULT_FEATURES } from './types';

/**
 * Check a workspace feature for a given userId using an admin client.
 * Returns `true` if the feature is enabled AND the workspace is active.
 *
 * For use in webhooks, cron jobs, and background processors where there is
 * no user session — the userId is the only input.
 *
 * Returns `DEFAULT_FEATURES` on lookup failure to avoid silently dropping
 * data when the workspace row can't be read (fail-open for processors).
 */
export async function featureEnabledForUser(
  adminClient: SupabaseClient,
  userId: string,
  feature: FeatureKey
): Promise<boolean> {
  try {
    const { data } = await adminClient
      .from('company_members')
      .select('companies(status, features)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle() as { data: { companies: { status: string; features: unknown } | { status: string; features: unknown }[] | null } | null };

    if (!data?.companies) return DEFAULT_FEATURES[feature];

    const company = Array.isArray(data.companies) ? data.companies[0] : data.companies;
    if (!company) return DEFAULT_FEATURES[feature];

    // Suspended or deleting workspaces disable all features
    if (company.status !== 'active') return false;

    const features: WorkspaceFeatures = normalizeFeatures(company.features);
    return features[feature];
  } catch {
    return DEFAULT_FEATURES[feature];
  }
}
