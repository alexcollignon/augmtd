import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { WorkspaceType } from '@/lib/workspace/types';
import type { TierType } from '@/lib/ai/types';

const VALID_TYPES: WorkspaceType[] = ['company', 'beta', 'pilot', 'internal'];
const VALID_PLANS = ['starter', 'growth', 'enterprise'];
const VALID_TIERS: (TierType | null)[] = ['standard', 'professional', 'private_shared', 'bedrock_private', 'bedrock_optimised', 'private_client', 'on_prem', null];

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// PATCH /api/platform-admin/companies/[id] — update name, plan, type, status
// For suspend/unsuspend use the dedicated /suspend or /unsuspend routes —
// they also cascade to member statuses. This PATCH only accepts active⇄active.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const updates: Record<string, string | null> = {};

  if (body.name?.trim()) updates.name = body.name.trim();
  if (body.plan) {
    if (!VALID_PLANS.includes(body.plan)) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    updates.plan = body.plan;
  }
  if (body.type) {
    if (!VALID_TYPES.includes(body.type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    updates.type = body.type;
  }
  if ('ai_tier' in body) {
    if (!VALID_TIERS.includes(body.ai_tier)) return NextResponse.json({ error: 'Invalid ai_tier' }, { status: 400 });
    updates.ai_tier = body.ai_tier ?? null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const adminClient = await getAdminClient();

  // Capture before-state for audit
  const { data: before } = await adminClient
    .from('companies')
    .select('id, name, plan, type, status')
    .eq('id', id)
    .maybeSingle();

  const { error } = await adminClient.from('companies').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.WORKSPACE_UPDATE,
    targetType: 'workspace',
    targetId: id,
    workspaceId: id,
    metadata: { before, updates },
  });

  return NextResponse.json({ ok: true });
}
