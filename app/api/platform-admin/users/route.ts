import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const [profilesRes, membersRes, authRes] = await Promise.all([
    adminClient.from('profiles').select('id, full_name, is_super_admin, attendee_enabled, created_at').order('created_at', { ascending: false }),
    adminClient.from('company_members').select('user_id, role, company_id, companies(id, name, plan)').eq('status', 'active'),
    adminClient.auth.admin.listUsers(),
  ]);

  const emailMap: Record<string, string> = {};
  (authRes.data?.users ?? []).forEach((u: any) => { emailMap[u.id] = u.email ?? ''; });

  const memberMap: Record<string, { company_id: string; company_name: string; company_plan: string; role: string }> = {};
  (membersRes.data ?? []).forEach((m: any) => {
    memberMap[m.user_id] = {
      company_id: m.company_id,
      company_name: (m.companies as any)?.name ?? '',
      company_plan: (m.companies as any)?.plan ?? '',
      role: m.role,
    };
  });

  const users = (profilesRes.data ?? []).map((p: any) => ({
    id: p.id,
    email: emailMap[p.id] ?? '',
    full_name: p.full_name ?? null,
    is_super_admin: p.is_super_admin ?? false,
    attendee_enabled: p.attendee_enabled ?? true,
    created_at: p.created_at,
    ...(memberMap[p.id] ?? { company_id: null, company_name: null, company_plan: null, role: null }),
  }));

  return NextResponse.json({ users });
}
