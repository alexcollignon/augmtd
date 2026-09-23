// GET /api/entities/[id]/room — the PROJECT DOOR's rail read (just-works P7c-c2). Returns the same
// RailView shape the item deep-dive uses (anchor/gap absent — the Overview artifact is the anchor),
// built by THE ONE room-view builder shared with /api/items/view. Zero AI on the read itself; the
// brief composes BEFORE the paint within a budget (W3.5 (a)).
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildRoomView } from '@/lib/entities/room-view';

// W0.5 TIME BUDGET: a compose that outruns the paint budget finishes under after() — the platform
// default kills it mid-work (CLAUDE.md maxDuration lesson).
export const maxDuration = 300;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const uid = user.id;
    // THE BRIEF BEFORE THE PAINT (W3.5 (a) — invariant 11; registry precedence #1): the compose
    // starts beside the room-view read and the response waits for it up to the budget; past it,
    // last-good paints (older version flagged) and the compose finishes under after() to arrive as
    // an APPENDED message on the client's one re-check — never a swap.
    // joinCompose (W3.7): a warm already composing this room is joined, never paid for twice.
    const { briefBeforePaint, ensureRoomBrief, joinCompose } = await import('@/lib/room/brief');
    const paintP = briefBeforePaint(supabase, uid, id, () => joinCompose(uid, id, () => ensureRoomBrief(supabase, uid, id)));
    after(async () => { try { await (await paintP).settled; } catch { /* non-fatal */ } });
    const { entity, siblings } = await buildRoomView(supabase, uid, id, null);
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const paint = await paintP;
    const r = paint.response;
    const served = r ? { ...entity, brief: r.text, move: r.move, offers: r.offers, briefAt: r.at } : entity;
    return NextResponse.json({
      anchor: null, gap: null, entity: served, siblings,
      briefPending: paint.pending,
      ...(r?.staleVersion ? { briefStaleVersion: true } : {}),
    });
  } catch (e) {
    console.error('[entities/room]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
