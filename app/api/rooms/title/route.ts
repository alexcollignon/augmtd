import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 10;

// POST /api/rooms/title — RENAME a conversation (chat rooms; owner ask, Aug 7: conversations are
// manageable). The custom title lives in item_plans (kind 'room_title', keyed by room key) and
// overrides the first-ask auto-title everywhere the room lists. { key: 'chat:<uuid>', title }.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { key?: string; title?: string };
    const key = String(body.key ?? '');
    const title = String(body.title ?? '').trim().slice(0, 80);
    if (!key.startsWith('chat:') || !title) {
      return NextResponse.json({ error: 'key (chat:*) and title required' }, { status: 400 });
    }
    const { error: upErr } = await supabase.from('item_plans').upsert({
      user_id: user.id, kind: 'room_title', entity_id: key,
      tasks: { title }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' });
    if (upErr) throw upErr;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[rooms/title]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
