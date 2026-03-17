import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';

// GET /api/company/members — list members of the current user's company
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: members } = await adminClient
    .from('company_members')
    .select('user_id, role')
    .eq('company_id', company.id)
    .eq('status', 'active');

  if (!members?.length) return NextResponse.json({ members: [] });

  const userIds = members.map((m: any) => m.user_id);
  // Use adminClient for profiles — RLS only allows reading own row
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);

  const { data: identities } = await adminClient
    .from('context_profiles')
    .select('user_id, profile_data')
    .in('user_id', userIds)
    .eq('profile_type', 'identity');

  const identityMap: Record<string, any> = {};
  for (const i of identities ?? []) identityMap[i.user_id] = i.profile_data;

  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) nameMap[p.id] = p.full_name ?? 'Unknown';

  const result = members.map((m: any) => ({
    id: m.user_id,
    full_name: nameMap[m.user_id] ?? 'Unknown',
    role: m.role,
    department: identityMap[m.user_id]?.department,
  }));

  return NextResponse.json({ members: result });
}

// PATCH /api/company/members — change a member's role
// Body: { userId: string, role: 'admin' | 'member' }
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId, role } = await request.json();
  if (!userId || !['admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  // Cannot demote the owner
  const { data: target } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', company.id)
    .eq('user_id', userId)
    .single();

  if (target?.role === 'owner') {
    return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 });
  }

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await adminClient
    .from('company_members')
    .update({ role })
    .eq('company_id', company.id)
    .eq('user_id', userId);

  return NextResponse.json({ ok: true });
}

// DELETE /api/company/members — remove a member
// Body: { userId: string }
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });

  // Allow self-removal OR admin removing others
  const isSelf = userId === user.id;
  const isAdmin = company.role === 'owner' || company.role === 'admin';
  if (!isSelf && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Cannot remove the owner
  if (!isSelf) {
    const { data: target } = await supabase
      .from('company_members')
      .select('role')
      .eq('company_id', company.id)
      .eq('user_id', userId)
      .single();
    if (target?.role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 });
    }
  }

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await adminClient
    .from('company_members')
    .delete()
    .eq('company_id', company.id)
    .eq('user_id', userId);

  // Clear company_id on profile if removing self
  if (isSelf) {
    await adminClient.from('profiles').update({ company_id: null }).eq('id', userId);
  }

  return NextResponse.json({ ok: true });
}
