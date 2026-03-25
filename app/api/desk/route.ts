import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { mapDeskItem } from '@/lib/types/desk';

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('desk_items')
    .select('*')
    .eq('user_id', user.id)
    .order('kanban_column')
    .order('position');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: (data ?? []).map(mapDeskItem) });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { title, kanban_column = 'todo' } = body as { title: string; kanban_column?: string };

  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 });

  const { data, error } = await supabase
    .from('desk_items')
    .insert({
      user_id: user.id,
      source_type: 'manual',
      source_id: crypto.randomUUID(),
      kanban_column,
      title: title.trim(),
      position: 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: mapDeskItem(data) }, { status: 201 });
}
