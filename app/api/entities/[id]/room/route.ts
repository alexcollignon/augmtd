// GET /api/entities/[id]/room — the PROJECT DOOR's rail read (just-works P7c-c2). Returns the same
// RailView shape the item deep-dive uses (anchor/gap absent — the Overview artifact is the anchor),
// built by THE ONE room-view builder shared with /api/items/view. Zero AI.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildRoomView } from '@/lib/entities/room-view';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const { entity, siblings } = await buildRoomView(supabase, user.id, id, null);
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ anchor: null, gap: null, entity, siblings });
  } catch (e) {
    console.error('[entities/room]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
