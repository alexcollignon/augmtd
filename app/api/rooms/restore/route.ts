import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 10;

// POST /api/rooms/restore — UNDO a conversation delete (speak-consequence law, Aug 7: every
// conversation verb has a visible way back). A chat delete ARCHIVES its turns in one batch
// (one shared archived_at); restore un-archives the most recent batch, and the conversation
// reappears in Recent/All exactly as it was. { key: 'chat:<uuid>' }.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { key?: string };
    const key = String(body.key ?? '');
    if (!key.startsWith('chat:')) return NextResponse.json({ error: 'key (chat:*) required' }, { status: 400 });

    const { data: latest } = await supabase.from('room_turns')
      .select('archived_at').eq('user_id', user.id).eq('room_key', key)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false }).limit(1).maybeSingle();
    if (!latest?.archived_at) return NextResponse.json({ error: 'nothing to restore' }, { status: 404 });

    const { data: restored, error: upErr } = await supabase.from('room_turns')
      .update({ archived_at: null })
      .eq('user_id', user.id).eq('room_key', key).eq('archived_at', latest.archived_at)
      .select('id');
    if (upErr) throw upErr;
    return NextResponse.json({ ok: true, restored: restored?.length ?? 0 });
  } catch (e) {
    console.error('[rooms/restore]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
