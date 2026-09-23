// ─── THE REACH FAN-OUT GATE (stabilization W3.3 REACH · proactive-reach LAW 1 · invariant 10) ───────
// THE LAW: no lane outside the judge, no item beyond its reach — and reach is never a function of how
// many OTHER accounts exist. Four repairs, each gated here, zero-AI and zero-DB by default:
//
//   F1 — THE FAN-OUT: judgment-sweep + draft-sweep are DISPATCHERS; each account runs in its own
//        /api/internal/sweeps/user job (AGENTOS_SECRET bearer, maxDuration 300, claim-then-after()),
//        bounded (≤8 acceptance POSTs in flight, a clamped per-run cap), honest (dispatched /
//        dispatchFailed / usersLeftBehind), with the old serial loop kept as a LOGGED, CLAIMED fallback.
//   F2 — COMMITMENTS ENTER THE PASS: a commitment lane (open, non-stale, actionable standing verdict;
//        entity priority → least-recently-prepared), every attempt on the prep_outcome ledger WITH its
//        lane; the ledger read is PAGED (the old `.limit(1000)` was a silent cap).
//   F3 — PROOF OF LIFE RE-QUEUES: a re-affirmed item is queued (a marker — reach never drafts) and the
//        pass serves the queue as its own lane, records the outcome, clears the marker.
//   F4 — ANTICIPATION IS BOUNDED: due-soon is a WINDOW (≤2 days ahead, ≤2 days overdue, user's own
//        day), the fire key carries the due date, the outcome is recorded (lane 'anticipation'), and
//        an honest "will retry" leaves the moment open.
//
// Run: npx tsx scripts/smoke-reach-fanout.ts            (zero-AI, zero-DB)
//      npx tsx scripts/smoke-reach-fanout.ts --census   (+ a READ-ONLY census of the commitment backlog)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  planDispatch, dispatchSweepJobs, maxDispatchPerRun, isSweepLane, DISPATCH_CONCURRENCY,
  DEFAULT_MAX_DISPATCH, SWEEP_MARKER, USER_BUDGET_MS,
} from '../lib/work/sweep-fanout';
import { isDueSoon, selectDueSoon, dueSoonFireKey, DUE_SOON_AHEAD_DAYS, DUE_SOON_GRACE_DAYS } from '../lib/home/anticipation';
import type { WorkItem } from '../lib/work-items/model';

const ROOT = join(__dirname, '..');
const src = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function main() {
  // ══ F1 · THE FAN-OUT ══════════════════════════════════════════════════════════════════════════
  console.log('F1 · per-user fan-out — dispatchers, a bounded dispatch, a claimed per-user route, a logged fallback');
  {
    const route = src('app/api/internal/sweeps/user/route.ts');
    ok('the per-user route exists', !!route);
    ok('   …bearer-authed with AGENTOS_SECRET (the kick\'s secret, no new env)', /hasBearer\(req, 'AGENTOS_SECRET'\)/.test(route));
    ok('   …maxDuration 300 (the work runs in ITS window)', /export const maxDuration = 300/.test(route));
    ok('   …validates the lane and the user id', /isSweepLane\(lane\)/.test(route) && /UUID_RE\.test\(userId\)/.test(route));
    ok('   …claims BEFORE it schedules (exactly-once per window) and runs in after()',
      route.indexOf('await claimSweepJob(') > -1 && route.indexOf('await claimSweepJob(') < route.indexOf('after(async')
      && /after\(async[\s\S]{0,200}runUserSweep\(/.test(route));
    ok('   …a lost claim is an ordinary 200, never an error', /started: false, reason: 'claimed this window/.test(route));
    ok('   …and answers 202 on acceptance', /status: 202/.test(route));

    for (const [name, p, lane] of [['judgment-sweep', 'app/api/cron/judgment-sweep/route.ts', 'judgment'], ['draft-sweep', 'app/api/cron/draft-sweep/route.ts', 'draft']] as const) {
      const s = src(p);
      ok(`${name}: is a DISPATCHER (planDispatch → dispatchSweepJobs '${lane}')`,
        /planDispatch\(users, \{ maxUsers: maxDispatchPerRun\(\) \}\)/.test(s) && new RegExp(`dispatchSweepJobs\\(plan\\.dispatch, '${lane}'`).test(s));
      ok(`${name}: rides the ONE rotation with the lane's own completion marker`,
        /orderLeastRecentlyServed\(sb, await activeUserIds\(sb\), SWEEP_MARKER\.(judgment|draft)\)/.test(s));
      ok(`${name}: the fallback runs ONLY the users whose job never landed, and is LOGGED`,
        /const fallbackUsers = sent\.failed/.test(s) && /fan-out fallback/.test(s));
      ok(`${name}: the fallback is CLAIMED (a timed-out-but-accepted POST never runs twice)`,
        new RegExp(`claimSweepJob\\(sb, uid, '${lane}'\\)`).test(s) && s.indexOf('claimSweepJob(') < s.indexOf('runUserSweep(sb'));
      ok(`${name}: the fallback keeps the wall-clock guard`, /routeDeadline = Date\.now\(\) \+ 265_000/.test(s) && /usersLeftBehind\+\+/.test(s));
      ok(`${name}: honest counts (dispatched / dispatchFailed / usersLeftBehind incl. the cap's remainder)`,
        /dispatched: sent\.accepted\.length/.test(s) && /dispatchFailed: sent\.failed\.length/.test(s)
        && /usersLeftBehind = plan\.leftBehind\.length/.test(s));
      ok(`${name}: no lane is called directly — ONE per-user body (runUserSweep)`,
        !/runPreparationPass\(|runJudgmentSweep\(/.test(s.replace(/\/\/.*$/gm, '')));
    }
    const f = src('lib/work/sweep-fanout.ts');
    ok('the self-call base invents nothing (no hardcoded production fallback)',
      /AUGMTD_WEBHOOK_BASE_URL \|\| env\.NEXT_PUBLIC_APP_URL \|\| ''/.test(f) && !/https:\/\/app\.augmtd\.ai/.test(f));
    ok('the claim is insert-first + an interval-filtered conditional update (the claimCatchUp idiom)',
      // ⟲ RE-POINTED (W2.6 TYPED STORES): the claim rides the door's insertPlan (the unique index settles
      // the race) + updatePlan with the interval filter — the same compare-and-set, one home.
      /insertPlan\(admin, userId, 'sweep_claim', lane, \{ at \}\)/.test(f) && /if \(ins\.inserted\) return true;/.test(f)
      && /updatePlan\(admin, userId, 'sweep_claim', lane,[\s\S]{0,120}where: \(q\) => q\.lt\('tasks->>at', cutoff\)/.test(f));
    ok('the acceptance wait is bounded (AbortController timeout)', /new AbortController\(\)/.test(f) && /ctl\.abort\(\)/.test(f));
    ok('a completed job stamps its lane marker (a killed job leads the next run)', /stampServed\(admin, userId, SWEEP_MARKER\.judgment/.test(f) && /stampServed\(admin, userId, SWEEP_MARKER\.draft/.test(f));
    ok('per-user budgets sit inside the route\'s 300s', USER_BUDGET_MS.judgment <= 250_000 && USER_BUDGET_MS.draft <= 250_000);
    ok('the lanes stamp distinct markers', SWEEP_MARKER.judgment === 'judgment_sweep' && SWEEP_MARKER.draft === 'draft_sweep');

    // Pure: the selection keeps the rotation's order, dedupes, caps, and COUNTS the remainder.
    const p1 = planDispatch(['a', 'b', 'a', '', 'c', 'd'], { maxUsers: 2 });
    ok('planDispatch keeps order, dedupes, drops blanks, caps', JSON.stringify(p1.dispatch) === '["a","b"]');
    ok('   …and the remainder is counted, never dropped', JSON.stringify(p1.leftBehind) === '["c","d"]');
    ok('   …a cap of 0 dispatches nothing and leaves everyone counted', planDispatch(['a', 'b'], { maxUsers: 0 }).leftBehind.length === 2);
    ok('maxDispatchPerRun: default when unset/garbage', maxDispatchPerRun({}) === DEFAULT_MAX_DISPATCH && maxDispatchPerRun({ SWEEP_FANOUT_MAX_USERS: 'x' }) === DEFAULT_MAX_DISPATCH);
    ok('   …clamped — never unlimited', maxDispatchPerRun({ SWEEP_FANOUT_MAX_USERS: '99999' }) === 500 && maxDispatchPerRun({ SWEEP_FANOUT_MAX_USERS: '7' }) === 7);
    // ⟲ RE-POINTED (W7.1 HEARTBEAT THROUGHPUT): the commitments sweep's per-account pass became the
    // third lane ('evidence') through the same kick/claim/rotation — the guard still admits ONLY the lanes.
    ok('isSweepLane accepts only the three lanes', isSweepLane('judgment') && isSweepLane('draft') && isSweepLane('evidence') && !isSweepLane('x') && !isSweepLane(undefined));

    // Pure-ish: the dispatcher against a fake transport — bounded in-flight, every id in exactly one bucket.
    const prevBase = process.env.AUGMTD_WEBHOOK_BASE_URL, prevSecret = process.env.AGENTOS_SECRET, prevApp = process.env.NEXT_PUBLIC_APP_URL;
    try {
      process.env.AUGMTD_WEBHOOK_BASE_URL = 'http://fanout.test'; process.env.AGENTOS_SECRET = 'gate-secret';
      let inFlight = 0, peak = 0; const seenBodies: string[] = []; let authOk = true;
      const fake = (async (url: string, init: RequestInit) => {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const body = JSON.parse(String(init.body));
        seenBodies.push(body.userId);
        if ((init.headers as Record<string, string>).Authorization !== 'Bearer gate-secret') authOk = false;
        if (!String(url).endsWith('/api/internal/sweeps/user')) return new Response('', { status: 404 });
        if (body.userId === 'u-refused') return new Response('', { status: 500 });
        if (body.userId === 'u-throws') throw new Error('network');
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }) as unknown as typeof fetch;
      const ids = Array.from({ length: 25 }, (_, i) => `u${i}`).concat(['u-refused', 'u-throws']);
      const out = await dispatchSweepJobs(ids, 'judgment', { fetchImpl: fake });
      ok(`dispatch keeps ≤${DISPATCH_CONCURRENCY} acceptance POSTs in flight`, peak <= DISPATCH_CONCURRENCY && peak > 1, `peak=${peak}`);
      ok('every id lands in exactly one bucket', out.accepted.length + out.failed.length === ids.length && new Set([...out.accepted, ...out.failed]).size === ids.length);
      ok('a refused or thrown POST is a FAILED dispatch (→ the in-process fallback)', out.failed.includes('u-refused') && out.failed.includes('u-throws') && out.failed.length === 2);
      ok('the POST carries the bearer secret and the lane', authOk && seenBodies.length === ids.length);
      const slow = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch;
      const t0 = Date.now();
      const out2 = await dispatchSweepJobs(['s1', 's2'], 'draft', { fetchImpl: slow as never, acceptTimeoutMs: 30 });
      ok('a POST that never answers is abandoned at the acceptance timeout (the dispatcher never waits for the job)',
        Date.now() - t0 < 2_000 && out2.failed.length === 2);
      delete process.env.AUGMTD_WEBHOOK_BASE_URL; delete process.env.NEXT_PUBLIC_APP_URL;
      const out3 = await dispatchSweepJobs(['x'], 'judgment', { fetchImpl: fake });
      ok('no base URL → nothing dispatched, every user to the fallback, the reason spoken', out3.failed.length === 1 && !!out3.reason);
    } finally {
      if (prevBase === undefined) delete process.env.AUGMTD_WEBHOOK_BASE_URL; else process.env.AUGMTD_WEBHOOK_BASE_URL = prevBase;
      if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = prevApp;
      if (prevSecret === undefined) delete process.env.AGENTOS_SECRET; else process.env.AGENTOS_SECRET = prevSecret;
    }
  }

  // ══ F2 · COMMITMENTS ENTER THE PREPARATION PASS ═══════════════════════════════════════════════
  console.log('\nF2 · the commitment lane — actionable standing verdicts, entity priority → least-recently-prepared');
  {
    const p = src('lib/prepare/pass.ts');
    ok('the pass seats a commitment lane with its own floor', /commitLane, \/\/ keeps its OWN order/.test(p) && /'commitment'\]/.test(p));
    ok('   …built from the STANDING verdicts (paged reader) and excluding the quiet tail',
      /readStandingVerdicts\(admin, userId\)/.test(p) && /excluded: \(k\) => staleKeys\.has\(k\)/.test(p) && !/rep\.stale\.filter/.test(p));
    ok('the prep_outcome read is PAGED (no silent .limit(1000))',
      // ⟲ RE-POINTED (W2.6 TYPED STORES): this read/write now goes through lib/store/item-plans.ts; the door's
      // readPlans pages every listing through fetchAllRows (gated by smoke-typed-stores T1.2) — same law, one home.
      /export async function readPrepOutcomes/.test(p) && /readPlans\(admin, userId, 'prep_outcome'\)/.test(p)
      && !/'prep_outcome'[^\n]*\.limit\(/.test(p));
    ok('ONE writer of prep_outcome rows, and it names the lane', /export async function recordPrepOutcome/.test(p) && /lane, at: new Date\(\)\.toISOString\(\)/.test(p)
      // ⟲ RE-POINTED (W2.6): the one write is the door's upsertPlan(…, 'prep_outcome', …).
      && (p.match(/upsertPlan\(admin, userId, 'prep_outcome'/g) ?? []).length === 1 && !/kind: 'prep_outcome'/.test(p));
    ok('the ledger names the lane that ACTUALLY reached the item', /await work\(w, laneNames\[i\]\)/.test(p));
    ok('an item deferred by two lanes is ONE item left behind', /deferredIds/.test(p));

    const { commitmentLane, isPreparableVerdict } = await import('../lib/prepare/pass');
    const mk = (id: string, over: Partial<WorkItem> = {}): WorkItem => ({
      id, entityId: id.split(':')[1], kind: 'task' as WorkItem['kind'], title: id, who: null, actor: 'you' as WorkItem['actor'],
      state: 'todo' as WorkItem['state'], when: { explicit: null, bucket: 'later' as WorkItem['when']['bucket'] }, source: 'commitment' as WorkItem['source'],
      href: '', at: '2026-09-01', startAt: '2026-09-01', projectId: null, automated: false, initiative: null, effort: null,
      entity: null, priority: 0, blockedOn: null, triage: false, ...over,
    });
    const items = [
      mk('commit:a', { entity: { id: 'hot', name: 'Hot' } }),
      mk('commit:b'),
      mk('commit:c'),
      mk('commit:d'),                                 // verdict none → out
      mk('commit:e', { state: 'done' as WorkItem['state'] }), // closed → out
      mk('commit:f'),                                 // stale → out
      mk('inbox:g'),                                  // not a commitment → out
      mk('commit:h', { automated: true }),            // automated → out
      mk('commit:i'),                                 // never judged → out (the judge reaches it first)
    ];
    const verdicts: Record<string, string> = { 'commitment:a': 'chase', 'commitment:b': 'schedule', 'commitment:c': 'produce', 'commitment:d': 'none',
      'commitment:e': 'reply', 'commitment:f': 'reply', 'inbox:g': 'reply', 'commitment:h': 'chase' };
    const prepared: Record<string, string> = { 'commitment:b': '2026-09-20T10:00:00Z' };
    const lane = commitmentLane(items, {
      verdictOf: (k) => verdicts[k], lastPreparedAt: (k) => prepared[k],
      weightOf: (w) => (w.entity?.id === 'hot' ? 80 : 0), excluded: (k) => k === 'commitment:f',
    });
    ok('membership: open, non-stale, non-automated commitments with an ACTIONABLE verdict only',
      JSON.stringify(lane.map((w) => w.id).sort()) === JSON.stringify(['commit:a', 'commit:b', 'commit:c']), lane.map((w) => w.id).join(','));
    ok('order: entity priority first, then never-prepared before prepared', lane.map((w) => w.id).join(',') === 'commit:a,commit:c,commit:b', lane.map((w) => w.id).join(','));
    ok('isPreparableVerdict: every verb but none', isPreparableVerdict('chase') && isPreparableVerdict('decide') && !isPreparableVerdict('none') && !isPreparableVerdict(null));
  }

  // ══ F3 · PROOF OF LIFE RE-QUEUES WHAT IT PROVES ALIVE ═════════════════════════════════════════
  console.log('\nF3 · proof-of-life re-queues re-affirmed items; the pass serves the queue');
  {
    const pol = src('lib/work/proof-of-life.ts');
    ok('a re-affirmed item is QUEUED (a marker, never a call)', /if \(alive\) \{[\s\S]{0,200}requeueForPreparation\(admin, userId, g\.key/.test(pol) && !/prepareOneItem/.test(pol));
    ok('   …and the lane reports what it queued', /requeued: number/.test(pol) && /out\.requeued\+\+/.test(pol));
    ok('REACH NEVER DRAFTS: the judgment sweep still reaches no preparation', !/prepareOneItem|runPreparationPass|generateReplyDraft|generateNudgeDraft/.test(src('lib/work/judgment-sweep.ts')));
    const p = src('lib/prepare/pass.ts');
    ok('the pass reads the queue as its own FIRST lane', /readPrepRequeue\(admin, userId\)/.test(p) && /const lanes: WorkItem\[\]\[\] = \[\s*requeueLane,/.test(p) && /\['proof_of_life', 'reply'/.test(p));
    ok('   …clears a marker once served (outcome on the ledger) or once its item is gone', (p.match(/clearPrepRequeue\(admin, userId/g) ?? []).length >= 2);
    const rq = src('lib/prepare/requeue.ts');
    // ⟲ RE-POINTED (W2.6 TYPED STORES): this read/write now goes through lib/store/item-plans.ts; the door's
    // readPlans pages every listing through fetchAllRows (gated by smoke-typed-stores T1.2) — same law, one home.
    ok('the queue read is PAGED', /readPlans\(client, userId, 'prep_requeue', \{ order: \{ by: 'updated_at', ascending: true \} \}\)/.test(rq));
    const { requeueForPreparation } = await import('../lib/prepare/requeue');
    ok('a malformed key is refused before any write', (await requeueForPreparation({} as never, 'u', 'garbage', { by: 'proof_of_life' })) === false);
  }

  // ══ F4 · ANTICIPATION IS BOUNDED, OBSERVED, AND RETRIES ════════════════════════════════════════
  console.log('\nF4 · anticipation — a due-soon WINDOW, a dated fire key, a recorded outcome, an honest retry');
  {
    const T = '2026-09-22';
    ok(`window: due today / within ${DUE_SOON_AHEAD_DAYS} days ahead`, isDueSoon('2026-09-22', T) && isDueSoon('2026-09-24', T) && !isDueSoon('2026-09-25', T));
    ok(`window: at most ${DUE_SOON_GRACE_DAYS} days overdue — the long-overdue belong to the judge/expiry lanes`,
      isDueSoon('2026-09-20', T) && !isDueSoon('2026-09-19', T) && !isDueSoon('2025-06-13', T));
    ok('window: an undated or garbage date is never "due soon"', !isDueSoon(null, T) && !isDueSoon('soon', T) && !isDueSoon('2026-09-22', 'today'));
    ok('window: a timestamped due reads by its day', isDueSoon('2026-09-23T18:00:00Z', T));
    const it = (id: string, explicit: string | null, over: Record<string, string> = {}) => ({ id, state: 'todo', actor: 'you', when: { explicit }, ...over });
    const sel = selectDueSoon([
      it('a', '2026-09-24'), it('b', '2026-09-21'), it('c', '2025-07-01'), it('d', null),
      it('e', '2026-09-22', { actor: 'team' }), it('f', '2026-09-22', { state: 'done' }), it('g', '2026-09-22'),
    ], T);
    ok('selectDueSoon: yours, open, inside the window — soonest first', sel.map((x) => x.id).join(',') === 'b,g,a', sel.map((x) => x.id).join(','));
    ok('the fire key CARRIES the due date (a re-anchored due may re-anticipate)',
      dueSoonFireKey('commit:x', '2026-09-24T00:00:00Z') === 'due:commit:x:2026-09-24' && dueSoonFireKey('commit:x', '2026-09-24') !== dueSoonFireKey('commit:x', '2026-09-30'));
    const a = src('lib/home/anticipation.ts');
    ok('the unbounded selection is gone (no `bucket === \'overdue\'` escape hatch)', !/bucket === 'overdue'/.test(a) && /selectDueSoon\(items/.test(a));
    ok('the window is read on the USER\'S day (localNow(tz)), never the server\'s', /selectDueSoon\([^)]*localNow\(tz\)\.dateStr\)/.test(a));
    ok('the outcome lands on the ONE ledger with lane \'anticipation\' (due-soon AND the silence watch)',
      (a.match(/recordPrepOutcome\(client, userId, judgmentKeyOf\(w as never\), r, 'anticipation'\)/g) ?? []).length === 2);
    ok('an honest "will retry" writes NO fire record (the moment stays open)', /if \(isRetryableOutcome\(r\)\) continue;/.test(a)
      && a.indexOf('isRetryableOutcome(r)') < a.indexOf("kind: 'due_soon'"));
    ok('the fire record keeps what happened (did/reason)', /kind: 'due_soon', itemId: w\.id, due, did: r\.did, reason: r\.reason/.test(a));
    ok('W0.5 claim-after-work kept (the completion stamp still follows the work)', a.indexOf('THE COMPLETION STAMP') > a.indexOf("kind: 'due_soon'"));
    const { isRetryableOutcome } = await import('../lib/prepare/pass');
    ok('isRetryableOutcome reads the pass\'s own honest phrasing',
      isRetryableOutcome({ did: 'none', reason: 'could not judge this yet — it will retry' })
      && !isRetryableOutcome({ did: 'none', reason: 'this one needs you — no preparation applies' })
      && !isRetryableOutcome({ did: 'draft' }));
  }

  if (process.argv.includes('--census')) await census();

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

/** READ-ONLY: how many open commitments carry an actionable verdict and no prep_outcome — the backlog
 *  the commitment lane drains — per account, and a drain estimate at the configured budgets. */
async function census(): Promise<void> {
  const { config } = await import('dotenv'); config({ path: join(ROOT, '.env.local') });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('\n(census skipped — no env)'); return; }
  const { createClient } = await import('@supabase/supabase-js');
  const { fetchAllRows } = await import('../lib/utils/fetch-all');
  const { activeUserIds } = await import('../lib/work/sweep-users');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log('\nCENSUS (read-only) — the commitment backlog the new lane drains');
  const active = new Set(await activeUserIds(sb));
  type Row = Record<string, unknown>;
  const commits = await fetchAllRows<Row>((f, t) => sb.from('commitments').select('id, user_id').eq('status', 'open').order('id').range(f, t));
  const judg = await fetchAllRows<Row>((f, t) => sb.from('item_plans').select('user_id, entity_id, tasks').eq('kind', 'judgment').like('entity_id', 'commitment:%').order('id').range(f, t));
  const outs = await fetchAllRows<Row>((f, t) => sb.from('item_plans').select('user_id, entity_id').eq('kind', 'prep_outcome').like('entity_id', 'commitment:%').order('id').range(f, t));
  const verdict = new Map(judg.map((j) => [`${j.user_id}|${j.entity_id}`, ((j.tasks as { verdict?: { work?: string } } | null)?.verdict?.work) ?? null]));
  const prepared = new Set(outs.map((o) => `${o.user_id}|${o.entity_id}`));
  const per = new Map<string, { open: number; judged: number; actionable: number; backlog: number }>();
  for (const c of commits) {
    const k = `${c.user_id}|commitment:${c.id}`;
    const p = per.get(String(c.user_id)) ?? { open: 0, judged: 0, actionable: 0, backlog: 0 };
    p.open++;
    const w = verdict.get(k);
    if (w) p.judged++;
    if (w && w !== 'none') { p.actionable++; if (!prepared.has(k)) p.backlog++; }
    per.set(String(c.user_id), p);
  }
  let backlog = 0, unjudged = 0;
  for (const [u, p] of [...per.entries()].sort((a, b) => b[1].backlog - a[1].backlog)) {
    backlog += p.backlog; unjudged += p.open - p.judged;
    if (p.backlog || p.open - p.judged) console.log(`  ${u.slice(0, 8)}${active.has(u) ? '' : ' (inactive)'} · open ${p.open} · judged ${p.judged} · actionable ${p.actionable} · never prepared ${p.backlog}`);
  }
  // ~20s per commitment preparation (judge cached; draft → evaluate → at most one revise; measured
  // pass throughput on the reference account). The lane's floor is ≥1/6 of the draft budget per run.
  const perRunSlice = USER_BUDGET_MS.draft / 6 / 1000;
  const perRun = Math.max(1, Math.floor(perRunSlice / 20));
  console.log(`  TOTAL never-prepared actionable: ${backlog} · open commitments never judged: ${unjudged}`);
  console.log(`  drain: ≥${perRun} commitment(s)/account/run on the lane floor alone (2h cadence) — the worst account drains in ≤${Math.ceil(Math.max(...[...per.values()].map((p) => p.backlog), 0) / perRun) * 2}h`);
}

main().catch((e) => { console.error(e); process.exit(1); });
