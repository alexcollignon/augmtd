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
export function narrationOrphaned(st: { live: unknown[]; all: unknown[]; sentStamp?: boolean } | null | undefined, retired = 0): boolean {
  if (!st) return retired > 0;
  if (st.live.length > 0) return false;
  // W14.2: a send-shaped artifact that WENT OUT is a positive finding too (census Sep 24: 5 narrations
  // stood over work sent through a door that never settled them — the reader holds nothing unsent).
  return st.all.length > 0 || st.sentStamp === true || retired > 0;
}

/**
 * W14.2 · THE READER HID IT — a second POSITIVE finding for the durable settle. Census (Sep 24): 4 of
 * the 5 "nothing in the reader" narrations sat over work the item's own storage still held but THE
 * ONE READER deliberately does not serve (a notice item's stripped draft/nudge in `source_data`, a
 * pool row filed into the version chain as `superseded:*`). Stored-but-unserved IS withdrawn work.
 * An item whose storage holds nothing at all proves nothing (the render floor still hides its line).
 * Read-only; false on any failure.
 */
export async function storedWorkWithdrawn(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<boolean> {
  try {
    if (item.kind === 'inbox') {
      const { data, error } = await client.from('inbox_items')
        .select('id, source_data->draft, source_data->nudge_draft, source_data->prepared_invite, source_data->prepared_forward')
        .eq('id', item.id).eq('user_id', userId).maybeSingle();
      if (!error && data) {
        const r = data as Record<string, unknown>;
        if (['draft', 'nudge_draft', 'prepared_invite', 'prepared_forward'].some((k) => !!r[k])) return true;
      }
    }
    const { data: filed, error: fErr } = await client.from('item_deliverables').select('id')
      .eq('user_id', userId).eq('kind', item.kind === 'inbox' ? 'email' : 'commitment').eq('entity_id', item.id)
      .like('metadata->>version_of', 'superseded:%').limit(1);
    return !fErr && ((filed ?? []) as unknown[]).length > 0;
  } catch { return false; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W14.2 · THE READ-TIME FLOOR (census Sep 24: 16 live `prep:*` narrations over items whose reader held
// nothing live — withdrawn at READ time for a wrong identity, a newer inbound, a passed time, a false
// claim; or sent through another door). The settle above is durable but runs only at the doors that
// take work away; the READER withdraws at read time, so the turn door decides before the paint:
// a `prep:<kind>:<id>` narration is SERVED only while THE ONE READER holds a live artifact for that
// item. Pure decision + one bounded read; zero AI; nothing is written (the durable settle is the
// sweep's and the doors' job) — the paint is the truth from the first frame.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The item a prep narration's dedupe key names (`prep:commit:<id>` · `prep:commitment:<id>` ·
 *  `prep:inbox:<id>`), or null for any other key (`meeting-prep:`, `prep:handoff-…`). Pure. */
export function prepItemOfKey(key: string | null | undefined): { kind: 'inbox' | 'commitment'; id: string } | null {
  const m = /^prep:(commit|commitment|inbox):([^:#\s]+)$/.exec(String(key ?? ''));
  if (!m) return null;
  return { kind: m[1] === 'inbox' ? 'inbox' : 'commitment', id: m[2] };
}

/** THE RENDER RULE — a prep narration renders only while its item's reader holds live work. An
 *  item the floor could not read (absent from `liveByItem`) keeps its narration (a doubt never
 *  withholds a line the client's own fold still governs). Pure. */
export function withholdOrphanNarrations<T extends { role?: string; key?: string }>(
  turns: T[], liveByItem: Map<string, boolean>,
): T[] {
  let out: T[] | null = null;
  turns.forEach((t, i) => {
    const it = t.role === 'system' ? prepItemOfKey(t.key) : null;
    if (!it || liveByItem.get(`${it.kind}:${it.id}`) !== false) { if (out) out.push(t); return; }
    out = out ?? turns.slice(0, i);
  });
  return out ?? turns;
}

/** How many distinct items one serve reads through the exact single reader; the rest ride the
 *  batched reader in one call (never skipped — no silent cap). A loose room names ONE item. */
const NARRATION_SINGLE_READS = 4;

/** THE FLOOR AT THE TURN DOOR: read the reader for each item a served prep narration names, withhold
 *  the orphaned ones. Returns the same array when nothing is withheld. Non-fatal (a failed read keeps
 *  the turns as they are). */
export async function servedNarrationTurns<T extends { role?: string; key?: string }>(
  client: SupabaseClient, userId: string, turns: T[],
): Promise<T[]> {
  try {
    const items = new Map<string, { kind: 'inbox' | 'commitment'; id: string }>();
    for (const t of turns) { const it = t.role === 'system' ? prepItemOfKey(t.key) : null; if (it) items.set(`${it.kind}:${it.id}`, it); }
    if (!items.size) return turns;
    const { preparedState, preparedStatesFor } = await import('@/lib/prepare/read');
    const all = [...items.values()];
    const single = all.slice(0, NARRATION_SINGLE_READS);
    const rest = all.slice(NARRATION_SINGLE_READS);
    const live = new Map<string, boolean>();
    await Promise.all(single.map(async (it) => {
      const st = await preparedState(client, userId, { kind: it.kind === 'inbox' ? 'inbox_item' : 'commitment', id: it.id }).catch(() => null);
      if (st) live.set(`${it.kind}:${it.id}`, st.live.length > 0);
    }));
    if (rest.length) {
      const batch = await preparedStatesFor(client, userId, rest).catch(() => null);
      for (const it of rest) { const st = batch?.get(`${it.kind}:${it.id}`); if (st) live.set(`${it.kind}:${it.id}`, st.live.length > 0); }
    }
    return withholdOrphanNarrations(turns, live);
  } catch { return turns; }
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
