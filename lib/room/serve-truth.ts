// ════════════════════════════════════════════════════════════════════════════════════════════════
// SERVE-TIME TRUTH FOR LAST-GOOD (stabilization W13.5 — A WITHDRAWN ARTIFACT TAKES ITS WORDS AND ITS
// BUTTON WITH IT; laws `a-claim-renders` · `no-mutation-and-address` · the opening contract).
//
// Found live (owner walk on prod after W13.3): THE ONE READER correctly WITHDREW a legacy doc-send
// draft (no draft card rendered) — but the room kept serving the LAST-GOOD brief "I've drafted the
// reply … the draft is ready to review" with a MOVE button "Review the reply draft" that did nothing
// when clicked (its target was gone). The composer's nets (enforceRenderedClaims, the CTA law, the
// board-validated target) all ran — at COMPOSE time, against the board as it stood then. Last-good
// is served with zero AI on every open, and nothing re-asked those questions of the board as it
// stands NOW. A refused or degraded recompose keeps last-good standing, so a reload changed nothing.
//
// THE RULE, at the one seam every door serves a brief through (before the first paint — the
// no-mutation law holds: the decision is made before anything is painted, never a swap after):
//   1. THE MOVE'S TARGET IS RE-VALIDATED against the CURRENT board. A primary move (not the CoS's
//      offer) stands only while its object is LIVE-prepared (its ref's entry carries live prepared
//      work, or — unbound — the board holds exactly one live-prepared entry). Otherwise it is
//      DROPPED — never a dead button, never demoted to an offer about work that was withdrawn.
//   2. THE CLAIMS ARE RE-VALIDATED against the CURRENT board (the SAME net the composer runs —
//      lib/room/self-voice enforceRenderedClaims + claimsUnrenderedPreparation). A last-good brief
//      any of whose claims no longer render is NOT served: the door serves nothing, and the rail
//      speaks its ONE honest fallback line (lib/room/opening-fallback) — the recompose (sig-moved,
//      under after()) lands as an APPEND, never a swap.
//
// Pure (the net is pure); the one async helper reads the entity door's board through THE ONE READER.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { enforceRenderedClaims } from '@/lib/room/self-voice';

/** One board entry as the serve seam needs it: the deed handle and its LIVE prepared words
 *  (lib/room/grounding preparedWordsOf — THE ONE READER's live artifacts, never withdrawn ones). */
export type ServeBoardEntry = { ref: string; prepared: string[] };

export type ServeFacts = {
  board: ServeBoardEntry[];
  /** A decision card renders on this page (a decision brief is live, or the item stands awaiting a decision). */
  hasDecision: boolean;
  /** A live ask card renders on this page. Unknown → true (a doubt never withholds a brief). */
  hasAsk: boolean;
};

type Servable = {
  text: string;
  move: { label: string; ref: string | null; offer?: boolean } | null;
  offers: Array<{ label: string; say: string }>;
};

export type ServeVerdict<R> = {
  /** What the door may paint: the brief (its move possibly dropped), or null (the honest fallback). */
  response: R | null;
  /** The move was a dead button against the current board and was dropped. */
  moveDropped: boolean;
  /** The brief's claims no longer render — it is not served. */
  withheld: boolean;
  /** The sentences that failed the net (for the log / the gate). */
  dropped: string[];
};

/** Is this move's object LIVE on the current board? Pure. An offer is words, never a button — it is
 *  not a target claim and always passes. */
export function moveTargetLive(
  move: { ref: string | null; offer?: boolean } | null | undefined, board: ServeBoardEntry[],
): boolean {
  if (!move) return true;
  if (move.offer) return true;
  const live = board.filter((b) => b.prepared.length > 0);
  if (move.ref) return live.some((b) => b.ref === move.ref);
  // An unbound primary move has ONE object only when exactly one live-prepared entry stands
  // (lib/room/cta-law bindToSoleStaged — the same rule the composer binds with).
  return live.length === 1;
}

/** THE SERVE-TIME TRUTH (pure): hand it the last-good response and the CURRENT board facts. */
export function serveTimeTruth<R extends Servable>(r: R | null | undefined, f: ServeFacts): ServeVerdict<R> {
  if (!r) return { response: null, moveDropped: false, withheld: false, dropped: [] };
  const prepared = f.board.flatMap((b) => b.prepared);
  const net = enforceRenderedClaims(r.text, {
    hasPrepared: prepared.length > 0, hasDecision: f.hasDecision, hasAsk: f.hasAsk, prepared,
  });
  if (net.dropped.length) return { response: null, moveDropped: !!r.move, withheld: true, dropped: net.dropped };
  if (r.move && !moveTargetLive(r.move, f.board)) {
    return { response: { ...r, move: null }, moveDropped: true, withheld: false, dropped: [] };
  }
  return { response: r, moveDropped: false, withheld: false, dropped: [] };
}

/** The door's board ref for an item (the composer's own spelling — lib/room/grounding). */
export function boardRefOf(kind: 'inbox' | 'commitment', id: string): string {
  return kind === 'inbox' ? `inbox:${id}` : `commit:${id}`;
}

/**
 * THE ENTITY DOOR's current board (server-only; lazy imports): the entity's linked inbox items and
 * commitments, their LIVE prepared words through THE ONE READER (batched — two queries), in the
 * composer's own ref spelling. A read failure returns null — the caller then serves last-good as it
 * always did (the net is a protection, never a blocker).
 */
export async function entityServeBoard(
  client: import('@supabase/supabase-js').SupabaseClient, userId: string, entityId: string,
): Promise<ServeBoardEntry[] | null> {
  try {
    const { data, error } = await client.from('entity_links').select('item_kind, item_id')
      .eq('user_id', userId).eq('entity_id', entityId).in('item_kind', ['inbox_item', 'commitment']).limit(80);
    if (error) return null;
    const rows = (data ?? []) as Array<{ item_kind: string; item_id: string }>;
    const items = [
      ...rows.filter((l) => l.item_kind === 'inbox_item').slice(0, 30).map((l) => ({ kind: 'inbox' as const, id: String(l.item_id) })),
      ...rows.filter((l) => l.item_kind === 'commitment').slice(0, 30).map((l) => ({ kind: 'commitment' as const, id: String(l.item_id) })),
    ];
    if (!items.length) return [];
    const [{ preparedStatesFor }, { preparedWordsOf }] = await Promise.all([
      import('@/lib/prepare/read'), import('@/lib/room/grounding'),
    ]);
    const states = await preparedStatesFor(client, userId, items);
    return items.map((i) => {
      const st = states.get(`${i.kind}:${i.id}`);
      return { ref: boardRefOf(i.kind, i.id), prepared: st ? preparedWordsOf(st).list : [] };
    });
  } catch { return null; }
}
