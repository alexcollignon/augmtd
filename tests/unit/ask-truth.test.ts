// W13.6 · THE ASK SPEAKS TRUE, RENDERS, OFFERS ITS BASE — AND A WITHDRAWN ARTIFACT'S NARRATION FOLLOWS
// IT (owner live walk on prod after W13.5). Outcome runs over in-memory fakes: zero AI (the model call
// is a stub), zero DB (a query recorder).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({ pick: null as null | ((prompt: string) => unknown), say: 'I need the slides 7&8 details to finish the work on this — attach them or tell me where to look.' }));
vi.mock('@/lib/ai/call', () => ({
  aiCall: vi.fn(async ({ prompt }: { prompt: string }) => {
    if (/ATTACHABLE THINGS/.test(prompt)) return { json: { attachable: [1] } };
    if (/CANDIDATES:/.test(prompt)) {
      if (!ai.pick) throw new Error('model unavailable');
      return { json: ai.pick(prompt) };
    }
    return { json: { say: ai.say } };
  }),
}));
const retrieval = vi.hoisted(() => ({ cands: [] as unknown[] }));
vi.mock('@/lib/knowledge/resolve', async (orig) => ({
  ...(await orig<typeof import('@/lib/knowledge/resolve')>()),
  resolveFileUniversal: vi.fn(async () => retrieval.cands),
  emailAttachmentDates: vi.fn(async () => new Map<string, string>()),
}));
const room = vi.hoisted(() => ({ turns: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/room/turns', async (orig) => ({
  ...(await orig<typeof import('@/lib/room/turns')>()),
  roomKeyForItem: vi.fn(async () => 'room:test'),
  writeRoomTurn: vi.fn(async (_c: unknown, _u: string, _k: string, turn: Record<string, unknown>) => { room.turns.push(turn); return null; }),
}));
const pool = vi.hoisted(() => ({ writes: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/home/deliverable-pool', () => ({
  writeDeliverable: vi.fn(async (_c: unknown, _u: string, input: Record<string, unknown>) => { pool.writes.push(input); return { id: 'new-row' }; }),
}));
const reader = vi.hoisted(() => ({ states: [] as Array<{ all: unknown[]; live: unknown[] }> }));
vi.mock('@/lib/prepare/read', async (orig) => ({
  ...(await orig<typeof import('@/lib/prepare/read')>()),
  preparedState: vi.fn(async () => reader.states.shift() ?? { all: [], live: [] }),
}));

import { resolveRequirements, composeAskSpeech, askPreamble, reusableAskText, standingAsBase, supersedeWithdrawnDrafts } from '@/lib/prepare/requirements';
import { askClaimsReadiness } from '@/lib/prepare/truth';
import { requireTaskId } from '@/lib/prepare/supply';
import { settlePrepNarration, narrationOrphaned } from '@/lib/prepare/narration';
import { BASE_OFFER_PREFIX } from '@/lib/room/ask-base';

type Op = { table: string; action: 'select' | 'update' | 'delete' | 'insert'; payload?: unknown; filters: Array<[string, unknown[]]> };
function fakeDb(rows: { pool: Array<Record<string, unknown>> }) {
  const log: Op[] = [];
  const respond = (op: Op, single: boolean): { data: unknown; error: null } => {
    const one = (x: unknown) => ({ data: single ? (Array.isArray(x) ? x[0] ?? null : x) : x, error: null });
    if (op.table === 'item_deliverables' && op.action === 'select') {
      const task = op.filters.find(([m, a]) => m === 'eq' && a[0] === 'task_id')?.[1][1];
      const tasks = op.filters.find(([m, a]) => m === 'in' && a[0] === 'task_id')?.[1][1] as string[] | undefined;
      const ids = op.filters.find(([m, a]) => m === 'in' && a[0] === 'id')?.[1][1] as string[] | undefined;
      return one(rows.pool.filter((r) => (task ? r.task_id === task : tasks ? tasks.includes(String(r.task_id)) : ids ? ids.includes(String(r.id)) : true)));
    }
    if (op.table === 'commitments') return one({ description: 'Provide details on slides 7&8 for remaining functions in interim report', created_at: '2026-09-10T14:59:47Z', source: 'manual', source_id: null });
    if (op.table === 'room_turns' && op.action === 'update') return one([{ id: 'prep-turn' }]);
    return one(single ? null : []);
  };
  const client = {
    from(table: string) {
      const op: Op = { table, action: 'select', filters: [] };
      const q: Record<string, unknown> = {};
      const chain = (name: string) => (...args: unknown[]) => { op.filters.push([name, args]); return q; };
      for (const m of ['eq', 'in', 'like', 'filter', 'is', 'not', 'neq', 'or', 'order', 'limit', 'range', 'select']) q[m] = chain(m);
      q.update = (p: unknown) => { op.action = 'update'; op.payload = p; return q; };
      q.delete = () => { op.action = 'delete'; return q; };
      q.insert = (p: unknown) => { op.action = 'insert'; op.payload = p; return q; };
      q.maybeSingle = () => { log.push(op); return Promise.resolve(respond(op, true)); };
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { log.push(op); return Promise.resolve(respond(op, false)).then(res, rej); };
      return q;
    },
  };
  return { client: client as never, log };
}

const LABEL = 'slides 7&8 details for remaining functions in interim report';
const OLD_FILE = { fileId: 'f-old', filename: 'Acme_Interim_Report_20260910.pptx', source: 'kb' };
const standingRow = () => ({
  id: 'row-1', task_id: requireTaskId(LABEL), content: 'Interim report — functions overview', created_at: '2026-09-11T00:00:00Z',
  metadata: { source: 'requirement_resolution', requirement: LABEL, attachment: OLD_FILE },
});
const args = { itemKind: 'commitment' as const, itemId: 'c-1', itemTitle: 'Provide details on slides 7&8 for remaining functions in interim report', entityId: null, requires: [{ label: LABEL }], work: 'send_file' as const };
const LIVE_FALSE_ASK = 'I have the details on slides 7&8 for remaining functions in interim report ready to go, but I need the data showing responses under 10 to include those as well.';

beforeEach(() => { ai.pick = null; retrieval.cands = []; pool.writes.length = 0; room.turns.length = 0; reader.states.length = 0; ai.say = 'I need the slides 7&8 details to finish the work on this — attach them or tell me where to look.'; });

describe('THE ASK SPEAKS TRUE', () => {
  it('the live ask\'s words claim readiness; the deterministic floor never does', () => {
    expect(askClaimsReadiness(LIVE_FALSE_ASK)).toBeTruthy();
    expect(askClaimsReadiness(askPreamble({ labels: [LABEL], itemTitle: args.itemTitle, work: 'send_file' }))).toBeNull();
    expect(askClaimsReadiness(askPreamble({ labels: [LABEL, 'the budget'], itemTitle: args.itemTitle, work: 'produce', haveFilenames: ['a.pdf'] }))).toBeNull();
  });
  it('a composed speech that claims readiness is refused — the floor speaks instead', async () => {
    ai.say = LIVE_FALSE_ASK;
    const say = await composeAskSpeech({} as never, 'u-1', { labels: [LABEL], itemTitle: args.itemTitle, work: 'send_file' });
    expect(say).toBe(askPreamble({ labels: [LABEL], itemTitle: args.itemTitle, work: 'send_file' }));
    ai.say = 'Once I have the slides 7&8 details I can send what was asked for — attach them or tell me where they are.';
    expect(await composeAskSpeech({} as never, 'u-1', { labels: [LABEL], itemTitle: args.itemTitle, work: 'send_file' })).toBe(ai.say);
  });
  it('words are re-stated only from a LIVE ask for the same labels + base whose speech is true', () => {
    const live = { text: 'Once I have the slides details I can send it.', archived_at: null, component: { state: { items: [LABEL] } } };
    expect(reusableAskText(live, [LABEL])).toBe(live.text);
    expect(reusableAskText({ ...live, archived_at: '2026-09-24T10:16:13Z' }, [LABEL])).toBeNull();
    expect(reusableAskText({ ...live, text: LIVE_FALSE_ASK }, [LABEL])).toBeNull();
    expect(reusableAskText(live, ['the document itself'])).toBeNull();
    expect(reusableAskText(live, [LABEL], { base: [OLD_FILE.filename] })).toBeNull();
  });
});

describe('THE BASE IS OFFERED (outcome over THE ONE RESOLVER)', () => {
  it('the standing file of a NEW-WORK requirement the pick does not verify becomes the base — row written, ask offers it', async () => {
    ai.pick = () => ({ kind: 'new_work', match: null, evidence: '' }); // the kind is the pick's own (the verdict has none)
    const { client, log } = fakeDb({ pool: [standingRow()] });
    const r = await resolveRequirements(client, 'u-1', args);
    expect(log.filter((o) => o.table === 'item_deliverables' && o.action === 'delete')).toHaveLength(1);
    const base = pool.writes.find((w) => String(w.taskId).startsWith('base:'));
    expect(base).toBeTruthy();
    expect(String(base!.title)).toBe(`${BASE_OFFER_PREFIX}: ${OLD_FILE.filename}`);
    expect(r.missing[0]?.base?.id).toBe('f-old');
    const ask = room.turns.find((t) => (t.component as { key?: string } | undefined)?.key === 'input_checklist')!;
    expect((ask.component as { state: { base?: string[] } }).state.base).toEqual([OLD_FILE.filename]);
    expect(askClaimsReadiness(String(ask.text))).toBeNull();
  });
  it('an EXISTING-artifact requirement the pick does not verify is unstaged with no base (nothing invented)', async () => {
    ai.pick = () => ({ kind: 'existing', match: null, evidence: '' });
    const { client } = fakeDb({ pool: [standingRow()] });
    const r = await resolveRequirements(client, 'u-1', args);
    expect(pool.writes.some((w) => String(w.taskId).startsWith('base:'))).toBe(false);
    expect(r.missing[0]?.base ?? null).toBeNull();
  });
  it('the pure rule: new work + older file + named by the request', () => {
    const f = { filename: OLD_FILE.filename, fileAt: '2026-09-10T00:00:00Z' };
    expect(standingAsBase({ kind: 'new_work', standing: f, requestAt: '2026-09-10T14:59:47Z', requestText: args.itemTitle })).toBe(true);
    expect(standingAsBase({ kind: 'existing', standing: f, requestAt: '2026-09-10T14:59:47Z', requestText: args.itemTitle })).toBe(false);
    expect(standingAsBase({ kind: 'new_work', standing: { ...f, fileAt: '2026-09-12T00:00:00Z', filename: 'Acme_Interim_Report.pptx' }, requestAt: '2026-09-10T14:59:47Z', requestText: args.itemTitle })).toBe(false);
    expect(standingAsBase({ kind: 'new_work', standing: { ...f, filename: 'Board_Minutes_20260901.docx' }, requestAt: '2026-09-10T14:59:47Z', requestText: args.itemTitle })).toBe(false);
  });
});

describe('THE NARRATION FOLLOWS ITS ARTIFACT', () => {
  it('orphaned only on a positive finding', () => {
    expect(narrationOrphaned({ live: [], all: [{}] })).toBe(true);
    expect(narrationOrphaned({ live: [], all: [] }, 1)).toBe(true);
    expect(narrationOrphaned({ live: [], all: [] })).toBe(false); // an empty read proves nothing
    expect(narrationOrphaned({ live: [{}], all: [{}] }, 2)).toBe(false);
  });
  it('the settle archives the item\'s prep line (never deletes) when nothing live remains', async () => {
    reader.states.push({ all: [{ kind: 'reply_draft' }], live: [] });
    const { client, log } = fakeDb({ pool: [] });
    expect(await settlePrepNarration(client, 'u-1', { kind: 'commitment', id: 'c-1' })).toBe(1);
    const op = log.find((o) => o.table === 'room_turns')!;
    expect(op.action).toBe('update');
    expect((op.payload as { archived_at?: string }).archived_at).toBeTruthy();
    expect(op.filters.find(([m, a]) => m === 'in' && a[0] === 'dedupe_key')?.[1][1]).toContain('prep:commit:c-1');
  });
  it('a withdrawn machine nudge (the inverted chase) is filed into the version chain and the narration settles', async () => {
    const nudge = { kind: 'nudge_draft', falseClaim: true, hand: null, content: 'Just checking in…', payload: { store: 'pool', rowId: 'n1', taskId: null } };
    reader.states.push({ all: [nudge], live: [] }, { all: [], live: [] }, { all: [], live: [] });
    const { client, log } = fakeDb({ pool: [{ id: 'n1', task_id: null, content: 'Just checking in…', metadata: { agentName: 'Clara' } }] });
    expect(await supersedeWithdrawnDrafts(client, 'u-1', { kind: 'commitment', id: 'c-1' }, 'lane landed on an ask')).toBe(1);
    const filed = log.find((o) => o.table === 'item_deliverables' && o.action === 'update')!;
    expect((filed.payload as { metadata: { version_of: string } }).metadata.version_of).toBe('superseded:withdrawn');
    expect(log.some((o) => o.table === 'item_deliverables' && o.action === 'delete')).toBe(false);
    expect(log.some((o) => o.table === 'room_turns' && o.action === 'update')).toBe(true);
  });
});
