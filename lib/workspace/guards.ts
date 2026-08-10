import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/get-session-user';
import { getMyWorkspace, getMyProfile } from './features';
import type { FeatureKey, MyWorkspace } from './types';

/**
 * Server-side page guard: call at the top of a RSC page.tsx.
 * Redirects if user is unauthenticated, workspace is suspended/deleting,
 * or the required feature is disabled.
 *
 * Returns the workspace so the page can use it without a second fetch
 * (getMyWorkspace is React-cached).
 */
export async function guardFeaturePage(feature: FeatureKey | null): Promise<MyWorkspace> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Cached helpers — deduped with the layout's reads in the same render pass.
  const supabase = await createClient();
  const [profile, workspace] = await Promise.all([
    getMyProfile(user.id),
    getMyWorkspace(user.id, supabase),
  ]);

  if (!workspace) {
    redirect('/onboarding');
  }

  const isSuperAdmin = profile?.is_super_admin === true;

  if (!isSuperAdmin) {
    if (workspace.status === 'suspended' || workspace.status === 'deleting') {
      redirect('/suspended');
    }
    if (feature && !workspace.features[feature]) {
      // Feature not enabled for this workspace — send to /work (always-on)
      redirect('/home');
    }
  }

  return workspace;
}
