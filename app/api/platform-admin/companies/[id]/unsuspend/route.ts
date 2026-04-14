import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/platform-admin/companies/[id]/unsuspend
// Restores workspace to 'active' and reactivates all member rows.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const adminClient = await getAdminClient();

  // Only allow suspended → active (not deleting).
  const { data: workspace, error: wsErr } = await adminClient
    .from('companies')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('status', 'suspended')
    .select('id, name')
    .maybeSingle();

  if (wsErr) {
    console.error('[Unsuspend] error:', wsErr);
    return NextResponse.json({ error: 'Failed to unsuspend workspace' }, { status: 500 });
  }
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not suspended or not found' }, { status: 409 });
  }

  const { count: reactivated } = await adminClient
    .from('company_members')
    .update({ status: 'active' }, { count: 'exact' })
    .eq('company_id', id)
    .eq('status', 'suspended');

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.WORKSPACE_UNSUSPEND,
    targetType: 'workspace',
    targetId: id,
    workspaceId: id,
    metadata: { workspaceName: workspace.name, reactivatedMembers: reactivated ?? 0 },
  });

  return NextResponse.json({ ok: true, reactivatedMembers: reactivated ?? 0 });
}
