import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/get-session-user';
import { getMyWorkspace, getMyProfile } from './features';
import type { FeatureKey, MyWorkspace } from './types';

/** Where a feature rejection lands, and the feature key that route is guarded by. */
const FEATURE_FALLBACK = '/home';
const FEATURE_FALLBACK_PAGE: FeatureKey = 'home';

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
    // THE FALLBACK IS NEVER THE GUARDED PAGE. Every feature rejection lands on the front
    // door, so the front door itself can never be gated: a guard whose fallback is the page
    // it guards is an infinite redirect. Found live on a sovereign workshop workspace whose
    // `features.home` had been toggled off — /home redirected to /home forever (the browser
    // hammered the document ~3-4×/sec, the layout stayed mounted so the sidebar looked fine
    // while the page segment never rendered: a blank main column). Home is the app's front
    // door by law (the chat is always present there, and /work + /workers now redirect into
    // it), so it is not a gateable surface. The flag stays in the schema for back-compat and
    // is inert here — no other code reads it.
    if (feature && feature !== FEATURE_FALLBACK_PAGE && !workspace.features[feature]) {
      redirect(FEATURE_FALLBACK);
    }
  }

  return workspace;
}
