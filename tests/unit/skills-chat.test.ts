// W21 · SKILLS IN CHAT — zero AI, zero network. The pick semantics, the menu order, the followed floor,
// the marker never reaching a surface, the repeated-ask offer, "save as skill" writing nothing, and the
// two chief doors (Home ask + item steer) running every answer through THE ONE RESOLVER — both doors
// driven end to end over an in-memory Supabase with the conversation core stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const stub = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; kind: string }>,
  converseCalls: [] as Array<{ text: string; skills: unknown }>,
  say: 'Here is the summary.',
}));

// ── an in-memory Supabase that RECORDS every write ─────────────────────────────────────────────────
function fakeDb() {
  const t = stub.tables;
  const table = (name: string) => (t[name] ??= []);
  const q = (name: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: 'select' | 'update' | 'insert' | 'upsert' | 'delete'; patch?: Row; rows?: Row[] } = { kind: 'select' };
    let from = 0, to = Infinity, lim = Infinity;
    let orderBy: { k: string; asc: boolean } | null = null;
    const run = () => {
      if (op.kind !== 'select') stub.writes.push({ table: name, kind: op.kind });
      if (op.kind === 'insert' || op.kind === 'upsert') {
        for (const r of op.rows ?? []) {
          if (op.kind === 'upsert') {
            const ex = table(name).find((x) => x.user_id === r.user_id && x.kind === r.kind && x.entity_id === r.entity_id);
            if (ex) { Object.assign(ex, r); continue; }
          }
          table(name).push({ id: `${name}-${table(name).length + 1}`, created_at: new Date().toISOString(), ...r });
        }
        return { data: null, error: null };
      }
      let hit = table(name).filter((r) => filters.every((f) => f(r)));
      if (op.kind === 'update') { for (const r of hit) Object.assign(r, op.patch); return { data: null, error: null }; }
      if (op.kind === 'delete') { t[name] = table(name).filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      if (orderBy) { const { k, asc } = orderBy; hit = [...hit].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1)); }
      hit = hit.slice(from, to === Infinity ? undefined : to + 1).slice(0, lim);
      return { data: hit, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (rows: Row | Row[]) => { op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return api; },
      upsert: (rows: Row | Row[]) => { op = { kind: 'upsert', rows: Array.isArray(rows) ? rows : [rows] }; return api; },
      update: (patch: Row) => { op = { kind: 'update', patch }; return api; },
      delete: () => { op = { kind: 'delete' }; return api; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return api; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
      gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return api; },
      order: (k: string, o?: { ascending?: boolean }) => { if (!orderBy) orderBy = { k, asc: o?.ascending !== false }; return api; },
      range: (a: number, b: number) => { from = a; to = b; return api; },
      limit: (n: number) => { lim = n; return api; },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return api;
  };
  return {
    from: (name: string) => q(name),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: async () => ({ data: [], error: null }),
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeDb() }));
vi.mock('@/lib/converse', () => ({
  converse: vi.fn(async (_c: unknown, _u: string, _s: unknown, text: string, opts?: { skills?: unknown }) => {
    stub.converseCalls.push({ text, skills: opts?.skills });
    return { say: stub.say, refs: [] };
  }),
}));

import { applySkillPick, buildSkillsForTurn, resolveSkillsForTurn, sanitizeSkillPick } from '@/lib/skills/for-turn';
import { buildChatMenu } from '@/lib/skills/menu';
import { createSkillsMarkerFilter, floorFollowed, parseSkillsMarker, settleSkillsFollowed, SKILLS_REPORT_RULE } from '@/lib/skills/followed';
import { askTokens, decideSkillOffer, evaluateSkillOffer, recordOfferDecline } from '@/lib/skills/offer';
import { conversationTranscript, draftSkillFromConversation } from '@/lib/skills/from-conversation';
import { buildSkillSynthesisPrompt } from '@/lib/skills/synthesize';
import { renderSkillsBlock } from '@/lib/work/worker-skills-context';
import { EXCERPT_MARK } from '@/lib/utils/clip-for-prompt';
import { POST as homeAsk } from '@/app/api/home/ask/route';
import { POST as steer } from '@/app/api/items/steer/route';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CHIEF = U(900), MAX = U(901), FOREIGN = U(999);
const lib = [
  { id: U(1), name: 'Board summary', when_to_use: 'When summarising for the board', content: 'Three bullets, numbers first.', updated_at: '2026-09-27' },
  { id: U(2), name: 'Plain tone', when_to_use: null, content: 'Short sentences.', updated_at: '2026-09-26' },
  { id: U(3), name: 'Proposal format', when_to_use: 'When writing proposals', content: 'Problem, approach, price.', updated_at: '2026-09-25' },
  { id: U(4), name: 'Client recap', when_to_use: 'When recapping a client call', content: 'Decisions, owners, dates.', updated_at: '2026-09-24' },
];

function seed() {
  stub.tables = {
    skills: lib.map((s) => ({ ...s, user_id: 'user-1' })).concat([{ id: FOREIGN, user_id: 'user-2', name: 'Not yours', when_to_use: null, content: 'x', updated_at: '2026-09-28' }]),
    agent_skills: [{ agent_id: CHIEF, skill_id: U(1) }, { agent_id: CHIEF, skill_id: U(2) }, { agent_id: MAX, skill_id: U(3) }],
    custom_agents: [
      { id: CHIEF, user_id: 'user-1', name: 'Clara', worker_role: 'personal_assistant', is_worker: true, is_active: true, created_at: '2026-01-01' },
      { id: MAX, user_id: 'user-1', name: 'Max', worker_role: 'researcher', is_worker: true, is_active: true, created_at: '2026-01-02' },
    ],
    item_plans: [], room_turns: [], work_threads: [], work_messages: [],
  };
  stub.writes = [];
  stub.converseCalls = [];
}
beforeEach(seed);
const client = () => fakeDb() as never;
const req = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('A · the menu', () => {
  it('assigned first (library order), then the rest by recency; nothing dropped', () => {
    const m = buildChatMenu({ id: CHIEF, name: 'Clara' }, lib, [U(2), U(4)]);
    expect(m.skills.map((s) => [s.name, s.assigned])).toEqual([
      ['Plain tone', true], ['Client recap', true], ['Board summary', false], ['Proposal format', false],
    ]);
    expect(m.skills[0]).toEqual({ id: U(2), name: 'Plain tone', whenToUse: null, assigned: true });
  });
});

describe('B · the pick: this message only', () => {
  it('assigned skills are on by default', () => {
    expect(applySkillPick(lib, [U(1), U(2)]).map((s) => s.id)).toEqual([U(1), U(2)]);
  });
  it('skip removes only assigned skills; add brings only unassigned library skills; foreign ids ignored', () => {
    const got = applySkillPick(lib, [U(1), U(2)], { skip: [U(2), U(3)], add: [U(3), U(1), FOREIGN] });
    expect(got.map((s) => [s.id, s.origin])).toEqual([[U(3), 'added'], [U(1), 'assigned']]);
  });
  it('sanitizeSkillPick drops non-uuids and dedupes', () => {
    expect(sanitizeSkillPick({ add: ['nope', U(1), U(1)], skip: 7 })).toEqual({ add: [U(1)] });
    expect(sanitizeSkillPick({ add: [], skip: [] })).toBeUndefined();
    expect(sanitizeSkillPick('x')).toBeUndefined();
  });
  it('the resolver: the chief is the seat-holder; skip never unassigns, add never assigns (no writes)', async () => {
    const r = await resolveSkillsForTurn(client(), 'user-1', { kind: 'chief' }, { skip: [U(1)], add: [U(4), FOREIGN] });
    expect(r.actorId).toBe(CHIEF);
    expect(r.offered.map((s) => s.name)).toEqual(['Client recap', 'Plain tone']);
    expect(r.block).toContain(SKILLS_REPORT_RULE);
    expect(r.plainBlock).not.toContain('SKILLS REPORT');
    expect(r.addedPlainBlock).toContain('Client recap');
    expect(r.addedPlainBlock).not.toContain('Plain tone');
    expect(r.block).not.toContain('Not yours');
    expect(stub.writes).toEqual([]);
    expect(stub.tables.agent_skills).toHaveLength(3);
  });
  it('a coworker actor reads its own assignments', async () => {
    const r = await resolveSkillsForTurn(client(), 'user-1', { kind: 'agent', agentId: MAX });
    expect(r.offered.map((s) => s.name)).toEqual(['Proposal format']);
  });
  it('the block is the user\'s own voice, clipped under the excerpt law, and over-budget skills are declared, not offered', () => {
    const long = { id: U(7), name: 'Long', when_to_use: null, content: 'Sentence one. '.repeat(600), origin: 'assigned' as const };
    expect(renderSkillsBlock([long], { voice: 'user-own' })).toContain(EXCERPT_MARK);
    expect(renderSkillsBlock([long], { voice: 'user-own' })).toContain("USER'S OWN");
    const r = buildSkillsForTurn(CHIEF, [long, { ...long, id: U(8), name: 'Long two' }, { ...long, id: U(9), name: 'Long three' }, { ...long, id: U(10), name: 'Long four' }, { ...long, id: U(11), name: 'Long five' }]);
    expect(r.notLoaded.length).toBeGreaterThan(0);
    expect(r.block).toContain('were not loaded for length');
    expect(r.offered.some((s) => r.notLoaded.some((n) => n.id === s.id))).toBe(false);
  });
});

describe('C · the followed floor (a claim renders)', () => {
  const offered = [{ id: U(1), name: 'Board summary' }, { id: U(2), name: 'Plain tone' }];
  it('reported ∩ loaded — an invented or unloaded skill is never claimed', () => {
    const s = settleSkillsFollowed('Done.\n[[skills_applied:board summary|Proposal format|Made up]]', offered);
    expect(s.text).toBe('Done.');
    expect(s.followed).toEqual([{ id: U(1), name: 'Board summary' }]);
    expect(floorFollowed(['Plain tone'], [])).toEqual([]);
  });
  it('no marker → nothing claimed, text untouched', () => {
    expect(settleSkillsFollowed('Plain answer [E1].', offered)).toEqual({ text: 'Plain answer [E1].', followed: [] });
    expect(parseSkillsMarker('x [[skills_applied:]]').text).toBe('x');
  });
  it('the live stream never shows the marker, even split across chunks', () => {
    const out: string[] = [];
    const f = createSkillsMarkerFilter((t) => out.push(t));
    for (const c of ['Here it is. ', '[', '[skills_app', 'lied:Board summary]', ']']) f.push(c);
    f.flush();
    expect(out.join('')).toBe('Here it is. ');
  });
});

describe('D · the offer', () => {
  const prior = ['Draft the weekly investor update for Acme', 'draft investor update for Acme this week please'];
  it('fires on the 3rd similar ask, not the 2nd', () => {
    const cur = 'Can you draft the weekly investor update for Acme?';
    expect(decideSkillOffer({ current: cur, prior: prior.slice(0, 1), skills: [], declined: [] })).toBeNull();
    const o = decideSkillOffer({ current: cur, prior, skills: [], declined: [] });
    expect(o?.patternKey).toMatch(/^ask:/);
    expect(o?.label).toContain('investor update');
  });
  it('never after a decline; never when a skill covers it; dissimilar asks never count', () => {
    const cur = 'Can you draft the weekly investor update for Acme?';
    const o = decideSkillOffer({ current: cur, prior, skills: [], declined: [] })!;
    expect(decideSkillOffer({ current: cur, prior, skills: [], declined: [o.patternKey] })).toBeNull();
    expect(decideSkillOffer({ current: cur, prior, skills: [{ name: 'Investor update', when_to_use: 'When drafting investor updates' }], declined: [] })).toBeNull();
    expect(decideSkillOffer({ current: cur, prior: ['book a flight to Lisbon', 'what is on my calendar'], skills: [], declined: [] })).toBeNull();
    expect(askTokens('the summaries')).toEqual(['summary']);
  });
  it('end to end over the store: 3rd ask offers, the decline is recorded and holds', async () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    stub.tables.room_turns.push(
      { user_id: 'user-1', role: 'user', room_key: 'chat:a', text: prior[0], created_at: old },
      { user_id: 'user-1', role: 'user', room_key: 'chat:b', text: prior[1], created_at: old },
    );
    const cur = 'Can you draft the weekly investor update for Acme?';
    const first = await evaluateSkillOffer(client(), 'user-1', cur);
    expect(first.offer).not.toBeNull();
    expect(await recordOfferDecline(client(), 'user-1', first.offer!.patternKey)).toBe(true);
    expect((await evaluateSkillOffer(client(), 'user-1', cur)).offer).toBeNull();
  });
});

describe('E · save as skill writes nothing', () => {
  it('reads the conversation, synthesizes (stubbed model) and writes no row', async () => {
    stub.tables.room_turns.push(
      { user_id: 'user-1', room_key: 'chat:c1', role: 'user', text: 'Summarise the board pack in three bullets, numbers first.', created_at: '2026-09-27T10:00:00Z', archived_at: null },
      { user_id: 'user-1', room_key: 'chat:c1', role: 'system', text: 'Revenue up 12%…', created_at: '2026-09-27T10:00:05Z', archived_at: null },
    );
    let seen = '';
    const draft = await draftSkillFromConversation(client(), 'user-1', 'chat:c1', async (_c, _u, input) => {
      seen = buildSkillSynthesisPrompt(input).prompt;
      return { name: 'Board summary', when_to_use: 'When summarising board packs', content: '- numbers first', kind: null };
    });
    expect(draft).toEqual({ name: 'Board summary', whenToUse: 'When summarising board packs', instructions: '- numbers first' });
    expect(seen).toContain('DATA');
    expect(seen).toContain('three bullets');
    expect(stub.writes).toEqual([]);
    expect(await draftSkillFromConversation(client(), 'user-1', 'chat:missing', async () => { throw new Error('no'); })).toBeNull();
    expect(conversationTranscript([{ role: 'user', text: 'x '.repeat(2000) }])).toContain(EXCERPT_MARK);
  });
});

describe('F · every chief answer passes through the resolver', () => {
  it('Home ask: assigned + pick reach the core; the pick writes nothing', async () => {
    const res = await homeAsk(req('http://x/api/home/ask', { question: 'status on the pilot?', entityId: 'ent-1', skills: { skip: [U(2)], add: [U(3)] } }));
    expect(res.status).toBe(200);
    const s = stub.converseCalls[0].skills as { offered: Array<{ name: string }> };
    expect(s.offered.map((o) => o.name)).toEqual(['Proposal format', 'Board summary']);
    expect(stub.writes.filter((w) => w.table === 'agent_skills' || w.table === 'skills')).toEqual([]);
  });
  it('item steer: same resolver, same chief', async () => {
    const res = await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-1', text: 'what did they ask?', skills: { skip: [U(1)] } }));
    expect(res.status).toBe(200);
    const s = stub.converseCalls[0].skills as { offered: Array<{ name: string }> };
    expect(s.offered.map((o) => o.name)).toEqual(['Plain tone']);
  });
});
