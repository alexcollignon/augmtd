// GET /api/entities/[id]/room — the PROJECT DOOR's rail read (just-works P7c-c2). Returns the same
// RailView shape the item deep-dive uses (anchor/gap absent — the Overview artifact is the anchor),
// built by THE ONE room-view builder shared with /api/items/view. Zero AI on the read itself, and
// (W8.5) nothing here WAITS on AI either: the brief paints last-good and composes under after().
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildRoomView } from '@/lib/entities/room-view';

// W0.5 TIME BUDGET: the compose scheduled under after() below is AI-bearing background work — the
// platform default kills it mid-work (CLAUDE.md maxDuration lesson).
export const maxDuration = 300;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const uid = user.id;
    // ── THE BRIEF NEVER HOLDS THE PAINT (stabilization W8.5 — the W8.4 law of /api/items/view,
    // applied to the project door; it supersedes W3.5 (a)'s wait-up-to-budget here too). The paint
    // carries LAST-GOOD (an older version allowed, flagged) read in ONE select beside the room-view
    // read; the compose runs under after() — never awaited — and a composition landing where nothing
    // current was painted arrives on the client's one late re-check as an APPENDED message
    // (registry precedence #1's append rule, unchanged).
    // joinCompose (W3.7): a warm already composing this room is joined, never paid for twice.
    // `?warm=1` is a PURE READ (the late re-check picks up what the open already kicked — never a
    // second buy): it schedules no compose at all.
    const { readRoomResponse, ensureRoomBrief, joinCompose } = await import('@/lib/room/brief');
    const lastGoodP = readRoomResponse(supabase, uid, id, { allowStaleVersion: true }).catch(() => null);
    if (request.nextUrl.searchParams.get('warm') !== '1') {
      after(async () => { try { await joinCompose(uid, id, () => ensureRoomBrief(supabase, uid, id)); } catch { /* non-fatal */ } });
    }
    // W13.5 · SERVE-TIME TRUTH (lib/room/serve-truth): the entity's CURRENT board (THE ONE READER,
    // batched) is read beside the room view, and last-good is re-validated against it BEFORE the
    // paint — a MOVE whose object is no longer live is dropped, a brief whose claims no longer render
    // is not served (the room's own fallback speaks; the recompose appends).
    const { entityServeBoard, serveTimeTruth } = await import('@/lib/room/serve-truth');
    const [{ entity, siblings }, lastGood, board] = await Promise.all([
      buildRoomView(supabase, uid, id, null), lastGoodP, entityServeBoard(supabase, uid, id),
    ]);
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // An unreadable board serves last-good as before (the net is a protection, never a blocker).
    // The decision/ask cards are not read here — unknown → true, so only a disproven claim withholds.
    const serve = board ? serveTimeTruth(lastGood, { board, hasDecision: true, hasAsk: true })
      : { response: lastGood, withheld: false, moveDropped: false, dropped: [] as string[] };
    if (serve.withheld || serve.moveDropped) {
      console.log(`[entities/room] serve-time truth ${id}: ${serve.withheld ? 'withheld last-good' : 'dropped a dead MOVE'}`);
    }
    const r = serve.response;
    // buildRoomView carries its OWN last-good read on `entity` — never served past the net: the door's
    // brief fields are exactly what the serve-time truth let through (nothing, when it withheld).
    const served = r ? { ...entity, brief: r.text, move: r.move, offers: r.offers, briefAt: r.at }
      : { ...entity, brief: null, move: null, offers: [], briefAt: null };
    // Pending = nothing CURRENT painted (no last-good, or an older version, or a withheld last-good) —
    // the same rule the item door serves (app/api/items/view).
    const briefPending = !r || !!r.staleVersion || serve.withheld;
    return NextResponse.json({
      anchor: null, gap: null, entity: served, siblings,
      briefPending,
      ...(r?.staleVersion ? { briefStaleVersion: true } : {}),
    });
  } catch (e) {
    console.error('[entities/room]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
