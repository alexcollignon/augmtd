import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';

// Company goals — admin-only. See supabase/migrations/20260708c_company_goals.sql for the
// hard invariant: this data must never reach any employee-facing coworker context.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyWorkspace(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('company_goals')
    .select('id, kind, title, description, status, sort_order, created_at, updated_at')
    .eq('company_id', company.id)
    .eq('status', 'active')
    .order('kind', { ascending: false }) // 'north_star' always first
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[company/goals] list error:', error);
    return NextResponse.json({ error: 'Failed to load goals' }, { status: 500 });
  }

  return NextResponse.json({ goals: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyWorkspace(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : null;
  const kind = body?.kind === 'north_star' ? 'north_star' : 'goal';
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

  // New goals land at the end of the manual order.
  const { data: maxRow } = await supabase
    .from('company_goals')
    .select('sort_order')
    .eq('company_id', company.id)
    .eq('status', 'active')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('company_goals')
    .insert({ company_id: company.id, kind, title, description, created_by: user.id, sort_order: sortOrder })
    .select('id, kind, title, description, status, sort_order, created_at, updated_at')
    .single();

  if (error) {
    console.error('[company/goals] create error:', error);
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
  }

  return NextResponse.json({ goal: data });
}
