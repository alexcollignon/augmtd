/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE ITEM OPENS NOW (stabilization W11.4 — docs/stabilization-plan.md PART VI; invariant 11
 * NO MUTATION AFTER PAINT + THE ADDRESS LAW). Owner live walk, Sep 23: a Home deck row's click moved
 * the address to /item/<id> at once and then the Home stood unchanged for 5–9s (no frame, no
 * skeleton); the "When you're ready · N →" door's first click read as dead for seconds.
 *
 * ZERO-AI, zero-DB, deterministic: source floors + pure behaviour (fetch stubbed in-process).
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-item-open.ts
 *
 *   A · THE FRAME PAINTS AT THE CLICK — the intercepting route has a loading boundary that renders
 *       the room's frame WITHOUT awaiting data (no deep-dive import, no await, no Suspense read),
 *       in the modal's own geometry, and the deep-dive lands as a FILL of it.
 *   B · ONE REQUEST FOR FIRST PAINT — the frame starts the open's reads; the deep-dive joins the
 *       flight or takes its landing once (one view request, one object request per open).
 *   C · AFTER-PAINT ENRICHMENTS — the judge waits for the view to settle (bounded); nothing on the
 *       open path POSTs a plan; the frame never asks the judge.
 *   D · THE VIEW DOOR HAS NO WAVE BARRIER — every wave-2 read is started on its own input before
 *       wave 1 is awaited; each builder executes once.
 *   E · THE HELD DOOR ANSWERS AT THE CLICK — a transition with an immediate pending word.
 *   F · TRUTH KEPT — the no-mutation pairing is untouched; a hover warm's landing is never handed to
 *       an open (the open's background work still runs exactly once).
 *   G · W12.2 THE CLICK PAINTS ITS OWN FRAME (owner live walk on prod after W11: +0s/+2s still the
 *       Home) — a loading boundary cannot paint before the router's transition gets its server
 *       answer unless a prefetch already landed it; so the row paints its pending state and the
 *       room's frame FROM THE CLIENT on the click, and the route fills it (announced before paint).
 *   H · W12.3 THE HOVER PREFETCH IS AUTO — the row's router.prefetch asks for the loading boundary
 *       only, never a FULL dynamic segment per hovered row.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Call = { url: string; body?: string };
function stubFetch(answer: (url: string) => unknown, delayMs = 20): Call[] {
  const calls: Call[] = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body });
    await sleep(delayMs);
    const body = answer(String(url));
    return { ok: true, json: async () => body } as unknown as Response;
  };
  return calls;
}

const MODAL_LOADING = 'app/(main)/@modal/(.)item/[id]/loading.tsx';
const PAGE_LOADING = 'app/(main)/item/[id]/loading.tsx';
const FRAME = 'components/home/item-open-frame.tsx';
const MODAL = 'components/home/item-detail-modal.tsx';
const DETAIL = 'components/home/item-detail.tsx';
const VIEW = 'app/api/items/view/route.ts';
const HOME = 'components/home/home-view.tsx';

async function main() {
  // ═══ A · THE FRAME PAINTS AT THE CLICK ═══
  console.log('\nA · the frame paints at the click (a loading boundary that awaits nothing)');
  {
    gate('A1 the intercepting route AND the full page each carry a loading boundary that mounts THE ONE frame',
      existsSync(join(ROOT, MODAL_LOADING)) && existsSync(join(ROOT, PAGE_LOADING))
      && /<ItemOpenFrame docked \/>/.test(src(MODAL_LOADING)) && /<ItemOpenFrame docked=\{false\} \/>/.test(src(PAGE_LOADING)));
    const frame = existsSync(join(ROOT, FRAME)) ? src(FRAME) : '';
    // The frame's module must not wait on the chunk it stands in for, nor on any data.
    const importsOf = (s: string) => (s.match(/^import[^;]+;/gm) ?? []).join('\n');
    gate('A2 the frame is LIGHT: no deep-dive import, no AI door, no server module — it cannot wait on the chunk it stands in for',
      !!frame && !/item-detail/.test(importsOf(frame)) && !/lib\/ai\//.test(importsOf(frame))
      && !/supabase\/server|next\/headers/.test(importsOf(frame)));
    gate('A3 the frame renders WITHOUT awaiting data: no await, no use(), no Suspense read — its name is what the browser already holds',
      !!frame && !/\bawait\b/.test(frame) && !/\buse\(/.test(frame) && !/<Suspense/.test(frame)
      && /useLayoutEffect\(\(\) => \{\s*if \(origin === 'route'\) markRouteLanded\(\);\s*if \(!id\) return;\s*setTitle\(heldTitleOf\(/.test(frame)
      && /<RoomConversationSkeleton \/>/.test(frame));
    gate('A4 the held name comes ONLY from the deep-dive\'s own instant-load keys (never composed; unknown → a ghost bar)',
      /aug-item-commitment-\$\{id\}/.test(frame) && /aug-item-thread-\$\{id\}/.test(frame)
      && /animate-pulse/.test(frame));
    const geometry = 'fixed inset-y-0 right-0 left-[212px] z-40 flex flex-col pointer-events-none';
    gate('A5 the frame stands in the MODAL\'s own geometry (the deep-dive lands as a fill, never a re-layout)',
      frame.includes(geometry) && src(MODAL).includes(geometry));
    gate('A6 the deep-dive\'s modal mounts ALREADY ENTERED after a frame (no second entrance from transparent)',
      /useState\(\(\) => takeFramePainted\(\)\)/.test(src(MODAL)) && /export function takeFramePainted\(\): boolean/.test(frame));
    const page = src('app/(main)/@modal/(.)item/[id]/page.tsx');
    gate('A7 the intercepting page stays THIN (no data read on the server segment the click waits on)',
      !/fetch\(|createClient|supabase|guardFeaturePage/.test(page));
  }

  // ═══ B · ONE REQUEST FOR FIRST PAINT ═══
  console.log('\nB · one request for first paint (the frame starts the reads; the deep-dive joins)');
  {
    const frame = src(FRAME);
    gate('B1 the frame STARTS the open\'s reads at the click: the ONE view read + the kind\'s object read (commitment facts / the ONE thread read)',
      /export function startOpenReads\(/.test(frame) && /void fetchItemView\(viewKind, id\);/.test(frame)
      && /void fetchOpenObject\(`\/api\/commitments\/\$\{id\}`, `aug-item-commitment-\$\{id\}`\);/.test(frame)
      && /if \(kind === 'email'\) void loadThreadRaw\(id\);/.test(frame)
      && /startOpenReads\(kindProp \?\? kindOfSearch\(window\.location\.search\), id\);/.test(frame));
    const detail = src(DETAIL);
    gate('B2 the commitment door reads its facts through the SAME flight (joins/takes the frame\'s read); a post-deed reload reads afresh',
      /const read: Promise<CommitmentData \| null> = reload === 0\s*\? \(fetchOpenObject\(`\/api\/commitments\/\$\{id\}`, `aug-item-commitment-\$\{id\}`\)/.test(detail)
      && !/fetch\(`\/api\/commitments\/\$\{id\}`\)\s*\n\s*\.then\(r => \(r\.ok \? r\.json\(\) : Promise\.reject\(\)\)\)/.test(detail));
    gate('B3 the deep-dive\'s view open still goes through THE ONE FLIGHT (and a user deed never joins it)',
      /const landing = reason === 'open'\s*\? fetchItemView\(kind, id\)/.test(detail));

    // pure — the flight + the one handoff
    const calls = stubFetch((url) => (url.includes('/api/items/view') ? { prepared: [], brief: 'b' } : url.includes('/api/commitments/') ? { id: 'c', description: 'Send the deck' } : { ok: true }));
    const wc = await import('../lib/room/warm-client');
    const cid = 'aaaaaaaa-0000-0000-0000-00000000000b';
    const viewCalls = () => calls.filter((c) => c.url.startsWith(`/api/items/view?kind=commitment&id=${cid}`)).length;
    // The frame starts the open; the deep-dive mounts while it is in the air → joins.
    const f1 = wc.fetchItemView('commitment', cid);
    const m1 = wc.fetchItemView('commitment', cid);
    const [a, b] = await Promise.all([f1, m1]);
    gate('B4 pure: a deep-dive mounting while the frame\'s read is in the air JOINS it (one request)', viewCalls() === 1 && a === b && a?.brief === 'b', `requests=${viewCalls()}`);
    // The frame's read LANDED before the deep-dive mounted → the mount takes the landing, once.
    const cid2 = 'aaaaaaaa-0000-0000-0000-00000000000c';
    const vc2 = () => calls.filter((c) => c.url.startsWith(`/api/items/view?kind=commitment&id=${cid2}`)).length;
    await wc.fetchItemView('commitment', cid2);
    const took = await wc.fetchItemView('commitment', cid2);
    gate('B5 pure: a deep-dive mounting AFTER the frame\'s read landed takes that landing (still one request per open)', vc2() === 1 && took?.brief === 'b', `requests=${vc2()}`);
    await wc.fetchItemView('commitment', cid2);
    gate('B6 pure: the handoff is consumed ONCE — the next open reads afresh', vc2() === 2, `requests=${vc2()}`);
    gate('B7 the handoff window is stated and short (the frame → mount gap, ≤ 10s)', wc.OPEN_HANDOFF_MS > 0 && wc.OPEN_HANDOFF_MS <= 10_000);
    // The object read — same shape.
    const oc = () => calls.filter((c) => c.url === `/api/commitments/${cid}`).length;
    const [o1, o2] = await Promise.all([wc.fetchOpenObject(`/api/commitments/${cid}`, 'k'), wc.fetchOpenObject(`/api/commitments/${cid}`, 'k')]);
    const o3 = await wc.fetchOpenObject(`/api/commitments/${cid}`, 'k');
    gate('B8 pure: the commitment facts are ONE request per open (joined in flight, landing taken once)', oc() === 1 && o1 === o2 && o3 === o1, `requests=${oc()}`);
    await wc.fetchOpenObject(`/api/commitments/${cid}`, 'k');
    gate('B9 pure: …and the next open reads the facts afresh', oc() === 2, `requests=${oc()}`);
  }

  // ═══ C · AFTER-PAINT ENRICHMENTS ═══
  console.log('\nC · the judge and the plan never hold the first paint');
  {
    const detail = src(DETAIL);
    gate('C1 both judge reads wait for the open\'s view read to settle (bounded) — never beside the first paint\'s one read',
      /viewSettled\('email', id\)\.then\(\(\) => \(alive \? fetch\(`\/api\/items\/judge\?kind=inbox&id=\$\{id\}`\)/.test(detail)
      && /viewSettled\('commitment', id\)\s*\.then\(\(\) => \(alive \? fetch\(`\/api\/items\/judge\?kind=commitment&id=\$\{id\}`\)/.test(detail)
      && (detail.match(/\/api\/items\/judge\?/g) ?? []).length === 2);
    gate('C2 nothing on the open path POSTs a plan (the deep-dive only PATCHes a checklist tick; the frame never asks)',
      !/'\/api\/items\/plan',\s*\{\s*method: 'POST'/.test(detail) && !/api\/items\/(plan|judge)/.test(src(FRAME)));
    gate('C3 no judge verdict is awaited before paint: every judge read lands in state from a promise chain (no await)',
      !/await fetch\(`\/api\/items\/judge/.test(detail));
    const calls = stubFetch(() => ({ prepared: [] }), 40);
    const wc = await import('../lib/room/warm-client');
    const t0 = Date.now();
    await wc.viewSettled('email', 'bbbbbbbb-0000-0000-0000-000000000001');
    const idle = Date.now() - t0;
    const p = wc.fetchItemView('email', 'bbbbbbbb-0000-0000-0000-000000000002');
    let settledFirst = false;
    await Promise.all([wc.viewSettled('email', 'bbbbbbbb-0000-0000-0000-000000000002').then(() => { settledFirst = true; }), p]);
    const t1 = Date.now();
    const s = wc.fetchItemView('email', 'bbbbbbbb-0000-0000-0000-000000000003');
    await wc.viewSettled('email', 'bbbbbbbb-0000-0000-0000-000000000003', 5);
    const capped = Date.now() - t1;
    await s;
    gate('C4 pure: viewSettled resolves at once with no flight, after the flight lands, and never past its cap',
      idle < 15 && settledFirst && capped < 35 && calls.length >= 2, `idle=${idle}ms capped=${capped}ms`);
  }

  // ═══ D · THE VIEW DOOR HAS NO WAVE BARRIER ═══
  console.log('\nD · the view door chains each read on its own input');
  {
    const view = src(VIEW);
    const w1Await = view.indexOf('await Promise.all([planP, prepP, linkP, anyVerdictP, itemRowP])');
    const starts = ['const roomP = linkP.then(', 'const machineP = (', 'const sourceItemIdP = foldedRowP.then(', 'const sourceMeetingP = foldedRowP.then(', 'const lastGoodP = readRoomResponse('];
    gate('D1 every wave-2 read (rail · machine · source object · meeting source) and the last-good brief START before wave 1 is awaited',
      w1Await > 0 && starts.every((s) => { const i = view.indexOf(s); return i > 0 && i < w1Await; }),
      starts.filter((s) => { const i = view.indexOf(s); return !(i > 0 && i < w1Await); }).join(' · '));
    gate('D2 the rail chains on the LINK, the source objects on the ROW, the machine on row + prepared — no read waits on one it does not need',
      /const roomP = linkP\.then\(/.test(view) && /Promise\.all\(\[foldedRowP, prepP\]\)\.then\(/.test(view)
      && /const foldedRowP: Promise<any> = itemRowP\.then\(/.test(view));
    gate('D3 each PostgREST builder is made ONE promise (a builder re-executes on every then — no doubled reads)',
      /const planP = Promise\.resolve\(supabase\.from\('item_plans'\)/.test(view) && /const linkP = Promise\.resolve\(/.test(view)
      && /const anyVerdictP = Promise\.resolve\(/.test(view) && /const itemRowP = Promise\.resolve\(/.test(view));
    gate('D4 an early exit never leaves a started read unhandled',
      /for \(const p of \[roomP, machineP, sourceItemIdP, sourceMeetingP\]\) void p\.catch\(\(\) => \{\}\);/.test(view));
    gate('D5 the view still schedules its AI only under after() and serves last-good (W8.4 floor intact)',
      /const onOpen = \(work: \(\) => Promise<unknown>\) => \{ if \(!warm\) after\(/.test(view)
      // ⟲ RE-POINTED (W13.5): last-good is read once and passed through the serve-time truth before the paint.
      && /const lastGood = await lastGoodP;/.test(view) && /serveTimeTruth\(lastGood, \{/.test(view));
  }

  // ═══ E · THE HELD DOOR ═══
  console.log('\nE · the held door answers at the click');
  {
    const home = src(HOME);
    const seg = home.slice(home.indexOf('function CalmDoor('), home.indexOf('function CalmDoor(') + 3_000);
    gate('E1 the door opens the lens as a TRANSITION with an immediate pending word, and refuses a second click while pending',
      /const \[opening, startOpening\] = useTransition\(\);/.test(seg)
      && /onClick=\{\(\) => \{ if \(!opening\) startOpening\(onOpen\); \}\}/.test(seg)
      && /aria-busy=\{opening\} disabled=\{opening\}/.test(seg) && /\{opening \? 'Opening…' :/.test(seg));
  }

  // ═══ F · TRUTH KEPT ═══
  console.log('\nF · truth kept (no mutation after paint; the open\'s background work runs once)');
  {
    const detail = src(DETAIL);
    gate('F1 the no-mutation pairing is untouched: a painted room is never swapped by the open\'s own read',
      /const paint = mayReplaceInPlace\(reason, paintedRef\.current\);/.test(detail)
      && /lateBrief: \{ text, at: d2\.briefAt \?\? null \}/.test(detail));
    const calls = stubFetch((url) => (url.includes('/api/items/view') ? { prepared: [] } : { ok: true }));
    const wc = await import('../lib/room/warm-client');
    const id = 'dddddddd-0000-0000-0000-000000000001';
    await wc.fetchItemView('email', id, { warm: true }); // a hover warm landed (zero-AI read)
    await wc.fetchItemView('email', id);                  // the open
    const views = calls.filter((c) => c.url.startsWith(`/api/items/view?kind=email&id=${id}`));
    gate('F2 pure: a HOVER WARM\'s landing is never handed to an open — the open reads for itself (its after() work is scheduled once)',
      views.length === 2 && views[0].url.endsWith('&warm=1') && !views[1].url.includes('warm=1'), views.map((v) => v.url.split('?')[1]).join(' | '));
    const id2 = 'dddddddd-0000-0000-0000-000000000002';
    const w = wc.fetchItemView('email', id2, { warm: true });
    await Promise.all([w, wc.fetchItemView('email', id2)]);
    await sleep(5);
    const kicks = calls.filter((c) => c.url === '/api/items/warm' && (c.body ?? '').includes(id2));
    const v2 = calls.filter((c) => c.url.startsWith(`/api/items/view?kind=email&id=${id2}`));
    gate('F3 pure: an open joining a warm in flight is ONE view request + ONE kick (unchanged W8.4 shape)', v2.length === 1 && kicks.length === 1,
      `views=${v2.length} kicks=${kicks.length}`);
  }

  // ═══ G · W12.2 THE CLICK PAINTS ITS OWN FRAME ═══
  console.log('\nG · the click paints its own frame (never behind the router\'s transition)');
  {
    const home = src(HOME);
    const i = home.indexOf('function WhisperLine(');
    const row = home.slice(i, home.indexOf('\nfunction ', i + 10));
    gate('G1 the deck row\'s click sets its OWN pending state synchronously (a discrete event, no transition) BEFORE the router push, and refuses a second click',
      /const \[opening, setOpening\] = useState\(false\);/.test(row)
      && /const openNow = \(\) => \{ if \(opening\) return; setOpening\(true\); open\(\); \};/.test(row)
      && /onClick=\{openNow\}/.test(row) && /e\.preventDefault\(\); openNow\(\);/.test(row)
      && !/startTransition\([^)]*setOpening/.test(row) && !/onClick=\{open\}/.test(row));
    gate('G2 …the row SHOWS it (aria-busy + the raised surface) and stands the room\'s frame over the Home from the client',
      /aria-busy=\{opening \|\| undefined\}/.test(row) && /\{opening && <ClientOpenFrame door=\{item\.href\} onDone=\{\(\) => setOpening\(false\)\} \/>\}/.test(row));
    const frame = src(FRAME);
    gate('G3 the client frame is THE ONE frame (same component, the modal geometry), portalled to <body> (never inside a transformed ancestor)',
      /export function ClientOpenFrame\(/.test(frame)
      && /createPortal\(<ItemOpenFrame docked id=\{target\.id\} kind=\{target\.kind\} origin="client" \/>, document\.body\)/.test(frame));
    gate('G4 it steps aside when the route LANDS (subscribed in a layout effect), when the address moves elsewhere, or after a stated bound',
      /useLayoutEffect\(\(\) => onRouteLanded\(\(\) => done\.current\(\)\), \[\]\);/.test(frame)
      && /if \(pathname !== startPath && pathname !== `\/item\/\$\{targetId\}`\) done\.current\(\);/.test(frame)
      && /setTimeout\(\(\) => done\.current\(\), CLIENT_FRAME_MAX_MS\)/.test(frame));
    const modal = src(MODAL);
    gate('G5 the route announces its landing BEFORE its first paint: the loading frame (route origin) and the deep-dive modal each call markRouteLanded in a layout effect',
      /if \(origin === 'route'\) markRouteLanded\(\);/.test(frame) && /useLayoutEffect\(\(\) => \{ markRouteLanded\(\); \}, \[\]\);/.test(modal));
    gate('G6 no second entrance: the route\'s frame replacing the click\'s frame mounts already entered; the client frame marks the paint',
      /useState\(\(\) => origin === 'route' && docked && peekFramePainted\(\)\)/.test(frame) && /if \(docked\) _framePaintedAt = Date\.now\(\);/.test(frame));
    gate('G7 the client frame needs NO route params: id + kind come from the row\'s href (the room\'s kind rule, viewTargetOf)',
      /export function clientFrameTarget\(/.test(frame) && /const t = viewTargetOf\(href\);/.test(frame)
      && /const id = idProp \?\? \(typeof params\?\.id === 'string' \? params\.id : null\);/.test(frame));
    // THE PREMISE, pinned to the installed Next (re-check on an upgrade): the legacy router's
    // router.prefetch defaults to a FULL prefetch (the whole dynamic segment) — the loading state is
    // not what it fetches, so the row can never rely on a hover prefetch to paint at the click.
    const nextSrc = readFileSync(join(ROOT, 'node_modules/next/dist/client/components/app-router-instance.js'), 'utf8');
    const cfg = ['next.config.ts', 'next.config.js', 'next.config.mjs'].filter((f) => existsSync(join(ROOT, f))).map(src).join('\n');
    gate('G8 the premise holds on the installed Next: legacy router.prefetch defaults to PrefetchKind.FULL and the segment cache is off — the click must not depend on a prefetch',
      /kind: \(_options_kind = options == null \? void 0 : options\.kind\) != null \? _options_kind : _routerreducertypes\.PrefetchKind\.FULL/.test(nextSrc)
      && !/clientSegmentCache\s*:\s*true/.test(cfg));
  }

  // ═══ H · W12.3 THE HOVER PREFETCH IS AUTO ═══
  console.log('\nH · hovering a row prefetches only down to the loading boundary (AUTO), never the full dynamic segment');
  {
    const wr = src('components/work/work-row.tsx');
    gate('H1 the row\'s hover prefetch passes { kind: PrefetchKind.AUTO } — no bare router.prefetch(href) remains in the row module',
      /router\.prefetch\?\.\(item\.href, \{ kind: PrefetchKind\.AUTO \}\)/.test(wr)
      && !/router\.prefetch\??\.?\([^,)]*\)/.test(wr));
    gate('H2 the enum comes from the path the installed Next\'s own PrefetchOptions type uses (a value import, client-safe: no server graph)',
      /import \{ PrefetchKind \} from 'next\/dist\/client\/components\/router-reducer\/router-reducer-types';/.test(wr)
      && /import type \{ FocusAndScrollRef, PrefetchKind \} from '\.\.\/\.\.\/client\/components\/router-reducer\/router-reducer-types';/
        .test(readFileSync(join(ROOT, 'node_modules/next/dist/shared/lib/app-router-context.shared-runtime.d.ts'), 'utf8')));
    // The import resolves at RUNTIME to the value the router switches on (a const-enum would erase).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rrt = require('next/dist/client/components/router-reducer/router-reducer-types') as { PrefetchKind?: Record<string, string> };
    gate('H3 the enum resolves at runtime: PrefetchKind.AUTO === "auto" (FULL "full")',
      rrt.PrefetchKind?.AUTO === 'auto' && rrt.PrefetchKind?.FULL === 'full');
    const nextDir = 'node_modules/next/dist/client/components';
    const inst = readFileSync(join(ROOT, `${nextDir}/app-router-instance.js`), 'utf8');
    const fsr = readFileSync(join(ROOT, `${nextDir}/router-reducer/fetch-server-response.js`), 'utf8');
    gate('H4 the behaviour on the installed Next: the legacy prefetch honours options.kind, and ONLY AUTO sends Next-Router-Prefetch (a dynamic route fetched to its loading boundary)',
      /kind: \(_options_kind = options == null \? void 0 : options\.kind\) != null \? _options_kind : /.test(inst)
      && /if \(prefetchKind === _routerreducertypes\.PrefetchKind\.AUTO\) \{\s*headers\[_approuterheaders\.NEXT_ROUTER_PREFETCH_HEADER\] = '1';/.test(fsr));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} smoke-item-open: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
