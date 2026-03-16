import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';
import { randomUUID } from 'crypto';

// GET /api/company/invitations — list pending invitations (admin only)
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data } = await supabase
    .from('company_invitations')
    .select('id, email, role, status, expires_at, created_at')
    .eq('company_id', company.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return NextResponse.json({ invitations: data ?? [] });
}

// POST /api/company/invitations — create invitation
// Body: { email: string, role?: 'admin' | 'member' }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { email, role = 'member' } = await request.json();
  if (!email?.trim()) return NextResponse.json({ error: 'Email required' }, { status: 400 });
  if (!['admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if already a member
  const { data: authUsers } = await adminClient.auth.admin.listUsers();
  const existingUser = authUsers?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    const { data: existing } = await adminClient
      .from('company_members')
      .select('id')
      .eq('company_id', company.id)
      .eq('user_id', existingUser.id)
      .maybeSingle();
    if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 409 });
  }

  // Revoke any existing pending invite for this email
  await adminClient
    .from('company_invitations')
    .update({ status: 'revoked' })
    .eq('company_id', company.id)
    .eq('email', email.toLowerCase())
    .eq('status', 'pending');

  const token = randomUUID().replace(/-/g, '');

  const { data: invitation, error: invErr } = await adminClient
    .from('company_invitations')
    .insert({
      company_id: company.id,
      invited_by: user.id,
      email: email.toLowerCase().trim(),
      role,
      token,
    })
    .select()
    .single();

  if (invErr) return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 });

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/company/invite/${token}`;
  console.log(`[Company Invite] ${email} invited to ${company.name}: ${inviteUrl}`);

  return NextResponse.json({ invitation, inviteUrl });
}
