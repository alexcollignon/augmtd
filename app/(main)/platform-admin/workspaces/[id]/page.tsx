import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { WorkspaceDetail } from '@/components/platform-admin/workspace-detail';

// ─── THE WORKSPACE DETAIL PAGE (the platform-admin redesign, Aug 10) ─────────────────────────
// One page per workspace, information architecture aligned to the CURRENT product: identity ·
// access & entry (the sovereign door lives here) · branding · features · members · danger.
// The list page stays the index; depth lives here.

export const dynamic = 'force-dynamic';

export default async function WorkspaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!await isSuperAdmin(user.id, supabase)) redirect('/home');

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: company } = await admin
    .from('companies')
    .select('id, name, slug, plan, type, status, features, join_code, settings, ai_tier, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!company) notFound();

  const { count } = await admin
    .from('company_members')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', id)
    .eq('status', 'active');

  return <WorkspaceDetail company={{ ...company, member_count: count ?? 0 } as never} />;
}
