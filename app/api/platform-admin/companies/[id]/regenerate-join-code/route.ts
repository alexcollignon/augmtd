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

// POST /api/platform-admin/companies/[id]/regenerate-join-code
// Rotates the workspace's 8-char join code. Old code stops working immediately.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const adminClient = await getAdminClient();

  const { data: before } = await adminClient
    .from('companies')
    .select('name, join_code')
    .eq('id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  // Loop until we get a unique code
  let newCode: string | null = null;
  for (let tries = 0; tries < 10; tries++) {
    const { data: candidate } = await adminClient.rpc('generate_join_code') as { data: string | null };
    if (!candidate) break;
    const { data: existing } = await adminClient
      .from('companies')
      .select('id')
      .eq('join_code', candidate)
      .maybeSingle();
    if (!existing) {
      newCode = candidate;
      break;
    }
  }

  if (!newCode) {
    return NextResponse.json({ error: 'Could not generate unique code' }, { status: 500 });
  }

  const { error } = await adminClient
    .from('companies')
    .update({ join_code: newCode })
    .eq('id', id);

  if (error) {
    console.error('[regenerate-join-code] error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.WORKSPACE_REGEN_CODE,
    targetType: 'workspace',
    targetId: id,
    workspaceId: id,
    metadata: {
      workspaceName: before.name,
      oldCodeMasked: before.join_code?.slice(0, 2) + '***',
    },
  });

  return NextResponse.json({ ok: true, join_code: newCode });
}
