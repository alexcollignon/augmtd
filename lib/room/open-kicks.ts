// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OPEN'S BACKGROUND WORK — ONE HOME (stabilization W8.4 THE ROOM SPEAKS TRUE AND FAST, Sep 23).
//
// Opening an item is the strongest "this matters" signal there is, so a REAL open buys three pieces
// of AI-bearing background work: the room's opening (sig-gated compose), recognition of an
// unverdicted item (membership classification), and the ground-law re-prepare trip for a
// non-live artifact. None of it may run on a HOVER WARM (dev logs, Sep 23: a hover over a row paid a
// classification call per item it grazed) and none of it may hold the paint (the view used to wait
// ~1s on the compose every open). So:
//
//   · GET /api/items/view (a real open) schedules these under after() — the response never awaits
//     them; the client picks the composition up through the one late re-check (an APPEND).
//   · GET /api/items/view?warm=1 (the hover warm) schedules NOTHING — zero AI, a pure read.
//   · an open that JOINS a hover warm still in flight (lib/room/warm-client.ts fetchItemView) posts
//     one kick to the budgeted warm door (POST /api/items/warm { open: true }), which runs
//     `kickOpenedItem` below — the same three pieces, from the same functions, read for itself.
//
// Server-only. Every piece is non-fatal (the crons are the backstop) and logs one line when it acts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { preparedState, isLiveArtifact, type PreparedArtifact } from '@/lib/prepare/read';
import { anchorOf, linkKindOf, looseRoomKeyOf, looseTitleOf, ANCHOR_ROW_SELECT, foldAnchorRow } from '@/lib/room/item-anchor';
import { createSingleFlight } from '@/lib/room/single-flight';

type LinkKind = 'inbox_item' | 'commitment' | 'meeting';

/** RECOGNIZE-ON-OPEN (the coverage tail): the live hooks gate on understanding labels, so an item can
 *  reach its door with NO membership verdict at all. Idempotent; a refusal is remembered too, so this
 *  fires at most once per item. */
export async function recognizeOnOpen(client: SupabaseClient, uid: string, linkKind: LinkKind, id: string): Promise<void> {
  try {
    const { recognizeItem } = await import('@/lib/entities/recognize');
    const src = await import('@/lib/entities/sources');
    if (linkKind === 'inbox_item') {
      const { data: it, error } = await client.from('inbox_items').select('id, work_title, source_data, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
      if (!error && it) await recognizeItem(client, uid, src.itemFromInbox(it));
    } else if (linkKind === 'commitment') {
      const { data: c, error } = await client.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
      if (!error && c) await recognizeItem(client, uid, src.itemFromCommitment(c));
    } else {
      const { data: m, error } = await client.from('meeting_transcripts').select('id, title, summary, attendees, start_time, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
      if (!error && m) await recognizeItem(client, uid, src.itemFromMeeting(m));
    }
  } catch { /* non-fatal — the cron hooks are the backstop */ }
}

/** W13.5 · THE TRIP IS DUE when THE ONE READER holds any prepared artifact that is not LIVE — a
 *  withdrawal (falseClaim · stagingStale · baseAsAnswer · wrongIdentity ride `falseClaim`), a
 *  superseded/outside-window/misaddressed artifact, or an expired one. ONE predicate for both open
 *  paths (the view door and the joined-warm kick). Pure. */
export function needsReprepareTrip(arts: PreparedArtifact[]): boolean {
  return arts.some((a) => !isLiveArtifact(a));
}

/** THE TRIP'S BUDGET (W13.5): at most ONE re-prepare per item per window, in-process (the crons and
 *  the stored artifacts are the cross-instance backstop). A trip whose lane lands on an ask/base
 *  retires the withdrawn artifact (lib/prepare/pass prepareDocSend), so the next open is not due at
 *  all; the window only stops a burst of opens from re-buying the same verify while it runs. */
export const REPREPARE_TRIP_WINDOW_MS = 10 * 60 * 1000;
const _tripFlight = createSingleFlight<void>();

/** THE GROUND LAW's on-open trip: something prepared here is not LIVE (superseded, outside the stated
 *  window, a false claim, expired, withdrawn by the reader) — re-prepare so the next read serves work
 *  built from the present. Idempotent; every lane re-checks the ground and no-ops once re-prepared.
 *  Budgeted: one trip per item per REPREPARE_TRIP_WINDOW_MS (concurrent callers join the flight). */
export async function reprepareTrip(
  client: SupabaseClient, uid: string, linkKind: LinkKind, id: string,
  row: { work_title?: string; description?: string; created_at?: string } | null, entityId: string | null,
): Promise<void> {
  if (linkKind !== 'inbox_item' && linkKind !== 'commitment') return;
  await _tripFlight.run(`${uid}|${linkKind}|${id}`, async () => {
    await runReprepareTrip(client, uid, linkKind, id, row, entityId);
    return { value: undefined, memoMs: REPREPARE_TRIP_WINDOW_MS };
  }).catch(() => {});
}

async function runReprepareTrip(
  client: SupabaseClient, uid: string, linkKind: 'inbox_item' | 'commitment', id: string,
  row: { work_title?: string; description?: string; created_at?: string } | null, entityId: string | null,
): Promise<void> {
  try {
    const { prepareOneItem } = await import('@/lib/prepare/pass');
    const title = String(row?.work_title ?? row?.description ?? 'this item');
    const startAt = String(row?.created_at ?? new Date().toISOString());
    const r = await prepareOneItem(client, uid, {
      id: `${linkKind === 'inbox_item' ? 'inbox' : 'commit'}:${id}`, entityId: id,
      kind: linkKind === 'inbox_item' ? 'reply' : 'commitment', title,
      state: 'todo', actor: 'you', automated: false, who: null, blockedOn: null,
      startAt, when: { explicit: null, bucket: 'now' },
      entity: entityId ? { id: entityId, name: '' } : null,
    } as never);
    // One line per trip — a re-prepare that no-ops is never silent (the W5c find was invisible).
    console.log(`[items/view] re-prepare trip ${linkKind}:${id} → ${r.did}${r.reason ? ` (${r.reason})` : ''}`);
    // W13.6 · THE NARRATION FOLLOWS ITS ARTIFACT: the trip ran because the reader withdrew something;
    // when the board still holds nothing live, the item's prep line ("… drafted the send") archives.
    const { settlePrepNarration } = await import('@/lib/prepare/narration');
    await settlePrepNarration(client, uid, { kind: linkKind === 'inbox_item' ? 'inbox' : 'commitment', id });
  } catch { /* the pass cron is the backstop */ }
}

/** The whole open's background work for an item the view door did NOT schedule it for (an open that
 *  joined a hover warm). Reads for itself — the row, THE ONE READER, the verdict — then composes the
 *  opening through the SAME sig-gated ensureLooseRoomBrief + joinCompose the door uses, with the SAME
 *  anchor derivation (lib/room/item-anchor), or the sig never matches. */
export async function kickOpenedItem(
  client: SupabaseClient, uid: string, item: { kind: string; id: string },
): Promise<{ composed: boolean; recognized: boolean; tripped: boolean }> {
  const linkKind: LinkKind = linkKindOf(item.kind);
  const id = item.id;
  const table = linkKind === 'inbox_item' ? 'inbox_items' : linkKind === 'commitment' ? 'commitments' : 'meeting_transcripts';
  const [rowRes, st, verdictRes, linkRes] = await Promise.all([
    client.from(table).select(ANCHOR_ROW_SELECT[linkKind]).eq('id', id).eq('user_id', uid).maybeSingle(),
    linkKind === 'meeting' ? Promise.resolve(null) : preparedState(client, uid, { kind: linkKind, id }).catch(() => null),
    client.from('entity_links').select('item_id').eq('user_id', uid).eq('item_kind', linkKind).eq('item_id', id).maybeSingle(),
    client.from('entity_links').select('entity_id').eq('user_id', uid).eq('item_kind', linkKind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle(),
  ]);
  if (rowRes.error || !rowRes.data) return { composed: false, recognized: false, tripped: false };
  const row = foldAnchorRow(linkKind, rowRes.data) as Record<string, unknown>;
  const arts: PreparedArtifact[] = st?.all ?? [];
  const recognize = !verdictRes.error && !verdictRes.data;
  const trip = needsReprepareTrip(arts);
  const roomKey = looseRoomKeyOf(linkKind, id);
  const a = anchorOf(linkKind, row, arts);
  const anchorForBrief = { title: looseTitleOf(linkKind, row), who: a.who, ask: a.ask, prepared: a.prepared };
  const { ensureLooseRoomBrief, joinCompose } = await import('@/lib/room/brief');
  // W13.5: the trip runs BEFORE the compose (the opening is written against the corrected board).
  const [composed] = await Promise.all([
    (async () => {
      if (trip) await reprepareTrip(client, uid, linkKind, id, row as never, (linkRes.data?.entity_id as string | undefined) ?? null);
      return joinCompose(uid, roomKey, () => ensureLooseRoomBrief(client, uid, roomKey, anchorForBrief)).catch(() => null);
    })(),
    recognize ? recognizeOnOpen(client, uid, linkKind, id) : Promise.resolve(),
  ]);
  return { composed: !!composed, recognized: recognize, tripped: trip };
}
