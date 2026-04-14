import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';

const VALID_ROLES = ['owner', 'admin', 'member'] as const;
type Role = (typeof VALID_ROLES)[number];

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// PATCH /api/platform-admin/companies/[id]/members/[userId]/role
// Body: { role: 'owner' | 'admin' | 'member' }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id: workspaceId, userId: targetUserId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { role } = await request.json() as { role?: Role };
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const adminClient = await getAdminClient();

  const { data: before } = await adminClient
    .from('company_members')
    .select('id, role')
    .eq('company_id', workspaceId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (!before) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const { error } = await adminClient
    .from('company_members')
    .update({ role })
    .eq('id', before.id);

  if (error) {
    console.error('[role PATCH] error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGE,
    targetType: 'member',
    targetId: targetUserId,
    workspaceId,
    metadata: { from: before.role, to: role },
  });

  return NextResponse.json({ ok: true, role });
}
