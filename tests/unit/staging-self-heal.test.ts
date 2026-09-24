// W13.2 · THE STAGING LAW IS VERSIONED, AND IT HEALS ITSELF — the pure rulings (stamp, stale, the
// serving edge's settled guard, the re-verify decision, the reader's stored-draft withdrawal) and an
// OUTCOME run of THE ONE RESOLVER over a fake pool: a row staged under the old law is re-verified on its
// next touch, demoted/restamped/held by the same pick, and an AI outage never unstages. Zero AI (the
// model call is a stub), zero DB (an in-memory query recorder).
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── the stubs: the model call, retrieval, the room's writers, the pool writer ──
const ai = vi.hoisted(() => ({ pick: null as null | ((prompt: string) => unknown), prompts: [] as string[] }));
vi.mock('@/lib/ai/call', () => ({
  aiCall: vi.fn(async ({ prompt }: { prompt: string }) => {
    ai.prompts.push(prompt);
    if (/ATTACHABLE THINGS/.test(prompt)) return { json: { attachable: [1] } };
    if (/CANDIDATES:/.test(prompt)) {
      if (!ai.pick) throw new Error('model unavailable');
      return { json: ai.pick(prompt) };
    }
    return { json: { say: 'I need the slides 7&8 details to finish the work on this — attach them or tell me where to look.' } };
  }),
}));
const retrieval = vi.hoisted(() => ({ cands: [] as unknown[] }));
vi.mock('@/lib/knowledge/resolve', async (orig) => ({
  ...(await orig<typeof import('@/lib/knowledge/resolve')>()),
  resolveFileUniversal: vi.fn(async () => retrieval.cands),
  emailAttachmentDates: vi.fn(async () => new Map<string, string>()),
}));
vi.mock('@/lib/room/turns', async (orig) => ({
  ...(await orig<typeof import('@/lib/room/turns')>()),
  roomKeyForItem: vi.fn(async () => 'room:test'),
  writeRoomTurn: vi.fn(async () => null),
}));
const pool = vi.hoisted(() => ({ writes: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/home/deliverable-pool', () => ({
  writeDeliverable: vi.fn(async (_c: unknown, _u: string, input: Record<string, unknown>) => { pool.writes.push(input); return { id: 'new-row' }; }),
}));

import {
  STAGING_LAW_VERSION, stagingLawStale, servingEdgeShouldResolve, reverifyDecision, standingCandidateOf,
  resolveRequirements, reverifyStaleStaging,
} from '@/lib/prepare/requirements';
import { requireTaskId } from '@/lib/prepare/supply';
import { storedDraftWithdrawal, stampTruth, preparedFromSourceData } from '@/lib/prepare/read';
import { decideRegeneration } from '@/lib/prepare/hand';

// ── the in-memory query recorder ──
type Op = { table: string; action: 'select' | 'update' | 'delete' | 'insert'; payload?: unknown; filters: Array<[string, unknown[]]> };
function fakeDb(rows: { standing: Array<Record<string, unknown>>; files?: Array<Record<string, unknown>> }) {
  const log: Op[] = [];
  const respond = (op: Op, single: boolean): { data: unknown; error: null } => {
    const one = (x: unknown) => ({ data: single ? (Array.isArray(x) ? x[0] ?? null : x) : x, error: null });
    if (op.table === 'item_deliverables' && op.action === 'select') {
      const task = op.filters.find(([m, a]) => m === 'eq' && a[0] === 'task_id')?.[1][1];
      const tasks = op.filters.find(([m, a]) => m === 'in' && a[0] === 'task_id')?.[1][1] as string[] | undefined;
      const hit = rows.standing.filter((r) => (task ? r.task_id === task : tasks ? tasks.includes(String(r.task_id)) : true));
      return one(hit);
    }
    if (op.table === 'knowledge_files') return one(rows.files ?? []);
    if (op.table === 'commitments') return one({ description: 'Provide details on slides 7&8 for remaining functions in interim report', created_at: '2026-09-10T14:59:47Z', source: 'manual', source_id: null });
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

const LABEL = 'slides 7&8 details';
const OLD_FILE = { fileId: 'f-old', filename: 'Acme_Interim_Report_20260910.pptx', source: 'kb' };
const standingRow = (meta: Record<string, unknown> = {}) => ({
  id: 'row-1', task_id: requireTaskId(LABEL), content: 'Interim report — functions overview', created_at: '2026-09-11T00:00:00Z',
  metadata: { source: 'requirement_resolution', requirement: LABEL, attachment: OLD_FILE, ...meta },
});
const args = { itemKind: 'commitment' as const, itemId: 'c-1', itemTitle: 'Provide details on slides 7&8 in the interim report', entityId: null, requires: [{ label: LABEL }], work: 'produce' as const };
const deletes = (log: Op[]) => log.filter((o) => o.table === 'item_deliverables' && o.action === 'delete');
const updates = (log: Op[]) => log.filter((o) => o.table === 'item_deliverables' && o.action === 'update');

beforeEach(() => { ai.pick = null; ai.prompts.length = 0; retrieval.cands = []; pool.writes.length = 0; });

describe('the versioned stamp', () => {
  it('stamps the current law; an unstamped or older resolver row is stale; typed supplies never are', () => {
    expect(STAGING_LAW_VERSION).toBeGreaterThanOrEqual(2);
    expect(stagingLawStale(standingRow().metadata)).toBe(true);
    expect(stagingLawStale(standingRow({ stagingLaw: STAGING_LAW_VERSION - 1 }).metadata)).toBe(true);
    expect(stagingLawStale(standingRow({ stagingLaw: STAGING_LAW_VERSION }).metadata)).toBe(false);
    expect(stagingLawStale({ ...standingRow().metadata, via: 'typed' })).toBe(false);
    expect(stagingLawStale({ source: 'requirement_resolution' })).toBe(false); // no pointer
  });
  it('the serving edge never reads a stale row as settled — even with an ask standing', () => {
    const cur = { metadata: standingRow({ stagingLaw: STAGING_LAW_VERSION }).metadata };
    const old = { metadata: standingRow().metadata };
    expect(servingEdgeShouldResolve({ askStands: false, requiredCount: 1, staged: [cur] })).toBe(false);
    expect(servingEdgeShouldResolve({ askStands: false, requiredCount: 1, staged: [old] })).toBe(true);
    expect(servingEdgeShouldResolve({ askStands: true, requiredCount: 2, staged: [old] })).toBe(true);
    expect(servingEdgeShouldResolve({ askStands: true, requiredCount: 2, staged: [cur] })).toBe(false);
    expect(servingEdgeShouldResolve({ askStands: false, requiredCount: 2, staged: [cur] })).toBe(true);
  });
  it('the re-verify ruling: no answer holds; the same file restamps; demotion and an unproven stale row unstage', () => {
    const base = { standingFileId: 'f-old', stale: true };
    expect(reverifyDecision({ ...base, judged: false, candidateId: null })).toBe('hold');
    expect(reverifyDecision({ ...base, judged: true, candidateId: 'f-old' })).toBe('restamp');
    expect(reverifyDecision({ ...base, judged: true, candidateId: 'f-new' })).toBe('replace');
    expect(reverifyDecision({ ...base, judged: true, candidateId: null, demoted: 'base' })).toBe('demote');
    expect(reverifyDecision({ ...base, judged: true, candidateId: null })).toBe('unproven');
    expect(reverifyDecision({ ...base, stale: false, judged: true, candidateId: null })).toBe('hold');
  });
  it('the standing candidate is the FILE (real id, source, own date), never the pointer row', () => {
    const c = standingCandidateOf(standingRow(), '2026-09-11T13:26:00Z')!;
    expect(c.id).toBe('f-old');
    expect(c.source).toBe('kb');
    expect(c.fileAt).toBe('2026-09-10T00:00:00.000Z'); // the name's own date beats the late index
    expect(standingCandidateOf({ metadata: { source: 'user' } }, null)).toBeNull();
  });
});

describe('THE ONE RESOLVER re-verifies an older-law row on its next touch (outcome)', () => {
  it('new work satisfied by the old report → unstaged through the one writer, re-staged as the BASE, stamped', async () => {
    ai.pick = () => ({ kind: 'new_work', match: 0, evidence: 'Interim_Report' });
    const { client, log } = fakeDb({ standing: [standingRow()], files: [{ id: 'f-old', origin: null, last_modified_at: '2026-09-11T13:26:00Z', indexed_at: '2026-09-11T13:26:00Z' }] });
    const r = await resolveRequirements(client, 'u-1', args);
    expect(r.have).toHaveLength(0);
    expect(r.missing[0]?.base?.id).toBe('f-old');
    expect(deletes(log)).toHaveLength(1);
    const base = pool.writes.find((w) => String(w.taskId).startsWith('base:'))!;
    expect((base.metadata as Record<string, unknown>).stagingLaw).toBe(STAGING_LAW_VERSION);
    expect(((base.metadata as { attachment: { fileId: string } }).attachment).fileId).toBe('f-old');
    expect(pool.writes.some((w) => String(w.taskId).startsWith('require:'))).toBe(false);
  });
  it('an AI outage never unstages: the row stands untouched (still stale) and still reads as staged', async () => {
    ai.pick = null; // the pick throws
    const { client, log } = fakeDb({ standing: [standingRow()] });
    const r = await resolveRequirements(client, 'u-1', args);
    expect(deletes(log)).toHaveLength(0);
    expect(updates(log)).toHaveLength(0);
    expect(pool.writes).toHaveLength(0);
    expect(r.have[0]?.file?.id).toBe('f-old');
  });
  it('the same file re-verified as the deliverable is RESTAMPED IN PLACE (no delete, no re-insert — not new supply)', async () => {
    ai.pick = () => ({ kind: 'existing', match: 0, evidence: 'Interim_Report' });
    // retrieval also finds the pointer row itself (pool) and the file (kb): neither is a second candidate
    retrieval.cands = [
      { source: 'pool', id: 'row-1', filename: OLD_FILE.filename, snippet: '', score: 2, fileAt: null },
      { source: 'kb', id: 'f-old', filename: OLD_FILE.filename, snippet: '', score: 0.9, fileAt: null },
    ];
    const { client, log } = fakeDb({ standing: [standingRow()] });
    const r = await resolveRequirements(client, 'u-1', { ...args, itemTitle: 'Send the interim report' });
    const pickPrompt = ai.prompts.find((p) => /CANDIDATES:/.test(p))!;
    expect(pickPrompt).toMatch(/\n0\. "Acme_Interim_Report_20260910\.pptx"/);
    expect(pickPrompt).not.toMatch(/\n1\. /);
    expect(deletes(log)).toHaveLength(0);
    expect(pool.writes).toHaveLength(0);
    const up = updates(log);
    expect(up).toHaveLength(1);
    expect(((up[0].payload as { metadata: Record<string, unknown> }).metadata).stagingLaw).toBe(STAGING_LAW_VERSION);
    expect(r.have[0]?.file?.id).toBe('f-old');
  });
  it('a stale row the current pick cleanly does not verify is unstaged (no evidence, no match); a current row is held', async () => {
    ai.pick = () => ({ kind: 'existing', match: null, evidence: '' });
    const stale = fakeDb({ standing: [standingRow()] });
    await resolveRequirements(stale.client, 'u-1', args);
    expect(deletes(stale.log)).toHaveLength(1);
    const current = fakeDb({ standing: [standingRow({ stagingLaw: STAGING_LAW_VERSION })] });
    const r = await resolveRequirements(current.client, 'u-1', args);
    expect(deletes(current.log)).toHaveLength(0);
    expect(r.have[0]?.file?.id).toBe('f-old');
  });
  it('the self-heal entry does nothing (one read, zero AI) when no row is stale', async () => {
    const { client, log } = fakeDb({ standing: [standingRow({ stagingLaw: STAGING_LAW_VERSION })] });
    const rv = await reverifyStaleStaging(client, 'u-1', args);
    expect(rv).toEqual({ stale: 0, ran: false });
    expect(ai.prompts).toHaveLength(0);
    expect(log).toHaveLength(1);
  });
});

describe('the inbox draft door reads THE ONE READER', () => {
  const sd = (draft: Record<string, unknown>) => ({ subject: 'Interim report', body: 'Please add slides 7 and 8.', received_at: '2026-09-10T14:59:47Z', draft });
  it('a stored draft riding the item\'s BASE is withdrawn, and the door regenerates it (decideRegeneration)', () => {
    const arts = preparedFromSourceData(sd({ body: 'Here is the report.', attachment: OLD_FILE }) as never);
    stampTruth(arts, { text: 'x', anchorIso: null, obligationOpen: false, baseFileIds: ['f-old'] });
    const why = storedDraftWithdrawal(arts);
    expect(why).toMatch(/current version/);
    expect(decideRegeneration({ exists: true, handHeld: false, groundMoved: false, nonLive: !!why }).action).toBe('regenerate');
  });
  it('a live stored draft is served; a draft that says "attached" with nothing staged is withdrawn', () => {
    const live = preparedFromSourceData(sd({ body: 'Thanks — I will send the updated report on Friday.' }) as never);
    stampTruth(live, { text: 'x', anchorIso: null, obligationOpen: false });
    expect(storedDraftWithdrawal(live)).toBeNull();
    const lie = preparedFromSourceData(sd({ body: 'Please find attached the updated report.' }) as never);
    stampTruth(lie, { text: 'x', anchorIso: null, obligationOpen: false });
    expect(storedDraftWithdrawal(lie)).not.toBeNull();
  });
  it('the user\'s own edit is never judged here', () => {
    const arts = preparedFromSourceData(sd({ body: 'Here is the report.', attachment: OLD_FILE }) as never);
    arts[0].hand = { editedAt: '2026-09-12T00:00:00Z' };
    stampTruth(arts, { text: 'x', anchorIso: null, obligationOpen: false, baseFileIds: ['f-old'] });
    expect(storedDraftWithdrawal(arts)).toBeNull();
  });
});
