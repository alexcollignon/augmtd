import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyWorkspace(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const updates: Record<string, string | null> = {};
  if (typeof body?.title === 'string' && body.title.trim()) updates.title = body.title.trim();
  if (typeof body?.description === 'string') updates.description = body.description.trim() || null;
  if (body?.status === 'active' || body?.status === 'archived') updates.status = body.status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('company_goals')
    .update(updates)
    .eq('id', id)
    .eq('company_id', company.id)
    .select('id, kind, title, description, status, sort_order, created_at, updated_at')
    .single();

  if (error) {
    console.error('[company/goals/[id]] update error:', error);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }

  return NextResponse.json({ goal: data });
}
