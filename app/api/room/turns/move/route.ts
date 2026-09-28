import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { moveRoomSessionOut, moveRoomSessionBack } from '@/lib/room/turns';

export const maxDuration = 15;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/room/turns/move — W19.C · MOVE A PROJECT CHAT OUT (and back).
//   { key: <entityRoomKey>, session: <at> }                    → { chatKey } — the saved session's
//       chat turns become a live Home chat (`chat:<uuid>`); nothing else moves.
//   { key: <entityRoomKey>, session: <at>, undo: <chatKey> }   → the chat goes back into the
//       project as the saved session it was (same stamp).
// Both are CONDITIONAL CLAIMS inside lib/room/turns (one UPDATE filtered on the room key AND the
// stamp) — a second click finds nothing and changes nothing. RLS scopes every row to the caller.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { key?: string; session?: string; undo?: string };
    const key = String(body.key ?? '');
    const session = String(body.session ?? '');
    if (!key || !session) return NextResponse.json({ error: 'key and session required' }, { status: 400 });
    if (body.undo) {
      const n = await moveRoomSessionBack(supabase, user.id, String(body.undo), key, session);
      if (!n) return NextResponse.json({ error: 'nothing to move back' }, { status: 404 });
      return NextResponse.json({ ok: true, moved: n });
    }
    const r = await moveRoomSessionOut(supabase, user.id, key, session);
    if (!r) return NextResponse.json({ error: 'nothing to move' }, { status: 404 });
    return NextResponse.json({ ok: true, chatKey: r.chatKey, moved: r.moved });
  } catch (e) {
    console.error('[room/turns/move]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
