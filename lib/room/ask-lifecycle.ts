// ════════════════════════════════════════════════════════════════════════════════════════════════
// W14.2 · ASKS AND NARRATION LIVE AND DIE WITH THEIR WORK — THE PLATFORM HEALS THE RECORD WHERE IT
// ALREADY WRITES (docs/laws-registry.md `asks-live-and-die-with-their-work` · `narration-follows-
// its-artifact` · invariant 8 A CLAIM RENDERS).
//
// Found by a read-only census (Sep 24, 4 live accounts), all four the same class — a durable room turn
// outliving the truth it was written under, repaired only if someone happened to open the room:
//   C1 · 24 LIVE asks whose stored words claim readiness ("ready to go", "I have X ready") — written
//        before W13.6; the turn door serves the floor on the paint, but the stored words stay false.
//   C2 ·  3 LIVE asks HIDDEN by the moot predicate (labels outlived the verdict / name the draft) —
//        the editor never settles an engine ask and apply-verdict settled only on a class change: a
//        hidden-but-live ask is a second, silent truth.
//   C3 ·  9 LIVE asks on items no longer open (8 on retired commitment mirrors, 1 on a verdict dismiss
//        whose fire-and-forget settle never ran) — the resolution did not take its ask with it.
//   D  · 16 LIVE `prep:*` narrations over items whose reader holds nothing live.
//
// THE RULE, one module, three seats: every verdict write (lib/work/apply-verdict.ts) archives the
// item's moot engine asks; the judgment sweep (fanned per user, every 2h) runs `runAskLifecycleLane`
// — closed items' asks settle (THE ONE settle, reversible), moot asks archive, false asks are
// RE-SPOKEN with the deterministic floor (`askPreamble`, zero AI, true by construction), open items'
// orphaned narrations archive — bounded and REPORTED (what a cap left leads the next run). Archive, never
// delete. The pure predicates are exported so the census reports what this code WOULD do.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { askIsMoot, verdictRequireLabels, isEngineAskKey } from '@/lib/room/ask-mootness';

// The settle mark lives in a client-safe leaf (lib/room/ask-settle.ts) — re-exported for the lane's callers.
export { SETTLED_ASK_KEY, askRefOf, settledAskComponent, restoredAskComponent, restorableBy, baseDedupeKey } from '@/lib/room/ask-settle';
type Component = import('@/lib/room/ask-settle').AskComponent;

/** The item an ask's dedupe key names — `requires:<id>` (the engine) · `delegate:<id>:<…>` (a
 *  coworker). Pure. */
export function askItemOfKey(key: string | null | undefined): { id: string; engine: boolean } | null {
  const k = String(key ?? '');
  const r = /^requires:([^:#\s]+)$/.exec(k);
  if (r) return { id: r[1], engine: true };
  const d = /^delegate:([^:#\s]+):/.exec(k);
  return d ? { id: d[1], engine: false } : null;
}

/** The moot predicate's title facts, from the item's own row — THE SAME reading the machine makes
 *  (lib/work/machine.ts): an inbox item's inbound SUBJECT (a commitment-lane mirror row reads as a
 *  commitment), a commitment's description. Pure. */
export function mootFactsOf(row: { kind: 'inbox' | 'commitment'; source?: string | null; subject?: string | null; description?: string | null }):
  { itemTitle: string | null; itemKind: 'inbox' | 'commitment' } {
  if (row.kind === 'commitment') return { itemTitle: row.description || null, itemKind: 'commitment' };
  return { itemTitle: row.subject || null, itemKind: String(row.source ?? '') === 'commitment' ? 'commitment' : 'inbox' };
}

/** Is an ask HIDDEN-BUT-LIVE — what the machine serves in `mootAskKeys` (an actionable verdict, an
 *  engine ask, every label moot)? Exactly the machine's condition, so archiving it changes no paint. Pure. */
export function askHiddenAsMoot(
  ask: { dedupe_key?: string | null; component?: Component },
  facts: { itemTitle: string | null; itemKind: 'inbox' | 'commitment' },
  verdict: { work?: string | null; requires?: unknown } | null | undefined,
): boolean {
  if (!verdict?.work || verdict.work === 'none') return false;
  if (!isEngineAskKey(ask.dedupe_key)) return false;
  const c = ask.component;
  if (c?.key !== 'input_checklist' || (c.state as { proceeded?: boolean } | undefined)?.proceeded) return false;
  const items = Array.isArray(c.state?.items) ? (c.state!.items as unknown[]) : [];
  return askIsMoot(items, { ...facts, verdictRequires: verdictRequireLabels(verdict), engineAsk: true });
}

/** The item's status read as a POSITIVE closure (never "not pending" — an unknown status proves
 *  nothing). Pure. */
export function itemClosed(kind: 'inbox' | 'commitment', status: string | null | undefined): boolean {
  const s = String(status ?? '');
  return kind === 'inbox' ? s === 'completed' || s === 'dismissed' : s === 'done' || s === 'dismissed';
}

export type AskLane = 'settle_closed' | 'archive_moot' | 'respeak_false' | 'keep';

/** THE ONE DECISION per live ask, in precedence order: a closed item's ask settles (it dies with its
 *  work) → a hidden moot ask archives → a false ask is re-spoken → keep. Pure. */
export function decideAsk(args: {
  ask: { dedupe_key?: string | null; component?: Component };
  closed: boolean; open: boolean;
  facts: { itemTitle: string | null; itemKind: 'inbox' | 'commitment' } | null;
  verdict: { work?: string | null; requires?: unknown } | null | undefined;
  speechFalse: boolean;
  /** true when the ask names no item at all (a coworker ask in an entity room) */
  itemless: boolean;
}): AskLane {
  if (args.closed) return 'settle_closed';
  if (args.open && args.facts && askHiddenAsMoot(args.ask, args.facts, args.verdict)) return 'archive_moot';
  const proceeded = !!(args.ask.component?.state as { proceeded?: boolean } | undefined)?.proceeded;
  if (args.speechFalse && !proceeded && (args.open || args.itemless)) return 'respeak_false';
  return 'keep';
}

/** The deterministic floor a false ask is re-spoken with — THE SAME words the turn door already
 *  serves on the paint (`truthfulAskTurns`), now written durably. Null when even the floor would
 *  trip the net (a title that itself says "ready …") — never write false words back. */
export async function falseAskFloor(args: { labels: string[]; itemTitle: string; work?: string | null; bases: string[] }): Promise<string | null> {
  const { askPreamble, baseLine } = await import('@/lib/prepare/requirements');
  const { askSpeechIsFalse, isLegacyAskSpeech } = await import('@/lib/room/legacy-ask-speech');
  const text = `${askPreamble({ labels: args.labels.slice(0, 5), itemTitle: args.itemTitle, work: (args.work ?? null) as never })}${args.bases.length ? ` ${baseLine(args.bases)}` : ''}`;
  if (isLegacyAskSpeech(text) || await askSpeechIsFalse(text)) return null;
  return text;
}

/**
 * THE VERDICT WRITE'S HALF (C2): archive the item's engine asks the machine now hides as moot. Called
 * by applyVerdictConsequences on every non-failed verdict. Archive, never delete (the component stays
 * on the record, stamped `mooted`); a conditional claim on the live row. Returns how many archived.
 */
export async function archiveMootAsksForItem(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox' | 'commitment'; id: string },
  verdict: { work?: string | null; requires?: unknown } | null | undefined,
): Promise<number> {
  try {
    if (!verdict?.work || verdict.work === 'none') return 0;
    const { data: asks, error } = await client.from('room_turns').select('id, dedupe_key, component')
      .eq('user_id', userId).eq('dedupe_key', `requires:${item.id}`)
      .filter('component->>key', 'eq', 'input_checklist').is('archived_at', null);
    if (error || !asks?.length) return 0;
    const facts = await readMootFacts(client, userId, item);
    if (!facts) return 0;
    let n = 0;
    for (const a of asks as Array<{ id: string; dedupe_key: string | null; component: Component }>) {
      if (!askHiddenAsMoot(a, facts, verdict)) continue;
      if (await archiveAsMoot(client, userId, a, 'verdict')) n++;
    }
    return n;
  } catch { return 0; }
}

async function readMootFacts(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<{ itemTitle: string | null; itemKind: 'inbox' | 'commitment' } | null> {
  if (item.kind === 'inbox') {
    const { data, error } = await client.from('inbox_items').select('id, source, subject:source_data->>subject')
      .eq('id', item.id).eq('user_id', userId).maybeSingle();
    if (error || !data) return null;
    return mootFactsOf({ kind: 'inbox', source: (data as { source?: string }).source ?? null, subject: (data as { subject?: string }).subject ?? null });
  }
  const { data, error } = await client.from('commitments').select('id, description').eq('id', item.id).eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  return mootFactsOf({ kind: 'commitment', description: (data as { description?: string }).description ?? null });
}

async function archiveAsMoot(
  client: SupabaseClient, userId: string, a: { id: string; component: Component }, by: 'verdict' | 'sweep',
): Promise<boolean> {
  const at = new Date().toISOString();
  const state = { ...((a.component?.state ?? {}) as Record<string, unknown>), mooted: { at, by } };
  const { data, error } = await client.from('room_turns')
    .update({ archived_at: at, component: { ...(a.component ?? {}), state } })
    .eq('id', a.id).eq('user_id', userId).is('archived_at', null).select('id');
  return !error && ((data ?? []) as unknown[]).length > 0;
}

// ── THE SWEEP'S LANE ─────────────────────────────────────────────────────────────────────────────

/** Re-spoken asks per user per run (each one conditional write; zero AI). */
export const RESPEAK_CAP_PER_RUN = 50;
/** Exact single-reader reads for open items' narrations per user per run. */
export const NARRATION_READS_PER_RUN = 40;

export type AskLifecycleResult = {
  /** live asks read (input_checklist, not archived) */
  liveAsks: number;
  closedSettled: number;
  mootArchived: number;
  falseRespoken: number;
  /** false asks whose floor would itself trip the net — left as they are, counted */
  falseUnfixable: number;
  /** live `prep:<kind>:<id>` narrations read */
  narrationsLive: number;
  narrationsSettled: number;
  /** what the caps (or the slice) left for the next run — never silent */
  leftBehind: number;
  /** set when the lane did not run, and why */
  skipped: string | null;
};

export const emptyAskLifecycle = (): AskLifecycleResult => ({
  liveAsks: 0, closedSettled: 0, mootArchived: 0, falseRespoken: 0, falseUnfixable: 0,
  narrationsLive: 0, narrationsSettled: 0, leftBehind: 0, skipped: null,
});

type AskTurn = { id: string; dedupe_key: string | null; text: string | null; refs: Array<{ label?: string }> | null; component: Component; author: { name?: string } | null };
type PrepTurn = { id: string; dedupe_key: string | null };

/**
 * THE LANE (zero AI). `apply: false` decides only — every count is what the lane WOULD do (the
 * census's read-only rerun uses it through a write-refusing client). Bounded by its caps and its
 * deadline; what either leaves behind is counted.
 */
export async function runAskLifecycleLane(
  client: SupabaseClient, userId: string,
  opts: { deadlineMs?: number; apply?: boolean; respeakCap?: number; narrationReadCap?: number } = {},
): Promise<AskLifecycleResult> {
  const out = emptyAskLifecycle();
  const apply = opts.apply !== false;
  const deadline = opts.deadlineMs ?? Date.now() + 15_000;
  const respeakCap = Math.max(0, opts.respeakCap ?? RESPEAK_CAP_PER_RUN);
  const readCap = Math.max(0, opts.narrationReadCap ?? NARRATION_READS_PER_RUN);
  const { fetchAllRows } = await import('@/lib/utils/fetch-all');

  // 1 · every live ask + every live item-keyed prep narration (full listings, paged).
  const asks = await fetchAllRows<AskTurn>((from, to) => client.from('room_turns')
    .select('id, dedupe_key, text, refs, component, author')
    .eq('user_id', userId).filter('component->>key', 'eq', 'input_checklist').is('archived_at', null)
    .order('id', { ascending: true }).range(from, to));
  const { prepItemOfKey, narrationOrphaned, storedWorkWithdrawn } = await import('@/lib/prepare/narration');
  const preps = (await fetchAllRows<PrepTurn>((from, to) => client.from('room_turns')
    .select('id, dedupe_key')
    .eq('user_id', userId).like('dedupe_key', 'prep:%').is('archived_at', null)
    .order('id', { ascending: true }).range(from, to))).filter((t) => !!prepItemOfKey(t.dedupe_key));
  out.liveAsks = asks.length;
  out.narrationsLive = preps.length;
  if (!asks.length && !preps.length) return out;

  // 2 · the named items' rows (status + the moot facts), in bounded chunks.
  const ids = new Set<string>();
  for (const a of asks) { const it = askItemOfKey(a.dedupe_key); if (it) ids.add(it.id); }
  for (const p of preps) ids.add(prepItemOfKey(p.dedupe_key)!.id);
  type ItemRow = { kind: 'inbox' | 'commitment'; status: string; facts: { itemTitle: string | null; itemKind: 'inbox' | 'commitment' } };
  const rowOf = new Map<string, ItemRow>();
  const idList = [...ids];
  for (let i = 0; i < idList.length; i += 150) {
    const chunk = idList.slice(i, i + 150);
    const [ib, cm] = await Promise.all([
      client.from('inbox_items').select('id, status, source, subject:source_data->>subject').eq('user_id', userId).in('id', chunk),
      client.from('commitments').select('id, status, description').eq('user_id', userId).in('id', chunk),
    ]);
    for (const r of (ib.error ? [] : ib.data ?? []) as Array<{ id: string; status: string; source?: string; subject?: string }>) {
      rowOf.set(String(r.id), { kind: 'inbox', status: String(r.status), facts: mootFactsOf({ kind: 'inbox', source: r.source ?? null, subject: r.subject ?? null }) });
    }
    for (const r of (cm.error ? [] : cm.data ?? []) as Array<{ id: string; status: string; description?: string }>) {
      rowOf.set(String(r.id), { kind: 'commitment', status: String(r.status), facts: mootFactsOf({ kind: 'commitment', description: r.description ?? null }) });
    }
  }
  const isOpen = (row: ItemRow | undefined) => !!row && !itemClosed(row.kind, row.status)
    && (row.kind === 'inbox' ? row.status === 'pending' : ['open', 'pending', 'in_progress', 'suggested'].includes(row.status));

  // 3 · the CURRENT verdicts of the open items the asks name (THE ONE judgment cache).
  const verdictOf = new Map<string, { work?: string | null; requires?: unknown }>();
  const keys = [...new Set(asks.map((a) => askItemOfKey(a.dedupe_key)?.id).filter((id): id is string => !!id && isOpen(rowOf.get(id))))]
    .map((id) => `${rowOf.get(id)!.kind}:${id}`);
  if (keys.length) {
    const { readPlans } = await import('@/lib/store/item-plans');
    for (const j of await readPlans(client, userId, 'judgment', { keys })) {
      const v = (j.tasks as { verdict?: { work?: string | null; requires?: unknown } } | null)?.verdict;
      if (v) verdictOf.set(String(j.key).replace(/^(inbox|commitment):/, ''), v);
    }
  }

  // 4 · THE ONE DECISION per ask, then its lane.
  const { askSpeechIsFalse } = await import('@/lib/room/legacy-ask-speech');
  const { settleAsksForItem } = await import('@/lib/room/turns');
  const { askBaseOf } = await import('@/lib/room/ask-base');
  const settledItems = new Set<string>();
  let respoken = 0;
  for (const a of asks) {
    if (Date.now() > deadline) { out.leftBehind++; continue; }
    const it = askItemOfKey(a.dedupe_key);
    const row = it ? rowOf.get(it.id) : undefined;
    if (it && !row) continue; // the item is gone or unreadable — nothing is proven
    const closed = !!row && itemClosed(row.kind, row.status);
    const lane = decideAsk({
      ask: a, closed, open: isOpen(row), facts: row?.facts ?? null,
      verdict: it ? verdictOf.get(it.id) : null,
      speechFalse: !closed && await askSpeechIsFalse(a.text),
      itemless: !it,
    });
    if (lane === 'settle_closed') {
      if (settledItems.has(it!.id)) continue; // one settle takes every ask of the item
      settledItems.add(it!.id);
      const n = apply ? await settleAsksForItem(client, userId, row!.kind === 'commitment' ? 'commitment' : 'inbox_item', it!.id, { why: 'resolved' }) : asks.filter((x) => askItemOfKey(x.dedupe_key)?.id === it!.id).length;
      out.closedSettled += n;
    } else if (lane === 'archive_moot') {
      if (!apply || await archiveAsMoot(client, userId, a, 'sweep')) out.mootArchived++;
    } else if (lane === 'respeak_false') {
      if (respoken >= respeakCap) { out.leftBehind++; continue; }
      const labels = (Array.isArray(a.component?.state?.items) ? a.component!.state!.items as unknown[] : []).map(String).filter(Boolean);
      const title = String(a.refs?.[0]?.label ?? '').trim() || String(row?.facts.itemTitle ?? '').trim() || 'this work';
      const floor = labels.length ? await falseAskFloor({ labels, itemTitle: title, work: it ? verdictOf.get(it.id)?.work ?? null : null, bases: askBaseOf(a.component?.state) }) : null;
      if (!floor) { out.falseUnfixable++; continue; }
      respoken++;
      if (!apply) { out.falseRespoken++; continue; }
      // A CONDITIONAL write: only the words we judged false are replaced (a concurrent re-speak wins).
      const { data, error } = await client.from('room_turns').update({ text: floor })
        .eq('id', a.id).eq('user_id', userId).eq('text', String(a.text ?? '')).is('archived_at', null).select('id');
      if (!error && ((data ?? []) as unknown[]).length) out.falseRespoken++;
    }
  }

  // 5 · orphaned narrations on OPEN items: a narration stands only while THE ONE READER holds live
  // work (a POSITIVE finding — `narrationOrphaned`). A closed item's record is its resolution's to
  // keep (the verdict door archives its own; an Undo re-opens the item with its story intact).
  const byItem = new Map<string, { kind: 'inbox' | 'commitment'; id: string; turnIds: string[] }>();
  for (const p of preps) {
    const it = prepItemOfKey(p.dedupe_key)!;
    const e = byItem.get(it.id) ?? { kind: it.kind, id: it.id, turnIds: [] };
    e.turnIds.push(p.id); byItem.set(it.id, e);
  }
  const { preparedState } = await import('@/lib/prepare/read');
  let reads = 0;
  for (const e of byItem.values()) {
    const row = rowOf.get(e.id);
    if (!row) continue;
    if (!isOpen(row)) continue;
    if (reads >= readCap || Date.now() > deadline) { out.leftBehind += e.turnIds.length; continue; }
    reads++;
    const st = await preparedState(client, userId, { kind: row.kind === 'inbox' ? 'inbox_item' : 'commitment', id: e.id }).catch(() => null);
    if (!st || st.live.length > 0) continue;
    if (!narrationOrphaned(st) && !(await storedWorkWithdrawn(client, userId, { kind: row.kind, id: e.id }))) continue;
    if (!apply) { out.narrationsSettled += e.turnIds.length; continue; }
    const { data, error } = await client.from('room_turns').update({ archived_at: new Date().toISOString() })
      .eq('user_id', userId).in('id', e.turnIds).is('archived_at', null).select('id');
    if (!error) out.narrationsSettled += ((data ?? []) as unknown[]).length;
  }
  return out;
}
