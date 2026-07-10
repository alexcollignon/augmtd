import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET    /api/projects/[id]  → one project.
// PATCH  /api/projects/[id]  → update name/description/goals/rules/status/sort_order/color.
// DELETE /api/projects/[id]  → delete (ON DELETE SET NULL un-clusters the atoms; never deletes work).

const cleanList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data, error: e } = await supabase
    .from('projects')
    .select('id, name, description, status, goals, rules, color, auto, sort_order, created_at, updated_at')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (e || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ project: data });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if ('description' in body) patch.description = body.description ? String(body.description).slice(0, 2000) : null;
  if ('goals' in body) patch.goals = cleanList(body.goals);
  if ('rules' in body) patch.rules = cleanList(body.rules);
  if (typeof body.color === 'string') patch.color = body.color.slice(0, 24);
  if (body.status === 'active' || body.status === 'archived') patch.status = body.status;
  if (typeof body.sort_order === 'number') patch.sort_order = body.sort_order;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });

  const { data, error: e } = await supabase
    .from('projects').update(patch).eq('id', id).eq('user_id', user.id)
    .select('id, name, description, status, goals, rules, color, auto, sort_order, created_at, updated_at').maybeSingle();
  if (e || !data) return NextResponse.json({ error: e?.message || 'Not found' }, { status: e ? 500 : 404 });
  return NextResponse.json({ project: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { error: e } = await supabase.from('projects').delete().eq('id', id).eq('user_id', user.id);
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
