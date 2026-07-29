import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export const maxDuration = 120; // a proceed re-runs the ONE preparation engine in after()

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GLOBAL ASK LEDGER (proactive-team W3 — "asks stop being room-local"). A team member who asks
// once, silently, in a room the user never reopens is indistinguishable from one who forgot. This
// route lists every OPEN input_checklist turn across every room (the Home's "Needs your input"
// block reads it), and carries the one lifecycle action the room can't reach from outside:
//
//   POST { turnId, action:'proceed' } — "go ahead with what's available": stamps the ask
//   `proceeded` (it leaves the waiting list, the record stays in the room), writes the user's
//   visible go-ahead turn (choices are turns — the P8 law), and re-runs the ONE preparation engine
//   for the item in after() under the work-with-what-you-have contract. Answering an ask stays the
//   ingest funnel's job (attach in the room); this is only the never-blocks escape hatch.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type AskRow = {
  id: string; room_key: string; text: string; created_at: string;
  refs: Array<{ label?: string; href?: string }> | null;
  component: { key?: string; state?: { items?: string[]; proceeded?: boolean } } | null;
  author: { name?: string } | null;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Live asks only (archived conversations are history — they wait on nobody). Pre-migration
    // fallback mirrors lib/room/turns.ts: retry unfiltered when the column is absent.
    let rows: AskRow[] = [];
    try {
      const { data, error: qErr } = await supabase.from('room_turns')
        .select('id, room_key, text, refs, component, author, created_at')
        .eq('user_id', user.id).filter('component->>key', 'eq', 'input_checklist')
        .is('archived_at', null).order('created_at', { ascending: false }).limit(30);
      if (qErr) throw qErr;
      rows = (data ?? []) as AskRow[];
    } catch {
      const { data } = await supabase.from('room_turns')
        .select('id, room_key, text, refs, component, author, created_at')
        .eq('user_id', user.id).filter('component->>key', 'eq', 'input_checklist')
        .order('created_at', { ascending: false }).limit(30);
      rows = (data ?? []) as AskRow[];
    }
    const asks = rows
      .filter((r) => !r.component?.state?.proceeded) // proceeded = no longer waiting on the user
      .map((r) => ({
        id: r.id,
        roomKey: r.room_key,
        text: r.text,
        items: (r.component?.state?.items ?? []).map((i) => String(i)).slice(0, 6),
        by: r.author?.name ?? null, // null = the engine's own (CoS-voiced) ask
        href: r.refs?.find((x) => x.href)?.href ?? null,
        label: r.refs?.find((x) => x.label)?.label ?? null,
        askedAt: r.created_at,
      }));
    return NextResponse.json({ asks });
  } catch (e) {
    console.error('[room/asks] GET error:', e);
    return NextResponse.json({ asks: [] });
  }
}

// Parse the item behind an ask turn from its dedupe key + refs (the two shapes the one ask grammar
// writes: the engine's `requires:<itemId>` and a coworker's `delegate:<itemId>:<taskId>`).
function itemOfAsk(dedupeKey: string | null, refs: AskRow['refs']): { kind: 'inbox' | 'commitment'; id: string } | null {
  const m = /^(?:requires|delegate):([^:]+)/.exec(dedupeKey ?? '');
  if (!m) return null;
  const href = refs?.find((x) => x.href)?.href ?? '';
  return { kind: href.includes('kind=commitment') ? 'commitment' : 'inbox', id: m[1] };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { turnId?: string; action?: string };
    if (!body.turnId || body.action !== 'proceed') {
      return NextResponse.json({ error: 'turnId and action:"proceed" required' }, { status: 400 });
    }

    const { data: turn } = await supabase.from('room_turns')
      .select('id, room_key, dedupe_key, refs, component, author')
      .eq('id', body.turnId).eq('user_id', user.id).maybeSingle();
    const comp = (turn?.component ?? null) as AskRow['component'];
    if (!turn || comp?.key !== 'input_checklist') {
      return NextResponse.json({ error: 'ask not found' }, { status: 404 });
    }

    // 1. The lifecycle stamp — the ask leaves the waiting list; the turn stays as the room record.
    await supabase.from('room_turns').update({
      component: { ...comp, state: { ...(comp?.state ?? {}), proceeded: true, proceeded_at: new Date().toISOString() } },
    }).eq('id', turn.id).eq('user_id', user.id);

    // 2. The go-ahead is a VISIBLE user turn in the room (a choice is never silent — P8).
    const { writeRoomTurn } = await import('@/lib/room/turns');
    const first = (turn.author as { name?: string } | null)?.name?.split(' ')[0];
    await writeRoomTurn(supabase, user.id, turn.room_key as string, {
      role: 'user',
      text: `${first ? `Have ${first} go` : 'Go'} ahead with what's available — work with what I've shared and note any gaps.`,
      dedupeKey: `proceed:${turn.id}`,
    }).catch(() => {});

    // 3. Re-run THE ONE preparation engine for the item under the work-with-what-you-have contract.
    const item = itemOfAsk(turn.dedupe_key as string | null, turn.refs as AskRow['refs']);
    if (item) {
      after(async () => {
        try {
          const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
          const { buildWorkItems } = await import('@/lib/work-items/model');
          const { prepareOneItem } = await import('@/lib/prepare/pass');
          const todayStr = new Date().toISOString().slice(0, 10);
          const items = await buildWorkItems(admin, user.id, { todayStr, skipReconcile: true });
          const w = items.find((x) => x.id === `${item.kind === 'commitment' ? 'commit' : 'inbox'}:${item.id}`);
          if (w) await prepareOneItem(admin, user.id, w);
        } catch (e) { console.error('[room/asks] proceed prepare failed:', e); }
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[room/asks] POST error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
