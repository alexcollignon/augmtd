import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/company/invitations/[token] — validate token, return company info (no auth required)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: invite } = await adminClient
    .from('company_invitations')
    .select('id, email, role, status, expires_at, companies(id, name, slug)')
    .eq('token', token)
    .single();

  if (!invite) return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 });
  if (invite.status !== 'pending') return NextResponse.json({ error: 'Invitation already used or revoked' }, { status: 410 });
  if (new Date(invite.expires_at) < new Date()) return NextResponse.json({ error: 'Invitation expired' }, { status: 410 });

  const company = Array.isArray(invite.companies) ? invite.companies[0] : invite.companies;

  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    company: { id: company?.id, name: company?.name, slug: company?.slug },
  });
}

// POST /api/company/invitations/[token] — accept invitation (auth required)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: invite } = await adminClient
    .from('company_invitations')
    .select('id, company_id, email, role, status, expires_at, companies(features)')
    .eq('token', token)
    .single();

  if (!invite) return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 });
  if (invite.status !== 'pending') return NextResponse.json({ error: 'Invitation already used' }, { status: 410 });
  if (new Date(invite.expires_at) < new Date()) return NextResponse.json({ error: 'Invitation expired' }, { status: 410 });

  // Check user is not already in this company
  const { data: existing } = await adminClient
    .from('company_members')
    .select('id')
    .eq('company_id', invite.company_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 409 });

  // Add to company_members
  const { error: memberErr } = await adminClient.from('company_members').insert({
    company_id: invite.company_id,
    user_id: user.id,
    role: invite.role,
    status: 'active',
  });

  if (memberErr) {
    console.error('[InviteAccept] company_members insert failed:', memberErr);
    return NextResponse.json({ error: 'Failed to join company' }, { status: 500 });
  }

  // Mark invitation accepted
  await adminClient.from('company_invitations').update({ status: 'accepted' }).eq('id', invite.id);

  // Enable meeting assistant by default if the workspace has meetings turned on.
  const companyFeatures = Array.isArray(invite.companies) ? invite.companies[0]?.features : (invite.companies as any)?.features;
  const meetingsEnabled = companyFeatures?.meetings !== false;
  if (meetingsEnabled) {
    await adminClient
      .from('profiles')
      .update({ attendee_enabled: true })
      .eq('id', user.id)
      .neq('attendee_enabled', true);
  }

  return NextResponse.json({ ok: true, companyId: invite.company_id });
}
