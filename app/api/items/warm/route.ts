// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/warm { items: [{ kind, id }] } — THE BRIEF WARM's door (stabilization W3.7).
//
// Fired by the deck when it renders its rows (lib/room/warm-client.ts `queueBriefWarm`): the room
// openings of the top WARM_MAX_ITEMS visible items are composed in the BACKGROUND so the click
// finds them stored (lib/room/warm-briefs.ts carries the why and the bounds). Answers 202 at once —
// the response never waits on a compose; the work runs under after() with the full time budget.
// W8.4: `{ items: [one], open: true }` is the kick of an open that joined a zero-AI hover warm.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeWarmItems, warmRoomBriefs } from '@/lib/room/warm-briefs';

// W0.5 TIME BUDGET: the after() below composes (sig-gated, AI-bearing) — the platform default
// would kill it mid-compose (CLAUDE.md maxDuration lesson).
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null) as { items?: unknown; open?: unknown } | null;
    const items = sanitizeWarmItems(body?.items);
    if (!items.length) return NextResponse.json({ queued: 0 }, { status: 202 });
    const uid = user.id;
    // W8.4 · THE JOINED OPEN'S KICK (lib/room/open-kicks.ts): an open that joined a hover warm (a
    // zero-AI read) posts its ONE item here with `open: true` — the open's own background work
    // (sig-gated compose · recognize-on-open · the re-prepare trip) runs once, under after(). One
    // item only: an open is one room, never a batch.
    if (body?.open === true) {
      const it = items[0];
      after(async () => {
        try {
          const { kickOpenedItem } = await import('@/lib/room/open-kicks');
          const r = await kickOpenedItem(supabase, uid, it);
          if (r.composed || r.recognized || r.tripped) console.log(`[items/warm] open kick ${it.kind}:${it.id} · composed ${r.composed} · recognized ${r.recognized} · trip ${r.tripped}`);
        } catch (e) { console.error('[items/warm] open kick', e instanceof Error ? e.message : e); }
      });
      return NextResponse.json({ queued: 1 }, { status: 202 });
    }
    after(async () => {
      try {
        const res = await warmRoomBriefs(supabase, uid, items);
        if (res.composed) console.log(`[items/warm] warmed ${res.warmed} · composed ${res.composed} · skipped ${res.skipped}`);
      } catch (e) { console.error('[items/warm]', e instanceof Error ? e.message : e); }
    });
    return NextResponse.json({ queued: items.length }, { status: 202 });
  } catch (e) {
    console.error('[items/warm]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
