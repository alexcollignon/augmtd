// W14.1 · ONE READER, ONE ANSWER — the pure rulings (the inbox obligation, the inbox staging stamp and
// its pool proof, the one ground rule, the ladder's receipt kind, the carried standing file) and an
// OUTCOME run of THE ONE RESOLVER over a fake pool whose only trace of the pre-request file is an
// UNSTAGED doc-send draft: the base is offered. Zero AI (the model call is a stub), zero DB.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({ pick: null as null | ((prompt: string) => unknown) }));
vi.mock('@/lib/ai/call', () => ({
  aiCall: vi.fn(async ({ prompt }: { prompt: string }) => {
    if (/ATTACHABLE THINGS/.test(prompt)) return { json: { attachable: [1] } };
    if (/CANDIDATES:/.test(prompt)) {
      if (!ai.pick) throw new Error('model unavailable');
      return { json: ai.pick(prompt) };
    }
    return { json: { say: 'I need the slides 7&8 details to finish the work on this — attach them or tell me where to look.' } };
  }),
}));
vi.mock('@/lib/knowledge/resolve', async (orig) => ({
  ...(await orig<typeof import('@/lib/knowledge/resolve')>()),
  resolveFileUniversal: vi.fn(async () => []),
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
  inboxTruthFacts, draftStagingStale, proveStagingByPool, preparedFromSourceData, groundFromNewest,
} from '@/lib/prepare/read';
import { STAGING_LAW_VERSION } from '@/lib/prepare/staging-law';
import { carriedDraftFileRows, labelForCarriedFile, resolveRequirements } from '@/lib/prepare/requirements';
import { ladderReceiptKind, receiptWordOf } from '@/lib/home/calm';
import { STATE_WORDS } from '@/lib/work/machine';

const FILE = { fileId: 'f-old', filename: 'Acme_Interim_Report_20260910.pptx', source: 'kb' };

describe('A · the inbox obligation is the understanding\'s', () => {
  it('you_owe opens the obligation; every other ownership (or none) keeps it closed', () => {
    expect(inboxTruthFacts({ understanding: { ownership: 'you_owe' } })?.obligationOpen).toBe(true);
    expect(inboxTruthFacts({ understanding: { ownership: 'awaiting' } })?.obligationOpen).toBe(false);
    expect(inboxTruthFacts({ understanding: null })?.obligationOpen).toBe(false);
    expect(inboxTruthFacts({})?.obligationOpen).toBe(false);
    expect(inboxTruthFacts(null)).toBeNull();
  });
});

describe('B · the inbox staging stamp', () => {
  it('an unstamped machine attachment is stale until the stamp or a current-law resolver row proves it', () => {
    expect(draftStagingStale({})).toBe(true);
    expect(draftStagingStale({ stagingLaw: STAGING_LAW_VERSION })).toBe(false);
    const arts = preparedFromSourceData({ draft: { body: 'b', attachment: FILE } } as never);
    expect(arts[0].stagingStale).toBe(true);
    const req = { task_id: 'require:x', metadata: { source: 'requirement_resolution', attachment: FILE, stagingLaw: STAGING_LAW_VERSION } };
    expect(proveStagingByPool(preparedFromSourceData({ draft: { body: 'b', attachment: FILE } } as never), [req])[0].stagingStale).toBeUndefined();
    expect(proveStagingByPool(preparedFromSourceData({ draft: { body: 'b', attachment: FILE } } as never),
      [{ ...req, metadata: { ...req.metadata, version_of: 'superseded:unstaged' } }])[0].stagingStale).toBe(true);
    expect(preparedFromSourceData({ draft: { body: 'b', attachment: FILE, stagingLaw: STAGING_LAW_VERSION } } as never)[0].stagingStale).toBeUndefined();
  });
});

describe('H · one ground rule, one receipt kind', () => {
  it('groundFromNewest: the newest inbound, else the row\'s own date, else none; an unreadable read is exempt', () => {
    const newest = new Map([['t', { id: 'e2', receivedAt: '2026-09-22T00:00:00Z' }]]);
    expect(groundFromNewest({ key: 'k', threadId: 't', fallbackAt: '2026-09-20T00:00:00Z' }, newest)).toEqual({ emailId: 'e2', receivedAt: '2026-09-22T00:00:00Z' });
    expect(groundFromNewest({ key: 'k', threadId: 'x', fallbackAt: '2026-09-20T00:00:00Z' }, newest)).toEqual({ emailId: null, receivedAt: '2026-09-20T00:00:00Z' });
    expect(groundFromNewest({ key: 'k', threadId: 't', fallbackAt: null }, null)).toEqual({ emailId: null, receivedAt: null });
  });
  it('the receipt kind is the ladder rung\'s: ready → the document, approval → the send, motion/sent → none', () => {
    expect(ladderReceiptKind('decision', STATE_WORDS.ready)).toBe('deliverable');
    expect(ladderReceiptKind('paste_pack', STATE_WORDS.ready)).toBe('paste_pack');
    expect(ladderReceiptKind('decision', STATE_WORDS.awaiting_decision)).toBe('decision');
    expect(ladderReceiptKind('invite', STATE_WORDS.awaiting_approval)).toBe('invite');
    expect(ladderReceiptKind('deliverable', STATE_WORDS.awaiting_approval)).toBeNull();
    expect(ladderReceiptKind('reply_draft', STATE_WORDS.preparing)).toBe(false);
    expect(ladderReceiptKind('reply_draft', STATE_WORDS.committed)).toBe(false);
    expect(ladderReceiptKind('decision', null)).toBe('decision');
    expect(receiptWordOf('Clara', 'decision', 'commitment', STATE_WORDS.ready)).toBe('ready to review');
    expect(receiptWordOf('draft', 'reply_draft', 'reply', STATE_WORDS.preparing)).toBeNull();
  });
});

describe('G · the carried file is a standing file', () => {
  it('reads filed machine drafts\' files once; never a base/requirement/live/sent row; an inbox draft only while unproven', () => {
    const d = (vof: string | null, extra: Record<string, unknown> = {}) => ({ task_id: 'prepare-pass-docsend', type: 'draft', content: 'x', metadata: { attachment: FILE, ...(vof ? { version_of: vof } : {}), ...extra } });
    expect(carriedDraftFileRows([d('superseded:unstaged'), d('superseded:withdrawn')])).toHaveLength(1);
    expect(carriedDraftFileRows([d(null), d('superseded:unstaged', { role: 'base' }), d('superseded:unstaged', { sent_at: 'x' })])).toHaveLength(0);
    expect(carriedDraftFileRows([{ task_id: 'require:x', type: 'file', metadata: { version_of: 'superseded:unstaged', attachment: FILE } }])).toHaveLength(0);
    expect(carriedDraftFileRows([], { body: 'b', attachment: FILE }, true)).toHaveLength(1);
    expect(carriedDraftFileRows([], { body: 'b', attachment: FILE }, false)).toHaveLength(0);
    expect(labelForCarriedFile(FILE.filename, ['a', 'b'])).toBeNull();
  });
});

// ── the resolver over a fake pool whose only trace of the old file is an UNSTAGED doc-send draft ──
function fakeDb(poolRows: Array<Record<string, unknown>>) {
  const log: Array<{ table: string; action: string }> = [];
  const client = {
    from(table: string) {
      const op = { table, action: 'select', filters: [] as Array<[string, unknown[]]> };
      const q: Record<string, unknown> = {};
      const chain = (name: string) => (...args: unknown[]) => { op.filters.push([name, args]); return q; };
      for (const m of ['eq', 'in', 'like', 'filter', 'is', 'not', 'neq', 'or', 'order', 'limit', 'range', 'select']) q[m] = chain(m);
      q.update = () => { op.action = 'update'; return q; };
      q.delete = () => { op.action = 'delete'; return q; };
      const respond = (single: boolean) => {
        log.push(op);
        let data: unknown = single ? null : [];
        if (table === 'item_deliverables' && op.action === 'select') {
          const task = op.filters.find(([m, a]) => m === 'eq' && a[0] === 'task_id')?.[1][1];
          const tasks = op.filters.find(([m, a]) => m === 'in' && a[0] === 'task_id')?.[1][1] as string[] | undefined;
          const hit = poolRows.filter((r) => (task ? r.task_id === task : tasks ? tasks.includes(String(r.task_id)) : true));
          data = single ? hit[0] ?? null : hit;
        }
        if (table === 'commitments') data = { description: 'Provide details on slides 7&8 for remaining functions in the interim report', created_at: '2026-09-10T14:59:47Z', source: 'manual', source_id: null };
        return Promise.resolve({ data, error: null });
      };
      q.maybeSingle = () => respond(true);
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => respond(false).then(res, rej);
      return q;
    },
  };
  return { client: client as never, log };
}
const LABEL = 'slides 7&8 details for remaining functions in interim report';
const args = { itemKind: 'commitment' as const, itemId: 'c-1', itemTitle: 'Provide details on slides 7&8 in the interim report', entityId: null, requires: [{ label: LABEL }], work: 'produce' as const };
const unstagedDraft = { id: 'd-1', task_id: 'prepare-pass-docsend', type: 'draft', content: 'The report now includes slides 7 and 8. Document is attached.', created_at: '2026-09-23T22:22:00Z',
  metadata: { source: 'preparation_pass', attachment: FILE, version_of: 'superseded:unstaged' } };

beforeEach(() => { ai.pick = null; pool.writes.length = 0; });

describe('G · THE ONE RESOLVER offers the base from an unstaged draft\'s file (outcome)', () => {
  it('the pick sees the carried file first; new work demotes it to the BASE — staged under base:, the ask names it', async () => {
    const prompts: string[] = [];
    ai.pick = (p) => { prompts.push(String(p)); return { kind: 'new_work', match: 0, evidence: 'Interim_Report' }; };
    const { client } = fakeDb([unstagedDraft]);
    const r = await resolveRequirements(client, 'u-1', args);
    expect(prompts[0]).toContain(FILE.filename);
    expect(prompts[0]).not.toContain('Document is attached');       // the draft's words never describe the file
    expect(r.have).toHaveLength(0);
    expect(r.missing[0]?.base?.id).toBe(FILE.fileId);
    const base = pool.writes.find((w) => String(w.taskId).startsWith('base:'))!;
    expect(((base.metadata as { attachment: { fileId: string } }).attachment).fileId).toBe(FILE.fileId);
  });
  it('the pick matches nothing but judges new work → the SAME code rules still make the carried file the base', async () => {
    ai.pick = () => ({ kind: 'new_work', match: null, evidence: '' });
    const { client } = fakeDb([unstagedDraft]);
    const r = await resolveRequirements(client, 'u-1', args);
    expect(r.missing[0]?.base?.id).toBe(FILE.fileId);
    expect(pool.writes.some((w) => String(w.taskId).startsWith('base:'))).toBe(true);
  });
  it('an existing-artifact ask, or an AI outage, never invents a base', async () => {
    ai.pick = () => ({ kind: 'existing', match: null, evidence: '' });
    const { client } = fakeDb([unstagedDraft]);
    const r = await resolveRequirements(client, 'u-1', args);
    expect(r.missing[0]?.base).toBeUndefined();
    ai.pick = null;
    const r2 = await resolveRequirements(fakeDb([unstagedDraft]).client, 'u-1', args);
    expect(r2.missing[0]?.base).toBeUndefined();
    expect(pool.writes.some((w) => String(w.taskId).startsWith('base:'))).toBe(false);
  });
});
