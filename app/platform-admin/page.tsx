import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import PlatformAdminClient from './platform-admin-client';
import { isSuperAdmin } from '@/lib/company/is-super-admin';

export default async function PlatformAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!await isSuperAdmin(user.id, supabase)) redirect('/inbox');

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: companies } = await adminClient
    .from('companies')
    .select('id, name, slug, plan, status, created_at')
    .order('created_at', { ascending: false });

  const { data: memberCounts } = await adminClient
    .from('company_members')
    .select('company_id')
    .eq('status', 'active');

  const countMap: Record<string, number> = {};
  (memberCounts ?? []).forEach((m: any) => {
    countMap[m.company_id] = (countMap[m.company_id] ?? 0) + 1;
  });

  const companiesWithCount = (companies ?? []).map((c: any) => ({
    ...c,
    member_count: countMap[c.id] ?? 0,
  }));

  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden">
      <SidebarNav userEmail={user.email} />
      <PlatformAdminClient initialCompanies={companiesWithCount} />
    </div>
  );
}
