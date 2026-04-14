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

// POST /api/platform-admin/companies/[id]/suspend
// Sets workspace status to 'suspended' and cascades to all member rows.
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

  // Only allow active → suspended. Refuse if deleting.
  const { data: workspace, error: wsErr } = await adminClient
    .from('companies')
    .update({ status: 'suspended' })
    .eq('id', id)
    .eq('status', 'active')
    .select('id, name')
    .maybeSingle();

  if (wsErr) {
    console.error('[Suspend] error:', wsErr);
    return NextResponse.json({ error: 'Failed to suspend workspace' }, { status: 500 });
  }
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not active or not found' }, { status: 409 });
  }

  const { count: suspendedMembers } = await adminClient
    .from('company_members')
    .update({ status: 'suspended' }, { count: 'exact' })
    .eq('company_id', id)
    .eq('status', 'active');

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.WORKSPACE_SUSPEND,
    targetType: 'workspace',
    targetId: id,
    workspaceId: id,
    metadata: { workspaceName: workspace.name, suspendedMembers: suspendedMembers ?? 0 },
  });

  return NextResponse.json({ ok: true, suspendedMembers: suspendedMembers ?? 0 });
}
