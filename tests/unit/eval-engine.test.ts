// W26 — THE QUALITY ENGINE, zero AI: the neutral renderer, the world builder (seed/teardown symmetry,
// refuses real users, the probe write fence), labelled metrics, the runner end to end with fakes,
// merge / recheck, the coverage gate, the reason-first judge parser, and the fixture contract's
// hygiene over every authored case.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { renderWorld, answerSchema } from '../../scripts/lib/eval/engine/neutral';
import {
  resolveWhen, resolveWorld, fillTemplate, localDate, zonedToUtc, seedWorld, teardownWorld, probeWriteVerdict, keyOfId, PROBE_EMAILS, forgetLiveWorlds,
  type World,
} from '../../scripts/lib/eval/engine/world';
import { scoreCase, aggregateField, primaryValue, pairedBootstrap, repeatConsistency, costOf } from '../../scripts/lib/eval/engine/metrics';
import { runEngine, HostPool, type TierEnv, type PlainSystem, type MeterPort, type EngineResult } from '../../scripts/lib/eval/engine/runner';
import { summarizeSurface, mergeEngine, recheckEngine, renderEngineReport } from '../../scripts/lib/eval/engine/report';
import { checkCoverage, scanCallSites, scanCardKinds } from '../../scripts/lib/eval/engine/coverage';
import { buildRubricPrompt, parseRubric, parseAnswerJSON } from '../../scripts/lib/eval/engine/judge';
import { fixtureProblems } from '../../scripts/lib/eval/engine/expand';
import { selfCheckProblems } from '../../scripts/lib/eval/engine/selfcheck';
import { ADAPTERS } from '../../scripts/lib/eval/engine/registry';
import { matchObligations } from '../../scripts/lib/eval/engine/adapters/commitment-extraction';
import { EDGE_KINDS, type AnyAdapter, type EvalCase, type LabelScoring, type LabelField } from '../../scripts/lib/eval/engine/types';
import type { MeterCall } from '../../scripts/lib/eval/meter';
import { priceCalls } from '../../scripts/lib/eval/engine/pricing';
import { Semaphore, providerOf, parseProviderCaps, makeProviderGate, DEFAULT_PROVIDER_CAPS } from '../../scripts/lib/eval/engine/concurrency';
import { Journal, parseJournal, loadResume, recordsFromResult, fingerprintMismatch, type RunRecord } from '../../scripts/lib/eval/engine/journal';
import { sweepProbe, fixtureIdentity } from '../../scripts/lib/eval/engine/sweep';
import { parsePoolSpec, poolFairnessProblems, type ProbeConfig } from '../../scripts/lib/eval/engine/probes';
import { probePoolEmail, probeHostOf } from '../../scripts/lib/eval/engine/world';
import { mkdtempSync, appendFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const NOW = new Date('2026-09-29T10:00:00Z'); // a Tuesday

const WORLD: World = {
  people: [{ key: 'sam', name: 'Sam', email: 'sam@acme.test', org: 'Acme' }, { key: 'zoe', name: 'Zoé', email: 'zoe@globex.test' }],
  threads: [{
    key: 't1', subject: 'Quote',
    messages: [
      { key: 'm1', from: 'sam', at: '-3d 09:30', body: 'Can you send the quote by {{+2d}}?' },
      { key: 'm2', from: 'me', at: '-2d 10:00', body: 'Yes — by {{+2d|weekday}}.' },
    ],
  }],
  commitments: [{ key: 'c1', direction: 'you_owe', description: 'Send Sam the quote', counterparty: 'sam', due: '+2d', thread: 't1', createdAt: '-3d' }],
  events: [{ key: 'e1', title: 'Quote review', start: '+1d 14:00', minutes: 45, attendees: ['sam', 'me'] }],
  projects: [{ key: 'p1', name: 'Acme renewal', links: ['t1', 'c1'] }],
  kb: [{ key: 'k1', filename: 'quote.pdf', text: 'QUOTE total €18,400, valid until {{+30d|iso}}' }],
  voiceSamples: ['Hi — short and warm.\nTaylor'],
};

// ── time + templates ───────────────────────────────────────────────────────────────────────────
describe('world clock', () => {
  it('resolves relative times, wall clocks and zones', () => {
    expect(resolveWhen('now', NOW).toISOString()).toBe(NOW.toISOString());
    expect(resolveWhen('-2h', NOW).toISOString()).toBe('2026-09-29T08:00:00.000Z');
    expect(resolveWhen('-3d 09:30', NOW).toISOString()).toBe('2026-09-26T09:30:00.000Z');
    expect(resolveWhen('+1d 14:00', NOW, 'Europe/Lisbon').toISOString()).toBe('2026-09-30T13:00:00.000Z'); // WEST = UTC+1
    expect(zonedToUtc('2026-10-25', '12:00', 'Europe/Lisbon').toISOString()).toBe('2026-10-25T12:00:00.000Z'); // after the DST change
    expect(() => resolveWhen('next tuesday', NOW)).toThrow(/unreadable/);
  });
  it('fills date templates so bodies never rot', () => {
    expect(fillTemplate('by {{+3d}}', NOW)).toBe('by Friday 2 October');
    expect(fillTemplate('{{+3d|iso}} {{+3d|weekday}} {{+3d|dm}} {{+1d 14:00|time}} {{+3d|short}}', NOW)).toBe('2026-10-02 Friday 2 October 14:00 Fri 2 Oct');
    expect(localDate(NOW, 'Pacific/Auckland')).toBe('2026-09-29');
  });
  it('validates the world (unknown people, order, links)', () => {
    expect(() => resolveWorld({ threads: [{ key: 't', subject: 's', messages: [{ from: 'ghost', at: 'now', body: 'x' }] }] }, NOW)).toThrow(/unknown person/);
    expect(() => resolveWorld({ people: [{ key: 'a', name: 'Ana', email: 'a@x.test' }], threads: [{ key: 't', subject: 's', messages: [{ from: 'a', at: '-1d', body: 'x' }, { from: 'a', at: '-2d', body: 'y' }] }] }, NOW)).toThrow(/time order/);
    expect(() => resolveWorld({ projects: [{ key: 'p', name: 'P', links: ['nope'] }] }, NOW)).toThrow(/unknown item/);
    const rw = resolveWorld(WORLD, NOW);
    expect(rw.threads[0].itemKey).toBe('t1');
    expect(rw.threads[0].anchorKey).toBe('m1');
    expect(rw.threads[0].messages[1].to[0].key).toBe('sam'); // outbound defaults to the first external sender
    expect(rw.commitments[0].due).toBe('2026-10-01');
  });
});

// ── the neutral renderer ───────────────────────────────────────────────────────────────────────
describe('neutral renderer', () => {
  it('renders the raw records like a mail client, deterministically, with no derived state', () => {
    const a = renderWorld(WORLD, NOW), b = renderWorld(WORLD, NOW);
    expect(a).toBe(b);
    expect(a).toContain('TODAY: Tuesday 29 September 2026');
    expect(a).toContain('From: Sam (Acme) <sam@acme.test>');
    expect(a).toContain('Date: Sat, 26 Sep 2026 09:30');
    expect(a).toContain('Can you send the quote by Thursday 1 October?');
    expect(a).toContain('I owe Sam (Acme) <sam@acme.test>: Send Sam the quote — due 2026-10-01');
    expect(a).toContain('Quote review · Wed, 30 Sep 2026 14:00–14:45');
    expect(a).toContain('--- file: quote.pdf ---');
    expect(a).toContain('EMAILS I WROTE RECENTLY');
    for (const derived of ['understanding', 'relevance', 'ownership', 'verdict', 'judgment', 'entity state']) expect(a.toLowerCase()).not.toContain(derived);
  });
  it('scopes', () => {
    const t = renderWorld(WORLD, NOW, { threads: ['t1'], upTo: 'm1', commitments: false, calendar: false, files: false, voice: false, projects: false });
    expect(t).toContain('Can you send the quote');
    expect(t).not.toContain('Yes — by');
    expect(t).not.toContain('COMMITMENTS');
    expect(answerSchema([{ name: 'x', labels: { a: 'the a' } }, { name: 'y', gloss: 'a list' }])).toMatch(/"x": one of "a"[\s\S]*· "a" = the a[\s\S]*"y": a list/);
  });
});

// ── an in-memory Supabase for the world builder ────────────────────────────────────────────────
type Row = Record<string, unknown>;
function fakeSupabase(emails: Record<string, string>) {
  const db: Record<string, Row[]> = {};
  let seq = 0;
  const rows = (t: string) => (db[t] ??= []);
  const q = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'delete' | 'update' = 'select';
    let payload: Row | Row[] | null = null;
    const b = {
      select() { return b; },
      insert(p: Row | Row[]) { op = 'insert'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
      in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return b; },
      like(k: string, pat: string) { const re = new RegExp(`^${pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`); filters.push((r) => re.test(String(r[k] ?? ''))); return b; },
      ilike(k: string, pat: string) { filters.push((r) => String(r[k] ?? '').toLowerCase() === pat.toLowerCase() || new RegExp(`^${pat.replace(/%/g, '.*')}$`, 'i').test(String(r[k] ?? ''))); return b; },
      gte(k: string, v: string) { filters.push((r) => String(r[k] ?? '') >= v); return b; },
      not() { return b; },
      order() { return b; },
      range() { return b; },
      maybeSingle() { return run(true); },
      single() { return run(true); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return run(false).then(res, rej); },
    };
    const run = async (single: boolean) => {
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const made = list.map((r) => ({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
        rows(table).push(...made);
        return { data: single ? made[0] : made, error: null };
      }
      const hit = rows(table).filter((r) => filters.every((f) => f(r)));
      if (op === 'delete') { db[table] = rows(table).filter((r) => !hit.includes(r)); return { data: null, error: null, count: hit.length }; }
      if (op === 'update') { for (const r of hit) Object.assign(r, payload); return { data: null, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null, count: hit.length };
    };
    return b;
  };
  return {
    db,
    client: {
      from: q,
      auth: { admin: { async getUserById(id: string) { return { data: { user: emails[id] ? { email: emails[id] } : null }, error: null }; } } },
    } as unknown as import('@supabase/supabase-js').SupabaseClient,
  };
}

const PROBE = '11111111-1111-4111-8111-111111111111';
const REAL = '22222222-2222-4222-8222-222222222222';

describe('world seed / teardown', () => {
  it('refuses any user that is not a probe host', async () => {
    const { client, db } = fakeSupabase({ [PROBE]: PROBE_EMAILS.standard, [REAL]: 'someone@company.test' });
    await expect(seedWorld({ admin: client, userId: REAL, now: NOW }, WORLD)).rejects.toThrow(/REFUSED/);
    expect(Object.values(db).flat().length).toBe(0);
  });
  it('seeds fresh ids every time and tears down symmetrically (incl. derived rows)', async () => {
    const { client, db } = fakeSupabase({ [PROBE]: PROBE_EMAILS.standard });
    const ctx = { admin: client, userId: PROBE, now: NOW };
    const a = await seedWorld(ctx, WORLD);
    const b = await seedWorld(ctx, WORLD);
    expect(a.ids.t1).not.toBe(b.ids.t1);
    expect(a.tag).not.toBe(b.tag);
    const item = db.inbox_items.find((r) => r.id === a.ids.t1)!;
    expect((item.source_data as Row).email_id).toBe(a.ids.m1);
    expect(item.created_at).toBe('2026-09-26T09:30:00.000Z');
    expect(item.last_activity_at).toBe('2026-09-27T10:00:00.000Z');
    expect(db.entity_links.length).toBe(4);
    expect(keyOfId(a, `inbox:${a.ids.t1}`)).toBe('t1');
    // A producer's derived rows keyed to seeded ids, and a commitment it minted from seeded mail.
    db.item_plans = [{ user_id: PROBE, kind: 'judgment', entity_id: `inbox:${a.ids.t1}` }, { user_id: PROBE, kind: 'working_circle', entity_id: 'user' }];
    db.commitments.push({ id: 'minted-1', user_id: PROBE, source_id: a.ids.m1, thread_id: null });
    const td = await teardownWorld(ctx, a);
    expect(td.errors).toEqual([]);
    await teardownWorld(ctx, b);
    for (const t of ['inbox_items', 'emails', 'commitments', 'calendar_events', 'work_entities', 'entity_links', 'knowledge_files', 'knowledge_sources']) expect(db[t]?.length ?? 0, t).toBe(0);
    expect(db.item_plans.map((r) => r.kind)).toEqual(['working_circle']); // a per-user singleton is left, like a real account
  });
});

describe('embed on seed', () => {
  const KB: World = { kb: [{ key: 'k1', filename: 'DPA signed.pdf', text: 'Data processing agreement, signed.', embed: true }, { key: 'k2', filename: 'Other.pdf', text: 'Other file.' }] };
  it('embeds opt-in docs (file + chunk) through the injected embedder and tears them down', async () => {
    const { client, db } = fakeSupabase({ [PROBE]: PROBE_EMAILS.standard });
    const seen: string[][] = [];
    const ctx = { admin: client, userId: PROBE, now: NOW, embed: async (t: string[]) => { seen.push(t); return t.map(() => [0.5, 0.25]); } };
    const s = await seedWorld(ctx, KB);
    expect(seen.length).toBe(1);
    expect(seen[0][0]).toBe('DPA signed.pdf\nData processing agreement, signed.'); // fileEmbedText: the name leads
    const f = db.knowledge_files.find((r) => r.id === s.ids.k1)!, g = db.knowledge_files.find((r) => r.id === s.ids.k2)!;
    expect(JSON.parse(f.embedding as string)).toEqual([0.5, 0.25]);
    expect(g.embedding).toBeUndefined(); // default off without embedKb
    expect(db.knowledge_chunks.length).toBe(1);
    expect(db.knowledge_chunks[0].file_id).toBe(s.ids.k1);
    expect((await teardownWorld(ctx, s)).errors).toEqual([]);
    expect(db.knowledge_chunks.length + db.knowledge_files.length).toBe(0);
  });
  it('world-level embedKb turns it on for every doc; a doc can opt out; stubbed mode makes a fixed vector (zero AI)', async () => {
    const rw = resolveWorld({ embedKb: true, kb: [{ key: 'a', filename: 'a.txt', text: 'x' }, { key: 'b', filename: 'b.txt', text: 'y', embed: false }] }, NOW);
    expect(rw.kb.map((d) => d.embed)).toEqual([true, false]);
    const { client, db } = fakeSupabase({ [PROBE]: PROBE_EMAILS.standard });
    const s = await seedWorld({ admin: client, userId: PROBE, now: NOW, stubbed: true }, { embedKb: true, kb: [{ key: 'a', filename: 'a.txt', text: 'x' }] });
    expect(JSON.parse(db.knowledge_files[0].embedding as string).length).toBe(1024);
    await teardownWorld({ admin: client, userId: PROBE, now: NOW }, s);
  });
});

describe('probe write fence', () => {
  const url = 'https://x.supabase.co';
  it('allows probe writes and reads, refuses a write naming another user', () => {
    expect(probeWriteVerdict(`${url}/rest/v1/inbox_items`, 'POST', JSON.stringify({ user_id: PROBE }), url, [PROBE]).allow).toBe(true);
    expect(probeWriteVerdict(`${url}/rest/v1/inbox_items?user_id=eq.${REAL}`, 'PATCH', '{}', url, [PROBE]).allow).toBe(false);
    expect(probeWriteVerdict(`${url}/rest/v1/emails`, 'POST', JSON.stringify([{ user_id: PROBE }, { user_id: REAL }]), url, [PROBE]).allow).toBe(false);
    expect(probeWriteVerdict(`${url}/rest/v1/emails?user_id=eq.${REAL}`, 'GET', null, url, [PROBE]).allow).toBe(true);
    expect(probeWriteVerdict('https://api.openai.com/v1/chat/completions', 'POST', '{}', url, [PROBE]).allow).toBe(true);
  });
});

// ── metrics ────────────────────────────────────────────────────────────────────────────────────
const REL: LabelField = {
  kind: 'enum', name: 'relevance', costly: 'reply', silence: 'awareness',
  labels: { reply: 'r', action: 'a', awareness: 'w' }, costs: { reply: { awareness: 3 }, awareness: { '*': 1 } },
};
const SCORING: LabelScoring = { kind: 'labelled', fields: [REL, { kind: 'enum', name: 'bulk', labels: { true: '', false: '' }, weight: 0.5 }], primary: { field: 'relevance', metric: 'cost_weighted' } };

describe('labelled metrics', () => {
  it('scores through the cost matrix, silence, accept and weights', () => {
    expect(costOf(REL, 'reply', 'awareness')).toBe(3);
    expect(costOf(REL, 'awareness', 'reply')).toBe(1);
    expect(costOf(REL, 'action', 'reply')).toBe(1);
    const ok = scoreCase(SCORING, { relevance: 'reply', bulk: false }, { relevance: 'reply', bulk: false });
    expect(ok.score).toBe(1);
    const miss = scoreCase(SCORING, { relevance: 'awareness', bulk: false }, { relevance: 'reply', bulk: false });
    expect(miss.costTotal).toBe(3);
    expect(miss.score).toBeCloseTo(0.5 / 1.5);
    // Withheld AUGMTD output reads as the silence label: right when nothing was owed, a miss otherwise.
    expect(scoreCase(SCORING, null, { relevance: 'awareness', bulk: '∅' }, true).fields[0].correct).toBe(true);
    expect(scoreCase(SCORING, null, { relevance: 'reply', bulk: false }, true).fields[0].cost).toBe(3);
    // Unparseable plain answer is wrong.
    expect(scoreCase(SCORING, null, { relevance: 'awareness', bulk: false }, false).fields[0].pred).toBe('∅');
    // Ambiguous cases accept alternatives.
    expect(scoreCase(SCORING, { relevance: 'action', bulk: false }, { relevance: 'reply', bulk: false, accept: { relevance: ['action'] } }).fields[0].correct).toBe(true);
  });
  it('aggregates accuracy, macro-F1, costly recall/precision, cost per case, consistency', () => {
    const truths = ['reply', 'reply', 'awareness', 'action'];
    const preds = ['reply', 'awareness', 'awareness', 'reply'];
    const scores = truths.map((t, i) => scoreCase(SCORING, { relevance: preds[i], bulk: false }, { relevance: t, bulk: false }));
    const agg = aggregateField(REL, scores);
    expect(agg.accuracy).toBe(0.5);
    expect(agg.costly?.recall).toBe(0.5);
    expect(agg.costly?.precision).toBe(0.5);
    expect(agg.costPerCase).toBeCloseTo((0 + 3 + 0 + 1) / 4);
    expect(agg.confusion.reply.awareness).toBe(1);
    expect(primaryValue(SCORING, [agg])).toBeCloseTo(-1);
    expect(repeatConsistency([[scores[0], scores[0]], [scores[1], scores[0]]])).toBe(0.5);
  });
  it('set matching for extracted obligations (dates exact, hallucinations flagged)', () => {
    const truth = [{ direction: 'i_owe', keywords: ['order form'], who: 'sam', due: '2026-10-01' }, { direction: 'they_owe', keywords: ['contract|agreement'], due: null }];
    const m = matchObligations([
      { direction: 'i_owe', what: 'Send the signed order form', who: 'Sam <sam@acme.test>', due: '2026-10-01' },
      { direction: 'they_owe', what: 'Return the agreement', who: 'Sam', due: '2026-10-09' },
      { direction: 'i_owe', what: 'Book a call', who: 'Sam', due: null },
    ], truth);
    expect(m).toEqual({ tp: 1, fp: 2, fn: 1, flags: { wrongDue: 0, hallucinatedDue: 1, wrongDirection: 0 } });
  });
  it('bootstrap is deterministic and brackets the mean', () => {
    const a = [1, 1, 0.5, 1, 0], b = [0.5, 1, 0.5, 0, 0];
    const x = pairedBootstrap(a, b)!, y = pairedBootstrap(a, b)!;
    expect(x).toEqual(y);
    expect(x.delta).toBeCloseTo(0.3);
    expect(x.lo).toBeLessThanOrEqual(x.delta);
    expect(x.hi).toBeGreaterThanOrEqual(x.delta);
  });
  it('prices calls, naming an unpriced model at the ceiling', () => {
    const calls: MeterCall[] = [{ model: 'gpt-5.6-terra', promptTokens: 1e6, completionTokens: 1e6, metered: true, ms: 0, reasoningTokens: 5 }, { model: 'mystery', promptTokens: 1, completionTokens: 1, metered: true, ms: 0 }];
    const p = priceCalls(calls);
    expect(p.costEur).toBeCloseTo(1.85 + 11.1 + (4.6 + 23) / 1e6);
    expect(p.unpriced).toEqual(['mystery']);
    expect(p.reasoningTokens).toBe(5);
  });
});

// ── the runner, end to end with fakes ──────────────────────────────────────────────────────────
function fakeAdapter(over: Partial<AnyAdapter> = {}): AnyAdapter {
  const cases: EvalCase[] = [
    { id: 'x1', group: 'g', title: 'one', world: WORLD, truth: { relevance: 'reply', bulk: false } },
    { id: 'x2', group: 'g', title: 'two', world: {}, truth: { relevance: 'awareness', bulk: true } },
    { id: 'xc', group: 'canary', title: 'canary', world: {}, truth: { relevance: 'reply', bulk: false }, canary: true },
  ];
  return {
    id: 'judgment.fake', family: 'judgment', title: 'Fake', stage: 'test', producer: { file: 'x.ts', fn: 'fake', slot: 'classification' },
    tiers: ['standard', 'eu'], status: 'ready', planned: [], cases: () => cases, scoring: SCORING,
    async produce(_ctx, c) { return { text: 'served', value: c.id === 'x2' ? null : { relevance: 'reply', bulk: false }, withheld: c.id === 'x2' }; },
    plainPrompt: (c) => ({ user: `Q:${c.id}` }),
    parse: (t) => parseAnswerJSON(t),
    ...over,
  };
}
const fakeMeter = (): MeterPort => ({ async run(fn) { const result = await fn(); return { result, calls: [{ model: 'm', promptTokens: 10, completionTokens: 5, metered: true, ms: 1 }] }; } });
function fakeEnv(tier: 'standard' | 'eu', answers: Record<string, (u: string) => string>, log: string[]): TierEnv {
  return {
    tier, ctx: { admin: {} as never, userId: PROBE, now: NOW, stubbed: true },
    async plainFor(column) {
      return { column, label: column, model: `${column}-model`, effort: column === 'same' ? 'minimal' : 'medium', async call(msgs) { log.push(`${tier}:${column}`); return answers[column](String(msgs[msgs.length - 1].content)); } } as PlainSystem;
    },
    async augmtdModel() { return `${tier}-slot-model`; },
    async seed(ctx) { log.push(`seed:${ctx.repeat}`); return { tag: `t${ctx.repeat}`, resolved: resolveWorld({}, NOW), ids: {}, threadIds: {}, ledger: [], seededAt: '' }; },
    async teardown() { log.push('teardown'); return { errors: [] }; },
  };
}
const ANSWERS = {
  same: (u: string) => (u === 'Q:x1' ? '{"relevance":"reply","bulk":false}' : '```json\n{"relevance":"awareness","bulk":true}\n```'),
  sonnet55: () => '{"relevance":"reply","bulk":false}',
  gpt56: () => 'no idea',
};

describe('runner', () => {
  it('runs every column × repeat, seeds fresh per AUGMTD repeat, scores, reuses tier-free columns', async () => {
    const log: string[] = [];
    const r = await runEngine({
      adapters: [fakeAdapter()], envs: [fakeEnv('standard', ANSWERS, log), fakeEnv('eu', ANSWERS, log)],
      columns: ['augmtd', 'same', 'sonnet55', 'gpt56'], repeat: 2, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW,
    });
    expect(r.surfaces.map((s) => `${s.surface}/${s.tier}`)).toEqual(['judgment.fake/standard', 'judgment.fake/eu']);
    expect(log.filter((l) => l.startsWith('seed')).length).toBe(2 * 2 * 2); // 2 cases × 2 repeats × 2 tiers, canary skipped
    expect(log.filter((l) => l === 'teardown').length).toBe(8);
    expect(log.filter((l) => l === 'eu:sonnet55' || l === 'eu:gpt56').length).toBe(0); // reused from standard
    const eu = r.surfaces[1];
    expect(eu.cases[0].runs.sonnet55![0].reusedFrom).toBe('standard');
    const std = summarizeSurface(fakeAdapter(), r.surfaces[0]);
    expect(std.columns.augmtd!.primary).toBe(0); // x1 right, x2 withheld → silence = awareness ✓, bulk wrong but weight .5 not in primary
    expect(std.columns.gpt56!.primary).toBeLessThan(std.columns.same!.primary!);
    expect(std.parity.find((p) => p.vs === 'gpt56')!.ok).toBe(true);
    expect(std.columns.augmtd!.withheld).toBe(2);
    expect(std.columns.same!.consistency).toBe(1);
    const md = renderEngineReport(r, [fakeAdapter()]);
    for (const must of ['## Scoreboard', 'judgment.fake', '### field `relevance`', 'Per case', 'Effort sent', 'confusion']) expect(md).toContain(must);
  });
  it('stops at the budget and skips (never half-runs)', async () => {
    const log: string[] = [];
    const meter: MeterPort = { async run(fn) { return { result: await fn(), calls: [{ model: 'claude-opus-5-5', promptTokens: 100_000, completionTokens: 0, metered: true, ms: 1 }] }; } };
    const r = await runEngine({ adapters: [fakeAdapter()], envs: [fakeEnv('standard', ANSWERS, log)], columns: ['augmtd', 'same'], repeat: 1, maxEur: 0.5, judge: null, meter, price: priceCalls, now: NOW });
    expect(r.budgetHit).toBe(true);
    const skipped = r.surfaces[0].cases.flatMap((c) => Object.values(c.runs).flat()).filter((x) => x!.skipped);
    expect(skipped.length).toBeGreaterThan(0);
  });
  it('a producer error is recorded, torn down, and never crashes the run', async () => {
    const log: string[] = [];
    const bad = fakeAdapter({ async produce() { throw new Error('boom'); } });
    const r = await runEngine({ adapters: [bad], envs: [fakeEnv('standard', ANSWERS, log)], columns: ['augmtd'], repeat: 1, maxEur: 5, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW });
    expect(r.surfaces[0].cases[0].runs.augmtd![0].out.error).toBe('boom');
    expect(log.filter((l) => l === 'teardown').length).toBe(2);
  });
  it('judged surfaces: blind reason-first judge, retry once, hard fail fails the run', async () => {
    const log: string[] = [];
    let calls = 0;
    const judged = fakeAdapter({
      id: 'artifact.fake', family: 'artifact', scoring: { kind: 'judged', dims: [{ id: 'grounded', label: 'Grounded', gloss: 'no inventions' }], hardConditions: ['Claims it was sent'] },
      parse: (t) => ({ text: t }),
    });
    const judge = {
      model: 'judge', async call(_s: string, user: string, nudge: boolean) {
        calls++;
        expect(user).not.toMatch(/augmtd|sonnet|gpt|same-model/i);
        expect(user).toContain('HARD CONDITIONS');
        if (!nudge && calls === 1) return 'not json';
        return JSON.stringify({ reasoning: 'checked', hard_fails: user.includes('Q:') ? [] : [], scores: { grounded: 4 }, failures: [], notes: '' });
      },
    };
    const r = await runEngine({ adapters: [judged], envs: [fakeEnv('standard', { ...ANSWERS, same: () => 'text' }, log)], columns: ['augmtd', 'same'], repeat: 1, maxEur: 5, judge, meter: fakeMeter(), price: priceCalls, now: NOW });
    const runs = r.surfaces[0].cases.flatMap((c) => Object.values(c.runs).flat());
    expect(runs.every((x) => x!.score === 4)).toBe(true);
    const p = parseRubric('{"reasoning":"x","hard_fails":[1],"scores":{"grounded":5}}', ['grounded']);
    expect(p.hardFails).toEqual(['1']);
    const prompt = buildRubricPrompt({ title: 't', task: 'k', truthSheet: 's', dims: [{ id: 'g', label: 'G', gloss: 'x', anchors: { 1: 'bad', 5: 'good' } }], hardConditions: ['h'], answer: 'a' });
    expect(prompt.user.indexOf('"reasoning"')).toBeLessThan(prompt.user.indexOf('"scores"'));
    expect(prompt.user).toContain('1 = bad');
  });
});

describe('merge / recheck / self-check assertions', () => {
  it('merges plain columns from a saved run and rescores with current adapters', async () => {
    const log: string[] = [];
    const run = (cols: Array<'augmtd' | 'same' | 'sonnet55' | 'gpt56'>) => runEngine({ adapters: [fakeAdapter()], envs: [fakeEnv('standard', ANSWERS, log)], columns: cols, repeat: 1, maxEur: 5, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW });
    const aug = await run(['augmtd']);
    const plain = JSON.parse(JSON.stringify(await run(['same', 'gpt56']))) as EngineResult;
    const { result, added } = mergeEngine(aug, plain);
    expect(added[0]).toMatch(/same, gpt56/);
    expect(result.surfaces[0].columns.map((c) => c.id)).toEqual(['augmtd', 'same', 'gpt56']);
    // Recheck with an adapter whose parser now reads "no idea" as awareness → gpt56 rescored.
    const fixed = fakeAdapter({ parse: (t) => (t === 'no idea' ? { relevance: 'awareness', bulk: true } : parseAnswerJSON(t)) });
    const re = recheckEngine(JSON.parse(JSON.stringify(result)), [fixed]);
    const x2 = re.surfaces[0].cases.find((c) => c.caseId === 'x2')!;
    expect(x2.runs.gpt56![0].score).toBe(1);
  });
  it('self-check assertions catch a producer that made no model call and residue', () => {
    const r = { stubbed: true, totalCostEur: 0, surfaces: [{ surface: 's', tier: 'standard', scoring: 'labelled', teardownErrors: [], cases: [{ caseId: 'c', runs: { augmtd: [{ column: 'augmtd', out: { calls: 0 }, score: 0 }] } }] }] } as unknown as EngineResult;
    const p = selfCheckProblems(r, ['standard: emails: 1 → 2'], []);
    expect(p.join('\n')).toMatch(/NO model call/);
    expect(p.join('\n')).toMatch(/not symmetric/);
  });
});

// ── concurrency, budget reservations, stop + resume ────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function manyCases(n: number): AnyAdapter {
  const cases: EvalCase[] = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, group: i % 2 ? 'odd' : 'even', title: `case ${i}`, world: {}, truth: { relevance: 'reply', bulk: false } }));
  return fakeAdapter({ cases: () => cases, async produce() { await sleep(5); return { text: 'served', value: { relevance: 'reply', bulk: false } }; } });
}
function trackingEnv(tier: 'standard' | 'eu', stats: { live: number; peakLive: number; seeds: number; teardowns: number }, userId = PROBE): TierEnv {
  const base = fakeEnv(tier, ANSWERS, []);
  return {
    ...base, ctx: { ...base.ctx, userId },
    async plainFor(column) { const sys = await base.plainFor(column, fakeAdapter()); return { ...sys, async call(m) { await sleep(3); return sys.call(m); } }; },
    async seed(ctx) { stats.seeds++; stats.live++; stats.peakLive = Math.max(stats.peakLive, stats.live); await sleep(4); return { tag: `t${ctx.repeat}`, resolved: resolveWorld({}, NOW), ids: {}, threadIds: {}, ledger: [], seededAt: '' }; },
    async teardown() { await sleep(2); stats.live--; stats.teardowns++; return { errors: [] }; },
  };
}
const strip = (r: EngineResult) => r.surfaces.map((s) => ({ s: s.surface, t: s.tier, cases: s.cases.map((c) => ({ id: c.caseId, runs: Object.fromEntries(Object.entries(c.runs).map(([k, v]) => [k, v!.map((x) => [x.repeat, x.score, x.skipped ?? null, x.reusedFrom ?? null])])) })) }));

describe('scheduler: concurrency', () => {
  it('runs units concurrently, keeps the result order and scores identical to the sequential run', async () => {
    const stats = { live: 0, peakLive: 0, seeds: 0, teardowns: 0 };
    const seq = await runEngine({ adapters: [manyCases(6)], envs: [trackingEnv('standard', { ...stats }), trackingEnv('eu', { ...stats }, REAL)], columns: ['augmtd', 'same', 'sonnet55', 'gpt56'], repeat: 2, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW });
    const par = await runEngine({ adapters: [manyCases(6)], envs: [trackingEnv('standard', stats), trackingEnv('eu', stats, REAL)], columns: ['augmtd', 'same', 'sonnet55', 'gpt56'], repeat: 2, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW, concurrency: 4, worldLanes: 1 });
    expect(par.concurrency!.peakUnits).toBe(4);
    expect(seq.concurrency!.peakUnits).toBe(1);
    expect(strip(par)).toEqual(strip(seq));
    expect(stats.seeds).toBe(6 * 2 * 2);
    expect(stats.teardowns).toBe(stats.seeds);
    // THE WORLD LANE: one world per probe host at a time (two hosts → at most 2 alive).
    expect(stats.peakLive).toBeLessThanOrEqual(2);
    // Tier-free columns ran once (standard) and were reused on eu even while running concurrently.
    const eu = par.surfaces.find((s) => s.tier === 'eu')!;
    expect(eu.cases.every((c) => c.runs.sonnet55!.every((r) => r.reusedFrom === 'standard'))).toBe(true);
  });
  it('the world lane can be widened (worlds overlap on one host)', async () => {
    const stats = { live: 0, peakLive: 0, seeds: 0, teardowns: 0 };
    await runEngine({ adapters: [manyCases(6)], envs: [trackingEnv('standard', stats)], columns: ['augmtd'], repeat: 1, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW, concurrency: 6, worldLanes: 3 });
    expect(stats.peakLive).toBeGreaterThan(1);
    expect(stats.peakLive).toBeLessThanOrEqual(3);
  });
  it('the budget is a hard stop under concurrency: in-flight reservations count before a unit starts', async () => {
    const meter: MeterPort = { async run(fn) { const result = await fn(); return { result, calls: [{ model: 'claude-opus-5-5', promptTokens: 100_000, completionTokens: 0, metered: true, ms: 1 }] }; } }; // €0.37 per call
    const r = await runEngine({
      adapters: [manyCases(8)], envs: [trackingEnv('standard', { live: 0, peakLive: 0, seeds: 0, teardowns: 0 })], columns: ['augmtd', 'same'], repeat: 1, maxEur: 2, judge: null, meter, price: priceCalls, now: NOW,
      concurrency: 8, reserve: () => 0.74, // the estimate: 2 calls per unit
    });
    expect(r.budgetHit).toBe(true);
    expect(r.totalCostEur).toBeLessThanOrEqual(2 + 1e-9); // never overshoots, even with 8 slots free
    const ran = r.surfaces[0].cases.filter((c) => !c.runs.augmtd![0].skipped).length;
    expect(ran).toBe(2); // 2 × €0.74 fits, a third reservation would not
  });
  it('a stop signal schedules nothing more; in-flight units finish and tear down; pending units are counted', async () => {
    const stats = { live: 0, peakLive: 0, seeds: 0, teardowns: 0 };
    let n = 0;
    const r = await runEngine({ adapters: [manyCases(10)], envs: [trackingEnv('standard', stats)], columns: ['augmtd', 'same'], repeat: 1, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW, concurrency: 3, onRun: () => { n++; }, shouldStop: () => (n >= 4 ? 'SIGTERM received' : null) });
    expect(r.stopped).toBe('SIGTERM received');
    expect(stats.live).toBe(0); // every seeded world torn down
    expect(stats.teardowns).toBe(stats.seeds);
    const landed = r.surfaces[0].cases.filter((c) => c.runs.augmtd?.length).length;
    expect(landed + r.pendingUnits!).toBe(10);
    expect(r.surfaces[0].cases.flatMap((c) => c.runs.augmtd ?? []).some((x) => x.skipped)).toBe(false); // stop ≠ budget skip
  });
});

describe('scheduler: kill and resume from the journal', () => {
  it('a stopped run resumes from its journal on disk: every unit lands exactly once, same result as one full run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'w26-journal-'));
    try {
      const jp = path.join(dir, 'run.jsonl');
      const journal = new Journal(jp);
      journal.open({ type: 'header', version: 1, now: NOW.toISOString(), startedAt: NOW.toISOString(), repeat: 2, columns: ['augmtd', 'same', 'sonnet55'], tiers: ['standard', 'eu'], judgeModel: null, fingerprint: { judgeStyle: 'w24' } }, false);
      const produced: string[] = [];
      const adapter = () => fakeAdapter({ cases: () => manyCases(5).cases(), async produce(ctx, c) { produced.push(`${ctx.tier}|${c.id}|${ctx.repeat}`); await sleep(2); return { text: 'served', value: { relevance: 'reply', bulk: false } }; } });
      const plan = { columns: ['augmtd', 'same', 'sonnet55'] as Array<'augmtd' | 'same' | 'sonnet55'>, repeat: 2, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW, concurrency: 4 };
      const envs = () => [trackingEnv('standard', { live: 0, peakLive: 0, seeds: 0, teardowns: 0 }), trackingEnv('eu', { live: 0, peakLive: 0, seeds: 0, teardowns: 0 }, REAL)];
      let n = 0;
      const leg1 = await runEngine({ ...plan, adapters: [adapter()], envs: envs(), onRun: (r) => { n++; journal.append(r); }, shouldStop: () => (n >= 11 ? 'SIGINT received' : null) });
      expect(leg1.stopped).toBeTruthy();
      expect(leg1.pendingUnits).toBeGreaterThan(0);
      appendFileSync(jp, '{"type":"run","surface":"judgment.fake","tier":"stan'); // the process died mid-write
      const back = loadResume(path.join(dir, 'run.json'));
      expect(back.torn).toBe(1);
      expect(back.header!.now).toBe(NOW.toISOString());
      const leg1Produced = produced.length;
      journal.open(back.header!, true); // the resumed process reopens its journal (closes the torn line)
      const leg2 = await runEngine({ ...plan, adapters: [adapter()], envs: envs(), prior: back.records, onRun: (r) => journal.append(r) });
      expect(leg2.resumedRuns).toBe(back.records.length);
      expect(leg2.stopped).toBeNull();
      // Exactly once: no AUGMTD unit produced twice across the legs; all 5 cases × 2 repeats × 2 tiers produced.
      expect(new Set(produced).size).toBe(produced.length);
      expect(produced.length).toBe(5 * 2 * 2);
      expect(leg1Produced).toBeLessThan(produced.length);
      const full = await runEngine({ ...plan, adapters: [adapter()], envs: envs() });
      expect(strip(leg2)).toEqual(strip(full));
      expect(leg2.totalCostEur).toBeCloseTo(full.totalCostEur, 9); // prior spend + this leg = one full run
      // The final journal holds every own (non-reused) run exactly once.
      const all = parseJournal(readFileSync(jp, 'utf8'));
      expect(all.records.length).toBe(recordsFromResult(full).filter((r) => !r.run.reusedFrom).length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('errored and budget-skipped runs are retried on resume; a finished run is not', async () => {
    const recs: RunRecord[] = [];
    let fail = true;
    const flaky = fakeAdapter({ cases: () => manyCases(2).cases(), async produce() { if (fail) throw new Error('429 after retries'); return { text: 'ok', value: { relevance: 'reply', bulk: false } }; } });
    const base = { adapters: [flaky], columns: ['augmtd', 'same'] as Array<'augmtd' | 'same'>, repeat: 1, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW };
    await runEngine({ ...base, envs: [fakeEnv('standard', ANSWERS, [])], onRun: (r) => recs.push(r) });
    fail = false;
    const log: string[] = [];
    const r2 = await runEngine({ ...base, envs: [fakeEnv('standard', ANSWERS, log)], prior: recs });
    expect(log.filter((l) => l.startsWith('seed')).length).toBe(2); // augmtd re-ran (errored)
    expect(log.filter((l) => l === 'standard:same').length).toBe(0); // same was finished
    expect(r2.surfaces[0].cases.every((c) => !c.runs.augmtd![0].out.error)).toBe(true);
    expect(fingerprintMismatch({ judgeStyle: 'w24' }, { judgeStyle: 'reason-first' })).toHaveLength(1);
  });
});

describe('concurrency primitives', () => {
  it('semaphore bounds and hands over in FIFO order', async () => {
    const s = new Semaphore(2);
    let live = 0, peak = 0;
    const order: number[] = [];
    await Promise.all(Array.from({ length: 6 }, (_, i) => s.run(async () => { live++; peak = Math.max(peak, live); await sleep(3); order.push(i); live--; })));
    expect(peak).toBe(2);
    expect(order.slice(0, 2).sort()).toEqual([0, 1]);
    expect(s.inUse).toBe(0);
  });
  it('maps models to providers and caps calls per provider', async () => {
    expect(providerOf('claude-opus-5-5')).toBe('anthropic');
    expect(providerOf('eu.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('bedrock');
    expect(providerOf('gpt-5-mini')).toBe('openai-mini');
    expect(providerOf('gpt-5.6-terra')).toBe('openai');
    expect(parseProviderCaps('anthropic=2').anthropic).toBe(2);
    expect(() => parseProviderCaps('antropic=2')).toThrow(/unknown provider/);
    const g = makeProviderGate({ ...DEFAULT_PROVIDER_CAPS, anthropic: 2 });
    await Promise.all(Array.from({ length: 7 }, () => g.gate('claude-sonnet-5-5', () => sleep(3))));
    await Promise.all(Array.from({ length: 5 }, () => g.gate('gpt-5-mini', () => sleep(3))));
    expect(g.peak.anthropic).toBe(2);
    expect(g.peak['openai-mini']).toBe(5);
  });
});

describe('concurrent worlds + the sweep', () => {
  it('two live worlds of one case: a teardown never deletes the other world\'s rows; the last one cleans up', async () => {
    const { client, db } = fakeSupabase({ [PROBE]: PROBE_EMAILS.standard });
    const ctx = { admin: client, userId: PROBE, now: NOW };
    const a = await seedWorld(ctx, WORLD);
    const b = await seedWorld(ctx, WORLD);
    // Recognition minted a person entity + person_state while both worlds are alive (shared keys).
    db.work_entities.push({ id: 'recog-1', user_id: PROBE, name: 'Sam', created_at: new Date().toISOString() });
    (db.person_state ??= []).push({ user_id: PROBE, person_key: 'sam@acme.test', updated_at: new Date().toISOString() });
    await teardownWorld(ctx, a);
    expect(db.work_entities.some((r) => r.id === b.ids.p1)).toBe(true); // B's seeded project (same name) survives A's teardown
    expect(db.work_entities.some((r) => r.id === 'recog-1')).toBe(true); // shared name: deferred to the last sharer
    expect(db.person_state.length).toBe(1);
    expect(db.inbox_items.map((r) => r.id)).toEqual([b.ids.t1]);
    await teardownWorld(ctx, b);
    for (const t of ['inbox_items', 'emails', 'commitments', 'calendar_events', 'work_entities', 'entity_links', 'knowledge_files', 'knowledge_sources', 'person_state']) expect(db[t]?.length ?? 0, t).toBe(0);
  });
  it('the sweep finds an interrupted world by its markers only, leaves standing probe state, refuses a real user', async () => {
    const { client, db } = fakeSupabase({ [PROBE]: PROBE_EMAILS.standard, [REAL]: 'someone@company.test' });
    const ctx = { admin: client, userId: PROBE, now: NOW };
    const s = await seedWorld(ctx, WORLD); // …and the process was killed: never torn down
    await expect(sweepProbe(client, PROBE, { apply: true, fixture: { names: [], emails: [] } })).rejects.toThrow(/live world/); // never mid-run
    forgetLiveWorlds(); // a new process
    db.item_plans = [{ id: 'p-derived', user_id: PROBE, kind: 'fulfillment', entity_id: `commitment:${s.ids.c1}` }, { id: 'p-single', user_id: PROBE, kind: 'working_circle', entity_id: 'user' }];
    // Standing probe state other suites rely on: untagged mail, a KB folder, a project with a live link.
    db.emails.push({ id: 'standing-mail', user_id: PROBE, message_id: '<x@y.test>', thread_id: 't-standing' });
    db.knowledge_sources.push({ id: 'standing-src', user_id: PROBE, folder_name: 'Uploads' });
    db.work_entities.push({ id: 'standing-ent', user_id: PROBE, name: 'Probe Errands' });
    const fixture = fixtureIdentity([fakeAdapter({ cases: () => [{ id: 'w', group: 'g', title: 't', world: WORLD, truth: {} }] })]);
    const dry = await sweepProbe(client, PROBE, { apply: false, fixture });
    expect(dry.tags).toEqual([s.tag]);
    expect(dry.counts.emails).toBe(3);
    expect(dry.counts.inbox_items).toBe(1);
    expect(dry.counts.work_entities).toBe(1);
    expect(dry.counts.item_plans).toBe(1);
    expect(db.emails.length).toBe(4); // dry run deleted nothing
    const done = await sweepProbe(client, PROBE, { apply: true, fixture });
    expect(done.total).toBe(dry.total);
    expect(db.emails.map((r) => r.id)).toEqual(['standing-mail']);
    expect(db.knowledge_sources.map((r) => r.id)).toEqual(['standing-src']);
    expect(db.work_entities.map((r) => r.id)).toEqual(['standing-ent']);
    expect(db.item_plans.map((r) => r.id)).toEqual(['p-single']);
    for (const t of ['inbox_items', 'commitments', 'calendar_events', 'entity_links', 'knowledge_files', 'knowledge_chunks']) expect(db[t]?.length ?? 0, t).toBe(0);
    expect((await sweepProbe(client, PROBE, { apply: false, fixture })).total).toBe(0);
    await expect(sweepProbe(client, REAL, { apply: true, fixture })).rejects.toThrow(/REFUSED/);
  });
});

// ── coverage gate ──────────────────────────────────────────────────────────────────────────────
describe('coverage gate', () => {
  const reg = ['judgment.a'];
  it('fails on unmapped files, grown call sites, unregistered and unreferenced adapters', () => {
    const r = checkCoverage({
      sites: [{ file: 'lib/new.ts', sites: 1, slots: [] }, { file: 'lib/a.ts', sites: 3, slots: ['classification'] }],
      kinds: ['email', 'widget'], registered: [...reg, 'judgment.orphan'],
      callMap: { 'lib/a.ts': { adapters: ['judgment.a'], sites: 2 }, 'lib/gone.ts': { exempt: 'x' } },
      kindMap: { email: { adapters: ['judgment.nope'] } },
    });
    const f = r.failures.join('\n');
    expect(f).toMatch(/lib\/new\.ts: UNMAPPED/);
    expect(f).toMatch(/lib\/a\.ts: 3 call expressions, mapped at 2/);
    expect(f).toMatch(/widget'?: UNMAPPED/);
    expect(f).toMatch(/unregistered adapter\(s\) judgment\.nope/);
    expect(f).toMatch(/judgment\.orphan: registered but no call site/);
    expect(r.warnings.join('\n')).toMatch(/lib\/gone\.ts: no call site found/);
  });
  it('the real repository is fully mapped', () => {
    const root = path.resolve(__dirname, '../..');
    const sites = scanCallSites(root);
    const kinds = scanCardKinds(readFileSync(path.join(root, 'components/thread/types.ts'), 'utf8'));
    expect(kinds).toContain('proposal');
    const r = checkCoverage({ sites, kinds, registered: ADAPTERS.map((a) => a.id) });
    expect(r.failures).toEqual([]);
  });
});

// ── the fixture contract over every registered adapter ─────────────────────────────────────────
describe('fixture contract', () => {
  for (const a of ADAPTERS) {
    describe(a.id, () => {
      it('cases are hygienic (generic names, .test mail, no literal dates, labels in vocabulary)', () => {
        for (const c of a.cases()) expect(fixtureProblems(c as EvalCase, a), `${a.id}/${c.id}`).toEqual([]);
      });
      it('plans every edge class', () => {
        const edges = new Set(a.planned.map((g) => g.edge).filter(Boolean));
        for (const e of EDGE_KINDS) expect(edges.has(e), `${a.id} plans no '${e}' edge group`).toBe(true);
      });
      if (a.scoring.kind === 'labelled') {
        it('the plain prompt carries the raw world + the neutral schema, and a correct answer scores 1', () => {
          for (const c of a.cases() as EvalCase[]) {
            const u = a.plainPrompt(c, NOW).user;
            expect(u).toContain('TODAY:');
            expect(u).toContain('Answer with ONLY a JSON object');
            expect(u).not.toMatch(/\{\{/); // templates rendered
            if (!a.stubAnswer) continue;
            const v = a.parse(a.stubAnswer(c, NOW), c);
            const truth = a.resolveTruth ? a.resolveTruth(c, NOW) : c.truth;
            expect(scoreCase(a.scoring as LabelScoring, v, truth).score, `${c.id}`).toBe(1);
          }
        });
      }
    });
  }
});

// ── THE PROBE POOL ─────────────────────────────────────────────────────────────────────────────
describe('probe pool', () => {
  it('pool addresses are exact, and never collide with the co-member probes other suites use', () => {
    expect(probePoolEmail('standard', 1)).toBe(PROBE_EMAILS.standard);
    expect(probePoolEmail('eu', 1)).toBe(PROBE_EMAILS.eu);
    expect(probeHostOf('smoke-probe-pool-3@augmtd-internal.test')).toEqual({ tier: 'standard', k: 3 });
    expect(probeHostOf('SMOKE-PROBE-EU-2@augmtd-internal.test')).toEqual({ tier: 'eu', k: 2 });
    expect(probeHostOf('smoke-probe-2@augmtd-internal.test')).toBeNull(); // smoke-run-record's "Riley Probe"
    expect(probeHostOf('smoke-probe-pool-3@augmtd-internal.test.evil')).toBeNull();
    expect(probeHostOf('someone@company.test')).toBeNull();
    expect(() => probePoolEmail('standard', 0)).toThrow();
    expect(() => probePoolEmail('standard', 99)).toThrow();
  });
  it('world seeding accepts a pool account and still refuses a non-probe', async () => {
    const { client } = fakeSupabase({ [PROBE]: probePoolEmail('standard', 3), [REAL]: 'smoke-probe-2@augmtd-internal.test' });
    const s = await seedWorld({ admin: client, userId: PROBE, now: NOW, stubbed: true }, WORLD);
    await teardownWorld({ admin: client, userId: PROBE, now: NOW }, s);
    await expect(seedWorld({ admin: client, userId: REAL, now: NOW }, WORLD)).rejects.toThrow(/REFUSED/);
  });
  it('--probe-pool parses counts and ranges, refuses typos', () => {
    expect(parsePoolSpec(null)).toBeNull();
    expect(parsePoolSpec('std=4,eu=3')).toEqual({ standard: [1, 2, 3, 4], eu: [1, 2, 3] });
    expect(parsePoolSpec('std=2-4,eu=0')).toEqual({ standard: [2, 3, 4], eu: [] });
    expect(() => parsePoolSpec('stnd=2')).toThrow(/unknown tier/);
    expect(() => parsePoolSpec('std=x')).toThrow();
    expect(() => parsePoolSpec('std=4-2')).toThrow();
    expect(() => parsePoolSpec('std=99')).toThrow();
  });
  it('the fairness check flags any config difference within a tier (never across tiers)', () => {
    const base = (): ProbeConfig => ({ profile: { full_name: 'Probe Host', settings: { tz: 'UTC' }, role: 'user' }, memberships: [], counts: { skills: 0 }, models: { classification: 'standard/gpt-5-mini' } });
    const eu = (): ProbeConfig => ({ ...base(), profile: { full_name: null, settings: {}, role: 'user' }, memberships: [{ company_id: 'w', role: 'owner', status: 'active', ai_tier: 'bedrock_optimised', features: {}, settings: {} }] });
    expect(poolFairnessProblems([{ label: 'std#1', tier: 'standard', config: base() }, { label: 'std#2', tier: 'standard', config: base() }, { label: 'eu#1', tier: 'eu', config: eu() }, { label: 'eu#2', tier: 'eu', config: eu() }])).toEqual([]);
    const drift = base(); drift.profile!.settings = { tz: 'Europe/Lisbon' }; drift.counts.skills = 2; drift.models = { classification: 'standard/other' };
    const p = poolFairnessProblems([{ label: 'std#1', tier: 'standard', config: base() }, { label: 'std#3', tier: 'standard', config: drift }, { label: 'eu#1', tier: 'eu', config: eu() }, { label: 'eu#2', tier: 'eu', config: { ...eu(), memberships: [] } }]);
    expect(p.some((x) => x.startsWith('std#3 profile.settings'))).toBe(true);
    expect(p.some((x) => x.startsWith('std#3 skills rows'))).toBe(true);
    expect(p.some((x) => x.startsWith('std#3 models'))).toBe(true);
    expect(p.some((x) => x.startsWith('eu#2 workspace membership'))).toBe(true);
  });
  it('HostPool: least-loaded lease, lanes per account, a pinned waiter never blocks a free account', async () => {
    const [a, b] = [fakeEnv('standard', ANSWERS, []), fakeEnv('standard', ANSWERS, [])];
    const pool = new HostPool([a, b], 1);
    const h1 = await pool.acquire();
    const h2 = await pool.acquire();
    expect(new Set([h1, h2]).size).toBe(2);
    let pinnedGot: TierEnv | null = null, freeGot: TierEnv | null = null;
    void pool.acquire(a).then((h) => { pinnedGot = h; });
    void pool.acquire().then((h) => { freeGot = h; });
    pool.release(b);
    await sleep(0);
    expect(freeGot).toBe(b); // the unpinned waiter took b although the pinned one queued first
    expect(pinnedGot).toBeNull();
    pool.release(a);
    await sleep(0);
    expect(pinnedGot).toBe(a);
  });
  it('AUGMTD units lease accounts: one world per account, worlds in parallel, host recorded, same result as one host', async () => {
    const per = [0, 1, 2].map(() => ({ live: 0, peakLive: 0, seeds: 0, teardowns: 0 }));
    const all = { live: 0, peak: 0 };
    const hostEnv = (i: number): TierEnv => {
      const e = trackingEnv('standard', per[i], `3333333${i}-3333-4333-8333-333333333333`);
      return { ...e, host: `std#${i + 1}`,
        async seed(ctx, w) { all.live++; all.peak = Math.max(all.peak, all.live); return e.seed(ctx, w); },
        async teardown(ctx, sw) { all.live--; return e.teardown(ctx, sw); } };
    };
    const plan = { adapters: [manyCases(12)], columns: ['augmtd', 'same'] as const, repeat: 1, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW };
    const pooled = await runEngine({ ...plan, columns: [...plan.columns], envs: [hostEnv(0), hostEnv(1), hostEnv(2)], concurrency: 6, worldLanes: 1 });
    const single = await runEngine({ ...plan, columns: [...plan.columns], envs: [trackingEnv('standard', { live: 0, peakLive: 0, seeds: 0, teardowns: 0 })], concurrency: 6, worldLanes: 1 });
    expect(strip(pooled)).toEqual(strip(single));
    expect(pooled.surfaces.length).toBe(1); // pool members are not extra surfaces
    for (const p of per) { expect(p.peakLive).toBeLessThanOrEqual(1); expect(p.seeds).toBeGreaterThan(0); expect(p.teardowns).toBe(p.seeds); }
    expect(all.peak).toBeGreaterThan(1); // worlds ran in parallel across accounts
    const hosts = pooled.concurrency!.hosts!;
    expect(Object.values(hosts).reduce((n, h) => n + h.runs, 0)).toBe(12);
    expect(Object.values(hosts).every((h) => h.peakWorlds <= 1)).toBe(true);
    const runs = pooled.surfaces[0].cases.flatMap((c) => c.runs.augmtd!);
    expect(runs.every((r) => /^std#[123]$/.test(r.host ?? ''))).toBe(true);
    expect(pooled.surfaces[0].cases.flatMap((c) => c.runs.same!).every((r) => r.host == null)).toBe(true);
  });
  it('a conversation adapter stays on the primary account (it reads the primary\'s standing state)', async () => {
    const envs = [0, 1].map((i) => ({ ...fakeEnv('standard', ANSWERS, []), host: `std#${i + 1}` }));
    const r = await runEngine({ adapters: [manyCases(4)].map((a) => ({ ...a, family: 'conversation' as const })), envs, columns: ['augmtd'], repeat: 1, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW, concurrency: 4 });
    expect(r.surfaces[0].cases.flatMap((c) => c.runs.augmtd!).map((x) => x.host)).toEqual(['std#1', 'std#1', 'std#1', 'std#1']);
  });
  it('--resume with a different pool size: every unit lands exactly once', async () => {
    const hostEnv = (i: number): TierEnv => ({ ...fakeEnv('standard', ANSWERS, []), host: `std#${i + 1}` });
    const recs: RunRecord[] = [];
    const plan = { adapters: [manyCases(10)], columns: ['augmtd', 'same'] as Array<'augmtd' | 'same'>, repeat: 2, maxEur: 10, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW };
    const leg1 = await runEngine({ ...plan, envs: [0, 1, 2, 3].map(hostEnv), concurrency: 4, onRun: (r) => recs.push(r), shouldStop: () => (recs.length >= 14 ? 'stop' : null) });
    expect(leg1.pendingUnits).toBeGreaterThan(0);
    const seen: RunRecord[] = [];
    const leg2 = await runEngine({ ...plan, envs: [hostEnv(0)], concurrency: 2, prior: recs, onRun: (r) => seen.push(r) });
    const keys = [...recs, ...seen].map((r) => `${r.caseId}|${r.repeat}|${r.column}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(10 * 2 * 2);
    expect(leg2.resumedRuns).toBe(recs.length);
    expect(seen.filter((r) => r.column === 'augmtd').every((r) => r.run.host === 'std#1')).toBe(true);
  });
});

// ── W27.C — the envelope, the two clocks, the zone per world, the effort A/B ───────────────────
import { resumeDayDrift } from '../../scripts/lib/eval/engine/journal';
import { sentEffort } from '../../scripts/lib/eval/meter';
import { estimateRun } from '../../scripts/lib/eval/engine/estimate';

describe('W27.C engine follow-ups', () => {
  const THREADED: World = {
    people: [{ key: 'sam', name: 'Sam', email: 'sam@acme.test' }],
    threads: [{
      key: 't1', subject: 'Quote',
      messages: [
        { key: 'm1', from: 'sam', at: '-3d 09:30', body: 'Can you send the quote?' },
        { key: 'm2', from: 'me', at: '-2d 10:00', body: 'On it.' },
        { key: 'm3', from: 'sam', at: '-1d 08:00', body: 'Any news? We need it by {{+1d}}.' },
        { key: 'm4', from: 'me', at: '-2h', body: 'Tomorrow.' },
      ],
    }],
  };
  it('the item envelope rides the NEWEST inbound message (a real sync); the anchor stays the founding one', () => {
    const t = resolveWorld(THREADED, NOW).threads[0];
    expect(t.anchorKey).toBe('m1');
    expect(t.envelopeKey).toBe('m3');
    const pinned = resolveWorld({ ...THREADED, threads: [{ ...THREADED.threads![0], item: { key: 'i1', anchor: 'm2' } }] }, NOW).threads[0];
    expect(pinned.envelopeKey).toBe('m2'); // an explicit anchor pins the envelope (fixture intent)
  });
  it('the seeded envelope carries the newest inbound body, the item is still founded on the anchor', async () => {
    forgetLiveWorlds();
    const { client, db } = fakeSupabase({ [PROBE]: PROBE_EMAILS.standard });
    const ctx = { admin: client, userId: PROBE, now: NOW };
    const s = await seedWorld(ctx, THREADED);
    const item = db.inbox_items.find((r) => r.id === s.ids.t1)!;
    const sd = item.source_data as Row;
    expect(sd.body).toMatch(/Any news\?/);
    expect(sd.email_id).toBe(s.ids.m3);
    expect(item.created_at).toBe(resolveWhen('-3d 09:30', NOW).toISOString());
    expect(item.last_activity_at).toBe(resolveWhen('-2h', NOW).toISOString());
    expect((await teardownWorld(ctx, s)).errors).toEqual([]);
  });
  it('THE TWO CLOCKS: AUGMTD worlds + producers on the wall clock, truths on the run clock; day drift is counted', async () => {
    const WALL = new Date(NOW.getTime() + 4 * 3_600_000); // a resume 4 h later, same day
    const seen: Array<{ now: string; truthNow?: string }> = [];
    const adapter = fakeAdapter({
      async produce(ctx) { seen.push({ now: ctx.now.toISOString() }); return { text: 'served', value: { relevance: 'reply', bulk: false } }; },
      resolveTruth: (c, now) => ({ ...c.truth, at: now.toISOString() }),
    });
    const scopes: string[] = [];
    const env = { ...fakeEnv('standard', ANSWERS, []), worldScope: (_ctx: unknown, s: unknown) => { scopes.push(s ? 'seeded' : 'torn'); } };
    const r = await runEngine({ adapters: [adapter], envs: [env], columns: ['augmtd'], repeat: 1, maxEur: 5, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW, worldClock: () => WALL });
    expect(seen.every((x) => x.now === WALL.toISOString())).toBe(true);
    expect(r.surfaces[0].cases[0].truth.at).toBe(NOW.toISOString());
    expect(r.clock).toMatchObject({ run: NOW.toISOString(), worldClock: 'wall', maxSkewMs: 4 * 3_600_000, dayDrift: [] });
    expect(scopes).toEqual(['seeded', 'torn', 'seeded', 'torn']);
    const NEXT_DAY = new Date(NOW.getTime() + 20 * 3_600_000);
    const r2 = await runEngine({ adapters: [adapter], envs: [fakeEnv('standard', ANSWERS, [])], columns: ['augmtd'], repeat: 1, maxEur: 5, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW, worldClock: () => NEXT_DAY });
    expect(r2.clock!.dayDrift.length).toBe(2);
    // Default (tests, fakes): the run clock for everything.
    const r3 = await runEngine({ adapters: [adapter], envs: [fakeEnv('standard', ANSWERS, [])], columns: ['augmtd'], repeat: 1, maxEur: 5, judge: null, meter: fakeMeter(), price: priceCalls, now: NOW });
    expect(r3.clock).toMatchObject({ worldClock: 'run', maxSkewMs: 0 });
  });
  it('a resume on another calendar day is detected per zone', () => {
    expect(resumeDayDrift(NOW, new Date(NOW.getTime() + 4 * 3_600_000), ['UTC', 'Europe/Lisbon'])).toEqual([]);
    const d = resumeDayDrift(new Date('2026-09-29T20:00:00Z'), new Date('2026-09-29T23:30:00Z'), ['UTC', 'Europe/Lisbon']);
    expect(d).toEqual(['Europe/Lisbon: run clock 2026-09-29 vs today 2026-09-30']);
  });
  it('THE EFFORT A/B: the override is recorded in the column meta, the result header and the report; reasoning per unit', async () => {
    const meter: MeterPort = { async run(fn) { return { result: await fn(), calls: [{ model: 'gpt-5-mini', promptTokens: 10, completionTokens: 400, reasoningTokens: 320, metered: true, ms: 1, effort: 'low' }] }; } };
    const r = await runEngine({ adapters: [fakeAdapter()], envs: [fakeEnv('standard', ANSWERS, [])], columns: ['augmtd', 'same'], repeat: 2, maxEur: 5, judge: null, meter, price: priceCalls, now: NOW, effortOverride: { classification: 'low' } });
    expect(r.effortOverride).toEqual({ classification: 'low' });
    const aug = r.surfaces[0].columns.find((c) => c.id === 'augmtd')!;
    expect(aug.effort).toBe('low');
    expect(r.surfaces[0].columns.find((c) => c.id === 'same')!.effort).toBe('minimal'); // the plain column keeps its own
    expect(r.surfaces[0].cases[0].runs.augmtd![0].out).toMatchObject({ reasoningTokens: 320, efforts: ['low'] });
    const md = renderEngineReport(r, [fakeAdapter()]);
    expect(md).toContain('AUGMTD effort override (eval-only)**: classification=low');
    expect(md).toContain('AUGMTD effort · reasoning tok/unit');
    expect(md).toContain('low (sent: low) · 320');
    expect(md).toContain('augmtd reasoning tok (per run)');
    expect(md).toMatch(/\| 320 \/ 320 \|/);
  });
  it('the pool assertion flags an idle account only beside a doubled-up one (a 4th account left idle is fine)', () => {
    const base = { version: 1, startedAt: '', finishedAt: '', now: '', repeat: 1, judgeModel: null, totalCostEur: 0, budgetEur: 1, budgetHit: false, stubbed: true, surfaces: [], notes: [], resumedRuns: 1 } as unknown as EngineResult;
    const accounts = ['std#1', 'std#2', 'std#3', 'std#4'].map((label) => ({ label, tier: 'standard' }));
    const sched = { leaks: [], caps: {}, peak: {}, concurrency: 6, expectResume: false, plannedRuns: 0, pool: { worldLanes: 6, unfair: [], accounts } };
    const hosts = (h: Record<string, [number, number]>) => ({ ...base, concurrency: { units: 6, worldLanes: 6, peakUnits: 6, hosts: Object.fromEntries(Object.entries(h).map(([k, [runs, peakWorlds]]) => [k, { tier: 'standard' as const, runs, peakWorlds }])) } });
    expect(selfCheckProblems(hosts({ 'std#1': [3, 1], 'std#2': [3, 1], 'std#3': [2, 1], 'std#4': [0, 0] }), [], [], sched)).toEqual([]);
    expect(selfCheckProblems(hosts({ 'std#1': [5, 2], 'std#2': [3, 1], 'std#3': [0, 0], 'std#4': [0, 0] }), [], [], sched).join()).toMatch(/std#3, std#4 hosted no AUGMTD run while std#1 held 2\+ worlds/);
  });
  it('the meter records the effort a request was SENT with', () => {
    expect(sentEffort({ [Symbol.for('augmtd.ai.effort')]: 'low', reasoning_effort: 'low' })).toBe('low');
    expect(sentEffort({ [Symbol.for('augmtd.ai.effort')]: null })).toBe('n/a');
    expect(sentEffort({ reasoning_effort: 'minimal' })).toBe('minimal');
    expect(sentEffort({ thinking: { type: 'enabled', budget_tokens: 1024 } })).toBe('thinking:1024');
    expect(sentEffort({ model: 'x' })).toBeUndefined();
  });
  it('the estimate prices an AUGMTD slot under an effort override like a reasoning column', () => {
    const a = fakeAdapter();
    const base = { adapters: [a], tiers: ['standard' as const], columns: ['augmtd' as const], repeat: 1, judge: null, now: NOW, select: () => true, plainModels: { sonnet55: 'claude-sonnet-5-5', gpt56: 'gpt-5.6-terra' } };
    const off = estimateRun(base).total, on = estimateRun({ ...base, augmtdEffort: { classification: 'low' } }).total;
    expect(on).toBeGreaterThan(off);
    expect(estimateRun({ ...base, augmtdEffort: { classification: 'minimal' } }).total).toBe(off);
  });
});
