/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — PROJECTS FOLLOW THE MAIL, JUDGMENTS FOLLOW WHAT MATTERS (stabilization W9.3 —
 * docs/laws-registry.md `projects-follow-the-mail` · `judgments-follow-what-matters`).
 *
 * The Sep 23 audit: an entity's state moved only on a user action or the 2-hourly catch-all, never
 * when recognition linked new mail/meetings to it; recognition itself waited for a Home load; the
 * hourly calendar cron never recognized; and every state re-synthesis re-judged every member item
 * (the judge sig keyed on entity.sig) while "BE CONSISTENT" held the prior against a moved present.
 *
 *   P · THE PLAN        — planEntityRefresh: fresh first, coalesce inside the window, drain due dirty
 *                          markers, overflow past the cap (reported), maxRun 0 marks only.
 *   R · THE SCHEDULE    — a sync that links NEW members to one entity runs ONE refresh; a second sync
 *                          inside the window coalesces (dirty, no refresh); the next tail after the
 *                          window drains it (one refresh); two concurrent schedulers claim once.
 *   B · THE BOOTSTRAP   — a user with no memory is bootstrapped FROM THE SYNC TAIL (links written,
 *                          refresh scheduled), cooled down per process; the pure due-rule.
 *   C · THE CALENDAR    — the calendar sync recognizes the events it upserted (bounded, reported);
 *                          the pure candidate plan; the gate-closed no-op.
 *   J · THE JUDGE SIG   — the entity dep is the RENDERED deal block: a re-synthesis that changes
 *                          nothing the judge reads leaves the sig unchanged; a changed summary/next
 *                          move/goal moves it; JUDGE_VERSION untouched by this wave.
 *   M · MATERIAL CHANGE — newer inbound, deadline passing, next-move change are named; an unchanged
 *                          present keeps "BE CONSISTENT" byte-identical; an unstamped prior is never
 *                          guessed material.
 *   S · SOURCE          — the hooks await the schedule (no bare void), the brief comment tells the
 *                          truth, the calendar sync awaits the hook, the marker kind is registered.
 *
 * ZERO AI, zero network, zero DB (an in-memory recording fake client). Exit 1 on failure.
 *   npx tsx scripts/smoke-projects-follow.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  planEntityRefresh, scheduleEntityRefresh, ENTITY_REFRESH_COALESCE_MS, ENTITY_REFRESH_EPOCH,
} from '../lib/entities/refresh-schedule';
import {
  shadowRecognizeTouched, shadowRecognizeCalendarEvents, planCalendarRecognition, syncBootstrapDue, isRecognizableEvent,
} from '../lib/entities/hooks';
import { dealBlockOf, materialChangesSince, materialChangeClause, type MaterialStamp } from '../lib/work/judge';
import { sigOf } from '../lib/core/sig';
import { ITEM_PLAN_REGISTRY } from '../lib/store/item-plans';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── an in-memory recording fake Supabase client (no network) ──────────────────────────────────────
type Row = Record<string, any>;
type Op = { table: string; op: string; cols?: string };
function fakeClient(tables: Record<string, Row[]>, opts: { hide?: (table: string, cols: string) => boolean } = {}) {
  const log: Op[] = [];
  const get = (r: Row, col: string): any => {
    const m = /^(\w+)->>(\w+)$/.exec(col);
    if (m) { const v = r[m[1]]?.[m[2]]; return v == null ? null : String(v); }
    return r[col];
  };
  const unique: Record<string, string[]> = { item_plans: ['user_id', 'kind', 'entity_id'], entity_links: ['user_id', 'item_kind', 'item_id'] };
  const keyOf = (t: string, r: Row) => (unique[t] ?? ['id']).map((c) => String(r[c])).join('|');
  let seq = 0;
  function from(table: string) {
    tables[table] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let cols = '*'; let head = false; let count = false;
    let payload: Row[] = []; let patch: Row = {};
    let limitN: number | null = null; let rangeT: [number, number] | null = null;
    const orderBy: Array<[string, boolean]> = [];
    let single: 'maybe' | 'one' | null = null;
    const b: any = {
      select(c = '*', o: { count?: string; head?: boolean } = {}) { if (mode === 'select') { cols = c; head = !!o.head; count = !!o.count; } return b; },
      eq(c: string, v: unknown) { filters.push((r) => get(r, c) === (v == null ? v : (c.includes('->>') ? String(v) : v))); return b; },
      neq(c: string, v: unknown) { filters.push((r) => get(r, c) !== v); return b; },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(get(r, c))); return b; },
      gte(c: string, v: string) { filters.push((r) => String(get(r, c) ?? '') >= v); return b; },
      lte(c: string, v: string) { filters.push((r) => String(get(r, c) ?? '') <= v); return b; },
      lt(c: string, v: string) { filters.push((r) => String(get(r, c) ?? '') < v); return b; },
      is(c: string, v: null) { filters.push((r) => get(r, c) == v); return b; },
      not(c: string, _op: string, _v: null) { filters.push((r) => get(r, c) != null); return b; },
      like(c: string, p: string) { const pre = p.replace(/%$/, '').replace(/\\(.)/g, '$1'); filters.push((r) => String(get(r, c) ?? '').startsWith(pre)); return b; },
      or() { return b; },
      filter() { return b; },
      order(c: string, o: { ascending?: boolean } = {}) { orderBy.push([c, o.ascending !== false]); return b; },
      limit(n: number) { limitN = n; return b; },
      range(f: number, t: number) { rangeT = [f, t]; return b; },
      maybeSingle() { single = 'maybe'; return b; },
      single() { single = 'one'; return b; },
      insert(rows: Row | Row[]) { mode = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return b; },
      upsert(rows: Row | Row[]) { mode = 'upsert'; payload = Array.isArray(rows) ? rows : [rows]; return b; },
      update(p: Row) { mode = 'update'; patch = p; return b; },
      delete() { mode = 'delete'; return b; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
    };
    function run(): { data: any; error: any; count?: number } {
      const t = tables[table];
      log.push({ table, op: mode, cols });
      if (mode === 'insert') {
        for (const r of payload) if (t.some((x) => keyOf(table, x) === keyOf(table, r))) return { data: null, error: { message: 'duplicate key', code: '23505' } };
        const added = payload.map((r) => ({ id: r.id ?? `row-${++seq}`, ...r }));
        t.push(...added);
        return { data: added.map((r) => ({ id: r.id })), error: null };
      }
      if (mode === 'upsert') {
        for (const r of payload) {
          const i = t.findIndex((x) => keyOf(table, x) === keyOf(table, r));
          if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ id: r.id ?? `row-${++seq}`, ...r });
        }
        return { data: null, error: null };
      }
      const hit = t.filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') { for (const r of hit) Object.assign(r, patch); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      if (mode === 'delete') { tables[table] = t.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      if (opts.hide?.(table, cols)) return { data: single ? null : [], error: null };
      if (head) return { data: null, error: null, count: hit.length };
      let out = [...hit];
      for (const [c, asc] of [...orderBy].reverse()) out.sort((a, z) => (String(get(a, c) ?? '') < String(get(z, c) ?? '') ? -1 : String(get(a, c) ?? '') > String(get(z, c) ?? '') ? 1 : 0) * (asc ? 1 : -1));
      if (rangeT) out = out.slice(rangeT[0], rangeT[1] + 1);
      if (limitN != null) out = out.slice(0, limitN);
      if (single) return { data: out[0] ?? null, error: null, ...(count ? { count: hit.length } : {}) };
      return { data: out.map((r) => ({ ...r })), error: null, ...(count ? { count: hit.length } : {}) };
    }
    return b;
  }
  return { client: { from } as any, log, tables };
}

// The refresh's FIRST read is the entity row with its sig — the probe hides it, so refreshEntityState
// returns before any ledger or AI work; each such read IS one refresh invocation.
const REFRESH_COLS = 'id, name, summary, aliases, sig, tracked';
const refreshes = (log: Op[]) => log.filter((o) => o.table === 'work_entities' && o.op === 'select' && o.cols === REFRESH_COLS).length;
const hideRefresh = { hide: (t: string, c: string) => t === 'work_entities' && c === REFRESH_COLS };

const U = 'user-a';
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const mail = (id: string, thread: string, title: string, at: number): Row => ({
  id, user_id: U, source: 'email', work_title: title, created_at: iso(at), updated_at: iso(at),
  source_data: { thread_id: thread, subject: title, from_name: 'Sam Rivera', from_address: 'sam@acme.example', body: `${title} — details inside.`, understanding: { relevance: 'reply' } },
});

async function main() {
  // ── P · THE PLAN ─────────────────────────────────────────────────────────────────────────────────
  console.log('P · THE PLAN (pure):');
  {
    const p1 = planEntityRefresh({ fresh: ['e1', 'e1', 'e2'], markers: {}, nowMs: NOW });
    gate('P1 fresh entities run, deduped (one refresh per entity per call)', JSON.stringify(p1.run) === '["e1","e2"]' && !p1.coalesce.length && !p1.overflow.length);
    const p2 = planEntityRefresh({ fresh: ['e1', 'e2', 'e3'], markers: {}, nowMs: NOW, maxRun: 1 });
    gate('P2 past the cap → overflow (reported, never silent)', JSON.stringify(p2.run) === '["e1"]' && JSON.stringify(p2.overflow) === '["e2","e3"]');
    const p3 = planEntityRefresh({ fresh: ['e1'], markers: { e1: { at: iso(NOW - 60_000), dirty: false } }, nowMs: NOW });
    gate('P3 refreshed inside the window → coalesce (no second synthesis)', !p3.run.length && JSON.stringify(p3.coalesce) === '["e1"]');
    const p4 = planEntityRefresh({ fresh: [], markers: { e1: { at: iso(NOW - ENTITY_REFRESH_COALESCE_MS - 1), dirty: true }, e2: { at: iso(NOW - 1000), dirty: true }, e3: { at: iso(NOW - 3_600_000), dirty: false } }, nowMs: NOW });
    gate('P4 THE DRAIN — a dirty marker past its window runs; one inside the window waits; a clean one never runs', JSON.stringify(p4.run) === '["e1"]' && !p4.coalesce.length);
    const p5 = planEntityRefresh({ fresh: ['e1', 'e2'], markers: {}, nowMs: NOW, maxRun: 0 });
    gate('P5 maxRun 0 marks only (the calendar path never pays a synthesis)', !p5.run.length && p5.overflow.length === 2);
    const p6 = planEntityRefresh({ fresh: [], markers: { e9: { at: ENTITY_REFRESH_EPOCH, dirty: true } }, nowMs: NOW });
    gate('P6 a released marker (epoch) is due at once', JSON.stringify(p6.run) === '["e9"]');
  }

  // ── R · THE SCHEDULE (outcome through the real hook) ───────────────────────────────────────────
  console.log('R · THE SCHEDULE (the email-sync tail → recognition → one coalesced refresh):');
  {
    const f = fakeClient({
      work_entities: [{ id: 'E1', user_id: U, kind: 'initiative', status: 'active', name: 'Acme Rollout', aliases: [], people: [] }],
      entity_links: [{ id: 'l0', user_id: U, entity_id: 'E1', item_kind: 'email_thread', item_id: 'T1', via: 'structural' }],
      inbox_items: [mail('i1', 'T1', 'Acme Rollout — pricing', NOW - 5000), mail('i2', 'T1', 'Acme Rollout — timeline', NOW - 4000), mail('i3', 'T1', 'Acme Rollout — contract', NOW - 3000)],
      commitments: [], item_plans: [],
    }, hideRefresh);
    const since = iso(NOW - 60_000);
    const r1 = await shadowRecognizeTouched(f.client, U, since);
    const members = f.tables.entity_links.filter((l) => l.entity_id === 'E1' && l.item_kind === 'inbox_item').length;
    gate('R1 recognition links the three NEW members structurally (zero AI)', r1?.ran === 3 && members === 3, JSON.stringify(r1));
    gate('R2 three new members on one entity → exactly ONE refresh', refreshes(f.log) === 1, `refreshes=${refreshes(f.log)}`);
    const mk = f.tables.item_plans.find((p) => p.kind === 'entity_refresh' && p.entity_id === 'E1');
    gate('R3 the claim is an entity_refresh marker (key = entity id, dirty false)', !!mk && mk.tasks?.dirty === false && typeof mk.tasks?.at === 'string');

    // a second sync inside the window brings one more member → coalesced, dirty, no refresh
    f.tables.inbox_items.push(mail('i4', 'T1', 'Acme Rollout — signed', NOW - 1000));
    const before = refreshes(f.log);
    await shadowRecognizeTouched(f.client, U, since);
    gate('R4 a new member inside the window coalesces — no second synthesis, marker DIRTY', refreshes(f.log) === before && mk?.tasks?.dirty === true);

    // the next tail after the window drains it
    const d = await scheduleEntityRefresh(f.client, U, [], { nowMs: NOW + ENTITY_REFRESH_COALESCE_MS + 1000 });
    gate('R5 THE TRAILING EDGE — the next call past the window drains the dirty entity once', d.ran === 1 && refreshes(f.log) === before + 1 && mk?.tasks?.dirty === false, JSON.stringify(d));

    // two concurrent schedulers on a fresh entity claim ONCE
    const g = fakeClient({ work_entities: [], item_plans: [] }, hideRefresh);
    const [a, b2] = await Promise.all([
      scheduleEntityRefresh(g.client, U, ['E2']), scheduleEntityRefresh(g.client, U, ['E2']),
    ]);
    gate('R6 two concurrent syncs → ONE refresh (the insert claim settles the race)', a.ran + b2.ran === 1 && refreshes(g.log) === 1, `${a.ran}+${b2.ran}`);

    // budget: an elapsed budget starts nothing and RELEASES the entity (due at once next call)
    const h = fakeClient({ work_entities: [], item_plans: [] }, hideRefresh);
    const late = await scheduleEntityRefresh(h.client, U, ['E3'], { budgetMs: -1 });
    const rel = h.tables.item_plans.find((p) => p.entity_id === 'E3');
    gate('R7 THE BUDGET — past the deadline nothing starts; the entity is released dirty and REPORTED', late.ran === 0 && late.leftBehind === 1 && rel?.tasks?.dirty === true && rel?.tasks?.at === ENTITY_REFRESH_EPOCH);
  }

  // ── B · THE BOOTSTRAP ────────────────────────────────────────────────────────────────────────────
  console.log('B · THE BOOTSTRAP (the sync tail opens the memory gate itself):');
  {
    gate('B1 due when never run; not while in flight; not inside the cool-down; due after it',
      syncBootstrapDue({ lastAt: undefined, inFlight: false, nowMs: NOW })
      && !syncBootstrapDue({ lastAt: undefined, inFlight: true, nowMs: NOW })
      && !syncBootstrapDue({ lastAt: NOW - 60_000, inFlight: false, nowMs: NOW })
      && syncBootstrapDue({ lastAt: NOW - 11 * 60_000, inFlight: false, nowMs: NOW }));
    const UB = 'user-b';
    // No INITIATIVE entity (the gate is closed); a thread link lets recognition resolve structurally.
    const f = fakeClient({
      work_entities: [{ id: 'E9', user_id: UB, kind: 'seed', status: 'active', name: 'Acme Audit', aliases: [], people: [] }],
      entity_links: [{ id: 'l9', user_id: UB, entity_id: 'E9', item_kind: 'email_thread', item_id: 'T9', via: 'structural' }],
      inbox_items: [1, 2, 3].map((n) => ({ ...mail(`b${n}`, 'T9', `Acme Audit — part ${n}`, NOW - n * 1000), user_id: UB })),
      commitments: [], item_plans: [],
    }, hideRefresh);
    const r = await shadowRecognizeTouched(f.client, UB, iso(NOW - 60_000));
    const linked = f.tables.entity_links.filter((l) => l.entity_id === 'E9' && l.item_kind === 'inbox_item').length;
    gate('B2 a user with NO memory is bootstrapped from the sync tail (not waiting for a Home load)', r?.bootstrapped === 3 && linked === 3, JSON.stringify(r));
    gate('B3 the bootstrap schedules the refresh of the entity it filled', refreshes(f.log) === 1);
    const again = await shadowRecognizeTouched(f.client, UB, iso(NOW - 60_000));
    gate('B4 the next tail inside the cool-down does not bootstrap again (per-process single-flight)', again === null || (again.bootstrapped ?? 0) === 0);
  }

  // ── C · THE CALENDAR ─────────────────────────────────────────────────────────────────────────────
  console.log('C · THE CALENDAR (the calendar sync recognizes what it upserted):');
  {
    const att2 = [{ email: 'a@acme.example' }, { email: 'b@acme.example' }];
    const rows = [
      { id: 'c1', title: 'Acme sync', attendees: att2, status: 'confirmed', start_time: '2026-09-25T10:00:00Z' },
      { id: 'c2', title: 'Focus block', attendees: [], status: 'confirmed', start_time: '2026-09-24T10:00:00Z' },
      { id: 'c3', title: 'Cancelled: Acme sync', attendees: att2, status: 'confirmed', start_time: '2026-09-24T11:00:00Z' },
      { id: 'c4', title: 'Acme review', attendees: att2, status: 'cancelled', start_time: '2026-09-24T12:00:00Z' },
      { id: 'c5', title: 'Acme kickoff', attendees: att2, status: 'confirmed', start_time: '2026-09-24T09:00:00Z' },
      { id: 'c6', title: 'Acme retro', attendees: att2, status: 'confirmed', start_time: '2026-09-26T09:00:00Z' },
      { id: 'c7', title: 'Acme demo', attendees: att2, status: 'confirmed', start_time: '2026-09-27T09:00:00Z' },
    ];
    gate('C1 one predicate: confirmed, not a raw cancellation, ≥2 attendees',
      isRecognizableEvent(rows[0]) && !isRecognizableEvent(rows[1]) && !isRecognizableEvent(rows[2]) && !isRecognizableEvent(rows[3]));
    const plan = planCalendarRecognition(rows, new Set(['c6']), 2);
    gate('C2 the plan: unseen recognizable events, soonest first, capped — the remainder COUNTED',
      JSON.stringify(plan.todo.map((r) => r.id)) === '["c5","c1"]' && plan.unseen === 3, JSON.stringify(plan));
    // outcome: every upserted event already a member → no recognition, nothing left, zero AI
    const f = fakeClient({
      work_entities: [{ id: 'E1', user_id: U, kind: 'initiative', status: 'active', name: 'Acme Rollout' }],
      calendar_events: [{ ...rows[0], user_id: U, provider: 'gmail', event_id: 'g-1' }, { ...rows[1], user_id: U, provider: 'gmail', event_id: 'g-2' }],
      entity_links: [{ id: 'lc', user_id: U, entity_id: 'E1', item_kind: 'calendar_event', item_id: 'c1', via: 'recognized' }],
      item_plans: [],
    });
    const r = await shadowRecognizeCalendarEvents(f.client, U, { provider: 'gmail', eventIds: ['g-1', 'g-2'] });
    const asked = f.log.some((o) => o.table === 'calendar_events');
    gate('C3 the hook maps the provider ids this read upserted to their rows; seen/solo events cost no recognition', asked && r?.ran === 0 && r?.left === 0, JSON.stringify(r));
    const closed = fakeClient({ work_entities: [], calendar_events: [], entity_links: [] });
    gate('C4 the gate-closed account is a no-op (bootstrap belongs to the email-sync tail)',
      (await shadowRecognizeCalendarEvents(closed.client, 'user-c', { provider: 'gmail', eventIds: ['x'] })) === null);
  }

  // ── J · THE JUDGE SIG ────────────────────────────────────────────────────────────────────────────
  console.log('J · THE JUDGE SIG keys on what the prompt reads:');
  {
    const base = { name: 'Acme Rollout', state: { summary: 'Sam sent pricing Sep 21; you owe the timeline.', momentum: 'needs_you', whoOwes: { you: ['timeline'], them: [] } }, next_move: { title: 'Send the timeline', reason: 'they asked', covers: ['inbox:i1'] }, goals: ['close by Q4'], rules: [], sig: 'v9:4:123:ev0' };
    // a re-synthesis that moved the entity's sig, momentum, whoOwes, next-move reason/covers, priority —
    // none of which the judge prompt renders
    const resynth = { ...base, sig: 'v9:5:999:ev1:j42', state: { ...base.state, momentum: 'active', whoOwes: { you: [], them: ['signature'] } }, next_move: { ...base.next_move, reason: 'still open', covers: [] }, priority: { weight: 80 } };
    const judgeSig = (ent: unknown) => sigOf({ version: 21, deps: { activityAt: 'a', entity: ent ? dealBlockOf(ent as never) : null } });
    gate('J1 a re-synthesis that changes nothing the judge reads leaves the judgment sig unchanged (no cascade)', judgeSig(base) === judgeSig(resynth));
    gate('J2 a changed summary re-judges', judgeSig(base) !== judgeSig({ ...base, state: { ...base.state, summary: 'Sam signed Sep 22.' } }));
    gate('J3 a changed next move / goal / rule re-judges',
      judgeSig(base) !== judgeSig({ ...base, next_move: { title: 'Chase the signature' } })
      && judgeSig(base) !== judgeSig({ ...base, goals: ['close by Q3'] })
      && judgeSig(base) !== judgeSig({ ...base, rules: ['never discount'] }));
    gate('J4 the block renders exactly the legacy deal line (the prompt text is unchanged → no JUDGE_VERSION bump)',
      dealBlockOf(base) === 'THE DEAL (Acme Rollout): Sam sent pricing Sep 21; you owe the timeline. · next move: Send the timeline · goals: close by Q4\n'
      && dealBlockOf(null) === '');
    const j = code('lib/work/judge.ts');
    gate('J5 source: the entity select drops `sig`; the dep is the rendered block, built before the sig; the prompt reuses the same block',
      /select\('name, state, next_move, goals, rules'\)/.test(j) && !/next_move, goals, rules, sig'/.test(j)
      && /entity: ent \? dealBlock : null/.test(j) && j.indexOf('const dealBlock = dealBlockOf(ent)') < j.indexOf('const sig = `${JUDGE_VERSION}')
      && /dealBlock \+ personBlock/.test(j) && !/let dealBlock/.test(j));
    gate('J6 no JUDGE_VERSION bump for this wave (a one-time format miss, not a corpus-wide re-judge; same-version priors keep anchoring)',
      !/W9\.3/.test((/export const JUDGE_VERSION = [^\n]*/.exec(src('lib/work/surface-registry.ts')) ?? [''])[0]));
  }

  // ── M · MATERIAL CHANGE ──────────────────────────────────────────────────────────────────────────
  console.log('M · MATERIAL CHANGE is named, consistency otherwise:');
  {
    const prior: MaterialStamp = { tn: '2026-09-20T09:00:00Z', dp: false, nm: 'Send the timeline' };
    gate('M1 nothing moved → no flag, the clause is empty (BE CONSISTENT stands byte-identical)',
      materialChangesSince(prior, { ...prior }).length === 0 && materialChangeClause([]) === '');
    gate('M2 a NEWER inbound message is material', materialChangesSince(prior, { ...prior, tn: '2026-09-22T09:00:00Z' }).some((c) => /NEWER message/.test(c)));
    gate('M3 the deadline PASSING is material (only the false → true edge)',
      materialChangesSince(prior, { ...prior, dp: true }).some((c) => /deadline has PASSED/.test(c))
      && materialChangesSince({ ...prior, dp: true }, { ...prior, dp: true }).length === 0);
    gate('M4 the deal\'s next move changing (or clearing) is material',
      materialChangesSince(prior, { ...prior, nm: 'Chase the signature' }).some((c) => /next move CHANGED/.test(c))
      && materialChangesSince(prior, { ...prior, nm: '' }).some((c) => /CLEARED/.test(c)));
    gate('M5 an unstamped prior (cached before W9.3) is never guessed material',
      materialChangesSince(null, { tn: 'x', dp: true, nm: 'y' }).length === 0 && materialChangesSince({}, { tn: 'x', dp: true, nm: 'y' }).length === 0);
    gate('M6 the named clause tells the judge the prior does not hold where the present moved',
      /MATERIAL CHANGE SINCE THAT CALL: .* consistency with the prior call does not hold/.test(materialChangeClause(['a NEWER message'])));
    const j = src('lib/work/judge.ts');
    gate('M7 source: the stamp is stored with every verdict and read back as the prior\'s; the clause rides the prior block',
      /materialChangeClause\(materialChangesSince\(priorMat, matNow\)\)/.test(j)
      && /writeCache\(client, userId, input, sig, verdict, evSig, matNow\)/.test(j)
      && /BE CONSISTENT with it unless something in the item MATERIALLY changed since; do not flip an ambiguous call on a re-read\./.test(j));
  }

  // ── S · SOURCE ───────────────────────────────────────────────────────────────────────────────────
  console.log('S · SOURCE:');
  {
    const hk = code('lib/entities/hooks.ts');
    const rs = code('lib/entities/refresh-schedule.ts');
    gate('S1 every recognition hook awaits the schedule; no bare void in the hooks or the scheduler',
      (hk.match(/await scheduleEntityRefresh\(/g) ?? []).length >= 4 && !/\bvoid\s/.test(hk) && !/\bvoid\s/.test(rs));
    gate('S2 the gate-closed branch bootstraps from the sync tail', /if \(!\(await memoryExists\(supabase, userId\)\)\) \{\s*const b = await bootstrapFromSync/.test(hk));
    const cal = code('lib/calendar/sync-calendar.ts');
    gate('S3 the calendar sync awaits recognition of the events it upserted',
      /await shadowRecognizeCalendarEvents\(supabase, connection\.user_id, \{ provider: connection\.provider, eventIds: res\.upsertedEventIds \}\)/.test(cal));
    const brief = src('app/api/home/brief/route.ts');
    gate('S4 the Home brief comment tells the truth (the hooks SCHEDULE the refresh — refresh-schedule.ts)',
      /lib\/entities\/refresh-schedule\.ts/.test(brief) && !/reconcileEntities on moves, the sync\/insights hooks\)/.test(brief));
    const spec = (ITEM_PLAN_REGISTRY as Record<string, { role: string; home: string; retentionDays: number | null }>).entity_refresh;
    gate('S5 the marker kind is registered (marker role, never pruned, home = the scheduler)',
      !!spec && spec.role === 'marker' && spec.home === 'lib/entities/refresh-schedule.ts' && spec.retentionDays == null);
    gate('S6 the claim is conditional: insert or compare-and-set on the read `at`',
      /insertPlan\(supabase, userId, 'entity_refresh'/.test(rs) && /q\.eq\('tasks->>at', m\.at\)/.test(rs));
    gate('S7 recognition reports a NEW member link (linked) only when it wrote one',
      (code('lib/entities/recognize.ts').match(/linked: true/g) ?? []).length === 3 && /linked: !!entityId/.test(code('lib/entities/recognize.ts')));
  }

  console.log(`\nsmoke-projects-follow: ${pass}/${pass + failures.length} PASS`);
  if (failures.length) { console.log(`FAILED: ${failures.join(' · ')}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
