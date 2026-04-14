import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await request.json();
  if (!code?.trim()) return NextResponse.json({ error: 'Code required' }, { status: 400 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Case-insensitive lookup via ilike
  const { data: company } = await adminClient
    .from('companies')
    .select('id, name, slug, plan, type, status')
    .ilike('join_code', code.trim())
    .maybeSingle();

  if (!company) return NextResponse.json({ error: 'Invalid code' }, { status: 404 });
  if (company.status !== 'active') {
    return NextResponse.json({ error: 'This workspace is not accepting new members' }, { status: 403 });
  }

  // Source of truth: active company_members row. `profiles.company_id` is
  // just a cache and may be stale.
  const { data: existingMembership } = await adminClient
    .from('company_members')
    .select('id, company_id, companies(type)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle() as { data: { id: string; company_id: string; companies: { type: string } | { type: string }[] | null } | null };

  if (existingMembership) {
    if (existingMembership.company_id === company.id) {
      return NextResponse.json({ error: 'You are already a member of this workspace' }, { status: 409 });
    }
    const existingType = Array.isArray(existingMembership.companies)
      ? existingMembership.companies[0]?.type
      : existingMembership.companies?.type;
    // Special case: a user grandfathered into AUGMTD internal can be moved
    // into another workspace by redeeming a code. Any other active membership
    // must be handled by an admin.
    if (existingType !== 'internal') {
      return NextResponse.json({ error: 'You are already a member of a workspace. Ask an admin to move you.' }, { status: 409 });
    }
    // Remove the internal membership so the unique (company_id, user_id)
    // constraint doesn't block the new one.
    await adminClient
      .from('company_members')
      .delete()
      .eq('id', existingMembership.id);
  }

  // Add member
  const { error: memberErr } = await adminClient
    .from('company_members')
    .insert({ company_id: company.id, user_id: user.id, role: 'member', status: 'active' });

  if (memberErr) {
    if (memberErr.code === '23505') return NextResponse.json({ error: 'Already a member' }, { status: 409 });
    console.error('[join] member insert error:', memberErr);
    return NextResponse.json({ error: 'Failed to join' }, { status: 500 });
  }

  // Upsert profile — creates one if the signup trigger hasn't fired yet.
  await adminClient
    .from('profiles')
    .upsert(
      { id: user.id, email: user.email, company_id: company.id, needs_join: false },
      { onConflict: 'id' }
    );

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.MEMBER_JOIN_VIA_CODE,
    targetType: 'member',
    targetId: user.id,
    workspaceId: company.id,
    metadata: { workspaceName: company.name, workspaceType: company.type },
  });

  return NextResponse.json({ company });
}
