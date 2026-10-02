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
import { UserZoneProvider } from '@/context/user-zone-context';
import { servedUserTimezone } from '@/lib/utils/user-time';

export default async function MainLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Fetch sidebar + workspace data in parallel — no serial waterfalls. The profile +
  // workspace reads are React-cached, so the feature-guard on the page reuses them.
  const supabase = await createClient();
  // THE READER'S ZONE (law `one-reader-zone`): served once, from the server's one reader, so every
  // client surface renders event times in the same zone Home's server-composed times use.
  const [profile, { data: connectionsData }, workspace, userZone] = await Promise.all([
    getMyProfile(user.id),
    supabase.from('connections').select('metadata').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: true }),
    getMyWorkspace(user.id, supabase),
    servedUserTimezone(supabase, user.id).catch(() => null),
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
  // THE SOVEREIGN DOOR: co-brand + safe-data mark ride the workspace row (settings.branding;
  // email feature OFF = the corporate mode).
  const branding = ((workspace?.settings ?? {}) as { branding?: { logo_url?: string } }).branding ?? {};
  const sovereign = features.email === false;

  return (
    <WorkspaceProvider workspace={workspace ?? null} isSuperAdmin={isSuperAdmin}>
      <UserZoneProvider zone={userZone}>
      {/* Phone width stacks the sidebar's slim top bar over the page (the sidebar is a drawer there). */}
      {/* THE ONE VIEWER MAKES ROOM (law `one-component-one-behaviour`): while an artifact is open on
          desktop the page pads by the viewer's width (components/shared/artifact-viewer.tsx sets
          --viewer-w), so the conversation stays beside it — never under it. Phone: a full sheet. */}
      <div className="flex flex-col md:flex-row h-[100dvh] md:h-screen bg-neutral-50 overflow-hidden lg:pr-[var(--viewer-w,0px)]">
        <SidebarNav
          userEmail={user.email}
          avatarUrl={avatarUrl}
          isSuperAdmin={isSuperAdmin}
          features={features}
          brandLogo={branding.logo_url ?? null}
          brandName={workspace?.name ?? null}
          sovereign={sovereign}
        />
        {children}
        {/* @modal parallel slot — filled only by the intercepting /item/[id] route (modal over Home) */}
        {modal}
      </div>
      </UserZoneProvider>
    </WorkspaceProvider>
  );
}
