import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { writeRoomTurn } from '@/lib/room/turns';

export const maxDuration = 15;

// POST /api/rooms/adopt — THE ADOPTION CASCADE (one-surface § context controls): scoping a Home
// conversation to a project AFTER the fact moves everything it produced through the one
// membership machinery — its turns RE-HOME into the project room (the same law as a meeting
// move cascading its commitments; setItemMembership re-homes engine turns the same way). The
// conversation then LIVES in the project room: the room's rail shows it, and the Home panel
// keeps talking into the same key. { roomKey: 'chat:<uuid>', entityId } → { ok, moved }.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { roomKey?: string; entityId?: string };
    const roomKey = String(body.roomKey ?? '');
    const entityId = String(body.entityId ?? '');
    // Only a LOOSE CHAT room adopts — item/entity rooms already have a home (the room-door law).
    if (!roomKey.startsWith('chat:') || !entityId) {
      return NextResponse.json({ error: 'roomKey (chat:*) and entityId required' }, { status: 400 });
    }
    const { data: ent } = await supabase.from('work_entities')
      .select('id, name').eq('id', entityId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!ent) return NextResponse.json({ error: 'project not found' }, { status: 404 });

    const { data: moved, error: mvErr } = await supabase.from('room_turns')
      .update({ room_key: entityId })
      .eq('user_id', user.id).eq('room_key', roomKey)
      .select('id');
    if (mvErr) throw mvErr;

    // The seam narrates (deltas, not silence): the project room's story says where these turns
    // came from. Dedupe-keyed so a re-adopt of the same chat never repeats the line.
    await writeRoomTurn(supabase, user.id, entityId, {
      role: 'system',
      text: `Filed a Home conversation into this project (${moved?.length ?? 0} turns).`,
      dedupeKey: `adopt:${roomKey}`,
    });

    return NextResponse.json({ ok: true, moved: moved?.length ?? 0, name: ent.name });
  } catch (e) {
    console.error('[rooms/adopt]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
