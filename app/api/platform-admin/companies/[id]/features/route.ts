import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { FEATURE_KEYS, normalizeFeatures, type FeatureKey } from '@/lib/workspace/types';

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// PATCH /api/platform-admin/companies/[id]/features
// Body: partial features object, e.g. { email: false } or { drive: true, agents: false }
// Merges with existing features JSONB.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json() as Record<string, unknown>;
  const patch: Partial<Record<FeatureKey, boolean>> = {};
  for (const key of FEATURE_KEYS) {
    if (typeof body[key] === 'boolean') {
      patch[key] = body[key] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid feature keys provided' }, { status: 400 });
  }

  const adminClient = await getAdminClient();

  const { data: before } = await adminClient
    .from('companies')
    .select('features, name')
    .eq('id', id)
    .maybeSingle();

  if (!before) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const beforeFeatures = normalizeFeatures(before.features);
  const afterFeatures = { ...beforeFeatures, ...patch };

  const { error } = await adminClient
    .from('companies')
    .update({ features: afterFeatures })
    .eq('id', id);

  if (error) {
    console.error('[Features PATCH] error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.FEATURE_TOGGLE,
    targetType: 'workspace',
    targetId: id,
    workspaceId: id,
    metadata: {
      workspaceName: before.name,
      before: beforeFeatures,
      after: afterFeatures,
      patch,
    },
  });

  return NextResponse.json({ ok: true, features: afterFeatures });
}
