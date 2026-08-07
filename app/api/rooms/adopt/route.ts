import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { writeRoomTurn } from '@/lib/room/turns';

export const maxDuration = 15;

// THE SCOPE BINDING (Aug 7 rework — owner: "any conversation can get added/changed/removed to a
// project?"). v1 MOVED the chat's turns into the room, which made adoption one-way. v2 is a
// LINK: the conversation keeps its own key and turns; the binding (item_plans kind
// 'room_scope', keyed by the chat key) says which project it belongs to. File, RE-file, and
// UN-file are all one upsert/delete; the project room carries a dedupe-keyed seam narration
// that follows the binding (moves on re-file, disappears on un-file). Server truth — the panel
// reads the binding, never a local cache.
//   GET  ?key=chat:<uuid>                → { scope: { id, name } | null }
//   POST { roomKey, entityId }           → file / re-file
//   POST { roomKey, entityId: null }     → un-file
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const key = request.nextUrl.searchParams.get('key') ?? '';
    if (!key.startsWith('chat:')) return NextResponse.json({ scope: null });
    const { data } = await supabase.from('item_plans').select('tasks')
      .eq('user_id', user.id).eq('kind', 'room_scope').eq('entity_id', key).maybeSingle();
    const t = (data?.tasks ?? null) as { entityId?: string; entityName?: string } | null;
    return NextResponse.json({ scope: t?.entityId ? { id: t.entityId, name: t.entityName ?? '' } : null });
  } catch (e) {
    console.error('[rooms/adopt GET]', e);
    return NextResponse.json({ scope: null });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { roomKey?: string; entityId?: string | null };
    const roomKey = String(body.roomKey ?? '');
    const entityId = body.entityId ? String(body.entityId) : null;
    // Only a LOOSE CHAT room files — item/entity rooms already have a home (the room-door law).
    if (!roomKey.startsWith('chat:')) {
      return NextResponse.json({ error: 'roomKey (chat:*) required' }, { status: 400 });
    }

    // The prior binding — a re-file/un-file must retract the OLD room's seam narration.
    const { data: prior } = await supabase.from('item_plans').select('tasks')
      .eq('user_id', user.id).eq('kind', 'room_scope').eq('entity_id', roomKey).maybeSingle();
    const priorEntity = ((prior?.tasks ?? null) as { entityId?: string } | null)?.entityId ?? null;
    if (priorEntity && priorEntity !== entityId) {
      await supabase.from('room_turns').delete()
        .eq('user_id', user.id).eq('room_key', priorEntity).eq('dedupe_key', `adopt:${roomKey}`);
    }

    if (!entityId) {
      // UN-FILE: the conversation goes loose again; nothing else changes.
      await supabase.from('item_plans').delete()
        .eq('user_id', user.id).eq('kind', 'room_scope').eq('entity_id', roomKey);
      return NextResponse.json({ ok: true, scope: null });
    }

    const { data: ent } = await supabase.from('work_entities')
      .select('id, name').eq('id', entityId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!ent) return NextResponse.json({ error: 'project not found' }, { status: 404 });

    const { error: upErr } = await supabase.from('item_plans').upsert({
      user_id: user.id, kind: 'room_scope', entity_id: roomKey,
      tasks: { entityId: ent.id, entityName: ent.name, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' });
    if (upErr) throw upErr;

    // The seam narrates in the project room (deltas, not silence) — dedupe-keyed so it moves
    // with the binding instead of stacking.
    await writeRoomTurn(supabase, user.id, ent.id, {
      role: 'system',
      text: 'A Home conversation was filed into this project — its answers now ground here.',
      dedupeKey: `adopt:${roomKey}`,
    });

    return NextResponse.json({ ok: true, scope: { id: ent.id, name: ent.name } });
  } catch (e) {
    console.error('[rooms/adopt]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
