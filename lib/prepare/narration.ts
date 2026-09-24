// ════════════════════════════════════════════════════════════════════════════════════════════════
// W13.6 · THE NARRATION FOLLOWS ITS ARTIFACT — AT EVERY DOOR THAT TAKES THE ARTIFACT AWAY
// (docs/laws-registry.md "THE NARRATION FOLLOWS ITS ARTIFACT" · invariant 8 A CLAIM RENDERS).
//
// Found live (owner walk after W13.5): "Clara found the file and drafted the send on …" (`prep:commit:
// <id>`) stood LIVE in the room although its doc-send had been filed into the version chain
// (`superseded:unstaged`). The law was enforced at ONE door — apply-verdict's verdict-driven strip —
// while the artifact left through others: the one superseding writer (`supersedeDraftsRiding`, the
// unstage consequence and the doc-send lane's retirement), and the reader-withdrawal re-prepare trip
// (a falseClaim / stagingStale / baseAsAnswer artifact the lane could not replace). The render folds
// an orphaned prep line and the brief's grounding skips it — but the record kept saying it, and every
// reader that is not one of those two (history, a future surface) would read a claim nothing backs.
//
// THE RULE (one predicate, every door): an item's `prep:*` narration stands only while THE ONE READER
// holds a LIVE artifact for that item. When a door takes the last one away, the narration is ARCHIVED
// (never deleted — it is the record; the pass re-narrates the next time it prepares, and W13.5's
// key-release lets that re-narration land live). Fail-safe: a read that cannot prove the board is
// empty of live work (nothing known, nothing just retired) archives nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** The dedupe keys an item's prep narration is written under — the pass keys on the WORK-SPINE id
 *  (`prep:commit:<id>` / `prep:inbox:<id>`); the judge-input spelling (`prep:commitment:<id>`) is
 *  archived too (apply-verdict's own list). Pure. */
export function prepNarrationKeys(kind: 'inbox' | 'commitment', id: string): string[] {
  return kind === 'commitment' ? [`prep:commit:${id}`, `prep:commitment:${id}`] : [`prep:inbox:${id}`];
}

/**
 * Is the item's prep narration ORPHANED? True only on a POSITIVE finding: the reader holds no live
 * artifact AND either it holds withdrawn ones (they exist, none renders) or this door just retired
 * some. An empty read with nothing retired proves nothing (an unreadable board never archives). Pure.
 */
export function narrationOrphaned(st: { live: unknown[]; all: unknown[] } | null | undefined, retired = 0): boolean {
  if (!st) return retired > 0;
  if (st.live.length > 0) return false;
  return st.all.length > 0 || retired > 0;
}

/**
 * THE ONE SETTLE — called by every door that takes an artifact off the board. Reads THE ONE READER,
 * archives the item's live prep narration when it is orphaned. Returns how many turns it archived.
 * Non-fatal, zero AI.
 */
export async function settlePrepNarration(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox' | 'commitment'; id: string },
  opts: { retired?: number } = {},
): Promise<number> {
  try {
    const { preparedState } = await import('@/lib/prepare/read');
    const st = await preparedState(client, userId, { kind: item.kind === 'inbox' ? 'inbox_item' : 'commitment', id: item.id }).catch(() => null);
    if (!narrationOrphaned(st, opts.retired ?? 0)) return 0;
    const { data, error } = await client.from('room_turns')
      .update({ archived_at: new Date().toISOString() })
      .eq('user_id', userId).in('dedupe_key', prepNarrationKeys(item.kind, item.id)).is('archived_at', null)
      .select('id');
    if (error) return 0;
    return (data ?? []).length;
  } catch { return 0; }
}
