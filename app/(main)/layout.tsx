import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SidebarNav from '@/components/sidebar-nav';
import { getMyWorkspace, getAllWorkspaces } from '@/lib/workspace/features';
import { WorkspaceProvider } from '@/context/workspace-context';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';
import { getActiveWorkspaceId } from '@/lib/workspace/active-workspace';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const activeWorkspaceId = await getActiveWorkspaceId();

  // Fetch sidebar + workspace data in parallel — no serial waterfalls
  const [{ data: profileData }, { data: connectionsData }, workspace, allWorkspaces] = await Promise.all([
    supabase.from('profiles').select('is_super_admin').eq('id', user.id).single(),
    supabase.from('connections').select('metadata').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: true }),
    getMyWorkspace(user.id, supabase, activeWorkspaceId),
    getAllWorkspaces(user.id),
  ]);

  const isSuperAdmin = profileData?.is_super_admin === true;

  // Orphan (no workspace) → /onboarding for new users. Superadmins bypass.
  if (!workspace && allWorkspaces.length === 0 && !isSuperAdmin) {
    redirect('/onboarding');
  }

  // If cookie points to a workspace the user is no longer in, fall back to first available
  const activeWorkspace = workspace ?? allWorkspaces[0] ?? null;

  // Suspended / deleting workspace → /suspended. Superadmins bypass.
  if (activeWorkspace && activeWorkspace.status !== 'active' && !isSuperAdmin) {
    redirect('/suspended');
  }

  const avatarUrl =
    (connectionsData ?? [])
      .map((c: any) => c.metadata?.picture)
      .find((p: any) => typeof p === 'string' && p.length > 0) ?? null;

  const features = activeWorkspace?.features ?? DEFAULT_FEATURES;

  return (
    <WorkspaceProvider workspace={activeWorkspace} allWorkspaces={allWorkspaces} isSuperAdmin={isSuperAdmin}>
      <div className="flex h-screen bg-neutral-50 overflow-hidden">
        <SidebarNav
          userEmail={user.email}
          avatarUrl={avatarUrl}
          isSuperAdmin={isSuperAdmin}
          features={features}
          allWorkspaces={allWorkspaces}
          activeWorkspace={activeWorkspace}
        />
        {children}
      </div>
    </WorkspaceProvider>
  );
}
