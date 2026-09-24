// W14.2 · ASKS AND NARRATION LIVE AND DIE WITH THEIR WORK — the pure predicates + the settle/restore
// round trip over an in-memory PostgREST fixture. Zero AI, zero DB.
import { describe, expect, it, vi } from 'vitest';
import { fakePostgrest } from '../fixtures/fake-postgrest';

const reader = vi.hoisted(() => ({ live: new Map<string, number>() }));
vi.mock('@/lib/prepare/read', async (orig) => ({
  ...(await orig<typeof import('@/lib/prepare/read')>()),
  preparedState: vi.fn(async (_c: unknown, _u: string, item: { id: string }) => {
    const n = reader.live.get(item.id) ?? 0;
    return { all: n > 0 ? [{}] : [{ withdrawn: true }], live: Array.from({ length: n }, () => ({})), sentStamp: false };
  }),
}));

import {
  SETTLED_ASK_KEY, askItemOfKey, askHiddenAsMoot, baseDedupeKey, decideAsk, itemClosed, mootFactsOf,
  restorableBy, restoredAskComponent, settledAskComponent, runAskLifecycleLane,
} from '@/lib/room/ask-lifecycle';
import { prepItemOfKey, withholdOrphanNarrations, narrationOrphaned, servedNarrationTurns } from '@/lib/prepare/narration';
import { settleAsksForItem, restoreAsksForItem } from '@/lib/room/turns';

const U = 'u1';
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('W14.2 pure predicates', () => {
  it('reads the item an ask or a narration names', () => {
    expect(askItemOfKey(`requires:${ID}`)).toEqual({ id: ID, engine: true });
    expect(askItemOfKey(`delegate:${ID}:run-7`)).toEqual({ id: ID, engine: false });
    expect(askItemOfKey('founding-proposal')).toBeNull();
    expect(prepItemOfKey(`prep:commit:${ID}`)).toEqual({ kind: 'commitment', id: ID });
    expect(prepItemOfKey('meeting-prep:x')).toBeNull();
    expect(baseDedupeKey(`requires:${ID}#archived:2026-09-24T00:00:00Z`)).toBe(`requires:${ID}`);
  });

  it('settle and restore are inverse on the component, and only a resolution is restorable', () => {
    const c = { key: 'input_checklist', state: { items: ['PO'], base: ['v1.pptx'] } };
    const s = settledAskComponent(c, { ref: `inbox:${ID}`, at: 't', why: 'resolved' });
    expect(s.key).toBe(SETTLED_ASK_KEY);
    expect(restorableBy(s, `inbox:${ID}`)).toBe(true);
    expect(restorableBy(s, 'inbox:other')).toBe(false);
    expect(restorableBy(settledAskComponent(c, { ref: `inbox:${ID}`, at: 't', why: 'answered' }), `inbox:${ID}`)).toBe(false);
    expect(restoredAskComponent(s)).toEqual(c);
  });

  it('positive closure only; mirrors read as commitments; one decision in precedence order', () => {
    expect(itemClosed('inbox', 'dismissed')).toBe(true);
    expect(itemClosed('inbox', 'pending')).toBe(false);
    expect(itemClosed('commitment', 'suggested')).toBe(false);
    expect(mootFactsOf({ kind: 'inbox', source: 'commitment', subject: 's' }).itemKind).toBe('commitment');
    const ask = { dedupe_key: `requires:${ID}`, component: { key: 'input_checklist', state: { items: ['reply draft'] } } };
    const facts = { itemTitle: 'x', itemKind: 'inbox' as const };
    expect(decideAsk({ ask, closed: true, open: false, facts, verdict: { work: 'reply' }, speechFalse: true, itemless: false })).toBe('settle_closed');
    expect(decideAsk({ ask, closed: false, open: true, facts, verdict: { work: 'reply' }, speechFalse: true, itemless: false })).toBe('archive_moot');
    expect(askHiddenAsMoot(ask, facts, { work: 'none' })).toBe(false);
    const live = { ...ask, component: { key: 'input_checklist', state: { items: ['signed PO'] } } };
    expect(decideAsk({ ask: live, closed: false, open: true, facts, verdict: { work: 'reply' }, speechFalse: true, itemless: false })).toBe('respeak_false');
    expect(decideAsk({ ask: live, closed: false, open: true, facts, verdict: { work: 'reply' }, speechFalse: false, itemless: false })).toBe('keep');
  });

  it('the narration floor withholds orphans only; a sent artifact is a positive finding', () => {
    const turns = [{ role: 'system', key: `prep:inbox:${ID}` }, { role: 'system', key: 'prep:inbox:other' }, { role: 'user', key: undefined }];
    expect(withholdOrphanNarrations(turns, new Map([[`inbox:${ID}`, false]]))).toHaveLength(2);
    expect(withholdOrphanNarrations(turns, new Map())).toBe(turns);
    expect(narrationOrphaned({ live: [], all: [], sentStamp: true })).toBe(true);
    expect(narrationOrphaned({ live: [{}], all: [{}], sentStamp: true })).toBe(false);
  });
});

describe('W14.2 settle → restore round trip + the lane', () => {
  it('a dismissal settles the ask (archived, never deleted) and the undo restores it under its own key', async () => {
    const db = fakePostgrest({ room_turns: [{ id: 't1', user_id: U, room_key: `inbox:${ID}`, dedupe_key: `requires:${ID}`, text: 'I need the PO.', author: null, archived_at: null, component: { key: 'input_checklist', state: { items: ['PO'] } } }] });
    expect(await settleAsksForItem(db.client, U, 'inbox_item', ID)).toBe(1);
    expect(db.tables.room_turns).toHaveLength(1);
    expect(db.tables.room_turns[0].archived_at).toBeTruthy();
    expect(await restoreAsksForItem(db.client, U, 'inbox_item', ID)).toBe(1);
    expect(db.tables.room_turns[0]).toMatchObject({ archived_at: null, dedupe_key: `requires:${ID}`, component: { key: 'input_checklist', state: { items: ['PO'] } } });
  });

  it('the render floor reads the reader and withholds only the orphan', async () => {
    reader.live = new Map([[ID, 0], ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1]]);
    const out = await servedNarrationTurns({} as never, U, [
      { role: 'system', key: `prep:inbox:${ID}` }, { role: 'system', key: 'prep:commit:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ]);
    expect(out.map((t) => t.key)).toEqual(['prep:commit:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  });

  it('the lane archives an open item\'s orphaned narration (withdrawn work) and reports it', async () => {
    reader.live = new Map([[ID, 0]]);
    const db = fakePostgrest({
      room_turns: [{ id: 'p', user_id: U, room_key: `inbox:${ID}`, dedupe_key: `prep:inbox:${ID}`, text: 'drafted', archived_at: null }],
      inbox_items: [{ id: ID, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'x' } }],
      commitments: [], item_plans: [],
    });
    const r = await runAskLifecycleLane(db.client, U, {});
    expect(r.narrationsSettled).toBe(1);
    expect(db.tables.room_turns[0].archived_at).toBeTruthy();
    expect(r.leftBehind).toBe(0);
  });

  it('the narration read cap is stated and what it leaves is counted', async () => {
    reader.live = new Map();
    const ids = ['c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000002'];
    const db = fakePostgrest({
      room_turns: ids.map((id, i) => ({ id: `p${i}`, user_id: U, room_key: `inbox:${id}`, dedupe_key: `prep:inbox:${id}`, text: 'x', archived_at: null })),
      inbox_items: ids.map((id) => ({ id, user_id: U, status: 'pending', source: 'gmail', source_data: {} })),
      commitments: [], item_plans: [],
    });
    const r = await runAskLifecycleLane(db.client, U, { narrationReadCap: 1 });
    expect(r.narrationsSettled + r.leftBehind).toBe(2);
    expect(r.leftBehind).toBe(1);
  });
});
