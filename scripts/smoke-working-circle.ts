// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W11.2 THE WORKING CIRCLE + "LOOKS DONE — CONFIRM" (+ W13.4 ONE ITEM, ONE ROW).
// ZERO AI, ZERO network, ZERO DB: pure functions + the real loaders against an in-memory double.
//
//   C · THE CIRCLE — same-side co-senders count; the counterparty never; the same organisation never
//       a side; a public domain never counts alone; the thresholds; the user's hand wins.
//       W12.2 (C10–C15): THE COUNTERPARTY IS AN ORGANISATION — the client's own colleagues are never
//       suggested (copied by the user to someone else, or writing to the partner with the user
//       copied); their pairs never inflate a partner's counter count; the high bar is a verdict of
//       the counts under the CURRENT rule (a cached verdict is re-judged; a v1 cache is recomputed).
//   L · THE ONE LADDER READS THE CIRCLE — actorRole · loadActorContext · the scoped mail lane · a
//       circle colleague's delivery nominates as a teammate's (SETTLE_MATCH); read-only mode.
//   D · THE CONVERSATION DELTA (a) — a working-circle author on the user's side may nominate
//       `delivered` for you_owe work (same quote rule, same judge, stamped evidence:teammate).
//   P · LOOKS DONE (b) — the pure predicate, the sticky refusal, the machine state + word, the rank
//       below real work, the why-now, the one settle door writes it, one click each way on the row.
//   S · THE SWEEPS (c) — the same code picks circle evidence up; no hand-picked list anywhere.
//   R · W13.4 ONE ITEM, ONE ROW (owner call, Sep 24 — the W11.2 conversation fold is RETIRED): every
//       live item is its own row with its own hands; nothing is held back for sharing a conversation;
//       served + held = all rows; no row says "N open on this thread"; the fold module is gone.
// Fixtures: generic fakes only (Acme / Sam / Jo).
// Run: npx tsx scripts/smoke-working-circle.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  inferCircle, countingCircle, circleRows, sameOrganisation, isMachineAddress, loadCircle, setCirclePersistence,
  CIRCLE_AUTO_MIN_THREADS, CIRCLE_VERSION, CIRCLE_ORG_SIDE_DOMINANCE, autoVerdict, orgOf, type CircleMail, type CircleInference,
} from '../lib/evidence/circle';
import { actorRole, buildActorContext, loadActorContext, teammateAddressesOf } from '../lib/evidence/actor';
import { loadEvidenceEvents } from '../lib/evidence/sources';
import { matchEvents, SETTLE_MATCH } from '../lib/evidence/match';
import { validateDelta, buildDeltaPrompt, applyDeltaPlan, authorOnUserSide, type DeltaInput } from '../lib/work/conversation-delta';
import { looksDoneEvidenceOf, looksDoneLive, looksDoneLine, noteLooksDone, refuseLooksDone, looksDoneSigOf } from '../lib/evidence/looks-done';
import { LOOKS_DONE_WORD as CLIENT_WORD } from '../lib/evidence/looks-done-word';
import { deriveState, STATE_WORDS, LOOKS_DONE_WORD } from '../lib/work/machine';
import { rankAttention, attentionRank, whyNowOf, type AttentionRow } from '../lib/home/attention';
import { foldHeldRows, foldCountWord } from '../lib/home/held-list';
import { ITEM_PLAN_REGISTRY } from '../lib/store/item-plans';
import type { Evidence } from '../lib/evidence/match';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');

// ── fixtures ──
const ME = 'me@augmtd-example.com';
const MATE = 'jo@augmtd-example.com';                 // workspace member
const PARTNER = 'sam@partner-example.com';            // a partner-firm colleague (not a member)
const CLIENT = 'kim@acme-example.com';                // the counterparty
const CLIENT_MATE = 'lee@acme-example.com';           // the counterparty's own colleague
const GMAIL = 'pat.example@gmail.com';                // a public-domain collaborator
const known = { own: [ME], teammates: [MATE], teamDomains: ['augmtd-example.com'] };
/** One conversation on the user's side: the user writes to the client copying X; X replies-all. */
const sideThread = (t: string, x: string, y = CLIENT): CircleMail[] => [
  { from: ME, to: [y], cc: [x], threadId: t, fromUser: true },
  { from: y, to: [ME], cc: [x], threadId: t, fromUser: false },
  { from: x, fromName: 'Sam Partner', to: [y], cc: [ME], threadId: t, fromUser: false },
];

// ── C · THE CIRCLE ──
console.log('C · THE CIRCLE');
{
  const mails = [...['t1', 't2', 't3', 't4'].flatMap((t) => sideThread(t, PARTNER))];
  const c = inferCircle(mails, known);
  const p = c.find((x) => x.address === PARTNER);
  ok('C1 a same-side co-sender (the user copies them to the client; they reply-all alongside) is inferred, and above the high bar it counts',
    !!p && p.threads === 4 && p.auto === true && p.alongside >= 2 && p.name === 'Sam Partner', JSON.stringify(p));
  ok('C2 the counterparty is NEVER a candidate (it loses every side pair)', !c.some((x) => x.address === CLIENT));
  const withClientMate = inferCircle([...mails, ...['t1', 't2', 't3'].map((t) => ({ from: CLIENT_MATE, to: [CLIENT], cc: [ME], threadId: t, fromUser: false }))], known);
  ok('C3 the same ORGANISATION is never a side (the counterparty\'s colleague replying alongside them)',
    !withClientMate.some((x) => x.address === CLIENT_MATE) && sameOrganisation(CLIENT, CLIENT_MATE) && !sameOrganisation(GMAIL, 'x@gmail.com'));
  const pub = inferCircle(['a', 'b', 'c', 'd', 'e'].flatMap((t) => sideThread(t, GMAIL)), known).find((x) => x.address === GMAIL);
  ok('C4 a PUBLIC-domain address may be SUGGESTED by structure but never counts on its own', !!pub && pub.publicDomain && pub.auto === false);
  const one = inferCircle(sideThread('t1', PARTNER), known);
  const two = inferCircle([...sideThread('t1', PARTNER), ...sideThread('t2', PARTNER)], known).find((x) => x.address === PARTNER);
  ok(`C5 thresholds: 1 thread → nothing · 2 → suggested only · ${CIRCLE_AUTO_MIN_THREADS}+ (dominant, alongside, corporate) → counts`,
    one.length === 0 && !!two && two.auto === false);
  const sym = inferCircle(['s1', 's2', 's3'].flatMap((t) => [
    { from: PARTNER, to: [CLIENT], cc: [ME], threadId: t, fromUser: false },
    { from: CLIENT, to: [PARTNER], cc: [ME], threadId: t, fromUser: false },
  ]), known);
  ok('C6 a SYMMETRIC three-way exchange names no side (the strict margin)', sym.length === 0);
  const noisy = inferCircle([...mails, ...['t1', 't2', 't3', 't4'].flatMap((t) => sideThread(t, 'no-reply@tool-example.com')), ...['t1', 't2'].flatMap((t) => sideThread(t, MATE))], known);
  ok('C7 machine senders and existing members are never candidates', isMachineAddress('no-reply@tool-example.com') && !noisy.some((x) => x.address.startsWith('no-reply') || x.address === MATE));
  const cands = inferCircle([...mails, ...['u1', 'u2'].flatMap((t) => sideThread(t, 'ali@other-example.com'))], known);
  ok('C8 THE USER\'S HAND WINS: removed never counts · confirmed always counts · a suggestion does not count',
    JSON.stringify(countingCircle(cands, [])) === JSON.stringify([PARTNER])
    && countingCircle(cands, [{ address: PARTNER, state: 'removed', at: '' }]).length === 0
    && countingCircle(cands, [{ address: 'ali@other-example.com', state: 'confirmed', at: '' }]).includes('ali@other-example.com')
    && circleRows(cands, []).find((r) => r.address === 'ali@other-example.com')?.state === 'suggested');

  // ── W12.2 · THE COUNTERPARTY IS AN ORGANISATION ──
  const clientThreads = ['t1', 't2', 't3', 't4'].flatMap((t) => sideThread(t, PARTNER));
  // The user writes TO the partner copying the client's colleague (the client's side, not ours).
  const userToPartnerCcClient = ['x1', 'x2'].map((t) => ({ from: ME, to: [PARTNER], cc: [CLIENT_MATE], threadId: t, fromUser: true }));
  // The client's colleague writes TO the partner with the user copied (alongside, structurally).
  const clientToPartnerCcMe = ['y1', 'y2', 'y3'].map((t) => ({ from: CLIENT_MATE, fromName: 'Lee Client', to: [PARTNER], cc: [ME], threadId: t, fromUser: false }));
  const v10 = inferCircle([...clientThreads, ...userToPartnerCcClient], known);
  ok('C10 a CLIENT colleague the user copies when writing to someone else is never suggested (their organisation is the counterparty)',
    !v10.some((x) => x.address === CLIENT_MATE) && v10.some((x) => x.address === PARTNER && x.auto), JSON.stringify(v10.map((x) => [x.threads, x.counterThreads])));
  const v11 = inferCircle([...clientThreads, ...clientToPartnerCcMe], known);
  const p11 = v11.find((x) => x.address === PARTNER);
  ok('C11 a client colleague writing to the partner with the user copied is never suggested — and those pairs never count against the partner (counter 0)',
    !v11.some((x) => x.address === CLIENT_MATE) && !!p11 && p11.counterThreads === 0 && p11.auto, JSON.stringify(p11));
  // Per thread: an org that LOSES an org contest there is the thread's counterparty — none of its
  // addresses is a same-side collaborator on it, even if one of them wins a pair over a third org.
  const OTHER = 'ali@other-example.com';
  const v12 = inferCircle([...clientThreads, ...['z1', 'z2'].flatMap((t) => [
    { from: ME, to: [CLIENT], cc: [PARTNER], threadId: t, fromUser: true },
    { from: CLIENT_MATE, to: [OTHER], cc: [ME], threadId: t, fromUser: false },
  ])], known);
  ok('C12 on a thread whose counterparty org is the client, the client\'s own people never gain a side there (a win over a third org does not help)',
    !v12.some((x) => x.address === CLIENT_MATE) && !v12.some((x) => x.address === CLIENT), JSON.stringify(v12.map((x) => x.threads)));
  ok('C13 a public-provider address is its OWN organisation (a public domain proves no org) — the public-domain rules are unchanged',
    orgOf(GMAIL) === GMAIL && orgOf(CLIENT) === 'acme-example.com' && CIRCLE_ORG_SIDE_DOMINANCE >= 2);
  // A partner that is genuinely the counterparty on a few threads (the user writes TO them copying the
  // client) stays on the user's side while it is the side on ≥ the stated multiple.
  const v14 = inferCircle([...clientThreads, ...userToPartnerCcClient, { from: ME, to: [PARTNER], cc: [], threadId: 'q1', fromUser: true }], known);
  ok('C14 a 1:1 thread with the partner proves no side either way (no pair → no org contest)', v14.some((x) => x.address === PARTNER && x.threads === 4 && x.counterThreads === 0));
  ok('C15 THE HIGH BAR IS A VERDICT OF THE COUNTS under the current rule (the owner\'s two strongest partners: 24/4 and 20/2 clear it)',
    autoVerdict({ threads: 24, counterThreads: 4, alongside: 26, publicDomain: false }) && autoVerdict({ threads: 20, counterThreads: 2, alongside: 125, publicDomain: false })
    && !autoVerdict({ threads: 20, counterThreads: 6, alongside: 125, publicDomain: false }) && !autoVerdict({ threads: 20, counterThreads: 0, alongside: 125, publicDomain: true })
    && CIRCLE_VERSION >= 2);
  ok('C9 the stores are registered in the one typed door (working_circle cache · circle_decision record · looks_done record)',
    ITEM_PLAN_REGISTRY.working_circle.role === 'cache' && ITEM_PLAN_REGISTRY.circle_decision.role === 'record' && ITEM_PLAN_REGISTRY.looks_done.role === 'record');
}

// ── THE IN-MEMORY DOUBLE (filters the loaders send; upserts recorded) ──
type Row = Record<string, unknown>;
const WRITES: string[] = [];
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    let limit = Infinity; let range: [number, number] | null = null;
    const cmp = (v: unknown) => String(v ?? '');
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    const run = () => {
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit !== Infinity) rows = rows.slice(0, limit);
      return rows;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { preds.push((r) => cmp(r[c]) === cmp(v)); return q; },
      in: (c: string, vs: unknown[]) => { const s = new Set(vs.map(String)); preds.push((r) => s.has(cmp(r[c]))); return q; },
      gt: (c: string, v: unknown) => { preds.push((r) => r[c] != null && cmp(r[c]) > cmp(v)); return q; },
      lte: (c: string, v: unknown) => { preds.push((r) => r[c] != null && cmp(r[c]) <= cmp(v)); return q; },
      like: (c: string, v: string) => { const p = v.replace(/\\/g, '').replace(/%$/, ''); preds.push((r) => cmp(r[c]).startsWith(p)); return q; },
      overlaps: (c: string, vs: unknown[]) => { const s = new Set(vs.map(String)); preds.push((r) => arr(r[c]).some((x) => s.has(x))); return q; },
      not: () => q, or: () => q, order: () => q,
      limit: (n: number) => { limit = n; return q; },
      range: (a: number, b: number) => { range = [a, b]; return q; },
      upsert: (row: Row) => {
        WRITES.push(`${table}:${String(row.kind)}:${String(row.entity_id)}`);
        const t = (tables[table] ??= []);
        const i = t.findIndex((r) => r.user_id === row.user_id && r.kind === row.kind && r.entity_id === row.entity_id);
        const full = { id: `id-${t.length}`, created_at: new Date().toISOString(), ...row };
        if (i >= 0) t[i] = { ...t[i], ...full }; else t.push(full);
        return Promise.resolve({ error: null });
      },
      delete: () => { const del: Row = {}; void del; return q; },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (res: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}
const U = 'user-1';
const day = (d: number, m = 10) => new Date(Date.now() - d * 86_400_000 + m * 60_000).toISOString();
const NOW = new Date().toISOString();

async function main() {
  // ── L · THE ONE LADDER READS THE CIRCLE ──
  console.log('\nL · THE ONE LADDER READS THE CIRCLE');
  const ctx0 = buildActorContext({ profileEmail: ME, teammates: [{ email: MATE }] });
  const ctx1 = buildActorContext({ profileEmail: ME, teammates: [{ email: MATE }], circle: [PARTNER], circleNames: { [PARTNER]: 'Sam Partner' } });
  ok('L1 actorRole: a circle colleague is a TEAMMATE (unknown without the circle); the counterparty rung still outranks it; the user rung is untouched',
    actorRole({ address: PARTNER }, ctx0) === 'unknown' && actorRole({ address: PARTNER }, ctx1) === 'teammate'
    && actorRole({ address: PARTNER }, ctx1, { addresses: [PARTNER], personIds: [] }) === 'counterparty'
    && actorRole({ address: ME }, ctx1) === 'user' && ctx1.teammateNames?.[PARTNER] === 'Sam Partner'
    && teammateAddressesOf(ctx1).includes(PARTNER) && teammateAddressesOf(ctx1).includes(MATE));
  // the real loader over a fixture mailbox: 4 side threads with the partner + a delivery on the client thread
  const mailRows: Row[] = [];
  let k = 0;
  for (const t of ['t1', 't2', 't3', 't4']) for (const m of sideThread(t, PARTNER)) {
    mailRows.push({ id: `m${k++}`, user_id: U, received_at: day(20 - k / 10), subject: 'the changes', from_address: m.from, from_name: m.fromName ?? null,
      to_addresses: m.to, cc_addresses: m.cc, thread_id: m.threadId, metadata: {}, is_from_user: m.fromUser, body: '' });
  }
  mailRows.push({ id: 'm-deliver', user_id: U, received_at: day(1), subject: 'Re: the changes', from_address: PARTNER, from_name: 'Sam Partner',
    to_addresses: [CLIENT], cc_addresses: [ME], thread_id: 'tClient', metadata: {}, is_from_user: false, body: "We've implemented the changes." });
  const tables: Record<string, Row[]> = {
    profiles: [{ id: U, email: ME, full_name: 'Me User' }, { id: 'user-2', email: MATE, full_name: 'Jo Teammate' }],
    connections: [{ user_id: U, metadata: { email: ME }, provider_account_id: ME }],
    company_members: [{ company_id: 'co1', user_id: U, status: 'active' }, { company_id: 'co1', user_id: 'user-2', status: 'active' }],
    emails: mailRows, item_plans: [], calendar_events: [], meeting_transcripts: [], action_commits: [], entity_links: [],
  };
  const db = fakeDb(tables);
  setCirclePersistence(false);
  const roCtx = await loadActorContext(db, U);
  ok('L2 READ-ONLY MODE: the loader recomputes the circle from mail (zero AI) and writes NOTHING', (roCtx.circle ?? []).includes(PARTNER) && WRITES.length === 0, WRITES.join(','));
  setCirclePersistence(true);
  const liveCtx = await loadActorContext(db, U);
  ok('L3 production mode persists the inference ONCE through the typed door (working_circle · user), then reads it fresh',
    (liveCtx.circle ?? []).includes(PARTNER) && WRITES.filter((w) => w === 'item_plans:working_circle:user').length === 1
    && (await loadCircle(db, U, { own: [ME], teammates: [MATE], teamDomains: ['augmtd-example.com'] })).recomputed === false);
  tables.item_plans.push({ id: 'd1', user_id: U, kind: 'circle_decision', entity_id: PARTNER, tasks: { state: 'removed', at: NOW }, created_at: NOW, updated_at: NOW });
  const removedCtx = await loadActorContext(db, U);
  ok('L4 a REMOVED collaborator leaves the ladder at once (the user\'s decision row wins over the cached inference)', !(removedCtx.circle ?? []).includes(PARTNER));
  tables.item_plans.pop();
  const scope = { sinceISO: day(30), nowISO: NOW, addresses: [CLIENT], threadIds: [], actors: liveCtx };
  const { events } = await loadEvidenceEvents(db, U, scope, { features: null });
  const deliver = events.find((e) => e.id === 'm-deliver');
  ok('L5 the scoped mail lane reads a circle colleague\'s mail TO the counterparty, and the pool names them a teammate', !!deliver && deliver.actor.role === 'teammate');
  const ev = matchEvents(events, { afterISO: day(5), fulfiller: 'user', keys: { addresses: [CLIENT], personIds: [], threadIds: ['tClient'], eventIds: [], fileIds: [], externalRefs: [], entityIds: [] } }, NOW, SETTLE_MATCH);
  ok('L6 their delivery on the client thread is NOMINATED for the work the user owes (SETTLE_MATCH), attributed to them',
    ev.some((e) => e.id === 'm-deliver' && e.by === 'teammate' && e.key === 'object'));

  // L7/L8 — THE CACHE NEVER SERVES A STALE VERDICT (W12.2: a cache computed under an earlier rule held
  // both of the owner's strongest partners at auto=false for a day).
  const cand = { address: PARTNER, name: 'Sam Partner', threads: 20, counterThreads: 2, alongside: 125, ccByUser: 54, publicDomain: false, auto: false };
  const staleV2: CircleInference = { v: CIRCLE_VERSION, at: NOW, read: 10, capped: false, dropped: 0, candidates: [cand] };
  const t2: Record<string, Row[]> = { emails: [], item_plans: [{ id: 'p1', user_id: U, kind: 'working_circle', entity_id: 'user', tasks: staleV2, created_at: NOW, updated_at: NOW }] };
  const rejudged = await loadCircle(fakeDb(t2), U, known, { persist: false });
  ok('L7 a cached inference is RE-JUDGED on read: counts that clear the current bar count, whatever verdict was stored',
    rejudged.recomputed === false && rejudged.counting.includes(PARTNER) && rejudged.inference?.candidates[0]?.auto === true);
  const t3: Record<string, Row[]> = { emails: [], item_plans: [{ id: 'p1', user_id: U, kind: 'working_circle', entity_id: 'user', tasks: { ...staleV2, v: 1 }, created_at: NOW, updated_at: NOW }] };
  const recomputed = await loadCircle(fakeDb(t3), U, known, { persist: false });
  ok('L8 an inference cached under the v1 rule (no organisation contest) is recomputed on read, not served', recomputed.recomputed === true && recomputed.counting.length === 0);

  // ── D · THE CONVERSATION DELTA (a) ──
  console.log('\nD · THE CONVERSATION DELTA — the working circle is the user\'s side');
  const open = [{ id: 'c1', description: 'Implement the requested changes', direction: 'you_owe', counterparty: 'Kim', due_date: null, created_at: day(10), status: 'open' },
    { id: 'c2', description: 'Kim to send the sign-off', direction: 'awaiting', counterparty: 'Kim', due_date: null, created_at: day(10), status: 'open' }];
  const input = (role: 'teammate' | 'unknown' | null): DeltaInput => ({ open, candidates: [], todayIso: NOW.slice(0, 10),
    message: { kind: 'email', id: 'm-deliver', text: "Hi Kim — we've implemented the changes, see attached.", at: day(1), authoredByUser: false, authorRole: role, authorAddress: PARTNER, authorName: 'Sam Partner' } });
  const raw = { open: [{ id: 'C1', verdict: 'delivered', quote: "we've implemented the changes" }, { id: 'C2', verdict: 'delivered', quote: "we've implemented the changes" }] };
  const pMate = validateDelta(raw, input('teammate'));
  const pUnknown = validateDelta(raw, input('unknown'));
  ok('D1 a TEAMMATE author (the one ladder\'s rung) may nominate delivered for you_owe work — never for work the other side owes; an unknown author never for the user\'s',
    pMate.items.find((i) => i.id === 'c1')?.action === 'delivered' && pMate.items.find((i) => i.id === 'c2')?.action === 'keep'
    // (an unknown author is the OTHER side — it may still deliver what THEY owe, the legacy rule)
    && pUnknown.items.find((i) => i.id === 'c1')?.action === 'keep' && pUnknown.items.find((i) => i.id === 'c2')?.action === 'delivered' && authorOnUserSide({ authoredByUser: false, authorRole: 'teammate' }) && !authorOnUserSide({ authoredByUser: false, authorRole: null }));
  const quoteless = validateDelta({ open: [{ id: 'C1', verdict: 'delivered', quote: 'we shipped everything yesterday' }] }, input('teammate'));
  ok('D2 THE SAME QUOTE RULE: a teammate\'s delivered with a quote not in the message is kept', quoteless.items[0].action === 'keep');
  const legacyPrompt = buildDeltaPrompt(input(null));
  ok('D3 the prompt names a teammate author ONLY when present (the legacy other-party line unchanged)',
    /BY A TEAMMATE OF THE USER/.test(buildDeltaPrompt(input('teammate'))) && /BY THE OTHER PARTY/.test(legacyPrompt) && !/TEAMMATE/.test(legacyPrompt));
  const seen: Array<{ actor?: { role?: string } }> = [];
  await applyDeltaPlan({} as never, U, { plan: pMate, open, candidates: [], message: input('teammate').message }, {
    judgeFulfillment: (async (_c: unknown, _u: unknown, _o: unknown, cands: Array<{ actor?: { role?: string } }>) => { seen.push(...cands); return { verdict: 'unclear', reason: 'x', cached: false, fresh: true }; }) as never,
    applyFulfillment: (async () => false) as never, afterSettle: async () => {}, logActivity: (async () => {}) as never,
  });
  const dsrc = src('lib/work/conversation-delta.ts');
  ok('D4 the nomination reaches THE ONE fulfillment judge with the actor stated (teammate) and a close is stamped evidence:teammate',
    seen.length === 1 && seen[0].actor?.role === 'teammate' && /byMate \? 'evidence:teammate'/.test(dsrc));
  ok('D5 the delta places a non-authored message on the ONE ladder (actorRole + loadActorContext), only when the user owes open work; the mail path hands the sender',
    /async function authorRoleFor[\s\S]{0,400}actorRole\(\{ address \}, await loadActorContext\(client, userId\)\)/.test(dsrc)
    && /conv\.open\.some\(\(o\) => o\.direction !== 'awaiting'\)/.test(dsrc)
    && /authorAddress: isFromUser \? null : \(counterparty \?\? null\)/.test(src('lib/commitments/extract.ts')));
  ok('D6 the fulfillment judge\'s teammate line never claims "same organisation" (a circle colleague is on the user\'s side)',
    !/same organisation, not the user/.test(src('lib/commitments/fulfillment.ts')) && /on the user's side, not the user/.test(src('lib/commitments/fulfillment.ts')));

  // ── P · LOOKS DONE ──
  console.log('\nP · LOOKS DONE — CONFIRM');
  const e = (o: Partial<Evidence>): Evidence => ({ type: 'email', id: 'e1', at: day(1), title: 'Re: the changes', by: 'teammate', key: 'object', deed: 'message_sent', actor: { role: 'teammate', address: PARTNER, name: 'Sam Partner' }, ...o });
  ok('P1 the predicate: user-side delivery deed on the work\'s own object/person + unclear|promised → looks done; delivered · entity-only · awaiting work · a booked meeting · a counterparty deed → not',
    !!looksDoneEvidenceOf([e({})], 'unclear', 'user') && !!looksDoneEvidenceOf([e({ by: 'user' })], 'promised', 'user')
    && !looksDoneEvidenceOf([e({})], 'delivered', 'user') && !looksDoneEvidenceOf([e({ key: 'entity' })], 'unclear', 'user')
    && !looksDoneEvidenceOf([e({})], 'unclear', 'counterparty')
    && !looksDoneEvidenceOf([e({ type: 'calendar', status: 'booked', deed: 'meeting_booked', by: undefined })], 'unclear', 'user')
    && !!looksDoneEvidenceOf([e({ type: 'calendar', status: 'held', deed: 'meeting_held', by: undefined })], 'unclear', 'user')
    && !looksDoneEvidenceOf([e({ by: 'counterparty' })], 'unclear', 'user'));
  const hit = looksDoneEvidenceOf([e({})], 'unclear', 'user')!;
  ok('P2 the evidence line says who · what · when in plain words', /^Sam Partner sent “Re: the changes” [A-Z][a-z]{2} \d{1,2}$/.test(looksDoneLine(hit)), looksDoneLine(hit));
  const st = deriveState({ open: true, verdict: { work: 'reply' }, judgedAt: NOW, prepared: [], liveAsk: true, sentStamp: false, looksDone: true });
  const settled = deriveState({ open: true, verdict: { work: 'none' }, judgedAt: NOW, prepared: [], liveAsk: false, sentStamp: false, looksDone: true });
  ok('P3 THE ONE MACHINE serves `looks_done` (outranking the ladder), worded "looks done — confirm" from ONE client-safe home; a judged-none stays settled',
    st.state === 'looks_done' && STATE_WORDS.looks_done === LOOKS_DONE_WORD && LOOKS_DONE_WORD === CLIENT_WORD && settled.state === 'settled'
    && deriveState({ open: true, verdict: { work: 'reply' }, judgedAt: NOW, prepared: [], liveAsk: true, sentStamp: false }).state === 'awaiting_input');
  const row = (o: Partial<AttentionRow>): AttentionRow => ({ key: o.entityId ?? 'x', entityId: 'x', source: 'commitment', whyNow: '', ...o });
  const ranked = rankAttention([row({ entityId: 'done1', looksDone: true, overdue: true, prepared: 'draft' }), row({ entityId: 'plain' })], 1);
  ok('P4 attention ranks a looks-done row BELOW every row of real work (rank 6)', attentionRank(row({ looksDone: true, calendarAdjacent: true })) === 6 && ranked.served[0].entityId === 'plain');
  const why = whyNowOf({ source: 'commitment', stateWord: LOOKS_DONE_WORD, evidenceLine: 'Sam Partner sent it Sep 21', overdue: true, dueDate: '2026-08-28' });
  ok('P5 the why-now is the machine\'s word + the evidence line — never "overdue" on work that looks done', why === 'looks done — confirm · Sam Partner sent it Sep 21', why);
  // the writer, through the typed door, with the sticky refusal
  WRITES.length = 0;
  const work = { kind: 'commitment' as const, id: '11111111-1111-1111-1111-111111111111', fulfiller: 'user' as const };
  await noteLooksDone(db, U, work, [e({})], 'unclear');
  const rec = () => tables.item_plans.find((r) => r.kind === 'looks_done' && r.entity_id === `commitment:${work.id}`)?.tasks as { sig?: string; refusedSig?: string | null } | undefined;
  const up1 = looksDoneLive(rec() as never);
  await refuseLooksDone(db, U, 'commitment', work.id);
  const down = !looksDoneLive(rec() as never);
  await noteLooksDone(db, U, work, [e({})], 'unclear');
  const stillDown = !looksDoneLive(rec() as never);
  await noteLooksDone(db, U, work, [e({}), e({ id: 'e2', at: day(0, 5) })], 'unclear');
  const upAgain = looksDoneLive(rec() as never) && rec()?.sig === looksDoneSigOf([{ type: 'email', id: 'e1' }, { type: 'email', id: 'e2' }]);
  ok('P6 the record is written through the typed door; "Not yet" is STICKY for that evidence and NEW evidence raises it again',
    up1 && down && stillDown && upAgain && WRITES.every((w) => w.startsWith('item_plans:looks_done:')));
  const settleSrc = src('lib/work/evidence-settle.ts');
  ok('P7 THE ONE SETTLE DOOR writes it after every non-delivered judgment (never a close)',
    /if \(verdict\.verdict !== 'delivered'\) await noteLooksDone\(client, userId, \{ kind: work\.kind, id: work\.id, fulfiller: work\.fulfiller \}, evidence, verdict\.verdict\)/.test(settleSrc));
  const home = src('components/home/home-view.tsx');
  const route = src('app/api/work/looks-done/route.ts');
  ok('P8 one click each way on the row: Done = the row\'s own resolution door (done()), Not yet = POST /api/work/looks-done (refuseLooksDone, not_yet only)',
    /String\(item\.stateWord \?\? ''\)\.includes\(LOOKS_DONE_WORD\)/.test(home) && /onClick=\{\(e\) => \{ e\.stopPropagation\(\); done\(e\); \}\}/.test(home)
    && /'\/api\/work\/looks-done'/.test(home) && /refuseLooksDone\(supabase, user\.id, kind, id\)/.test(route) && /body\?\.action !== 'not_yet'/.test(route));
  const mach = src('lib/work/machine.ts');
  ok('P9 both machine readers read the record (workStateOf + workStatesFor) and serve the evidence line',
    (mach.match(/'looks_done'/g) ?? []).length >= 3 && (mach.match(/looksDoneLine\(/g) ?? []).length >= 2);

  // ── S · THE SWEEPS PICK IT UP — NO HAND-PICKED LIST ──
  console.log('\nS · THE SWEEPS (the same code, no hand-picked list)');
  const sources = src('lib/evidence/sources.ts');
  ok('S1 the scoped mail lane and every mail event read the ladder\'s own set (members + circle) — never a copy',
    /const mates = teammateAddressesOf\(scope\.actors\)/.test(sources) && /actorRole\(\{ address: m\.from \?\? undefined \}, actors\)/.test(sources));
  const scripts = ['backfill-evidence-settles.ts', 'census-evidence-reach.ts', 'census-working-circle.ts'].map((f) => src(`scripts/${f}`));
  ok('S2 no script closes or marks anything from a list: none imports the looks-done writer or the circle decision; dry runs + censuses are circle-read-only',
    scripts.every((s) => !/noteLooksDone|refuseLooksDone|decideCircle/.test(s))
    && /if \(!APPLY\) \{ const \{ setCirclePersistence \} = await import\('\.\.\/lib\/evidence\/circle'\); setCirclePersistence\(false\); \}/.test(scripts[0]) && /setCirclePersistence\(false\)/.test(scripts[1]) && /setCirclePersistence\(false\)/.test(scripts[2]));
  const lookWriters = ['lib/work/evidence-settle.ts', 'app/api/work/looks-done/route.ts'];
  ok('S3 the looks-done state has exactly two writers: the one settle door (evidence) and the user\'s own Not yet',
    /noteLooksDone/.test(src(lookWriters[0])) && /refuseLooksDone/.test(src(lookWriters[1])));
  ok('S4 zero AI anywhere in the circle / looks-done family', ['lib/evidence/circle.ts', 'lib/evidence/looks-done.ts'].every((f) => !/getAIClient|aiCreate|aiCall|getSystemClient/.test(src(f))));

  // ── R · W13.4 ONE ITEM, ONE ROW (the W11.2 conversation fold is retired) ──
  console.log('\nR · ONE ITEM, ONE ROW (W13.4)');
  const rows: AttentionRow[] = [
    row({ entityId: 'a', key: 'c-a', overdue: true, dueDate: '2026-08-28' }),
    row({ entityId: 'b', key: 'c-b', dueToday: true }),
    row({ entityId: 'c', key: 'c-c' }),
    row({ entityId: 'd', key: 'r-d' }), row({ entityId: 'e', key: 'r-e' }),
  ];
  const r = rankAttention(rows, 5);
  ok('R1 three live items from ONE conversation take THREE seats — each its own row, individually trackable',
    r.served.length === 5 && ['a', 'b', 'c'].every((id) => r.served.some((x) => x.entityId === id)) && r.held.length === 0);
  const tight = rankAttention(rows, 2);
  const accounted = [...tight.served, ...tight.held].map((x) => x.entityId);
  ok('R2 NOTHING IS DROPPED: served + held = all rows, each exactly once (no third "folded" bucket)',
    accounted.length === rows.length && new Set(accounted).size === rows.length && tight.served.length === 2
    && JSON.stringify(Object.keys(tight).sort()) === JSON.stringify(['held', 'refused', 'served']));
  ok('R3 the rank no longer carries a conversation key or groups (the AttentionRow type, the rank, the module)',
    !/conversationKey|foldByConversation|ConversationGroup/.test(src('lib/home/attention.ts'))
    && !existsSync('lib/home/conversation-fold.ts'));
  const heldRows = [{ id: '1', who: 'Kim', subject: 'Send the deck' }, { id: '2', who: 'Kim', subject: 'Confirm pricing' }, { id: '3', who: 'Kim', subject: 'Send the deck' }];
  const folds = foldHeldRows(heldRows, (x) => ({ who: x.who, subject: x.subject }));
  ok('R4 THE HELD LIST: different asks on one conversation are different rows; only a who+subject echo counts "+N more like this"',
    folds.length === 2 && folds[0].members.length === 2 && folds[1].members.length === 1 && foldCountWord(2) === '+1 more like this'
    && !/on this thread/.test(src('lib/home/held-list.ts')) && !/conversation/.test(src('lib/home/held-list.ts')));
  const brief = src('app/api/home/brief/route.ts');
  ok('R5 THE BRIEF holds back only what the budget or the seat contract held — never a member for sharing a conversation; no groups served',
    /const \{ served, held, refused \} = rankAttention\(ordered, ATTENTION_BUDGET\)/.test(brief)
    && /heldBack: held\.map\(\(r\) => r\.entityId\),/.test(brief) && !/conversationKey|conversations: attention|folded\.map|rankAttention[^\n]*folded/.test(brief)
    && !/conversation-fold/.test(brief));
  ok('R6 THE HOME renders every live item as its own row: no lead sentence, no foldedInto guard on whispers · next-up · the remainder',
    !/conversationSentence|foldedInto|toRowWhisper|convKeyOfAtom|conversation-fold/.test(home)
    && /const whispers: Whisper\[\] = whisperItems\.map\(\(i\) => toWhisper\(i\)\)/.test(home)
    && /const nextUp: Whisper\[\] = nextUpItems\.map\(\(i\) => toWhisper\(i\)\)/.test(home));
  ok('R7 no surface says "N open on this thread" (the Home, the held list, the held view)',
    ['components/home/home-view.tsx', 'components/home/held-quiet.tsx', 'lib/home/held-list.ts', 'lib/home/calm.ts', 'lib/home/attention.ts']
      .every((f) => !/open on this thread/.test(src(f))) && !/conversationKey/.test(src('components/home/held-quiet.tsx')));
  ok('R8 each row keeps its own hands: the whisper still mounts the row kit\'s own doors and the looks-done Done / Not yet stay on the row',
    /useRowActions\(item, handlers\)/.test(home) && /looksDone && \(/.test(home) && /refuseLooksDoneOnRow\(item\)/.test(home));
  ok('R9 the conversation DELTA (the data-level anti-hoarding fix) stays: extraction still reconciles a conversation\'s open items',
    existsSync('lib/work/conversation-delta.ts') && typeof validateDelta === 'function' && typeof applyDeltaPlan === 'function');
  ok('R10 the settings door: Settings → Team mounts "People you work with" over its own route (RLS client, the user\'s click only)',
    /<WorkingCircle \/>/.test(src('components/settings/team-section.tsx')) && /createClient\(\)/.test(src('app/api/settings/working-circle/route.ts'))
    && /decideCircle\(supabase, user\.id/.test(src('app/api/settings/working-circle/route.ts')) && /People you work with/.test(src('components/settings/working-circle.tsx')));
  {
    const r = src('app/api/settings/working-circle/route.ts');
    ok('R11 (W12.3) members are read with the service role scoped to the caller (loadActorContext(adminClient(), userId…)) — a member on a second mailbox is a member, never a suggestion; the user\'s own rows and decisions stay on the RLS client',
      /loadActorContext\(adminClient\(\), userId/.test(r) && /loadCircle\(supabase, userId, base/.test(r) && /decideCircle\(supabase, user\.id/.test(r)
      && /auth\.getUser\(\)/.test(r));
  }

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
