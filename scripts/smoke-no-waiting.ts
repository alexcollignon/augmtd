// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — NO WAITING (stabilization W17 · law `no-waiting`: "first paint carries what is known; a slot
// still being made is reserved, never a pop").
//
// ZERO AI · ZERO DB · ZERO NETWORK (fetch is stubbed where a client module is exercised).
//
// THE OWNER'S CASE (Sep 24): a transcription-consent email whose ONE action widget is a decision
// (Consent / Decline / Leave it with me). The page painted without it and the widget popped in later:
// the view read chose the widget (the machine state) but its routes came from GET /api/items/judge,
// fired only after the view read settled. Held here, as a class, for every item kind:
//   A · the view payload carries the action widget's own words where they are known server-side
//       (the cached verdict, narrowed; the prepared draft/nudge; the decision's routes) — pure, over
//       served payload fixtures for every kind, plus the door's own source.
//   B · no request on the item page waits on another it does not need data from: the judge starts
//       beside the view; only the email door's draft-on-open waits on the view (it needs its answer to
//       know whether to buy a draft); the follow-up's nudge door asks only when the stage is summoned;
//       the hover warm fires the view AND the object read in the same beat (stubbed fetch).
//   C · a widget still being made paints as THE PREPARING SLOT, in its own shape, in the seat the
//       widget will take — urgent (< 1s cycle), reduced-motion honoured, no spinner — and the landing
//       widget takes the same seat (the no-mutation law's slot rule agrees).
//   D · the decision card never renders the filler line, and never repeats the subject as its title.
//   E · the law is registered with this gate and names its collision with no-mutation.
// Run: npx tsx scripts/smoke-no-waiting.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { servedVerdictOf, relevanceOfWork, REPLY_WORKS } from '../lib/room/served-verdict';
import { decisionSpecOf, decisionTitleOf } from '../lib/room/decision-object';
import {
  composeItemPage, itemPageItems, ITEM_ACTION_WIDGETS, WIDGET_OF_ARTIFACT,
  type ItemArtifactsMounted, type ItemPageFacts,
} from '../components/thread/item-page';
import { ThreadTimeline } from '../components/thread/thread-timeline';
import { PreparingSlot, preparingLineOf, PREPARING_WORDS, PREPARING_CYCLE_MS, PREPARING_PULSE } from '../components/thread/preparing-slot';
import { mayFillSlot, mayReplaceInPlace } from '../lib/room/no-mutation';

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
const gate = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const VIEW = 'app/api/items/view/route.ts';
const DETAIL = 'components/home/item-detail.tsx';
const RAIL = 'components/home/item-rail.tsx';
const WARM = 'lib/room/warm-client.ts';

// ── FIXTURES — the judgment rows as stored, and the payloads the view serves (generic names only) ──
const STORED_DECIDE = { verdict: {
  work: 'decide', component: 'decision', executor: { kind: 'user' }, gate: null,
  reason: 'Direction you_owe with the sender asking for consent — internal reasoning, never shown.',
  options: [{ label: 'Consent to transcription' }, { label: 'Decline transcription' }],
} };
const SUBJECT = 'Re: Consent to record and transcribe our call';

async function main() {
  // ═══ A · THE FIRST PAINT CARRIES WHAT IS KNOWN ═══
  console.log('\nA · the view payload carries the action widget\'s own words');
  {
    const v = servedVerdictOf(STORED_DECIDE);
    gate('A1 pure: the stored judgment narrows to verb · component · executor · option labels',
      !!v && v.work === 'decide' && v.component === 'decision' && v.executor.kind === 'user'
      && JSON.stringify(v.options) === JSON.stringify([{ label: 'Consent to transcription' }, { label: 'Decline transcription' }]));
    gate('A2 pure: the judge\'s private reason never ships (NO INTERNAL TEXT ON SCREEN)',
      !!v && !('reason' in v) && !JSON.stringify(v).includes('internal reasoning'));
    gate('A3 pure: a malformed or absent judgment serves nothing — a doubt never invents a verdict',
      servedVerdictOf(null) === null && servedVerdictOf({}) === null && servedVerdictOf({ verdict: { work: '' } }) === null
      && servedVerdictOf('x') === null);
    gate('A4 pure: the palette lead follows the verb (none → awareness · reply/send_file → reply · else action)',
      relevanceOfWork('none') === 'awareness' && relevanceOfWork('reply') === 'reply' && relevanceOfWork('send_file') === 'reply'
      && relevanceOfWork('decide') === 'action' && relevanceOfWork(null) === null && REPLY_WORKS.has('reply') && !REPLY_WORKS.has('decide'));

    // THE OWNER'S CASE, from the served payload ALONE: the decision's routes are on the first paint.
    const emailView = { verdict: v, prepared: [] as never[], machineState: { state: 'awaiting_decision' } };
    const spec = decisionSpecOf({ verdict: emailView.verdict, prepared: emailView.prepared }, [SUBJECT]);
    gate('A5 pure (email · the consent case): the decision resolves from the view payload alone — both routes, no second request',
      !!spec && spec.options.map((o) => o.label).join(' | ') === 'Consent to transcription | Decline transcription');
    const commitSpec = decisionSpecOf({
      verdict: { work: 'decide' },
      prepared: [{ id: 'd1', kind: 'deliverable', title: 'Which venue', content: '',
        decision: { options: [{ label: 'Book the larger room', tradeoff: 'Costs more' }, { label: 'Keep the usual room' }], recommendation: 'Keep the usual room', why: 'Fits the headcount' } }],
    }, ['Confirm the venue with Acme']);
    gate('A6 pure (commitment): the DECISION BRIEF\'s routes (with trade-offs) supersede the verdict\'s bare labels — from the payload alone',
      !!commitSpec && commitSpec.options.length === 2 && commitSpec.options[0].tradeoff === 'Costs more'
      && commitSpec.recommendation?.label === 'Keep the usual room' && commitSpec.title === 'Which venue');
    gate('A7 pure: not a decision, or fewer than two routes → no decision (never a hollow card)',
      decisionSpecOf({ verdict: { work: 'reply' }, prepared: [] }, []) === null
      && decisionSpecOf({ verdict: { work: 'decide', options: [{ label: 'Only one' }] }, prepared: [] }, []) === null
      && decisionSpecOf({ verdict: null, prepared: [] }, []) === null);

    // EVERY KIND: the widget the page's table picks is resolvable from the served payload — the words
    // it renders ride the same read (a draft's body, a nudge's body, the invite, the confirm line).
    type Payload = { verdict: ReturnType<typeof servedVerdictOf>; machineState: { state: string; line?: string; eventId?: string } | null; prepared: Array<{ kind: string; content: string; invite?: { withCounterparty?: boolean } }> };
    const cases: Array<{ kind: string; view: Payload; expect: string | null; words: (p: Payload) => boolean }> = [
      { kind: 'email · reply ready', expect: 'email', view: { verdict: servedVerdictOf({ verdict: { work: 'reply' } }), machineState: { state: 'awaiting_approval' }, prepared: [{ kind: 'reply_draft', content: 'Hi Sam, yes — go ahead.' }] },
        words: (p) => !!p.prepared.find((a) => a.kind === 'reply_draft')?.content },
      { kind: 'email · decision', expect: 'decision', view: { verdict: servedVerdictOf(STORED_DECIDE), machineState: { state: 'awaiting_decision' }, prepared: [] },
        words: (p) => !!decisionSpecOf({ verdict: p.verdict, prepared: p.prepared as never }, []) },
      { kind: 'invite', expect: 'invite', view: { verdict: servedVerdictOf({ verdict: { work: 'schedule' } }), machineState: { state: 'awaiting_approval' }, prepared: [{ kind: 'invite', content: 'Call next week', invite: { withCounterparty: true } }] },
        words: (p) => p.prepared.some((a) => a.kind === 'invite') },
      { kind: 'commitment · nudge', expect: 'email', view: { verdict: servedVerdictOf({ verdict: { work: 'chase' } }), machineState: { state: 'awaiting_approval' }, prepared: [{ kind: 'nudge_draft', content: 'Hi Acme, checking in on the report.' }] },
        words: (p) => !!p.prepared.find((a) => a.kind === 'nudge_draft')?.content },
      { kind: 'follow-up · nudge', expect: 'email', view: { verdict: servedVerdictOf({ verdict: { work: 'chase' } }), machineState: { state: 'awaiting_approval' }, prepared: [{ kind: 'nudge_draft', content: 'Hi Sam, any news on pricing?' }] },
        words: (p) => !!p.prepared.find((a) => a.kind === 'nudge_draft')?.content },
      { kind: 'deliverable', expect: 'deliverable', view: { verdict: servedVerdictOf({ verdict: { work: 'produce' } }), machineState: { state: 'ready' }, prepared: [{ kind: 'deliverable', content: 'The quarterly summary, three sections.' }] },
        words: (p) => p.prepared.some((a) => a.kind === 'deliverable' && !!a.content) },
      { kind: 'looks done', expect: 'confirm', view: { verdict: servedVerdictOf({ verdict: { work: 'reply' } }), machineState: { state: 'looks_done', line: 'You replied on Sep 23' }, prepared: [] },
        words: (p) => !!p.machineState?.line },
      { kind: 'booked meeting', expect: 'event', view: { verdict: servedVerdictOf({ verdict: { work: 'schedule' } }), machineState: { state: 'scheduled', eventId: 'ev-1' }, prepared: [] },
        words: (p) => !!p.machineState?.eventId },
      { kind: 'meeting (no machine)', expect: null, view: { verdict: null, machineState: null, prepared: [] }, words: () => true },
    ];
    const mountedOf = (p: Payload): ItemArtifactsMounted => {
      const m: ItemArtifactsMounted = {};
      for (const a of p.prepared) if (a.content) (m as Record<string, boolean>)[a.kind] = true;
      if (decisionSpecOf({ verdict: p.verdict, prepared: p.prepared as never }, [])) m.decision = true;
      if (p.machineState?.state === 'looks_done') m.looks_done = true;
      if (p.machineState?.eventId) m.booked_event = true;
      return m;
    };
    const misses = cases.filter((c) => {
      const plan = composeItemPage({ machine: c.view.machineState, mounted: mountedOf(c.view), brief: null, who: 'Sam', ask: null, title: null, source: 'source' });
      return plan.action !== c.expect || !c.words(c.view) || plan.pending !== null;
    }).map((c) => c.kind);
    gate(`A8 pure: for ${cases.length} kind × state payloads the page's ONE widget and its words resolve from the view read alone`, misses.length === 0, misses.join(', '));

    const view = code(VIEW);
    const w1 = view.indexOf('await Promise.all([planP, prepP, linkP, anyVerdictP, itemRowP])');
    gate('A9 the view door STARTS the cached-judgment read beside wave 1 (never after it) and narrows it through servedVerdictOf',
      /const judgmentP = /.test(view) && view.indexOf('const judgmentP = ') > 0 && view.indexOf('const judgmentP = ') < w1
      && /readPlan\(supabase, user\.id, 'judgment',/.test(view) && /servedVerdictOf\(row\?\.tasks \?\? null\)/.test(view));
    gate('A10 …and serves it on the payload, with the phase marks as a Server-Timing header',
      /\n\s*verdict,\n/.test(view) && /'Server-Timing': serverTimingOf\(marks\)/.test(view) && /mark\('total'\)/.test(view));
    const detail = code(DETAIL);
    gate('A11 both item doors paint the view\'s verdict and derive the decision through the ONE shared derivation',
      (detail.match(/verdictState \?\? view\?\.verdict \?\? null/g) ?? []).length === 2
      && (detail.match(/decisionSpecOf\(\{ verdict, prepared: view\?\.prepared \?\? null \}/g) ?? []).length === 2
      && !/resolveDecisionObject\(/.test(detail));
    gate('A12 the email door seeds the reply card from the view\'s live draft, and the card paints the words at once (preparedBody)',
      /const viewReply = \(view\?\.prepared \?\? \[\]\)\.find\(\(p\) => p\.kind === 'reply_draft'/.test(detail)
      && /preparedBody=\{draft\}/.test(detail)
      && /const \[loading, setLoading\] = useState\(!coworker && !standalone && !seededBody\)/.test(code('components/home/email-card.tsx')));
    gate('A13 the follow-up seeds its nudge from the view (the prepared list), never from a per-open door call',
      /const viewNudge = \(view\?\.prepared \?\? \[\]\)\.find/.test(detail));
  }

  // ═══ B · NO WATERFALL ═══
  console.log('\nB · no request waits on another it does not need data from');
  {
    const detail = code(DETAIL);
    gate('B1 nothing on the item page chains behind the view read settling (viewSettled is gone from the doors)',
      !/viewSettled\(/.test(detail));
    gate('B2 the judge starts at the open, beside the view — never inside another request\'s then-chain',
      (detail.match(/\n\s*fetch\(`\/api\/items\/judge\?kind=(inbox|commitment)&id=\$\{id\}`\)/g) ?? []).length === 2
      && !/\.then\([^;]{0,200}fetch\(`\/api\/items\/judge/.test(detail));
    gate('B3 a judge landing FILLS a page that painted no verdict — it never swaps a painted one (cached for the next open)',
      /if \(!verdictRef\.current\) setVerdict\(d\.verdict\)/.test(detail) && /!d\?\.verdict \|\| verdictRef\.current\) return;/.test(detail));
    gate('B4 the ONE dependent request: the email door\'s draft-on-open waits on the view ONLY to learn whether a draft must be made',
      /if \(viewReply\?\.content\) \{ draftAskedRef\.current = true; return; \}/.test(detail)
      && /if \(work && !REPLY_WORKS\.has\(work\)\)/.test(detail)
      && (detail.match(/fetch\(`\/api\/inbox\/\$\{id\}\/draft`, \{ method: 'POST' \}\)/g) ?? []).length === 1);
    gate('B5 the follow-up\'s nudge door (which may draft) is asked only when the reader summons the composer without a prepared nudge',
      /if \(!composerOpen \|\| draft !== null \|\| viewNudge\?\.content \|\| nudgeAskedRef\.current\) return;/.test(detail));
    const warm = code(WARM);
    gate('B6 the hover warm fires the view AND the kind\'s object read in ONE beat (Promise.all), into the keys the page paints from — and it is the ONLY object warm (the row states intent only)',
      /await Promise\.all\(\[fetchItemView\(t\.kind, t\.id, \{ warm: true \}\), warmItemObjectOnce\(t\.kind, t\.id\)\]\)/.test(warm)
      // ONE warm owner: the row no longer warms the object itself (two commitment requests per hover)
      && !/PREFETCH_PLAN|loadThreadRaw|fetch\(/.test(code('components/work/work-row.tsx').slice(code('components/work/work-row.tsx').indexOf('export function prefetchItem'), code('components/work/work-row.tsx').indexOf('export function InitiativeTag')))
      && /export function itemObjectKey\(/.test(warm) && /itemObjectKey\('commitment', id\)/.test(detail) && /itemObjectKey\('email', id\)/.test(detail));

    // RUNTIME — stub fetch + localStorage, then warm a row of each kind with the click-intent path.
    const calls: Array<{ url: string; at: number }> = [];
    const t0 = Date.now();
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      calls.push({ url: String(url), at: Date.now() - t0 });
      await new Promise((r) => setTimeout(r, 25));
      return { ok: true, json: async () => ({ prepared: [], subject: 'x', messages: [] }) } as unknown as Response;
    };
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = globalThis;
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    const wc = await import('../lib/room/warm-client');
    const rows: Array<[string, string, RegExp]> = [
      ['/item/e1000000-0000-4000-8000-000000000001?kind=email', 'e1000000-0000-4000-8000-000000000001', /\/api\/inbox\/.+\/thread$/],
      ['/item/c1000000-0000-4000-8000-000000000001?kind=commitment', 'c1000000-0000-4000-8000-000000000001', /\/api\/commitments\/[^/]+$/],
      ['/item/m1000000-0000-4000-8000-000000000001?kind=meeting', 'm1000000-0000-4000-8000-000000000001', /\/api\/meetings\/.+\/full$/],
      ['/item/f1000000-0000-4000-8000-000000000001?kind=followup', 'f1000000-0000-4000-8000-000000000001', /\/api\/commitments\/.+\/thread$/],
    ];
    for (const [href] of rows) wc.prefetchItemView(href, { immediate: true });
    await new Promise((r) => setTimeout(r, 80));
    const bad = rows.filter(([, id, objRe]) => {
      const v = calls.find((c) => c.url.startsWith('/api/items/view') && c.url.includes(id));
      const o = calls.find((c) => c.url.includes(id) && objRe.test(c.url));
      // both requested, and the object read did not wait for the view to land (25ms stub latency)
      return !v || !o || Math.abs(o.at - v.at) > 15;
    }).map(([href]) => href);
    gate('B7 runtime: a click-intent warm on every kind requests the view and the object read together (no chain)', bad.length === 0,
      `${bad.join(' · ')} — calls: ${calls.map((c) => `${c.url}@${c.at}`).join(', ')}`);
    gate('B8 runtime: the warmed object lands in the key the page paints from (the next open paints it at once)',
      rows.every(([, id], i) => store.has(wc.itemObjectKey((['email', 'commitment', 'meeting', 'followup'] as const)[i], id))),
      [...store.keys()].join(', '));
  }

  // ═══ C · THE RESERVED SLOT ═══
  console.log('\nC · a widget still being made paints as the preparing slot, in its own shape, in its own seat');
  {
    const base: ItemPageFacts = { machine: { state: 'preparing' }, mounted: {}, brief: null, who: 'Sam', ask: 'send the signed form', title: null, source: 'source' };
    const pendingPlan = composeItemPage({ ...base, slot: { artifact: 'reply_draft', inFlight: true } });
    gate('C1 pure: a reply this open is drafting reserves the ACTION seat in the email widget\'s shape',
      pendingPlan.action === null && pendingPlan.pending?.widget === 'email' && pendingPlan.pending.artifact === 'reply_draft');
    const landedPlan = composeItemPage({ ...base, slot: { artifact: 'reply_draft', inFlight: false }, mounted: { reply_draft: true } });
    gate('C2 pure: the landed draft takes the seat even while the frozen machine state still reads `preparing`',
      landedPlan.action === 'email' && landedPlan.pending === null);
    gate('C3 pure: nothing is reserved for work this open is not making, for a production that yielded nothing, or on settled work',
      composeItemPage(base).pending === null
      && composeItemPage({ ...base, slot: { artifact: 'reply_draft', inFlight: false } }).pending === null
      && composeItemPage({ ...base, machine: { state: 'settled' }, slot: { artifact: 'reply_draft', inFlight: true } }).pending === null);
    gate('C4 pure: a table pick outranks the slot (a painted widget is never displaced by a reservation)',
      composeItemPage({ ...base, machine: { state: 'awaiting_decision' }, mounted: { decision: true }, slot: { artifact: 'reply_draft', inFlight: true } }).action === 'decision');

    const SEAT = { id: 'cos', name: 'Clara', roleLabel: 'chief of staff' };
    const items1 = itemPageItems(pendingPlan, { seat: SEAT, pending: React.createElement(PreparingSlot, { widget: 'email', who: 'Clara' }) });
    const items2 = itemPageItems(landedPlan, { seat: SEAT, action: { node: React.createElement('div', { 'data-widget': 'email' }, 'the reply card'), by: null } });
    const seat1 = items1.find((i) => i.id === 'action');
    const seat2 = items2.find((i) => i.id === 'action');
    gate('C5 pure: the placeholder and the landed widget hold the SAME thread seat (id `action`) — a fill, never an append below',
      !!seat1 && !!seat2 && items1.length === items2.length && items1.map((i) => i.id).join() === items2.map((i) => i.id).join());
    const html = renderToStaticMarkup(React.createElement(ThreadTimeline, { items: items1 }));
    gate('C6 render: the timeline shows the slot with its words — "Clara is preparing a reply" — and no spinner',
      /data-preparing-slot="email"/.test(html) && html.includes('Clara is preparing a reply') && !/animate-spin|spinner/i.test(html));

    const shapeMisses: string[] = [];
    for (const w of ITEM_ACTION_WIDGETS) {
      const h = renderToStaticMarkup(React.createElement(PreparingSlot, { widget: w, who: 'Clara Example' }));
      const ok = h.includes(`data-preparing-slot="${w}"`) && h.includes(`Clara ${PREPARING_WORDS[w]}`)
        && h.includes('aria-busy="true"') && !/animate-spin|spinner|svg/i.test(h) && h.includes('0.8s') && h.includes('motion-reduce:animate-none')
        && !/\b(is ready|ready to|has been|sent|prepared for you)\b/i.test(PREPARING_WORDS[w]);
      if (!ok) shapeMisses.push(w);
    }
    gate(`C7 render: every one of the ${ITEM_ACTION_WIDGETS.length} widget kinds has its own slot shape and words — urgent pulse, reduced-motion honoured, no spinner, no readiness claim`,
      shapeMisses.length === 0, shapeMisses.join(', '));
    const emailShape = renderToStaticMarkup(React.createElement(PreparingSlot, { widget: 'email' }));
    const decisionShape = renderToStaticMarkup(React.createElement(PreparingSlot, { widget: 'decision' }));
    gate('C8 render: shapes differ by widget (the email slot has a commit row and four body lines; the decision slot has its routes)',
      emailShape !== decisionShape && (decisionShape.match(/rounded-full/g) ?? []).length >= 2
      && (emailShape.match(/rounded bg-neutral-100/g) ?? []).length >= 6);
    gate('C9 the pulse cycle is stated and urgent (< 1s), and the class carries exactly it',
      PREPARING_CYCLE_MS < 1000 && PREPARING_PULSE.includes(`${PREPARING_CYCLE_MS / 1000}s`) && preparingLineOf('email', null) === 'Clara is preparing a reply');
    gate('C10 pure: the no-mutation law and this law agree — a slot fills (empty or placeholder), a painted widget never swaps, and a painted view still holds a background arrival',
      mayFillSlot('empty') && mayFillSlot('placeholder') && !mayFillSlot('widget')
      && !mayReplaceInPlace('background', true) && mayReplaceInPlace('open', false));
    const rail = code(RAIL);
    const detail = code(DETAIL);
    gate('C11 the rail hands the plan\'s pending widget to the ONE slot primitive, and the email door reserves only a reply the judgment owes',
      /pending: plan\.pending \? <PreparingSlot widget=\{plan\.pending\.widget\} who=\{seatName\} \/> : null/.test(rail)
      && /slot: itemSettled \? null : slot \?\? null/.test(rail)
      && /const owed = !!work && REPLY_WORKS\.has\(work\);/.test(detail) && /if \(owed\) setReplySlot\(\{ artifact: 'reply_draft', inFlight: true \}\)/.test(detail));
    gate('C13 the read-waits elsewhere wear the SAME primitive (a DM/chat never-seen room · a decision card\'s evidence · the counting frame\'s pulse) — no private skeleton',
      /<PreparingShape shape="thread" \/>/.test(code('components/home/home-ask.tsx'))
      && /<PreparingShape shape="evidence"/.test(code('components/triage/decision-frame.tsx'))
      && /\$\{PREPARING_PULSE\}/.test(code('components/triage/decision-frame.tsx'))
      && !/motion-safe:animate-pulse/.test(code('components/triage/decision-frame.tsx')));
    gate('C12 the slot primitive is ONE component in the kit, and the kit exports it',
      /export \{ PreparingSlot/.test(read('components/thread/index.ts')) && /WIDGET_OF_ARTIFACT/.test(read('components/thread/item-page.ts'))
      && Object.values(WIDGET_OF_ARTIFACT).every((w) => w in PREPARING_WORDS));
  }

  // ═══ D · THE DECISION CARD, CLEAN ═══
  console.log('\nD · the decision card never says what is absent, and never repeats the subject');
  {
    const { default: DecisionCard } = await import('../components/home/decision-card');
    const html = renderToStaticMarkup(React.createElement(DecisionCard, { spec: {
      itemKind: 'email', itemId: 'i1', title: null,
      options: [{ label: 'Consent to transcription' }, { label: 'Decline transcription' }], recommendation: null, object: null,
    } }));
    gate('D1 render: with no object the card is its options alone — no filler line, nothing recommended',
      html.includes('Consent to transcription') && html.includes('Decline transcription')
      && !/Nothing is attached/i.test(html) && !/recommended/i.test(html));
    gate('D2 the filler sentence is gone from every source that could speak it',
      !/Nothing is attached to review/.test(code('lib/room/decision-object.ts') + code('components/home/decision-card.tsx')
        + code('components/thread/thread-cards.tsx') + code('app/(main)/dev/thread-preview/preview-client.tsx') + code('app/(main)/dev/thread-preview/preview-catalogue.tsx')));
    gate('D3 pure: a brief title that repeats the page\'s subject (Re:/Fwd: and punctuation aside) is dropped; a real question stays',
      decisionTitleOf('Consent to record and transcribe our call', [SUBJECT]) === null
      && decisionTitleOf('Fwd: consent to record, and transcribe our call!', [SUBJECT]) === null
      && decisionTitleOf('Should the call be recorded at all?', [SUBJECT]) === 'Should the call be recorded at all?'
      && decisionTitleOf(null, [SUBJECT]) === null);
    gate('D4 pure: with no brief the decision carries NO title (the subject is never the fallback)',
      decisionSpecOf({ verdict: servedVerdictOf(STORED_DECIDE), prepared: [] }, [SUBJECT])?.title === null);
  }

  // ═══ E · THE LAW IS REGISTERED ═══
  console.log('\nE · the registry');
  {
    const reg = JSON.parse(read('docs/laws-registry.json')) as { laws: Array<{ id: string; gates: Array<{ suite: string }>; collides_with: Array<{ law: string; precedence: string }> }> };
    const law = reg.laws.find((l) => l.id === 'no-waiting');
    gate('E1 `no-waiting` is registered with this gate, and names its collision with the no-mutation law and the precedence',
      !!law && law.gates.some((g) => g.suite === 'smoke-no-waiting')
      && law.collides_with.some((c) => c.law === 'no-mutation-and-address' && /slot/i.test(c.precedence)));
    gate('E2 the rendered registry carries it', read('docs/laws-registry.md').includes('`no-waiting`'));
    gate('E3 the board runs this gate', /npx tsx scripts\/smoke-no-waiting\.ts/.test(read('package.json')));
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
