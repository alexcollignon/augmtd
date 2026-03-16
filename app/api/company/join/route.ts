import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    .select('id, name, slug, plan, status')
    .ilike('join_code', code.trim())
    .maybeSingle();

  if (!company) return NextResponse.json({ error: 'Invalid code' }, { status: 404 });
  if (company.status !== 'active') {
    return NextResponse.json({ error: 'This company is not accepting new members' }, { status: 403 });
  }

  // Check user doesn't already have a company
  const { data: profile } = await adminClient
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single();

  if (profile?.company_id) {
    return NextResponse.json({ error: 'You are already a member of a company' }, { status: 409 });
  }

  // Add member
  const { error: memberErr } = await adminClient
    .from('company_members')
    .insert({ company_id: company.id, user_id: user.id, role: 'member', status: 'active' });

  if (memberErr) {
    if (memberErr.code === '23505') return NextResponse.json({ error: 'Already a member' }, { status: 409 });
    return NextResponse.json({ error: 'Failed to join' }, { status: 500 });
  }

  await adminClient.from('profiles').update({ company_id: company.id }).eq('id', user.id);

  return NextResponse.json({ company });
}
