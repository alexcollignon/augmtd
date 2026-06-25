import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH — update a rule (toggle, reorder, edit). DELETE — remove it.
const FIELDS = ['name', 'enabled', 'priority', 'trigger', 'match_mode', 'conditions', 'ai_match', 'outcome'] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of FIELDS) if (f in body) update[f] = body[f];

  const { data, error: upErr } = await supabase.from('inbox_rules')
    .update(update).eq('id', id).eq('user_id', user.id).select('*').single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ rule: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { error: delErr } = await supabase.from('inbox_rules').delete().eq('id', id).eq('user_id', user.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
