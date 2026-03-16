import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';

// GET /api/company — returns current user's company + members + pending invitations
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ company: null, members: [], invitations: [] });

  // Members with profile data
  const { data: members } = await supabase
    .from('company_members')
    .select('id, user_id, role, status, joined_at, last_active_at, profiles(email:id, full_name)')
    .eq('company_id', company.id)
    .eq('status', 'active')
    .order('joined_at', { ascending: true });

  // Pending invitations (admin/owner only)
  let invitations: unknown[] = [];
  if (company.role === 'owner' || company.role === 'admin') {
    const { data } = await supabase
      .from('company_invitations')
      .select('id, email, role, status, expires_at, created_at')
      .eq('company_id', company.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    invitations = data ?? [];
  }

  // Normalise profile join: profiles comes back as an object, pull email from auth
  const normalizedMembers = (members ?? []).map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    status: m.status,
    joined_at: m.joined_at,
    last_active_at: m.last_active_at,
    full_name: m.profiles?.full_name ?? null,
  }));

  // Fetch emails for members via admin client
  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const userIds = normalizedMembers.map((m: any) => m.user_id);
  const { data: authUsers } = await adminClient.auth.admin.listUsers();
  const emailMap: Record<string, string> = {};
  (authUsers?.users ?? []).filter((u: any) => userIds.includes(u.id)).forEach((u: any) => {
    emailMap[u.id] = u.email ?? '';
  });

  const membersWithEmail = normalizedMembers.map((m: any) => ({
    ...m,
    email: emailMap[m.user_id] ?? '',
  }));

  return NextResponse.json({ company, members: membersWithEmail, invitations });
}
