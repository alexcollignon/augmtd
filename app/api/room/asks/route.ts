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
//   for the item in after() under the work-with-what-you-have contract.
//
//   POST { turnId, action:'supply', label, text } — THE TYPE-IT DOOR (W4-B, Sep 22; owner: "banking
//   details for example could just be typed if IBAN only? … typing short info easier than finding
//   attachment, but keeping options open"). One missing thing, answered by SAYING it. The typed
//   fact stages as that requirement's HAVE through the ONE key (lib/prepare/supply.ts), so the
//   drafter reads it exactly as it reads a file the resolver found; the row leaves the checklist;
//   the ask settles through the ONE shared settle (settleAsksForItem) when its LAST row is covered;
//   and the work re-opens through the same re-open the attach funnel calls. Zero AI.
//
//   FAIL-CLOSED: a label this ask does not carry is a 404. A door that would stage arbitrary text
//   under an arbitrary key is a write door with no object.
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

type AskTurn = {
  id: string; room_key: string; dedupe_key: string | null;
  refs: AskRow['refs']; author: { name?: string } | null;
};

/** Re-run THE ONE preparation engine for the item, in the background. Both actions end here. */
function reprepareInBackground(userId: string, item: { kind: 'inbox' | 'commitment'; id: string }) {
  after(async () => {
    try {
      const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { buildWorkItems } = await import('@/lib/work-items/model');
      const { prepareOneItem } = await import('@/lib/prepare/pass');
      const todayStr = new Date().toISOString().slice(0, 10);
      const items = await buildWorkItems(admin, userId, { todayStr, skipReconcile: true });
      const w = items.find((x) => x.id === `${item.kind === 'commitment' ? 'commit' : 'inbox'}:${item.id}`);
      if (w) await prepareOneItem(admin, userId, w);
    } catch (e) { console.error('[room/asks] re-prepare failed:', e); }
  });
}

// ── THE TYPE-IT DOOR ──────────────────────────────────────────────────────────────────────────
// ONE row of ONE ask, answered by typing the fact. Zero AI, fail-closed, and every consequence the
// attach funnel has: staged as the HAVE, the row leaves the checklist, the ask settles through the
// ONE shared settle when nothing is left, and the work re-opens.
async function supplyTypedFact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, userId: string, turn: AskTurn,
  comp: AskRow['component'], rawLabel?: string, rawText?: string,
): Promise<NextResponse> {
  const { requireTaskId, stageTypedSupply, reopenAfterSupply, SUPPLY_TEXT_MAX } = await import('@/lib/prepare/supply');
  const wanted = String(rawLabel ?? '').trim();
  const said = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  if (!wanted || !said) return NextResponse.json({ error: 'label and text required' }, { status: 400 });
  if (said.length > SUPPLY_TEXT_MAX) {
    // The server's own sentence is the honest one (the deed module renders whatever we say here).
    return NextResponse.json({ error: 'That’s longer than this door takes — attach it as a file instead.' }, { status: 400 });
  }

  // FAIL-CLOSED: only a label THIS ask is actually carrying may be staged. A 404 (never a 403)
  // because a refusal must not confirm what a turn does or does not hold.
  const state = ((comp?.state ?? {}) as Record<string, unknown>);
  const items = Array.isArray(state.items) ? (state.items as unknown[]).map((i) => String(i)) : [];
  const row = items.find((i) => i === wanted) ?? null;
  if (!row) return NextResponse.json({ error: 'ask not found' }, { status: 404 });

  const item = itemOfAsk(turn.dedupe_key, turn.refs);
  if (!item) return NextResponse.json({ error: 'this ask has no work to stage against' }, { status: 400 });

  // 1. THE HAVE — the same key, the same item scope the resolver's own staging uses.
  const staged = await stageTypedSupply(supabase, userId, {
    itemKind: item.kind, itemId: item.id, label: row, text: said,
  });
  if (!staged) return NextResponse.json({ error: 'That didn’t land — try it again in a moment.' }, { status: 500 });

  const { writeRoomTurn, clip } = await import('@/lib/room/turns');

  // 2. The row leaves the checklist; what was typed is kept ON the ask as its receipt, so a reader
  //    arriving later sees WHICH gap closed and with what, not a row that silently vanished.
  const supplied = { ...((state.supplied ?? {}) as Record<string, string>), [row]: clip(said, 160) };
  const remaining = items.filter((i) => i !== row);
  await supabase.from('room_turns').update({
    component: { ...(comp ?? {}), state: { ...state, items: remaining, supplied } },
  }).eq('id', turn.id).eq('user_id', userId);

  // 3. THE WORD IS THE DEED — what the person typed is their own turn in the room (P8: a choice is
  //    never silent), which is also how every room-grounded reader gets the fact in their words.
  await writeRoomTurn(supabase, userId, turn.room_key, {
    role: 'user',
    text: `${row}: ${clip(said, 400)}`,
    dedupeKey: `supply:${turn.id}:${requireTaskId(row)}`,
  }).catch(() => {});

  // 4. THE ONE SHARED SETTLE, only when the LAST row is covered. settleAsksForItem is covers-aware:
  //    an ask a sibling item still rides keeps standing, minus this beneficiary.
  let settled = false;
  if (!remaining.length) {
    const { settleAsksForItem } = await import('@/lib/room/turns');
    await settleAsksForItem(supabase, userId, item.kind === 'commitment' ? 'commitment' : 'inbox_item', item.id, { why: 'answered' });
    settled = true;
  }

  // 5. THE SAME RE-OPEN the attach funnel calls — work prepared without this fact is not the answer.
  await reopenAfterSupply(supabase, userId, { itemKind: item.kind, itemId: item.id });

  const { logActivity } = await import('@/lib/activity/log');
  await logActivity(supabase, userId, {
    // Its own honest type: nothing was attached. It is not in the reversible set (a typed fact is
    // re-typed, never "undone"), and an unmapped type renders on the timeline's default meta.
    type: 'input_supplied',
    title: `Supplied: ${clip(row, 80)}`,
    entityType: item.kind === 'commitment' ? 'commitment' : 'inbox_item',
    entityId: item.id,
    metadata: { via: 'typed_supply', label: row, chars: said.length },
  });

  reprepareInBackground(userId, item);
  return NextResponse.json({ ok: true, settled, remaining: remaining.length });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { turnId?: string; action?: string; label?: string; text?: string };
    if (!body.turnId || (body.action !== 'proceed' && body.action !== 'supply')) {
      return NextResponse.json({ error: 'turnId and action:"proceed"|"supply" required' }, { status: 400 });
    }

    const { data: turn } = await supabase.from('room_turns')
      .select('id, room_key, dedupe_key, refs, component, author')
      .eq('id', body.turnId).eq('user_id', user.id).maybeSingle();
    const comp = (turn?.component ?? null) as AskRow['component'];
    if (!turn || comp?.key !== 'input_checklist') {
      return NextResponse.json({ error: 'ask not found' }, { status: 404 });
    }

    if (body.action === 'supply') {
      return await supplyTypedFact(supabase, user.id, turn as AskTurn, comp, body.label, body.text);
    }

    // 1. The lifecycle stamp — the ask leaves the waiting list; the turn stays as the room record.
    await supabase.from('room_turns').update({
      component: { ...comp, state: { ...(comp?.state ?? {}), proceeded: true, proceeded_at: new Date().toISOString() } },
    }).eq('id', turn.id).eq('user_id', user.id);

    // 2. The go-ahead is a VISIBLE user turn in the room (a choice is never silent — P8).
    // IT IS SPEECH THE USER WOULD ACTUALLY SAY (owner walk, Sep 14: the old sentence — "go ahead
    // with what's available — work with what I've shared and note any gaps" — read like an engine
    // instruction pasted into his own bubble; his word for it was meaningless). Clicks are words,
    // so the words have to be a person's.
    const { writeRoomTurn } = await import('@/lib/room/turns');
    const first = (turn.author as { name?: string } | null)?.name?.split(' ')[0];
    await writeRoomTurn(supabase, user.id, turn.room_key as string, {
      role: 'user',
      text: `${first ? `${first}, go` : 'Go'} ahead without it — use what you have and tell me what's missing.`,
      dedupeKey: `proceed:${turn.id}`,
    }).catch(() => {});

    // 3. Re-run THE ONE preparation engine for the item under the work-with-what-you-have contract.
    const item = itemOfAsk(turn.dedupe_key as string | null, turn.refs as AskRow['refs']);
    if (item) reprepareInBackground(user.id, item);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[room/asks] POST error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
