// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ATTENTION GATE (permanent — docs/attention-plan.md, laws A1 · A2 · A3).
//
// "A law is only alive while a gate enforces it." This suite holds the three Wave-1 serving laws:
//
//   AT1 · THE BUDGET — the served needs-you set never exceeds five, and the cut is made at the ONE
//         serving choke point (the brief route), never by the client.
//   AT2 · THE WHY-NOW — every served row states why now and why you; no row's whole reason is the
//         bare word "overdue" (fourteen rows reading "overdue" carry zero information).
//   AT3 · THE PARTITION — every held item lands in exactly ONE class, and the class counts sum to
//         the held total. Nothing is deleted; nothing is hidden without an account.
//   AT4 · THE CONSEQUENCE — a class with a real deadline inside it speaks that deadline; one
//         without speaks its canonical honest sentence; no class sentence is ever empty.
//   AT5 · ZERO AI — the classifier and the ledger route build no AI client and reach none.
//
// Asserted on SOURCE (the structures) and on THE WORLD (the probe host + the reference account,
// READ-ONLY) through the very modules the route serves through — never a re-derivation of either.
//
// Zero AI, zero writes. Run: set -a; source .env.local; set +a; npx tsx scripts/smoke-attention.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { classifyItem } from '../lib/inbox/classify-item';
import { getCampaignSignature, isCampaignEcho, type CampaignSignature } from '../lib/inbox/campaign-echo';
import { deckEligible, type DeckFloors, type DeckItem } from '../lib/home/deck-floors';
import {
  whyNowOf, isBareOverdue, rankAttention, attentionRank, ATTENTION_BUDGET,
  classifyHeld, buildHeldLedger, consequenceOf, statedDueOf,
  HELD_CLASSES, HELD_CLASS_ORDER, WHY_NOW_MAX_CHARS,
  type AttentionRow, type HeldFacts, type HeldClassId,
} from '../lib/home/attention';

const root = join(__dirname, '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TODAY = new Date().toISOString().slice(0, 10);
const REFERENCE_PREFIX = '08fe4449';

/* eslint-disable @typescript-eslint/no-explicit-any */

const row = (o: Partial<AttentionRow> = {}): AttentionRow =>
  ({ key: `k${Math.random()}`, entityId: `e${Math.random()}`, source: 'reply', whyNow: 'x', ...o });

const item = (o: Partial<DeckItem> & { sd?: any } = {}): DeckItem => {
  const { sd, ...rest } = o;
  return { id: `i${Math.random()}`, work_title: 'A thing', source_data: sd ?? {}, ...rest } as DeckItem;
};

// ── AT1 · THE BUDGET ────────────────────────────────────────────────────────────────────────────
console.log('\nAT1 · THE BUDGET LAW — at most five, cut at the one serving choke point');
{
  ok('the budget is five', ATTENTION_BUDGET === 5);
  const many = Array.from({ length: 14 }, (_, i) => row({ key: `k${i}` }));
  const { served, held } = rankAttention(many);
  ok('a fourteen-row deck serves five', served.length === 5);
  ok('   …and NOTHING is dropped — the rest are held', held.length === 9 && served.length + held.length === 14);

  // THE RANK, against current context.
  const cal = row({ key: 'cal', calendarAdjacent: true });
  const prepOver = row({ key: 'prep', prepared: 'draft', overdue: true });
  const today = row({ key: 'today', dueToday: true });
  const plain = row({ key: 'plain' });
  // RE-POINTED (Sep 18, THE FRESH SEAT): the ladder grew two rungs — a fresh arrival above the
  // clock's rows, and a calendar adjacency that is NOT today below them. The law it was written for
  // is unchanged and still asserted: today's calendar still outranks everything.
  ok('calendar adjacency TODAY outranks everything', attentionRank(cal) === 0);
  ok('   …then a fresh arrival', attentionRank(row({ key: 'f', fresh: true })) === 1);
  ok('   …then prepared + overdue', attentionRank(prepOver) === 2);
  ok('   …then due today', attentionRank(today) === 3);
  ok('   …then an adjacency that is not today', attentionRank(row({ key: 'l', calendarAdjacent: true, adjacencyToday: false })) === 4);
  ok('   …then the caller\'s own judged order', attentionRank(plain) === 5);
  ok('the ranked cut respects that order',
    rankAttention([plain, today, prepOver, cal], 3).served.map((r) => r.key).join(',') === 'cal,prep,today');
  ok('an equal-rank tie keeps the deck\'s order (stable)',
    rankAttention([row({ key: 'a' }), row({ key: 'b' }), row({ key: 'c' })], 2).served.map((r) => r.key).join(',') === 'a,b');

  // THE CHOKE POINT — the budget is enforced where the payload is composed, not on the client.
  const r = src('app/api/home/brief/route.ts');
  ok('the brief route ranks through the ONE module',
    /rankAttention\(ordered, ATTENTION_BUDGET\)/.test(r)
    && /await import\('@\/lib\/home\/attention'\)/.test(r));
  // (Sep 17: the payload gained A3's ONE SCALE — the ledger's own held total, so the door and the
  //  ledger behind it speak the same number. Sep 18: it gained THE FRESH SEAT's count and the
  //  catch-up detector. RE-POINTED, stricter: the served list still rides exactly as before AND
  //  every number on it is a SERVED one — the client computes none of them.)
  ok('the served attention list rides the payload', /attention: \{ budget: attention\.budget, served: attention\.served, heldBack: attention\.heldBack, heldTotal: attention\.heldTotal, heldWaiting: attention\.heldWaiting, heldHandled: attention\.heldHandled, fresh: attention\.fresh, catchUp: attention\.catchUp \}/.test(r));
  ok('   …and the overflow is HELD, never deleted (every lane still serves its rows)',
    /heldBack: heldBackSet\.has\(id\)/.test(r) && !/\.slice\(0, ?ATTENTION_BUDGET\)/.test(r));
  ok('no client component enforces the budget itself',
    !/ATTENTION_BUDGET/.test(src('components/home/home-view.tsx')));
}

// ── AT2 · THE WHY-NOW CLAUSE ────────────────────────────────────────────────────────────────────
console.log('\nAT2 · THE WHY-NOW LAW — why now and why you, from judged facts only');
{
  const now = new Date('2026-09-17T09:00:00Z'); // a Thursday
  ok('calendar adjacency speaks the meeting',
    whyNowOf({ source: 'reply', who: 'Jordan', meeting: { localTime: '14:00' } }, now) === 'Jordan will ask at your 14:00');
  ok('   …and without a name it still says when',
    whyNowOf({ source: 'notice', meeting: { localTime: '09:30' } }, now) === 'this comes up at your 09:30');
  // THE NO-RESTATEMENT RULE (walk-found Sep 17): the whisper row leads with the counterparty, so
  // the clause never repeats the name — "X — task — X, ready to send" read as stutter live. The
  // name survives ONLY in the calendar-adjacency branch, where it does new work.
  ok('a prepared reply speaks its receipt — never restating the row\'s own name',
    whyNowOf({ source: 'reply', who: 'Sam', prepared: 'draft' }, now) === 'reply ready');
  ok('a commitment speaks the debt', whyNowOf({ source: 'commitment', who: 'Acme' }, now) === 'you committed to this');
  ok('a notice never invents a person waiting',
    whyNowOf({ source: 'notice' }, now) === 'needs an action from you');
  ok('the due words ride BESIDE a companion, never alone',
    whyNowOf({ source: 'reply', who: 'Sam', dueDate: '2026-09-18', dueToday: false }, now) === 'waiting on your reply · due tomorrow');
  ok('   …overdue too', whyNowOf({ source: 'commitment', who: 'Acme', dueDate: '2026-09-15', overdue: true }, now)
    === 'you committed to this · overdue since Tuesday');
  // THE BAN, structurally: nothing composes to the bare word.
  ok('BARE "overdue" is structurally impossible',
    !isBareOverdue(whyNowOf({ source: 'reply', overdue: true }, now))
    && whyNowOf({ source: 'reply', overdue: true }, now) === 'waiting on your reply · overdue');
  ok('   …and the ban predicate is exported and exact',
    isBareOverdue('overdue') && isBareOverdue(' Overdue ') && !isBareOverdue('overdue since Tuesday'));
  ok('the machine\'s own ask word seats when there is nobody to name',
    whyNowOf({ source: 'reply', stateWord: 'decision laid out' }, now) === 'decision laid out');
  ok('a clause is a clause — clipped at a word boundary',
    (() => { const c = whyNowOf({ source: 'reply', who: 'A'.repeat(200) }, now); return c.length <= WHY_NOW_MAX_CHARS + 1 && !/\s…$/.test(c); })());
  ok('a clause is NEVER the judge\'s own reason (no reason field is read)',
    !/verdict\.reason|\breason\b/.test(src('lib/home/attention.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
  ok('the module is pure — no fetch, no AI, no unbounded clock',
    !/@supabase|getAIClient|aiCreate|aiCall\(/.test(src('lib/home/attention.ts')));
  // THE AGNOSTIC CLAUSE: a shape, never a vocabulary.
  ok('no vendor / person / domain token anywhere in the clause composer',
    !/@[a-z0-9-]+\.(com|pt|de|ai)\b/i.test(src('lib/home/attention.ts')));
}

// ── AT3 · THE PARTITION (fixtures — every class reachable, exactly one each) ─────────────────────
console.log('\nAT3 · THE LEDGER LAW — every held item in exactly one class');
{
  const f = (o: Partial<HeldFacts>): HeldFacts =>
    ({ item: item(), isEcho: false, judgedNone: false, ...o });
  const cases: Array<[HeldClassId, HeldFacts]> = [
    // Adjacency outranks the echo floor — but ONLY on a row the budget held (Q2: brought_forward is
    // a strict subset of the WAITING band; adjacency promotes something already alive).
    ['brought_forward', f({ calendarAdjacent: true, budgetOverflow: true, isEcho: true })],
    ['own_outreach', f({ isEcho: true, judgedNone: true, judgedResolution: 'answered' })],
    ['judged_quiet', f({ judgedNone: true, judgedResolution: 'answered' })],
    ['bulk_mail', f({ item: item({ sd: { has_unsubscribe: true, from_address: 'hello@brand.example' } }) })],
    ['notices', f({ item: item({ sd: { from_address: 'no-reply@portal.example', subject: 'Your receipt' } }) })],
    ['cc_watch', f({ item: item({ sd: { is_cc_only: true, from_address: 'jordan@acme.example', understanding: { role: 'bystander', relevance: 'awareness', language: 'en', ownership: 'none' } } }) })],
    ['quieter_threads', f({ item: item({ sd: { from_address: 'jordan@acme.example', understanding: { role: 'addressed', relevance: 'reply', language: 'en', ownership: 'you_owe' } } }) })],
  ];
  for (const [expected, facts] of cases) {
    ok(`${expected} is reachable and exact`, classifyHeld(facts) === expected, `got ${classifyHeld(facts)}`);
  }
  ok('the precedence order is stated once and covers every class',
    HELD_CLASS_ORDER.length === Object.keys(HELD_CLASSES).length
    && new Set(HELD_CLASS_ORDER).size === HELD_CLASS_ORDER.length);

  const ledger = buildHeldLedger(cases.map(([, x]) => x), TODAY);
  ok('the ledger totals the held set', ledger.total === cases.length);
  // Q2: the classes are the HANDLED band's own surface, so the sum that must hold is the BANDS'.
  ok('   …and the three bands SUM to that total',
    ledger.bands.waiting.count + ledger.bands.watched.count + ledger.bands.handled.count === ledger.total);
  ok('   …the handled band\'s class counts sum to the handled count',
    ledger.classes.reduce((n, c) => n + c.count, 0) === ledger.bands.handled.count);
  ok('   …with no item counted twice',
    ledger.classes.length + ledger.bands.waiting.rows.length + ledger.bands.watched.rows.length === cases.length);
  ok('an empty class never renders', buildHeldLedger([], TODAY).classes.length === 0);
  ok('the member cap is honest — count is the real total, hasMore says so',
    (() => {
      const many = Array.from({ length: 30 }, () => f({ item: item({ sd: { has_unsubscribe: true } }) }));
      const l = buildHeldLedger(many, TODAY, { membersPerClass: 10 });
      const c = l.classes[0];
      return c.count === 30 && c.members.length === 10 && c.hasMore === true;
    })());
}

// ── AT4 · THE CONSEQUENCE SENTENCE ──────────────────────────────────────────────────────────────
console.log('\nAT4 · THE CONSEQUENCE — a class speaks its deadline, or its honest sentence');
{
  ok('no canonical sentence is empty',
    HELD_CLASS_ORDER.every((c) => HELD_CLASSES[c].consequence.trim().length > 0));
  ok('a class with NO real date speaks its canonical sentence',
    consequenceOf('bulk_mail', [null, undefined], TODAY) === HELD_CLASSES.bulk_mail.consequence);
  const t = '2026-09-17'; // Thursday
  ok('one real deadline is spoken', consequenceOf('quieter_threads', [null, '2026-09-18'], t) === 'one has a real deadline — tomorrow');
  ok('   …two are counted, nearest named', consequenceOf('quieter_threads', ['2026-09-21', '2026-09-19'], t) === '2 have real deadlines — the nearest is Saturday');
  ok('   …today reads as today', consequenceOf('notices', [t], t) === 'one has a real deadline — today');
  ok('A PAST date is NOT a real deadline (the stale-claim refusal)',
    consequenceOf('notices', ['2026-06-01'], t) === HELD_CLASSES.notices.consequence);
  // A SENDER'S OWN EXPIRY IS NOT THE READER'S DEADLINE (found live on the reference account).
  ok('a promo\'s sale-ends-today is never spoken as a real deadline',
    consequenceOf('bulk_mail', [t], t) === HELD_CLASSES.bulk_mail.consequence);
  ok('   …nor is an echo of the user\'s own outbound',
    consequenceOf('own_outreach', [t], t) === HELD_CLASSES.own_outreach.consequence);
  ok('the echo class speaks the owner\'s own sentence',
    HELD_CLASSES.own_outreach.consequence === 'logged; you’d only slow it down');
  ok('the watch class speaks its own',
    HELD_CLASSES.cc_watch.consequence === 'watched — you’ll hear if anyone asks you something');
  ok('every class carries its natural verb (A7\'s seat)',
    HELD_CLASS_ORDER.every((c) => HELD_CLASSES[c].deed.trim().length > 0));
  // The ledger actually SERVES the sentence — not just the table.
  const l = buildHeldLedger([{ item: item({ sd: { has_unsubscribe: true } }), isEcho: false, judgedNone: false }], TODAY);
  ok('every served class carries a non-empty consequence', l.classes.every((c) => c.consequence.trim().length > 0));
  ok('   …and every member carries its own why-held', l.classes.every((c) => c.members.every((m) => m.why.trim().length > 0)));
}

// ── AT5 · ZERO AI ON THE SERVE PATH ─────────────────────────────────────────────────────────────
console.log('\nAT5 · ZERO AI — the classifier and the ledger route reach no AI client');
{
  const AI = /getAIClient|getSystemClient|aiCreate|aiCall\(|openai|anthropic/i;
  for (const p of [
    'lib/home/attention.ts',
    'app/api/home/held/route.ts',
    // ONE HOME (Sep 17): the ledger's derivation moved out of the route into the module the deed
    // and the door read too — so the zero-AI floor is asserted where the work now happens.
    'lib/deeds/held-members.ts',
    'lib/home/deck-floors.ts',
    'lib/inbox/notice-demotion.ts',
    'lib/prepare/noise-floor.ts',
    'lib/inbox/campaign-echo.ts',
    'lib/home/calm.ts',
  ]) ok(`${p} builds no AI client`, !AI.test(src(p)));
  // ── THE DERIVATION MOVED, THE LAW DID NOT (Sep 17). These five held on the route while the route
  //    carried its own copy of the derivation; that copy is gone (ONE HOME — `deriveHeld`), so each
  //    is asserted where the work is, PLUS the route is asserted to reach it rather than re-deriving.
  //    Nothing is weakened: the user-scoping and the 401 still belong to the route, the paging, the
  //    shared floors and the shared budget now belong to the module, and a second derivation living
  //    in the route again would fail the last line here.
  const h = src('app/api/home/held/route.ts');
  const hm = src('lib/deeds/held-members.ts');
  ok('the ledger route is auth\'d and user-scoped',
    /supabase\.auth\.getUser\(\)/.test(h) && /status: 401/.test(h)
    && /deriveHeld\(supabase, user\.id/.test(h) && /\.eq\('user_id', userId\)/.test(hm));
  ok('   …and every full listing is PAGED (the 1000-row ceiling)',
    /fetchAllRows/.test(hm) && (hm.match(/fetchAllRows/g) ?? []).length >= 2);
  ok('   …it shares the deck\'s own floors, never a second derivation',
    /deckEligible\(/.test(hm) && /from '@\/lib\/home\/deck-floors'/.test(hm)
    && !/deckEligible\(/.test(h));
  ok('   …and the same budget module the deck cuts with',
    /rankAttention\(/.test(hm) && /from '@\/lib\/home\/attention'/.test(hm));
  // (RE-POINTED Sep 18, not weakened: the payload's SHAPE moved into lib/deeds/held-cache.ts so the
  //  brief's primer and the route build one identical account. The law is unchanged — whatever
  //  builds the served payload must state the bound of the read it was made from.)
  ok('the ledger is honest about its own bound',
    /poolSaturated/.test(src('lib/deeds/held-cache.ts')) && /poolSaturated/.test(hm));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AT7–AT10 · THE DAY FRAME (laws A4 · A5 · A6) and AT11 · THE SURFACES
//
// Every absence in the day frame is EARNED SERVER-SIDE — "a client-side gate is a zone that exists
// and is being hidden, which is exactly what A5 outlaws". So these gates assert on the assembly
// itself (through a fixture DB client that answers exactly what the real one would) and on the pure
// derivations, never on a rendered page.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import {
  buildDayFrame, buildTodayZone, buildInMotionZone, deriveInMotionRows, selectDayEvents,
  prepStateOf, counterpartsOf, IN_MOTION_MAX_ROWS,
  type RawEvent, type RawRun, type RawWorkflow, type Agent, type InMotionRow, type PrepRecord,
} from '../lib/home/day';
import type { WorkspaceFeatures } from '../lib/workspace/types';
import type { WorkflowStep } from '../lib/workflows/types';

/** A fixture DB client: every builder method chains, and awaiting it yields the table's fixture.
 *  `head:true` counts are answered from the same rows, so the pointer can never be fabricated. */
function fakeDb(tables: Record<string, any[]>) {
  const make = (table: string) => {
    const rows = tables[table] ?? [];
    const chain: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (res: any) => res({ data: rows, count: rows.length, error: null });
        return () => chain;
      },
    });
    return chain;
  };
  return { from: (t: string) => make(t) } as any;
}

const FEATURES = (o: Partial<WorkspaceFeatures> = {}): WorkspaceFeatures =>
  ({ email: true, meetings: true, drive: true, agents: true, studio: true, ...o } as WorkspaceFeatures);

const NOW = new Date('2026-09-17T09:00:00Z'); // a Thursday, 09:00 UTC
const ev = (o: Partial<RawEvent> = {}): RawEvent =>
  ({ id: `ev${Math.random()}`, title: 'Sync', start_time: '2026-09-17T14:00:00Z', end_time: '2026-09-17T15:00:00Z',
    is_all_day: false, attendees: [], status: 'confirmed', ...o });
const run = (o: Partial<RawRun> = {}): RawRun =>
  ({ id: `run${Math.random()}`, workflow_id: 'wf1', status: 'running', step_outputs: [], started_at: null,
    created_at: '2026-09-17T08:00:00Z', ...o });
const wf = (o: Partial<RawWorkflow> = {}): RawWorkflow =>
  ({ id: 'wf1', name: 'Weekly brief', agent_id: 'a1', steps: [{}, {}, {}], status: 'active',
    trigger: { type: 'schedule' }, next_run_at: null, ...o });
const AGENTS = new Map<string, Agent>([['a1', { id: 'a1', name: 'Clara', worker_role: 'chief_of_staff' }]]);
const STEPS = (w: RawWorkflow | undefined) => (Array.isArray(w?.steps) ? w!.steps as WorkflowStep[] : null);

async function dayFrameGates() {
  // ── AT7 · A5 — THE FEATURE LADDER: an absent organ is an ABSENT KEY, never an empty zone ───────
  console.log('\nAT7 · THE FEATURE LADDER — an organ that does not exist has no key, no vocabulary');
  {
    // A CLIENT THAT MUST NEVER BE TOUCHED: feature-off is decided before any read.
    const exploding = { from() { throw new Error('the ladder read the database for an absent organ'); } } as any;
    const off = await buildDayFrame(exploding, 'u-off', FEATURES({ meetings: false, studio: false }), 'sam@acme.example', NOW);
    ok('A5.1 · both organs OFF → NO KEYS AT ALL (absence, never an empty object)',
      Object.keys(off).length === 0 && !('today' in off) && !('inMotion' in off),
      JSON.stringify(off));

    // A5.2 — ON but not connected. The calendar rides an ACTIVE gmail/outlook connection.
    const unconnected = fakeDb({ connections: [], calendar_events: [ev()], item_plans: [] });
    ok('A5.2 · calendar ON but NOT CONNECTED → today is undefined (no empty widget, no upsell)',
      (await buildTodayZone(unconnected, 'u-unconn', FEATURES(), 'sam@acme.example', NOW)) === undefined);
    // …and with the same events, a CONNECTED account does earn the zone — so the gate above proves
    // the connection, not an accidentally-empty fixture.
    const connected = fakeDb({ connections: [{ id: 'c1' }], calendar_events: [ev()], item_plans: [] });
    ok('   …the same day, connected, DOES earn the zone (the gate proves the ladder, not a dead fixture)',
      !!(await buildTodayZone(connected, 'u-conn', FEATURES(), 'sam@acme.example', NOW))?.events.length);

    ok('A5 · the ladder lives in the SERVER module, never in the client (no feature test in the frame)',
      !/features\.|WorkspaceFeatures/.test(src('components/home/day-frame.tsx')));
    // No vocabulary anywhere for an absent organ: no connect-CTA copy in the zone or its mount.
    const frameSrc = src('components/home/day-frame.tsx');
    ok('A5 · no upsell vocabulary anywhere in the zone (no "connect", no empty state)',
      !/connect your|Connect your|No meetings|No events|Nothing scheduled/i.test(frameSrc)
      && !/connect/i.test(frameSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  }

  // ── AT8 · A4 — THE ZONE EARNS ITS SEAT ─────────────────────────────────────────────────────────
  console.log('\nAT8 · THE DAY FRAME — a zone renders only with something TRUE to say');
  {
    const pastOnly = fakeDb({
      connections: [{ id: 'c1' }], item_plans: [],
      calendar_events: [ev({ start_time: '2026-09-17T07:00:00Z', end_time: '2026-09-17T07:30:00Z' })],
    });
    ok('A4 · a day with nothing LEFT in it → today undefined (never "No meetings today")',
      (await buildTodayZone(pastOnly, 'u-past', FEATURES(), 'sam@acme.example', NOW)) === undefined);
    ok('   …and the pure window agrees (a finished event is not the day ahead)',
      selectDayEvents([ev({ start_time: '2026-09-17T07:00:00Z', end_time: '2026-09-17T07:30:00Z' })], 'UTC', NOW, null).length === 0);
    ok('   …an event STILL IN PROGRESS counts (it is what is happening)',
      selectDayEvents([ev({ start_time: '2026-09-17T08:30:00Z', end_time: '2026-09-17T09:30:00Z' })], 'UTC', NOW, null).length === 1);

    // THE TAIL — a spent day still has one true thing to say, and only one.
    const tail = selectDayEvents([ev({ start_time: '2026-09-18T09:30:00Z', end_time: '2026-09-18T10:00:00Z' })], 'UTC', NOW, null);
    ok('A4 · a spent day speaks TOMORROW — exactly one row, marked tomorrow',
      tail.length === 1 && tail[0].tomorrow === true);
    ok('   …three days out is NOT a tail (the frame is not a calendar)',
      selectDayEvents([ev({ start_time: '2026-09-20T09:30:00Z' })], 'UTC', NOW, null).length === 0);
    ok('   …and a cancelled event never speaks',
      selectDayEvents([ev({ title: 'Canceled: Sync' }), ev({ status: 'cancelled' })], 'UTC', NOW, null).length === 0);

    // THE PREP STATE IS READ, NEVER GUESSED.
    const e = { id: 'ev9', start_time: '2026-09-17T14:00:00Z' };
    const key = 'meeting:ev9:2026-09-17T14:00';
    const preps = (t: PrepRecord['tasks']): PrepRecord[] => [{ entity_id: key, tasks: t }];
    ok('A4 · a real prep record reads "ready", carrying its own room',
      prepStateOf(e, preps({ entityId: 'ent1' })).prep === 'ready');
    ok('   …a SILENT record is not a prep (the lane found nothing worth preparing)',
      prepStateOf(e, preps({ silent: true, entityId: 'ent1' })).prep === null);
    ok('   …no record at all claims nothing', prepStateOf(e, []).prep === null);
    ok('   …and a RESCHEDULED start never inherits the old brief (the key carries the minute)',
      prepStateOf({ id: 'ev9', start_time: '2026-09-17T15:00:00Z' }, preps({ entityId: 'ent1' })).prep === null);

    // THE SUBSUMED-NAME RULE (found live: "Jordan Lee, Jordan" on one invite).
    ok('A4 · a bare first name folds into the fuller name it belongs to',
      counterpartsOf([{ name: 'Jordan Lee', email: 'jordan@acme.example' }, { email: 'jordan@partner.example' }], null)
        .join(', ') === 'Jordan Lee');
    ok('   …and the user is never a counterpart in their own meeting',
      counterpartsOf([{ name: 'Sam Doe', email: 'sam@acme.example' }, { name: 'Jordan Lee', email: 'j@acme.example' }],
        'sam@acme.example').join(', ') === 'Jordan Lee');
  }

  // ── AT9 · A6 — IN MOTION IS STATE, NEVER EVENTS ────────────────────────────────────────────────
  console.log('\nAT9 · IN MOTION — state, owner-led, one work one row, a pointer not a list');
  {
    const daySrc = src('lib/home/day.ts');
    // The prose may NAME what is excluded (it should); the CODE may not read it.
    const dayCode = daySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
    ok('A6 · the derivation takes RUNS + WORKFLOWS only — no message/notification source exists',
      /export function deriveInMotionRows\(\s*runs: RawRun\[\], wfById: Map<string, RawWorkflow>, agentById: Map<string, Agent>,/.test(daySrc)
      && !/work_messages|workflow_notifications|room_turns|notification/i.test(dayCode));

    const rows = deriveInMotionRows([run()], new Map([['wf1', wf()]]), AGENTS, STEPS, 'UTC', NOW);
    ok('A6 · every row is a STATE kind (running · waiting · scheduled), never an event',
      rows.length === 1 && (['running', 'waiting', 'scheduled'] as InMotionKindList).includes(rows[0].kind));
    ok('   …ids name what they stand for (run:… / wf:…)', /^run:/.test(rows[0].id));
    ok('   …and the state is the presence idiom, stated once', rows[0].state === 'running · step 1 of 3');

    // THE AVATAR LAW — every row leads with its OWNER's face.
    ok('A6 · a row carries its owning coworker', rows[0].owner?.name === 'Clara');
    const parkedSteps = [{ type: 'ai' }, { type: 'handoff', assignee_user_id: 'u2', assignee_name: 'Jordan Lee' }];
    const parked = deriveInMotionRows(
      [run({ status: 'awaiting_approval', step_outputs: [{}] })],
      new Map([['wf1', wf({ steps: parkedSteps })]]), AGENTS,
      (w) => (Array.isArray(w?.steps) ? w!.steps as WorkflowStep[] : null), 'UTC', NOW);
    ok('   …and a HANDOFF park leads with the PERSON holding it, not the authoring coworker',
      parked.length === 1 && parked[0].kind === 'waiting' && parked[0].owner?.name === 'Jordan Lee'
      && parked[0].state === 'waiting on Jordan');
    ok('   …a face-less row is honest, never invented',
      deriveInMotionRows([run()], new Map([['wf1', wf({ agent_id: null })]]), AGENTS, STEPS, 'UTC', NOW)[0].owner === null);

    // ONE WORK, ONE ROW — the fold that killed the six-identical-lines wall.
    const six = Array.from({ length: 6 }, (_, i) => run({ id: `r${i}`, status: 'awaiting_approval', step_outputs: [] }));
    const folded = deriveInMotionRows(six, new Map([['wf1', wf({ steps: [{ type: 'approval' }] })]]), AGENTS,
      (w) => (Array.isArray(w?.steps) ? w!.steps as WorkflowStep[] : null), 'UTC', NOW);
    ok('A6 · six parked runs of ONE workflow are ONE row', folded.length === 1);
    ok('   …and the count rides the STATE word, not six lines', /^6 waiting/.test(folded[0].state));
    const many = Array.from({ length: 12 }, (_, i) => wf({ id: `w${i}`, name: `Task ${i}`, next_run_at: '2026-09-17T18:00:00Z' }));
    ok('A6 · the glance is capped — it never becomes a second inbox',
      deriveInMotionRows([], new Map(many.map((w) => [w.id, w])), AGENTS, STEPS, 'UTC', NOW).length === IN_MOTION_MAX_ROWS);

    // THE POINTER — A6's ONE permitted arrival reference.
    const withDelivered = await buildInMotionZone(
      fakeDb({ workflow_runs: [{ id: 'd1' }], workflows: [], custom_agents: [], calendar_events: [] }),
      'u-ptr', FEATURES(), NOW);
    ok('A6 · a delivery is a POINTER — a count and a door, never a row or a list',
      !!withDelivered && withDelivered.rows.length === 0
      && typeof withDelivered.delivered?.count === 'number' && !!withDelivered.delivered?.href
      && Object.keys(withDelivered.delivered ?? {}).join(',') === 'count,href');
    ok('   …and a zone with a pointer and no rows still earns its seat', !!withDelivered);
    const nothingAtAll = await buildInMotionZone(
      fakeDb({ workflow_runs: [], workflows: [], custom_agents: [], calendar_events: [] }), 'u-none', FEATURES(), NOW);
    ok('A4 · no rows AND no pointer → the zone is undefined', nothingAtAll === undefined);
    ok('A5.1 · workflows OFF → the zone key is absent even with live runs',
      (await buildInMotionZone(
        { from() { throw new Error('read an absent organ'); } } as any, 'u-nostudio', FEATURES({ studio: false }), NOW)) === undefined);
  }

  // ── AT10 · THE SURFACES — the budget is rendered, never re-cut ─────────────────────────────────
  console.log('\nAT10 · THE SURFACES — the client renders what it was served');
  {
    const home = src('components/home/home-view.tsx');
    ok('the needs-you list renders the SERVED attention set',
      /const served = b\?\.attention\?\.served \?\? \[\];/.test(home)
      && /served\.map\(\(s\) => itemByAtom\.get\(s\.entityId\)\)/.test(home));
    // (RE-POINTED Sep 18, STRICTER: the same filter now also drops DAY-ANCHORED rows, which render
    //  under their meeting instead — see AS2. The held half of the law is asserted exactly as before.)
    ok('   …and a row the server HELD never renders in needs-you',
      /const heldBackIds = new Set\(b\?\.attention\?\.heldBack \?\? \[\]\);/.test(home)
      && /\.filter\(\(i\) => !heldBackIds\.has\(i\.entityId\) && !anchoredIds\.has\(i\.entityId\)\)/.test(home));
    ok('   …the client owns NO budget of its own (no cap, no slice, no number)',
      !/ATTENTION_BUDGET/.test(home)
      && !/whisperItems\.slice\(/.test(home) && !/whispers\.slice\(/.test(home)
      && !/served\.slice\(/.test(home));
    ok('   …and the fallback is the calm module\'s OWN pick, never a hand-sliced list',
      (home.match(/pickWhispers\(/g) ?? []).length === 1
      && /pickWhispers\(flatRows\.map\(\(r\) => r\.item\), CALM_MAX_WHISPERS\)/.test(home));
    ok('A1 · each served row wears its why-now clause on its own line',
      /whyNow=\{whyNowByAtom\.get\(w\.item\.entityId\) \?\? null\}/.test(home)
      && /\{whyNow \? <span className="text-neutral-400"> — \{whyNow\}<\/span>/.test(home));
    // (Q2, Sep 17: the door's WORDS changed — it now speaks the waiting band, see AQ2 — but the
    //  one-door law did not: it opens the LEDGER, never a wall in place.)
    // RE-POINTED (Sep 21 — CLOSE RETURNS WHERE YOU CAME FROM): the door still opens the LEDGER and
    // nothing else; it now RECORDS that it was the opener, so the deck's Close can return here.
    ok('A3 · the one door opens the LEDGER (not a wall in place)',
      !/Everything else ·/.test(home)
      && /onOpen=\{openHeldFromHome\}/.test(home)
      && /const openHeldFromHome = useCallback\(\(\) => \{ setHeldFromHome\(true\); setView\('held'\); \}, \[setView\]\);/.test(home)
      && !/restRows\.map\(/.test(home));
    const held = src('components/home/held-quiet.tsx');
    ok('A3 · the ledger prints the SERVED account — class · count · consequence · why-held · a way back',
      /\{c\.label\}/.test(held) && /\{c\.count\}/.test(held) && /\{c\.consequence\}/.test(held)
      && /\{m\.why\}/.test(held) && /Bring forward/.test(held));
    // (The sentences moved to `lib/home/held-words.ts` — pure, client-safe, gate-assertable — and
    //  the surface re-exports them. Same words, one home; AQ7 holds their content.)
    const words = src('lib/home/held-words.ts');
    ok('   …its own sentences are DETERMINISTIC, from the route\'s real counts — never a model',
      /export function heldIntro\(/.test(words) && /export function heldReceipts\(/.test(words)
      && /heldIntro, heldReceipts/.test(held)
      && !/getAIClient|aiCall\(|aiCreate|openai|anthropic/i.test(words));
    ok('   …and it is honest about its bound (the read\'s own cap is spoken)',
      /poolSaturated/.test(words) && /not accounted for here/.test(words));
    ok('A5 · the day frame mount carries no vocabulary for an absent organ',
      /<DayFrameView frame=\{dayFrame\}/.test(home)
      && /next=\{dayFrame\?\.today\?\.events\?\.length/.test(home)
      && !/connect your calendar/i.test(home));
  }
}
type InMotionKindList = ReadonlyArray<InMotionRow['kind']>;

// ── THE WORLD ───────────────────────────────────────────────────────────────────────────────────
async function auditAccount(label: string, userId: string) {
  console.log(`\nAT6 · THE LAWS ON THE WORLD — ${label}`);
  let sig: CampaignSignature | null = null;
  try { sig = await getCampaignSignature(sb, userId); } catch { /* inert */ }

  const { data: poolRows } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data, source, last_activity_at, created_at')
    .eq('user_id', userId).eq('status', 'pending').neq('source', 'commitment')
    .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(800);
  const rows = (poolRows ?? []) as any[];

  // The cached judgments, read exactly as the ledger route reads them.
  const judgedNone = new Set<string>();
  const judgedResolution = new Map<string, string | null>();
  {
    const ids = rows.map((r) => `inbox:${r.id}`);
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', 'judgment').in('entity_id', ids.slice(i, i + 150));
      for (const j of (data ?? []) as any[]) {
        const v = j.tasks?.verdict;
        if (v?.work !== 'none') continue;
        const id = String(j.entity_id).replace(/^inbox:/, '');
        judgedNone.add(id); judgedResolution.set(id, v?.resolution ?? null);
      }
    }
  }
  const floors: DeckFloors = { judgedNone, isEcho: (it) => isCampaignEcho(it as never, sig) };
  const eligible = rows
    .map((it) => ({ it: it as DeckItem, posture: classifyItem(it as never, []) }))
    .filter((x) => deckEligible(x.it, x.posture, floors));

  const candidates: AttentionRow[] = eligible.map((x) => {
    const sd = (x.it.source_data ?? {}) as any;
    const u = sd.understanding ?? null;
    const due = statedDueOf(x.it);
    const source = u?.relevance === 'action' ? 'notice' as const : 'reply' as const;
    return {
      key: `${source[0]}-${x.it.id}`, entityId: String(x.it.id), source,
      whyNow: whyNowOf({ source, who: sd.from_name || sd.from || null, dueDate: due, overdue: !!due && due < TODAY, dueToday: due === TODAY }),
      overdue: !!due && due < TODAY, dueToday: due === TODAY, dueDate: due,
    };
  });
  const { served, held: overflow } = rankAttention(candidates, ATTENTION_BUDGET);
  console.log(`     (${rows.length} pending · ${eligible.length} deck-eligible · ${served.length} served · ${overflow.length} over budget)`);

  // AT1 live — the budget holds on the real account.
  ok(`the served needs-you set never exceeds ${ATTENTION_BUDGET} (${served.length})`, served.length <= ATTENTION_BUDGET);

  // AT2 live — every served row states a why-now, and none of them is the bare word.
  const empty = served.filter((r) => !r.whyNow || !r.whyNow.trim());
  ok('every served row carries a why-now clause', empty.length === 0, empty.map((r) => r.entityId.slice(0, 8)).join(', '));
  const bare = served.filter((r) => isBareOverdue(r.whyNow));
  ok('no served clause is the bare word "overdue"', bare.length === 0, bare.map((r) => r.entityId.slice(0, 8)).join(', '));
  const distinct = new Set(served.map((r) => r.whyNow));
  console.log(`     · ${distinct.size}/${served.length} distinct why-now clauses (the fourteen-identical-rows failure would read 1)`);

  // AT3 live — the partition over the whole held set.
  const servedIds = new Set(served.map((r) => r.entityId));
  const eligibleIds = new Set(eligible.map((x) => String(x.it.id)));
  const facts: HeldFacts[] = rows.filter((it) => !servedIds.has(String(it.id))).map((it) => {
    const sd = (it.source_data ?? {}) as any;
    return {
      item: it as DeckItem,
      isEcho: floors.isEcho(it as DeckItem),
      judgedNone: judgedNone.has(String(it.id)),
      judgedResolution: judgedResolution.get(String(it.id)) ?? null,
      budgetOverflow: eligibleIds.has(String(it.id)),
      waitingOnOthers: sd.understanding?.ownership === 'awaiting' || it.work_state === 'waiting',
      quietSince: it.last_activity_at ?? it.created_at ?? null,
    };
  });
  const ledger = buildHeldLedger(facts, TODAY);
  const sum = ledger.classes.reduce((n, c) => n + c.count, 0);
  const bands = ledger.bands;
  ok(`every held item is classified (${ledger.total} held)`, ledger.total === facts.length);
  ok('   …the class counts SUM to the handled band', sum === bands.handled.count, `${sum} ≠ ${bands.handled.count}`);
  // ── AQ1 · THE THREE BANDS PARTITION, on the real account ─────────────────────────────────────
  console.log(`     · bands: waiting ${bands.waiting.count} · watched ${bands.watched.count} · handled ${bands.handled.count}`);
  ok('AQ1 · waiting + watched + handled === the held total',
    bands.waiting.count + bands.watched.count + bands.handled.count === ledger.total,
    `${bands.waiting.count}+${bands.watched.count}+${bands.handled.count} ≠ ${ledger.total}`);
  ok('AQ1 · the door\'s band is the SMALL one (waiting ≤ watched+handled on a real backlog)',
    bands.waiting.count <= bands.watched.count + bands.handled.count,
    `waiting ${bands.waiting.count} of ${ledger.total}`);
  const seen = new Set<string>();
  let doubled = 0;
  for (const c of ledger.classes) for (const m of c.members) { if (seen.has(m.itemId)) doubled++; seen.add(m.itemId); }
  for (const m of [...bands.waiting.rows, ...bands.watched.rows]) { if (seen.has(m.itemId)) doubled++; seen.add(m.itemId); }
  ok('AQ1 · no member appears in two classes OR in two bands', doubled === 0, `${doubled} duplicated`);
  ok('AQ1 · every served waiting/watched row carries its class and its why',
    [...bands.waiting.rows, ...bands.watched.rows].every((m) => !!m.cls && m.why.trim().length > 0));
  ok('   …nothing is lost: served + held = the whole pool',
    served.length + ledger.total === rows.length, `${served.length}+${ledger.total} ≠ ${rows.length}`);

  // AT4 live — every class speaks, and a spoken deadline is real.
  const mute = ledger.classes.filter((c) => !c.consequence.trim());
  ok('every class speaks a consequence', mute.length === 0, mute.map((c) => c.id).join(', '));
  for (const c of ledger.classes) {
    console.log(`     · ${c.id}: ${c.count} — "${c.consequence}"`);
  }
  const lying = ledger.classes.filter((c) => /real deadline/.test(c.consequence)
    && !facts.some((f) => classifyHeld(f) === c.id && (statedDueOf(f.item) ?? '') >= TODAY));
  ok('a spoken deadline is backed by a real member date', lying.length === 0, lying.map((c) => c.id).join(', '));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AQ · THE QUALITY LAWS (docs/attention-plan.md PART III — Q2 · Q3 · Q8)
//
//   AQ1 · THE THREE BANDS partition the held set (asserted live, inside auditAccount).
//   AQ2 · THE DOOR SPEAKS THE SMALL NUMBER — waiting, never the archive total.
//   AQ3 · GRADUATION is deterministic, capped, and exempts every band and class it must.
//   AQ4 · A GRADUATE COMES BACK on a new inbound (the reactivation seam reads resolved items).
//   AQ5 · AN INTERNAL TEAMMATE IS NEVER A CALENDAR BRIDGE.
//   AQ6 · ADJACENCY PROMOTIONS ARE CAPPED at three.
//   AQ7 · THE INTRO + RECEIPTS compose from SERVED NUMBERS ONLY — no model anywhere near them.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import {
  bandOf, whyHeldOf, HELD_BANDS, HELD_BAND_ORDER, graduationSentence,
  selectGraduates, GRADUATION_DAYS, GRADUATING_CLASSES,
  internalDomainsOf, isInternalBridge, PUBLIC_MAIL_DOMAINS, COWORKER_MAIL_DOMAIN,
  MAX_ADJACENCY_PROMOTIONS, type HeldBandId,
} from '../lib/home/attention';
import { GRADUATION_REASON, GRADUATION_CAP } from '../lib/work/graduation';
import { REVERSIBLE_TYPE_ENTITY } from '../lib/activity/restore';
import { heldIntro, heldReceipts } from '../lib/home/held-words';
import {
  selectProofOfLife, proofOfLifeFact, proofOfLifeSigPart, runProofOfLifeLane,
  PROOF_OF_LIFE_DAYS, PROOF_OF_LIFE_CAP, type ProofCandidate,
} from '../lib/work/proof-of-life';
import { pastePackEligibility, pastePackNote, PASTE_PACK_TASK } from '../lib/prepare/paste-pack';
import { pickFreeSlots, zonedTimeToUtc, PROPOSAL_HOURS } from '../lib/prepare/free-slots';

function qualityGates() {
  const f = (o: Partial<HeldFacts>): HeldFacts => ({ item: item(), isEcho: false, judgedNone: false, ...o });
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  // ── AQ1 · THE BAND LAW (the live partition rides auditAccount; this is the law itself) ────────
  console.log('\nAQ1 · THE GRADIENT — three bands, one fact each, first match wins');
  {
    ok('the band order is stated once and complete',
      HELD_BAND_ORDER.join(',') === 'waiting,watched,handled'
      && HELD_BAND_ORDER.every((b) => HELD_BANDS[b].title.trim() && HELD_BANDS[b].sentence.trim()));
    ok('a budget-overflow row is WAITING (alive, real, held only by the budget)',
      bandOf('quieter_threads', f({ budgetOverflow: true })) === 'waiting');
    ok('   …and the SAME class, refused by a floor, is HANDLED (the class says what it is, the band what we did)',
      bandOf('quieter_threads', f({})) === 'handled');
    ok('a copied-in row is WATCHED, budget or no budget',
      bandOf('cc_watch', f({})) === 'watched' && bandOf('cc_watch', f({ budgetOverflow: true })) === 'watched');
    ok('   …and so is a row somebody ELSE owes the move on',
      bandOf('quieter_threads', f({ budgetOverflow: true, waitingOnOthers: true })) === 'watched');
    ok('every noise class lands in HANDLED by default (a later class needs no edit to the band law)',
      (['bulk_mail', 'notices', 'own_outreach', 'judged_quiet'] as HeldClassId[])
        .every((c) => bandOf(c, f({})) === 'handled'));
    ok('brought_forward is a STRICT SUBSET of waiting (adjacency promotes the alive, never a newsletter)',
      classifyHeld(f({ calendarAdjacent: true, budgetOverflow: true })) === 'brought_forward'
      && classifyHeld(f({ calendarAdjacent: true, item: item({ sd: { has_unsubscribe: true } }) })) === 'bulk_mail'
      && bandOf('brought_forward', f({ calendarAdjacent: true, budgetOverflow: true })) === 'waiting');

    // The served bands, built by the one pass.
    const l = buildHeldLedger([
      f({ budgetOverflow: true, calendarAdjacent: true }),
      f({ budgetOverflow: true }),
      f({ item: item({ sd: { is_cc_only: true, understanding: { role: 'bystander', relevance: 'awareness', language: 'en', ownership: 'none' } } }) }),
      f({ item: item({ sd: { has_unsubscribe: true } }) }),
    ], TODAY);
    ok('the ledger serves all three bands, partitioned',
      l.bands.waiting.count === 2 && l.bands.watched.count === 1 && l.bands.handled.count === 1
      && l.bands.waiting.count + l.bands.watched.count + l.bands.handled.count === l.total);
    ok('   …the calendar-adjacent row LEADS the waiting band (adjacency is why, not a band)',
      l.bands.waiting.rows[0].cls === 'brought_forward');
    ok('   …the handled band carries the classes (and nothing else does)',
      l.bands.handled.classes.length === 1 && l.bands.handled.classes[0].id === 'bulk_mail'
      && l.classes.length === l.bands.handled.classes.length);
    ok('   …and the waiting band counts its LANDED deadlines honestly',
      buildHeldLedger([f({ budgetOverflow: true, item: item({ sd: { understanding: { role: 'addressed', relevance: 'reply', language: 'en', deadline: '2020-01-01' } } }) })], TODAY)
        .bands.waiting.urgent === 1
      && l.bands.waiting.urgent === 0);
    ok('   …the handled band header states the graduation law',
      l.bands.handled.graduation === graduationSentence(GRADUATION_DAYS)
      && /10 days/.test(l.bands.handled.graduation));
    // THE SURFACE RENDERS THE BANDS — it never re-partitions.
    const heldSrc = src('components/home/held-quiet.tsx');
    ok('AQ1 · the ledger surface reads the SERVED bands and partitions nothing itself',
      /ledger\?\.bands/.test(heldSrc) && /bands\.watched\.count/.test(heldSrc)
      && /bands\?\.handled\.classes/.test(heldSrc)
      && !/classifyHeld|bandOf\(/.test(heldSrc));
    ok('   …the promoted "Brought forward" SECTION is gone (adjacency dissolved into waiting)',
      !/classes\.find\(\(c\) => c\.id === 'brought_forward'\)/.test(heldSrc)
      && !/<Header>\{brought/.test(heldSrc) && /waitingRows/.test(heldSrc));
  }

  // ── AQ2 · THE DOOR SPEAKS THE SMALL NUMBER ────────────────────────────────────────────────────
  console.log('\nAQ2 · THE DOOR — "When you\'re ready · <waiting>", never the archive total');
  {
    const home = src('components/home/home-view.tsx');
    ok('the door\'s number is the WAITING band, not the held total',
      /When you're ready · \$\{waiting\} →/.test(home)
      && /waiting=\{typeof b\?\.attention\?\.heldWaiting === 'number'/.test(home)
      && !/Held quiet · \$\{/.test(home));
    // RE-POINTED (Sep 21 — owner: "it looks clickable/meaningful but opens nothing; let's just
    // remove that label"). The handled total no longer rests on the DOOR LINE: it wore a button's
    // affordance for a door that only repeated the left one. THE LAW THAT SURVIVES is the one that
    // always mattered — the big number is a FACT and never a door's claim — and the ACCOUNT of it
    // is still spoken, one click in, by the held page's own intro sentence.
    ok('   …and the door line carries NO handled-quietly receipt at all',
      (() => {
        // The door's OWN body: from its signature to the end of its render. (The ring's "N handled
        // today" lives elsewhere on the page and is a different fact — it is not this door's.)
        const door = home.slice(home.indexOf('function CalmDoor({ waiting, onOpen }'), home.indexOf('// ── THE URL IS THE LENS'));
        return !!door && !/handled quietly|handled today|heldHandled|toLocaleString/.test(door)
          && (door.match(/<button/g) ?? []).length === 1
          && !/handledQuietly=|handledToday=/.test(home);
      })());
    ok('   …while the held page still accounts for it, in words, from the served numbers',
      /filed quietly/.test(src('lib/home/held-words.ts'))
      && /Everything else is handled: \$\{handled\.toLocaleString\(\)\} filed quietly/.test(src('lib/home/held-words.ts'))
      && /heldIntro\(ledger, deckHeld\.length\)/.test(src('components/home/held-quiet.tsx')));
    ok('   …and the number the door does speak is SERVED — the client computes none',
      !/heldHandled \+|heldWaiting \*/.test(home)
      && /heldWaiting\?: number \| null;/.test(home) && /heldHandled\?: number \| null;/.test(home));
    const brief = src('app/api/home/brief/route.ts');
    ok('the serving layer computes the bands through the ONE derivation',
      /countHeld\(supabase, user\.id/.test(brief) && /waiting: c\.waiting/.test(brief));
    const hm = src('lib/deeds/held-members.ts');
    ok('   …and that derivation counts the bands through the ONE band law',
      /bandOf\(cls, f\)/.test(hm) && /byBand\[band\]\+\+/.test(hm));
    ok('   …the deed acts on HANDLED members only (a verb can never sweep a waiting row)',
      /if \(band !== 'handled'\) continue;/.test(hm));
  }

  // ── AQ3 · THE GRADUATION LAW ──────────────────────────────────────────────────────────────────
  console.log('\nAQ3 · GRADUATION — deterministic, capped, and exempting what it must');
  {
    const quiet = (o: Partial<HeldFacts>) => f({ quietSince: daysAgo(40), ...o });
    const bulk = (o: Partial<HeldFacts> = {}) => quiet({ item: item({ sd: { has_unsubscribe: true, ...(o as any).sd } }), ...o });
    ok('a 40-day-quiet newsletter graduates', selectGraduates([bulk()], TODAY).length === 1);
    ok('   …a 3-day-quiet one does NOT', selectGraduates([bulk({ quietSince: daysAgo(3) })], TODAY).length === 0);
    ok('   …and the threshold is exactly the stated one',
      selectGraduates([bulk({ quietSince: daysAgo(GRADUATION_DAYS) })], TODAY).length === 1
      && selectGraduates([bulk({ quietSince: daysAgo(GRADUATION_DAYS - 1) })], TODAY).length === 0);
    ok('a WAITING row never graduates, however old',
      selectGraduates([quiet({ budgetOverflow: true })], TODAY).length === 0);
    ok('a WATCHED row never graduates, however old',
      selectGraduates([quiet({ item: item({ sd: { is_cc_only: true, understanding: { role: 'bystander', relevance: 'awareness', language: 'en', ownership: 'none' } } }) })], TODAY).length === 0
      && selectGraduates([quiet({ waitingOnOthers: true })], TODAY).length === 0);
    ok('REAL CORRESPONDENCE (quieter_threads) never graduates — filing that on a timer is how trust dies',
      !GRADUATING_CLASSES.has('quieter_threads')
      && selectGraduates([quiet({ item: item({ sd: { from_address: 'jordan@partner.example', understanding: { role: 'addressed', relevance: 'reply', language: 'en', ownership: 'you_owe' } } }) })], TODAY).length === 0);
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    ok('a deadline that STILL STANDS exempts the row',
      selectGraduates([quiet({ item: item({ sd: { has_unsubscribe: true, understanding: { role: 'addressed', relevance: 'awareness', language: 'en', deadline: future } } }) })], TODAY).length === 0);
    ok('   …a deadline that has PASSED does not',
      selectGraduates([quiet({ item: item({ sd: { has_unsubscribe: true, understanding: { role: 'addressed', relevance: 'awareness', language: 'en', deadline: '2020-01-01' } } }) })], TODAY).length === 1);
    ok('a row with NO clock never graduates (no fact, no filing)',
      selectGraduates([f({ item: item({ sd: { has_unsubscribe: true } }) })], TODAY).length === 0);
    const many = Array.from({ length: 50 }, (_, i) => bulk({ quietSince: daysAgo(20 + i) }));
    const capped = selectGraduates(many, TODAY, { cap: 10 });
    ok('the cap is a budget, spent OLDEST FIRST',
      capped.length === 10 && capped[0].quietDays >= capped[9].quietDays
      && capped[0].quietDays === Math.max(...many.map((m) => Math.floor((Date.now() - Date.parse(m.quietSince!)) / 86_400_000))));
    ok('   …and the selection is a PURE function (same input, same output)',
      JSON.stringify(selectGraduates(many, TODAY, { cap: 10 })) === JSON.stringify(capped));

    const lane = src('lib/work/graduation.ts');
    ok('the lane performs, it never judges (zero AI anywhere on it)',
      !/getAIClient|getSystemClient|aiCreate|aiCall\(|judgeWork/.test(lane));
    ok('   …it acts ONLY through the existing undoable door',
      /executeResolveInboxItem/.test(lane) && !/from\('inbox_items'\)[\s\S]{0,80}\.update\(/.test(lane));
    ok(`   …and every graduate carries its own name ("${GRADUATION_REASON}")`,
      /resolutionReason: GRADUATION_REASON/.test(lane) && GRADUATION_REASON === 'graduated');
    ok('   …a graduation is REVERSIBLE — it resolves as `dismiss`, which /api/restore reverses',
      /resolution: 'dismiss'/.test(lane) && REVERSIBLE_TYPE_ENTITY.dismissed === 'inbox_item');
    ok('   …DRY BY DEFAULT — nothing is filed unless `apply` was passed',
      /if \(!opts\.apply \|\| !take\.length\) return out;/.test(lane) && GRADUATION_CAP === 200);
    ok('   …and the receipt is COUNTED from the activity log, never estimated',
      /from\('activity_events'\)/.test(lane) && /count: 'exact', head: true/.test(lane)
      && /metadata->>resolution_reason/.test(lane));
    const sweep = src('lib/work/judgment-sweep.ts');
    ok('the lane is hosted by the judgment sweep, budgeted and non-fatal',
      /runGraduationLane/.test(sweep) && /deadlineMs/.test(sweep) && /out\.graduated = r\.filed/.test(sweep));
    ok('   …and the cron reports what it filed', /graduated, graduationLeftBehind/.test(src('app/api/cron/judgment-sweep/route.ts')));
  }

  // ── AQ4 · A GRADUATE COMES BACK ───────────────────────────────────────────────────────────────
  console.log('\nAQ4 · REACTIVATION SURVIVES GRADUATION — filing is never final');
  {
    const re = src('lib/inbox/reactivate-on-reply.ts');
    ok('the reactivation seam reopens exactly the states a graduation leaves behind',
      /item\.status !== 'completed' && item\.status !== 'dismissed'/.test(re)
      && /\.in\('status', \['completed', 'dismissed'\]\)/.test(re)
      && /status: 'pending'/.test(re));
    ok('   …and it strips the resolution markers, so a reopened row never reads as filed',
      /delete existingSd\.resolved_reason;/.test(re) && /delete existingSd\.resolved_at;/.test(re));
    ok('   …a NEWER inbound is required (re-syncing old mail can never resurrect a filed row)',
      /new Date\(incoming\) <= new Date\(lastSeen\)/.test(re));
  }

  // ── AQ5 · THE INTERNAL BRIDGE ─────────────────────────────────────────────────────────────────
  console.log('\nAQ5 · AN INTERNAL TEAMMATE IS NEVER A CALENDAR BRIDGE (the recurring-meeting swallow)');
  {
    const internal = internalDomainsOf(['sam@acme.example', null]);
    ok('a same-domain colleague grants NO adjacency',
      isInternalBridge('jordan@acme.example', internal));
    ok('   …nor does our own coworker address',
      isInternalBridge(`clara@${COWORKER_MAIL_DOMAIN}`, internal) && internal.has(COWORKER_MAIL_DOMAIN));
    ok('   …while a real external counterparty still bridges',
      !isInternalBridge('jordan@partner.example', internal));
    ok('A FREE-MAIL ADDRESS IS NEVER A CORPORATE DOMAIN (the inverse swallow)',
      !internalDomainsOf(['sam@gmail.com']).has('gmail.com')
      && !isInternalBridge('someone@gmail.com', internalDomainsOf(['sam@gmail.com']))
      && PUBLIC_MAIL_DOMAINS.has('gmail.com'));
    ok('   …and a blank address is never a bridge', !isInternalBridge(null, internal) && !isInternalBridge('', internal));
    const hm = src('lib/deeds/held-members.ts');
    ok('the ledger\'s adjacency fact applies the exclusion at the ONE place it is built',
      /isInternalBridge\(e, internalDomains\)/.test(hm) && /internalDomainsOf\(addrs\)/.test(hm));
    ok('   …and so does the deck\'s why-now half (one law, both readers)',
      /isInternalBridge\(e, internalDomains\)/.test(src('app/api/home/brief/route.ts')));
  }

  // ── AQ6 · THE ADJACENCY CAP ───────────────────────────────────────────────────────────────────
  console.log('\nAQ6 · ADJACENCY IS CAPPED — past three it describes a guest list, not a row');
  {
    ok('the cap is three', MAX_ADJACENCY_PROMOTIONS === 3);
    const hm = src('lib/deeds/held-members.ts');
    ok('the derivation counts promotions and stops at the cap',
      /adjacencyPromotions < MAX_ADJACENCY_PROMOTIONS/.test(hm)
      && /if \(cls === 'brought_forward'\) adjacencyPromotions\+\+;/.test(hm));
    ok('   …and the overflow keeps its TRUE class (nothing is hidden, only un-promoted)',
      classifyHeld(f({ calendarAdjacent: false, budgetOverflow: true })) === 'quieter_threads');
    // The cap's arithmetic, on the derivation's own shape: 10 adjacent eligible rows → 3 promoted.
    let promotions = 0;
    const classes = Array.from({ length: 10 }, () => {
      const adjacent = promotions < MAX_ADJACENCY_PROMOTIONS;
      const cls = classifyHeld(f({ calendarAdjacent: adjacent, budgetOverflow: true }));
      if (cls === 'brought_forward') promotions++;
      return cls;
    });
    ok('ten adjacent waiting rows promote exactly three',
      classes.filter((c) => c === 'brought_forward').length === MAX_ADJACENCY_PROMOTIONS
      && classes.filter((c) => c === 'quieter_threads').length === 7);
  }

  // ── AQ8 · MACHINERY STAYS MACHINERY (walk-found Sep 18) ──────────────────────────────────────
  // WAITING claims "real, alive"; a row wearing "an automated notice — no reply is possible"
  // inside that band is a contradiction on one screen. Noise classes reach WAITING only on a
  // judged stated deadline still ahead — and bulk_mail/own_outreach NEVER do (a sender's own
  // "sale ends today" is not the reader's deadline; the NO_DEADLINE_CLASSES lesson, again).
  console.log('\nAQ8 · MACHINERY STAYS MACHINERY — noise overflows to handled, never to waiting');
  {
    const noticeNoDl = f({ budgetOverflow: true });
    ok('a deck-eligible automated notice WITHOUT a deadline bands handled, never waiting',
      bandOf('notices', noticeNoDl) === 'handled');
    const noticeDl = f({ budgetOverflow: true, deadlineAhead: true });
    ok('   …with a judged deadline still ahead it earns waiting',
      bandOf('notices', noticeDl) === 'waiting');
    ok('   …and its waiting words speak the deadline, never "no reply is possible"',
      whyHeldOf('notices', noticeDl) === 'automated, but it names a real deadline'
      && whyHeldOf('notices', noticeNoDl) === 'an automated notice — no reply is possible');
    ok('bulk mail NEVER deadline-lifts (the sender\'s own expiry is not the reader\'s deadline)',
      bandOf('bulk_mail', f({ budgetOverflow: true, deadlineAhead: true })) === 'handled');
    ok('   …nor does the user\'s own echo', bandOf('own_outreach', f({ budgetOverflow: true, deadlineAhead: true })) === 'handled');
    ok('a real correspondence row still waits exactly as before',
      bandOf('quieter_threads', f({ budgetOverflow: true })) === 'waiting');
    const hm = src('lib/deeds/held-members.ts');
    ok('the deadline fact is judged + code-compared to the user\'s day (understanding.deadline vs todayISO)',
      /u\?\.deadline/.test(hm) && /dl !== null && dl >= todayISO/.test(hm));
  }

  // ── AQ7 · THE INTRO AND THE RECEIPTS ──────────────────────────────────────────────────────────
  console.log('\nAQ7 · THE CoS\'s SENTENCE — composed from the served numbers, by code, never a model');
  {
    const wordsSrc = src('lib/home/held-words.ts');
    ok('the composers are deterministic, pure, and reach no model',
      /export function heldIntro\(/.test(wordsSrc) && /export function heldReceipts\(/.test(wordsSrc)
      && !/getAIClient|aiCall\(|aiCreate|openai|anthropic|@supabase|fetch\(/i.test(wordsSrc));
    ok('   …they read SERVED fields only (bands · servedCount · poolRead · filedThisMonth)',
      /l\.bands/.test(wordsSrc) && /l\.servedCount/.test(wordsSrc) && /l\.filedThisMonth/.test(wordsSrc));
    ok('   …and the surface speaks through THEM, never a second set of words',
      /from '@\/lib\/home\/held-words'/.test(src('components/home/held-quiet.tsx')));
    const l: any = {
      total: 20, classes: [{ id: 'bulk_mail' }], servedCount: 5, poolRead: 900, filedThisMonth: 312,
      bands: {
        waiting: { count: 12, urgent: 0, rows: [], hasMore: false },
        watched: { count: 3, rows: [], hasMore: false },
        handled: { count: 5, classes: [] },
      },
    };
    const intro = heldIntro(l, 0);
    ok('the intro states the gradient in the served numbers',
      /12 real things wait behind today's 5/.test(intro) && /none urgent, all alive/.test(intro)
      && /Everything else is handled: 5 filed quietly, 3 more being watched/.test(intro)
      && /Nothing is deleted, and anything comes back\./.test(intro), intro);
    ok('   …"none urgent" is NEVER spoken over a landed deadline',
      /2 of them have a deadline that has landed/.test(heldIntro({ ...l, bands: { ...l.bands, waiting: { ...l.bands.waiting, urgent: 2 } } }, 0)));
    ok('   …the deck\'s own held rows count into the waiting number',
      /14 real things wait/.test(heldIntro(l, 2)));
    ok('   …and an empty account says so rather than composing a hollow claim',
      heldIntro({ total: 0, classes: [], servedCount: 0, bands: { waiting: { count: 0, urgent: 0, rows: [], hasMore: false }, watched: { count: 0, rows: [], hasMore: false }, handled: { count: 0, classes: [] } } } as any, 0)
      === 'Nothing is being held back right now.');
    const receipts = heldReceipts(l);
    ok('the receipts footer states the bound AND Q3\'s earned claim',
      /read from 900 pending items/.test(receipts) && /filed 312 this month/.test(receipts)
      && /nothing deleted/.test(receipts), receipts);
    ok('   …and never claims a filing count it was not served',
      !/filed/.test(heldReceipts({ ...l, filedThisMonth: undefined })));
    ok('the route serves the receipt from the log, not from the ledger\'s shape',
      /countGraduatedThisMonth\(supabase, user\.id\)/.test(src('app/api/home/held/route.ts')));
  }
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// AR · THE DAY ANCHOR · THE FRESH SEAT · INSTANT CATCH-UP (Sep 18 — the owner's morning: two
// week-old rows floating alone above the day, both seated only because their people sit in his
// 15:30, while the night's arrivals waited for a sweep).
//   AR1 · AN ADJACENCY-SEATED ROW HAS A HOME — it carries the event id it was seated by, and the
//         day zone's raised rows come from THAT served set, never from a second derivation.
//   AR2 · THE FRESH SEAT — at equal band a fresh arrival outranks a stale calendar-adjacent row,
//         unless that meeting is TODAY; and the overflow is counted honestly.
//   AR3 · INSTANT CATCH-UP — detection is a fact, the kick is fire-and-forget through the kick's
//         own auth idiom, the stamp is an atomic ≥6h claim, the bootstrap runs the lanes, and NO
//         request handler ever drains synchronously.
// ════════════════════════════════════════════════════════════════════════════════════════════════
async function anchorGates() {
  console.log('\nAR1 · THE DAY ANCHOR — a row seated by a meeting lives under that meeting');
  {
    // (a) THE CONTRACT THE HOME READS: the served row carries the event id, and only a row the
    //     adjacency fact seated may carry one.
    const brief = src('app/api/home/brief/route.ts');
    ok('the adjacency fact carries WHICH event it is',
      /eventId: String\(ev\.id\),\s*\n?\s*today:/.test(brief));
    ok('the seated row is anchored to it',
      /anchoredToEventId: \(todayZoneLive && adj\?\.today === true\) \? adj\.eventId \?\? null : null/.test(brief));
    ok('   …and a row with no adjacency is anchored to NOTHING (the fact cannot be invented)',
      !/anchoredToEventId: .*\|\| ['"`]/.test(brief));
    // A HOME IS A THING THAT EXISTS: anchoring a row into a zone that will never render would
    // DELETE it from the Home (the surface excludes anchored rows from the floating whispers).
    ok('a row is anchored only where the Today zone is EARNED (the same ladder day.ts applies)',
      /todayZoneLive = feats\?\.\[TODAY_ZONE_FEATURE\] !== false && \(conns\?\.length \?\? 0\) > 0/.test(brief));
    ok('   …and only to a meeting the zone will actually draw (today, not yet over)',
      /today: localDate\(ev\.start_time as string\) === todayLocal[\s\S]{0,140}endsAt >= now\.getTime\(\)/.test(brief));
    ok('the served payload carries the field the Home excludes floating rows by',
      /served: served\.map\(\(r\) => \(\{[\s\S]{0,260}anchoredToEventId: r\.anchoredToEventId \?\? null/.test(brief));
    ok('   …and it rides the response', /attention: \{ budget: attention\.budget, served: attention\.served,/.test(brief));

    // (b) ONE DERIVATION. The day route must not re-derive attention: it reads what the brief
    //     served. The gate asserts BOTH halves — the brief records, the frame only reads.
    const anchorsSrc = src('lib/home/day-anchors.ts');
    const daySrc = src('lib/home/day.ts');
    ok('the brief RECORDS what it served (the one choke point decides)',
      /after\(\(\) => writeDayAnchors\(supabase, user\.id, anchors, now\)\)/.test(brief)
      && /const anchors = served[\s\S]{0,120}filter\(\(r\) => !!r\.anchoredToEventId\)/.test(brief));
    ok('   …only SERVED rows are anchored (a held row claims nobody\'s meeting)',
      !/held[\s\S]{0,40}\.filter\(\(r\) => !!r\.anchoredToEventId\)/.test(brief));
    ok('the day frame READS that record and derives nothing',
      /readDayAnchors\(client, userId, now\)/.test(daySrc)
      && !/rankAttention|deriveHeld|whyNowOf/.test(daySrc));
    ok('the anchor record is freshness-bounded (a stale deck never speaks for the day)',
      /now\.getTime\(\) - at > DAY_ANCHOR_MAX_AGE_MS\) return \[\]/.test(anchorsSrc));
    ok('   …and an unreadable record is an ABSENCE, never a guess',
      /catch \{ return \[\]; \}/.test(anchorsSrc));

    // (c) THE PURE FOLD — the raised rows of an event are exactly its own anchors, capped.
    const { anchorsForEvent, RAISED_PER_EVENT_MAX, clipAnchorTitle, DAY_ANCHOR_TITLE_MAX } =
      await import('../lib/home/day-anchors');
    const a = (eventId: string, itemId: string) =>
      ({ itemId, eventId, title: 'A thing', whyNow: 'they will ask at your 15:30', href: `/item/${itemId}` });
    const set = [a('ev1', 'i1'), a('ev2', 'i2'), a('ev1', 'i3'), a('ev1', 'i4'), a('ev1', 'i5')];
    ok('an event raises only its OWN rows',
      anchorsForEvent(set, 'ev2').map((x) => x.itemId).join(',') === 'i2');
    ok('   …capped — a meeting line never becomes a wall',
      anchorsForEvent(set, 'ev1').length === RAISED_PER_EVENT_MAX && RAISED_PER_EVENT_MAX <= 3);
    ok('   …and an event that raises nothing gets an empty list, never a placeholder',
      anchorsForEvent(set, 'ev9').length === 0);
    ok('the raised title is clipped at a word boundary',
      clipAnchorTitle('x'.repeat(200)).length <= DAY_ANCHOR_TITLE_MAX);

    // (d) THE FRAME'S OWN SHAPE: an event with no anchors carries NO key (A4, one level down).
    const { toDayEvent } = await import('../lib/home/day');
    const e = { id: 'ev1', title: 'Weekly sync', start_time: '2026-09-18T14:00:00Z', end_time: null,
      is_all_day: false, attendees: [], status: 'confirmed', tomorrow: false };
    const withRaised = toDayEvent(e as never, 'UTC', null, [], set as never);
    const without = toDayEvent({ ...e, id: 'ev9' } as never, 'UTC', null, [], set as never);
    ok('an event with anchors serves its raised rows',
      (withRaised.raised ?? []).length === RAISED_PER_EVENT_MAX
      && (withRaised.raised ?? []).every((r) => !!r.whyNow && !!r.href));
    ok('   …and one without carries NO key at all', !('raised' in without));
    ok('the raised row speaks the SAME why-now the whisper wears (never re-authored)',
      (withRaised.raised ?? [])[0].whyNow === set[0].whyNow
      && !/whyNowOf/.test(src('lib/home/day-anchors.ts')));

    // (e) THE SURFACE renders the whisper grammar and owns no budget of its own.
    const ui = src('components/home/day-frame.tsx');
    ok('the day frame renders the raised rows from the SERVE',
      /e\.raised \?\? \[\]/.test(ui) && /they'll raise/.test(ui));
    ok('   …in the whisper grammar (12px neutral, no badge, no colour)',
      /text-\[12px\] text-neutral-400/.test(ui) && !/bg-(red|amber|indigo)-\d00[^;]*raise/.test(ui));
  }

  console.log('\nAR2 · THE FRESH SEAT — the night\'s arrivals outrank a stale calendar bridge');
  {
    const fresh = row({ key: 'fresh', fresh: true });
    const staleLater = row({ key: 'later', calendarAdjacent: true, adjacencyToday: false });
    const staleToday = row({ key: 'today-mtg', calendarAdjacent: true, adjacencyToday: true });
    ok('a fresh arrival outranks a stale adjacency whose meeting is NOT today',
      attentionRank(fresh) < attentionRank(staleLater));
    ok('   …and TODAY\'s meeting still wins (it is the day\'s own shape)',
      attentionRank(staleToday) < attentionRank(fresh));
    ok('the cut follows the rule',
      rankAttention([staleLater, fresh, staleToday], 2).served.map((r) => r.key).join(',') === 'today-mtg,fresh');
    // THE THREE-VALUED DEFAULT: a caller that never computed the day changes nothing.
    ok('an adjacency with no computed day still ranks as today (nothing is broken by absence)',
      attentionRank(row({ calendarAdjacent: true })) === 0);
    ok('a fresh row with nothing else still sits above the judged tail',
      attentionRank(fresh) < attentionRank(row({})));

    // THE FRESHNESS FACT IS THE DECK'S OWN — never a second derivation of "new".
    const brief = src('app/api/home/brief/route.ts');
    ok('fresh reads the machine batch\'s own surfaced fact',
      /fresh: machineOf\(entityId\)\?\.surfaced === true/.test(brief));
    ok('   …which is judgedFirstAt inside 24h (one definition, already served)',
      /judgedFirstAt && Date\.parse\(st\.judgedFirstAt\) > dayAgo/.test(brief));
    ok('the overflow is COUNTED and served (the night never vanishes into weather)',
      /const freshHeld = held\.filter\(\(r\) => r\.fresh === true\)/.test(brief)
      && /fresh: \{ count: freshHeld\.length, ids: freshHeld\.map\(\(r\) => r\.entityId\) \}/.test(brief));
    ok('   …from the HELD rows only — a served row is not also waiting',
      !/served\.filter\(\(r\) => r\.fresh/.test(brief));
    ok('   …and it rides the response', /fresh: attention\.fresh, catchUp: attention\.catchUp \} \}\)\);/.test(brief));
  }

  console.log('\nAR3 · INSTANT CATCH-UP — the drain starts the moment the user looks');
  {
    const brief = src('app/api/home/brief/route.ts');
    const cu = src('lib/work/catch-up.ts');
    const route = src('app/api/internal/attention/catch-up/route.ts');
    const kick = src('app/api/internal/runs/kick/route.ts');
    const fl = src('lib/home/first-look.ts');

    // (a) DETECTION IS A FACT, not a feeling — the lane's own count, over the ledger's own facts.
    ok('the would-graduate count comes from the lane\'s OWN selection',
      /graduating: selectGraduates\(facts, todayISO\)\.length/.test(src('lib/deeds/held-members.ts')));
    ok('   …rides the read the brief already pays for (no second derivation)',
      /graduating: c\.graduating/.test(brief) && !/deriveHeld\(/.test(brief));
    ok('detection is a threshold over that fact',
      /counts\?\.graduating === 'number' && counts\.graduating >= CATCH_UP_THRESHOLD/.test(brief));
    ok('   …and a clean account is served null, never a zero that reads as a problem',
      /\? \{ filing: counts\.graduating \} : null/.test(brief));

    // (b) THE KICK — fire-and-forget, the kick precedent's own auth, NEVER synchronous.
    ok('the brief dispatches in after(), never inline',
      /if \(attention\.catchUp\) \{\s*after\(async \(\) => \{[\s\S]{0,700}internal\/attention\/catch-up/.test(brief));
    ok('   …and the brief itself drains NOTHING (no lane is reachable from the request path)',
      !/runCatchUp|runGraduationLane|runJudgmentSweep/.test(brief));
    ok('the internal route reuses the kick\'s bearer idiom (no new secret, no new pattern)',
      /const secret = process\.env\.AGENTOS_SECRET;/.test(route)
      && /!== `Bearer \$\{secret\}`/.test(route)
      && /const secret = process\.env\.AGENTOS_SECRET;/.test(kick));
    ok('   …with the kick\'s own window', /export const maxDuration = 300;/.test(route));
    ok('the route does the work in after() and answers 202 immediately',
      /after\(async \(\) => \{[\s\S]{0,400}runCatchUp\(/.test(route)
      && /\{ ok: true, started: true \}, \{ status: 202 \}/.test(route));
    ok('   …so no request handler anywhere drains synchronously',
      !/await runCatchUp/.test(route.replace(/after\(async \(\) => \{[\s\S]*?\n  \}\);/, '')));

    // (c) THE STAMP IS THE CLAIM — atomic, ≥6h, settled by the database.
    ok('the claim is insert-first (the unique index settles the first race)',
      /\.insert\(\{ user_id: userId, kind: CATCH_UP_KIND, entity_id: CATCH_UP_ENTITY/.test(cu));
    ok('   …and the re-claim is ONE conditional update whose filter IS the interval',
      /\.lt\('tasks->>at', cutoff\)/.test(cu) && /\.select\('id'\)/.test(cu));
    ok('   …never a read-then-write', !/maybeSingle\(\)[\s\S]{0,200}\.update\(/.test(cu));
    ok('the interval is six hours', /CATCH_UP_MIN_INTERVAL_MS = 6 \* 60 \* 60_000/.test(cu));
    ok('the route claims before it starts anything',
      /if \(!await claimCatchUp\(admin, userId\)\)[\s\S]{0,200}started: false/.test(route));

    const { CATCH_UP_THRESHOLD: T, CATCH_UP_MIN_INTERVAL_MS: I, CATCH_UP_BUDGET_MS: B } =
      await import('../lib/work/catch-up');
    ok('the threshold is the stated one (~300)', T === 300);
    ok('the interval is 6h in value too', I === 6 * 3_600_000);
    ok('the drain\'s own clock sits inside the route\'s window', B < 300_000);

    // (d) ONE IMPLEMENTATION — the drain drives the SAME lanes, with the catch-up overrides.
    ok('the drain runs the graduation lane through its one implementation',
      /await import\('@\/lib\/work\/graduation'\)[\s\S]{0,200}runGraduationLane\(admin, userId, \{\s*apply: true/.test(cu));
    ok('   …and the widened sweep through the ONE sweep (its nominator still orders)',
      /runJudgmentSweep\(admin, userId, \{[\s\S]{0,200}proofOfLifeCap/.test(cu));
    ok('   …adding no law of its own (no judge, no classifier, no AI client here)',
      !/getAIClient|aiCreate|judgeWork/.test(cu));

    // (e) THE BOOTSTRAP — a new account never accumulates the backlog at all.
    ok('the first-look chain runs the lanes after the prep pass',
      /runPreparationPass[\s\S]{0,900}runCatchUp\(admin, userId/.test(fl));
    ok('   …through the same one implementation', /await import\('@\/lib\/work\/catch-up'\)/.test(fl));
    ok('   …non-fatally, inside the chain\'s own once-only claim',
      /filter\('metadata->>first_look_at', 'is', null\)/.test(fl)
      && /runCatchUp\(admin, userId[\s\S]{0,200}catch \{ \/\* non-fatal \*\/ \}/.test(fl));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// QL · THE PREPARATION LAWS (docs/attention-plan.md PART III — Q7 · PROOF-OF-LIFE and Q8 · THE
// PREPARATION LIFT). Four gates, each holding one law the engine would otherwise quietly lose:
//   QL1 the silence is measured and asked about, through the ONE judgment door
//   QL2 every lane gets a slice, and there is ONE prep mechanism for meetings
//   QL3 the words are prepared even when the deed is out of reach — and only then
//   QL4 a timeless scheduling ask is proposed real free room, from the calendar, in code
// ════════════════════════════════════════════════════════════════════════════════════════════════
function preparationGates() {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const cand = (o: Partial<ProofCandidate> = {}): ProofCandidate =>
    ({ key: `inbox:${Math.random()}`, work: 'reply', activityAt: daysAgo(30), ...o });

  // ── QL1 · PROOF OF LIFE ───────────────────────────────────────────────────────────────────────
  console.log('\nQL1 · PROOF OF LIFE — a long-silent ask re-earns its seat, through the ONE door');
  {
    const src0 = src('lib/work/proof-of-life.ts');
    ok('the selection is PURE and reaches no model',
      /export function selectProofOfLife\(/.test(src0)
      && !/getAIClient|aiCall\(|aiCreate|openai|anthropic/i.test(src0.split('export async function runProofOfLifeLane')[0]));
    ok('THE ONE DOOR — the lane re-judges through judgeWork and defines no verdict of its own',
      /@\/lib\/work\/judge/.test(src0) && /judgeWork\(admin, userId/.test(src0)
      && !/work:\s*'none'/.test(src0) && !/resolution:\s*'expired'/.test(src0));
    ok('   …and its consequence is the EXISTING one (applyVerdictConsequences) — it resolves nothing itself',
      /applyVerdictConsequences/.test(src0)
      && !/status:\s*'(dismissed|completed)'/.test(src0) && !/resolution:/.test(src0)
      && !/resolved_at/.test(src0));

    const judgeSrc = src('lib/work/judge.ts');
    ok('THE FACT REACHES THE PROMPT — the judge speaks it beside its other code-computed facts',
      /proofOfLifeFact\(proofAsk\)/.test(judgeSrc) && /readProofOfLifeAsk\(client, userId/.test(judgeSrc));
    ok('   …and RIDES THE SIG, so today\'s cached verdict cannot swallow the question',
      /proofOfLifeSigPart\(proofAsk\)/.test(judgeSrc));
    ok('   …with no stamp the sig is byte-identical to what it was (a FACTS addition, no version bump)',
      proofOfLifeSigPart(null) === '');
    const fact = proofOfLifeFact({ at: daysAgo(1), quietDays: 22 });
    ok('the fact states the measured silence and leaves the verdict to the judge',
      fact.includes('22 days') && /computed in code/.test(fact)
      && /expired/.test(fact) && /revisit/.test(fact)
      && fact.replace(/\s+/g, ' ').includes('silence alone settles nothing'));

    ok('a quiet actionable item is selected',
      selectProofOfLife([cand({ key: 'inbox:a', activityAt: daysAgo(22) })]).length === 1);
    ok('   …a SETTLED item never is (a `none` has nothing to prove)',
      selectProofOfLife([cand({ key: 'inbox:a', work: 'none', activityAt: daysAgo(99) })]).length === 0);
    ok('   …and neither is one that moved inside the window',
      selectProofOfLife([cand({ activityAt: daysAgo(PROOF_OF_LIFE_DAYS - 1) })]).length === 0);
    ok('A PROOF RESETS FRESHNESS — an item asked inside the window is not asked again',
      selectProofOfLife([cand({ activityAt: daysAgo(40), askedAt: daysAgo(2) })]).length === 0
      && selectProofOfLife([cand({ activityAt: daysAgo(40), askedAt: daysAgo(PROOF_OF_LIFE_DAYS + 1) })]).length === 1);
    const many = Array.from({ length: 40 }, (_, i) => cand({ key: `inbox:${i}`, activityAt: daysAgo(11 + i) }));
    const picked = selectProofOfLife(many);
    ok('THE CAP HOLDS and the quietest lead',
      picked.length === PROOF_OF_LIFE_CAP && picked[0].quietDays >= picked[picked.length - 1].quietDays
      && picked[0].quietDays === 50);
    ok('   …the order is total and stable (ties break on the key, never on chance)',
      JSON.stringify(selectProofOfLife([cand({ key: 'inbox:b', activityAt: daysAgo(20) }), cand({ key: 'inbox:a', activityAt: daysAgo(20) })], Date.now(), { cap: 2 }).map((p) => p.key))
      === JSON.stringify(['inbox:a', 'inbox:b']));

    ok('THE SEAT CONTRACT IS FED — the lane writes Q4\'s one named field from the verdict itself',
      /stampAliveOnItem/.test(src0) && /proof_of_life: alive \? 'alive' : 'quiet'/.test(src0)
      && /export function provedAliveOf/.test(src('lib/home/attention.ts')));
    ok('   …and the serving side still treats an unstamped row as ALIVE (a lane that never ran changes nothing)',
      /provedAlive !== false/.test(src('lib/home/attention.ts')));
    const sweep = src('lib/work/judgment-sweep.ts');
    ok('the lane is HOSTED by the sweep under its OWN slice (a spent judgment budget never silences it)',
      /PROOF_SLICE_MS/.test(sweep) && /runProofOfLifeLane/.test(sweep)
      && /proof-of-life lane skipped/.test(sweep));
    ok('   …and its tally is reported, never folded into the judgment counts',
      /proofOfLife: \{ eligible/.test(sweep) && /proofOfLife: \{ checked/.test(src('app/api/cron/judgment-sweep/route.ts')));
  }

  // ── QL2 · THE LANE FLOORS ─────────────────────────────────────────────────────────────────────
  console.log('\nQL2 · THE LANE FLOORS — a late lane gets its slice, and meetings have ONE prep seat');
  {
    const pass = src('lib/prepare/pass.ts');
    ok('NEW & UNSORTED is a lane — the newest actionable work is reachable at all',
      /rep\.triage\.filter/.test(pass));
    ok('   …and the QUIET TAIL deliberately is not (Q7 decides whether it is still live)',
      !/rep\.stale\.filter/.test(pass) && /stale` lane stays OUT/.test(pass));
    ok('EVERY LANE HAS A FLOOR — the remaining clock is divided by the lanes still unserved',
      /lanesLeft = lanes\.length - i/.test(pass) && /laneDeadline/.test(pass));
    ok('   …and a lane that runs long DEFERS rather than eats (the overflow is walked after)',
      /deferred\.push\(w\)/.test(pass) && /const deferred: WorkItem\[\] = \[\]/.test(pass));
    ok('   …in the ONE nominated order, never lane order (a floor decides reach, not worth)',
      /deferred\.sort\(\(a, b\) => \(rankOf\.get/.test(pass));
    ok('   …and what the budget still could not reach is COUNTED, never silently truncated',
      /leftBehind\+\+/.test(pass) && /left for the next sweep/.test(pass));
    ok('ONE PREP MECHANISM — the pass writes no meeting briefs (the duplicate lane is retired)',
      !pass.includes('meeting-prep-') && !pass.includes('meetingPrep: true')
      && pass.includes('B3c · MEETING PREP RETIRED HERE'));
    ok('   …and the anticipation lane still holds the seat it moved to',
      /anticipate:meeting:/.test(src('lib/home/anticipation.ts')));
  }

  // ── QL3 · THE PASTE PACK ──────────────────────────────────────────────────────────────────────
  console.log('\nQL3 · THE PASTE PACK — the words are prepared when the deed is out of reach, and only then');
  {
    const mailOn = { email: true, meetings: true, drive: true } as any;
    const mailOff = { email: false, meetings: true, drive: true } as any;
    ok('a MAIL-CAPABLE reply never packs — the ordinary lane owns it',
      pastePackEligibility({ work: 'reply', itemKind: 'inbox', features: mailOn }).eligible === false);
    ok('   …nor does any verb whose preparation is not a message (schedule · forward · produce · send_file)',
      ['schedule', 'forward', 'decide', 'produce', 'send_file', 'none'].every((w) =>
        pastePackEligibility({ work: w, itemKind: 'inbox', features: mailOff }).eligible === false));
    const off = pastePackEligibility({ work: 'reply', itemKind: 'inbox', features: mailOff });
    ok('A FEATURE-OFF WORKSPACE packs — there is no door here for the send to go through',
      off.eligible && off.reason === 'feature_off', off.why);
    const commit = pastePackEligibility({ work: 'reply', itemKind: 'commitment', features: mailOn });
    ok('A REPLY ON A COMMITMENT packs — the reply lane is mail-only and this item has no thread',
      commit.eligible && commit.reason === 'no_mail_thread', commit.why);
    ok('   …and unknown features never pack (an unread fact is never a licence)',
      pastePackEligibility({ work: 'reply', itemKind: 'inbox', features: null }).eligible === false);
    const packSrc = src('lib/prepare/paste-pack.ts');
    ok('the predicate is PURE — zero IO, zero AI, and it reads the ONE registry + the ONE feature map',
      /@\/lib\/workspace\/tool-capabilities/.test(packSrc) && /CAPABILITY_MAP\[capability\]\?\.feature/.test(packSrc)
      && /from '@\/lib\/work\/surface-registry'/.test(packSrc)
      && !/getAIClient|aiCall\(|aiCreate/.test(packSrc.split('export async function preparePastePack')[0]));
    ok('THE ARTIFACT TRUTH rides the drafter (the pack may claim only what is staged)',
      /artifactTruth/.test(packSrc) && /instructions: \[/.test(packSrc));
    ok('   …through the SAME drafter, told honestly WHO OWES (a message about your own debt is never a chase)',
      /direction: args\.userOwes \? 'you' : 'them'/.test(packSrc)
      && /direction\?: 'them' \| 'you'/.test(src('lib/inbox/draft-reply.ts')));
    ok('THE PACK RIDES getPrepared as a PreparedArtifact — no consumer edited to see it',
      /kind: 'paste_pack'/.test(src('lib/prepare/read.ts')) && /meta\.pastePack/.test(src('lib/prepare/read.ts')));
    ok('   …and it is NEVER send-shaped (there is no door here that could fire)',
      /const SEND_KINDS = \['reply_draft', 'nudge_draft', 'invite', 'forward'\]/.test(src('lib/work/machine.ts')));
    ok('   …while the machine still reads it as finished work to review, never "preparing"',
      /p\.kind === 'deliverable' \|\| p\.kind === 'paste_pack'/.test(src('lib/work/machine.ts')));
    ok('ONE HOME for the pack (one pool task key, both item kinds)', PASTE_PACK_TASK === 'paste-pack');
    ok('the note SAYS where the words go and that nothing goes out from here',
      /copy them wherever/.test(pastePackNote('feature_off')) && /Nothing goes out from here/.test(pastePackNote('no_mail_thread')));
    ok('the card carries COPY and no other deed (no Send that could not fire)',
      /Copy/.test(src('components/prepared/paste-pack-card.tsx'))
      && !/Send|Approve/.test(src('components/prepared/paste-pack-card.tsx').split('export function PastePackCard')[1]));
    ok('the pass seats it BEFORE the commit-door lanes and speaks its outcomes apart',
      /pastePackEligibility/.test(src('lib/prepare/pass.ts'))
      && /could not write the words for this yet/.test(src('lib/prepare/pass.ts')));
  }

  // ── QL4 · PROPOSED SLOTS ──────────────────────────────────────────────────────────────────────
  console.log('\nQL4 · PROPOSED SLOTS — a timeless scheduling ask is offered real free room, in code');
  {
    const slotsSrc = src('lib/prepare/free-slots.ts');
    ok('the picker is PURE, deterministic and reaches no model',
      /export function pickFreeSlots\(/.test(slotsSrc)
      && !/getAIClient|aiCall\(|aiCreate/.test(slotsSrc));
    // A Friday: the next business days are Mon/Tue — Sat and Sun can never be proposed.
    const friday = '2026-09-18';
    const free = pickFreeSlots({ todayStr: friday, tz: 'UTC', busy: [], count: 3 });
    ok('three slots are proposed, on BUSINESS DAYS only, never today',
      free.length === 3
      && free.every((s) => { const d = new Date(s.startISO).getUTCDay(); return d !== 0 && d !== 6; })
      && free.every((s) => s.startISO.slice(0, 10) > friday), free.map((s) => s.startISO).join(' · '));
    ok('   …at the declared working hours, in the user\'s own zone',
      free.every((s) => (PROPOSAL_HOURS as readonly string[]).includes(s.startISO.slice(11, 16))));
    const busyStart = zonedTimeToUtc('2026-09-21', PROPOSAL_HOURS[0], 'UTC');
    const avoided = pickFreeSlots({
      todayStr: friday, tz: 'UTC', count: 1,
      busy: [{ startMs: busyStart, endMs: busyStart + 60 * 60_000 }],
    });
    ok('A BOOKED HOUR IS NEVER PROPOSED (free/busy is arithmetic, not a guess)',
      avoided.length === 1 && avoided[0].startISO !== new Date(busyStart).toISOString(), avoided[0]?.startISO);
    ok('   …and a zone is honoured rather than assumed (the clock law, both directions)',
      new Date(zonedTimeToUtc('2026-09-21', '10:00', 'America/New_York')).toISOString() === '2026-09-21T14:00:00.000Z');
    const pass = src('lib/prepare/pass.ts');
    ok('THE PASS FIRES IT — a grounded invite with no time gets the calendar\'s proposal',
      /if \(!invite\.startISO\) \{/.test(pass) && /proposeFreeSlots/.test(pass));
    ok('   …marked PROPOSED, so the card says the time is ours and the approve gate still holds',
      /invite\.proposed = true/.test(pass) && /free on your calendar/.test(pass));
  }
}


// ── AT12 · THE ENTRANCE — the Home arrives, it does not cut ─────────────────────────────────────
// Owner walk, Sep 18: "we're missing smooth animation/transition of the orb when home is loading.
// ideally orb only centered shapeshifting and then when home is loaded, transits into place — not
// instant new-page-load style." Motion cannot be asserted from a script, so what this gate holds is
// the STRUCTURE that makes the motion possible — and, more importantly, the structure that makes
// the old cut impossible: one orb node, one layout, a transform-only flight, and a choreography
// that is skipped on exactly the paints that already have their page.
function entranceGates() {
  console.log('\nAT12 · THE ENTRANCE — one orb, one layout, a measured FLIP');
  const home = src('components/home/home-view.tsx');
  const orb = src('components/home/orb-entrance.tsx');
  const mark = src('components/home/alive-mark.tsx');

  // 1 · ONE ORB, ONE MOUNT. A second <AliveMark> is a second canvas with its own rAF clock; the
  //     swap is the visible restart this whole arc exists to remove. The mark is mounted in ONE
  //     place platform-wide — the entrance's seat — and the Home names it nowhere else.
  ok('ONE ORB, ONE MOUNT — the mark is mounted only by the entrance seat, once',
    (orb.match(/<AliveMark\b/g) ?? []).length === 1
    && !/<AliveMark\b/.test(home)
    && (home.match(/<OrbSeat\b/g) ?? []).length === 1
    && /import \{ OrbSeat, useOrbEntrance/.test(home));
  ok('   …and the second layout it used to swap for is GONE (no skeleton early-return)',
    !/if \(loading\) \{\s*\n\s*return \(/.test(home)
    && !/h-\[52px\] rounded-2xl border border-neutral-200\/70 bg-white\/60 animate-pulse/.test(home)
    && !/\[0, 1, 2, 3, 4\]\.map/.test(home));

  // 2 · TRANSFORM ONLY. A FLIP that animates width/height/top/left re-lays-out every frame and
  //     would resize the canvas under the animation. The flight writes `transform` and nothing else.
  ok('THE FLIGHT IS TRANSFORM-ONLY — nothing that re-lays-out is ever animated',
    /fly\.style\.transform = `translate3d\(/.test(orb)
    && /transition = `transform \$\{FLIGHT_MS\}ms \$\{EASE\}`/.test(orb)
    && !/transition: (width|height|top|left)/.test(orb)
    && !/fly\.style\.(width|height|top|left|marginTop|marginLeft) =/.test(orb));
  ok('   …and it is MEASURED, not a hand-tuned offset (first rect vs the seat\'s own last rect)',
    /seat\.getBoundingClientRect\(\)/.test(orb)
    && /\[data-home-column\]/.test(orb) && /data-home-column/.test(home)
    && /const dx = cx - \(r\.left \+ r\.width \/ 2\);/.test(orb)
    && /useLayoutEffect\(/.test(orb));
  ok('   …the seat never moves in the DOM — only the wrapper inside it is transformed',
    /ref=\{entrance\.seatRef\}/.test(orb) && /ref=\{entrance\.flyRef\}/.test(orb)
    && /className=\{`absolute inset-0 /.test(orb.slice(orb.indexOf('export function OrbSeat'))));

  // 3 · IT PLAYS ONLY WHEN THERE WAS GENUINELY NOTHING TO SHOW. The flag is the SAME cache verdict
  //     the skeleton state derived from, and a module latch keeps a soft-nav return from replaying.
  ok('A WARM PAINT SKIPS IT — the flag is the same cache read the skeleton state derived from',
    /coldStartRef\.current = !loadLS<Brief>\('aug-home-brief-v1', \{ maxAgeMs: 15 \* 60_000 \}\)/.test(home)
    && /useOrbEntrance\(loading, coldStartRef\)/.test(home)
    && /coldRef\.current !== true/.test(orb));
  ok('   …and a back/soft-nav return never replays it (a module-level latch)',
    /let entrancePlayed = false;/.test(orb) && /entrancePlayed = true;/.test(orb)
    && /if \(reduced \|\| entrancePlayed \|\| coldRef\.current !== true\) \{ setPhase\('done'\); return; \}/.test(orb));

  // 4 · MOTION IS A REQUEST. Reduced motion takes the same door as a warm paint: straight to rest,
  //     no transform written, no veil applied — and the mark's own static-frame floor still stands.
  ok('MOTION IS A REQUEST — reduced motion skips the choreography entirely',
    /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(orb)
    && /const reduced = /.test(orb)
    && /if \(reduced \|\| entrancePlayed/.test(orb)
    && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(mark));

  // 5 · THE VEIL IS OPACITY AND TRANSFORM. Anything else (display, visibility, height) would either
  //     reflow on landing or make the measured "last" rect a lie while the page is cold.
  ok('THE STAGGER TOUCHES OPACITY AND TRANSFORM ONLY — the layout is final while it is veiled',
    (() => {
      const v = orb.slice(orb.indexOf('const veil = useCallback('), orb.indexOf('return { phase, seatRef'));
      return /opacity: 0, transform: 'translateY\(8px\)'/.test(v)
        && /transition: `opacity \$\{VEIL_MS\}ms \$\{EASE\} \$\{delay\}ms, transform \$\{VEIL_MS\}ms \$\{EASE\} \$\{delay\}ms`/.test(v)
        && !/display|visibility|height|margin/.test(v)
        // …and at rest it claims nothing at all, so a warm page carries no entrance styling
        && /if \(phase === 'done'\) return \{\};/.test(v);
    })());
  ok('   …applied in the board\'s own order — greeting → composer → rows → day frame',
    (() => {
      const g = home.indexOf('entrance.veil(0)');
      const c = home.indexOf('entrance.veil(1)');
      const r = home.indexOf('entrance.veil(2)');
      const d = home.indexOf('entrance.veil(3)');
      return g > 0 && c > g && r > c && d > r
        && /const STEP_MS = 50;/.test(orb);
    })());

  // 6 · THE HONEST CEILING. The skeleton used to stand forever when the brief never landed (the
  //     loader's catch never clears `loading`). A veiled page must never inherit that.
  ok('THE HONEST CEILING — a brief that never lands still lets the page in',
    /const COLD_CEILING_MS = /.test(orb)
    && /setTimeout\(\(\) => setPhase\('flying'\), COLD_CEILING_MS\)/.test(orb));
}

/** THE PROOF-OF-LIFE LANE ON A REAL ACCOUNT — a DRY read. It reports what WOULD be asked; it writes
 *  nothing and judges nothing (the lane's own `apply` default is the floor). */
async function proofOfLifeDryRead(label: string, userId: string) {
  console.log(`\nQL1 · THE LANE, DRY — ${label}`);
  const { buildWorkItems } = await import('../lib/work-items/model');
  const { judgmentCandidates, judgmentKeyOf } = await import('../lib/prepare/pass');
  const { readStandingVerdicts, readProofStamps } = await import('../lib/work/proof-of-life');
  const items = await buildWorkItems(sb as any, userId, { todayStr: TODAY, skipReconcile: true });
  const cands = judgmentCandidates(items);
  const [verdicts, stamps] = await Promise.all([readStandingVerdicts(sb as any, userId), readProofStamps(sb as any, userId)]);
  const r = await runProofOfLifeLane(sb as any, userId, cands.map((w) => {
    const key = judgmentKeyOf(w);
    return { key, work: verdicts.get(key) ?? null, activityAt: w.at || w.startAt || null, askedAt: stamps.get(key) ?? null };
  }), { apply: false });
  console.log(`     ${cands.length} actionable candidates · ${r.eligible} would be asked (cap ${PROOF_OF_LIFE_CAP} → ${Math.min(r.eligible, PROOF_OF_LIFE_CAP)} this run · ${r.leftBehind} left behind)`);
  console.log(`     quietest: ${r.quietestDays} days`);
  ok('a dry read asks NOTHING and judges nothing', r.dryRun === true && r.checked === 0 && r.failed === 0);
  ok('   …and every candidate is genuinely past the silence window',
    r.quietestDays === 0 || r.quietestDays >= PROOF_OF_LIFE_DAYS, `quietest ${r.quietestDays}d`);
}

/** THE LANE ON A REAL ACCOUNT — a DRY read only. It reports what WOULD file; it writes nothing. */
async function graduationDryRead(label: string, userId: string) {
  console.log(`\nAQ3 · THE LANE, DRY — ${label}`);
  const { runGraduationLane } = await import('../lib/work/graduation');
  const r = await runGraduationLane(sb as any, userId, { apply: false });
  console.log(`     would file ${r.eligible} (cap ${GRADUATION_CAP} → ${Math.min(r.eligible, GRADUATION_CAP)} this run · ${r.leftBehind} left behind)`);
  console.log(`     by class: ${Object.entries(r.byClass).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}`);
  console.log(`     oldest quiet: ${r.oldestQuietDays} days`);
  ok('a dry read files NOTHING', r.dryRun === true && r.filed === 0 && r.failed === 0);
  ok('   …and every candidate belongs to a graduating class',
    Object.keys(r.byClass).every((c) => GRADUATING_CLASSES.has(c as HeldClassId)),
    Object.keys(r.byClass).join(', '));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AS · THE SEPTEMBER-18 WALK (two live regressions + the owner's four card/ledger finds).
//   AS1 · A DEEP LINK TO A LENS ALWAYS OPENS THAT LENS — the URL is the authority, the lens has ONE
//         reader, an arrival-time event can never exit it, and the ledger holds no auto-exit path.
//   AS2 · THE DOOR ALWAYS RENDERS — the ledger's one entrance is a property of the dashboard lens,
//         not of the data; and an anchored row renders exactly once, under its meeting.
//   AS3 · THE DECK OPENS ON WHAT IS ALREADY HELD — the Home's own served held rows, and a ledger
//         last-good primed by the read the brief already paid for.
//   AS4 · THE WORDS AND THE CARD — no 'done' outside the verb, the card says who/why/kind/excerpt,
//         and the four arrow verbs are laid out as the arrow keys.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function walkGates() {
  const home = src('components/home/home-view.tsx');
  const held = src('components/home/held-quiet.tsx');
  const deck = src('components/triage/triage-deck.tsx');
  const words = src('lib/triage/words.ts');
  const brief = src('app/api/home/brief/route.ts');
  const heldRoute = src('app/api/home/held/route.ts');
  const cache = src('lib/deeds/held-cache.ts');
  const calm = src('lib/home/calm.ts');

  console.log('\nAS0 · THE ROW SAYS WHERE THE WORK LIVES');
  {
    // Owner walk, Sep 18: the tracked project was SERVED on every deck row (the brief route's
    // tagByAtom, tracked-only) and the whispered line printed none of it — five rows, no way to tell
    // which body of work any of them belonged to.
    ok('the whisper carries its row\'s project, worded in ONE place (never a second derivation)',
      /export function whisperProject\(item: DoItem, sentence: string\): string \| null \{/.test(calm)
      && /project: whisperProject\(item, sentence\),/.test(calm)
      && /project: string \| null;/.test(calm));
    ok('   …SERVED, never guessed — the row\'s own initiative field is the only source',
      /const name = \(item\.initiative \?\? ''\)\.trim\(\);/.test(calm)
      && /if \(!name\) return null;/.test(calm));
    ok('   …and never said twice (the same significant-token test the who obeys)',
      /if \(bodyNames\(sentence, name\)\) return null;/.test(calm)
      && /function bodyNames\(body: string, name: string\): boolean \{/.test(calm));
    {
      const { toWhisper } = require('../lib/home/calm') as typeof import('../lib/home/calm');
      const row = (o: Record<string, unknown>) => ({
        source: 'commitment', key: 'k', entityId: 'e', href: '/item/e',
        primary: null, ask: 'Send the signed contract', second: null, ...o,
      } as never);
      ok('   …exercised: a filed row names its project, a loose row names none, a self-naming line stays bare',
        toWhisper(row({ initiative: 'Northwind rollout' })).project === 'Northwind rollout'
        && toWhisper(row({})).project === null
        && toWhisper(row({ initiative: 'Northwind rollout', ask: 'Send Northwind the signed contract' })).project === null);
    }
    ok('the row renders it LAST and MUTED — a reference inside the one truncating line, never a chip',
      /\{w\.project && <span className="text-neutral-400"> · \{w\.project\}<\/span>\}/.test(home)
      && (() => {
        const i = home.indexOf('function WhisperLine');
        const seg = home.slice(i, i + 4000);
        return seg.indexOf('{w.project &&') > 0
          && seg.indexOf('{w.sentence}') < seg.indexOf('{w.project &&')
          && seg.indexOf('{whyNow ?') < seg.indexOf('{w.project &&')
          && /min-w-0 flex-1 truncate text-\[13px\]/.test(seg);
      })());
  }

  console.log('\nAS1 · THE DEEP LINK ALWAYS OPENS THE LENS');
  {
    // ONE READER. Three hand-written `v === 'timeline' || …` chains were three chances to forget a
    // lens; the reader is now one function and one list.
    ok('the URL is read through ONE reader, over ONE list of lenses',
      /const LENSES = \['timeline', 'projects', 'conversations', 'workflows', 'runs', 'held'\] as const;/.test(home)
      && /function lensInSearch\(search: string\): HomeViewLens \| null/.test(home)
      && !/v === 'timeline' \|\| v === 'projects'/.test(home));
    ok('   …before the first paint, so a deep link never flashes the dashboard first',
      /useLayoutEffect\(\(\) => \{ const v = lensInSearch\(window\.location\.search\); if \(v\) setViewState\(v\); \}, \[\]\);/.test(home));
    ok('   …and a real navigation re-asserts it (the room-door law, unchanged)',
      /const v = searchParams\.get\('view'\);[\s\S]{0,120}setViewState\(v as HomeViewLens\)/.test(home));
    // THE ARRIVAL IS NOT A DEED. An event fired while the mount is still arriving (a one-shot
    // cross-page intent, a hydration re-dispatch, a hot reload) must never rewrite ?view= away.
    ok('a reset that arrives BEFORE the lens has painted cannot exit it',
      /const resetArmedRef = useRef\(false\);/.test(home)
      && /requestAnimationFrame\(\(\) => \{ resetArmedRef\.current = true; \}\)/.test(home)
      && /if \(!resetArmedRef\.current && lensInSearch\(window\.location\.search\)\) return;/.test(home));
    // …and the lens itself never walks out on its own: Esc is session-local and un-stored.
    // RE-POINTED (Sep 21 — CLOSE RETURNS WHERE YOU CAME FROM). The law is unchanged: the lens never
    // walks out on its own. What changed is where a reader's OWN close lands — the deck's Close is
    // routed by the RECORDED ORIGIN, and that is still a deed, never an effect. So: no effect may
    // call onBack, and the only call site in the file is the origin branch of the deck's exit.
    ok('the ledger holds NO auto-exit path (onBack is the reader\'s click, never an effect)',
      !/useEffect\([^)]*onBack/.test(held)
      && (held.replace(/onClick=\{onBack\}/g, '').match(/onBack\(\)/g) ?? []).length === 1
      && /if \(closeReturnsHome\) \{ onBack\(\); return; \}/.test(held)
      && /const \[exited, setExited\] = useState\(false\);/.test(held));
    // ── THE NEW LAW (Sep 21): CLOSE RETURNS WHERE YOU CAME FROM ───────────────────────────────
    // The Home's door opens INTO the deck, so Close (and Esc) there means "back to the Home" — it
    // used to leave the reader on the held LIST, a page they never asked for. The origin is
    // RECORDED at the door, never inferred from history length, and an address that names the lens
    // is not a door: a deep link's Close stays on the address it asked for.
    ok('the deck\'s close consults a RECORDED origin, and the Home\'s door is what records it',
      /const \[heldFromHome, setHeldFromHome\] = useState\(false\);/.test(home)
      && /setHeldFromHome\(true\); setView\('held'\);/.test(home)
      && /fromHome=\{heldFromHome\}/.test(home)
      && /const closeReturnsHome = fromHome && !deckFromList;/.test(held));
    ok('   …an address that names the lens is NOT the Home\'s door (a deep link closes onto itself)',
      /setHeldFromHome\(false\);/.test(home)
      && (home.match(/setHeldFromHome\(true\)/g) ?? []).length === 1);
    ok('   …and choosing the cards FROM the ledger re-homes the way out to the ledger',
      /if \(s === 'deck'\) setDeckFromList\(true\);/.test(held)
      && /const \[deckFromList, setDeckFromList\] = useState\(false\);/.test(held));
    ok('   …while "View as list" and the page\'s own ← Home line are unchanged',
      /onViewAsList=\{\(\) => chooseShape\('list'\)\}/.test(held)
      && /<button onClick=\{onBack\}/.test(held));
    ok('   …and the deck\'s exit is never persisted (no store ever holds `exited`)',
      !/saveLS\([^)]*exited|sessionStorage\.setItem\([^)]*exit/i.test(held)
      && /VIEW_KEY = 'aug-triage-view-v1'/.test(held));
  }

  console.log('\nAS2 · THE DOOR ALWAYS RENDERS · ONE ROW, ONE HOME');
  {
    ok('the door is a property of the LENS, not of the data (no `!nothing` gate on the block)',
      /\{view === 'dashboard' && !chatActive && !projectDetailOpen && \(\s*\n\s*<div style=\{entrance\.veil\(2\)\}/.test(home));
    ok('   …and the door component can no longer return null on three zeroes',
      !/if \(waiting <= 0 && handledQuietly <= 0 && handledToday <= 0\) return null;/.test(home)
      && /waiting: number \| null;/.test(home)
      && /When you're ready →/.test(home));
    ok('   …a count it does not have is not spoken (and never rendered as a zero)',
      /typeof waiting === 'number' && waiting > 0 \? `When you're ready · \$\{waiting\} →`/.test(home));
    ok('a Home with no brief yet says so, rather than reading as an empty day',
      /Reading your day…/.test(home));
    // THE DAY ANCHOR'S OTHER HALF — the serve's stated contract, now actually enforced here.
    ok('an anchored row is EXCLUDED from the floating whispers (it renders under its meeting)',
      /const anchoredIds = new Set\(\s*\n?\s*served\.filter\(\(s\) => !!s\.anchoredToEventId\)\.map\(\(s\) => s\.entityId\),\s*\n?\s*\);/.test(home)
      && /!heldBackIds\.has\(i\.entityId\) && !anchoredIds\.has\(i\.entityId\)/.test(home));
    ok('   …and it is not in the door\'s remainder either (one row, one home, one count)',
      /!whisperKeys\.has\(r\.item\.key\) && !anchoredIds\.has\(r\.item\.entityId\)/.test(home));
    ok('   …the field it reads is the one the serve states',
      /anchoredToEventId\?: string \| null \}>/.test(home)
      && /anchoredToEventId: r\.anchoredToEventId \?\? null/.test(brief));
    ok('the freed seats are re-filled from the SERVED held rows (the list never shrinks for this)',
      /const NEXT_UP_MAX = Math\.max\(0, CALM_MAX_WHISPERS - whispers\.length\);/.test(home));
  }

  console.log('\nAS3 · THE DECK OPENS ON WHAT THE CLIENT ALREADY HOLDS');
  {
    ok('the Home hands the ledger its own served held rows, in the server\'s order',
      /const warmHeldRows: DeckHeldRow\[\] = \(b\?\.attention\?\.heldBack \?\? \[\]\)/.test(home)
      && /\.map\(\(id\) => itemByAtom\.get\(id\)\)/.test(home)
      && /warmHeld=\{warmHeldRows\}/.test(home));
    ok('   …from the brief the Home hydrates off the stamped cache before its first paint',
      /loadLS<Brief>\('aug-home-brief-v1', \{ maxAgeMs: 15 \* 60_000 \}\)/.test(home));
    ok('   …capped: this is the opening of a stack, not a second account of one',
      /const WARM_DECK_MAX = 12;/.test(home) && /\.slice\(0, WARM_DECK_MAX\)/.test(home));
    ok('   …and the ledger EXTENDS that stack in place (append-only, nothing re-ordered)',
      /const waitingRows = deckMode \? mergeQueue\(queueRef\.current, incomingRows\) : incomingRows;/.test(held));
    ok('the deck\'s day is SERVED either way — the ledger\'s, else the brief\'s',
      /const deckDay = ledger\?\.today \?\? servedDay \?\? null;/.test(held)
      && /today: todayStr/.test(brief)
      && !/new Date\(\)/.test(src('lib/triage/words.ts')));
    ok('"Reading the account…" is only said when there is genuinely nothing in hand',
      /\) : handed\.length === 0 \? \(\s*\n?\s*<p[^>]*>Reading the account…<\/p>/.test(held));
    // THE PRIME — one derivation, one shape, one writer, and never in the reader's path.
    ok('the brief PRIMES the ledger\'s last-good from the read it already paid for',
      /derived: c\.derived/.test(brief)
      && /buildHeldPayload\(c\.derived, todayStr, \{ filedThisMonth \}\)/.test(brief)
      && /storeHeldCache\(supabase as never, user\.id/.test(brief));
    ok('   …in after\(\), never synchronously (a failed prime is a slower door, never a failed one)',
      /after\(async \(\) => \{[\s\S]{0,600}storeHeldCache\(/.test(brief));
    ok('   …through the SAME shape and the SAME writer the ledger route uses',
      /import \{ HELD_CACHE_KIND, HELD_CACHE_MS, HELD_CACHE_MAX_MS, buildHeldPayload, storeHeldCache \} from '@\/lib\/deeds\/held-cache'/.test(heldRoute)
      && /export function buildHeldPayload/.test(cache) && /export async function storeHeldCache/.test(cache)
      && !/const HELD_CACHE_KIND = 'held_cache';/.test(heldRoute));
    ok('   …and a stored payload never speaks a day it did not compute against',
      /const served = \{ \.\.\.cachedPayload, today: todayISO, cachedAgeMs: age \};/.test(heldRoute));
  }

  console.log('\nAS4 · THE WORDS AND THE CARD');
  {
    // (RE-POINTED for Q9v2: the hints line gained L and traded "skip" for its honest name, "keep".
    //  The law is unchanged and still asserted — the exit is Close, and "done" is the verb's word.)
    ok('the way out is "Close" — the word "done" belongs to the verb alone',
      /export const TRIAGE_EXIT_LABEL = 'Close';/.test(words)
      && /export const TRIAGE_HINTS = 'L later · space keep · Z undo · esc close';/.test(words)
      && !/Done for now/.test(deck) && !/esc done/.test(deck)
      && /<span>\{TRIAGE_EXIT_LABEL\}<\/span>/.test(deck));
    // (RE-POINTED, STRICTLY STRONGER: the card now leads with an avatar and carries the thread's
    //  own tail where one exists — the served excerpt is the floor beneath it, never the ceiling.)
    ok('the card says WHO, what KIND, why held, and the message\'s own words',
      /\{row\.who && <span className="truncate text-\[13px\] font-medium text-neutral-800">\{row\.who\}<\/span>\}/.test(deck)
      && /\{sourceWord && <span>\{sourceWord\}<\/span>\}/.test(deck)
      && /\{row\.why && <p/.test(deck)
      && /threaded && tail && tail\.length > 0 \?/.test(deck)
      && /\) : row\.excerpt \? \(/.test(deck));
    ok('   …the kind comes from ONE table, and an unmapped source says nothing',
      /export const TRIAGE_SOURCE_WORD: Record<string, string>/.test(words)
      && /const sourceWord = TRIAGE_SOURCE_WORD\[row\.item\.source\] \?\? null;/.test(deck));
    ok('   …a prepared WORD is a chip, never a promise of a renderer',
      /const chip = row\.preparedWord \?\?/.test(deck)
      && /\{chip && \(/.test(deck)
      && /preparedWord\?: string \| null;/.test(deck));
    // RE-POINTED Sep 18 (THE ROW LEADS WITH WHO): the handed `who` was `it.primary`, which is null
    // for every lane with no sender — a handed commitment reached the lens anonymous. It is now the
    // ONE served reading (lib/home/calm.ts `servedWho`: the sender, else the real counterparty,
    // never a source label), so the ledger's who and the whisper's lead are the same fact. The law
    // is unchanged and strictly better served: the Home HANDS the facts, the lens fetches nothing.
    ok('   …and the Home hands those facts over rather than the lens fetching them',
      /who\?: string \| null;/.test(held) && /preparedWord\?: string \| null;/.test(held)
      && /who: servedWho\(it\),/.test(home)
      && /import \{[^}]*servedWho[^}]*\} from '@\/lib\/home\/calm';/.test(home));
    // THE CLUSTER — RE-POINTED to Q9v2 (the afternoon of the same walk), and AGAIN Sep 21 (owner:
    // "CTA buttons should be below?"). The inverted-T of four arrow key-caps INSIDE the card was
    // the shape the owner first called hard to follow: the verbs live in the FRAME — now BELOW the
    // stack — as two large pills with two quiet companions. The law that survives verbatim is the
    // one this gate was always about: the component types no label, key or order; the table owns
    // them, and the card holds none of them. (The structural half lives in smoke-quality SQ19.)
    ok('the two clearing verbs are large pills BELOW the card, the companions quiet beneath them',
      deck.indexOf('THE PILL BAR — BELOW THE CARD') > deck.indexOf('THE STACK, PEEKING')
      && /\{primary\.map\(\(v\) => \(\s*\n\s*<PrimaryPill/.test(deck)
      && /<QuietPill v=\{verbOf\('keep'\)\}[\s\S]{0,400}<QuietPill v=\{verbOf\('open'\)\}[\s\S]{0,400}<QuietPill v=\{verbOf\('later'\)\}/.test(deck));
    ok('   …each a real target, plain-worded, coloured only on hover',
      /min-h-\[44px\]/.test(deck) && /min-h-\[32px\]/.test(deck)
      && /hover:border-neutral-300 hover:text-neutral-900/.test(deck));
    ok('   …and nothing verb-shaped is left inside the card',
      (() => {
        const a = deck.indexOf('function TriageCard(');
        const b = deck.indexOf('function TriageStation(');
        return a > 0 && b > a && !/PrimaryPill|QuietPill|verbOf\(/.test(deck.slice(a, b));
      })());
    ok('   …the hints ride furthest right, smaller',
      /ml-auto pl-2 text-\[11px\] text-neutral-300">\{TRIAGE_HINTS\}/.test(deck));
    ok('   …and no label, key or order is typed in the component (the table owns them)',
      /const verbOf = \(verb: TriageVerb\): \(typeof TRIAGE_VERBS\)\[number\] =>/.test(deck)
      && !/>Done<\/span>/.test(deck) && !/>Later<\/span>/.test(deck));
  }
}

async function main() {
  await dayFrameGates();
  await anchorGates();
  walkGates();
  qualityGates();
  preparationGates();
  entranceGates();
  const probe = await resolveProbeUser(sb);
  await auditAccount('the probe host', probe);
  const { data: profs } = await sb.from('profiles').select('id').limit(500);
  await graduationDryRead('the probe host', probe);
  const ref = (profs ?? []).map((p) => p.id as string).find((id) => id.startsWith(REFERENCE_PREFIX));
  if (ref) {
    await auditAccount('the reference account (read-only)', ref);
    await graduationDryRead('the reference account (read-only)', ref);
    await proofOfLifeDryRead('the reference account (read-only)', ref);
  } else console.log('\nAT6 · reference account not present in this database — skipped');

  console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-attention: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
