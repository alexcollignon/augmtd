import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from './features';
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Superadmin bypass — still needs a workspace to render feature pages,
  // but bypass the feature/status checks. If they have no workspace, send to /join.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin, needs_join')
    .eq('id', user.id)
    .maybeSingle();

  const workspace = await getMyWorkspace(user.id, supabase);

  if (!workspace) {
    redirect('/join');
  }

  const isSuperAdmin = profile?.is_super_admin === true;

  if (!isSuperAdmin) {
    if (workspace.status === 'suspended' || workspace.status === 'deleting') {
      redirect('/suspended');
    }
    if (feature && !workspace.features[feature]) {
      // Feature not enabled for this workspace — send to /work (always-on)
      redirect('/work');
    }
  }

  return workspace;
}
