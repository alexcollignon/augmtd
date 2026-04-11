import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SidebarNav from '@/components/sidebar-nav';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Fetch sidebar data in parallel — no serial waterfalls
  const [{ data: tierData }, { data: profileData }, { data: connectionsData }] = await Promise.all([
    supabase.from('tenant_configs').select('tier').eq('user_id', user.id).maybeSingle(),
    supabase.from('profiles').select('is_super_admin').eq('id', user.id).single(),
    supabase.from('connections').select('metadata').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: true }),
  ]);

  const tier = (tierData?.tier ?? 'standard') as 'standard' | 'private_shared' | 'bedrock_private' | 'bedrock_optimised';
  const isSuperAdmin = profileData?.is_super_admin === true;
  const avatarUrl =
    (connectionsData ?? [])
      .map((c: any) => c.metadata?.picture)
      .find((p: any) => typeof p === 'string' && p.length > 0) ?? null;

  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden">
      <SidebarNav
        userEmail={user.email}
        avatarUrl={avatarUrl}
        tier={tier}
        isSuperAdmin={isSuperAdmin}
      />
      {children}
    </div>
  );
}
