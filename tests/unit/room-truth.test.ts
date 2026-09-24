// W13.5 · A WITHDRAWN ARTIFACT TAKES ITS WORDS AND ITS BUTTON WITH IT — the serve-time truth (pure) and
// the OUTCOME that mattered live: THE ONE RESOLVER demotes an older-law require row to the BASE of new
// work, and the requirement's ask lands LIVE in the room even though an earlier ask for the same item
// was ARCHIVED (the production dedupe index is not partial on archived_at). Zero AI (the model is a
// stub), zero DB (an in-memory store that enforces the unique index).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({ pick: null as null | ((prompt: string) => unknown) }));
vi.mock('@/lib/ai/call', () => ({
  aiCall: vi.fn(async ({ prompt }: { prompt: string }) => {
    if (/ATTACHABLE THINGS/.test(prompt)) return { json: { attachable: [1] } };
    if (/CANDIDATES:/.test(prompt)) return { json: ai.pick ? ai.pick(prompt) : null };
    return { json: { say: 'I need the slides 7&8 details to finish the work on this — attach them or tell me where to look.' } };
  }),
}));
vi.mock('@/lib/knowledge/resolve', async (orig) => ({
  ...(await orig<typeof import('@/lib/knowledge/resolve')>()),
  resolveFileUniversal: vi.fn(async () => []),
  emailAttachmentDates: vi.fn(async () => new Map<string, string>()),
}));
const pool = vi.hoisted(() => ({ writes: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/home/deliverable-pool', () => ({
  writeDeliverable: vi.fn(async (_c: unknown, _u: string, input: Record<string, unknown>) => { pool.writes.push(input); return { id: 'new-row' }; }),
}));

import { resolveRequirements } from '@/lib/prepare/requirements';
import { requireTaskId } from '@/lib/prepare/supply';
import { serveTimeTruth } from '@/lib/room/serve-truth';

type Row = Record<string, unknown>;
function fakeDb(seed: { deliverables: Row[]; turns: Row[] }) {
  const tables: Record<string, Row[]> = {
    item_deliverables: [...seed.deliverables], room_turns: [...seed.turns],
    knowledge_files: [{ id: 'f-old', origin: null, last_modified_at: '2026-09-11T13:26:00Z', indexed_at: '2026-09-11T13:26:00Z' }],
    commitments: [{ id: 'c-1', user_id: 'u-1', description: 'Provide details on slides 7&8 for remaining functions in interim report', created_at: '2026-09-10T14:59:47Z', source: 'manual', source_id: null }],
  };
  let seq = 0;
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const preds: Array<(r: Row) => boolean> = [];
      let action: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: Row = {};
      const q: Record<string, unknown> = {};
      const val = (r: Row, c: string): unknown => {
        const m = /^(\w+)->>(\w+)$/.exec(c) ?? /^(\w+)->(\w+)$/.exec(c);
        if (m) { const o = (r[m[1]] ?? {}) as Row; return o?.[m[2]] ?? null; }
        return r[c] ?? null;
      };
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { preds.push((r) => val(r, c) === v); return q; };
      q.neq = (c: string, v: unknown) => { preds.push((r) => val(r, c) !== v); return q; };
      q.in = (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(val(r, c))); return q; };
      q.is = (c: string, v: unknown) => { preds.push((r) => val(r, c) === v); return q; };
      q.not = (c: string, _op: string, v: unknown) => { preds.push((r) => val(r, c) !== v); return q; };
      q.like = (c: string, pat: string) => { const re = new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`); preds.push((r) => re.test(String(val(r, c) ?? ''))); return q; };
      q.filter = (c: string, op: string, v: unknown) => { preds.push((r) => (op === 'is' ? val(r, c) === null : val(r, c) === v)); return q; };
      q.contains = () => q; q.or = () => q; q.order = () => q; q.limit = () => q; q.range = () => q;
      q.insert = (p: Row) => { action = 'insert'; payload = p; return q; };
      q.update = (p: Row) => { action = 'update'; payload = p; return q; };
      q.delete = () => { action = 'delete'; return q; };
      const run = (): { data: unknown; error: unknown } => {
        const hit = rows.filter((r) => preds.every((p) => p(r)));
        if (action === 'insert') {
          if (table === 'room_turns' && payload.dedupe_key
            && rows.some((r) => r.user_id === payload.user_id && r.room_key === payload.room_key && r.dedupe_key === payload.dedupe_key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          rows.push({ id: `${table}-${++seq}`, archived_at: null, ...payload });
          return { data: null, error: null };
        }
        if (action === 'update') { for (const r of hit) Object.assign(r, payload); return { data: null, error: null }; }
        if (action === 'delete') { for (const r of hit) rows.splice(rows.indexOf(r), 1); return { data: null, error: null }; }
        return { data: hit, error: null };
      };
      q.maybeSingle = () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }); };
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
      return q;
    },
  };
  return { client: client as never, tables };
}

const LABEL = 'slides 7&8 details';
const olderLawRow = {
  id: 'row-1', user_id: 'u-1', kind: 'commitment', entity_id: 'c-1', task_id: requireTaskId(LABEL), content: 'Interim report — functions overview', created_at: '2026-09-11T00:00:00Z',
  metadata: { source: 'requirement_resolution', requirement: LABEL, attachment: { fileId: 'f-old', filename: 'Acme_Interim_Report_20260910.pptx', source: 'kb' } },
};
const archivedAsk = {
  id: 'ask-old', user_id: 'u-1', room_key: 'commitment:c-1', dedupe_key: 'requires:c-1', archived_at: '2026-09-24T10:16:13Z',
  role: 'system', text: 'the earlier ask', component: null,
};

beforeEach(() => { ai.pick = null; pool.writes.length = 0; });

describe('THE ASK MUST STAND (outcome)', () => {
  it('an unstaged new-work requirement leaves a LIVE input_checklist ask, even over an archived ask for the same item', async () => {
    ai.pick = () => ({ kind: 'new_work', match: 0, evidence: 'Interim_Report' });
    const { client, tables } = fakeDb({ deliverables: [olderLawRow], turns: [archivedAsk] });
    const r = await resolveRequirements(client, 'u-1', {
      itemKind: 'commitment', itemId: 'c-1', itemTitle: 'Provide details on slides 7&8 in the interim report', entityId: null,
      requires: [{ label: LABEL }], work: 'send_file',
    });
    expect(r.have).toHaveLength(0);
    expect(r.missing[0]?.label).toBe(LABEL);
    const live = tables.room_turns.filter((t) => t.dedupe_key === 'requires:c-1' && !t.archived_at);
    expect(live).toHaveLength(1);
    expect((live[0].component as { key?: string; state?: { items?: string[] } }).key).toBe('input_checklist');
    expect((live[0].component as { state: { items: string[] } }).state.items).toContain(LABEL);
    // the archived ask stays in its session, its key released
    expect(tables.room_turns.find((t) => t.id === 'ask-old')?.archived_at).toBeTruthy();
    expect(tables.room_turns.find((t) => t.id === 'ask-old')?.dedupe_key).not.toBe('requires:c-1');
  });
});

describe('SERVE-TIME TRUTH (pure)', () => {
  const ref = 'commit:c-1';
  const brief = { text: "I've drafted the reply to Sam — the draft is ready to review.", move: { label: 'Review the reply draft', ref }, offers: [], at: null };
  it('withholds a last-good whose draft claim no longer renders; serves it while the draft is live', () => {
    expect(serveTimeTruth(brief, { board: [{ ref, prepared: [] }], hasDecision: false, hasAsk: true }).response).toBeNull();
    expect(serveTimeTruth(brief, { board: [{ ref, prepared: ['reply draft'] }], hasDecision: false, hasAsk: true }).response?.move?.ref).toBe(ref);
  });
  it('drops a MOVE whose object is withdrawn, keeping honest words', () => {
    const v = serveTimeTruth({ ...brief, text: 'Sam is still waiting on the slides.' }, { board: [{ ref, prepared: [] }], hasDecision: false, hasAsk: true });
    expect(v.response?.move).toBeNull();
    expect(v.response?.text).toBe('Sam is still waiting on the slides.');
  });
});
