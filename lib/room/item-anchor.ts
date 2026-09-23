// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM'S ANCHOR, DERIVED ONCE (stabilization W3.7 ROOM SPEED).
//
// The loose room's composed brief is sig-gated on its ANCHOR (who · ask · prepared · title — see
// lib/room/brief.ts ensureLooseRoomBrief). Two server paths now compose it: the room's own door
// (GET /api/items/view, on the open) and THE WARM (POST /api/items/warm, when the deck renders —
// so the brief is already stored before the click). If the two derived the anchor differently,
// the warm would store a sig the open never matches and every open would recompose anyway: the
// fake-warm class. So the derivation lives HERE, pure, and both doors call it.
//
// Pure: no reads, no AI. The callers hand in the row they already hold and the prepared artifacts
// from THE ONE READER (lib/prepare/read).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { isLiveArtifact, type PreparedArtifact } from '@/lib/prepare/read';

export type AnchorLinkKind = 'inbox_item' | 'commitment' | 'meeting';
export type ItemAnchor = { who: string | null; ask: string | null; prepared: string | null };

/** The plan/view kind → the entity-link item_kind (the prepared-pool kind rides the same value). */
export function linkKindOf(kind: string): AnchorLinkKind {
  return kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox_item';
}

/** The loose room key — matches lib/room/turns.ts `looseRoomKey` and the rail's own convention. */
export function looseRoomKeyOf(linkKind: AnchorLinkKind, id: string): string {
  return `${linkKind === 'inbox_item' ? 'inbox' : linkKind}:${id}`;
}

/** The ONE select per kind for the anchor row (`status` rides so the machine reader needn't re-read). */
export const ANCHOR_ROW_SELECT: Record<AnchorLinkKind, string> = {
  inbox_item: 'work_title, source, source_data, last_activity_at, created_at, status',
  commitment: 'description, counterparty, created_at, status',
  meeting: 'title, start_time',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any> | null | undefined;

/** Who this is with · the item's verb-first ask · whether prepared work already arrived.
 *  Grounded-or-absent per part; never invented. */
export function anchorOf(linkKind: AnchorLinkKind, row: AnyRow, prepared: PreparedArtifact[]): ItemAnchor {
  let anchor: ItemAnchor = { who: null, ask: null, prepared: null };
  if (row) {
    if (linkKind === 'inbox_item') {
      const sd = (row.source_data ?? {}) as Record<string, unknown>;
      const u = (sd.understanding ?? null) as { ask?: string } | null;
      anchor = {
        who: (sd.from_name as string) || (sd.from as string) || null,
        ask: (typeof u?.ask === 'string' && u.ask) || null,
        prepared: null,
      };
    } else if (linkKind === 'commitment') {
      anchor = { who: (row.counterparty as string) || null, ask: String(row.description || '') || null, prepared: null };
    }
  }
  // W5c · A CLAIM RENDERS: only a LIVE draft is "prepared" in the anchor (the loose brief's sig and
  // its composer read this) — a hidden false-claim draft must never let the brief say it is ready.
  const replyArt = prepared.find((a) => isLiveArtifact(a) && (a.kind === 'reply_draft' || a.kind === 'nudge_draft'));
  if (replyArt) anchor.prepared = replyArt.by ?? 'draft';
  return anchor;
}

/** The item's latest activity (the plan-freshness rule reads it). */
export function activityAtOf(linkKind: AnchorLinkKind, row: AnyRow): string | null {
  if (!row || linkKind !== 'inbox_item') return null;
  const sd = (row.source_data ?? {}) as Record<string, unknown>;
  return (row.last_activity_at as string) || (sd.received_at as string) || (row.created_at as string) || null;
}

/** The loose room's title (the composer's subject line for a room with no entity). */
export function looseTitleOf(linkKind: AnchorLinkKind, row: AnyRow): string {
  return linkKind === 'inbox_item'
    ? String(row?.work_title || (row?.source_data as Record<string, unknown> | undefined)?.subject || 'this email')
    : linkKind === 'commitment' ? String(row?.description ?? 'this commitment') : String(row?.title ?? 'this meeting');
}
