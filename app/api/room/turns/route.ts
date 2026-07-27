import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readRoomTurns, writeRoomTurn } from '@/lib/room/turns';

export const maxDuration = 15;

// THE ONE ROOM — R1 (docs/one-room-plan.md). The room conversation's client API.
//   GET  ?key=<roomKey>            → { turns } (oldest→newest, last 50)
//   POST { roomKey, role, text, refs?, dedupeKey? } → persist a turn
// RLS scopes everything to the caller. The CLIENT never sets `author` — coworker attribution is
// written only by server-side engine paths (delegation report-backs, the prepare pass).

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const key = request.nextUrl.searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
    const turns = await readRoomTurns(supabase, user.id, key);
    return NextResponse.json({ turns });
  } catch (e) {
    console.error('[room/turns GET]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

// DELETE ?key=<roomKey> — "Clear conversation" (promise fix): wipes the room's TURNS only. The
// brain's memory (entity state, links, ledger) is untouched — turns are narration, not memory.
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const key = request.nextUrl.searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
    await supabase.from('room_turns').delete().eq('user_id', user.id).eq('room_key', key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[room/turns DELETE]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json() as {
      roomKey?: string; role?: string; text?: string;
      refs?: Array<{ label: string; href: string | null }>; dedupeKey?: string;
    };
    if (!body.roomKey || (body.role !== 'user' && body.role !== 'system') || !body.text?.trim()) {
      return NextResponse.json({ error: 'roomKey, role (user|system), text required' }, { status: 400 });
    }
    await writeRoomTurn(supabase, user.id, body.roomKey, {
      role: body.role, text: body.text,
      refs: Array.isArray(body.refs) ? body.refs : undefined,
      dedupeKey: body.dedupeKey ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[room/turns POST]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
