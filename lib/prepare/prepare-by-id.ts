// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARE THIS ONE ITEM (W39b — the walk's multi-input ask, Oct 1).
//
// A reader's own deed on ONE item (a typed answer, a go-ahead) re-runs THE ONE preparation engine
// for THAT item. The door used to find the item by building the whole account's spine and looking
// for it there — but the spine's live lane admits an inbox row only by its deck classification
// (work_state / rule_type). An item the JUDGE owes a reply on but the deck never classified (or
// classified otherwise) was simply not found, so the go-ahead re-prepared NOTHING: no draft, and the
// room said "No answer was saved" under the reader's own go-ahead.
//
// The deed names its item, so the item is prepared: the scoped spine's WorkItem when it carries one
// (its facts are richer), else the same minimal WorkItem the on-open re-prepare trip builds
// (lib/room/open-kicks.ts) — the judge is the gate either way (prepareOneItem prepares only from the
// judged verdict), so nothing is prepared that the verdict does not owe.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PrepareOneResult } from '@/lib/prepare/pass';

export type PrepareTarget = { kind: 'inbox' | 'commitment'; id: string };

export async function prepareItemById(client: SupabaseClient, userId: string, item: PrepareTarget): Promise<PrepareOneResult & { via: 'spine' | 'direct' | 'missing' }> {
  const { buildWorkItems } = await import('@/lib/work-items/model');
  const { prepareOneItem } = await import('@/lib/prepare/pass');
  const key = `${item.kind === 'commitment' ? 'commit' : 'inbox'}:${item.id}`;
  const todayStr = new Date().toISOString().slice(0, 10);
  const scoped = await buildWorkItems(client, userId, { todayStr, skipReconcile: true, onlyItemIds: [item.id] }).catch(() => []);
  const w = scoped.find((x) => x.id === key);
  if (w) return { ...(await prepareOneItem(client, userId, w)), via: 'spine' };
  // THE DIRECT ITEM — read the row itself (pending only: a settled item is never re-opened here).
  const table = item.kind === 'commitment' ? 'commitments' : 'inbox_items';
  const cols = item.kind === 'commitment' ? 'id, description, created_at, status' : 'id, work_title, created_at, status';
  const { data: row, error } = await client.from(table).select(cols).eq('id', item.id).eq('user_id', userId).maybeSingle();
  const r = (row ?? null) as { work_title?: string | null; description?: string | null; created_at?: string | null; status?: string | null } | null;
  if (error || !r || (item.kind === 'inbox' && r.status !== 'pending') || (item.kind === 'commitment' && r.status !== 'open' && r.status !== 'pending')) {
    return { did: 'none', reason: 'the item is not open', via: 'missing' };
  }
  const { data: link } = await client.from('entity_links').select('entity_id')
    .eq('user_id', userId).eq('item_kind', item.kind === 'commitment' ? 'commitment' : 'inbox_item').eq('item_id', item.id)
    .not('entity_id', 'is', null).maybeSingle();
  const entityId = (link as { entity_id?: string } | null)?.entity_id ?? null;
  const res = await prepareOneItem(client, userId, {
    id: key, entityId: item.id,
    kind: item.kind === 'commitment' ? 'commitment' : 'reply',
    title: String(r.work_title ?? r.description ?? 'this item'),
    state: 'todo', actor: 'you', automated: false, who: null, blockedOn: null,
    startAt: String(r.created_at ?? new Date().toISOString()), when: { explicit: null, bucket: 'now' },
    entity: entityId ? { id: entityId, name: '' } : null,
  } as never);
  return { ...res, via: 'direct' };
}
