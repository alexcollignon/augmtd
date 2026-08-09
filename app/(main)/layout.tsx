import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/get-session-user';
// THE SHELL (Arc 3 S1 — the fold, wholesale): the one-surface sidebar replaces the icon rail
// app-wide. Workers/Chat/Drive keep their ROUTES; their nav seats are gone (Settings carries the
// Team + Knowledge doors). components/sidebar-nav.tsx is retired with the old shell.
import SidebarNav from '@/components/one/one-sidebar';
import { getMyWorkspace, getMyProfile } from '@/lib/workspace/features';
import { WorkspaceProvider } from '@/context/workspace-context';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';

export default async function MainLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Fetch sidebar + workspace data in parallel — no serial waterfalls. The profile +
  // workspace reads are React-cached, so the feature-guard on the page reuses them.
  const supabase = await createClient();
  const [profile, { data: connectionsData }, workspace] = await Promise.all([
    getMyProfile(user.id),
    supabase.from('connections').select('metadata').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: true }),
    getMyWorkspace(user.id, supabase),
  ]);

  const isSuperAdmin = profile?.is_super_admin === true;

  // Orphan (no workspace) → /onboarding for new users. Superadmins bypass.
  if (!workspace && !isSuperAdmin) {
    redirect('/onboarding');
  }

  // Suspended / deleting workspace → /suspended. Superadmins bypass.
  if (workspace && workspace.status !== 'active' && !isSuperAdmin) {
    redirect('/suspended');
  }

  const avatarUrl =
    (connectionsData ?? [])
      .map((c: any) => c.metadata?.picture)
      .find((p: any) => typeof p === 'string' && p.length > 0) ?? null;

  const features = workspace?.features ?? DEFAULT_FEATURES;

  return (
    <WorkspaceProvider workspace={workspace ?? null} isSuperAdmin={isSuperAdmin}>
      <div className="flex h-screen bg-neutral-50 overflow-hidden">
        <SidebarNav
          userEmail={user.email}
          avatarUrl={avatarUrl}
          isSuperAdmin={isSuperAdmin}
          features={features}
        />
        {children}
        {/* @modal parallel slot — filled only by the intercepting /item/[id] route (modal over Home) */}
        {modal}
      </div>
    </WorkspaceProvider>
  );
}
