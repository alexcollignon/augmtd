// lib/inbox/commitment-mirrors.ts — THE MIRROR FLOOR (stabilization W2.3, invariant 6 ONE FACT ONE HOME).
//
// WHY THIS FILE EXISTS. From June 23 (commit bbf106c, "commitment aging sweep — Slice 4") the
// commitments sweep wrote an `inbox_items` row (`source='commitment'`) for every overdue/stale open
// commitment, because at the time the inbox list and the Day Brief only rendered inbox_items — a
// commitment needed a mirror to be SEEN. Every surface since then reads commitments directly (the
// spine `lib/work-items/model.ts` maps commitments → WorkItems; the deck/brief has its own commitment
// lane; `judgeWork` judges `{kind:'commitment'}` natively; the prepare pass has a commitment lane), so
// the mirror became a second home for one fact: judged twice, drafted on with no thread (replies,
// nudges, invites on rows with no email), and outliving its commitment (Sep 22 audit: 931 pending,
// 195 whose commitment was already settled or gone).
//
// THE LAW NOW: no new mirror is ever written; every LISTING read of inbox_items excludes the
// historical ones through THIS predicate (one exclusion, never a per-site `.neq`); the one writer
// left is `settleMirrorRows` — an archive-only stamp for whatever historical rows still exist until
// `scripts/sweep-retire-mirrors.ts --apply` retires them all. Per-id reads (a row opened by its own
// id) stay untouched: a historical row opened from an old link must still resolve, never 404.
//
// Gate: scripts/smoke-mirrors-retired.ts (zero-AI source floor over the known listing readers).

import type { SupabaseClient } from '@supabase/supabase-js';

/** The `inbox_items.source` value the retired mirror rows carry. */
export const MIRROR_SOURCE = 'commitment' as const;

/** The resolved_reason the repair sweep (and the harmless settle) stamp on a retired mirror. */
export const MIRROR_RETIRED_REASON = 'mirror_retired' as const;

/** In-memory test: is this inbox row a historical commitment mirror? */
export function isCommitmentMirror(row: { source?: string | null } | null | undefined): boolean {
  return String(row?.source ?? '') === MIRROR_SOURCE;
}

/**
 * Query-builder filter: exclude commitment mirrors from a LISTING read of `inbox_items`.
 * Chain it right after `.from('inbox_items').select(...)`. Typed loosely on purpose — PostgREST's
 * builder generics explode (TS2589) when threaded through a helper; the callsite keeps its shape.
 */
export function withoutMirrors<Q>(q: Q): Q {
  // An UNCONSTRAINED generic on purpose: constraining Q to the builder's `neq` shape makes TypeScript
  // instantiate PostgREST's builder type to its depth limit (TS2589) at the wider selects.
  return (q as unknown as { neq: (col: string, val: string) => Q }).neq('source', MIRROR_SOURCE);
}

/** The PostgREST filter fragment for callers that compose an `.or()` and cannot chain `.neq()`. */
export const NOT_MIRROR_FILTER = `source.neq.${MIRROR_SOURCE}` as const;

/**
 * THE ONE HARMLESS WRITER for historical rows. Archives (never deletes) any still-pending mirror of
 * a commitment when that commitment settles — `status: 'dismissed'` + `resolved_reason`, so the row
 * leaves every pending pool without touching the Day-cleared ring's user-deed count (mirrors are
 * excluded there by source) and never re-enters as a resurrected corpse. Safe to call when no row
 * exists (the normal case once the repair has run); best-effort, never throws.
 */
export async function settleMirrorRows(
  client: SupabaseClient, userId: string, commitmentId: string,
  opts: { reason?: string; stampAt?: string } = {},
): Promise<number> {
  try {
    const { data: rows } = await client.from('inbox_items').select('id, source_data')
      .eq('user_id', userId).eq('source', MIRROR_SOURCE).eq('source_id', commitmentId).eq('status', 'pending');
    let n = 0;
    for (const r of (rows ?? []) as Array<{ id: string; source_data: Record<string, unknown> | null }>) {
      // THE ONE ENGINE STRIP (W9.1b): machine words strip; the user's hand is FILED, never deleted.
      const { stripSourceArtifacts } = await import('@/lib/prepare/hand-store');
      const strip = await stripSourceArtifacts(client, userId, {
        itemId: r.id, sd: r.source_data ?? {}, fields: ['draft', 'nudge_draft', 'prepared_invite', 'prepared_forward'], why: 'resolved',
      });
      const sd = strip.sd;
      if (!strip.kept.length) delete sd.prepared_by;
      const { error } = await client.from('inbox_items')
        .update({
          status: 'dismissed',
          source_data: { ...sd, resolved_reason: opts.reason ?? MIRROR_RETIRED_REASON, resolved_at: opts.stampAt ?? new Date().toISOString(), mirror_retired: true },
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.id).eq('user_id', userId).eq('status', 'pending');
      if (!error) n++;
    }
    return n;
  } catch { return 0; } // a historical row is derived state — a missed flip is repaired by the sweep
}
