import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { DEFAULT_FEATURES_FOR_TYPE, normalizeFeatures, type WorkspaceType } from '@/lib/workspace/types';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';

const VALID_TYPES: WorkspaceType[] = ['company', 'beta', 'pilot', 'internal'];
const VALID_PLANS = ['starter', 'growth', 'enterprise'];

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/platform-admin/companies — list all workspaces with member count
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const adminClient = await getAdminClient();

  const { data: companies } = await adminClient
    .from('companies')
    .select('id, name, slug, plan, type, status, features, join_code, settings, created_at')
    .order('created_at', { ascending: false });

  const { data: memberCounts } = await adminClient
    .from('company_members')
    .select('company_id')
    .eq('status', 'active');

  const countMap: Record<string, number> = {};
  (memberCounts ?? []).forEach((m: any) => {
    countMap[m.company_id] = (countMap[m.company_id] ?? 0) + 1;
  });

  const result = (companies ?? []).map((c: any) => ({
    ...c,
    features: normalizeFeatures(c.features),
    member_count: countMap[c.id] ?? 0,
    meeting_assistant: c.settings?.meeting_assistant ?? true,
  }));

  return NextResponse.json({ companies: result });
}

// POST /api/platform-admin/companies — create workspace (no owner invite; manage users after they sign in)
// Body: { name, plan?, type? }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { name, plan = 'starter', type = 'company' } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Workspace name required' }, { status: 400 });
  if (!VALID_PLANS.includes(plan)) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 });

  const adminClient = await getAdminClient();

  // Generate unique slug
  const baseSlug = toSlug(name.trim());
  let slug = baseSlug;
  let attempt = 0;
  while (true) {
    const { data: existing } = await adminClient.from('companies').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  // Generate join code via the SQL helper (loop until unique)
  let joinCode: string | null = null;
  for (let tries = 0; tries < 10; tries++) {
    const { data: codeRows } = await adminClient.rpc('generate_join_code') as { data: string | null };
    const candidate = typeof codeRows === 'string' ? codeRows : null;
    if (!candidate) break;
    const { data: existing } = await adminClient.from('companies').select('id').eq('join_code', candidate).maybeSingle();
    if (!existing) {
      joinCode = candidate;
      break;
    }
  }
  if (!joinCode) {
    return NextResponse.json({ error: 'Could not generate join code' }, { status: 500 });
  }

  const features = DEFAULT_FEATURES_FOR_TYPE[type as WorkspaceType];

  const { data: company, error: companyErr } = await adminClient
    .from('companies')
    .insert({
      name: name.trim(),
      slug,
      plan,
      type,
      status: 'active',
      features,
      join_code: joinCode,
    })
    .select()
    .single();

  if (companyErr || !company) {
    console.error('[PlatformAdmin] create workspace error:', companyErr);
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }

  const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/join/${joinCode}`;

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.WORKSPACE_CREATE,
    targetType: 'workspace',
    targetId: company.id,
    workspaceId: company.id,
    metadata: { name: company.name, type, plan },
  });

  console.log(`[PlatformAdmin] Created workspace "${company.name}" (${type}) — join code: ${joinCode}`);

  return NextResponse.json({
    company: { ...company, features: normalizeFeatures(company.features) },
    joinUrl,
  });
}
