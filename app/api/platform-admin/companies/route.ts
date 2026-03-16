import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { randomUUID } from 'crypto';

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

// GET /api/platform-admin/companies — list all companies with member count
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const adminClient = await getAdminClient();

  const { data: companies } = await adminClient
    .from('companies')
    .select('id, name, slug, plan, status, created_at')
    .order('created_at', { ascending: false });

  // Get member counts per company
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
    member_count: countMap[c.id] ?? 0,
  }));

  return NextResponse.json({ companies: result });
}

// POST /api/platform-admin/companies — create company + fire owner invite
// Body: { name: string, plan: string, ownerEmail: string }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { name, plan = 'starter', ownerEmail } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Company name required' }, { status: 400 });
  if (!ownerEmail?.trim()) return NextResponse.json({ error: 'Owner email required' }, { status: 400 });
  if (!['starter', 'growth', 'enterprise'].includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

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

  // Create company (service role — bypasses RLS)
  const { data: company, error: companyErr } = await adminClient
    .from('companies')
    .insert({ name: name.trim(), slug, plan, status: 'active' })
    .select()
    .single();

  if (companyErr || !company) {
    console.error('[PlatformAdmin] create company error:', companyErr);
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 });
  }

  // Create owner invitation
  const token = randomUUID().replace(/-/g, '');
  const { error: invErr } = await adminClient
    .from('company_invitations')
    .insert({
      company_id: company.id,
      invited_by: user.id,
      email: ownerEmail.toLowerCase().trim(),
      role: 'owner',
      token,
    });

  if (invErr) {
    console.error('[PlatformAdmin] invite error:', invErr);
    // Company was created — return it with a warning
    return NextResponse.json({ company, inviteUrl: null, warning: 'Company created but invite failed' });
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/company/invite/${token}`;
  console.log(`[PlatformAdmin] Created company "${company.name}" — owner invite: ${inviteUrl}`);

  return NextResponse.json({ company, inviteUrl });
}
