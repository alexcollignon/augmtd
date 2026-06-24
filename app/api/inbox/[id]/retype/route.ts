import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/inbox/[id]/retype — the user corrects an item's type. Persists type_override (which
// classifyItem honours over the AI) and logs a learning_signal so the classifier improves.
const VALID = new Set(['needs_reply', 'to_do', 'waiting_on', 'meeting', 'fyi']);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { type } = (await request.json()) as { type?: string };
  if (!type || !VALID.has(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });

  const { data: item } = await supabase.from('inbox_items')
    .select('work_state, type_override').eq('id', id).eq('user_id', user.id).single();
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error: upErr } = await supabase.from('inbox_items')
    .update({ type_override: type }).eq('id', id).eq('user_id', user.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await supabase.from('learning_signals').insert({
    user_id: user.id,
    inbox_item_id: id,
    signal_type: 'type_corrected',
    signal_data: { to: type, from_override: item.type_override ?? null, ai_work_state: item.work_state, corrected_at: new Date().toISOString() },
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, type });
}
