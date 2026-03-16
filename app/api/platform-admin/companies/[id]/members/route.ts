import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';

// GET /api/platform-admin/companies/[id]/members — view any company's members
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: members } = await adminClient
    .from('company_members')
    .select('id, user_id, role, status, joined_at, last_active_at')
    .eq('company_id', id)
    .order('joined_at', { ascending: true });

  const userIds = (members ?? []).map((m: any) => m.user_id);

  // Get full names from profiles
  const { data: profiles } = userIds.length > 0
    ? await adminClient.from('profiles').select('id, full_name').in('id', userIds)
    : { data: [] };
  const fullNameMap: Record<string, string | null> = {};
  (profiles ?? []).forEach((p: any) => { fullNameMap[p.id] = p.full_name ?? null; });

  // Get emails from auth
  const { data: authUsers } = await adminClient.auth.admin.listUsers();
  const emailMap: Record<string, string> = {};
  (authUsers?.users ?? []).forEach((u: any) => { emailMap[u.id] = u.email ?? ''; });

  const result = (members ?? []).map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    status: m.status,
    joined_at: m.joined_at,
    last_active_at: m.last_active_at,
    full_name: fullNameMap[m.user_id] ?? null,
    email: emailMap[m.user_id] ?? '',
  }));

  // Pending invitations
  const { data: invitations } = await adminClient
    .from('company_invitations')
    .select('id, email, role, token, status, created_at, expires_at')
    .eq('company_id', id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const pendingInvites = (invitations ?? []).map((inv: any) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    token: inv.token,
    inviteUrl: `${appUrl}/company/invite/${inv.token}`,
    created_at: inv.created_at,
    expires_at: inv.expires_at,
  }));

  return NextResponse.json({ members: result, pendingInvites });
}
