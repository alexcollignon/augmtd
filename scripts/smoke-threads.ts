/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE THREADS ARC (docs/threads-plan.md; born Sep 5 with Phase 1)
 *
 * The constitution's standing gate. Grows a section per phase; a law ships in the same change as
 * its gate (the excerpt-law lesson: a law is only alive while a gate enforces it). SOURCE-LEVEL
 * and ZERO-AI by design — like smoke-excerpt-law, it asserts structure the laws depend on, so it
 * runs in seconds and can gate every commit of the arc.
 *
 *   npx tsx scripts/smoke-threads.ts
 *
 * Sections:
 *   T1 — THE ADDRESS LAW (P1): /project/[id] exists, ONE href producer, no legacy producers left,
 *        the legacy redirect stands, middleware protects the route.
 *   TI — THE IDENTITY LAW: Clara holds the CoS seat under the label to match (Sep 7) — one label
 *        map, the role KEY untouched, both persona prompts in step, no private copies left.
 *   T2 — THE NO-MUTATION LAW (P1, structural half): ONE mechanism (lib/room/no-mutation.ts), both
 *        room doors holding their open fetch behind it, the Home deck freezing on a background
 *        arrival (rows append, never rewrite or vanish) — and the law's exceptions left standing
 *        (THE LIVE RUN's polling, the in-flight stream).
 *   T3 — THE ONE THREAD COMPONENT (P2a): the presentational kit in components/thread/ — the full
 *        message grammar incl. the custom card slot, the timeline's Slack grouping + history fold,
 *        reduced-motion on the avatar states, presentational purity (no fetch/supabase/router),
 *        and the dev-only harness proving all three thread kinds render through the one kit.
 *   T20 — THE DEED MOVES THE BRIEF / THE LIVE ROOM / THE SPARSE THREAD / THE RE-SPOKEN ASK (the
 *        owner's Sep 8 project-room walk): a send re-authors the room's opening at the ONE action
 *        seam and appends its event line; the open room beats through the ONE polling primitive at
 *        background arrival reason while the reader's own deed lands in place; a short thread rests
 *        on the composer; and an ask still speaking the retired canned template is re-composed at
 *        the one turn-serving door.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
// T19 runs the REAL calm module on fixture pools (it is pure + client-safe by construction — the
// same property gate T8.13 asserts), because "a fire must reach a seat" is a behavioural class no
// regex can catch. (RE-POINTED Sep 13: the sentence half of T19 retired with the sentence itself —
// calmFactsFrom/deriveCalmSentence no longer exist; the SEATING law is what survives and is gated.)
import {
  pickWhispers, sortDoorRows, CALM_MAX_WHISPERS,
} from '../lib/home/calm';
import type { DoItem } from '../lib/home/agenda';

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const failures: string[] = [];

function gate(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function read(rel: string): string | null {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; }
}

/** Recursively list source files under a dir (ts/tsx only, skipping build/deps). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.next')) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

// ── T1 · THE ADDRESS LAW ────────────────────────────────────────────────────────────────────────
console.log('\nT1 · THE ADDRESS LAW — every project room owns /project/<id>');

const hrefLib = read('lib/room/project-href.ts');
gate('T1.1 the ONE producer exists (lib/room/project-href.ts exports projectHref)',
  !!hrefLib && /export function projectHref\(/.test(hrefLib) && hrefLib.includes('/project/'));

const roomPage = read('app/(main)/project/[id]/page.tsx');
gate('T1.2 the route exists (app/(main)/project/[id]/page.tsx)', !!roomPage);
gate('T1.3 the route is access-guarded before paint (owner-scoped read + notFound)',
  !!roomPage && roomPage.includes('notFound') && roomPage.includes("eq('user_id'"));

const homePage = read('app/(main)/home/page.tsx');
gate('T1.4 legacy addresses forward (/home?entity= and ?project= redirect to projectHref)',
  !!homePage && homePage.includes('projectHref') && homePage.includes('redirect(') &&
  homePage.includes('entity') && homePage.includes('project'));

const mw = read('middleware.ts');
gate('T1.5 middleware protects /project', !!mw && /'\/project'/.test(mw));

// No door may hand-build the room address, and the LEGACY form may not be produced anywhere.
// The one allowed `/project/` template literal lives in the producer itself.
{
  const dirs = ['app', 'components', 'lib', 'hooks', 'context'];
  const legacyProducers: string[] = [];
  const handRolled: string[] = [];
  for (const dir of dirs) {
    for (const rel of dirs.length ? sourceFiles(dir) : []) {
      const src = read(rel);
      if (!src) continue;
      // The old address form, built anywhere, is a violation (comments included in home/page.tsx
      // and this file are fine — match only template/string constructions with the entity param).
      if (/view=projects&entity=\$\{|view=projects&entity=\$\{?/.test(src) && /['"`][^'"`]*view=projects&entity=/.test(src)) {
        if (rel !== 'scripts/smoke-threads.ts') legacyProducers.push(rel);
      }
      // A hand-rolled `/project/${…}` outside the producer forks the address grammar.
      if (/[`'"]\/project\/\$\{/.test(src) && rel !== 'lib/room/project-href.ts') handRolled.push(rel);
    }
  }
  gate('T1.6 no legacy `view=projects&entity=` href producers remain', legacyProducers.length === 0,
    legacyProducers.join(', '));
  gate('T1.7 no hand-rolled `/project/${…}` outside the ONE producer', handRolled.length === 0,
    handRolled.join(', '));
}

// The in-place room render is dead on EVERY lens: a room paints only at its own address.
{
  const pv = read('components/entities/portfolio-view.tsx');
  gate('T1.8 the portfolio grid never mounts EntityRoom in place (navigation only)',
    !!pv && !/<EntityRoom\b/.test(pv) && pv.includes('projectHref'));
  const tg = read('components/timeline/timeline-gantt.tsx');
  gate('T1.9 the timeline lens never mounts EntityRoom in place (the Sep 7 straggler)',
    !!tg && !/<EntityRoom\b/.test(tg) && tg.includes('projectHref'));
}

// ── TI · THE IDENTITY LAW (Clara is the CHIEF OF STAFF) ─────────────────────────────────────────
// Owner call, Sep 7: the CoS seat's holder says so everywhere. The gates hold the shape the
// promotion depends on — ONE label map carrying the new label, the role KEY untouched at all three
// identity sites (roles.ts · seed.ts · workers.py), the two prompts still speaking as Clara, and
// no private copy of the old label left anywhere in the app to drift back (the Luca lesson).
console.log('\nTI · THE IDENTITY LAW — Clara holds the chief-of-staff seat, everywhere');
{
  const roles   = read('lib/workers/roles.ts');
  const seed    = read('lib/workers/seed.ts');
  const workers = read('infra/agentos/workers.py');

  gate('TI.1 the ONE label map says Chief of Staff',
    !!roles && /personal_assistant:\s*'Chief of Staff'/.test(roles));
  gate('TI.2 the old label is gone from the label map',
    !!roles && !/Personal Assistant/.test(roles));

  // The KEY is identity: Slack apps, email local-parts, AgentOS routing and the seat resolver all
  // hang off `personal_assistant`. A label move that renames the key breaks every one of them.
  gate('TI.3 the role KEY survives in all three identity sites',
    !!roles && roles.includes('personal_assistant:')
    && !!seed && /worker_role:\s*'personal_assistant'/.test(seed)
    && !!workers && /"id":\s*"personal_assistant"/.test(workers));

  // The seed and the box's static prompt are the SAME persona by standing invariant.
  gate('TI.4 both prompts open as Clara and name the chief-of-staff seat',
    !!seed && /const PA_PROMPT = `You are Clara\./.test(seed) && /You're the chief of staff\./.test(seed)
    && !!workers && /PA_PROMPT = """You are Clara\./.test(workers) && /You're the chief of staff\./.test(workers));

  // The routing prompts must describe her new scope, or delegation drifts back to the old lane.
  {
    const converse = read('lib/converse/index.ts');
    gate('TI.5 the routing prompts describe Clara as the chief of staff',
      !!converse && (converse.match(/Clara[^·\n]{0,40}chief of staff/gi) ?? []).length >= 2);
  }

  // NO PRIVATE COPIES — a second label map is how half a rename ships.
  {
    const OWN = new Set(['scripts/smoke-threads.ts', 'scripts/sweep-clara-chief-of-staff.ts']);
    const offenders = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]
      .filter((f) => !OWN.has(f))
      .filter((f) => (read(f) ?? '').includes('Personal Assistant'));
    gate('TI.6 no source file under app/components/lib carries the old label',
      offenders.length === 0, offenders.join(', '));
  }
}

// ── T2 · THE NO-MUTATION LAW (structural half) ──────────────────────────────────────────────────
// "A served surface never changes in place while the reader is looking at it." The gates assert
// the STRUCTURE the law depends on: one mechanism, every room loader consulting it before it
// paints, the Home deck freezing on a background arrival — and the law's own exceptions left
// alone (THE LIVE RUN's polling, chat streaming).
console.log('\nT2 · THE NO-MUTATION LAW — a served surface never changes under its reader');
{
  const plan = read('docs/threads-plan.md');
  gate('T2.0 the law text stands in the constitution', !!plan && plan.includes('The no-mutation law'));

  // THE QUOTA EVICTION (Sep 7, found live): a full localStorage silently killed every save for two
  // days and the instant-load layer served stale paint while looking healthy. saveLS must evict
  // its own oldest envelopes and retry — scoped to `aug-` keys only (a dev origin is shared).
  {
    const lc = read('lib/utils/local-cache.ts');
    gate('T2.q the instant-load layer self-heals at quota (evict oldest aug-* envelopes, retry once, never touch foreign keys)',
      !!lc && /function evictOldestAugEnvelopes\(/.test(lc)
      && /startsWith\('aug-'\)/.test(lc)
      && /if \(evictOldestAugEnvelopes\(key\) > 0\) window\.localStorage\.setItem\(key, blob\);/.test(lc));
  }

  // ONE MECHANISM — every loader consults the same predicate (a private copy is how the law drifts).
  const mech = read('lib/room/no-mutation.ts');
  gate('T2.1 the ONE mechanism exists (lib/room/no-mutation.ts)',
    !!mech && /export function mayReplaceInPlace\(/.test(mech) && /ROOM_CACHE_MAX_AGE_MS/.test(mech));
  gate('T2.2 a skeleton fill and a user-caused change are the only in-place replacements',
    !!mech && /if \(!painted\) return true;/.test(mech) && /return reason === 'user';/.test(mech));

  // THE PROJECT ROOM — the open's own fetch is written to the cache and held, never swapped in.
  const room = read('components/entities/entity-room.tsx');
  gate('T2.3 the project room consults the mechanism before painting a landing payload',
    !!room && room.includes("from '@/lib/room/no-mutation'") && /mayReplaceInPlace\('open'/.test(room));
  // RE-POINTED Sep 13 (cleanup): the key was a LITERAL here and a producer in warm-room — two
  // spellings of one key, agreeing only by luck (the fake-warm drift class). The room now calls the
  // producers; the clause follows, strictly stronger — a rename can no longer pass half the codebase.
  // ⟲ RE-POINTED (W3.5 (a), Sep 22): the rail's open fetch grew the late-brief re-check (an APPEND,
  // never a swap), so the one-liner became a block — same law, same two moves (saveLS always;
  // setRail only when it may paint), read line by line.
  gate('T2.4 the room holds the open fetch (saveLS always; setD/setRail only when it may paint)',
    !!room && /saveLS\(roomDetailKey\(entityId\), data\); if \(mayPaintDetail\) setD\(data\);/.test(room)
    && /saveLS\(roomRailKey\(entityId\), data\);\s*\n\s*if \(mayPaintRail\) setRail\(data\);/.test(room)
    // …and the late brief lands as an append onto the painted rail, never a setRail(d2) swap
    && /lateBrief: \{ text, at: d2\.entity\.briefAt \?\? null \}/.test(room) && !/setRail\(d2\)/.test(room));
  // RE-POINTED Sep 13 (cleanup): the `[^)]*` window assumed the key was an inline LITERAL and so
  // stopped at the first `)`. The room now calls the key PRODUCER (one author for one key — the
  // fake-warm drift class closed), which puts a paren inside the window; the law is unchanged and
  // the clause reads the whole call instead of guessing at its shape.
  gate('T2.5 the room never paints a cache too old to trust (the freshness floor pairs the freeze)',
    !!room && /loadLS<Detail>\(roomDetailKey\(entityId\), \{ maxAgeMs: ROOM_CACHE_MAX_AGE_MS \}\)/.test(room));

  // THE LOOSE ROOM — same door, same law (the deep-dive's /api/items/view read).
  const detail = read('components/home/item-detail.tsx');
  gate('T2.6 the loose room marks its mount read as the OPEN arrival',
    !!detail && detail.includes("from '@/lib/room/no-mutation'") && /refresh\('open'\)/.test(detail));
  gate('T2.7 the loose room paints only when the mechanism allows',
    !!detail && /const paint = mayReplaceInPlace\(reason, paintedRef\.current\);/.test(detail));

  // THE HOME DECK — a background arrival appends; it never rewrites or removes a painted row.
  const home = read('components/home/home-view.tsx');
  // RE-POINTED (Sep 13, proactive-reach LAW 6) and STRENGTHENED: the flag still decides, and the
  // law now states what it decides ABOUT — a live open. A mount's FIRST landing is this open's
  // opening truth and replaces; freezing it made the hydrate cache immortal (the served Home stood
  // still for a full day while the server was already right).
  gate('T2.8 the Home merge knows whether nobody asked (the background flag), and the open is an open',
    !!home && /function mergeBrief\(prev: Brief \| null, next: Brief, background = false\)/.test(home)
    && /mergeBrief\(briefRef\.current, b, background && !userCaused && !isFirstLanding\)/.test(home)
    && /const isFirstLanding = firstLandingRef\.current;/.test(home));
  gate('T2.9 a background arrival freezes the painted deck (freezeForOpen)',
    !!home && /background \? freezeForOpen\(prev, merged\) : merged/.test(home)
    && /function freezeForOpen\(/.test(home));
  gate('T2.10 frozen rows keep their seat and new rows APPEND (never a rewrite, never a removal)',
    !!mech && /\[\.\.\.prevRows, \.\.\.added\] : prevRows/.test(mech)
    && !!home && /freezeRows, freezeMap.*from '@\/lib\/room\/no-mutation'/.test(home));
  gate('T2.11 composed prose is frozen for the open (brief line, briefing, teasers, digests)',
    !!home && /briefLine: prose\(prev\.briefLine/.test(home) && /briefing: prose\(prev\.briefing/.test(home));
  gate('T2.12 the cleared-id reconcile reads the SERVED deck, not the raw payload',
    !!home && !/for \(const m of b\?\.mustRespond/.test(home) && /for \(const m of served\?\.mustRespond/.test(home));

  // THE EXCEPTIONS — explicitly-live run status the reader is watching, and in-flight streaming.
  const drawer = read('components/workflows/process-drawer.tsx');
  const ledger = read('components/workflows/workflows-ledger.tsx');
  gate('T2.13 THE LIVE RUN survives (the drawer + ledger keep polling while a run is live)',
    !!drawer && /useLiveRefresh\(shouldPoll/.test(drawer) && !!ledger && /useLiveRefresh\(anyLive/.test(ledger));
  const ask = read('components/home/home-ask.tsx');
  gate('T2.14 an in-flight reply still streams (the Home ask reads its SSE token frames)',
    !!ask && /token/.test(ask));

  // THE SHARED FREEZE — the three moves every holding surface makes live in the mechanism, so the
  // deck, the portfolio, the timeline and the report can't drift apart one private copy at a time.
  gate('T2.15 the mechanism owns the shared freeze helpers (rows · id-keyed chrome · prose)',
    !!mech && /export function freezeRows</.test(mech) && /export function freezeMap</.test(mech)
    && /export function freezeProse</.test(mech));
  {
    // A private copy is how the law dies — the mechanism module is the ONLY definition site
    // (the Home deck's pre-lift copies were folded in on Sep 6; the allowlist is gone for good).
    const copies: string[] = [];
    for (const dir of ['app', 'components', 'lib', 'hooks', 'context']) {
      for (const rel of sourceFiles(dir)) {
        if (rel === 'lib/room/no-mutation.ts') continue;
        const src = read(rel);
        if (src && /function freeze(Rows|Map|Prose)\s*</.test(src)) copies.push(rel);
      }
    }
    gate('T2.16 no consumer defines its own freeze helper (the mechanism is the only home)',
      copies.length === 0, copies.join(', '));
  }

  // THE PORTFOLIO — a poll may append a project; it may never rewrite a painted row's verdict words.
  const pv = read('components/entities/portfolio-view.tsx');
  gate('T2.17 the portfolio consults the mechanism (open holds · background appends)',
    !!pv && pv.includes("from '@/lib/room/no-mutation'")
    && /mayReplaceInPlace\(reason, !!painted\)/.test(pv)
    && /useLiveRefresh\(\(\) => load\('background'\)\)/.test(pv)
    && /load\('open'\)/.test(pv)
    && /freezeRows\(painted\.entities, d\.entities, \(e\) => e\.id\)/.test(pv));
  gate('T2.18 the portfolio saves every landing payload (a held payload is the next open’s paint)',
    !!pv && /saveLS\('aug-portfolio-v1', d\); setFresh\(true\);/.test(pv));
  gate('T2.19 the reader’s own deed still replaces in place (create · track · the row verbs)',
    !!pv && (pv.match(/load\('user'\)/g) ?? []).length >= 4);

  // ── THE PORTFOLIO SHOWS THE PAST, SUBTLY (owner walk, Sep 14: "missing the concluded, archived
  // etc? so user can still see all? maybe toggle/tabs? subtle") ─────────────────────────────────
  // The past used to live behind three status PILLS that hid themselves at zero and swapped the
  // whole list for a tab — so on most accounts concluded work was simply unreachable, and where it
  // was reachable the answer to "can I still see all of it?" was "only if you leave the living
  // list". Now it is a fold AT THE TAIL, in the same fold idiom the quiet tail already uses.
  // TWO LAWS: there is ONE home for the past, and the ACTIVE LIST NEVER MIXES.
  gate('T2.19a the past has a quiet door at the list’s tail (concluded · archived · muted, folded)',
    !!pv && /const \[pastOpen, setPastOpen\] = useState\(false\);/.test(pv)
    && /const past = live\.filter\(\(e\) => e\.status !== 'active' && matches\(e\)\)/.test(pv)
    && /Concluded &amp; archived · \{past\.length\}/.test(pv)
    // collapsed by default, and it only renders when there IS a past (no "· 0" noise)
    && /\{past\.length > 0 && \(/.test(pv) && /\{pastOpen && \(/.test(pv)
    // a concluded project is READABLE, not deleted — the row still opens its room (pinning law)
    && /past\.map\(\(e\) => \([\s\S]{0,200}onClick=\{\(\) => openDetail\(e\.id\)\}/.test(pv));
  gate('T2.19b the ACTIVE list never mixes — and the old status-tab lens is retired (one home)',
    !!pv && /const inTab = live\.filter\(\(e\) => e\.status === 'active' && matches\(e\)\)/.test(pv)
    && !/statusTab/.test(pv) && /const flat = searching;/.test(pv));

  // THE TIMELINE — both lenses over the same payload; a bar or a card must not move under the reader.
  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): components/timeline/timeline-view.tsx was proven
  // unreachable and retired; the Gantt is the only timeline lens left (T2.21 below). The law —
  // a background arrival may never re-lay what the reader is already reading — is asserted here on
  // the PORTFOLIO, the other list that paints rows and refreshes underneath them, so the gate still
  // covers two independent implementations of the freeze, not one.
  const pvm = read('components/entities/portfolio-view.tsx');
  gate('T2.20 a painted list holds a background arrival (rows append, never re-lay)',
    !!pvm && pvm.includes("from '@/lib/room/no-mutation'")
    && /mayReplaceInPlace\(reason, !!painted\)/.test(pvm)
    && /freezeRows\(painted\.entities, d\.entities, \(e\) => e\.id\)/.test(pvm)
    && /useLiveRefresh\(\(\) => load\('background'\)\)/.test(pvm));
  const tg = read('components/timeline/timeline-gantt.tsx');
  gate('T2.21 the Gantt holds a background arrival (lanes append; a painted lane freezes whole)',
    !!tg && tg.includes("from '@/lib/room/no-mutation'")
    && /freezeRows\(painted!\.ganttGroups, next\.ganttGroups, \(g\) => g\.id\)/.test(tg)
    && /useLiveRefresh\(\(\) => load\('background'\)\)/.test(tg));

  // THE DAY'S LANES — composed words; painted lines stay for the open.
  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): components/home/daily-report.tsx was proven
  // unreachable and retired. THE DECK is the day's report now, and it carries the same law at more
  // seams than the report ever did — one freezeForOpen, lane by lane, every lane keyed.
  const hv2 = read('components/home/home-view.tsx');
  gate('T2.22 the day’s lanes freeze on a background arrival (painted rows keep their words)',
    !!hv2 && hv2.includes("from '@/lib/room/no-mutation'")
    && /function freezeForOpen\(prev: Brief, next: Brief\)/.test(hv2)
    && /freezeRows\(prev\.commitments, next\.commitments, \(c\) => c\.id\)/.test(hv2)
    && (hv2.match(/freezeRows\(/g)?.length ?? 0) >= 6
    && /useLiveRefresh\(\(\) => load\(true\)\)/.test(hv2));
  gate('T2.23 a reader-asked refetch still REPLACES (the freeze guards BACKGROUND arrivals only)',
    !!hv2 && /return background \? freezeForOpen\(prev, merged\) : merged;/.test(hv2));
}

// ── T3 · THE ONE THREAD COMPONENT (P2a) ─────────────────────────────────────────────────────────
// "ONE thread component renders all three (timeline · header · composer · drawer). A thread kind
// is configuration, never a fork." The gates assert the STRUCTURE that makes the ports possible:
// the kit exists, it speaks the whole message grammar, the timeline carries the two derived laws
// (Slack grouping + the history fold), the motion budget honours reduced-motion, the kit is
// PRESENTATIONALLY PURE (no fetching, no supabase, no routing — hosts own every deed), and the
// dev harness that proves all three kinds can never render in production.
console.log('\nT3 · THE ONE THREAD COMPONENT — one kit, three kinds, presentational by construction');
{
  const KIT = 'components/thread';
  const types = read(`${KIT}/types.ts`);
  const timeline = read(`${KIT}/thread-timeline.tsx`);
  const cards = read(`${KIT}/thread-cards.tsx`);
  const composer = read(`${KIT}/thread-composer.tsx`);
  const headerC = read(`${KIT}/thread-header.tsx`);
  const shell = read(`${KIT}/thread-shell.tsx`);
  const avatar = read(`${KIT}/avatar-status.tsx`);

  gate('T3.1 the kit exists (types · timeline · cards · composer · header · shell · avatar)',
    !!types && !!timeline && !!cards && !!composer && !!headerC && !!shell && !!avatar);

  // The three thread kinds of the topology table — plus the loose room, the same component.
  gate('T3.2 the contract names the thread kinds and the avatar states',
    !!types && /export type ThreadKind = 'home' \| 'dm' \| 'project' \| 'item'/.test(types)
    && /export type AvatarStatus = 'idle' \| 'working' \| 'needs_you' \| 'blocked'/.test(types));

  // THE MESSAGE GRAMMAR — every organ's card kind, including the `custom` slot the ports mount
  // their existing rich components through (a port must be a mount, never a rewrite). "Working"
  // is deliberately NOT a card: heavy work in flight is the `working_line` timeline item (the
  // avatar state + one quiet line — the constitution's grammar table; a card form rendered a
  // doubled face inside its own bubble, caught by the browser walk).
  {
    // RE-POINTED (W4-A, Sep 22 — never weakened): `routine` RETIRED from the grammar. It was the
    // one kind with no producer in the product (smoke-threads T38.1, the inverse gate); a standing
    // responsibility renders as its standing-spec proposal card and in the `collection` kind's
    // list. The law is unchanged — every kind the contract declares has a render — it simply names
    // one kind fewer.
    const GRAMMAR = ['deliverable', 'approval', 'input', 'frame', 'proposal', 'invite', 'bulk', 'doc', 'custom'];
    const missingType = GRAMMAR.filter((k) => !types || !new RegExp(`kind: '${k}'`).test(types));
    const missingRender = GRAMMAR.filter((k) => !cards || !new RegExp(`case '${k}':`).test(cards));
    gate('T3.3 the type surface declares the FULL card grammar', missingType.length === 0, missingType.join(', '));
    gate('T3.4 every card kind has a render', missingRender.length === 0, missingRender.join(', '));
    const timeline = read('components/thread/thread-timeline.tsx');
    gate('T3.4b heavy work is the working_line ITEM, never a card (one concept, one home)',
      !!types && /type: 'working_line'/.test(types) && !/kind: 'working'/.test(types)
      && !!timeline && /case 'working_line':/.test(timeline) && !!cards && !/case 'working':/.test(cards));
    gate('T3.5 THE CARD SLOT exists (custom cards mount a host ReactNode, so ports need no rewrite)',
      !!types && /kind: 'custom';[\s\S]{0,120}node: ReactNode/.test(types) && !!cards && /card\.node/.test(cards));
  }

  // THE TIMELINE's two derived laws.
  gate('T3.6 the Slack grouping rule (a header renders only on a change of speaker)',
    !!timeline && /prev\.type === 'actor_bubble' && prev\.actorId === item\.actorId/.test(timeline)
    && /showHeader/.test(timeline));
  // ⚠️ RE-POINTED (owner, Sep 14, said twice: "the 'earlier' things I'm not sure it makes sense…
  // I'm not sure where to fit it or what value it brings but looks odd"). THE STREAM SHOWS THE
  // PRESENT: the record left the conversation for the ONE drawer, so the kit's fold has no producer
  // — and an unfed mechanism is a corpse, which is how a repealed law comes back by accident. The
  // gate now proves the PATH IS DELETED (the T8.16 idiom), at the kit and at both doors.
  gate('T3.7 the "earlier (N)" fold is REPEALED — no variant, no handle, no producer anywhere',
    !!timeline && !/foldIndex/.test(timeline) && !/foldedCount/.test(timeline)
    && !/setExpanded/.test(timeline)
    && !!types && /variant: 'day';/.test(types) && !/'day' \| 'fold'/.test(types)
    && sourceFiles('components').concat(sourceFiles('app'))
      .every((f) => !/variant: 'fold'/.test(read(f) ?? '')));
  gate('T3.8 the three grammars are all rendered (user bubble · actor bubble · muted event line)',
    !!timeline && /case 'user_bubble'/.test(timeline) && /case 'actor_bubble'/.test(timeline)
    && /case 'event_line'/.test(timeline));

  // THE MOTION BUDGET — spent on avatars and card arrival, and switched off on request.
  gate('T3.9 avatar motion honours prefers-reduced-motion (the ring AND the badge stop)',
    !!avatar && /@media \(prefers-reduced-motion: reduce\)/.test(avatar)
    && /aug-workring/.test(avatar) && /aug-needpulse/.test(avatar));
  gate('T3.10 the kit wears THE ONE FACE (it wraps worker-face, never forks the headshot)',
    !!avatar && /from '@\/components\/work\/worker-face'/.test(avatar));

  // A thread kind is CONFIGURATION — the shell may carry defaults, never a second thread.
  gate('T3.11 the shell composes header · timeline · composer in the 760px column',
    !!shell && /max-w-\[760px\]/.test(shell) && /<ThreadHeader/.test(shell)
    && /<ThreadTimeline/.test(shell) && /<ThreadComposer/.test(shell));

  // ── THE RING GUTTER — A STATUS IS NOT A THING A CONTAINER MAY SLICE ───────────────────────────
  // (owner screenshot, Sep 21: the working arc rendered cut off down its LEFT side in the Home chat,
  // mid-thought.) The avatar is the whole status system, and its working ring orbits OUTSIDE the
  // face's own box; the thread's reading column sits flush against the kit's scroller, and
  // `overflow-y-auto` makes the other axis `auto` too — so the arc was drawn exactly on the cut
  // line. THE CLASS: the ring's extent is owned by the avatar (one formula, exported) and RESERVED
  // by THE ONE SCROLLER, so every surface mounting the kit inherits the room and no host can forget
  // it. Three clauses: one source for the geometry, the scroller reserves it FROM that source (never
  // a copied number), and the reserve covers every face size the kit actually renders.
  {
    const shellSrc = shell ?? '';
    const avatarSrc = avatar ?? '';
    gate('T3.11b the ring\'s overhang has ONE source (avatar-status owns and exports the geometry)',
      /export function ringOverhang\(size: number\): number/.test(avatarSrc)
      && /export const AVATAR_RING_GUTTER = (\d+)/.test(avatarSrc)
      // WorkRing may not re-derive its own pad — a second formula is how the reserve goes stale.
      && /const pad = ringOverhang\(size\)/.test(avatarSrc)
      && !/Math\.max\(2, Math\.round\(size \* 0\.14\)\)[\s\S]{0,40}\n\s*const box/.test(avatarSrc));

    gate('T3.11c THE ONE SCROLLER reserves the ring gutter (from the constant, both sides, width returned)',
      /overflow-y-auto[\s\S]{0,240}paddingInline: AVATAR_RING_GUTTER/.test(shellSrc)
      && /marginInline: -AVATAR_RING_GUTTER/.test(shellSrc)
      && /import \{ AVATAR_RING_GUTTER \} from '\.\/avatar-status'/.test(shellSrc));

    // The reserve must cover the LARGEST face the kit renders — otherwise the law is true only for
    // the sizes that happened to exist the day it was written.
    {
      const gutter = Number((avatarSrc.match(/export const AVATAR_RING_GUTTER = (\d+)/) || [])[1] ?? 0);
      const sizes: number[] = [];
      for (const rel of sourceFiles(KIT)) {
        const src = read(rel) || '';
        for (const m of src.matchAll(/\bsize(?:\s*=|=\{)\s*(\d+)/g)) sizes.push(Number(m[1]));
      }
      const over = sizes.filter((s) => Math.max(2, Math.round(s * 0.14)) > gutter);
      gate('T3.11d the gutter covers EVERY face size the kit renders (the reserve can\'t go stale)',
        gutter > 0 && sizes.length > 0 && over.length === 0,
        `gutter=${gutter}px · sizes=${[...new Set(sizes)].sort((a, b) => a - b).join(',')}${over.length ? ` · uncovered=${[...new Set(over)].join(',')}` : ''}`);
    }
  }

  // PRESENTATIONAL PURITY — the kit never fetches, never talks to the DB, never routes. Every
  // deed is a callback from the host, where the commit door and the human-in-the-loop law live.
  {
    const impure: string[] = [];
    for (const rel of sourceFiles(KIT)) {
      const src = read(rel) || '';
      if (/\bfetch\(/.test(src)) impure.push(`${rel}: fetch`);
      if (/supabase/i.test(src)) impure.push(`${rel}: supabase`);
      if (/next\/navigation|useRouter\(/.test(src)) impure.push(`${rel}: routing`);
    }
    gate('T3.12 the kit is presentational (no fetch, no supabase, no router — callbacks only)',
      impure.length === 0, impure.join(', '));
  }

  // THE DEV HARNESS — the proof surface for all three kinds; never a production route.
  {
    const page = read('app/(main)/dev/thread-preview/page.tsx');
    const client = read('app/(main)/dev/thread-preview/preview-client.tsx');
    gate('T3.13 the dev harness exists and is DEV-ONLY (notFound outside development)',
      !!page && /process\.env\.NODE_ENV !== 'development'/.test(page) && /notFound\(\)/.test(page));
    gate('T3.14 the harness renders all three kinds through the ONE kit',
      !!client && /kind="project"/.test(client) && /kind="dm"/.test(client) && /kind="home"/.test(client)
      && /from '@\/components\/thread'/.test(client));
  }
}

// ── T4 · THE COWORKER DM PORT (P2b) ─────────────────────────────────────────────────────────────
// "The three existing chat surfaces port ONTO this component and their bespoke renderers retire."
// The first port: the coworker DM's in-thread surface (ActiveWorkerChat). A PORT IS A MOUNT, NEVER
// A REWRITE — the gates assert that the DM now renders THROUGH the kit (its own message column is
// gone, the timeline owns order + the Slack grouping), that every rich render it already had
// survives as a `custom` card rather than being rebuilt, that the composer it shares with the home
// box took the composer SEAT whole through the one slot, and that the seat stayed a SLOT (the kit
// still falls back to its own composer, so no second composer implementation was born).
// ⚠️ RE-POINTED WHOLESALE (W4-D, Sep 22 — THE RETIREMENT). The donor this section read,
// components/workers/tabs/worker-chat-tab.tsx, was proven unreachable by a real import graph (the
// whole /workers island is behind redirects) and retired with it. THE DM DID NOT DIE WITH ITS OLD
// RENDER — it is a MODE of the one live conversation surface, components/home/home-ask.tsx, which
// T5 already gates as a surface. So these gates keep only what is DM-SPECIFIC and would otherwise
// go unasserted: that the DM mode exists in the one surface at all, that the coworker's rich SSE
// payloads still reach a card, and that the DM's own doors (thread find-or-create, the painted
// turn cache, attach, mentions) are untouched. T4.5's honest successor records the ONE thing the
// retirement actually removed — see the DM gap in docs/retirement-census.md.
console.log('\nT4 · THE COWORKER DM — a MODE of the one surface, not a surface of its own');
{
  const dm = read('components/home/home-ask.tsx');
  const shell = read('components/thread/thread-shell.tsx');

  gate('T4.1 the DM is a CONFIGURATION of the one kit, never a second surface',
    !!dm && /from '@\/components\/thread'/.test(dm) && /<ThreadShell/.test(dm)
    && /kind=\{dmActor \? 'dm' : 'home'\}/.test(dm));

  // The DM has no message column of its own — it derives ThreadItem[] like every other mode.
  gate('T4.2 the DM derives ThreadItem[] instead of laying out its own bubble list',
    !!dm && /useMemo<ThreadItem\[\]>/.test(dm)
    && /type: 'user_bubble'/.test(dm) && /type: 'actor_bubble'/.test(dm));
  gate('T4.3 no second DM renderer was left behind (the retired island defines nothing)',
    !fs.existsSync(path.join(ROOT, 'components/workers/tabs/worker-chat-tab.tsx'))
    && !fs.existsSync(path.join(ROOT, 'components/workers/worker-profile.tsx'))
    && !fs.existsSync(path.join(ROOT, 'app/workers/workers-page-client.tsx')));

  // THE SLACK GROUPING is the kit's job — a private copy is how the law forks.
  gate('T4.4 grouping/attribution is the timeline’s, and the DM speaks in the COWORKER’s name',
    !!dm && !/showHeader/.test(dm) && /authorId: agentId/.test(dm));

  // A MOUNT, NEVER A REWRITE — the coworker's rich payloads ride the card slot.
  {
    const RICH: [string, RegExp][] = [
      ['the editable email card (the coworker draft the DM produces)', /node: <EmailCard coworker=/],
      ['the workflow draft card', /node: <WorkflowDraftCard/],
      ['the prepared invite card', /node: <InviteCard/],
    ];
    const missing = RICH.filter(([, re]) => !dm || !re.test(dm)).map(([label]) => label);
    gate('T4.5 the coworker’s rich payloads are MOUNTED through the card slot, not rebuilt',
      missing.length === 0, missing.join('; '));
    // THE ONE THING THE RETIREMENT REMOVED, stated rather than hidden: the typed render registry
    // (components/work/artifacts/registry.tsx) had exactly one reachable mount — the retired DM —
    // so an `artifact` frame now lands as a LINK card into the thread that holds it. That is the
    // live surface's DELIBERATE choice (its own comment says so), not an accident, and this gate
    // pins it so a future registry rebuild is a decision, never a silent regression.
    gate('T4.6 a typed `artifact` frame lands as a LINK card by design (the render registry has no live mount)',
      !!dm && /event\.type === 'artifact' && event\.artifact/.test(dm)
      && /no identity of its own in this/.test(dm)
      && !fs.existsSync(path.join(ROOT, 'components/work/artifacts/registry.tsx')));
  }

  // THE ANSWER STREAMS INTO THE VISIBLE BUBBLE, wearing the working face.
  gate('T4.7 the in-flight reply is a WORKING bubble in the coworker’s own seat',
    !!dm && /id: 'streaming'/.test(dm) && /status: 'working'/.test(dm));

  // THE COMPOSER STAYS — one composer, seated through the ONE slot.
  gate('T4.8 the composer seat exists in the shell and is a SLOT (the kit still falls back)',
    !!shell && /composerNode\?: React\.ReactNode/.test(shell)
    && /\{composerNode \?\? \(/.test(shell) && /<ThreadComposer placeholder=/.test(shell));
  gate('T4.9 the DM takes that seat with the ONE composer, defined once',
    !!dm && /composerNode=\{composerBlock\}/.test(dm)
    && (dm.match(/<WorkerMentionInput/g) ?? []).length === 1);

  // PARITY ANCHORS — the DM's own doors, which no render change may disturb.
  {
    const ANCHORS: [string, RegExp][] = [
      ['send + stream (POST the coworker thread\'s chat route)', /await fetch\(`\/api\/work\/threads\/\$\{tid\}\/chat`, \{/],
      ['attach (the chat-attach upload door)', /chat-attach`, \{ method: 'POST'/],
      ['@mention metadata rides the send', /extra\?\.mentions\?\.length \? \{ mentions: extra\.mentions \}/],
      ['the coworker→thread mapping (find-or-create skipped on reopen)', /saveLS\(dmKey\(agentId\), tid\)/],
      ['the painted-turn cache (the reopen paints before the fetch)', /loadLS<Turn\[\]>\(DM_TURNS_LS\(agentId\)\)/],
    ];
    const broken = ANCHORS.filter(([, re]) => !dm || !re.test(dm)).map(([label]) => label);
    gate('T4.10 the DM engine seams are untouched (send · stream · attach · mentions · thread + turn caches)',
      broken.length === 0, broken.join('; '));
  }
}

// ── T5 · THE LIVE CHAT SURFACE PORT (P2c) ───────────────────────────────────────────────────────
// The product's real conversation surface — components/home/home-ask.tsx — in BOTH its modes: the
// Home thread (durable chat: rooms, SSE streaming, refs, scope) and the coworker DM (first contact,
// the sovereign intake, the continuous thread). A RENDER-LAYER PORT: the message list and the
// header seat move onto the kit; every engine seam stays exactly where it was. The gates assert
// (a) the surface renders THROUGH the kit and keeps no bubble list of its own, (b) THE VOICE HAS A
// FACE — the Home thread's answers wear the CoS SEAT, resolved by the ONE resolver, never a name
// or headshot chosen here, (c) what rode with the user's words survives as chips on their bubble,
// and (d) the engine seams — streaming, the one-writer-per-turn persistence, THE FRESH FLOOR, the
// attach doors, the scope binding, the takeover — are untouched.
console.log('\nT5 · THE LIVE CHAT SURFACE — the Home thread and the coworker DM, through the ONE kit');
{
  const ask = read('components/home/home-ask.tsx');
  const seatLib = read('lib/workers/cos-seat.ts');
  const seatRoute = read('app/api/workers/cos-seat/route.ts');

  // (a) THE PORT — the kit renders both modes, and the bespoke renderer is gone.
  // ⚠️ RE-POINTED (owner walk, Sep 7): the kind now reads `dmActor`, the RENDER state that mirrors
  // `workerRoomRef` — a ref cannot move the takeover's geometry, and the DM pane needs the mode at
  // render time (T12). The law is unchanged: ONE component, two configurations, never a fork.
  gate('T5.1 the surface mounts the kit in BOTH configurations (home thread · coworker DM)',
    !!ask && /from '@\/components\/thread'/.test(ask) && /<ThreadShell/.test(ask)
    && /kind=\{dmActor \? 'dm' : 'home'\}/.test(ask));
  gate('T5.2 it derives ThreadItem[] instead of laying out its own bubbles',
    !!ask && /useMemo<ThreadItem\[\]>/.test(ask)
    && /type: 'user_bubble'/.test(ask) && /type: 'actor_bubble'/.test(ask));
  gate('T5.3 the bespoke bubble list is gone (no private bubble, no private grouping, no sentinel)',
    !!ask && !/<UserBubble/.test(ask) && !/function UserBubble\(/.test(ask)
    && !/turns\[i - 1\]\?\.author !== t\.author/.test(ask) && !/endRef/.test(ask));
  gate('T5.4 attribution is the kit’s (the surface never mounts a face of its own)',
    !!ask && !/WorkerFace/.test(ask) && !/showHeader/.test(ask));

  // A MOUNT, NEVER A REWRITE — the rich internals ride the card slot; a produced document speaks
  // the grammar's own deliverable card.
  {
    const RICH: [string, RegExp][] = [
      ['the ref-chipped answer with its typewriter', /node: <AnimatedAnswer/],
      // RE-POINTED Sep 8 (THE EMAIL CARD) — same law, the successor component.
      ['the editable email card', /node: <EmailCard coworker=/],
      ['the workflow draft card', /node: <WorkflowDraftCard/],
      ['the utterance chips (the sensible ask)', /id: `\$\{key\}-options`/],
      ['the in-flight token stream', /id: 'streaming-body'/],
    ];
    const missing = RICH.filter(([, re]) => !ask || !re.test(ask)).map(([l]) => l);
    gate('T5.5 every rich render is MOUNTED through the custom card slot, not rebuilt',
      missing.length === 0, missing.join('; '));
    gate('T5.6 a produced document arrives as the grammar’s own deliverable card',
      !!ask && /kind: 'deliverable', id: `\$\{key\}-doc-/.test(ask));
    gate('T5.7 the in-flight reply is a WORKING bubble, never a spinner in the stream',
      !!ask && /status: 'working'/.test(ask) && /id: 'streaming'/.test(ask));
  }

  // (b) THE CoS SEAT — one resolver, one door, no identity chosen at the surface.
  gate('T5.8 the seat door exists and serves the ONE resolver (auth’d, no second ladder)',
    !!seatRoute && /from '@\/lib\/workers\/cos-seat'/.test(seatRoute)
    && /resolveCosSeat\(supabase, user\.id\)/.test(seatRoute)
    && /auth\.getUser\(\)/.test(seatRoute) && /Unauthorized/.test(seatRoute));
  gate('T5.9 the resolver is still the only place the seat is decided',
    !!seatLib && /export async function resolveCosSeat\(/.test(seatLib)
    && /worker_role === 'personal_assistant'/.test(seatLib));
  // (P2d moved the read into ONE client hook — `hooks/use-cos-seat.ts` — so the room's pinned
  // brief wears the same seat from the same door; the surface still chooses no identity itself.)
  gate('T5.10 the surface WEARS the seat (read through the one hook, never a hardcoded name or headshot)',
    !!ask && /useCosSeat\(\)/.test(ask)
    && /cosSeat\?\.name/.test(ask) && /cosSeat\?\.agentId/.test(ask)
    && !/\/workers\/[a-z]+\.png/.test(ask) && !/ROLE_AVATARS/.test(ask));
  gate('T5.11 the seat label is the constant, and only an UNAUTHORED answer wears it',
    !!ask && /const seatLabel = cosSeat \? 'chief of staff' : undefined;/.test(ask)
    && /actorRoleLabel: t\.author \? undefined : seatLabel/.test(ask));
  {
    const seatHook = read('hooks/use-cos-seat.ts');
    gate('T5.12 identity is ambient — the seat caches AGELESS (no freshness demand)',
      !!seatHook && /loadLS<CosSeat>\(COS_SEAT_LS\)/.test(seatHook)
      && !/COS_SEAT_LS, \{ maxAgeMs/.test(seatHook));
  }

  // (c) WHAT RODE WITH THE WORDS — chips on the user's own bubble, through the kit's slot.
  gate('T5.13 user bubbles mount their attachment/mention chips through `cards`',
    !!ask && /id: `\$\{key\}-chips`/.test(ask) && /t\.chips\?\.length/.test(ask)
    && /const chips = \[\.\.\.files\.map/.test(ask));
  gate('T5.14 the brain still reads the turn AS SENT (the bubble’s clean text is presentation)',
    !!ask && /role: t\.role, text: t\.sent \?\? t\.text/.test(ask));

  // (d) THE COMPOSER SEAT — one composer, one definition, mounted in the seat and at rest.
  gate('T5.15 the composer takes the kit’s seat whole (composerNode), from ONE definition',
    !!ask && /composerNode=\{composerBlock\}/.test(ask) && /const composerBlock = \(/.test(ask)
    && (ask.match(/<WorkerMentionInput/g) ?? []).length === 1);

  // (e) THE ENGINE SEAMS — a render-layer port may not disturb a single one of them.
  {
    const SEAMS: [string, RegExp][] = [
      // RE-POINTED (Sep 21, THE STREAM NEVER RETYPES): the panel's four inline SSE branches became
      // ONE pure reducer (components/home/ask-stream.ts) and the NUL preview reset was RETIRED —
      // preamble text is now withheld from the bubble rather than wiped out of it. The seams
      // themselves are unchanged; they moved one file over, so the gate reads them there.
      ['the streaming ask (SSE token frames, folded through the pure reducer)',
        /st = askStreamReducer\(st, ev as AskStreamEvent\)/],
      ['the progress stage line', /setStage\(st\.stage\)/],
      ['THE ANSWER SURVIVES THE TAB (the server persists the moment the answer is composed)',
        /const sentRoomKey = temp \|\| workerRoomRef\.current \? null : chatRoomKey\(\);/],
      ['…and the client skips its own write when the key was sent (one writer per turn)',
        /if \(d\.answer && !sentRoomKey\) persistTurn\('system'/],
      ['the user turn persists to the chat room key', /persistTurn\('user', shown\)/],
      ['THE FRESH FLOOR (no implicit rehydration on landing — the stale key clears)',
        /THE FRESH FLOOR[\s\S]{0,900}localStorage\.removeItem\(CHAT_KEY_LS\)/],
      ['the worker-room load (the DM’s own store, never copied into room_turns)',
        /const loadWorkerRoom = async \(key: string\)/],
      // ⟲ RE-POINTED (W4.1, SPEECH IS COMPOSED): the intake keeps its seat on an email-off
      // workspace, keyed by ROLE (agnostic, never a first name) and rendered as chrome — a template
      // may not wear a face. The seam (who gets the intake) is what this row pins.
      ['the sovereign intake (the chief of staff\u2019s DM on an email-off workspace)',
        /features\.email === false && role === 'personal_assistant'/],
      ['the coworker stream (chat-attach upload → the thread’s SSE)',
        /chat-attach`, \{ method: 'POST', body: fd \}/],
      ['the chief attach lane (extract now, index into the knowledge base)',
        /extract-attach'[\s\S]{0,60}\)[\s\S]{0,4000}uploadToKB/],
      ['the scope binding (rooms/adopt) and the recognition nudge', /rooms\/adopt'[\s\S]{0,400}entityId/],
      ['the page takeover event', /'aug:chat-active'/],
    ];
    const broken = SEAMS.filter(([, re]) => !ask || !re.test(ask)).map(([l]) => l);
    gate('T5.16 the engine seams are untouched (stream · persistence · fresh floor · attach · scope)',
      broken.length === 0, broken.join('; '));
  }

  // THE TAKEOVER GEOMETRY stays the host's: the shell is bounded, so the thread scrolls INSIDE the
  // Home instead of the page scrolling under it, and the pin follows the kit's own scroller.
  gate('T5.17 the takeover mounts the shell bounded, and the pin follows the kit’s scroller',
    !!ask && /max-h-\[calc\(100vh-200px\)\]/.test(ask)
    && /shellRef\.current\?\.querySelector<HTMLElement>\('\.overflow-y-auto'\)/.test(ask));
}

// ── T6 · THE ROOM'S CONVERSATION (P2d) ──────────────────────────────────────────────────────────
// components/home/item-rail.tsx is the room's conversation pane, mounted by BOTH doors (the project
// room and the /item deep-dive, through RoomShell). A RENDER-LAYER PORT: the timeline moves onto
// the kit and the composed brief takes its constitutional seat as THE PINNED MESSAGE; every engine
// seam — turn persistence, the hydrate merge (server truth wins INCLUDING deletions), the steer/
// send path, supersession, the fold rules, the anchorKey seating — stays exactly where it was.
console.log('\nT6 · THE ROOM’S CONVERSATION — the rail, through the ONE kit, with a pinned brief');
{
  const rail = read('components/home/item-rail.tsx');
  const seatHook = read('hooks/use-cos-seat.ts');
  const askSurface = read('components/home/home-ask.tsx');

  gate('T6.1 the rail renders through the kit (ThreadShell + derived ThreadItem[])',
    !!rail && /from '@\/components\/thread'/.test(rail) && /<ThreadShell/.test(rail)
    && /const items: ThreadItem\[\] = \[\]/.test(rail));
  gate('T6.2 a thread kind is CONFIGURATION — the two doors are data, never a fork',
    !!rail && /kind=\{inRoom \? 'project' : 'item'\}/.test(rail));

  // THE PINNED BRIEF — the room's composed opening is the FIRST message, and there is no second
  // prose seat: the old free-standing brief paragraph and the separate MOVE banner are gone.
  // ⚠️ RE-POINTED (owner walk, Sep 14: "this can just look like a message, so remove border and
  // the 'pinned' label"). The law was ONE SEAT FOR THE ROOM'S OPENING, wearing the voice's face —
  // the badge was chrome announcing a mechanism, and it is repealed (anatomy: T28.19).
  gate('T6.3 the composed brief IS the room’s opening message (one seat, wearing a face, no badge)',
    !!rail && /type: 'pinned', id: 'brief'/.test(rail) && !/badge: 'Pinned'/.test(rail)
    && /const openingText = composed \?\?/.test(rail));
  // ⚠️ RE-POINTED (W4-A, Sep 22 — never weakened): THE MOVE IS THE KIT'S `proposal` CARD. It used
  // to be a bare ThreadAction pushed into the pinned bubble's action row — the last room object
  // with no kind of its own (docs/component-map.md §2). Every clause of the law is asserted on the
  // new seat: the target is still board-validated, the move's own words are still the deed, the
  // stage intent still rides the click ladder, and the card is seated in the pinned opening.
  gate('T6.4 THE MOVE is the pinned seat’s ONE deed, as the kit’s `proposal` card (board-validated target, the stage intent preserved)',
    !!rail && /const moveCard: ThreadCard \| null = \(\(\) => \{/.test(rail)
    && /kind: 'proposal', id: 'move'/.test(rail)
    && /confirmLabel: resp\.move\.label/.test(rail)
    && /\{moveCard && <div className="pt-0\.5"><ThreadCardView card=\{moveCard\} \/><\/div>\}/.test(rail)
    && /stageOfArtifactKey\(mergedArt\.key\), respMoveTargetId/.test(rail)
    // …and the old seat is really gone (no second move renderer anywhere in the rail)
    && !/pinnedActions/.test(rail));
  // ⟲ RE-POINTED (W3.5, Sep 22 — registry precedence #1: "the stitched field-assembly fallback is
  // dead"): the pre-compose fallback no longer exists to ride any seat. The composed brief reaches
  // the FIRST paint from the server path (briefBeforePaint); when it cannot, the seat speaks ONE
  // voice (the item's own ask) and the stored next_move never renders as a deed. The law this gate
  // held — no second opening anywhere — is asserted on the seat that remains.
  gate('T6.5 NO SECOND OPENING — the stitched fallback (stored next_move card · summary line · debt lines) is dead; the pinned seat speaks one voice',
    !!rail && !/fallbackMove/.test(rail) && !/label: `Next: \$\{ent\.nextMove\}`/.test(rail)
    && !/secondarySummary/.test(rail) && !/owesYou/.test(rail)
    && !/AssistantRow/.test(rail));
  // ⚠️ RE-POINTED (owner walk, Sep 14: "I think I had told you to remove the chips here too" — the
  // SAME call the calm Home took on Sep 13, now applied to rooms). The claim this gate held — the
  // offers render as composer chips — is REPEALED by the owner's word, so the gate now holds the
  // law that replaced it: the room's composer has no chip row at all, and the composed offers keep
  // their SERVING-side dedupe (T10.1) for whoever else reads them.
  gate('T6.6 THE COMPOSER IS THE ONLY DOOR — no offer-chip row in the room (retired Sep 14)',
    !!rail && !/offerChips/.test(rail) && !/onClick=\{\(\) => void send\(o\.say\)\}/.test(rail)
    && /composerNode=\{composerBlock\}/.test(rail)
    && /THE CHIPS ARE RETIRED FROM THE ROOM/.test(rail));

  // THE FACE OF THE VOICE — one seat, one hook, no identity chosen in the room.
  gate('T6.7 the pinned face rides the ONE seat hook (never a hardcoded name or headshot)',
    !!rail && /useCosSeat\(\)/.test(rail)
    && /const seatLabel = seat \? 'chief of staff' : undefined;/.test(rail)
    && !/ROLE_AVATARS/.test(rail) && !/\/workers\/[a-z]+\.png/.test(rail));
  gate('T6.8 ONE useCosSeat implementation (home-ask keeps no private copy)',
    !!seatHook && /export function useCosSeat\(\)/.test(seatHook)
    && !!askSurface && !/const \[cosSeat, setCosSeat\]/.test(askSurface)
    && /import \{ useCosSeat \} from '@\/hooks\/use-cos-seat'/.test(askSurface));

  // THE THREE GRAMMARS, structurally derived — and narration stays FACELESS BY GRAMMAR.
  gate('T6.9 authorless narration maps to event_line (no face render on a narration turn)',
    !!rail && /if \(!t\.author\?\.name && !hasComponent\) \{/.test(rail)
    && /items\.push\(\{ type: 'event_line', id: key, text: t\.text, \.\.\.\(lineRefs\.length \? \{ refs: lineRefs \} : \{\}\) \}\);/.test(rail)
    && !/<img src=\{ROLE_AVATARS/.test(rail));
  gate('T6.10 a coworker’s own speech is an actor bubble with THEIR face (the one-narrator law)',
    !!rail && /actorName: t\.author\?\.name \? t\.author\.name\.split\(' '\)\[0\] : seatName/.test(rail));

  // A COMPONENT IS A TURN — the anchorKey seating survives, and the rich renders are MOUNTED.
  gate('T6.11 artifact cards still seat at their anchor turn’s chronological moment',
    !!rail && /const anchoredByKey = new Map<string, NonNullable<typeof artifacts>>\(\)/.test(rail)
    && /if \(a\.anchorKey && visibleDkeys\.has\(a\.anchorKey\)\)/.test(rail)
    && /if \(t\.dkey && anchoredByKey\.has\(t\.dkey\)\)/.test(rail)
    && /const endArtifacts = streamArts\.filter/.test(rail));
  {
    const MOUNTED: [string, RegExp][] = [
      // RE-POINTED (W3-C, Sep 22 — docs/component-map.md §2 item 7): the hand-drawn
      // components/work/decision-card.tsx is gone; the rail mounts the decision's ONE HOST, which
      // mounts the kit's `decision` card. Same seat, same seam — the law is unchanged.
      ['the decision card (the ONE host, firing the ONE steer door)', /node: \(\s*<DecisionCard/],
      ['the workflow draft card', /<WorkflowDraftCard draft=\{t\.workflowDraft\}/],
      ['the standing-spec card (ONE Confirm)', /Confirm — start it/],
      // RE-POINTED (W3-A, Sep 22 — docs/component-map.md §2a): both objects converged onto the kit.
      // The rail no longer DRAWS a gate or an ask, so "mounted whole" is now literally true of them:
      // it mounts the two hosts, which mount the kit's `approval` / `input` cards.
      ['the approval gate (the ONE host, firing the ONE resume door)', /<ApprovalCard\s/],
      ['the engine ask (the ONE host, carrying its never-blocking door)', /askCard\(\{ \.\.\.liftedAsk, text: '' \}, 'lifted-ask'\)/],
      ['a prepared artifact as the grammar’s own deliverable card', /kind: 'deliverable', id: `card-\$\{art\.key\}`/],
    ];
    const missing = MOUNTED.filter(([, re]) => !rail || !re.test(rail)).map(([l]) => l);
    gate('T6.12 every rich component is MOUNTED WHOLE (custom/deliverable cards), not rebuilt',
      missing.length === 0, missing.join('; '));
  }

  // THE RECORD — the brief watermark still decides WHAT is history; the DRAWER is now where it
  // lives (RE-POINTED Sep 14: the rail pushes no fold divider and renders no history in the
  // stream — it REPORTS the record, and the host files it. One seam, both doors).
  gate('T6.13 the fold rules are untouched, and the record is REPORTED, never rendered in the stream',
    !!rail && /const isExpiredNarration =/.test(rail) && /const isOrphanPrep =/.test(rail)
    && /const isDeadAsk =/.test(rail)
    && /const historyTurns = stream\.filter\(\(t\) => !visibleSet\.has\(t\)\);/.test(rail)
    && /onHistoryRef\.current\?\.\(historyLinesRef\.current\);/.test(rail)
    // …and nothing pushes history items or a fold handle into the timeline any more
    && !/type: 'divider', id: 'fold'/.test(rail)
    && !/historyTurns\.forEach/.test(rail));
  gate('T6.14 heavy work in flight is the working line, never a spinner in the stream',
    !!rail && /type: 'working_line'/.test(rail) && !/animate-bounce/.test(rail));

  // THE ENGINE SEAMS — a render-layer port may not disturb one of them.
  {
    const SEAMS: [string, RegExp][] = [
      ['durable persistence (every write POSTs to the ONE turns table)', /function persistTurn\(roomKey: string/],
      ['the hydrate merge — SERVER TRUTH WINS INCLUDING DELETIONS',
        /SERVER TRUTH WINS — INCLUDING DELETIONS[\s\S]{0,900}const inFlight = local\.filter/],
      // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the key is the DOOR's (lib/room/door.ts
      // roomKeyForDoor) — entity id on the entity door, `<kind>:<id>` on every item door; the
      // linked entity's id never wins on an item door. smoke-one-door owns the rule's pure tests.
      ['the one room-key convention (entity id · `<kind>:<id>` item door)', /const roomKey = roomKeyForDoor\(door\);/],
      ['the steer/send core (one door for typed words, chips and picks)', /'\/api\/items\/steer'/],
      ['THE PARITY LAW — a chat-approved send fires the ONE send door', /send-reply`, \{/],
      ['the ingest funnel (attach lands in the per-item pool)', /'\/api\/items\/ingest'/],
      // RE-POINTED Sep 8: the reply exchange's own offer→pick chips retired INTO the email card,
      // so the rail no longer authors one — the EPHEMERAL MACHINERY itself (a keyed live turn that
      // never persists, and its drop) is what this seam guards, and it is intact.
      ['the ephemeral scaffolding machinery (a keyed live turn that never persists, and its drop)',
        /ephemeral\?: boolean \}\): void \{[\s\S]{0,600}if \(!opts\?\.ephemeral\) persistTurn\(/],
      ['the one-navigation law (the host’s in-room opener before any push)', /const go = \(href: string\) => \{ if \(onOpenHref\?\.\(href\)\) return;/],
      // ⟲ RE-POINTED (W3.5 (b), Sep 22): the table gained one input — the rail STATES that a card
      // for the move is mounted, the table DECIDES (registry precedence #10). Same seam, one more fact.
      ['the placement table decides suppression, not this component', /panelPlan\(\{ hasDecision: decisionIsPrimary, moveCardMounted: !!cardForMove \}\)/],
    ];
    const broken = SEAMS.filter(([, re]) => !rail || !re.test(rail)).map(([l]) => l);
    gate('T6.15 the engine seams are untouched (persist · hydrate · steer · ingest · navigation)',
      broken.length === 0, broken.join('; '));
  }

  // BOTH DOORS still mount the ONE rail — the port may not fork the room.
  {
    const detail = read('components/home/item-detail.tsx');
    const room = read('components/entities/entity-room.tsx');
    gate('T6.16 both doors mount the one rail (deep-dive · project room)',
      !!detail && /<ItemRail /.test(detail) && !!room && /<ItemRail\b/.test(room));
  }
  {
    // THE P2d WALL, CLOSED: a narration's ref survives onto its event line as a quiet inline
    // WORD (law 8), filtered by the self-target rule and routed through the one navigation door.
    const types = read('components/thread/types.ts');
    const timeline = read('components/thread/thread-timeline.tsx');
    gate('T6.17 event lines carry refs as words (kit renders them; the rail passes them through go())',
      !!types && /refs\?: Array<\{ label: string; onClick\?: \(\) => void \}>/.test(types)
      // RE-POINTED (Sep 19, clause 5): the renderer drops blank-labelled refs BEFORE it joins their
      // separators — the dangling " ·" class. The gate asserts the filter, never just a map.
      // RE-POINTED AGAIN (Sep 22, T41): the muted line was extracted into the kit's ONE `EventLine`
      // piece so the trace line renders through it too — the filter-before-join moved WITH it, and
      // the law is unchanged (a blank-labelled ref never joins its separator).
      && !!timeline && /refs\?\.filter\(\(r\) => !!r\.label\?\.trim\(\)\)\.map/.test(timeline)
      && !!rail && /lineRefs/.test(rail) && /onClick: \(\) => go\(r\.href as string\)/.test(rail));
  }
}

// ── T7 · THE HEADER AND THE SUMMONED DRAWER (P3) ────────────────────────────────────────────────
// The entity room's docked right pane is COLLAPSED: one quiet header line of chrome, and the filed
// truth summoned into a 420px slide-over. The pane's last piece of speech — the amber watch-outs
// block — relocates into the ONE composed brief, so a warning is spoken by the room's single voice
// instead of shouted beside it.
console.log('\nT7 · THE HEADER + THE DRAWER — the right pane collapses; the watch-out becomes speech');
{
  const room = read('components/entities/entity-room.tsx');
  const detailSrc = read('components/home/item-detail.tsx');
  // THE ONE FILED DRAWER — the pane both doors mount (owner, Sep 14).
  const drawer = read('components/room/filed-drawer.tsx');
  const shell = read('components/room/room-shell.tsx');
  const grounding = read('lib/room/grounding.ts');
  const brief = read('lib/room/brief.ts');
  const statusBrief = read('lib/entities/status-brief.ts');

  // THE HEADER — name · state dot · faces · the handle. One line, and NOTHING in it narrates.
  gate('T7.1 the room opens with ONE header line (name · state dot · faces · handle)',
    !!room && /<header className="flex-shrink-0 flex items-center gap-3 h-\[52px\]/.test(room)
    // (ONE COLOR PER FACT — the momentum tone lives in the one vocabulary, states.ts; T10.14.)
    && /Click to rename/.test(room) && /\$\{m\.dot\}/.test(room) && /<FacePile faces=\{faces\}/.test(room));
  {
    // Read the header's OWN slice — the rest of the room may legitimately reason over these fields
    // (the hand-off uses next_move); what is outlawed is CHROME that narrates.
    const header = room?.match(/<header className="flex-shrink-0[\s\S]*?<\/header>/)?.[0] ?? '';
    gate('T7.2 the header carries NO prose (no summary, no brief, no next-move line in the chrome)',
      !!header && !/summary/.test(header) && !/whatItIs|priorityNow|brief/.test(header)
      && !/nextMove/.test(header));
  }
  gate('T7.3 the faces are DERIVED from what the room already serves (no second store, no new read)',
    !!room && /const faces = \(\(\) => \{/.test(room)
    // ⚠️ RE-POINTED (Sep 7): the gate pinned the literal collection cap (`>= 4`). The cap moved to
    // the PILE (it shows 4 and speaks "+N"), the law did not — what matters is that the faces are
    // derived from served state under SOME bound, and that no second read was invented.
    && /statusBrief\?\.people/.test(room) && /out\.length >= \d+/.test(room)
    && !/fetch\('\/api\/people/.test(room));

  // THE PANE IS GONE — the stage mounts only for a focused artifact, and a null stage means the
  // conversation is the whole room (the shell's own law, so no door can re-dock a pane by accident).
  gate('T7.4 no docked pane: the stage mounts ONLY for a focused artifact',
    !!room && /stage=\{[\s\S]{0,400}e && focused \? \(/.test(room) && /\) : null\s*\n\s*\}/.test(room));
  gate('T7.5 the shell treats a null stage as a full-width conversation',
    !!shell && /const hasStage = stage !== null/.test(shell)
    && /hasStage\s*\n?\s*\? 'hidden lg:flex flex-1/.test(shell) && /: 'flex flex-1 min-w-0/.test(shell)
    && /stage: React\.ReactNode \| null;/.test(shell));

  // THE HANDLE + THE DRAWER — summoned, viewport-fixed (THE OVERLAY LAW), three ways out.
  // ⚠️ RE-POINTED (owner walk, Sep 15: "Filed — weird label, find something easier to understand").
  // The handle's WORD is now imported from the one drawer module (FILED_LABEL), so the two doors and
  // the pane's own title cannot drift. The LAW is untouched — a handle exists, it toggles the one
  // drawer, and it wears the active mark while open — and it gained a clause: no door may hardcode
  // the pane's name any more.
  gate('T7.6 the Details handle exists and toggles the drawer (indigo while open), and its WORD is imported — never hardcoded',
    !!room && /<FiledIcon \/>\{FILED_LABEL\}/.test(room) && !/<FiledIcon \/>Filed/.test(room)
    && /import \{ FiledDrawer, RoomHistorySection, FILED_LABEL,/.test(room)
    && /setDrawerOpen\(\(v\) => !v\)/.test(room)
    && /drawerOpen \? 'border-indigo-300 bg-indigo-50 text-indigo-700'/.test(room));
  // ⚠️ RE-POINTED (owner, Sep 14: "the component is different across projects, loose items… now
  // we're screwed as you have to double or triple the maintenance work. very sloppy."). The pane
  // itself is ONE component and both doors mount it, so T7.7 / T7.8 / T7.11 / T15.9 / T15.10 /
  // T15.11 / T28.25 now assert the SAME laws at their one implementation — never weakened, just
  // pointed at the file that actually holds them. What stays door-local is the DATA.
  gate('T7.6b the project door mounts THE ONE drawer and passes it SECTIONS, never a second pane',
    !!room && !!drawer && /<FiledDrawer$/m.test(room)
    && /import \{ FiledDrawer, RoomHistorySection, FILED_LABEL, type FiledSection, type RoomHistoryLine \} from '@\/components\/room\/filed-drawer'/.test(room)
    && /sections=\{\(\[/.test(room)
    // the old bespoke pane is GONE from this file (no aside, no scrim, no keyframes of its own)
    && !/aug-drawer absolute top-0 right-0/.test(room)
    && !/@keyframes aug-drawer-in/.test(room));
  // ⚠️ RE-POINTED (owner walk, Sep 14: the drawer was visibly cramped — titles truncating). The
  // LAW here is the OVERLAY law (fixed to the viewport, escaping every clipping ancestor) plus
  // "it is a slide-over, not a docked pane" — never the specific number. The width is now the
  // reader's, clamped and persisted (T28.25); this gate keeps the part that was actually the law.
  gate('T7.7 the drawer is a slide-over fixed to the VIEWPORT (escapes every clipping ancestor), sized by the reader',
    !!drawer && /className="fixed inset-0 z-40"/.test(drawer)
    && /style=\{\{ maxWidth: filedW \}\}/.test(drawer)
    && /border-l border-neutral-200\/80/.test(drawer) && /shadow-\[-12px_0_32px/.test(drawer)
    // …and the project door still gates it on having something to file
    && !!room && /\{e && d && \(/.test(room));
  gate('T7.8 the drawer closes three ways — X · Escape · a click outside (never mouse-leave)',
    !!drawer && /onClick=\{\(\) => onClose\(\)\} className="flex-shrink-0 text-neutral-400/.test(drawer)
    && /ev\.key === 'Escape'\) onClose\(\)/.test(drawer)
    && /className="absolute inset-0" onClick=\{\(\) => onClose\(\)\}/.test(drawer)
    && !/onMouseLeave=/.test(drawer)
    // both doors hand it the same close deed
    && !!room && /onClose=\{\(\) => setDrawerOpen\(false\)\}/.test(room)
    && !!detailSrc && /onClose=\{\(\) => setDrawerOpen\(false\)\}/.test(detailSrc));
  gate('T7.9 the drawer holds the inventory: tabs + counts · goals/rules ONLY when set · deliverables',
    // ⚠️ RE-POINTED (Sep 15): the tab row gained ICONS (leading the label, the kit's own optional)
    // and the intent band lost the `intentOpen` flag with the ⋯ row that set it. Both clauses of the
    // law stand: the counts still ride the labels, and goals/rules still render ONLY when set.
    !!drawer && /<TabBar tabs=\{sections\.map\(\(s\) => \(\{ id: s\.id, label: s\.label, \.\.\.\(s\.icon \? \{ icon: s\.icon \} : \{\}\) \}\)\)\} active=\{activeId\}/.test(drawer)
    && !!room && /label: 'Tasks' \+ \(d\.counts\.total \? ` · \$\{d\.counts\.total\}` : ''\)/.test(room)
    && /\(e\.goals\.length > 0 \|\| e\.rules\.length > 0\) \? \(/.test(room)
    && /<DeliverablesBlock deliverables=\{d\.statusBrief\.deliverables\}/.test(room));
  gate('T7.10 the address still decides the first open (?tab=work lands on Tasks, ?tab=timeline on Activity)',
    !!room && /useState\(initialTab === 'work' \|\| initialTab === 'timeline'\)/.test(room)
    && /const initialSection = initialTab === 'timeline' \? 'history' : 'work';/.test(room)
    && /initialId=\{initialSection\}/.test(room)
    && !!drawer && /const \[tab, setTab\] = useState<string>\(initialId \?\? ''\);/.test(drawer));
  gate('T7.11 the reduced-motion floor holds for the drawer’s own animation',
    !!drawer && /prefers-reduced-motion: reduce[\s\S]{0,120}aug-drawer/.test(drawer));

  // A WARNING IS SPEECH — the amber block is gone from the room AND from the assembly that fed it.
  gate('T7.12 watch-outs render NOWHERE in the room (the amber block and its field are gone)',
    !!room && !/watchOuts/i.test(room) && !/WATCH-OUTS/.test(room) && !/Watch-outs/.test(room));
  gate('T7.13 the filed assembly no longer carries a warning (inventory only)',
    !!statusBrief && !/watchOuts/.test(statusBrief) && /a warning is SPEECH/i.test(statusBrief));

  // …and it arrives at the ONE composer instead: grounding → sig → prompt law.
  gate('T7.14 the grounding carries the blocker (entity.blocking → the WATCH-OUT line)',
    !!grounding && /blocking: string \| null;/.test(grounding)
    && /blocking\?: string \| null;/.test(grounding)
    && /WATCH-OUT \(what is blocking this work right now\)/.test(grounding));
  gate('T7.15 the brief’s SIG moves with the blocker (appearing or clearing recomposes the opening)',
    !!brief && /const blockingDigest = \(g\.entity\?\.blocking \?\? ''\)/.test(brief)
    // RE-POINTED (Sep 8, T22): the law is that the blocker is PART OF THE SIG — the groundDigest
    // now sits between it and lastTurn. Assert membership in the joined sig, not a neighbour.
    && /return \[ROOM_BRIEF_VERSION[^\]]*\bblockingDigest\b[^\]]*\]\.join\('::'\)/.test(brief));
  gate('T7.16 the composer speaks a blocker INSIDE the position, never as a standalone alarm',
    !!brief && /THE WATCH-OUT IS SPEECH, NOT AN ALARM/.test(brief)
    && /never a label or header/.test(brief));
  {
    // A version pin breaks on every later bump — assert the FLOOR (the versioned-gate lesson).
    const v = brief?.match(/export const ROOM_BRIEF_VERSION = (\d+)/)?.[1];
    gate('T7.17 ROOM_BRIEF_VERSION was bumped for the prompt change (≥ 7)', !!v && Number(v) >= 7,
      v ? `found ${v}` : 'not found');
  }
}

// ── T9 · THE SIDEBAR LISTS CONVERSATIONS, NOT MODULES (P4b) ─────────────────────────────────────
console.log('\nT9 · THE SIDEBAR LISTS CONVERSATIONS — honest badges, one address, quiet modules');
{
  const sb = read('components/one/one-sidebar.tsx');
  gate('T9.0 the sidebar exists', !!sb);

  // ONE ADDRESS PRODUCER — a project thread's href is never hand-rolled here.
  gate('T9.1 the sidebar imports projectHref and hand-rolls no /project/ address',
    !!sb && /import \{ projectHref \} from '@\/lib\/room\/project-href'/.test(sb)
    && /projectHref\(/.test(sb) && !/['"`]\/project\/\$\{/.test(sb));

  // THE SECTION ITSELF — project threads, coworker DMs, the rest of the conversed-in rooms.
  // ⚠️ RE-POINTED (owner, Sep 7 — "wouldn't 'Your team' be a way to simplify the nav instead of 3
  // extra rows? as we scale coworkers, having multiple rows is weirder"). The section holds
  // PROJECT THREADS and CHAT SESSIONS; the coworkers live behind the ONE footer door.
  gate('T9.2 TWO labeled sections — PROJECTS and CHATS, each with its own All→ trailer (the Sep 7 separation: places and passing conversations are different kinds) — and NO per-coworker rows',
    !!sb && />Projects</.test(sb) && />Chats</.test(sb) && !/>Conversations</.test(sb)
    && /projectRows\.map\(/.test(sb) && /otherRows\.map\(/.test(sb)
    && !/coworkerRows/.test(sb));

  // BADGES ARE HONEST OR ABSENT — every number rendered is a served count, never a literal.
  gate('T9.3 the Home badge is the DECK’s own served count (dayProgress.needYou), age-gated',
    !!sb && /dayProgress\?\.needYou/.test(sb) && /BRIEF_LS_KEY, \{ maxAgeMs: BRIEF_MAX_AGE_MS \}/.test(sb)
    && /needsYou !== null && \(/.test(sb));
  gate('T9.4 no badge renders without a real count behind it (no literal badge numbers)',
    !!sb && /\(rooms\.workflowsUnread \?\? 0\) > 0 && \(/.test(sb)
    // A badge/count span whose child is a hard-coded number would be the lying door.
    && !/tabular-nums[^>]*>\s*\d+\s*</.test(sb));

  // THE QUIET GROUP — module doors, one step back, feature-gated per the tier law.
  gate('T9.5 the quiet module group holds Workflows · Inbox · Meetings · Documents',
    !!sb && />Workflows</.test(sb) && />Inbox</.test(sb) && />Meetings</.test(sb) && />Documents</.test(sb)
    // The doors name the REAL surfaces (both /workflows and /drive are redirect seats).
    && /href="\/home\?view=workflows"/.test(sb) && /href="\/documents"/.test(sb));
  gate('T9.6 every module row is FEATURE-GATED (studio · email · meetings · drive)',
    !!sb && /\{features\.studio && \(/.test(sb) && /\{features\.email && \(/.test(sb)
    && /\{features\.meetings && \(/.test(sb) && /\{features\.drive && \(/.test(sb));

  // THE HONEST DOT + THE HONEST STATE — the one momentum vocabulary; a working ring only on a
  // real live run (the presence route's own state line), never on a guess.
  gate('T9.7 the project dot speaks the ONE momentum vocabulary and defaults to unknown',
    !!sb && /import \{ momentumOf \} from '@\/lib\/work-items\/states'/.test(sb)
    && /momentumOf\(momentum\[p\.id\] \?\? 'unknown'\)/.test(sb));
  gate('T9.8 the coworker "working" state is a REAL signal (presence says a run is live)',
    !!sb && /startsWith\('Running'\)/.test(sb)
    && /status=\{working \? 'working' : 'idle'\}/.test(sb));

  // ⚠️ RE-POINTED (owner, Sep 7 — the INVERSION): the nav does not grow a row per coworker. ONE
  // footer door carries the whole team, so a roster of thirty costs the same one row as three.
  gate('T9.8a THE TEAM IS ONE DOOR — no per-coworker nav rows, and the per-session `coworker` kind stays excluded everywhere',
    !!sb && !/coworkerRows/.test(sb)
    && /\.filter\(\(c\) => c\.kind !== 'coworker'/.test(sb)
    && !/kind === 'coworker'\)\.slice/.test(sb));
  gate('T9.8b the footer "Your team" row IS the coworker door — the kit’s avatar grammar, each roster row a DM',
    !!sb && />Your team</.test(sb)
    && /import \{ AvatarStatus \} from '@\/components\/thread\/avatar-status'/.test(sb)
    // the collapsed pile and the popover rows both wear the kit's face + live status
    && (sb.match(/<AvatarStatus /g) ?? []).length >= 2
    && /onClick=\{\(\) => dmWorker\(w\)\}/.test(sb)
    && /const dmWorker = \(w: TeamMate\)[\s\S]{0,300}new CustomEvent\('aug:dm-worker'/.test(sb));
  gate('T9.8b-i the door keeps its manage seat (Settings → Team) and claims NO unread badge (no per-DM read marker exists)',
    !!sb && /href="\/settings\?tab=team"/.test(sb)
    && !/rooms\.unread\?\.\[w\.id\]/.test(sb));
  gate('T9.8c the blocks are CAPPED and the rest live behind their doors (projects ≤6 · chats ≤3)',
    !!sb && /const PROJECT_ROWS_MAX = 6;/.test(sb) && /\.slice\(0, PROJECT_ROWS_MAX\)/.test(sb)
    && /const CHAT_ROWS_MAX = 3;/.test(sb) && /\.slice\(0, CHAT_ROWS_MAX\)/.test(sb));

  // THE DOORS THAT MUST SURVIVE — the projects grid and the All-conversations view.
  gate('T9.9 the projects grid stays reachable and All conversations keeps its destination',
    !!sb && /href="\/home\?view=projects"/.test(sb) && /href="\/home\?view=conversations"/.test(sb));

  // THE FRESH FLOOR — the sidebar Home click is still the complete reset, not a navigation.
  gate('T9.10 the Home reset behaviour is intact (same-path reset event + the focus intent)',
    !!sb && /augmtd:home-reset/.test(sb) && /aug-home-focus-intent/.test(sb)
    && /e\.preventDefault\(\);\s*\n\s*window\.dispatchEvent\(new CustomEvent\('augmtd:home-reset'\)\)/.test(sb));

  // NO NEW HEAVY READ — the sidebar rides what the shell already serves.
  {
    // The row's own deeds (rename/delete/restore) are the user's writes and stay; what must NOT
    // appear is a new READ — the badge and the dot ride caches the shell already fills.
    const WRITES = ['/api/rooms/title', '/api/rooms/restore', '/api/room/turns'];
    const reads = [...(sb ?? '').matchAll(/fetch\('(\/api\/[^'?]+)/g)].map((m) => m[1])
      .filter((u) => !WRITES.includes(u));
    gate('T9.11 the sidebar adds no new READ (rooms/recent + workers/presence only)',
      !!sb && reads.length > 0 && reads.every((u) => u === '/api/rooms/recent' || u === '/api/workers/presence'),
      reads.join(', '));
  }
  gate('T9.12 the badge and the dot read the caches the shell already writes (no third fetch)',
    !!sb && /loadLS<CachedBrief>\(BRIEF_LS_KEY/.test(sb) && /loadLS<CachedPortfolio>\(PORTFOLIO_LS_KEY\)/.test(sb));
}

// ── T8 · THE CALM HOME (P4a) ────────────────────────────────────────────────────────────────────
// "Home = one speaker, everything else whispering." The gates hold the shape the calm depends on:
// THE DENSITY LAW is structural (one prose element · a capped whisper map · one door), THE RECEIPT
// GRAMMAR is MAPPED from served state and never authored per row, the whispers ride the deck's OWN
// doors, and the full deck plus everything that moved behind the fold still renders there.
console.log('\nT8 · THE CALM HOME — one sentence, five whispers, one door');
{
  const calm = read('lib/home/calm.ts');
  const home = read('components/home/home-view.tsx');
  const row = read('components/work/work-row.tsx');
  const agenda = read('lib/home/agenda.ts');

  // THE DENSITY LAW — the cap lives in ONE place and is enforced by the pick itself.
  gate('T8.1 the calm module owns the fold’s cap (CALM_MAX_WHISPERS = 5, enforced by pickWhispers)',
    !!calm && /export const CALM_MAX_WHISPERS = 5;/.test(calm)
    && /export function pickWhispers\([\s\S]{0,900}if \(out\.length >= Math\.max\(0, max\)\) break;/.test(calm));
  // A NAMED FIRE IS A SEATED FIRE (owner walk, Sep 8 — re-pointed from the Sep 7 band-only law):
  // the fire is the FIRST key in every lane; the Sep 7 band law survives BELOW the fire line.
  gate('T8.1a the pick seats FIRES first (all lanes), then bands people-facing work above chores',
    !!calm && /export const isPeopleFacing = \(item: DoItem\): boolean => item\.source !== 'notice';/.test(calm)
    && (() => {
      const seg = calm!.slice(calm!.indexOf('export function pickWhispers('), calm!.indexOf('// ── THE DOOR'));
      // RE-POINTED Sep 13 (census fix #9): the gate pinned the key CHAIN as one literal string, so
      // it broke the moment a legitimate key was added between the band and the served order — the
      // exact-pin class (the `VERSION = N` lesson, applied to a sort). What the law actually says is
      // an ORDER: the fire key first, the band key second, the deck's own served order LAST. That is
      // what is asserted now — by position, so a new tiebreaker can seat without weakening anything.
      const fire = seg.indexOf('Number(!a.it.overdue) - Number(!b.it.overdue)');
      const band = seg.indexOf('Number(!isPeopleFacing(a.it)) - Number(!isPeopleFacing(b.it))');
      const served = seg.indexOf('(a.i - b.i)');
      // …and the derived-speech key (census fix #9) sits BELOW the band and ABOVE the served order.
      const speech = seg.indexOf('speechRank(a.it) - speechRank(b.it)');
      return fire > 0 && band > fire && speech > band && served > speech
        // …and no title/keyword read anywhere in the discriminator
        && !/\.ask|\.second|\.primary|toLowerCase|includes\(/.test(seg);
    })());
  gate('T8.1b the chore cap governs the CALM chores only — an overdue chore is a fire and always seats',
    !!calm && /export const CALM_MAX_CHORE_WHISPERS = 1;/.test(calm)
    && /if \(!isPeopleFacing\(it\) && !it\.overdue\) \{\s*\n\s*if \(chores >= CALM_MAX_CHORE_WHISPERS\) continue;/.test(calm));
  // T8.1c RETIRED Sep 13 — it gated HOW the sentence named its fires (namedOverdue/subjectOf).
  // The sentence is gone (owner call: "in home, this feels too much, remove"), so the claim it
  // checked no longer exists. The law underneath — a fire must be SHOWN — is gated on data by
  // T19.1/T19.1a, which are the stronger statement anyway.
  gate('T8.2 the resting Home holds NO prose, ≤5 rows and one composer (OWNER CALL Sep 13: the sentence retired; the density law is now greeting · ≤5 whispers · 1 composer · the door)',
    !!home
    // the greeting stops at the greeting — no sentence, no CoS face beside it
    && (home.match(/<CalmGreeting\b/g) || []).length === 1
    && !/sentence=\{calmSentence/.test(home)
    && !/function CosFace\(/.test(home)
    && !/cosSentence\(/.test(home)
    && (() => {
      const i = home.indexOf('function CalmGreeting(');
      const seg = home.slice(i, home.indexOf('/** ONE WHISPERED LINE'));
      return /\{new Date\(\)\.toLocaleDateString\(/.test(seg) && /<h1 /.test(seg) && !/<p className="text-\[13px\]/.test(seg);
    })()
    // the rows come from the capped pick — never a hand-sliced list
    && /pickWhispers\(flatRows\.map\(\(r\) => r\.item\), CALM_MAX_WHISPERS\)/.test(home)
    && /whispers\.map\(\(w\) => \(\s*<WhisperLine/.test(home)
    && !/whispers\.slice\([^)]*\)\.map\(\(w\) => \(\s*<WhisperLine/.test(home)
    // one composer, one mount (the class toggles; it never remounts)
    && (home.match(/<HomeAsk\b/g) || []).length === 1);
  // RE-POINTED Sep 17 (docs/attention-plan.md A3 — THE LEDGER LAW). The door's WORDS changed and so
  // did what it opens: "Everything else" read as a guilt backlog (a pile the reader failed to get
  // to), and it unfolded a wall with no account of why anything was held. "Held quiet" states the
  // AGENT'S OWN ACT, and it opens the LEDGER, where every held thing carries its class, its
  // consequence of waiting and its way back. The law the gate held — ONE door, carrying the
  // remainder and resting beside the handled count — is unchanged and still asserted here.
  // RE-POINTED Sep 17 (never weakened): the door's NUMBER moved to A3's one scale — it now speaks
  // the ledger's OWN held total plus the deck's non-mail held rows (exactly the sum the ledger's
  // intro states), with the deck's remainder surviving as the fallback for a brief served without
  // the field. The door itself — one door, the handled count beside it, opening the lens — is
  // asserted exactly as before, and the two-scales bug this replaced would now fail here.
  // RE-POINTED Sep 17, THIRD TIME AND STRICTLY STRONGER (PART III, Q2 — HELD ≠ HANDLED). One
  // number of 4,939 is a cliff, not a door ("it's 0 to 100, no in-between"). The door now speaks the
  // WAITING band — alive, real, held only by the budget — and rests the handled total beside it as
  // the fact it is. ONE DOOR, one fallback, one lens: unchanged, and now it cannot overstate what is
  // owed either.
  gate('T8.3 the remainder is ONE door — "When you\'re ready · N →" beside what was handled',
    // RE-POINTED Sep 18, STRICTER (the live regression): the door used to RETURN NULL when all three
    // numbers were zero — the exact state of a Home whose brief has not landed, and of one whose
    // every seat moved under a meeting. It now always renders and only its WORDS depend on what is
    // known, which is what the second clause below asserts. One door, still one door.
    // RE-POINTED Sep 21 (owner: the handled receipt "looks clickable/meaningful but opens nothing;
    // let's just remove that label"). The door line is now ONE door and nothing else — which is
    // what this gate was always named for. The handled account is still spoken, one click in, by
    // the held page's own intro sentence (lib/home/held-words.ts), so nothing went unaccounted.
    !!home && /<CalmDoor\n\s+waiting=\{typeof b\?\.attention\?\.heldWaiting === 'number'\n\s+\? b\.attention\.heldWaiting \+ deckHeldRows\.length\n\s+: b \? restRows\.length : null\}\n\s+onOpen=\{openHeldFromHome\} \/>/.test(home)
    && /typeof waiting === 'number' && waiting > 0 \? `When you're ready · \$\{waiting\} →`/.test(home)
    && !/if \(waiting <= 0 && handledQuietly <= 0 && handledToday <= 0\) return null;/.test(home)
    && !/handledQuietly=|handledToday=/.test(home)
    && /Everything else is handled: \$\{handled\.toLocaleString\(\)\} filed quietly/.test(read('lib/home/held-words.ts') ?? '')
    // …and the guilt-backlog wording is gone from the surface, not merely unused
    && !/Everything else ·/.test(home));

  // T8.4 / T8.5 / T8.5b / T8.6 RETIRED Sep 13 (OWNER CALL: "in home, this feels too much, remove").
  // They gated the CoS sentence — its source ladder (briefing lead → derived), the fire leading its
  // first clause, the acknowledges-the-fires check on a composed lead, and the "free until …" day
  // clause that only ever existed as that sentence's tail. The sentence no longer exists on any
  // surface, so these gated a claim the product no longer makes: a LAWFUL retirement, not a weaken.
  // What survives is gated harder, on data: earned calm's inverse is now enforced by the PICK
  // (every fire seats before anything else — T19.1/T19.1a), and T8.16 below proves the whole
  // sentence path is gone rather than merely unmounted.
  gate('T8.16 the sentence path is DELETED, not orphaned (no corpse in lib/home/calm.ts, no consumer anywhere)',
    !!calm
    // no DECLARATION survives (the retirement note may name them; a function may not)
    && !/(export )?(function|const|type) (cosSentence|deriveCalmSentence|calmFactsFrom|leadAcknowledgesFires|stripRefTags|clipToOpening|subjectOf|CalmFacts|BriefingLead)\b/.test(calm)
    // and the module states WHY, so the next reader does not re-invent it
    && /THE CoS SENTENCE — RETIRED \(owner call, Sep 13\)/.test(calm)
    && !!home && !/calmFactsFrom|cosSentence|freeUntil/.test(home));

  // THE RECEIPT GRAMMAR — mapped from the row's served state; the vocabulary lives in ONE module.
  // ⟲ RE-POINTED (stabilization W2.1, Sep 22): the mapping moved into `receiptWordOf` — the word is
  // chosen by WHAT is prepared (THE ONE READER's lead kind: an invite says "invite prepared"), and
  // `receiptOf` delegates to it. The law (mapped, never authored per row) is unchanged.
  gate('T8.7 receipts are MAPPED from served state (prepared-by → the word), never authored per row',
    !!calm && /export function receiptOf\(item: DoItem\): string \| null \{\s*return receiptWordOf\(item\.prepared \?\? null, item\.preparedKind \?\? null, item\.source\);/.test(calm)
    && /source === 'reply'\) return 'reply ready';/.test(calm)
    && /prepared === 'draft' \? 'drafted' : 'ready to send'/.test(calm)
    && /case 'invite': return 'invite prepared';/.test(calm)
    // the whisper itself authors NO receipt vocabulary — it renders what the mapping handed it
    && !!home && (() => {
      const seg = home.slice(home.indexOf('function WhisperLine('), home.indexOf('function CalmDoor('));
      return !/reply ready|drafted|ready to send|overdue|due today/i.test(seg)
        && /\{w\.receipt\}/.test(seg) && /\{w\.urgency\}/.test(seg) && /\{w\.note\}/.test(seg);
    })());
  gate('T8.8 a row with nothing prepared speaks THE MACHINE’S OWN WORD (stateWord ← machineWord)',
    !!calm && /export function stateNoteOf\(item: DoItem\)[\s\S]{0,160}item\.stateWord/.test(calm)
    && !!agenda && /stateWord\?: string \| null;/.test(agenda)
    && !!home && (home.match(/stateWord: machineWord\(/g) || []).length >= 4
    && /note: receipt \? null : stateNoteOf\(item\)/.test(calm));
  gate('T8.9 urgency is a WORD, never chrome — no red/rose/amber on a whisper or the door',
    !!home && (() => {
      const start = home.indexOf('function WhisperLine(');
      const end = home.indexOf('function CalmDoor(');
      const seg = home.slice(start, end);
      // the ONLY rose allowed is the Dismiss control's hover tone (the deck's own idiom)
      const roseHits = (seg.match(/rose-\d+/g) || []).filter((_, i) => i >= 0);
      return roseHits.length <= 1 && !/bg-rose-/.test(seg) && !/text-amber-/.test(seg)
        && /font-medium text-indigo-600">\{w\.receipt\}/.test(seg)
        && /className="text-neutral-400">\{w\.urgency\}/.test(seg);
    })());

  // THE DOORS ARE THE DECK'S — one href producer, one verb producer, one set of endpoints.
  gate('T8.10 a whisper click IS the deck’s door (useRowActions + ctaFor, no second href builder)',
    !!home && /const \{ removed, exiting, busy, done, drop, open, prefetch \} = useRowActions\(item, handlers\);/.test(home)
    && /\{ctaFor\(item\)\}/.test(home)
    && (() => {
      const start = home.indexOf('function WhisperLine(');
      const end = home.indexOf('function CalmDoor(');
      const seg = home.slice(start, end);
      return !/\/item\//.test(seg) && !/href[:=]/.test(seg) && !/router\.push/.test(seg) && !/fetch\(/.test(seg);
    })());
  // THE HOVER FLOOR (owner walk, Sep 7 — "the hover expand disappeared"): the whisper mounts the
  // row kit's OWN control cluster, and the verb beside it is unconditional. Every whisper of every
  // lane offers at least one worded deed on hover — by construction, not by row class.
  gate('T8.10a every whisper hover offers a worded deed (the kit’s cluster + an UNCONDITIONAL verb)',
    !!home && !!row
    && /export function RowControls\(/.test(row)
    // ctaFor is TOTAL — every branch returns a string, so no lane can hover into silence
    && (() => {
      const cta = row!.slice(row!.indexOf('export function ctaFor('), row!.indexOf('export function ctaFor(') + 400);
      return !/return null|return undefined|return ''/.test(cta);
    })()
    && (() => {
      const seg = home!.slice(home!.indexOf('function WhisperLine('), home!.indexOf('function CalmDoor('));
      return /<RowControls item=\{item\} busy=\{busy\} done=\{done\} drop=\{drop\} \/>/.test(seg)
        // the verb is not wrapped in any row-class condition
        && /<span className="text-\[13px\] font-medium text-indigo-600">\{ctaFor\(item\)\}<\/span>/.test(seg)
        // …and the whisper hand-rolls NO private control (the fork that caused this)
        && !/<button onClick=\{(done|drop)\}/.test(seg);
    })());
  // RE-POINTED Sep 13 (cleanup): "two skins" became ONE. WorkRow's card variant had zero callers
  // after the Sep 8 calm-Home walk retired the deck, and was deleted — so the cluster is mounted
  // once, not twice. The law the count encoded (ONE implementation of the control cluster, never a
  // per-skin fork) is asserted directly now: exactly one mount, one done verb, one picker.
  // RE-POINTED Sep 15: the done verb's label shortened to the owner's own word ("Done ✓ · Dismiss ✕
  // · 📁 Add to project · Open →") when the labels became permanent. The law is unchanged and still
  // asserted by count: ONE mount, ONE done verb, ONE picker.
  gate('T8.10b the control cluster is ONE implementation (one row anatomy, no per-skin fork)',
    !!row && (row.match(/<RowControls item=\{item\}/g) || []).length === 1
    && (row.match(/<RowAction label="Done"/g) || []).length === 1
    && (row.match(/<RowProjectPicker itemKind=/g) || []).length === 1);

  // ── THE CONTROLS OVERLAY, THEY NEVER PUSH (owner walk, Sep 14) ─────────────────────────────────
  // "the animation makes it a bit hard to select the middle ones, as the label pushes to the side."
  // The cluster used to sit IN FLOW, so each control's own label expansion stole width from the
  // sentence and re-truncated the row MID-HOVER — every target shifted under a moving cursor. THE
  // LAW: a hover reveal may change what is VISIBLE, never what is LAID OUT. Enforced structurally:
  // the rail is absolutely positioned (zero width in flow), it is ONE implementation, and every
  // seat that lists work mounts THAT — never a private positioned cluster of its own.
  const SRC = sourceFiles('components').concat(sourceFiles('app'));
  gate('T8.10c the hover controls OVERLAY the row — absolutely positioned, zero layout change on hover',
    !!row && /export function RowHoverRail\(/.test(row)
    && (() => {
      const seg = row!.slice(row!.indexOf('const RAIL_BG'), row!.indexOf('/** THE ONE VERB'));
      return /absolute inset-y-0 right-0/.test(seg)          // out of flow, pinned to the right edge
        && /bg-gradient-to-r from-transparent/.test(seg)      // the text yields VISUALLY, not spatially
        && /group-hover:opacity-100/.test(seg)                // the smooth reveal survives
        && /motion-reduce:transition-none/.test(seg)          // …and is instant when motion is refused
        // click-through at rest: an invisible strip over the sentence must not eat the row's click
        && /pointer-events-none group-hover:pointer-events-auto/.test(seg);
    })());
  gate('T8.10d ONE rail, every seat that lists work (no private positioned cluster)',
    !!row && !!home
    // exactly one implementation…
    && SRC.filter((f) => /export function RowHoverRail\(/.test(read(f) ?? '')).length === 1
    // …mounted by the row kit AND by the calm Home's whisper, each over a `relative` row
    && /<RowHoverRail bg=\{flat \? 'neutral-50' : 'white'\}>/.test(row)
    && /className="relative w-full flex items-center gap-2\.5 px-3 py-\[7px\]/.test(row)
    && (() => {
      const seg = home!.slice(home!.indexOf('function WhisperLine('), home!.indexOf('function CalmDoor('));
      return /<RowHoverRail>/.test(seg) && /group relative flex items-center/.test(seg)
        // the old in-flow cluster span is gone from this seat
        && !/flex-shrink-0 flex items-center gap-2\.5 opacity-0 group-hover:opacity-100/.test(seg);
    })());

  // ── THE ALIVE MARK (owner walk, Sep 14: "we had a moving abstract neural thing… can we
  // reinclude that?"). It is a COMPONENT now, so a header rewrite can never orphan it again (its
  // keyframes sat dead in home-view.tsx for weeks with nothing mounting them). Three floors:
  // no layout shift · motion is a request · it sleeps when unwatched.
  // RE-POINTED Sep 15 (owner walk: "I'd like it to be more of a moving neural network thing" — a
  // wireframe mesh sphere, undulating). CSS alone cannot draw a deforming mesh, so the technique
  // moved to one small canvas — and because a rAF loop is a standing cost, the floors got STRICTER,
  // not looser: reduced motion now draws a single STATIC FRAME and never starts the loop at all,
  // the loop is cancelled out of view as well as on a hidden tab, and the device pixel ratio is
  // capped. The old blanket "no canvas, no rAF" clause is replaced by the guarantees it stood for.
  gate('T8.17 the alive mark is ONE component — fixed-size, motion-safe, asleep on a hidden tab',
    (() => {
      const mark = read('components/home/alive-mark.tsx');
      return !!mark
        && /export function AliveMark\(/.test(mark)
        && SRC.filter((f) => /export function AliveMark\(/.test(read(f) ?? '')).length === 1
        // NO LAYOUT SHIFT — a pinned box, the canvas absolutely filling it
        && /style=\{\{ width: size, height: size \}\}/.test(mark)
        && /absolute inset-0 w-full h-full/.test(mark)
        // MOTION IS A REQUEST — the mark stays, the movement stops (CSS glow + the canvas loop)
        && /@media \(prefers-reduced-motion: reduce\) \{ \.aug-alive \* \{ animation: none !important; \} \}/.test(mark)
        && /animation-play-state: paused !important/.test(mark)
        && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(mark)
        // …and under reduced motion the loop is NEVER STARTED — one frame, then return
        && /if \(reduced\) \{ draw\([^)]*\); return; \}/.test(mark)
        // IT SLEEPS WHEN UNWATCHED — hidden tab AND scrolled out of view both cancel the rAF
        && /visibilitychange/.test(mark) && /new IntersectionObserver\(/.test(mark)
        && /cancelAnimationFrame\(raf\); raf = 0;/.test(mark)
        // THE LOOP BUDGET — one rAF, device pixel ratio capped
        && (mark.match(/requestAnimationFrame\(frame\)/g) || []).length === 2
        && /Math\.min\(2, \(typeof window !== 'undefined' && window\.devicePixelRatio\) \|\| 1\)/.test(mark)
        // decorative only — never a control, never a claim
        && /aria-hidden="true"/.test(mark);
    })());
  // RE-POINTED Sep 18 (THE ENTRANCE): the Home no longer names the mark at all — it mounts the
  // ENTRANCE'S SEAT, and the seat mounts the one mark. That is strictly stronger than the Sep 15
  // reading ("one orb, two moments"): there are no longer two moments to keep in agreement, because
  // there is no second tree. The skeleton that held the second copy is gone with it.
  gate('T8.17a the mark is mounted beside the date, through ONE seat, and the orphaned orb keyframes are gone',
    !!home && /<OrbSeat entrance=\{entrance\} loading=\{loading\} \/>/.test(home)
    && /import \{ OrbSeat, useOrbEntrance, type OrbEntrance \} from '@\/components\/home\/orb-entrance';/.test(home)
    && (home.match(/<OrbSeat\b/g) || []).length === 1
    && !/<AliveMark\b/.test(home)
    && (() => {
      const seat = read('components/home/orb-entrance.tsx');
      return !!seat && /import \{ AliveMark \} from '@\/components\/home\/alive-mark';/.test(seat)
        && (seat.match(/<AliveMark\b/g) || []).length === 1;
    })()
    // the dead keyframes the header rewrite left behind are swept
    && !/@keyframes augM1\{/.test(home) && !/@keyframes augBreathe\{/.test(home)
    && !/@keyframes augSpin\{/.test(home));

  // RE-POINTED Sep 13 (cleanup): the `const cta = ctaFor(item);` clause lived in the deleted card
  // branch. The verb producer did NOT die with it — it is exported and consumed by the Home's
  // whisper, which is the stronger reading of this gate's own law (ONE verb, shared across
  // surfaces, rather than one component calling itself).
  gate('T8.11 the row kit owns those deeds ONCE (WorkRow runs on the same hook; the verb has ONE producer, shared)',
    !!row && /export function useRowActions\(/.test(row) && /export function ctaFor\(/.test(row)
    && /const \{ isCommit, isDeal, removed, exiting, busy, done, drop, open, prefetch \} =\s*\n?\s*useRowActions\(item, \{/.test(row)
    && !!read('components/home/home-view.tsx')?.includes('ctaFor')
    && (row.match(/'Review & send →'/g) || []).length === 1);

  // THE FOLD IS NOT A GRAVEYARD, AND IT IS NOT A SECOND HOME (owner walk, Sep 8).
  // RE-POINTED Sep 17 (docs/attention-plan.md A3): the in-place unfold WAS the fourteen-row wall,
  // one click away, with no account of why any of it was held. A3 replaced it with a LEDGER —
  // "suppression is a posture with receipts, never a dismissal" — so the remainder now lives at its
  // own lens, where every held thing carries its class, its consequence of waiting and its way back.
  // STRICTLY MORE is accounted for than the unfold ever accounted for; nothing is hidden and nothing
  // is deleted. The gate follows the law up: no wall survives behind the fold, the ledger exists,
  // and the deck's own held remainder (commitments, deals — rows the mail ledger structurally cannot
  // see) is handed to it rather than dropped.
  gate('T8.12 the door opens THE LEDGER, not a wall — receipts for every held thing (A3)',
    !!home
    // the wall is gone: no restRows deck re-rendered behind the fold, no per-session fold state
    && !/restRows\.map\(/.test(home) && !/deckOpen|toggleDeck|aug-home-deck-open/.test(home)
    // the lens mounts the ledger, and the ledger's read fires only while it is open
    // (Sep 17: the mount gained `onRefresh` — a committed bulk deed re-reads the account, so an
    //  archived member leaves the list rather than standing as a row the ledger no longer holds.)
    // (Sep 18: the mount gained the WARM stack and the served day — the rows the Home already holds,
    //  so the deck opens on them while the account is read. Same one lens, same one read.)
    // (Sep 21: the mount gained the RECORDED ORIGIN — `fromHome` — so the deck's Close returns
    //  where the reader came from. Still one lens, one read, one mount.)
    && /<HeldQuietView ledger=\{heldLedger\} deckHeld=\{deckHeldRows\} warmHeld=\{warmHeldRows\}\n\s+servedDay=\{b\?\.today \?\? null\} fromHome=\{heldFromHome\}\n\s+onBack=\{\(\) => setView\('dashboard'\)\} onRefresh=\{reloadHeld\} \/>/.test(home)
    && /useHeldLedger\(view === 'held'\)/.test(home)
    // nothing the deck held is dropped on the floor: the non-mail remainder rides along, worded by
    // the Home's OWN vocabulary (toWhisper), never a second grammar invented at the ledger
    && /const deckHeldRows: DeckHeldRow\[\] = restRows/.test(home)
    && (() => {
      const held = read('components/home/held-quiet.tsx');
      return !!held
        // every class states its consequence of waiting, and every member its own why-held
        && /\{c\.consequence\}/.test(held) && /\{m\.why\}/.test(held)
        // …and every held thing has a way back
        && (held.match(/Bring forward/g) || []).length >= 2
        // the page's own sentences are DETERMINISTIC, composed from the served counts — never a
        // model. (Sep 17, Q2: they moved to `lib/home/held-words.ts` — pure and client-safe, so a
        // CLI gate can assert the WORDS and not just their existence — and the surface re-exports
        // them. Both halves are asserted here; same law, one home.)
        && /heldIntro, heldReceipts/.test(held)
        && (() => { const w = read('lib/home/held-words.ts');
          return !!w && /export function heldIntro\(/.test(w) && /export function heldReceipts\(/.test(w)
            && !/getAIClient|aiCall\(|aiCreate/.test(w); })()
        && !/getAIClient|aiCall\(|aiCreate/.test(held);
    })());
  gate('T8.12a the LEGACY DECK is gone from the Home (no second deck, no ring twin, no calendar rail)',
    !!home && !/<OneDeck/.test(home) && !/<ThisWeekCard/.test(home)
    && !/doGroupMode|pinnedGroups|hoverGroup/.test(home)
    // the ring keeps exactly ONE seat (the non-dashboard lens header) — never a twin behind the door
    && (home.match(/<DayClearedRing/g) || []).length === 1
    // …and the component itself is retired at its own address, so nothing can mount it again
    && (() => { const one = read('components/one/one-home.tsx'); return !!one && !/export function OneDeck/.test(one) && /export type FlatRow/.test(one); })()
    // RE-POINTED Sep 21: the handled count's ONE home is no longer beside the door — the receipt
    // came off the line by owner's call. It is now spoken in exactly one place, the held page's own
    // intro, and the Home says it NOWHERE. Same law (one home for one fact), one fewer seat.
    && !/handledQuietly=|handledToday=\{ringCleared\}/.test(home)
    // (the two survivors are the day-progress RING's own title and label — its seat, not the door's)
    && (home.match(/\$\{cleared\} handled today/g) || []).length === 2);
  gate('T8.13 the whispers derive from the SERVED deck — one agenda, one order (no re-judging)',
    !!home && /for \(const e of agenda\.entries\) \{/.test(home)
    // (RE-POINTED Sep 18: the remainder also drops DAY-ANCHORED rows — they are SERVED and already
    //  rendering under their meeting, so counting them again would be one row in two homes.)
    // (⟲ RE-POINTED W13.4 — ONE ITEM, ONE ROW: the W11.2 conversation fold is retired, so the
    //  remainder drops only the seated whispers and the day-anchored rows — every other live item is
    //  its own row; nothing rides another's seat.)
    && /const restRows = sortDoorRows\(\n\s+flatRows\.filter\(\(r\) => !whisperKeys\.has\(r\.item\.key\) && !anchoredIds\.has\(r\.item\.entityId\)\),\n\s+\(r\) => r\.item,\n\s+\);/.test(home)
    && !/foldedInto|seatedAtoms/.test(home)
    && !!calm && !/fetch\(|supabase|aiCall/.test(calm));
  // T8.13a RETIRED Sep 13 — THE ONE DERIVATION existed so the SENTENCE's counts could never
  // disagree with the surface. With no sentence there is no second derivation to keep honest: the
  // Home now holds exactly one pass over the pool (pickWhispers → the rest), which T8.13 asserts.
  gate('T8.13b the Home counts the pool ONCE — the seated list and the door’s list, no third pass',
    !!home && /const whisperKeys = new Set\(whisperItems\.map\(\(i\) => i\.key\)\);/.test(home)
    && !/overdue: flatRows\.filter/.test(home)
    && (home.match(/pickWhispers\(/g) || []).length === 1);

  // THE SOVEREIGN / EMPTY BRANCH — untouched by the calm layout.
  gate('T8.14 the sovereign centerpiece survives (team card + centered composer, empty deck)',
    !!home && /const sovereignCenter = !!nothing && b\?\.mail\?\.emailFeature === false/.test(home)
    && /<TeamReadyCard onTour=/.test(home)
    && /sovereignCenter\s*\n?\s*\? 'pt-7 pb-4'/.test(home)
    && /\{sovereignCenter && <div className="flex-1" aria-hidden \/>\}/.test(home));
  // RE-POINTED Sep 18 (the live regression): the WHISPER LIST is still silent on an empty deck —
  // that is the `nothing` empty state's job and it is asserted here. What no longer hangs off the
  // data is the BLOCK ITSELF: it belongs to the dashboard lens, because the ledger's one entrance
  // must render even when there is nothing above it (a Home with no rows AND no door is a Home with
  // no way to its own account). So: the empty state still speaks, the door still stands.
  gate('T8.15 an empty deck whispers NOTHING (the honest empty states keep the page)',
    !!home && /\{nothing && \(/.test(home)
    && /view === 'dashboard' && !chatActive && !projectDetailOpen && \(/.test(home)
    && /\{whispers\.map\(\(w\) => \(/.test(home));
}

// ── T10 · ONE AGENDA PER ROOM (owner walk, Sep 7) ───────────────────────────────────────────────
// "Multiple things happening but not aligned or knowing about each other." Nothing STANDS in a room
// unless the pinned brief speaks it, or it dies: the offers never restate the MOVE, an unanswered
// bring-in proposal ages out of the timeline into the drawer's one membership home, every live ask
// (a coworker's included) reaches the composer, and the chrome around the thread stays quiet.
console.log('\nT10 · ONE AGENDA PER ROOM — the brief speaks it, or it dies');
{
  const brief = read('lib/room/brief.ts');
  const ground = read('lib/room/grounding.ts');
  const rail = read('components/home/item-rail.tsx');
  const room = read('components/entities/entity-room.tsx');
  const detail = read('app/api/entities/[id]/detail/route.ts');

  // 1 — AN OFFER NEVER RESTATES THE MOVE (law 7, in code at the compose seam).
  gate('T10.1 the offers-vs-move dedupe lives at COMPOSITION, the one seam where both exist',
    !!brief && /export function offerEchoesMove\(/.test(brief)
    && /\.filter\(\(o\) => !\(move\?\.label && offerEchoesMove\(move\.label, o, GENERIC_WORK_WORDS\)\)\)/.test(brief));
  gate('T10.2 the dedupe is DETERMINISTIC — the house distinctive-token idiom, never a fuzzy read',
    !!brief && /GENERIC_WORK_WORDS/.test(brief) && /offerStem/.test(brief)
    && !/aiCall[\s\S]{0,400}offerEchoesMove/.test(brief));
  {
    // The law, exercised: the owner's own live trio (CTA + two chips that were the same deed).
    const { offerEchoesMove } = require('../lib/room/brief') as typeof import('../lib/room/brief');
    const { GENERIC_WORK_WORDS } = require('../lib/entities/recognize') as typeof import('../lib/entities/recognize');
    const mv = 'Send both meeting links';
    const echo = (l: string, s: string) => offerEchoesMove(mv, { label: l, say: s }, GENERIC_WORK_WORDS);
    gate('T10.3 the move said smaller is DROPPED (the live pair), a real alternative SURVIVES',
      echo('Send Thursday link to Sam', 'Send the calendar invite for Thursday 11h now.')
      && echo('Send Wednesday link to Alex', 'Send the calendar invitation for Wednesday 11h now.')
      && !echo('Name the repetitive task', 'Identify one repetitive task suitable for automation.')
      && !echo('Ask about the room', 'Ask whether the room is booked for Thursday.'));
  }

  // 2 — THE STANDING PROPOSAL AGES INTO THE DRAWER.
  gate('T10.4 the rail gives a bring-in proposal a SPEECH WINDOW (48h), then stops offering it',
    !!rail && /const PROPOSAL_STANDS_MS = 48 \* 60 \* 60 \* 1000;/.test(rail)
    && /Date\.now\(\) - bornAt < PROPOSAL_STANDS_MS/.test(rail)
    && /if \(stillSpeech\) \{[\s\S]{0,220}act: 'adopt'/.test(rail));
  gate('T10.5 an aged proposal FOLDS into the record (it never stands with dead options)',
    !!rail && /const isAgedProposal = \(t: Turn\) => t\.role === 'system' && t\.dkey === 'founding-proposal' && !t\.actions\?\.length;/.test(rail)
    && /!isAgedProposal\(t\)/.test(rail));
  gate('T10.6 the drawer serves the SAME durable turn (one source, never a forked proposal store)',
    !!detail && /dedupe_key', 'founding-proposal'/.test(detail) && /founding_proposal/.test(detail)
    && /adoption,/.test(detail));
  gate('T10.7 membership review keeps ONE home — the proposal rides "Might belong here" and fires the SAME adopt door',
    !!room && /const adoptions = \(d\?\.adoption\?\.options \?\? \[\]\)/.test(room)
    && /fetch\('\/api\/entities\/adopt'/.test(room)
    && /\{\(suggestions\.length > 0 \|\| adoptions\.length > 0\) && \(/.test(room)
    && /Might belong here/.test(room));

  // 3 — THE COHERENCE RULE REACHES COWORKER ASKS.
  gate('T10.8 the grounding reads live asks off THEIR OWN query, not the transcript window',
    !!ground && /from\('room_turns'\)[\s\S]{0,220}not\('component', 'is', null\)/.test(ground)
    && /const asks: RoomGrounding\['asks'\] = await \(async \(\) => \{/.test(ground));
  // RE-POINTED (Sep 18, Q1's source half): the attribution moved OUT of the template and into
  // `askAttribution(who, speaker)` — the page now collapses the SPEAKER'S OWN ask to first person
  // at the source, so every consumer inherits it. The law is unchanged and stricter: an ask still
  // carries WHO asks, and a coworker who is not the reader is still named.
  gate('T10.9 an ask carries WHO asks (a coworker’s checklist is their own speech)',
    !!ground && /who: t\.author\?\.name \? String\(t\.author\.name\) : null/.test(ground)
    && /who: string \| null/.test(ground)
    && /export function askAttribution/.test(ground)
    && /`\$\{who\} asks`/.test(ground)
    && /askAttribution\(a\.who, speaker\)/.test(ground));
  gate('T10.10 the brief SIG carries the ask digest (who + answered), so a new ask recomposes',
    !!brief && /const askDigest = g\.asks\.map\(\(a\) => `\$\{a\.who \?\? '-'\}:\$\{a\.proceeded \? 'ok' : 'open'\}/.test(brief)
    && /askDigest/.test(brief));
  gate('T10.11 the composer is told WHO asks, and COHERENCE demands the gap be named',
    !!brief && /a\.who \? `\$\{a\.who\} asks` : 'asks'/.test(brief)
    && /acknowledges the one gap IN ITS OWN WORDS/.test(brief));
  {
    const v = brief?.match(/ROOM_BRIEF_VERSION = (\d+)/)?.[1];
    gate('T10.12 ROOM_BRIEF_VERSION was bumped for the prompt + grounding change (≥ 8)',
      !!v && Number(v) >= 8, v ? `found ${v}` : 'not found');
  }

  // 4 — THE LABEL IS A QUOTE (the excerpt-honesty law reaching chrome).
  gate('T10.13 a prepared card’s label clips at a WORD boundary and declares the cut',
    !!room && /export function clipLabel\(/.test(room) && /clipLabel\(r\.title, 52\)/.test(room)
    && !/r\.title\.slice\(0, \d+\)/.test(room));

  // 5 — THE CHROME STAYS QUIET.
  gate('T10.14 ONE COLOR PER FACT (Sep 7 walk: the per-surface QUIET_TONE fork died — the same project wore rose in the sidebar and amber in the header): the calm tone lives in the ONE vocabulary and no state dot is rose anywhere',
    !!room && !/QUIET_TONE: Record/.test(room)
    && /rounded-full \$\{m\.dot\}/.test(room) && /tracking-wide \$\{m\.text\}/.test(room)
    && !!read('lib/work-items/states.ts')
    && /needs_you:\s*\{ dot: 'bg-amber-500'/.test(read('lib/work-items/states.ts')!)
    && !/bg-rose/.test(read('lib/work-items/states.ts')!.split('MOMENTUM')[1]?.split('LIFECYCLE')[0] ?? 'bg-rose'));
  // RE-POINTED (owner walk, Sep 10 — "confusing to have 2 elements… like a header and then the
  // conversation"): this gate used to require the mini-header to exist while carrying the room's
  // NAME instead of the word "Chat". The whole band is gone now — the room's ONE header carries the
  // name — which satisfies the original law strictly more than the old shape did. T25.11 owns the
  // band count; this keeps the vestigial word itself dead.
  // ONE SHAPE PER FACT (Sep 14 walk: "some mismatching label colors") — the category menu rendered
  // CIRCLES two inches from the momentum circles, so two different questions wore one answer's
  // shape (and a green category dot read as a green momentum dot). Momentum keeps the circle; the
  // category is a SQUARE, and its palette has exactly ONE producer.
  gate('T10.16 ONE SHAPE PER FACT — category renders as a SQUARE from the ONE category map, never an inline palette',
    (() => {
      const map = read('lib/entities/category-colors.ts');
      const pv = read('components/entities/portfolio-view.tsx');
      if (!map || !pv) return false;
      // the one producer: a square by construction, and a neutral (never borrowed) unknown
      const producer = /rounded-\[2px\]/.test(map)
        && /client:\s*\{ dot: 'bg-emerald-500'/.test(map)
        && /internal:\s*\{ dot: 'bg-indigo-500'/.test(map)
        && /personal:\s*\{ dot: 'bg-violet-500'/.test(map)
        && /admin:\s*\{ dot: 'bg-neutral-400'/.test(map)
        && /UNCATEGORIZED = \{ dot: 'bg-neutral-300'/.test(map);
      // the portfolio consumes it and carries ZERO inline category colors
      const consumer = /categorySwatchClass\(c\)/.test(pv)
        && /from '@\/lib\/entities\/category-colors'/.test(pv)
        && !/'client' \? 'bg-/.test(pv);
      // …and NOWHERE does a category swatch wear the momentum shape
      const noCircles = ['components/entities/portfolio-view.tsx', 'components/entities/entity-room.tsx']
        .every((f) => !/rounded-full \$\{?c === 'client'/.test(read(f) ?? '')
          && !/'client' \? 'bg-[a-z]+-\d+'[\s\S]{0,140}?rounded-full/.test(read(f) ?? ''));
      // THE ROOM MENU IMPORTS IT TOO (owner screenshot, Sep 14 — it was still drawing circles off
      // its own inline palette). Agreement-by-inspection is no longer enough: the site must CONSUME
      // the one producer and hold no category literal of its own. Strictly stronger than the old
      // "agrees" clause it replaces.
      const er = read('components/entities/entity-room.tsx') ?? '';
      const roomConsumes = /from '@\/lib\/entities\/category-colors'/.test(er)
        && /categorySwatchClass\(c\)/.test(er)
        && /ENTITY_CATEGORIES\.map/.test(er)
        && !/'client' \? 'bg-/.test(er);
      return producer && consumer && noCircles && roomConsumes;
    })());

  gate('T10.15 the vestigial "Chat" mini-header above the thread is gone',
    !!rail && !/'Chat'/.test(rail)
    && !/h-10 flex items-center gap-2 px-3 border-b/.test(rail));
}

// ── T11 · THE READ MARKER, THE HAND-RAISE, THE REOPEN DELTA (owner, Sep 7) ──────────────────────
// "An AI per project… it worked while you were away and has something for you." One fact (when did
// the owner last see this room), three deterministic consequences: the marker, the honest badge,
// the appended "Since you were here" line. No new table, no AI, no second mechanic.
console.log('\nT11 · THE READ MARKER — the project raising its hand');
{
  const marker = read('lib/room/read-marker.ts');
  const turnsRoute = read('app/api/room/turns/route.ts');
  const recent = read('app/api/rooms/recent/route.ts');
  const sidebar = read('components/one/one-sidebar.tsx');
  const rail = read('components/home/item-rail.tsx');

  // 1 — THE STORE: the house pattern, never a new table.
  gate('T11.1 the marker lives in the HOUSE STORE (item_plans kind room_read, keyed by room key)',
    !!marker && /READ_MARKER_KIND = 'room_read'/.test(marker) && /from\('item_plans'\)/.test(marker)
    && /onConflict: 'user_id,kind,entity_id'/.test(marker));
  gate('T11.2 no migration was invented for it (no room_read table anywhere in supabase/migrations)',
    !fs.existsSync(path.join(ROOT, 'supabase/migrations')) ||
    !fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
      .some((f) => /room_read/.test(f) || /room_read/.test(read(`supabase/migrations/${f}`) ?? '')));

  // 2 — ONE WRITER, AT THE SERVING SEAM, owner-scoped and off the serving path.
  const writers = sourceFiles('app').concat(sourceFiles('lib'), sourceFiles('components'))
    .filter((f) => f !== 'lib/room/read-marker.ts' && /stampRoomMarker\(/.test(read(f) ?? ''));
  {
    // THE STAMP GRACE (second walk find): the stamp made the GET non-idempotent — a double-fetch
    // (StrictMode, remounts, prefetch) consumed the pre-stamp marker on request A and request B
    // saw "nothing new" on exactly the open the badge promised. Within the grace, the SERVE keeps
    // reading the pre-open marker; the sidebar keeps the raw stamp; a re-stamp within the grace
    // preserves the original prevAt (no laundering).
    const rm = read('lib/room/read-marker.ts');
    gate('T11.2b the serve is idempotent per open (STAMP_GRACE_MS; grace serves prevAt; first-open grace serves null)',
      !!rm && /export const STAMP_GRACE_MS/.test(rm)
      && /if \(withinGrace && typeof t\.prevAt === 'string' && t\.prevAt\) return t\.prevAt;/.test(rm)
      && /if \(withinGrace && t\.prevAt === null\) return null;/.test(rm));
    gate('T11.2c a re-stamp within the grace keeps the ORIGINAL pre-open marker',
      !!rm && /\? \(cur\?\.prevAt \?\? null\)/.test(rm)
      && /prevAt, stampedAt: at/.test(rm));
    gate('T11.2d the sidebar badge reads the RAW stamp (clears on open, grace or not)',
      !!rm && /readRoomMarkers[\s\S]{0,600}r\.tasks\?\.at/.test(rm));
  }
  gate('T11.3 exactly ONE stamp seam in the app (the shared GET /api/room/turns)',
    writers.length === 1 && writers[0] === 'app/api/room/turns/route.ts', writers.join(', '));
  gate('T11.4 the stamp is owner-scoped (the caller’s own RLS session + user.id) and fire-and-forget',
    !!turnsRoute && /after\(async \(\) => \{ await stampRoomMarker\(supabase, user\.id, key\); \}\)/.test(turnsRoute)
    && /import \{ NextRequest, NextResponse, after \} from 'next\/server'/.test(turnsRoute));
  gate('T11.5 the marker served back is the PRE-stamp value (read before the after() stamp)',
    !!turnsRoute && turnsRoute.indexOf('readRoomMarker(supabase') < turnsRoute.indexOf('stampRoomMarker(supabase')
    && /return NextResponse\.json\(\{ turns, readAt \}\)/.test(turnsRoute));

  // 3 — THE UNREAD FACT: non-user live turns newer than the marker; ABSENT without a marker.
  gate('T11.6 unread counts LIVE, NON-USER turns newer than the marker',
    !!recent && /\.is\('archived_at', null\)/.test(recent) && /\.neq\('role', 'user'\)/.test(recent)
    && /readRoomMarkers\(supabase, user\.id, projectKeys\)/.test(recent));
  gate('T11.7 no marker ⇒ NO count (day one never claims "everything is unread")',
    !!recent && /const marked = projectKeys\.filter\(\(k\) => markers\.has\(k\)\)/.test(recent)
    && /if \(marked\.length\)/.test(recent));
  gate('T11.8 the count is TWO slim reads, row-capped — never one query per room',
    !!recent && /\.in\('room_key', marked\)/.test(recent) && /\.limit\(300\)/.test(recent)
    && />= 10\) continue/.test(recent));
  gate('T11.9 the DM skip is documented where the DM badge would go (work_messages has no marker)',
    !!recent && /COWORKER DMs ARE DELIBERATELY SKIPPED/.test(recent) && /work_messages/.test(recent));

  // 4 — THE BADGE: the existing quiet indigo grammar, >0 or absent.
  gate('T11.10 the sidebar badge renders ONLY on a served count > 0, in the Home badge’s grammar',
    !!sidebar && /const n = active \? 0 : \(rooms\.unread\?\.\[p\.id\] \?\? 0\);/.test(sidebar)
    && /\{n > 0 && \(/.test(sidebar) && /rounded-full bg-indigo-50 px-1\.5 py-0\.5 text-center text-\[10px\] font-semibold text-indigo-700 tabular-nums/.test(sidebar)
    && /\{n > 9 \? '9\+' : n\}/.test(sidebar));
  gate('T11.11 the badge clears through the EXISTING refresh event (no new sidebar mechanic)',
    !!sidebar && /addEventListener\('aug:conversation-changed', refresh\)/.test(sidebar)
    && (sidebar.match(/fetch\('\/api\/rooms\/recent'\)/g) ?? []).length === 1);

  // ⚠️ RETIRED WITH THE CLAIM THEY CHECKED (owner walk, Sep 14 — a live project room: the clipped
  // "Since you were here — <half a sentence>" line "is confusing, maybe doesn’t need to be here"). T11.12–T11.19 held the REOPEN DELTA: its builder’s determinism, its first-visit
  // silence, its seat after the fold handle, the frozen-line race fix. The owner repealed the
  // line itself, so the gates go with it — and ONE gate takes their place, proving the path is
  // DELETED rather than left as a corpse (the T8.16 precedent). What the delta was built on — the
  // marker, the stamp seam, the sidebar’s honest hand-raise badge — stands, gated above
  // (T11.1–T11.11): the project still raises its hand; it no longer narrates the raise to a
  // reader who is already in the room.
  gate('T11.20 THE REOPEN DELTA IS GONE, NOT HIDDEN — no builder, no caller, no seat (and the marker + badge stand)',
    !!marker && !/sinceYouWereHere|DELTA_MAX_PARTS|DELTA_CLIP_CHARS/.test(marker.replace(/^\s*\/\/.*$/gm, ''))
    && /THE REOPEN DELTA IS RETIRED/.test(marker)
    // the marker half is untouched: the stamp, the grace, the badge read
    && /export async function stampRoomMarker\(/.test(marker) && /export async function readRoomMarkers\(/.test(marker)
    && !!rail && !/sinceYouWereHere|since-you-were-here|deltaLineFor|setDeltaLine/.test(rail)
    && !/from '@\/lib\/room\/read-marker'/.test(rail)
    // …and nothing anywhere else picked the builder back up
    && sourceFiles('lib').concat(sourceFiles('app'), sourceFiles('components'))
      .every((f) => !/sinceYouWereHere\(/.test(read(f) ?? '')));
}

// ── T13 · THE ASK SPEAKS, THE ROOM KEEPS ONE ACCENT, THE FACES NAME THEMSELVES (owner, Sep 7) ───
// Three finds from one walk: an ask that read as a bare amber checklist ("how is this relevant or
// actionable at all? we need quality"), a room wearing several competing focus points ("not in the
// nature of the chat feel"), and an unlabeled row of initials in the header ("what is that J and L
// next to Clara?"). One law each, gated where it lives.
console.log('\nT13 · THE ASK SPEAKS CONSEQUENCE — one accent, named faces');
{
  const req = read('lib/prepare/requirements.ts');
  const pass = read('lib/prepare/pass.ts');
  const rail = read('components/home/item-rail.tsx');
  // W3-A (Sep 22): the seats these laws moved to — the two hosts and the kit itself.
  const askHost = read('components/home/input-card.tsx');
  const kit = read('components/thread/thread-cards.tsx');
  const room = read('components/entities/entity-room.tsx');
  const avatar = read('components/thread/avatar-status.tsx');

  // 1 — THE ASK SPEAKS CONSEQUENCE (law 4): reasoned, code-checked, deterministic floor.
  gate('T13.1 the CANNED preamble is gone from the codebase (no seam still says "attach below" / "couldn’t find anywhere")',
    !!req && !!pass
    && !sourceFiles('lib').concat(sourceFiles('app'), sourceFiles('components'))
      .some((f) => /attach below or tell me where to look|I couldn't find anywhere/i.test(read(f) ?? '')));
  gate('T13.2 the ask is REASONED at the authoring seam — ONE composed pass on the jsonFast/classification slot (never a reasoning slot)',
    !!req && /export async function composeAskSpeech\(/.test(req)
    && /aiCall<\{ say\?: string \}>\(\{[\s\S]{0,160}shape: \{ output: 'json' \}/.test(req));
  gate('T13.3 the composition is CODE-VALIDATED (the evidence idiom): grounded in the work’s own distinctive tokens, one paragraph, length-capped',
    !!req && /function speechIsGrounded\(/.test(req) && /GENERIC_WORK_WORDS/.test(req)
    && /speechIsGrounded\(raw, \[facts\.itemTitle, \.\.\.facts\.labels\]\)/.test(req)
    && /raw\.length <= ASK_SPEECH_MAX/.test(req));
  gate('T13.4 the DETERMINISTIC sentence is the FLOOR, never the primary (AI failure speaks plainer, never blanks)',
    !!req && /const floor = askPreamble\(facts\);/.test(req)
    && /return usable \? raw : floor;/.test(req) && /catch \{\s*\n\s*return floor;/.test(req));
  gate('T13.5 the floor is BUILT from the work + the judged consequence (never a bare label)',
    !!req && /const CONSEQUENCE: Record<WorkVerb, string>/.test(req)
    && /export function askPreamble\(args: \{/.test(req)
    && /itemTitle: string;/.test(req));
  gate('T13.6 the judged verb REACHES the seam — every resolveRequirements caller hands over its consequence',
    !!req && /work\?: WorkVerb \| null;/.test(req)
    // ⟲ RE-POINTED (W13.2): 3 → 4 — the pass's pre-lane staging re-verify (reverifyStaleStaging →
    // resolveRequirements) hands over the consequence too.
    && !!pass && (pass.match(/requires: verdict\.requires, work: verdict\.work,/g) ?? []).length === 4
    && /work: verdict\.work,/.test(read('app/api/inbox/[id]/draft/route.ts') ?? '')
    && /work: verdict\.work,/.test(read('app/api/items/judge/route.ts') ?? ''));
  gate('T13.7 COMPOSED ONCE — a standing ask covering the same gap re-states its words, never re-buys them',
    !!req && /const sameGap = Array\.isArray\(priorItems\)/.test(req)
    && /sameGap && priorText/.test(req)
    && !!pass && /text: priorText \|\| await composeAskSpeech\(/.test(pass));
  gate('T13.8 BOTH ask-authoring seams speak through the ONE composer',
    !!req && !!pass && /composeAskSpeech\(admin, userId, \{/.test(pass)
    && !/askPreamble\(/.test(pass));
  gate('T13.9 the LABEL still renders VERBATIM in its row (the judged inventory is never rewritten by the speech)',
    !!req && /state: \{ items: uncovered\.map\(\(m2\) => m2\.label\), taskId: null \}/.test(req));

  // 2 — THE CHAT FEEL: one accent per room, the kit's own input-card grammar.
  gate('T13.10 NO amber/orange anywhere in the rail’s markup (the ask was a second focus point)',
    !!rail && !/(?:border|bg|text|from|to|ring)-(?:amber|orange)-/.test(rail));
  // RE-POINTED (W3-A, Sep 22): the ask stopped WEARING the kit's grammar and became the kit's own
  // card — so the grammar is asserted where it now lives (thread-cards.tsx `case 'input'`), and the
  // rail is asserted to draw NONE of it. The law is unchanged and strictly harder to break.
  gate('T13.11 the ask IS the kit’s input card — neutral card, quiet chips, no form widget, and the room draws none of it',
    !!kit && /case 'input': \{/.test(kit)
    && /SHELL, MAX_W, 'flex flex-col gap-2\.5 p-3\.5'/.test(kit)
    && !!rail && /<InputCard/.test(rail)
    // the room keeps no checklist markup, no chip markup and no ask shell of its own
    && !/const checklistBlock/.test(rail) && !/Point me to it<\/button>/.test(rail));
  // RE-POINTED Sep 22 (W4-B, THE TYPE-IT DOOR — window only, law untouched): the `input` case grew
  // by the per-row doors, pushing the go-ahead link past a 3200-char read window. 3200 → 4200 now
  // covers the whole case again — which makes the `bg-indigo-600` half of this gate and of T13.13
  // STRICTER (more of the case is swept), never weaker.
  gate('T13.12 the never-blocking door is the kit’s quiet indigo TEXT link, never a filled button',
    !!kit && (() => {
      const i = kit!.indexOf("case 'input': {");
      const seg = kit!.slice(i, i + 4200);
      return /text-\[12px\] font-medium text-indigo-600 hover:text-indigo-700/.test(seg)
        && !/bg-indigo-600/.test(seg);
    })());
  gate('T13.13 the ask card carries ZERO filled primary CTAs (the room’s one accent is the pinned actions)',
    !!kit && (() => {
      const i = kit!.indexOf("case 'input': {");
      return !/bg-indigo-600/.test(kit!.slice(i, i + 4200)); // RE-POINTED Sep 22 — see T13.12
    })()
    && !!rail && !/const checklistBlock/.test(rail));
  gate('T13.14 answering happens IN the conversation — "Point me to it" opens the ONE composer (no second widget, no lying door)',
    !!rail && /setComposerPrefill\(/.test(rail) && /prefill=\{composerPrefill\}/.test(rail)
    && /onPrefillConsumed=\{\(\) => setComposerPrefill\(null\)\}/.test(rail));

  // 3 — THE FACES NAME THEMSELVES AND POINT SOMEWHERE.
  gate('T13.15 the pile names everyone on hover and caps with a quiet "+N" (never a silent truncation)',
    !!avatar && /const shown = faces\.slice\(0, max\);/.test(avatar)
    && /const rest = faces\.length - shown\.length;/.test(avatar)
    && /title=\{title\}/.test(avatar) && /\+\{rest\}/.test(avatar));
  gate('T13.16 each face already carries its OWN name (AvatarStatus title), and a handler-less pile stays inert chrome',
    !!avatar && /title=\{hint \|\| statusWord\}/.test(avatar)
    && /if \(!onClick\) return <span className="flex items-center" title=\{title\}>/.test(avatar));
  gate('T13.17 the header pile IS the door to where people and inventory live — the drawer',
    !!room && /<FacePile faces=\{faces\} size=\{26\} max=\{4\} label="In this room"[\s\S]{0,80}onClick=\{\(\) => setDrawerOpen\(true\)\} \/>/.test(room));
  gate('T13.18 the room collects MORE faces than it shows, so "+N" is a truth and not a constant',
    !!room && /out\.length >= 8/.test(room));
  gate('T13.19 an initials chip is IDENTITY, not an affordance — it wears no primary accent',
    !!read('components/work/worker-face.tsx')
    && /bg-neutral-100 font-semibold text-neutral-600/.test(read('components/work/worker-face.tsx') ?? '')
    && !/bg-indigo-100/.test(read('components/work/worker-face.tsx') ?? ''));
}

// ── T12 · THE COWORKER DM IS A PANE, AND IT OPENS AT ONCE ───────────────────────────────────────
// The owner walk, Sep 7: the DM "takes a lot to load and looks off". Two laws came out of it.
//   GEOMETRY — the frozen board (docs/design/threads/CoworkerDM.dc.html) puts the header at the TOP
//   EDGE of the content area, the timeline directly beneath and the composer at the bottom: ONE
//   pane, ONE scroller (the kit's thin one). The dead zone was the Home's sticky floor (`mt-auto`)
//   holding a short thread at the bottom of a padded column; the thick bar was the page's scroller
//   nested outside the shell's. So the takeover event carries a MODE and the host stands down.
//   SPEED — the pane, the face and the name are known at CLICK time and paint at click time; the
//   thread mapping and the last-painted turns are stamped caches; the two independent reads fly
//   together; the genuinely cold path waits under a skeleton, never a blank pane.
console.log('\nT12 · THE COWORKER DM — the board’s pane, opening at once');
{
  const ask = read('components/home/home-ask.tsx');
  const home = read('components/home/home-view.tsx');
  const shell = read('components/thread/thread-shell.tsx');
  gate('T12.0 both surfaces exist', !!ask && !!home);

  // ── GEOMETRY ──
  gate('T12.1 the DM header rides the shell’s HEADER PROP, so it is the pane’s first child (top edge, not a floating card)',
    !!ask && /header=\{dmHeader\}/.test(ask)
    && /leadFace: \{ id: dmActor\.id, name: dmActor\.name \}/.test(ask)
    && !!shell && shell.indexOf('{header && <ThreadHeader') < shell.indexOf('<ThreadTimeline'));
  gate('T12.1a the header carries the role SUBTITLE, read from a cache the shell already writes (no new fetch)',
    !!ask && /presenceRoleLabel\(dmActor\.id\) \? \{ subtitle: presenceRoleLabel\(dmActor\.id\) \}/.test(ask)
    && /loadLS<PresenceMate\[\]>\('aug-team-presence-v1'\)/.test(ask)
    && !/fetch\('\/api\/workers\/presence'/.test(ask));
  gate('T12.2 the DM takeover announces its MODE and the pane FILLS (no reading-column box, no max-height)',
    !!ask && /detail: \{ active: showThread, mode: dmPane \? 'dm' : 'home' \}/.test(ask)
    && /const dmPane = showThread && !!dmActor;/.test(ask)
    && /dmPane\s*\?\s*'min-h-0 flex-1'\s*:\s*'!bg-transparent max-h-\[calc\(100vh-200px\)\] min-h-\[46vh\]'/.test(ask));
  gate('T12.3 the HOST stops docking the DM to the Home’s sticky floor (that mt-auto push WAS the dead zone)',
    !!home && /const dmPane = chatActive && chatDm;/.test(home)
    // RE-POINTED Sep 18 (the entrance): the same div now carries the entrance veil before its
    // className, because the composer is the second block to rise in. The clause is unchanged —
    // the dmPane branch is still what decides the docking.
    && /<div style=\{entrance\.veil\(1\)\} className=\{dmPane\n/.test(home)
    && /\{projectDetailOpen \|\| dmPane/.test(home)
    // …and the Home chat's own floor is untouched.
    && /sticky bottom-0 mt-auto pt-8 pb-5/.test(home));
  gate('T12.4 ONE SCROLLER: the page scroller stands down in DM mode, the kit’s thin one is the only one',
    !!home && /\$\{dmPane \? 'overflow-hidden' : 'overflow-y-auto'\}/.test(home)
    && !!shell && /overflow-y-auto \[scrollbar-width:thin\]/.test(shell));

  // ── SPEED ──
  gate('T12.5 the coworker→thread MAPPING is a stamped cache, read SYNCHRONOUSLY',
    !!ask && /const cachedDmThread = \(agentId: string\): string \| null => \{/.test(ask)
    && /loadLS<string>\(dmKey\(agentId\)\)/.test(ask) && /saveLS\(dmKey\(agentId\), tid\)/.test(ask)
    && /saveLS\(dmKey\(w\.id\), id\)/.test(ask)
    // the raw localStorage writes it replaced are gone
    && !/localStorage\.setItem\(dmKey\(/.test(ask) && !/localStorage\.getItem\(k\); if \(c\) return c;/.test(ask));
  gate('T12.6 NO sequential find-then-load when the mapping is known — the click goes straight to the thread',
    !!ask && /const known = cachedDmThread\(w\.id\);/.test(ask)
    && /if \(known\) \{ void loadWorkerRoom\(`worker:\$\{known\}:\$\{w\.id\}`\); return; \}/.test(ask));
  gate('T12.7 INSTANT PAINT: the last-painted turns hydrate before the request, stamped and per coworker',
    !!ask && /const DM_TURNS_LS = \(agentId: string\) => `aug-dm-turns-v1-\$\{agentId\}`;/.test(ask)
    && /const painted = loadLS<Turn\[\]>\(DM_TURNS_LS\(agentId\)\);/.test(ask)
    && /saveLS\(DM_TURNS_LS\(agentId\), loaded\.slice\(-DM_TURNS_CACHED\)\)/.test(ask));
  gate('T12.8 the background arrival OBEYS the no-mutation law — painted turns keep their seat, only the tail appends',
    !!ask && /loaded\.length > prev\.length \? \[\.\.\.prev, \.\.\.loaded\.slice\(prev\.length\)\] : prev/.test(ask));
  gate('T12.8a a SYNTHESIZED first contact is never cached (a greeting is this open’s speech, not history)',
    !!ask && /const synthesized = loaded\.length === 0;/.test(ask)
    && /if \(!synthesized\) saveLS\(DM_TURNS_LS\(agentId\)/.test(ask));
  gate('T12.9 the two independent reads fly TOGETHER (messages + roster), and the roster has one flight',
    // (the DM read moved to the /chat door — the only one that serves message metadata, i.e. the
    // conversation's cards; the ONE-FLIGHT law it asserts is unchanged)
    !!ask && /await Promise\.all\(\[\s*\n[\s\S]{0,600}?fetch\(`\/api\/work\/threads\/\$\{tid\}\/chat`\)[\s\S]{0,120}getRoster\(\),\s*\n\s*\]\)/.test(ask)
    // ⟲ RE-POINTED (W4.1): the roster entry gained the ROLE KEY (the chrome first contact reads role
    // vocab from lib/workers/roles, never a name-keyed map) — the one-flight law is unchanged.
    && /const rosterFlight = useRef<Promise<Array<\{ id: string; name: string(; role\?: string \| null)? \}>> \| null>\(null\);/.test(ask)
    && /if \(rosterFlight\.current\) return rosterFlight\.current;/.test(ask));
  gate('T12.10 the pane takes the page ON ADDRESS, and the cold path wears a SKELETON in the thread’s shape',
    // RE-POINTED (Sep 18, THE CHAT OPENS INSTANTLY): the takeover clause gained the chat lane and
    // the skeleton serves BOTH lanes — the law ("the pane paints at click time") is wider, not
    // weaker, and there is still exactly ONE placeholder for the one wait.
    !!ask && /const showThread = open && \(hasThread \|\| !!dmActor \|\| !!chatRoom\);/.test(ask)
    && /const openingSkeleton = \(dmLoading \|\| chatLoading\) && !hasThread \?/.test(ask)
    && /beforeTimeline=\{openingSkeleton\}/.test(ask)
    && !/const dmSkeleton =/.test(ask)); // no second skeleton anywhere

  // ── T12.11–13 · THE CHAT LANE OPENS THE SAME WAY (Sep 18) — clicking a past conversation in the
  //    sidebar used to sit on the deck until /api/room/turns landed; a failed fetch died silently
  //    forever, and an EMPTY room was deterministic forever-nothing. The DM door's three laws now
  //    hold one lane over: paint on the click, speak on failure, and open an empty room honestly.
  gate('T12.11 THE CHAT OPENS INSTANTLY — `chatRoom` is render state set synchronously in loadRoom, before the flight',
    !!ask && /const \[chatRoom, setChatRoom\] = useState<string \| null>\(null\);/.test(ask)
    && /const \[chatLoading, setChatLoading\] = useState\(false\);/.test(ask)
    // set from the key alone INSIDE loadRoom and BEFORE the flight — nothing is awaited first
    && (() => {
      const i = ask!.indexOf('const loadRoom = (key: string) => {');
      if (i < 0) return false;
      const seg = ask!.slice(i, i + 2000);
      const set = seg.indexOf('setChatRoom(key); setChatLoading(true);');
      const flight = seg.indexOf('fetch(`/api/room/turns?key=');
      return set > 0 && flight > set;
    })()
    // …and the lane clears wherever the DM lane clears (new chat · Home reset · a DM taking over)
    && (ask.match(/setChatRoom\(null\); setChatLoading\(false\);/g) ?? []).length >= 3);
  gate('T12.12 THE FAILURE SPEAKS — no silent catch on the turns fetch; a dead read says so in the pane and does NOT claim the room',
    (() => {
      if (!ask) return false;
      const i = ask.indexOf('fetch(`/api/room/turns?key=');
      const seg = ask.slice(i, i + 1400);
      return /Promise\.reject\(new Error\('turns'\)\)/.test(seg)
        && /\.catch\(\(\) => \{[\s\S]{0,400}Couldn't open that conversation — try again\./.test(seg)
        && !/\.catch\(\(\) => \{\}\)/.test(seg)
        // the key is stored on the SUCCESS path only — a conversation we could not read is not a
        // room the next turn may append to
        && seg.indexOf('localStorage.setItem(CHAT_KEY_LS, key)') < seg.indexOf('.catch(');
    })());
  gate('T12.13 AN EMPTY ROOM IS AN OPEN ROOM — `turns: []` paints the room (no skeleton left hanging), and the cross-page intent flag is consumed on a SAME-PAGE open (THE FRESH FLOOR)',
    !!ask && /setChatLoading\(false\);\s*\n[\s\S]{0,400}setTurns\(mapServerTurns\(d\.turns\)\);/.test(ask)
    && !/if \(!Array\.isArray\(d\?\.turns\)\) return;/.test(ask)
    && (() => {
      const i = ask!.indexOf('const onOpen = (e: Event) => {');
      return i > 0 && /sessionStorage\.removeItem\('aug-open-chat-intent'\)/.test(ask!.slice(i, i + 800));
    })());
}

// ── T14 · CROSS-PROJECT NAVIGATION IS WARM (owner walk, Sep 7 — "clicking across projects takes
//        so long") ────────────────────────────────────────────────────────────────────────────────
// Three seams, one latency law: the click already has the payloads (hover warm + route prefetch),
// the nav paints within a frame (a route-level skeleton in the room's own shape), and the new id
// paints its OWN cache (a keyed remount, so no previous project's state stands in the way).
console.log('\nT14 · CROSS-PROJECT NAV — warm before the click, a frame after it');
{
  const warm = read('lib/room/warm-room.ts');
  const sidebar = read('components/one/one-sidebar.tsx');
  const room = read('components/entities/entity-room.tsx');
  const grid = read('components/entities/portfolio-view.tsx');
  const client = read('app/(main)/project/[id]/project-room-client.tsx');
  const loading = read('app/(main)/project/[id]/loading.tsx');

  gate('T14.0 the warm is ONE implementation at ONE address (the room re-exports it — never a fork)',
    !!warm && /export function warmEntityRoom/.test(warm) && /export function cancelWarmEntityRoom/.test(warm)
    && !!room && /export \{ warmEntityRoom, cancelWarmEntityRoom \} from '@\/lib\/room\/warm-room';/.test(room)
    && !/export function warmEntityRoom/.test(room));
  gate('T14.1 the warm stays POLITE — hover intent before it fires, and one warm at a time',
    !!warm && /\}, 160\)\);/.test(warm) && /while \(warmQueue\.length\)/.test(warm) && /if \(warmRunning\) return;/.test(warm));
  gate('T14.2 the SIDEBAR project rows warm on hover and focus, and cancel on leave (the grid\u2019s idiom, shared)',
    !!sidebar && /warmEntityRoom, cancelWarmEntityRoom \} from '@\/lib\/room\/warm-room'/.test(sidebar)
    && /onMouseEnter=\{\(\) => \{ if \(!active\) \{ warmEntityRoom\(p\.id\); router\.prefetch\(href\); \} \}\}/.test(sidebar)
    && /onMouseLeave=\{\(\) => cancelWarmEntityRoom\(p\.id\)\}/.test(sidebar)
    && /onFocus=\{\(\) => \{ if \(!active\) \{ warmEntityRoom\(p\.id\); router\.prefetch\(href\); \} \}\}/.test(sidebar)
    && !!grid && /onMouseEnter=\{\(\) => warmEntityRoom\(e\.id\)\}/.test(grid));
  // RE-POINTED (Sep 8): the column's markup moved into the ONE shared skeleton, so the pulses live
  // there now. The law is unchanged and slightly stronger \u2014 the route boundary must still stand in
  // the room's own shape with no client JS and no data, and it must do it through the shared shape.
  const skel = read('components/room/room-skeleton.tsx');
  gate('T14.3 a route SKELETON stands in the room\u2019s own shape, so a nav paints instead of freezing on the old page',
    !!loading && /export default function ProjectRoomLoading/.test(loading)
    && /h-\[52px\]/.test(loading)
    && /<RoomConversationSkeleton \/>/.test(loading)
    && !/use client/.test(loading) && !/fetch\(/.test(loading)
    && !!skel && /animate-pulse/.test(skel) && /max-w-\[760px\]/.test(skel));
  // \u2500\u2500 THE WHITE VOID (owner screenshot, Sep 8) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // The photographed blank was NOT the route boundary: EntityRoom rendered
  // `conversation={rail ? <ItemRail\u2026/> : null}`, so between the segment resolving and the view
  // landing the whole conversation column was nothing \u2014 a painted header around a white page.
  gate('T14.3a THE ROOM NEVER RENDERS A VOID \u2014 a null view stands in the room\u2019s own shape, not in nothing',
    !!room && /conversation=\{rail \? \(/.test(room)
    && /\) : <RoomConversationSkeleton \/>\}/.test(room)
    && !/conversation=\{rail \? \([\s\S]*?\) : null\}/.test(room));
  gate('T14.3b ONE SHAPE, TWO MOMENTS \u2014 the boundary and the room share the skeleton (a drifting ghost re-layouts)',
    !!skel && /export function RoomConversationSkeleton\(/.test(skel)
    // presentational purity: safe in a server loading.tsx AND a client room
    && !/use client|useState|useEffect|fetch\(/.test(skel)
    && !!loading && /from '@\/components\/room\/room-skeleton'/.test(loading)
    && !!room && /from '@\/components\/room\/room-skeleton'/.test(room));
  gate('T14.3c THE SERVER-PAINT SEAM is declared and inert \u2014 optional props, every existing caller unaffected',
    !!room && /initialDetail\?: Detail \| null; initialRail\?: RailView \| null;/.test(room)
    && /useState<Detail \| null>\(initialDetail \?\? null\)/.test(room)
    && /useState<RailView \| null>\(initialRail \?\? null\)/.test(room));
  gate('T14.4 the room\u2019s two reads FLY TOGETHER (never a detail-then-rail waterfall)',
    !!room && /const cached = loadLS<Detail>\(roomDetailKey\(entityId\)/.test(room) /* key producer, not a literal — re-pointed Sep 13 */
    && /fetch\(`\/api\/entities\/\$\{entityId\}\/detail`\)[\s\S]{0,400}fetch\(`\/api\/entities\/\$\{entityId\}\/room`\)/.test(room)
    && !/await fetch\(`\/api\/entities\/\$\{entityId\}\/detail`\)/.test(room));
  gate('T14.5 the HYDRATE KEYS ON THE ENTITY ID — the mount effect re-runs per id, and a soft nav between projects REMOUNTS (no state bleed)',
    !!room && /\}, \[entityId\]\);/.test(room)
    && !!client && /<EntityRoom key=\{entityId\} entityId=\{entityId\}/.test(client));

  // ── THE CONVERSATION HYDRATES TOO (Sep 8) ───────────────────────────────────────────────────
  // The room's detail + rail have had stamped envelopes since the instant-load doctrine; its TURNS
  // fetched only after mount, strictly after /room returned — the waterfall the reader watched as
  // an empty column under a painted brief.
  {
    const railSrc = read('components/home/item-rail.tsx');
    const turnsRoute = read('app/api/room/turns/route.ts');
    gate('T14.8 ONE KEY PRODUCER — the warm fills the SAME envelope the mount reads (the fake-warm class)',
      !!warm && /export const roomTurnsKey = \(roomKey: string\) => `aug-room-turns-\$\{roomKey\}`;/.test(warm)
      && !!railSrc && /import \{ roomTurnsKey \} from '@\/lib\/room\/warm-room';/.test(railSrc)
      // nobody restates the key string
      && (railSrc.match(/aug-room-turns-/g) || []).length === 0);
    gate('T14.8a the mount HYDRATES from it, under the IMPORTED freshness floor, never restated',
      !!railSrc && /loadLS<\{ turns\?: ServerTurnRow\[\] \}>\(roomTurnsKey\(roomKey\), \{ maxAgeMs: ROOM_CACHE_MAX_AGE_MS \}\)/.test(railSrc)
      && /import \{ ROOM_CACHE_MAX_AGE_MS \} from '@\/lib\/room\/no-mutation';/.test(railSrc)
      && !/15 \* 60_000/.test(railSrc));
    gate('T14.8b NEVER AN EMPTY PAINT — an envelope with no rows hydrates nothing (hasContent-gated)',
      !!railSrc && /if \(!rows\.length\) return;/.test(railSrc)
      // this session's own in-flight turns outrank any cache
      && /if \(\(_dealTurns\.get\(roomKey\) \?\? \[\]\)\.length\) return;/.test(railSrc));
    gate('T14.8c the live response still lands with SERVER TRUTH WINS INCLUDING DELETIONS (the merge is untouched)',
      !!railSrc && /SERVER TRUTH WINS — INCLUDING DELETIONS/.test(railSrc)
      && /saveLS\(roomTurnsKey\(roomKey\), \{ turns: d\.turns \}\)/.test(railSrc));
    gate('T14.8d ONE READING of a served row — hydrate and fetch enter the SAME mapper (never a second parse)',
      !!railSrc && /function mapServerTurns\(rows: ServerTurnRow\[\]\): Turn\[\]/.test(railSrc)
      && (railSrc.match(/mapServerTurns\(/g) || []).length === 3); // the definition + both doors
    gate('T14.8e THE FROZEN DELTA LINE KEEPS ITS ONE SOURCE — no marker is ever cached',
      !!railSrc && !/readAt/.test(railSrc.slice(railSrc.indexOf('const hydrated = mapServerTurns') - 900, railSrc.indexOf('const hydrated = mapServerTurns') + 300))
      // comments may NAME the marker (they explain why it is absent); no CODE may store it
      && !!warm && !/readAt/.test(warm.replace(/^\s*\/\/.*$/gm, ''))
      // the envelope's shape is turns-only on both sides
      && /saveLS\(roomTurnsKey\(entityId\), \{ turns: d\.turns \}\)/.test(warm));
    gate('T14.8f A HOVER IS NOT A VISIT — the warm PEEKS, so a prefetch can never eat the reopen delta',
      !!warm && /&peek=1/.test(warm)
      && !!turnsRoute && /const peek = request\.nextUrl\.searchParams\.get\('peek'\) === '1';/.test(turnsRoute)
      && /if \(!peek\) after\(async \(\) => \{ await stampRoomMarker/.test(turnsRoute));
    gate('T14.8g the warm STAMPS ITSELF ONLY AFTER the payloads land (a failed warm stays retryable)',
      !!warm && (() => {
        const i = warm.indexOf('roomWarmed.set(entityId, Date.now())');
        const j = warm.indexOf('roomTurnsKey(entityId)');
        return i > 0 && j > 0 && j < i;
      })());
  }

  // ── THE COLD PATH: the warm only helps a click that has been anticipated. The route behind it
  // was a ~20-await sequential chain, so a cold room paid every round-trip end to end. The law is
  // STAGES: a read waits only on what it actually consumes.
  const detail = read('app/api/entities/[id]/detail/route.ts');
  {
    // Structural, and robust: inside the handler the function body sits at EXACTLY four spaces —
    // every nested block (a Promise.all array, an inner IIFE, a loop) is indented deeper. So
    // "top-level statements containing await" is a clean grep, and each one is a sequential wait.
    // The auth/params preamble is plumbing, not a data round-trip; the rest are the stages.
    const topAwaits = (detail?.match(/^ {4}\S[^\n]*\bawait\b[^\n]*/gm) ?? [])
      .filter((l) => !/createClient\(\)|auth\.getUser\(\)|await params/.test(l));
    const flights = (detail?.match(/await Promise\.all\(\[/g) ?? []).length;
    gate('T14.6 the detail route is STAGES, not a waterfall — ≤4 sequential waits, each one a flight of independent reads',
      !!detail && topAwaits.length > 0 && topAwaits.length <= 4 && flights >= 2,
      `${topAwaits.length} top-level awaits · ${flights} Promise.all flights`);
    gate('T14.7 no table read sits ALONE at the top level — every query flies inside a stage',
      !!detail && !/^ {4}\S[^\n]*await supabase\.from\(/m.test(detail)
      && !/^ {4}\S[^\n]*= await (buildWorkItems|assembleLedger|suggestLooseForEntity|suggestWorkerForMove|getPersonEntities)\(/m.test(detail));
    // Renamed T14.8 → T14.17 (Sep 14): the id was claimed twice — two different laws answering to
    // one name makes a failure report ambiguous (the gate-id-collision class, caught by two agents
    // in one day). The uniqueness guard at the summary now fails the suite on any duplicate.
    gate('T14.17 stage 1 is the entity + its links (the 404 guard rides the same flight), stage 3 is the one read that CONSUMES the spine',
      !!detail && /const \[\{ data: ent \}, \{ data: links \}\] = await Promise\.all\(\[/.test(detail)
      && /if \(!ent\) return NextResponse\.json\(\{ error: 'not found' \}, \{ status: 404 \}\);/.test(detail)
      && /const eventsByWid = await ganttMod\.ganttEventsFor\(/.test(detail));
  }
  {
    const rv = read('lib/entities/room-view.ts');
    // RE-POINTED Sep 18 (widened, never weakened): this gate used to pin ONE literal pair
    // (`const [routed, response] = await Promise.all([…])`). That shape was a snapshot of the
    // waterfall as it stood, not the law — and it made the law un-improvable: buildRoomView still
    // ran FOUR sequential waves, three of which never needed the wave above them (the stored room
    // response, the membership links, the entity's knowledge files and the near-dup helper all key
    // on ids the caller already handed in). The law it was protecting is the one asserted here now,
    // and it is strictly stronger: NOTHING in this builder is a solo waterfall. Every await is a
    // Promise.all batch, so a read may only sit in a later wave when it genuinely consumes an
    // earlier one — which, in this builder, is true of exactly two things (the routing verdict needs
    // `ent.next_move`; the sibling row reads need the link ids).
    const rvBody = rv ? rv.slice(rv.indexOf('export async function buildRoomView')).split('\n// ──')[0] : '';
    gate('T14.9 buildRoomView is ALL BATCHES — no read waits on a wave it does not consume (the routing verdict and the stored response still fly, never one after the other)',
      !!rv
      // no bare single-query waterfall anywhere in the builder
      && !/=\s*await supabase\.from\(/.test(rvBody)
      // …and no lone awaited helper either: every await in the builder is a Promise.all
      && (rvBody.match(/\bawait\b/g) ?? []).length === (rvBody.match(/await Promise\.all\(\[/g) ?? []).length
      // both halves of the original pair are still batched (neither may regress to a solo await)
      && /await Promise\.all\(\[[\s\S]*?readRoomResponse\(supabase, userId, entityId\)/.test(rvBody)
      && /await Promise\.all\(\[[\s\S]*?suggestWorkerForMove\(/.test(rvBody)
      && !/suggestedWorker: await suggestWorkerForMove\(/.test(rv));
  }

  // ── THE ROOM'S PAINT (owner walk, Sep 8 — "project room still takes too long": a near-blank page
  // held for a long beat). The room's WHOLE conversation pane is gated on the /room read
  // (`conversation={rail ? … : null}`), so anything that read carries, the reader stares at a white
  // page for. T21's law reaches here: the read path carries only the read. ────────────────────────
  {
    const rv = read('lib/entities/room-view.ts');
    const detail = read('app/api/entities/[id]/detail/route.ts');
    const routeSug = read('lib/prepare/route-suggestion.ts');
    const page = read('app/(main)/project/[id]/page.tsx');
    const warm = read('lib/room/warm-room.ts');
    const room = read('components/entities/entity-room.tsx');
    const loading = read('app/(main)/project/[id]/loading.tsx');

    gate('T14.10 NO AI ON THE ROOM’S READ PATH — the routing verdict is deferred at BOTH read doors (a chip never holds a page)',
      !!routeSug && /deferOnMiss/.test(routeSug)
      && /if \(opts\?\.deferOnMiss\) \{ inBackground\(/.test(routeSug)
      && !!rv && /suggestWorkerForMove\(supabase, userId, entityId, \{ next_move: ent\.next_move \}, \{ deferOnMiss: true \}\)/.test(rv)
      && !!detail && /suggestWorkerForMove\(supabase, user\.id, id, \{ next_move: ent\.next_move \}, \{ deferOnMiss: true \}\)/.test(detail));
    gate('T14.10a …and the DEFERRED verdict still lands — it warms the same sig-cache the next open reads (a defer is never a drop)',
      !!routeSug && /routeSig: sig/.test(routeSug) && /const compute = async \(\)/.test(routeSug)
      // The blocking contract is UNCHANGED for the write paths that want the verdict in hand.
      && /return await compute\(\);/.test(routeSug));
    gate('T14.11 the DRAWER’s judge never gates the room — "might belong here" reasons in the background, and [] stays an honest answer',
      !!rv && /opts\?: \{ deferJudge\?: boolean \}/.test(rv)
      && /if \(opts\?\.deferJudge\) \{ inBackground\(/.test(rv)
      && !!detail && /\{ deferJudge: true \}/.test(detail));
    gate('T14.12 THE ACTIVITY TAB COSTS NOTHING — history is assembled from rows the route already holds, never a second synthesis-grade ledger',
      // The word survives in the comment that records WHY it left — the CALL is what must be gone.
      !!detail && !/assembleLedger\(/.test(detail) && !/\{ assembleLedger \}/.test(detail)
      && /const history = \[/.test(detail)
      // …and it is still the SAME refs the room’s HistoryList opens (one fact, one home).
      && /ref: `inbox:\$\{it\.id as string\}`/.test(detail)
      && /ref: `meeting:\$\{m\.id as string\}`/.test(detail)
      && /ref: `commit:\$\{c\.id as string\}`/.test(detail)
      // …and no row is fetched twice for it: the ledger’s own tables are the ones already in hand.
      && !/from\('emails'\)/.test(detail));
    gate('T14.13 THE PAGE SEGMENT WAITS ON ONE ANSWER — guard · params · auth fly together, and the auth read is the CACHED one',
      !!page && /const \[, \{ id \}, \{ tab \}, user\] = await Promise\.all\(\[/.test(page)
      && /getSessionUser\(\)/.test(page)
      && !/await supabase\.auth\.getUser\(\)/.test(page));
    gate('T14.14 THE WARM FILLS THE ENVELOPE THE MOUNT READS — same two keys, same freshness floor, one law',
      !!warm && /ROOM_CACHE_MAX_AGE_MS/.test(warm)
      // ⚠️ RE-POINTED (Sep 14): the keys gained a SHAPE segment (T28.31) — a payload whose served
      // shape changed must not be read back by a render that reasons over the new field. The law
      // here is unchanged: ONE producer per key, imported by the mount, under the one floor.
      && /roomDetailKey = \(entityId: string\) => `aug-entity-detail-\$\{ROOM_CACHE_SHAPE\}-\$\{entityId\}`/.test(warm)
      && /roomRailKey = \(entityId: string\) => `aug-entity-rail-\$\{ROOM_CACHE_SHAPE\}-\$\{entityId\}`/.test(warm)
      // STRENGTHENED Sep 13 (cleanup): the mount used to re-spell these keys as byte-identical
      // LITERALS, so this clause could only ever prove the two strings HAPPENED to match today.
      // The mount now IMPORTS the producers — one key, one author — which is the law itself rather
      // than evidence of it, and a rename is structurally impossible to do by halves.
      && !!room && /import \{ roomDetailKey, roomRailKey \} from '@\/lib\/room\/warm-room';/.test(room)
      && /loadLS<Detail>\(roomDetailKey\(entityId\), \{ maxAgeMs: ROOM_CACHE_MAX_AGE_MS \}\)/.test(room)
      && /loadLS<RailView>\(roomRailKey\(entityId\), \{ maxAgeMs: ROOM_CACHE_MAX_AGE_MS \}\)/.test(room)
      && !/`aug-entity-(detail|rail)-\$\{entityId\}`/.test(room));
    gate('T14.14a A WARM EXPIRES WITH WHAT IT WARMED — a room warmed once still re-warms when its envelope ages out of paintability',
      !!warm && /const WARM_TTL_MS = ROOM_CACHE_MAX_AGE_MS \/ 2;/.test(warm)
      && /function warmIsFresh/.test(warm)
      && /if \(warmIsFresh\(entityId\)/.test(warm)
      // …and the warm stamps itself only AFTER the payloads landed (a failed warm is retryable).
      && /\]\);\s*\n(\s*\/\/[^\n]*\n)*\s*roomWarmed\.set\(entityId, Date\.now\(\)\);/.test(warm));
    gate('T14.15 EMPTY-PAINT RESPECTED — the room hydrates only from a cache young enough to trust, and a landing payload fills rather than swaps',
      !!room && /mayReplaceInPlace\('open', !!cached\)/.test(room)
      && /mayReplaceInPlace\('open', !!cachedRail\)/.test(room));
    // RE-POINTED (Sep 8): the conversation column moved into the ONE shared skeleton so the room's
    // own null-view state can stand in the same shape (the white void). The law is unchanged —
    // header · pinned card · turns · composer, no data, no client JS — it is just asserted across
    // the boundary AND the shape it now mounts, which is strictly more than it checked before.
    const skel16 = read('components/room/room-skeleton.tsx');
    gate('T14.16 THE SKELETON STANDS IN THE ROOM’S OWN SHAPE — header · pinned card · turns · composer, no data, no client JS',
      !!loading && /h-\[52px\]/.test(loading) && /<RoomConversationSkeleton \/>/.test(loading)
      && !/use client/.test(loading) && !/fetch\(/.test(loading)
      && !!skel16 && /max-w-\[760px\]/.test(skel16)
      && /The pinned card/.test(skel16) && /The composer/.test(skel16)
      && !/use client|fetch\(/.test(skel16));
  }
}

// ── T15 · ONE ROOM GRAMMAR ACROSS ITEMS AND PROJECTS (P3, owner walk Sep 7) ─────────────────────
// "The room isn't the same across items and projects." The project room collapsed in Phase 3; the
// loose /item door kept the old docked two-pane. It now wears the SAME anatomy — header · the
// thread full width · the SUMMONED stage · the Filed drawer — with different filed contents.
console.log('\nT15 · THE ITEM ROOM IS THE PROJECT ROOM — same header, same handle, same drawer');
{
  const detail = read('components/home/item-detail.tsx');
  const room = read('components/entities/entity-room.tsx');
  const drawer = read('components/room/filed-drawer.tsx');
  const shell = read('components/room/room-shell.tsx');
  const icon = read('components/room/filed-icon.tsx');
  const page = read('app/(main)/item/[id]/page.tsx');
  const modal = read('components/home/item-detail-modal.tsx');
  gate('T15.0 both rooms exist and the handle mark has ONE home', !!detail && !!room && !!icon
    && !!room && /from '@\/components\/room\/filed-icon'/.test(room)
    && /from '@\/components\/room\/filed-icon'/.test(detail)
    // …and neither room re-draws it locally.
    && !/function FiledIcon/.test(room) && !/function FiledIcon/.test(detail));

  // THE HEADER — the project room's own line, verbatim in shape: 52px, back · name · the machine's
  // word · faces · the Filed handle · ⋯. And NOTHING in it narrates.
  gate('T15.1 the item room opens with the SAME 52px header line as the project room',
    !!detail && /<header className="flex-shrink-0 flex items-center gap-3 h-\[52px\] px-5 bg-white border-b border-neutral-200\/80">/.test(detail)
    && !!room && /<header className="flex-shrink-0 flex items-center gap-3 h-\[52px\]/.test(room));
  gate('T15.2 the header carries back (the BackLink idiom) · the title · the machine’s ONE word · the faces',
    !!detail && /<BackLink fallback="\/home"/.test(detail)
    && /className="min-w-0 max-w-\[40%\] truncate text-\[15px\] font-semibold/.test(detail)
    && /room\.stateWord && \(/.test(detail) && /machineWordOf\(view\)/.test(detail)
    && /<FacePile faces=\{room\.faces\}/.test(detail));
  gate('T15.2b the faces are DERIVED from what the view already serves (no second store, no new read)',
    !!detail && /function facesOf\(/.test(detail) && /for \(const p of view\?\.prepared \?\? \[\]\) push\(p\.by\);/.test(detail)
    && !/fetch\('\/api\/people/.test(detail));
  {
    // The header's OWN slice: chrome may carry facts (who · when · due) but never prose.
    const header = detail?.match(/<header className="flex-shrink-0 flex items-center gap-3 h-\[52px\][\s\S]*?<\/header>/)?.[0] ?? '';
    gate('T15.3 the header carries NO prose (no brief, no summary, no next move in the chrome)',
      !!header && !/brief/i.test(header) && !/summary/i.test(header) && !/nextMove/.test(header)
      && !/GapLine|room\.gap/.test(header));
  }
  gate('T15.4 URGENCY IS A WORD: the machine’s state wears a tone, never a badge, and no rose/red chrome',
    !!detail && /const MACHINE_TONE: Record<string, string>/.test(detail)
    && /awaiting_input: 'text-amber-600'/.test(detail)
    && !/bg-rose-|bg-red-/.test(detail?.match(/<header className="flex-shrink-0 flex items-center gap-3 h-\[52px\][\s\S]*?<\/header>/)?.[0] ?? ''));

  // THE STAGE IS SUMMONED — no docked second pane at rest, on ANY kind.
  gate('T15.5 the shell receives a NULL stage at rest (the source material is summoned, never docked)',
    !!detail && /stage=\{room\.stageOpen \? \(/.test(detail) && /\) : null\}/.test(detail)
    && !!shell && /const hasStage = stage !== null/.test(shell));
  // RE-POINTED (Sep 9, owner walk — "I see the thread button on top, not clear; maybe move it to
  // the component as the others"): a kind whose source material READS (a mail thread) no longer
  // summons a stage for it at all — it reads in the drawer's own Thread section, and the card owns
  // the door. A kind whose source is a WORKSPACE (a meeting's notes, a commitment's ask) keeps the
  // summon handle. The law is unchanged where it still applies; the seat moved where it didn't.
  gate('T15.6 every kind starts with its stage DOWN, and every stage lowers (no docked pane anywhere)',
    !!detail && (detail.match(/const \[sourceOpen, setSourceOpen\] = useState\(false\);/g) ?? []).length === 2
    && (detail.match(/const stageOpen = sourceOpen \|\|/g) ?? []).length === 2
    && (detail.match(/const lowerStage = \(\) =>/g) ?? []).length === 4
    // …and the two reading kinds raise their stage only on a DEED, never to "show me the thread".
    && /const stageOpen = composerOpen \|\| forwarding \|\| inviteOpen;/.test(detail)
    && /const stageOpen = composerOpen \|\| inviteOpen;/.test(detail));
  gate('T15.6b the summon door is VISIBLE chrome where it exists, and ABSENT where the drawer reads the source',
    !!detail && /onClick=\{room\.stageOpen \? room\.onLowerStage : room\.onSummonStage\}/.test(detail)
    && /\{room\.sourceLabel\}<\/button>/.test(detail)
    // it is DATA, not a kind branch: the frame renders the handle only when the kind supplies one
    && /\{room\.onSummonStage && room\.sourceLabel && \(/.test(detail)
    && /onSummonStage\?: \(\) => void;/.test(detail) && /sourceLabel\?: string;/.test(detail)
    // …the two workspace kinds still summon; the two reading kinds hand over nothing
    && (detail.match(/onSummonStage: \(\) => setSourceOpen\(true\)/g) ?? []).length === 2
    && !/sourceLabel: objectKind === 'email_thread' \? 'Thread'/.test(detail)
    && !/sourceLabel: 'Thread',/.test(detail)
    // …and it never doubles as a ⋯ row.
    && !/label: 'Open the thread'/.test(detail));
  gate('T15.7 the raised stage wears the room’s breadcrumb (one tap lowers it; you never left the room)',
    !!detail && /onClick=\{room\.onLowerStage\}/.test(detail) && /\{clipTitle\(room\.title, 30\)\}/.test(detail)
    && /\{room\.stageLabel\}/.test(detail));
  gate('T15.8 the summoned SHEET survives inside it (reply · follow-up · invite · forward, one frame, one Send)',
    !!detail && /function StageOverlay/.test(detail) && (detail.match(/<StageOverlay/g) ?? []).length >= 3
    && /absolute inset-x-0 bottom-0 z-20 max-h-\[72%\]/.test(detail));
  // RE-POINTED (W7.3 ONE STAGE, Sep 23 — found live: the commitment door's "Source" handle and a
  // nudge row summoned a split stage holding the OLD ComposePanel while the email door wore the kit
  // EmailCard in the conversation). The commitment door's stage now exists ONLY for a parked gate;
  // its message is the ONE EmailCard in the conversation (smoke-one-stage A-block carries the law).
  gate('T15.8b a parked GATE is the room’s one move, so it raises the stage the way a focused artifact does — and on the commitment door NOTHING ELSE raises one',
    !!detail && /const gateStanding = isHandoff && handoffOpen;/.test(detail)
    && /const stageOpen = sourceOpen \|\| \(isHandoff && inviteOpen\) \|\| gateStanding;/.test(detail));
  gate('T15.8c THE JUDGE NEVER RAISES A STAGE — the meeting door keeps its person-raised composer; the commitment door has NO composer stage at all (W7.3)',
    !!detail && (detail.match(/const \[composeRaised, setComposeRaised\] = useState\(false\);/g) ?? []).length === 1
    && !/setComposing\(true\);/.test(detail.slice(detail.indexOf('function CommitmentDetail')))
    && !/stageOpen = sourceOpen \|\| composing/.test(detail));

  // THE DRAWER — ⚠️ RE-POINTED (owner, Sep 14, the maintenance-work complaint): this door carried
  // its OWN 420px lookalike of the project room's pane — its own escape handler, its own scrim, its
  // own keyframes, and (since the Sep 14 wave) no drag at all. It mounts THE ONE component now, so
  // every law the three gates below assert is asserted at its single implementation (T7.7/T7.8/
  // T7.11), and what is checked here is that this door really is that mount.
  // ⚠️ RE-POINTED (Sep 15, same call as T7.6): the word is imported at BOTH doors.
  gate('T15.9 the Details handle toggles THE ONE drawer (no second pane in this file), with the imported word',
    !!detail && /<FiledIcon \/>\{FILED_LABEL\}/.test(detail) && !/<FiledIcon \/>Filed/.test(detail)
    && /import \{ FiledDrawer, RoomHistorySection, FILED_LABEL,/.test(detail)
    && /setDrawerOpen\(\(v\) => !v\)/.test(detail)
    && /drawerOpen \? 'border-indigo-300 bg-indigo-50 text-indigo-700'/.test(detail)
    && /<FiledDrawer$/m.test(detail)
    && !/max-w-\[420px\]/.test(detail)
    && !/aug-drawer absolute top-0 right-0/.test(detail)
    && !/@keyframes aug-drawer-in/.test(detail));
  gate('T15.10 its sections are the kind’s own tabs, handed in as DATA (no layout branch, no forked TabBar)',
    !!detail && /sections=\{tabs\}/.test(detail) && /signal=\{room\.drawerSignal \?\? null\}/.test(detail)
    && !/<TabBar/.test(detail));
  gate('T15.11 EXACTLY ONE drawer implementation exists in the tree (the maintenance-work law)',
    sourceFiles('components').concat(sourceFiles('app'))
      .filter((f) => /aug-drawer absolute top-0 right-0/.test(read(f) ?? '')).length === 1
    && sourceFiles('components').concat(sourceFiles('app'))
      .filter((f) => /@keyframes aug-drawer-in/.test(read(f) ?? '')).length === 1);
  // RE-POINTED (Sep 9): the flat chip strip became MEANINGFUL ROWS in the drawer's own grammar
  // (T25.2 carries the row law). The inventory law itself — counted, empty is absent, never
  // re-narrates — is unchanged and asserted here.
  gate('T15.12 the drawer INVENTORIES: related work + prepared work, and an empty section is ABSENT',
    !!detail && /function commonRoomTabs/.test(detail)
    && /node: <RelatedRows view=\{railView\} \/>/.test(detail)
    && /if \(railView && \(related > 0 \|\| railView\.entity\)\)/.test(detail)
    && /if \(preparedCount > 0\)/.test(detail)
    && /if \(files\.length > 0\)/.test(detail)
    // …and it never re-narrates: no brief, no gap line, no verdict prose in the drawer.
    && !/tabs\.push\(\{[\s\S]{0,200}GapLine/.test(detail));
  gate('T15.13 the drawer is the ONLY seat for that inventory (the stage stopped carrying it on the loose door)',
    !!detail && !/\{!embedded && railView && <ContextStrip/.test(detail)
    && (detail.match(/\{embedded && <PreparedLead/g) ?? []).length >= 2
    && !/^\s*<PreparedLead prepared=\{view\?\.prepared \?\? null\} \/>$/m.test(detail));

  // KIND VARIANCE IS DATA — the frame takes chrome, never a layout branch.
  gate('T15.14 all four kinds go through ONE layout (one frame, four RoomChrome objects, no kind fork)',
    !!detail && /function ItemRoomFrame\(/.test(detail)
    && (detail.match(/const room: RoomChrome \| null = embedded \? null : \{/g) ?? []).length === 4
    && (detail.match(/<DeepDiveShell embedded=\{embedded\} room=\{room\}/g) ?? []).length === 4
    // the frame itself branches on nothing kind-shaped
    && !/ItemRoomFrame[\s\S]{0,4000}kind === 'meeting'/.test(detail));
  gate('T15.15 the item’s chrome verbs have ONE home — the room’s ⋯ (the stage strip survives EMBEDDED only)',
    !!detail && /verbs: itemDismissed \? \[\] : \[/.test(detail)
    && /\{embedded && !itemDismissed && \(/.test(detail)   // the in-stage palette, embedded only
    && /\{!isHandoff && embedded && \(/.test(detail)       // the commitment footer, embedded only
    && /THE VERB STRIP/.test(detail));
  gate('T15.16 the verb-scope law holds through the move (a meeting-extracted action item gets no Reply)',
    !!detail && /\.\.\.\(objectKind === 'email_thread' \? \[/.test(detail)
    && /key: 'reply', label: 'Reply'/.test(detail));

  // THE ADDRESS + THE SEED HANDOFF — untouched by the collapse.
  gate('T15.17 the seed handoff still paints the clicked row’s own title (P29, never a placeholder)',
    !!detail && /seed\?\.title \|\| 'Email'/.test(detail) && /title: subject,/.test(detail));
  gate('T15.18 ONE back affordance per screen — the room owns it; the page and the modal dropped theirs',
    !!page && !/<BackLink/.test(page) && !/>Back to Home</.test(page)
    && !!modal && !/>Back to Home</.test(modal) && !/ArrowLeftIcon/.test(modal)
    // …and the intercept still self-dismisses on Escape / the backdrop.
    && /e\.key === 'Escape'\) close\(\)/.test(modal) && /onClick=\{close\}/.test(modal));
  gate('T15.19 the no-mutation machinery is untouched (the loose room still marks its mount read as the OPEN arrival)',
    !!detail && /refresh\('open'\)/.test(detail) && /mayReplaceInPlace\(reason, paintedRef\.current\)/.test(detail));
}

// ── T16 · THE CARD CONTRACT — THE INVITE CARD (the first interactive kind) ──────────────────────
// "The common deliverables arrive as FILLED, EDITABLE, ACTIONABLE components — the card IS the
// workspace." The invite proves the grammar for email and doc: one kit kind, ONE mapper, options
// that are code-verified before they may render, one commit door, and no second rendering anywhere.
console.log('\nT16 · THE INVITE CARD — filled, selectable in-card, committed through the one door');
{
  const types = read('components/thread/types.ts');
  const cards = read('components/thread/thread-cards.tsx');
  const mapper = read('lib/prepare/invite-card.ts');
  const host = read('components/home/invite-card.tsx');
  const preparer = read('lib/home/prepare-action.ts');
  const detail = read('components/home/item-detail.tsx');
  const rail = read('components/home/item-rail.tsx');

  // ── the kit kind
  gate('T16.1 the kit owns an `invite` card kind, in the grammar and in the enumeration',
    // RE-POINTED (Sep 19): the enumeration grew a `source` kind, so the gate asserts MEMBERSHIP in
    // THREAD_CARD_KINDS rather than pinning the neighbours a new kind may legitimately move.
    !!types && /kind: 'invite'/.test(types) && /THREAD_CARD_KINDS[\s\S]{0,400}'invite'/.test(types)
    && /ThreadCardKind =[\s\S]{0,180}'invite'/.test(types));
  gate('T16.2 it renders through the ONE switch (a kind without a render is a lying type)',
    !!cards && /case 'invite':/.test(cards) && /function InviteCardView/.test(cards));
  gate('T16.3 THE IN-CARD SELECTOR: contained full-width rows INSIDE the card — radio · label · muted annotation · hairline separators — never pills beneath it',
    !!cards && /function SelectorRow/.test(cards) && /role="radiogroup"/.test(cards)
    && /border-\[4\.5px\] border-indigo-600/.test(cards) && /border-\[1\.5px\] border-neutral-300/.test(cards)
    && /border-t border-neutral-200\/55/.test(cards) && /option\.annotation &&/.test(cards));
  gate('T16.4 the OPEN row is last and carries its own time field (the workspace stays the card)',
    !!mapper && /options\.push\(\{ id: INVITE_OPEN_OPTION/.test(mapper)
    && !!cards && /openPicked && card\.onPickTime/.test(cards) && /type="datetime-local"/.test(cards));
  gate('T16.5 the COMMIT ROW is the card’s bottom edge, with the receipt word at its right',
    !!cards && /THE COMMIT ROW[\s\S]{0,400}border-t border-neutral-200\/70 bg-neutral-50[\s\S]{0,600}card\.receipt/.test(cards));
  gate('T16.6 TRUTH BEFORE PRESENTATION: `needs_time` renders NO filled fields and NO Send — the card asks, it never poses as an empty form',
    !!cards && /const filled = card\.state === 'ready';/.test(cards) && /\{filled && \(/.test(cards)
    && !!host && /\.\.\.\(props\.state === 'ready' \? \{ onSend: send/.test(host));
  gate('T16.7 the kit stays PRESENTATIONAL (the interactive card fetches nothing, routes nothing)',
    !!cards && !/\bfetch\(/.test(cards) && !/next\/navigation/.test(cards) && !/supabase/i.test(cards));

  // ── ONE mapper, and options that had to earn their row
  gate('T16.8 ONE mapper module derives the card’s props (lib/prepare/invite-card.ts), and it is client-safe (pure — no fetch, no supabase, no AI)',
    !!mapper && /export function inviteCardOf\(/.test(mapper)
    && !/\bfetch\(/.test(mapper) && !/@supabase/.test(mapper) && !/getAIClient\(/.test(mapper)
    && !!host && /inviteCardOf\(/.test(host));
  gate('T16.8b every mount goes THROUGH the mapper — no second props derivation anywhere',
    (() => {
      const callers = sourceFiles('components').concat(sourceFiles('lib'), sourceFiles('app'))
        .filter((f) => (read(f) || '').includes('inviteCardOf('));
      return callers.length === 2 && callers.includes('lib/prepare/invite-card.ts') && callers.includes('components/home/invite-card.tsx');
    })());
  gate('T16.9 ALTERNATIVES ARE CODE-VERIFIED before they may render — the preparer calls the evidence check on each candidate (dateStatedInText AND timesInText, in the user’s zone)',
    !!preparer && /export function statedSlot\(/.test(preparer)
    && /dateStatedInText\(text, parts\.dateStr\) && timesInText\(text\)\.includes\(parts\.hhmm\)/.test(preparer)
    // The check moved INSIDE the one grounding (`groundInviteFromText`) when the chat lane joined
    // it — same strictness, one seat: whatever the source text is, every candidate passes it.
    && /if \(!statedSlot\(sourceText, s, timezone\)\) continue;/.test(preparer));
  gate('T16.10 the alternatives ride the preparer’s OUTPUT (its judgment is one pass, unchanged) and survive the stored artifact round-trip',
    !!preparer && /alternatives\?: InviteSlot\[\]/.test(preparer)
    && /Array\.isArray\(stored\.alternatives\)/.test(preparer));
  gate('T16.11 options are CAPPED at two concrete rows + the open row (a selector is a choice, never a list)',
    !!mapper && /INVITE_MAX_OPTIONS = 2/.test(mapper)
    && /if \(options\.length >= INVITE_MAX_OPTIONS\) break;/.test(mapper)
    && !!preparer && /if \(alternatives\.length >= 2\) break;/.test(preparer));

  // ── the donor is gone, and the commit door is the only door
  gate('T16.12 `InvitePreviewCard` is GONE codebase-wide (a donor retires the wave its successor ships)',
    sourceFiles('components').concat(sourceFiles('lib'), sourceFiles('app'))
      .every((f) => !/<InvitePreviewCard|function InvitePreviewCard/.test(read(f) || '')));
  gate('T16.13 SEND ROUTES THROUGH A COMMIT DOOR and nowhere else — the host knows exactly THREE doors: prepare (no side effects) + the two approve-before-commit sends',
    (() => {
      const doors = [...(host ?? '').matchAll(/fetch\(\s*'(\/api\/[^']+)'/g)].map((m) => m[1]);
      const chatDoors = [...(host ?? '').matchAll(/fetch\('(\/api\/[^']+)', \{/g)].map((m) => m[1]);
      const all = [...new Set([...doors, ...chatDoors])].sort();
      // ⟲ RE-POINTED (W9.1 THE USER'S HAND WINS): + THE EDIT DOOR `/api/items/prepared` — it saves
      // the user's own edits onto the prepared invite (stamped, never a send, no side effect beyond
      // their words); the send doors are still exactly the two approve-before-commit ones.
      return all.length === 4
        && all.includes('/api/items/prepare') && all.includes('/api/items/execute') && all.includes('/api/invites/send')
        && all.includes('/api/items/prepared');
    })());
  gate('T16.14 ONE RENDERING PER KIND — the invite’s own chrome (date tile · attendee chips · agenda quote · the time field) exists in exactly ONE file, the kit',
    (() => {
      const renders = sourceFiles('components').concat(sourceFiles('app'))
        .filter((f) => {
          const src = read(f) || '';
          return /Approve & send invite/.test(src) || /type="datetime-local"/.test(src) || /function AttendeeChip\b/.test(src);
        });
      return renders.length === 1 && renders[0] === 'components/thread/thread-cards.tsx';
    })());

  // ── EVERY THREAD, EVERY PRODUCER: the mounts that exist today
  gate('T16.15 the RAIL mounts the real card in the stream (an artifact whose kind has a card carries it as `node`; the generic Open row is then structurally absent)',
    !!rail && /node\?: React\.ReactNode/.test(rail)
    && /art\.node\s*\n?\s*\? \{\s*\n?\s*kind: 'custom'/.test(rail));
  gate('T16.16 the item rooms mount it at every door — the stream, the embedded stage, and the summoned stage — all the SAME component',
    !!detail && (detail.match(/<InviteCard/g) ?? []).length >= 6
    && /node: <InviteCard kind="email"/.test(detail)
    && /artifactList\.map\(\(art\) => art\.node \?/.test(detail));
  gate('T16.17 the people typeahead has ONE implementation, shared by the invite’s attendees and the forward’s recipients',
    (() => {
      const defs = sourceFiles('components').filter((f) => /function PeopleSuggestInput/.test(read(f) || ''));
      return defs.length === 1 && defs[0] === 'components/home/people-chips.tsx';
    })());
}

// ── T17 · EVERY THREAD, EVERY PRODUCER — THE PROMPTED INVITE ────────────────────────────────────
// "A plain prompt routes through the SAME preparer and lands the SAME card." Typing "set up a
// meeting with Sam Thursday 11h" into the Home thread or a coworker DM must produce the invite the
// proactive pass produces: one grounding, one card, one commit law — and NOTHING may send.
console.log('\nT17 · THE PROMPTED INVITE — one producer, one card, two stores, never a send');
{
  const tool = read('lib/tools/prepare-calendar-invite.ts');
  const preparer = read('lib/prepare/invite-from-conversation.ts');
  const core = read('lib/home/prepare-action.ts');
  const people = read('lib/people/suggest.ts');
  const store = read('lib/prepare/chat-invite-store.ts');
  const converse = read('lib/converse/index.ts');
  const registry = read('lib/work/surface-registry.ts');
  const featureMap = read('lib/workspace/tool-capabilities.ts');
  const askRoute = read('app/api/home/ask/route.ts');
  const sendDoor = read('app/api/invites/send/route.ts');
  const homeAsk = read('components/home/home-ask.tsx');
  const dmRoute = read('app/api/work/threads/[id]/chat/route.ts');
  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): the coworker DM's render moved into the ONE
  // conversation surface when components/workers/tabs/worker-chat-tab.tsx was retired as
  // unreachable. The DM is a MODE of home-ask now, so the DM half of these laws reads there.
  const dmTab = homeAsk;
  const host = read('components/home/invite-card.tsx');

  // ── the tool: it exists, it is feature-gated, and it structurally cannot send
  gate('T17.1 ONE tool contract + ONE execution body, shared by the chief loop and the coworker DM',
    !!tool && /export const prepareCalendarInviteDefinition/.test(tool)
    && /export async function executePrepareCalendarInvite/.test(tool)
    && (() => {
      const callers = sourceFiles('lib').concat(sourceFiles('app'))
        .filter((f) => (read(f) || '').includes('executePrepareCalendarInvite('));
      return callers.length === 3
        && callers.includes('lib/tools/prepare-calendar-invite.ts')
        && callers.includes('lib/converse/index.ts')
        && callers.includes('app/api/work/threads/[id]/chat/route.ts');
    })());
  gate('T17.2 THE TOOL NEVER SENDS — the definition says so, and no producer path touches the send executor',
    !!tool && /NEVER sends/.test(tool.slice(tool.indexOf('prepareCalendarInviteDefinition')))
    && !/executeSendCalendarInvite/.test(tool) && !/invites\/send/.test(tool.replace(/\/\/[^\n]*/g, ''))
    && !!preparer && !/executeSendCalendarInvite/.test(preparer)
    && !!converse && !/executeSendCalendarInvite/.test(converse)
    // The SENDING capability is exposed to no chat surface at all (only prepare_* is sayable).
    && !!registry && /prepare_calendar_invite: \{[\s\S]{0,600}?irreversible: false/.test(registry)
    && /send_calendar_invite: \{[\s\S]{0,400}?irreversible: true/.test(registry)
    && !/send_calendar_invite[\s\S]{0,400}?exposure: \[[^\]]*chief_of_staff/.test(registry));
  gate('T17.3 THE TIER LAW: the producer is a calendar verb, so a meetings-off workspace never sees it offered (one map, both surfaces)',
    !!featureMap && /prepare_calendar_invite: 'meetings'/.test(featureMap)
    && !!registry && /prepare_calendar_invite: \{[\s\S]{0,600}?feature: 'meetings'/.test(registry)
    // the chief slice filters its defs through TOOL_FEATURE; the DM's buildChatTools through isToolAllowed
    && !!converse && /TOOL_FEATURE\[\(d as \{ name: string \}\)\.name\]/.test(converse)
    // RE-POINTED (Sep 21, the door-parity wave): the DM route's tool list moved into
    // lib/work/chat-tool-defs.ts, where it is DERIVED from the capability registry. Same one map,
    // same isToolAllowed filter — a new home, not a new law.
    && (read('lib/work/chat-tool-defs.ts') || '').includes('if (!isToolAllowed(id, features)) continue;')
    && !!dmRoute && /buildCoworkerTools\(sources, isWorker, features\)/.test(dmRoute));

  // ── the preparer: the ONE grounding, never a fork
  gate('T17.4 THE CHAT PREPARER RIDES THE ONE GROUNDING — no forked time discipline (no second prompt, no second parse, no second evidence check)',
    !!preparer && /groundInviteFromText\(/.test(preparer)
    && !/getAIClient\(/.test(preparer) && !/aiCreate\(/.test(preparer)
    // (comments stripped — the header CITES the evidence check it delegates to; only CODE counts)
    && !/statedSlot|dateStatedInText|timesInText/.test(preparer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))
    && !!core && /export async function groundInviteFromText/.test(core)
    // both lanes are callers of the one core; nobody else re-implements it
    && (() => {
      const callers = sourceFiles('lib').concat(sourceFiles('app'), sourceFiles('components'))
        .filter((f) => (read(f) || '').includes('groundInviteFromText('));
      return callers.length === 2
        && callers.includes('lib/home/prepare-action.ts')
        && callers.includes('lib/prepare/invite-from-conversation.ts');
    })());
  gate('T17.5 FILLED FROM THE ONE GROUNDING — a scoped chat reads the room’s own assembled page and its people',
    !!preparer && /assembleRoomGrounding/.test(preparer) && /work_entities/.test(preparer));
  gate('T17.6 NEEDS_TIME ON AN UNGROUNDABLE ASK — the honest partial carries NO start, and the card renders the ask (never a guessed slot)',
    !!core && /startISO: '',/.test(core) && /const fallback = \(\): PreparedCalendarInvite/.test(core)
    && !!read('lib/prepare/invite-card.ts')
    && /state: ready \? 'ready' : 'needs_time'/.test(read('lib/prepare/invite-card.ts') || '')
    && !!host && /\.\.\.\(props\.state === 'ready' \? \{ onSend: send/.test(host));
  gate('T17.7 THE ATTENDEE FLOOR — a model-authored address can never survive: picks are intersected with the KNOWN list, and NAMES resolve in CODE through the people registry (ambiguity refuses)',
    !!core && /known\.has\(e\.toLowerCase\(\)\)/.test(core) && /g\.resolveNames/.test(core)
    && /\.filter\(\(n\) => n && !n\.includes\('@'\)\)/.test(core)
    && !!preparer && /resolvePersonEmail\(/.test(preparer) && /literalEmailsIn\(/.test(preparer)
    && !!people && /export async function resolvePersonEmail/.test(people)
    && /AMBIGUITY IS A REFUSAL/.test(people)
    // ONE people lookup — the typeahead route reads the same module, never its own copy
    && (() => {
      const defs = sourceFiles('lib').concat(sourceFiles('app'))
        .filter((f) => /relationship_graph/.test(read(f) || '') && /from\('emails'\)[\s\S]{0,200}from_address\.ilike/.test(read(f) || ''));
      return defs.length === 1 && defs[0] === 'lib/people/suggest.ts';
    })());

  // ── the card survives the tab, on BOTH surfaces
  gate('T17.8 DURABLE ON THE HOME THREAD — the answer’s card persists as the turn’s component, and the reload maps it back to the same card',
    !!askRoute && /component: \{ key: 'invite_card', refId: turn\.invite\.id/.test(askRoute)
    && !!homeAsk && /t\.component\?\.key === 'invite_card'/.test(homeAsk));
  gate('T17.9 DURABLE ON THE COWORKER DM — the prepared card persists on the message metadata, and the reload mounts it from there',
    !!dmRoute && /invite_cards: allInviteCards/.test(dmRoute)
    // RE-POINTED (W4-D, Sep 22): the DM reload rehydrates `invite_cards` off the message metadata
    // into its own ref list and mounts them through the same host — same law, the live seat.
    && !!dmTab && /invite_cards\?: Array</.test(dmTab)
    && /invite_cards\.map\(\(iv\) => \(\{ inviteId: iv\.id, invite: iv\.invite \}\)\)/.test(dmTab)
    && /<InviteCard chat=/.test(dmTab));
  gate('T17.10 ONE RENDERING PER KIND — every producer mounts the SAME host component (no second invite renderer anywhere)',
    (() => {
      const defs = sourceFiles('components').filter((f) => /export function InviteCard\(/.test(read(f) || ''));
      const mounts = sourceFiles('components').filter((f) => /<InviteCard\b/.test(read(f) || ''));
      // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): the third mount was the retired DM tab. The
      // law is stated in its strongest form instead — ONE definer, and EVERY mount in the tree
      // points at it, so a second renderer cannot appear anywhere rather than at three named spots.
      return defs.length === 1 && defs[0] === 'components/home/invite-card.tsx'
        && mounts.includes('components/home/home-ask.tsx')
        && mounts.includes('components/home/item-detail.tsx')
        && mounts.every((f) => f === 'components/home/invite-card.tsx'
          || /^components\/home\//.test(f) || /^components\/(thread|room)\//.test(f));
    })());

  // ── the commit: two stores, ONE executor, the door reads the row
  gate('T17.11 THE SEND DOOR READS THE STORE, NEVER THE BODY — the edits land on the row first, the send re-reads it',
    !!sendDoor && /readChatInvite\(supabase, user\.id, inviteId\)/.test(sendDoor)
    && /updateChatInvitePayload\(/.test(sendDoor)
    && /const record = await readChatInvite\(supabase, user\.id, inviteId\);/.test(sendDoor)
    && /const toSend = record\?\.invite \?\? merged;/.test(sendDoor));
  gate('T17.12 THE COMMIT DOOR, EXACTLY ONCE — claim → fire → record, a duplicate returns the prior result, a failure releases the claim',
    !!sendDoor && /claimCommit\(/.test(sendDoor) && /recordCommitResult\(/.test(sendDoor)
    && /releaseCommitClaim\(/.test(sendDoor)
    && /claim\.status === 'duplicate'/.test(sendDoor)
    // the card is spent only AFTER a successful send (a failed send must stay retryable)
    && /if \(failed\) return NextResponse\.json\(\{ ok: false[\s\S]{0,120}markChatInviteSent/.test(sendDoor));
  gate('T17.13 TWO DOORS, ONE EXECUTOR — only the two approve-before-commit routes may send an invite',
    (() => {
      const senders = sourceFiles('app').concat(sourceFiles('lib'))
        .filter((f) => /executeSendCalendarInvite\(/.test(read(f) || ''));
      return senders.length === 4                                   // definition + the workflow step dispatch + the two doors
        && senders.includes('lib/tools/send-calendar-invite.ts')
        && senders.includes('lib/workflows/execute-step.ts')
        && senders.includes('app/api/items/execute/route.ts')
        && senders.includes('app/api/invites/send/route.ts');
    })());
  gate('T17.14 THE STORE IS THE HOUSE PRECEDENT (item_plans, owner-scoped, no migration) and the not-found is indistinguishable',
    !!store && /CHAT_INVITE_KIND = 'chat_invite'/.test(store) && /from\('item_plans'\)/.test(store)
    && /eq\('user_id', userId\)/.test(store)
    && !!sendDoor && /no longer available/.test(sendDoor) && /status: 404/.test(sendDoor));

  // ── the gap that is NOT built is stated, not silent
  gate('T17.15 THE AGENTOS GAP IS DOCUMENTED where the Python tool would go (a box redeploy, deliberately not this wave)',
    (() => {
      const py = read('infra/agentos/tools_tasks.py');
      return !!py && /prepare_calendar_invite/.test(py) && /BOX REDEPLOY/i.test(py)
        && !!tool && /AGENTOS/.test(tool) && /REDEPLOYED/.test(tool);
    })());
}

// ── T18 · THE CARD CONTRACT — THE EMAIL CARD (the second interactive kind) ──────────────────────
// "The drafted reply, in the thread." One kit kind, ONE mapper, direction-variants that come from
// the reply-directions organ and regenerate through THE ONE REDRAFT PATH, one host with two commit
// doors, and no second rendering of an email draft anywhere.
console.log('\nT18 · THE EMAIL CARD — one kind, one host, two doors, the one redraft path');
{
  const types = read('components/thread/types.ts');
  const cards = read('components/thread/thread-cards.tsx');
  const mapper = read('lib/prepare/email-card.ts');
  const host = read('components/home/email-card.tsx');
  const detail = read('components/home/item-detail.tsx');
  const rail = read('components/home/item-rail.tsx');
  const homeAsk = read('components/home/home-ask.tsx');
  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): the coworker DM is a MODE of the one conversation
  // surface now; its old tab (components/workers/tabs/worker-chat-tab.tsx) was retired unreachable.
  const dmTab = homeAsk;
  const featureMap = read('lib/workspace/tool-capabilities.ts');

  // ── the kit kind
  gate('T18.1 the kit owns an `email` card kind, in the grammar and in the enumeration',
    !!types && /kind: 'email';/.test(types) && /THREAD_CARD_KINDS[\s\S]{0,400}'email'/.test(types)
    && /ThreadCardKind =[\s\S]{0,200}'email'/.test(types)
    && !!cards && /case 'email':/.test(cards) && /function EmailCardView/.test(cards));
  // The email card's own body — every structural assertion below reads THIS slice, so a match
  // borrowed from the invite card next door can never green a gate about the email one.
  const emailView = (cards ?? '').slice((cards ?? '').indexOf('function EmailCardView'));
  gate('T18.2 THE IN-CARD SELECTOR grammar, reused — the SAME SelectorRow the invite uses, inside the card, never pills beneath it',
    !!cards && (cards.match(/function SelectorRow/g) ?? []).length === 1
    && /<SelectorRow key=\{o\.id\}/.test(emailView) && /role="radiogroup"/.test(emailView));
  gate('T18.3 the COMMIT ROW is the card’s bottom edge, with the receipt word at its right',
    !!emailView && /THE COMMIT ROW[\s\S]{0,500}border-t border-neutral-200\/70 bg-neutral-50[\s\S]{0,900}card\.receipt/.test(emailView));
  gate('T18.4 TRUTH BEFORE PRESENTATION: no recipient ⇒ no Send (the card asks for the address and waits)',
    !!mapper && /state: to\.length \? 'ready' : 'needs_recipient'/.test(mapper)
    && !!cards && /const ready = card\.state === 'ready';/.test(cards) && /\{ready && card\.onSend/.test(cards)
    && !!host && /\.\.\.\(props\.state === 'ready' \? \{ onSend: send/.test(host));
  gate('T18.5 THE THREAD IS NEVER INLINED — the card carries a DOOR, and a door with no handler does not render',
    !!cards && /onOpenThread/.test(cards) && /card\.onOpenThread && \(/.test(cards)
    // the whole raw thread renderer lives nowhere near the kit
    && !/ThreadMessages/.test(cards)
    && !!types && /The card never inlines the email THREAD/.test(types));
  gate('T18.6 the kit stays PRESENTATIONAL (the second interactive card fetches nothing, routes nothing)',
    !!cards && !/\bfetch\(/.test(cards) && !/next\/navigation/.test(cards) && !/supabase/i.test(cards));

  // ── ONE mapper
  gate('T18.7 ONE mapper module derives the card’s props (lib/prepare/email-card.ts), client-safe (pure — no fetch, no supabase, no AI)',
    !!mapper && /export function emailCardOf\(/.test(mapper)
    && !/\bfetch\(/.test(mapper) && !/@supabase/.test(mapper) && !/getAIClient\(/.test(mapper)
    && !!host && /emailCardOf\(/.test(host));
  gate('T18.7b every mount goes THROUGH the mapper — no second props derivation anywhere',
    (() => {
      const callers = sourceFiles('components').concat(sourceFiles('lib'), sourceFiles('app'))
        .filter((f) => (read(f) || '').includes('emailCardOf('));
      return callers.length === 2 && callers.includes('lib/prepare/email-card.ts') && callers.includes('components/home/email-card.tsx');
    })());
  gate('T18.8 THE VARIANT SOURCE IS THE REPLY-DIRECTIONS ORGAN, and the mapper invents nothing — no directions ⇒ no tab row at all',
    !!mapper && /directions\?: EmailDirection\[\]/.test(mapper)
    && /const variants: EmailCardVariantProps\[\] = dirs\.length/.test(mapper)
    && !!host && /'\/api\/items\/reply-directions'/.test(host)
    // exactly one caller of the organ left in the product (the chips it used to feed are gone)
    && (() => {
      const callers = sourceFiles('components').concat(sourceFiles('app'), sourceFiles('lib'))
        .filter((f) => /fetch\('\/api\/items\/reply-directions'/.test(read(f) || ''));
      return callers.length === 1 && callers[0] === 'components/home/email-card.tsx';
    })());
  gate('T18.9 ONE DOOR PER DEED — the open tab summons the selector’s open row; the card never offers two ways to say the same thing',
    !!mapper && /const steering = picked === EMAIL_OPEN_VARIANT;/.test(mapper)
    && /options: steering \? \[\{ id: EMAIL_OPEN_OPTION/.test(mapper));

  // ── the ONE redraft path
  gate('T18.10 VARIANTS ARE LAZY and go through THE ONE REDRAFT PATH — /api/items/steer, no forked drafter anywhere in the host',
    !!host && /const redraft = useCallback\(/.test(host) && /'\/api\/items\/steer'/.test(host)
    // RE-POINTED (Sep 9): the cached-variant swap moved into `serve` — the ONE place the machine
    // replaces the body (it also re-seeds the editor). Lazy + cached is the law; `serve` is where.
    && /if \(variantBodies\[id\] !== undefined\) \{ serve\(id, variantBodies\[id\]\); return; \}/.test(host)
    && /setVariantBodies\(\(prev\) => \(\{ \.\.\.prev, \[targetVariant\]: String\(d\.draft\) \}\)\)/.test(host)
    // the host never calls a drafter of its own
    // RE-POINTED (W7.3): `/api/compose/draft` is now the COMPOSE lane's FILL READ — the commitment
    // analog of `/api/inbox/<id>/draft` (it serves the pooled draft through THE ONE READER and
    // drafts only when nothing is pooled, exactly as the inbox read does). The steer path stays the
    // one redraft path; no drafter is forked here.
    && !/generateReplyDraft|fresh=1/.test(host)
    && (host.match(/fetch\('\/api\/compose\/draft'/g) ?? []).length === 1
    // RE-POINTED (Sep 10, A PREVIEW IS NOT A DEED): the host now holds TWO lanes of the SAME route
    // — `redraft` (persisting, for an instruction the user authored) and `previewBody` (writes
    // nothing, for a direction they have not picked). The law is unchanged: one route, no forked
    // drafter, and every steerable affordance funnels into one of these two functions.
    && (host.match(/void redraft\(/g) ?? []).length >= 2
    && /const previewBody = useCallback\(/.test(host)
    && (host.match(/fetch\('\/api\/items\/steer'/g) ?? []).length === 2);
  // RE-POINTED (Sep 9, the card-editor walk): the law was "the machine stands aside", and it was
  // enforced by WITHHOLDING every handler — which is exactly how the owner met dead tabs. The law
  // it always meant is NOTHING OVERWRITES THEIR WORDS, and it is now kept by KEEPING them: the
  // user's version is its own tab. T24 carries the no-dead-controls half.
  gate('T18.11 THE EDIT IS THE USER’S — their version is preserved in its own tab; no machine path overwrites it',
    !!host && /const dirty = userEdit !== null;/.test(host)
    && /if \(userEdit !== null\) \{ setUserEdit\(value\); return; \}/.test(host)
    && /userEdit: dirty/.test(host)
    && /if \(id === EMAIL_USER_VARIANT\) \{ serve\(id, userEdit \?\? body\); return; \}/.test(host)
    // a tone tweak asked from the user's own tab retunes the PREPARED one, never their words
    && /variant === EMAIL_USER_VARIANT \? EMAIL_BASE_VARIANT : variant/.test(host)
    && !!mapper && /export const EMAIL_USER_VARIANT/.test(mapper)
    && /mail\.userEdit \? \[\{ id: EMAIL_USER_VARIANT/.test(mapper));
  gate('T18.12 THE TONE VOCABULARY IS CHROME, NOT SPEECH — a closed deterministic list in the mapper, applied through the same one path',
    !!mapper && /export const EMAIL_TONES/.test(mapper) && /instruction:/.test(mapper)
    && !!host && /EMAIL_TONES\.find\(\(t\) => t\.id === id\)/.test(host)
    && (() => {
      const defs = sourceFiles('components').concat(sourceFiles('lib'))
        .filter((f) => /EMAIL_TONES\s*[:=]/.test(read(f) || ''));
      return defs.length === 1 && defs[0] === 'lib/prepare/email-card.ts';
    })());

  // ── ONE host, the commit descriptors, and the donor
  gate('T18.13 THREE PRODUCERS, TWO EXISTING DOORS — the host knows exactly the draft read + the two approve-before-commit sends, and builds no new send door',
    (() => {
      // Comments strip first: only the doors the CODE actually opens count.
      const code = (host ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const doors = [...new Set([...code.matchAll(/fetch\(\s*[`']([^`']+)/g)]
        .map((m) => m[1].replace(/\$\{[^}]+\}/g, '<id>')))].sort();
      // EXACTLY these: two reads that have no side effects, the ONE redraft path, and the two
      // approve-before-commit sends. A seventh door appearing here is a new send door by another
      // name, and this gate is where it stops.
      const expected = [
        '/api/inbox/<id>/draft',
        '/api/inbox/<id>/send-reply',
        '/api/inbox/<id>/thread',
        '/api/items/reply-directions',
        '/api/items/steer',
        // the KB half of the attach affordance — a READ of a file the user picked, no side effect
        // (the local-file half never leaves the browser until the send carries it)
        '/api/kb/attachment?fileId=<id>',
        '/api/work/threads/<id>/send-coworker-email',
        // RE-POINTED (Sep 21, the owner's convergence call): the STANDALONE lane's own commit door
        // — a draft answering a message in no inbox of ours. It is a SEND, and it is here under the
        // same rule as its two siblings: approve-before-commit, exactly-once at the route, and
        // reachable only from the card's one `send`. An eighth door is still a new door, and this
        // gate is still where it stops.
        '/api/emails/send',
        // RE-POINTED (W7.3 ONE STAGE, Sep 23): the COMPOSE lane — a commitment's message, the ONE
        // card instead of the retired split-stage ComposePanel. Its fill read (the pooled draft,
        // addressed by THE ONE ADDRESSEE LADDER) and its approve-before-commit send (the commit
        // door at /api/compose/send, exactly-once). Reachable only from the card's one `send`.
        '/api/compose/draft',
        '/api/compose/send',
        // ⟲ RE-POINTED (W9.1 THE USER'S HAND WINS): THE EDIT DOOR — a real edit on a PREPARED
        // artifact (item lane reply draft / compose lane message) is saved as the user's hand so no
        // sweep ever overwrites it. A write of the user's own words, never a send.
        '/api/items/prepared',
      ];
      return doors.length === expected.length && expected.every((d) => doors.includes(d));
    })()
    && !!host && /\/send-coworker-email`/.test(host));
  gate('T18.13b EVERY SEND IS THE USER’S CLICK — the two doors fire only from the card’s own `send`',
    (() => {
      const code = (host ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      return /const send = async \(\) => \{/.test(code)
        && (code.match(/send-coworker-email/g) ?? []).length === 1
        && (code.match(/send-reply/g) ?? []).length === 1
        && (code.match(/emails\/send/g) ?? []).length === 1
        && (code.match(/compose\/send/g) ?? []).length === 1;
    })());
  gate('T18.14 `EmailDraftCard` is GONE codebase-wide (a donor retires the wave its successor ships)',
    !read('components/workers/email-draft-card.tsx')
    && sourceFiles('components').concat(sourceFiles('lib'), sourceFiles('app'))
      .every((f) => !/<EmailDraftCard|function EmailDraftCard/.test(read(f) || '')));
  gate('T18.15 ONE RENDERING PER KIND — one host component, mounted by every producer (item room · coworker DM · Home thread)',
    (() => {
      const defs = sourceFiles('components').filter((f) => /export function EmailCard\(/.test(read(f) || ''));
      const mounts = sourceFiles('components').filter((f) => /<EmailCard\b/.test(read(f) || ''));
      // RE-POINTED (W4-D, Sep 22): the DM mount moved into home-ask with the DM itself; the law is
      // stated harder — ONE definer, and no mount anywhere outside the live conversation surfaces.
      return defs.length === 1 && defs[0] === 'components/home/email-card.tsx'
        && mounts.includes('components/home/item-detail.tsx')
        && mounts.includes('components/home/home-ask.tsx')
        && mounts.includes('components/entities/entity-room.tsx')
        && mounts.every((f) => /^components\/(home|thread|room|entities)\//.test(f));
    })()
    // the card's own chrome (recipient chips, the direction tabs, the tone menu) exists in the KIT alone
    && (() => {
      const renders = sourceFiles('components').concat(sourceFiles('app'))
        .filter((f) => /function RecipientChip\b|function ToneMenu\b/.test(read(f) || ''));
      return renders.length === 1 && renders[0] === 'components/thread/thread-cards.tsx';
    })());
  gate('T18.16 the ITEM ROOM mounts it in the stream as the reply artifact’s own card (the generic Open row is then structurally absent)',
    !!detail && /node: <EmailCard\s*\n?\s*item=\{\{ id/.test(detail)
    && !!rail && /art\.node\s*\n?\s*\? \{\s*\n?\s*kind: 'custom'/.test(rail));
  gate('T18.17 THE CARD IS THE CTA — a node-carrying artifact is never merged away into the pinned text line',
    !!rail && /mergedArtifactKey\(respMove, \(artifacts \?\? \[\]\)\.filter\(\(a\) => !a\.node\)\)/.test(rail));
  gate('T18.18 the DONOR EXCHANGE retired — the direction chips folded INTO the card (one selector, not chips beside a card)',
    !!rail && !/act === 'direction'/.test(rail) && !/act: 'direction'/.test(rail)
    && !!detail && !/reply-directions/.test(detail.replace(/\/\/[^\n]*/g, ''))
    && /const startReplyExchange = openComposer;/.test(detail));
  gate('T18.19 THE TIER LAW BOTH WAYS — the mailbox reply lane is gated on the workspace feature; the COWORKER lane (compose_email, feature-null) works on a sovereign workspace',
    !!host && /const mailboxLane = features\.email !== false;/.test(host)
    && /useFeatures\(\)/.test(host)
    // RE-POINTED (W7.3): the COMPOSE lane is live everywhere too — /api/compose/send falls back to
    // the assistant's address on a workspace with no mailbox (the universal compose door's own law).
    && /const live = !sent && \(coworker \|\| standalone \|\| composeLane \|\| mailboxLane\)/.test(host)
    && !!featureMap && /compose_email: null/.test(featureMap)
    && /send_prepared_reply: 'email'/.test(featureMap));
  gate('T18.20 PERSISTENCE PER SURFACE — each lane reuses the store it already had (the item’s own draft; the DM’s message metadata, whose `sent_at` write-back survives a reload)',
    !!host && /coworker\?\.draft\.sent_at/.test(host) && /draftId: coworker\.draft\.id/.test(host)
    && !!dmTab && /email_drafts\?: CoworkerEmailDraft\[\]/.test(dmTab)
    && !!homeAsk && /coworker=\{\{ threadId: d\.tid/.test(homeAsk)
    && !!read('app/api/work/threads/[id]/send-coworker-email/route.ts')
    && /sent_at: new Date\(\)\.toISOString\(\)/.test(read('app/api/work/threads/[id]/send-coworker-email/route.ts') || ''));
  // ── T18.21 · THE STANDALONE LANE (Sep 21 — the owner's convergence call) ──────────────────────
  // "I don't want us to have multiple components for the same thing in different ways — shouldn't
  // we reuse the email draft component, and leave the reply-FROM open for the user? If only one
  // mailbox it fills with that one; if multiple inboxes, allow email/inbox selection." A draft
  // answering a message in no inbox of ours is THE SAME CARD, plus the one fact the item lane never
  // has to ask: which mailbox sends.
  gate('T18.21a NO FOURTH RENDERING — the standalone draft is a MODE of the one card, not a component of its own',
    (() => {
      const defs = sourceFiles('components').filter((f) => /export function EmailCard\(/.test(read(f) || ''));
      // nothing anywhere renders an email draft outside the one host + the kit
      const strays = sourceFiles('components').filter((f) =>
        /function (Standalone|Chat)?Email(Draft|Compose)?Card\b/.test(read(f) || '')
        && f !== 'components/home/email-card.tsx' && f !== 'components/thread/thread-cards.tsx');
      return defs.length === 1 && strays.length === 0
        && !!host && /standalone\?: \{ emailId: string; draft: StandaloneEmailDraft \}/.test(host);
    })());
  gate('T18.21b THE FROM ROW belongs to the KIT, and renders only where the sender is a real question (one states itself · several offer themselves · none names the assistant’s address)',
    !!types && /from\?: string;/.test(types) && /fromOptions\?: Array<\{ id: string; label: string \}>/.test(types)
    && !!emailView && /\{\(card\.from \|\| \(card\.fromOptions\?\.length \?\? 0\) > 0\) && \(/.test(emailView)
    && /card\.onPickFrom!\(ev\.target\.value\)/.test(emailView)
    && !!host && /\.\.\.\(standalone \? \{\s*\n\s*from: sendFromLabel\(/.test(host)
    // the item lane never grows the row: its sender is settled by the thread it answers
    && /\.\.\.\(\(standalone\.draft\.from\?\.options\?\.length \?\? 0\) > 1 && !sent \?/.test(host));
  gate('T18.21c THE FROM RESOLUTION IS PURE AND LIVES IN THE ONE MAPPER — no second derivation, and the assembly that uses it never drafts',
    !!mapper && /export function resolveSendFrom\(/.test(mapper) && /export function sendFromLabel\(/.test(mapper)
    && !/\bfetch\(/.test(mapper) && !/@supabase/.test(mapper)
    && (() => {
      const callers = sourceFiles('components').concat(sourceFiles('lib'), sourceFiles('app'))
        .filter((f) => /resolveSendFrom\(/.test(read(f) || ''));
      return callers.length === 2 && callers.includes('lib/prepare/email-card.ts')
        && callers.includes('lib/prepare/standalone-reply.ts');
    })());
  gate('T18.21d A CARD IS A TURN on this lane too — the draft persists as one component and rehydrates through the SAME host (an item-born one as a POINTER, a standalone one with its payload)',
    !!read('app/api/home/ask/route.ts') && /key: 'email_draft_card', refId: turn\.emailDraft\.id/.test(read('app/api/home/ask/route.ts') || '')
    && !!homeAsk && /t\.component\?\.key === 'email_draft_card'/.test(homeAsk)
    && /\<EmailCard item=\{\{ id: ed\.itemId \}\} \/\>/.test(homeAsk)
    && /\<EmailCard standalone=\{\{ emailId: ed\.emailId/.test(homeAsk));
  gate('T18.21e THE STORE IS THE TRUTH — a standalone draft lives on its own row (the chat_invite precedent) and its send door reads THAT row, never the request body',
    (() => {
      const store = read('lib/prepare/chat-email-store.ts') || '';
      const door = read('app/api/emails/send/route.ts') || '';
      return /export const CHAT_EMAIL_KIND = 'chat_email';/.test(store)
        && /export async function readChatEmail\(/.test(store) && /export async function markChatEmailSent\(/.test(store)
        && /const stored = await readChatEmail\(supabase, user\.id, emailId\);/.test(door)
        && /if \(stored\.sentAt\) return NextResponse\.json\(\{ ok: true, alreadyExecuted: true/.test(door)
        && /await markChatEmailSent\(supabase, user\.id, emailId\)/.test(door);
    })());
  gate('T18.21f THE CARD NEVER WEARS A FIELD ITS DOOR WOULD DROP — Bcc, attachments, the direction tabs and the tone menu are the ITEM lane’s alone',
    !!host && /const itemLane = !!item && !coworker && !standalone;/.test(host)
    && /\.\.\.\(itemLane \? \{\s*\n\s*onOpenBcc/.test(host)
    && /\.\.\.\(itemLane \? \{ onSteer:/.test(host)
    && /\.\.\.\(itemLane \? \{ toneOptions/.test(host)
    && /directions: itemLane && mailboxLane \? directions : \[\]/.test(host));

  // ── THE CARD SURVIVES THE RELOAD ON THE CHIEF LANE (Sep 8, found live: a draft a Home-addressed
  // coworker produced rendered live and was GONE on reload — the exchange itself was never written)
  gate('T18.22a THE EXCHANGE PERSISTS — a coworker addressed from the Home thread writes BOTH turns into the room (worker mode still opts out: the DM store owns that conversation)',
    !!homeAsk && /persistTurn\('user', question \+ fileNote\)/.test(homeAsk)
    && /persistTurn\('system', said, undefined, \{/.test(homeAsk)
    && /authorAgentId: w\.id/.test(homeAsk)
    && /if \(workerRoomRef\.current\) return; \/\/ worker mode/.test(homeAsk));
  gate('T18.22b A CARD IS A TURN — EVERY card kind the exchange makes rides that turn as ONE allowlisted component, and the door resolves the author itself (the client never sets an author string)',
    !!homeAsk && /component: \{ key: 'worker_cards', refId: tid, state: \{ items: refs \} \}/.test(homeAsk)
    && /refs\.push\(\{ kind: 'document', tid, artifactId: event\.artifact\.id \}\)/.test(homeAsk)
    && /refs\.push\(\{ kind: 'email_draft', tid, agentId: w\.id, draftId: event\.draft\.id \}\)/.test(homeAsk)
    && /refs\.push\(\{ kind: 'workflow_draft', tid, token: wd\.token \}\)/.test(homeAsk)
    && /refs\.push\(\{ kind: 'invite', tid, inviteId: event\.card\.id \}\)/.test(homeAsk)
    && (() => {
      const route = read('app/api/room/turns/route.ts') || '';
      return /body\.component\?\.key === 'worker_cards'/.test(route)
        && /from\('custom_agents'\)/.test(route)
        && /author = \{ kind: 'coworker'/.test(route)
        // the door mints nothing else: only the one allowlisted key ever reaches the store
        && !/body\.component\.key/.test(route.replace(/body\.component\?\.key === 'worker_cards'/g, ''));
    })());
  gate('T18.22b2 NO GENERIC PASSTHROUGH — each card KIND has its own validator naming its own pointer fields, and an unknown kind or a malformed item is dropped',
    (() => {
      const route = read('app/api/room/turns/route.ts') || '';
      const kinds = ['email_draft', 'document', 'workflow_draft', 'invite'];
      return /const CARD_POINTERS: Record<string, \(raw: Record<string, unknown>\) => Record<string, string> \| null>/.test(route)
        && kinds.every((k) => new RegExp(`${k}: \\(r\\) =>`).test(route))
        // the kind must RESOLVE to a validator — never a spread of whatever the client sent
        && /const validate = typeof r\.kind === 'string' \? CARD_POINTERS\[r\.kind\] : undefined;/.test(route)
        && /return validate \? validate\(r\) : null;/.test(route)
        && /\.slice\(0, 8\)/.test(route)
        && !/\.\.\.r\b/.test(route) && !/\.\.\.raw\b/.test(route)
        && !/\.\.\.body\.component/.test(route);
    })());
  gate('T18.22c A POINTER, NEVER A FROZEN COPY — every kind is re-read from the store its own door writes (drafts/invites/tasks on the DM message metadata; documents on the thread’s artifact row)',
    !!homeAsk && /type WorkerCardRef =/.test(homeAsk)
    && /t\.component\?\.key === 'worker_cards'/.test(homeAsk)
    // ONE FLIGHT PER THREAD, through the DM door that actually serves `metadata`
    && /fetch\(`\/api\/work\/threads\/\$\{tid\}\/chat`\)/.test(homeAsk)
    && /m\.metadata\?\.email_drafts/.test(homeAsk) && /m\.metadata\?\.invite_cards/.test(homeAsk)
    && /m\.metadata\?\.workflow_drafts/.test(homeAsk)
    && /\(d\.thread as \{ artifacts\?/.test(homeAsk)
    // the stored pointers carry NO payload — only the ids their stores are keyed by
    && !/items: refs\.map/.test(homeAsk)
    && (() => {
      // Every validator returns ONLY the ids its store is keyed by — no title, body, recipients,
      // steps or invite payload can enter the turn through this door.
      const route = read('app/api/room/turns/route.ts') || '';
      return /\{ kind: 'email_draft', tid, agentId, draftId \} : null;/.test(route)
        && /\{ kind: 'document', tid, artifactId \} : null;/.test(route)
        && /\{ kind: 'workflow_draft', tid, token \} : null;/.test(route)
        && /\{ kind: 'invite', tid, inviteId \} : null;/.test(route)
        // …and the validator block itself names no content field (the request `body` variable
        // lives outside it, so the scan is the block, not the file)
        && (() => {
          const block = route.slice(route.indexOf('const CARD_POINTERS'), route.indexOf('const items ='));
          return !!block && !/subject|\bbody\b|steps|output_config|attendees|title/.test(block);
        })();
    })()
    && /sent_at: new Date\(\)\.toISOString\(\)/.test(read('app/api/work/threads/[id]/send-coworker-email/route.ts') || '')
    // the workflow draft's pointer IS its confirm-idempotence token, so a confirmed task reads as
    // a receipt on both surfaces instead of offering a second Confirm
    && /token\?: string;/.test(read('components/workflows/workflow-draft-card.tsx') || '')
    && /localStorage\.getItem\(consumedKey\(draft\.token\)\)/.test(read('components/workflows/workflow-draft-card.tsx') || ''));
  gate('T18.22d ONE RENDERING PER KIND — every rehydrated card (chief lane and the Home’s DM twin) mounts through the host that kind already had, never a second card',
    // RE-POINTED (Sep 21): "one rendering" is about the COMPONENT, never the number of mounts. The
    // chief lane now mounts the SAME EmailCard in three lanes (a coworker's draft, a matched item's
    // prepared reply, a standalone one) — which is the law being kept, not broken. What must stay
    // singular is the component, and T18.15/T18.21a hold that.
    !!homeAsk && (homeAsk.match(/<EmailCard\b/g) ?? []).length === 3
    && /<EmailCard coworker=/.test(homeAsk) && /<EmailCard item=/.test(homeAsk) && /<EmailCard standalone=/.test(homeAsk)
    && (homeAsk.match(/<InviteCard\b/g) ?? []).length === 1
    && (homeAsk.match(/<WorkflowDraftCard\b/g) ?? []).length === 1
    // both lanes end in the SAME turn fields the one mount reads
    && /drafts: m\.metadata\.email_drafts\.map\(\(dr\) => \(\{ draft: dr, tid, agentId \}\)\)/.test(homeAsk)
    && /invites: m\.metadata\.invite_cards\.map\(\(iv\) => \(\{ inviteId: iv\.id, invite: iv\.invite \}\)\)/.test(homeAsk)
    && /next\.drafts = \[/.test(homeAsk) && /next\.invites = \[/.test(homeAsk)
    && /next\.workflowDrafts = \[/.test(homeAsk) && /next\.cards = \[/.test(homeAsk)
    && /\(t\.drafts \?\? \[\]\)\.forEach/.test(homeAsk) && /\(t\.invites \?\? \[\]\)\.forEach/.test(homeAsk)
    && /\(t\.workflowDrafts \?\? \[\]\)\.forEach/.test(homeAsk) && /\(t\.cards \?\? \[\]\)\.forEach/.test(homeAsk));
  gate('T18.22e THE DM TWIN READS THE DOOR THAT SERVES METADATA — a card-bearing DM turn is never loaded through a door that strips its cards',
    !!homeAsk && !/\/messages`\)\.then\(\(r\) => \(r\.ok \? r\.json\(\) : null\)\),\n\s*getRoster\(\)/.test(homeAsk)
    && (() => {
      const msgs = read('app/api/work/threads/[id]/messages/route.ts') || '';
      const chat = read('app/api/work/threads/[id]/chat/route.ts') || '';
      // the /messages door does NOT select message metadata; the /chat door does — this is why
      // the DM twin reads /chat (the coworker page's own door)
      return /select\('id, role, content, created_at'\)/.test(msgs)
        && /select\('id, role, content, created_at, metadata'\)/.test(chat);
    })());
  gate('T18.21 THE PREPARED OUTCOME LEDGER IS FED — the card sends `aiDraft`, so the edit delta and the outcome log the donor stage left dead are live again',
    !!host && /aiDraft: variantBodies\[EMAIL_BASE_VARIANT\]/.test(host)
    && !!read('app/api/inbox/[id]/send-reply/route.ts')
    && /logPreparedOutcome/.test(read('app/api/inbox/[id]/send-reply/route.ts') || ''));
}

// ── T19 · THE SENTENCE AND THE SURFACE AGREE (owner walk, Sep 8) ────────────────────────────────
// The live failure: the composed lead said "Four things are overdue. Everything else is on pace."
// and the five whispers showed NONE of the four — every fire sat behind "Everything else · 30 →".
// T8's gates are source-level; these run the REAL module on fixture pools, because this class is
// behavioural: it is about what the pick SEATS versus what the sentence COUNTS.
console.log('\nT19 · A NAMED FIRE IS A SEATED FIRE — the pick and the sort (the sentence retired Sep 13)');
{
  const mk = (over: Partial<DoItem> & { key: string }): DoItem => ({
    source: 'reply', entityId: over.key, href: `/item/${over.key}`, ask: `Ask ${over.key}`, ...over,
  } as DoItem);

  // THE POOL THAT BROKE IT: the served deck leads with calm people-facing work, and the fires —
  // an approval ask, two automated payment notices and a client reply — sit LATER in the order.
  // Under the old band-first pick, none of the four could reach a seat: five calm rows came first
  // and the single chore seat was spent.
  const pool: DoItem[] = [
    mk({ key: 'calm1' }), mk({ key: 'calm2' }), mk({ key: 'calm3' }),
    mk({ key: 'calm4' }), mk({ key: 'calm5' }), mk({ key: 'calm6' }),
    mk({ key: 'fire-approve', overdue: true, dueDate: '2026-09-01', ask: 'Approve the shortlist' }),
    mk({ key: 'fire-pay1', source: 'notice', overdue: true, dueDate: '2026-09-02', ask: 'Payment method expired' }),
    mk({ key: 'fire-pay2', source: 'notice', overdue: true, dueDate: '2026-09-02', ask: 'Second payment method expired' }),
    mk({ key: 'fire-client', overdue: true, dueDate: '2026-09-03', ask: 'A client is waiting on you' }),
  ];
  const seated = pickWhispers(pool, CALM_MAX_WHISPERS);
  const door = pool.filter((i) => !seated.some((s) => s.key === i.key));

  gate('T19.1 every fire in the pool takes a SEAT (the four the fold used to hide)',
    ['fire-approve', 'fire-pay1', 'fire-pay2', 'fire-client'].every((k) => seated.some((s) => s.key === k)),
    `seated: ${seated.map((s) => s.key).join(', ')}`);
  gate('T19.1a the chore cap YIELDS to a fire — both overdue notices seat, and the fold still holds 5',
    seated.length === CALM_MAX_WHISPERS
    && seated.filter((s) => s.source === 'notice').length === 2
    // …and NOTHING is lost: the calm remainder is exactly what the door holds
    && door.length === pool.length - CALM_MAX_WHISPERS
    && door.every((d) => !d.overdue));
  gate('T19.1b below the fire line the Sep 7 band law survives (a CALM chore never outranks a person)',
    (() => {
      const calmPool: DoItem[] = [
        mk({ key: 'chore-a', source: 'notice' }), mk({ key: 'chore-b', source: 'notice' }),
        mk({ key: 'person-a' }), mk({ key: 'person-b' }),
      ];
      const s = pickWhispers(calmPool, CALM_MAX_WHISPERS);
      return s.filter((x) => x.source === 'notice').length === 1
        && s.indexOf(s.find((x) => x.source === 'notice')!) === s.length - 1;
    })());

  // T19.2 / T19.2a / T19.2b / T19.3 / T19.3a RETIRED Sep 13 (OWNER CALL: "in home, this feels too
  // much, remove"). Every one of them gated the SENTENCE's agreement with the fold — the count it
  // spoke, the fires it named, the door clause it owed when it counted more than it could seat.
  // With no sentence there is no second speaker to keep honest, and the disagreement class those
  // gates existed to catch (Sep 8: "Four things are overdue" over five calm whispers) is now
  // structurally impossible: the fold is the only thing that speaks about fires at all.
  // The SEATING law — the half that survives, and the half that actually fixed the walk — stays
  // gated on data above (T19.1/T19.1a/T19.1b) and below (T19.4*, the door's order).
  gate('T19.3b past the fold’s capacity the door takes the overflow fires FIRST (nothing is stranded)',
    (() => {
      const many: DoItem[] = Array.from({ length: 7 }, (_, i) =>
        mk({ key: `f${i}`, overdue: true, dueDate: '2026-09-01', ask: `Fire ${i}` }));
      const s = pickWhispers(many, CALM_MAX_WHISPERS);
      const rest = many.filter((m) => !s.some((x) => x.key === m.key));
      const sortedRest = sortDoorRows(rest, (r) => r, new Date('2026-09-08T12:00:00'));
      return s.length === 5 && rest.length === 2 && sortedRest.every((r) => r.overdue);
    })());

  // THE DOOR'S ORDER — stated, deterministic, and the same for everyone.
  gate('T19.4 the door’s remainder is SORTED: fires · asks · due today · dated ahead · served order',
    (() => {
      const today = new Date('2026-09-08T12:00:00');
      const rest: DoItem[] = [
        mk({ key: 'undated' }),
        mk({ key: 'ahead-late', dueDate: '2026-09-30' }),
        mk({ key: 'today', dueDate: '2026-09-08' }),
        mk({ key: 'ask', stateWord: 'needs one thing from you' }),
        mk({ key: 'ahead-soon', dueDate: '2026-09-10' }),
        mk({ key: 'fire', overdue: true, dueDate: '2026-08-01' }),
      ];
      const sorted = sortDoorRows(rest, (r) => r, today).map((r) => r.key);
      return sorted.join(',') === 'fire,ask,today,ahead-soon,ahead-late,undated';
    })());
  gate('T19.4a the sort is STABLE — equal rows keep the deck’s own judged order',
    (() => {
      const rows: DoItem[] = ['a', 'b', 'c', 'd'].map((k) => mk({ key: k }));
      return sortDoorRows(rows, (r) => r, new Date('2026-09-08T12:00:00')).map((r) => r.key).join(',') === 'a,b,c,d';
    })());
  gate('T19.4b the ask rank reads THE MACHINE’S OWN WORD, never a keyword on a title',
    (() => {
      const seg = (read('lib/home/calm.ts') || '');
      const i = seg.indexOf("const ASK_STATE_WORDS");
      const body = seg.slice(i, seg.indexOf('export function sortDoorRows'));
      return /'needs one thing from you'/.test(body) && /'decision laid out'/.test(body)
        && !/\.ask|\.second|\.primary|toLowerCase/.test(body)
        // the words are THE MACHINE's, spelled the same in its one table
        && /'needs one thing from you'/.test(read('lib/work/machine.ts') || '')
        && /'decision laid out'/.test(read('lib/work/machine.ts') || '');
    })());
}

// ── T20 · THE DEED MOVES THE BRIEF + THE LIVE ROOM + THE SPARSE THREAD ──────────────────────────
// The owner walked a real project room, Sep 8. Three finds, three laws.
//   (a) THE DEED MOVES THE BRIEF — he sent the email and the invite through the thread's cards and
//       the pinned brief kept saying "you haven't sent the link yet". The sig was never the bug (the
//       board digest does move); WHEN was: the only recompose seam was after() on the NEXT room GET,
//       so the first open after a send still served pre-send words. The action seam re-authors the
//       opening on the deed, and the deed lands as one appended event line.
//   (b) THE LIVE ROOM — a room open while its world moves watches it, through THE ONE polling
//       primitive, at background arrival reason (prose frozen, appends allowed), plus a same-client
//       echo so the reader's own send lands at once.
//   (c) THE SPARSE THREAD IS NOT A BROKEN ONE — a pinned brief + one turn + 600px of void read as a
//       page that failed to load. One rule (min-h-full + justify-end), both lengths.
//   (d) SPEECH IS COMPOSED, INCLUDING SPEECH ALREADY WRITTEN — a months-old ask still spoke the
//       retired canned template under a composed brief. The serving door re-speaks it.
console.log('\nT20 · THE DEED MOVES THE BRIEF — the room never claims a deed undone');
{
  const onAction = read('lib/entities/on-action.ts');
  const brief = read('lib/room/brief.ts');
  const grounding = read('lib/room/grounding.ts');
  const echo = read('lib/room/deed-echo.ts');
  const room = read('components/entities/entity-room.tsx');
  const rail = read('components/home/item-rail.tsx');
  const shell = read('components/thread/thread-shell.tsx');
  const legacy = read('lib/room/legacy-ask-speech.ts');
  const turnsRoute = read('app/api/room/turns/route.ts');
  const sendReply = read('app/api/inbox/[id]/send-reply/route.ts');
  const execute = read('app/api/items/execute/route.ts');
  const sendEmail = read('app/api/work/threads/[id]/send-email/route.ts');

  // (a) THE DEED MOVES THE BRIEF
  gate('T20.1 ONE SEAM: the action the brain hears re-authors the room’s opening (never a per-door cache bust)',
    !!onAction && /ensureRoomBrief\(supabase, userId, entityId\)/.test(onAction)
    && /invalidateRoomBriefSig\(supabase, userId, roomKey\)/.test(onAction));
  gate('T20.2 the LOOSE room’s next open cannot skip the recompose — the sig is voided, the last-good TEXT is not (a room never blanks)',
    !!brief && /export async function invalidateRoomBriefSig\(/.test(brief)
    && /sig: `deed:\$\{Date\.now\(\)\}`/.test(brief)
    && /\.\.\.t, sig:/.test(brief));
  gate('T20.3 THE DEED SPEAKS — the send appends one muted event line, keyed so a client echo can never double it',
    !!onAction && /opts\?: \{ said\?: string \| null \}/.test(onAction)
    && /dedupeKey: `sent:\$\{item\.id\}`/.test(onAction)
    && /role: 'system'/.test(onAction)
    // THE ONE-NARRATOR LAW: a deed record carries NO author (it is the chief of staff's voice)
    && !/author: \{/.test(onAction));
  gate('T20.3b NARRATED ONCE, SERVER-SIDE — the one client lane that used to push its own "Sent —" turn now only echoes',
    !!read('components/home/item-detail.tsx')
    && !/pushDealTurn\(entId, `Sent — /.test(read('components/home/item-detail.tsx') || ''));
  gate('T20.4 EVERY SEND REACHES THE SEAM — reply · invite · forward · the coworker-thread email',
    !!sendReply && /noteItemAction\(supabase, user\.id, \{ kind: 'inbox_item', id \},\s*\n?\s*\{ said:/.test(sendReply)
    && !!execute && (execute.match(/noteItemAction\(supabase, uid, \{ kind: 'inbox_item', id: eid \}/g) ?? []).length === 2
    && !!sendEmail && /noteItemAction\(adminClient, uid, \{ kind: 'inbox_item', id: li\.id \}/.test(sendEmail));
  // ⟲ RE-POINTED (stabilization W2.1, Sep 22): the sent check moved INTO THE ONE READER
  // (lib/prepare/read.ts preparedFromSourceData — all four source_data lanes read `sent_at`), and the
  // grounding's board consumes the reader (`preparedStatesFor`) instead of reading source_data itself.
  // The law is the same: the digest moves on the DEED, never on a status filter.
  gate('T20.5 THE SIG READS TRUTH, NOT A STATUS FILTER — a sent reply draft stops counting as prepared, like the invite and the forward always did',
    !!grounding && /preparedStatesFor\(client, userId/.test(grounding) && !/draft\?\.body/.test(grounding)
    && /sd\?\.draft\?\.body && !sd\.draft\.sent_at/.test(read('lib/prepare/read.ts') ?? '')
    && !!sendReply && /draft: \{ \.\.\.sentDraft, sent_at: new Date\(\)\.toISOString\(\) \}/.test(sendReply));
  gate('T20.6 the send door that stamps `execution_status` (not `status`) still moves the brief — it used to move nothing at all',
    !!sendEmail && /execution_status: 'completed'/.test(sendEmail) && /noteItemAction/.test(sendEmail));

  // (b) THE LIVE ROOM
  gate('T20.7 ONE POLLING PRIMITIVE — the room and its thread both beat through use-live-refresh, never a hand-rolled interval',
    !!room && /useLiveRefresh\(roomLive,/.test(room)
    && !!rail && /useLiveRefresh\(turns\.length > 0 \|\| !!respMove,/.test(rail)
    && !/setInterval\(/.test(room) && !/setInterval\(/.test(rail));
  gate('T20.7b NO BEAT WITHOUT LIVE WORK — a settled/empty room polls nothing, and the beat settles by itself',
    !!room && /const roomLive = !!\(rail\?\.move/.test(room)
    && /\{ everyMs: 20_000, maxTicks: 45 \}/.test(room)
    && !!rail && /\{ everyMs: 20_000, maxTicks: 45 \}/.test(rail));
  gate('T20.8 A POLL IS A BACKGROUND ARRIVAL — the beat consults the ONE mechanism and always writes the cache (the next open’s paint)',
    !!room && /mayReplaceInPlace\('background', paintedDetail\)/.test(room)
    && /mayReplaceInPlace\('background', paintedRail\)/.test(room)
    && (room.match(/saveLS\(roomDetailKey\(entityId\), data\)/g) ?? []).length >= 3); /* key producer, not a literal — re-pointed Sep 13 */
  gate('T20.9 THE SAME-CLIENT ECHO is ONE named fact, payload-free, and never a second source of truth',
    !!echo && /export const DEED_EVENT = 'aug:deed';/.test(echo)
    && /export function announceDeed\(\): void/.test(echo)
    && !/detail:/.test(echo));
  gate('T20.9b every send surface echoes it — invite (which fired NOTHING before), email, forward, the chat-approved commit',
    ['components/home/invite-card.tsx', 'components/home/email-card.tsx',
     'components/home/item-detail.tsx', 'components/home/item-rail.tsx']
      .every((f) => /announceDeed\(\)/.test(read(f) ?? '')));
  gate('T20.9c the reader’s OWN deed replaces in place (reason `user`), while the poll stays frozen — the law’s own exception, not a loophole',
    !!room && /window\.addEventListener\(DEED_EVENT, onPrepared\)/.test(room)
    && /window\.removeEventListener\(DEED_EVENT, onPrepared\)/.test(room)
    && !!rail && /window\.addEventListener\(DEED_EVENT, onDeed\)/.test(rail)
    // ⟲ RE-POINTED (W3.7 ROOM SPEED): the turns fetch also waits for the view-resolved room key
    // (`pending` in its deps — turns keyed ONCE); the deed nonce still re-runs it.
    && /\}, \[roomKey, turnsNonce(, pending)?\]\);/.test(rail));

  // (c) THE SPARSE THREAD
  gate('T20.10 a short thread rests on the composer instead of leaving a void — ONE rule, no length branch',
    !!shell && /min-h-full w-full max-w-\[760px\] flex-col justify-end/.test(shell)
    // the timeline stack is the ONLY thing anchored; the composer keeps its own seat and air
    && /className="mx-auto w-full max-w-\[760px\] pb-\[22px\] pt-3"/.test(shell));
  gate('T20.10b the anchoring is the KIT’s, so all four thread kinds inherit it (never a per-host copy)',
    !!shell && !/kind === 'project'/.test(shell) && !/kind === 'item' \?/.test(shell)
    // the COLUMN-anchoring form (a full-height flex column resting on its bottom) exists only in
    // the kit; an unrelated `justify-end` on a button row is not a second copy of this law
    && !/min-h-full[^"]*justify-end|justify-end[^"]*min-h-full/.test(rail ?? '')
    && !/min-h-full[^"]*justify-end|justify-end[^"]*min-h-full/.test(room ?? '')
    && (shell.match(/min-h-full w-full max-w-\[760px\] flex-col justify-end/g) ?? []).length === 1);

  // (d) SPEECH IS COMPOSED, INCLUDING SPEECH ALREADY WRITTEN
  gate('T20.11 THE LEGACY ASK DETECTOR exists, and it is a MATCHER — it exports no text a writer could use',
    !!legacy && /export function isLegacyAskSpeech\(/.test(legacy)
    && /new RegExp\(LEGACY_TAIL, 'i'\)/.test(legacy)
    && !/export const LEGACY_(TAIL|ASK)/.test(legacy));
  gate('T20.11b the old words exist NOWHERE as a literal — not even in the detector (T13.1 stands unweakened)',
    !!legacy && !/attach below or tell me where to look/i.test(legacy)
    && !sourceFiles('lib').concat(sourceFiles('app'), sourceFiles('components'))
      .some((f) => /attach below or tell me where to look|I couldn't find anywhere/i.test(read(f) ?? '')));
  gate('T20.12 the ONE turn-serving door re-speaks what it finds, in after() — never blocking the paint',
    !!turnsRoute && /recomposeLegacyAsks\(supabase, user\.id, turns\)/.test(turnsRoute)
    && /after\(async \(\) => \{\s*\n\s*const \{ recomposeLegacyAsks \}/.test(turnsRoute));
  gate('T20.13 the repair rides the ONE composer with the ask’s OWN judged facts, and the labels are never rewritten',
    !!legacy && /composeAskSpeech\(client, userId, \{/.test(legacy)
    && /labels, itemTitle: itemTitle \|\| 'this work'/.test(legacy)
    // ⟲ RE-POINTED (W2.6 TYPED STORES): the ask's own judged facts are read through the typed door
    // (readPlans(…, 'judgment', …)) instead of a raw `.eq('kind', 'judgment')` — same record, same law.
    && /readPlans\(client, userId, 'judgment', \{ keys:/.test(legacy));
  gate('T20.13b BOUNDED AND SAFE — a capped repair, and the old words are never written back',
    !!legacy && /const REPAIR_CAP = 2;/.test(legacy) && /\.slice\(0, REPAIR_CAP\)/.test(legacy)
    && /if \(!say\?\.trim\(\) \|\| isLegacyAskSpeech\(say\)\) continue;/.test(legacy));
}

// ── T21 · THE HOME PAINTS FIRST (owner walk, Sep 8 — "Home loads very slowly") ──────────────────
// A SELF-HEAL IS NOT A READ · THE PAINT WAITS ON ONE ANSWER · ONE FACT, ONE FETCH · THE SKELETON
// STANDS IN THE PAGE'S OWN SHAPE. Each is a class, so each gets a gate — a law is only alive while
// a gate enforces it.
console.log('\nT21 · THE HOME PAINTS FIRST — the read path carries only the read');
{
  const route = read('app/api/home/brief/route.ts');
  const home = read('components/home/home-view.tsx');
  const seat = read('hooks/use-cos-seat.ts');

  gate('T21.1 A SELF-HEAL IS NOT A READ — the replied-items reconcile runs in after(), never awaited',
    !!route && /after\(async \(\) => \{\s*\n\s*try \{ await reconcileRepliedItems\(/.test(route)
    && !/^\s*await reconcileRepliedItems\(/m.test(route));
  gate('T21.1a the heal stamps ITSELF, after it ran (a crashed heal retries, never marks itself done)',
    !!route && (() => {
      const i = route.indexOf('await reconcileRepliedItems(');
      const seg = route.slice(i, i + 260);
      return /mergeAux\(\{ reconciledAt: new Date\(\)\.toISOString\(\) \}\)/.test(seg);
    })());
  gate('T21.2 NO AI ON THE READ PATH — every reasoned pass on the brief route sits inside after()',
    !!route && (() => {
      // the four composed passes the route owns; each must be reachable only from an after()
      for (const call of ['synthesizeBrief(', 'nameBundles(', 'composeBriefing(', 'runAnticipationPass(']) {
        const i = route.indexOf(call);
        if (i < 0) continue;
        if (!/after\(/.test(route.slice(Math.max(0, i - 2600), i))) return false;
      }
      return true;
    })());
  gate('T21.3 THE PAINT WAITS ON ONE ANSWER — the ambient team lane no longer rides the brief’s flight',
    !!home && !/Promise\.all\(\[\s*\n?\s*fetch\('\/api\/home\/brief'\)/.test(home)
    && /fetch\('\/api\/home\/brief'\)\.then\(r => r\.json\(\)\)\.catch\(\(\) => null\)\.then\(\(b\) => \{/.test(home));
  gate('T21.3a …and the empty state waits for it, so “nothing here” never claims-then-retracts',
    !!home && /const \[teamSettled, setTeamSettled\] = useState\(false\);/.test(home)
    && /const nothing = b &&[^\n]*\(teamSettled \|\| team !== null\)/.test(home));
  gate('T21.4 ONE FACT, ONE FETCH — the CoS seat is read once per page, not once per mount',
    !!seat && /let seatInFlight: Promise<CosSeat \| null> \| null = null;/.test(seat)
    && /if \(!seatInFlight\) \{/.test(seat)
    && (seat.match(/fetch\('\/api\/workers\/cos-seat'\)/g) || []).length === 1);
  gate('T21.5 NO SILENT CAPS — the open-commitments pool is explicitly bounded and says when it saturates',
    // ⟲ RE-POINTED (Sep 22 — W0.5): the bounded read is now ORDERED soonest-due first on its own line,
    // so a saturated pool drops the least time-critical rows, never an arbitrary set.
    // (column-named since event-spine P0 — hot-path-law)
    !!route && /from\('commitments'\)\.select\((?:'\*'|OPEN_COMMITMENT_COLS)\)[^;]*?\.order\('due_date'[^;]*?\.limit\(500\)/.test(route)
    && /open-commitments pool SATURATED/.test(route));
  gate('T21.6 the perf watchdog stands AT THE DOOR (it measures what the reader actually waited for)',
    !!route && (() => {
      const w = route.indexOf('[home/brief] slow');
      // RE-POINTED: the door now serves through the label choke (guardDeckLabels) — same door.
      const r = route.lastIndexOf('return NextResponse.json(guardDeckLabels({ firstName');
      return w > 0 && r > w && (r - w) < 700;
    })());
  // RE-POINTED Sep 18 (THE ENTRANCE, owner walk: "not instant new-page-load style"). This gate's
  // law was "the cold Home stands in the page's own shape, never a retired deck's". It is now met
  // in the strongest possible way: there is no second shape at all. The skeleton tree is deleted;
  // the cold Home IS the page, rendered and VEILED (so the layout is already final and nothing
  // reflows on landing), with the one orb holding the centre until the brief arrives.
  gate('T21.7 THE COLD HOME IS THE PAGE ITSELF (one layout, veiled — never a second tree to swap in)',
    !!home
    && !/if \(loading\) \{\s*\n\s*return \(/.test(home)
    && !/lg:grid-cols-\[minmax\(0,1fr\)_320px\]/.test(home)
    && !/SkeletonCard/.test(home)
    // the ghosts the skeleton painted are gone with it
    && !/\[0, 1, 2, 3, 4\]\.map/.test(home)
    && !/h-\[52px\] rounded-2xl border border-neutral-200\/70 bg-white\/60 animate-pulse/.test(home)
    // the facts the client already holds still paint with the first stagger step; only claims wait
    && /toLocaleDateString\('en-US', \{ weekday: 'long', month: 'long', day: 'numeric' \}\)/.test(home)
    && /\{greeting\(\)\}/.test(home)
    && /entrance\.veil\(0\)/.test(home));
}

// ── T22 · THE GROUND EVIDENCE + ONE AGENDA AT THE RENDER ────────────────────────────────────────
// The owner walked the same project room again, Sep 8 evening: the pinned brief STILL demanded a
// deed already done, beside a second CTA-bearing ask bubble. Verbatim: "its confusing having 2
// deliveries from clara, multiple CTAs. it should reason the latest emails and calendar. a normal
// person would see the email sent, check the calendar and think, ok invite was sent already."
//   (a) THE GROUND EVIDENCE REACHES THE MIND — the morning's deed seam only moves the brief when
//       OUR doors fire; a reply sent from the user's own mailbox and a meeting booked in their own
//       calendar stamp nothing we own. The grounding now carries the world's own record — who spoke
//       last on each thread (the user's sent mail INCLUDED) and what sits on the calendar with this
//       room's people — boundary-marked, and DIGESTED INTO THE SIG so its arrival alone recomposes.
//       Generic facts, model-drawn conclusion: no invite/keyword branch anywhere in code.
//   (b) ONE AGENDA PER ROOM, AT THE RENDER — while a composed brief stands pinned, the engine's
//       live ask folds INTO that card (same block, same handlers) instead of standing as a second
//       delivery with a second CTA row.
console.log('\nT22 · THE GROUND EVIDENCE + ONE AGENDA AT THE RENDER — the room checks the world, and states one thing');
{
  const ge = read('lib/room/ground-evidence.ts');
  const grounding = read('lib/room/grounding.ts');
  const brief = read('lib/room/brief.ts');
  const now = read('lib/inbox/thread-now.ts');
  const state = read('lib/entities/state.ts');
  const rail = read('components/home/item-rail.tsx');
  // W3-A (Sep 22): the seats these laws moved to — the two hosts and the kit itself.
  const askHost = read('components/home/input-card.tsx');
  const kit = read('components/thread/thread-cards.tsx');

  // (a) THE GROUND EVIDENCE
  gate('T22.1 THE EVIDENCE EXISTS AS FACTS — one module gathers what a person would check (thread + calendar)',
    !!ge && /export async function assembleGroundEvidence\(/.test(ge)
    && /from\('calendar_events'\)/.test(ge)
    && /latestByThread/.test(ge));
  gate('T22.2 IT IS BOUNDARY-MARKED — the composer is told where the world’s record starts and stops',
    !!ge && /export const GROUND_EVIDENCE_HEADER =/.test(ge)
    && /export const GROUND_EVIDENCE_END =/.test(ge)
    && /export function renderGroundEvidence\(/.test(ge)
    // no header without facts — an empty section pretending to be evidence is a lie
    && /if \(!lines\.length\) return null;/.test(ge));
  gate('T22.3 THE USER’S OWN SENT MAIL IS EVIDENCE (the deed done outside our doors leaves no stamp — this is how it is seen)',
    !!now && /fromUser: !!m\.is_from_user/.test(now)
    && !!ge && /n\.fromUser/.test(ge)
    && /THE USER themself sent the last message/.test(ge));
  gate('T22.4 ONE WATERMARK READ, NOT TWO — the entity ledger and the room share it (a fork of this fact is the bug class itself)',
    !!now && /export async function latestByThread\(/.test(now)
    && !!state && /latestByThread\(supabase, userId,/.test(state)
    // the inline copy is gone from the ledger
    && !/nowByThread\.set\(t, \{/.test(state));
  gate('T22.5 IT REACHES THE ONE GROUNDING — every reasoned call in room scope inherits it at once',
    !!grounding && /groundEvidence: string\[\];/.test(grounding)
    && /assembleGroundEvidence\(client, userId, \{/.test(grounding)
    && /renderGroundEvidence\(groundEvidence\)/.test(grounding)
    && /return \{ roomKey, entity, board, asks, groundEvidence,/.test(grounding));
  gate('T22.5a …and it survives the composer’s clip — the world’s record sits with the board it contradicts, never in the tail',
    !!grounding && (() => {
      const gi = grounding.indexOf('renderGroundEvidence(groundEvidence)');
      const hi = grounding.indexOf('HISTORY (newest first');
      return gi > 0 && hi > gi;
    })());
  gate('T22.6 THE SIG CARRIES IT — a sent message or a booked meeting recomposes the opening with no deed seam at all',
    !!brief && /const groundDigest = g\.groundEvidence\.join\('\|'\)\.slice\(0, 400\);/.test(brief)
    && /blockingDigest, groundDigest, lastTurn/.test(brief));
  gate('T22.7 THE GROUND WINS — the law is COMPOSED, one rule to the mind (a settled debt is spoken as done or not at all)',
    !!ge && /export const GROUND_EVIDENCE_RULE =/.test(ge)
    && /THE GROUND WINS: when the page below carries a GROUND EVIDENCE block/.test(ge)
    && /that debt is SETTLED/.test(ge)
    && /NEVER demand it again/.test(ge)
    && /believe the evidence/.test(ge)
    // SELF-GATING: a page with no evidence must cost nothing — the rule opens on a condition.
    && /when the page below carries/.test(ge));
  // ── THE LAW REACHES EVERY MIND THAT READS THE PAGE ──────────────────────────────────────────
  // The evidence rides THE ONE GROUNDING, so it reaches every reasoner in room scope at once. The
  // LAW about it has to travel with it: a Home answer, a coworker's reply or a workflow run that
  // ranked the board above the world would contradict the very brief the evidence settled — the
  // exact contradiction class the one-grounding law was born to kill. ONE constant, N importers;
  // N hand-copies is the site-list decay class that rotted the excerpt law.
  {
    const FRAME_SITES: Array<[string, string]> = [
      ['lib/room/brief.ts', 'the room’s composed opening'],
      ['lib/entities/ask.ts', 'answerEntityQuestion — the room’s Q&A'],
      ['lib/home/ask.ts', 'the Home ask’s FOCUSED WORK block (answerHomeQuestion + converse’s global grounding)'],
      ['lib/converse/index.ts', 'the chief’s agent loop'],
      ['lib/work/worker-grounding.ts', 'a coworker’s focused project page'],
      ['lib/workflows/entity-edge.ts', 'the case + workflow run grounding'],
      ['lib/home/anticipation.ts', 'the meeting-prep brief'],
      ['lib/prepare/invite-from-conversation.ts', 'the invite preparer'],
    ];
    for (const [file, what] of FRAME_SITES) {
      const src = read(file);
      gate(`T22.7b THE LAW TRAVELS WITH THE PAGE — ${what} imports the ONE rule (${file})`,
        !!src && /GROUND_EVIDENCE_RULE/.test(src)
        // Either import form — a file whose whole idiom is dynamic imports (anticipation) obeys
        // the same law through `await import(...)`; the law is the ONE source, not the syntax.
        && /(from|import\()\s*'@\/lib\/room\/ground-evidence'/.test(src));
    }
    // The decay guard: nobody may hand-copy the law's own sentence into a frame site.
    const copies = FRAME_SITES.map(([f]) => read(f))
      .filter((s) => !!s && /THE GROUND WINS: when the page below carries/.test(s!));
    gate('T22.7c ONE COPY ONLY — no frame site restates the law in its own words (the site-list decay class)',
      copies.length === 0);
    // Every consumer of the one grounding is a frame site: adding one means adding it above.
    const consumers = [...sourceFiles('lib'), ...sourceFiles('app')]
      .filter((f) => (read(f) ?? '').includes('assembleRoomGrounding(')
        && !f.endsWith('lib/room/grounding.ts'));
    const listed = new Set(FRAME_SITES.map(([f]) => f));
    const unwired = consumers.filter((f) => !listed.has(f) && !/GROUND_EVIDENCE_RULE/.test(read(f) ?? ''));
    gate('T22.7d THE ENUMERATION IS COMPLETE — every reasoner that assembles the page carries the law',
      unwired.length === 0, unwired.join(', '));
  }
  gate('T22.7a NO DETERMINISTIC SHORTCUT — the evidence is generic facts; not one line of code reasons about invites or links',
    !!ge && !/invite|meeting link|\bschedule\b/i.test(ge.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
    && !!brief && !/prepared_invite/.test(brief));
  // A FLOOR, NOT A PIN: the law is "the version moved WITH the prompt/page change and its log says
  // so" — an exact `= 9` would fail on the next lawful bump and teach us to weaken the gate.
  gate('T22.8 A VERSION BUMP RIDES THE PROMPT CHANGE (the lesson learned three times)',
    !!brief && /export const ROOM_BRIEF_VERSION = (?:9|\d{2,});/.test(brief)
    && /THE GROUND EVIDENCE REACHES THE MIND/.test(brief));
  gate('T22.9 an unreadable world is SILENCE, never a claim — every evidence read fails closed',
    !!ge && (ge.match(/\} catch \{/g) || []).length >= 2
    && !!grounding && /catch \{ return \[\] as string\[\]; \}/.test(grounding));

  // (b) ONE AGENDA PER ROOM, AT THE RENDER
  // ⚠️ RE-POINTED (owner, Sep 14: "not sure you're walking the changes through projects AND single
  // loose task items… all changes should be applied across the board"). The LAW was always
  // door-blind; its CONDITION was not — gating the fold on a COMPOSED brief left every loose room
  // whose pinned seat speaks through the PRE-COMPOSE fallback (the anchor line + a "Next: …" CTA)
  // showing exactly the double this law exists to kill. The test is now whether the pinned seat
  // SPEAKS AT ALL, which is the fact that decides whether a second agenda would exist.
  gate('T22.10 ONE AGENDA, EVERY DOOR: while the pinned seat speaks, the live ask does not stand beside it',
    // RE-POINTED (Sep 18, Q6): the pinned seat gained one more way of speaking — the CoS's OFFER
    // line, which stands where an unstaged move's button used to. The test is unchanged: DOES THE
    // PINNED SEAT SPEAK? An offer speaks, so the ask folds behind it exactly as a CTA made it.
    // RE-POINTED AGAIN (W4-A, Sep 22): the CTA became the `proposal` card, so the fact the test
    // reads is `moveCard` rather than a non-empty action row. The question is identical.
    !!rail && /const pinnedSpeaks = !!\(composed \|\| openingText \|\| moveCard[^)]*\);/.test(rail)
    && /const foldedAsk = pinnedSpeaks && liftedAsk\?\.checklist\?\.length \? liftedAsk : null;/.test(rail)
    && /if \(liftedAsk && !foldedAsk\) \{/.test(rail)
    // …and the fold no longer loses the ask's own sentence where no brief names the gap
    && /\{foldedAsk && !composed && foldedAsk\.text && \(/.test(rail));
  gate('T22.11 …it folds INTO the pinned card (one delivery, one primary CTA)',
    // RE-POINTED (W3-A, Sep 22): the fold mounts the ONE ask host instead of the rail's own block.
    !!rail && /\|\| moveCard \|\| mergedArt \|\| foldedAsk[^)]*\) \? \(/.test(rail)
    && /\{foldedAsk && askCard\(/.test(rail));
  gate('T22.12 THE DEED IS MOVED, NEVER ORPHANED — the same host and the same handlers answer it in its new seat',
    // RE-POINTED (W3-A, Sep 22): "the same block with the same handlers" is now ONE host used at
    // all three seats, so the test is that all three pass through it — a stronger claim than the
    // old one, which could only compare one seat's inline arguments.
    !!rail && /\{foldedAsk && askCard\(\{ \.\.\.foldedAsk, text: '' \}, 'folded-ask'\)\}/.test(rail)
    && (rail.match(/askCard\(\{ \.\.\./g) ?? []).length === 3
    // …and the host is the ONE place the go-ahead law and the proceed door are consulted
    && !!askHost && /askAllowsGoAhead\(spec\.items, spec\.context\)/.test(askHost)
    && /proceedAsk\(turnId\)/.test(askHost));
  gate('T22.13 the ask keeps its OWN voice when no composed position exists (the law is one agenda, not a hidden ask)',
    !!rail && /const liftedAsk = turns\.find\(/.test(rail)
    && /id: 'lifted-ask'/.test(rail));
  gate('T22.14 ONE CTA ROW SURVIVES: the pinned seat is the only actions-bearing item the rail pushes',
    !!rail && (() => {
      // Every `actions:` the timeline builder emits — the pinned brief's is the only one, and the
      // MOVE still yields to a rendered decision through the ONE placement table.
      // RE-POINTED (W4-A, Sep 22 — STRENGTHENED, never weakened): the one CTA row became the one
      // `proposal` CARD, so the rail now pushes NO `actions` on any timeline item at all. "One CTA
      // row survives" is asserted as "exactly one move renderer, and zero action rows".
      const i = rail.indexOf('const items: ThreadItem[] = [];');
      const seg = rail.slice(i);
      return !/^\s*\.\.\.\(.*actions:/m.test(seg)
        && !/type: 'actor_bubble'[\s\S]{0,400}?actions:/.test(seg)
        // ⟲ RE-POINTED (W3.5, Sep 22 — STRENGTHENED again): the pre-compose fallback `proposal`
        // died with the stitched fallback (registry precedence #1), so EXACTLY ONE move renderer
        // remains — the composed move's card.
        && (rail.match(/kind: 'proposal', id: 'move'/g) ?? []).length === 1
        && (rail.match(/<ThreadCardView card=\{moveCard\} \/>/g) ?? []).length === 1
        && /panelPlan\(\{ hasDecision: decisionIsPrimary, moveCardMounted: !!cardForMove \}\)/.test(rail);
    })());
}

// ── T23 · THE ROOM THAT KEPT ASKING (the seven root causes, Sep 8) ──────────────────────────────
// A read-only diagnosis of the owner's real room: he replied from his own mailbox at 13:08 and
// booked the meeting himself at 13:12; by 13:30 THREE subsystems had recorded the settlement
// (resolve-on-reply completed the item, the judge ruled it answered, the already-booked floor said
// so) — and at 17:15 the recomposed brief still wrote "you need to send the meeting link", with its
// CTA bound to an unrelated July notice. Seven causes, each fixed as a CLASS:
//   C7 the ledger clip ate the watermark · C1 the state synthesis demanded a settled deed and froze
//   · C2 the ground evidence was blind to deeds (resolved rows filtered out; the user's own identity
//   matched every meeting; past events crowded out the booking) · C3 fold rules died in the
//   version-bump window · C4 `anticipate:` narrations were outside every retirement rule · C5
//   narrations cut prose mid-word · C6 a move's ref was validated for membership, not aboutness.
console.log('\nT23 · THE ROOM THAT KEPT ASKING — the world is read, the settled stays settled, and a CTA points at its own object');
{
  const now = read('lib/inbox/thread-now.ts');
  const state = read('lib/entities/state.ts');
  const grounding = read('lib/room/grounding.ts');
  const ge = read('lib/room/ground-evidence.ts');
  const rail = read('components/home/item-rail.tsx');
  const av = read('lib/work/apply-verdict.ts');
  const brief = read('lib/room/brief.ts');

  // ── C7 · THE WATERMARK SURVIVES THE CLIP (behavioural — the clipper is pure) ──
  {
    const { clipLedgerLine, NOW_CLAUSE_MARK } = require('../lib/inbox/thread-now') as typeof import('../lib/inbox/thread-now');
    const clause = `${NOW_CLAUSE_MARK}2026-09-08, the user spoke last): "Booked it, invite is out."`;
    const line = `${'A very long subject line about the workflow engagement '.repeat(6)}${clause}`;
    const out = clipLedgerLine(line, 200);
    gate('T23.1 THE WATERMARK SURVIVES THE CLIP — the NOW clause rides intact on a line far over budget',
      out.endsWith(clause) && out.length < line.length, out.slice(-40));
    gate('T23.1b …and the HEAD is what yields, word-boundary, never mid-word',
      /\S…/.test(out.slice(0, out.indexOf(NOW_CLAUSE_MARK))) && !/\s…/.test(out));
    gate('T23.1c a clause-less line still clips at a word boundary (the house clip, never a raw cut)',
      (() => {
        const src = 'alpha beta gamma delta epsilon zeta eta theta';
        const out = clipLedgerLine(src, 20);
        if (!out.endsWith('…')) return false;
        const words = new Set(src.split(' '));
        return out.slice(0, -1).trim().split(' ').every((w) => words.has(w));
      })());
    gate('T23.2 ONE CLIPPER — every ledger consumer routes through it; no raw head-cut of a ledger line survives',
      !!now && /export function clipLedgerLine\(/.test(now) && /export function nowClause\(/.test(now)
      && !!state && state.includes('clipLedgerLine(l.text, 200)') && !/l\.text\.slice\(0, 200\)/.test(state)
      && !!grounding && grounding.includes('clipLedgerLine(l.text, 200)') && !/l\.text\.slice\(0, 200\)/.test(grounding));
    gate('T23.2b the clause has ONE author — the marker and the sentence live beside the read that makes them',
      !!now && /export const NOW_CLAUSE_MARK =/.test(now)
      && !!state && /return nowClause\(n\);/.test(state) && !/— NOW \(\$\{/.test(state));
  }

  // ── C1 · THE SETTLED LINE IS HISTORY ──
  {
    const v = state?.match(/export const STATE_PROMPT_VERSION = (\d+)/)?.[1];
    gate('T23.3 STATE_PROMPT_VERSION rides the prompt change (≥ 9) — every frozen-wrong state re-synthesizes through the existing sig gate',
      !!v && Number(v) >= 9, v ?? 'missing');
    gate('T23.3b THE SETTLED LINE IS HISTORY names the FIELDS a demand can hide in (the old rule said only "owed")',
      !!state && /whoOwes\.you/.test(state) && /"blocking"/.test(state) && /next_move/.test(state)
      && /is HISTORY/.test(state) && /THE USER spoke last/.test(state));
    gate('T23.3c …and an unsettled claim must cite an UNSETTLED line (never a re-worded settled one)',
      !!state && /UNSETTLED line/.test(state));

    // THE CODE HALF — proven necessary on the live room: the strengthened prompt alone still
    // re-issued the settled deed, so the model proposes and a deterministic arbiter disposes.
    const { isSettledLedgerLine, restatesSettledWork } = require('../lib/entities/state') as typeof import('../lib/entities/state');
    const L = (text: string) => ({ at: '2026-09-07', kind: 'email', who: null, text, ref: 'inbox:x' });
    const ledger = [
      L('Send meeting link for Thursday 11h with Zoé and Emma — NOW (2026-09-08, the user spoke last): "sending it now"'),
      L('Meeting accepted: Acme x Us - AI Implementation'),
      L('you owe: Identify repetitive task for automation pilot'),
    ];
    gate('T23.3d THE SETTLEMENT SIGNALS ARE STRUCTURAL — a (handled)/DONE marker AND a user-spoke-last watermark',
      isSettledLedgerLine('Confirm the time (handled)') && isSettledLedgerLine('DONE — delivered/handled: the deck')
      && isSettledLedgerLine(ledger[0].text) && !isSettledLedgerLine(ledger[1].text));
    gate('T23.3e A SETTLED LINE CANNOT FOUND A DEMAND — a claim owned by a settled line is disposed…',
      restatesSettledWork('send meeting link to Zoé for Thursday 11h', ledger, new Set(['project'])));
    gate('T23.3f …and OPEN work is never silenced (the arbiter drops nothing an open line owns as well)',
      !restatesSettledWork('identify one repetitive task for the automation pilot', ledger, new Set(['project']))
      && !restatesSettledWork('meeting', ledger, new Set(['project'])));
    gate('T23.3g the arbiter is WIRED at every demand seat — whoOwes.you, blocking, the next move, and the prose',
      !!state && /whoOwes: \{ you: owedYou/.test(state)
      && /blockingRaw && !settledDemand\(blockingRaw\)/.test(state)
      && /&& !settledDemand\(String\(nm\.title\)\)\)/.test(state)
      && /const badClause = settledClause\(String\(p\.summary \?\? ''\)\);/.test(state));
    gate('T23.3h the prose never blanks and never keeps the lie — one corrective retry, then the clause is REMOVED',
      !!state && /if \(retry\.json\?\.summary && !settledClause\(String\(retry\.json\.summary\)\)\) p = retry\.json;/.test(state)
      && /const kept = String\(p\.summary\)\.split\(CLAUSES\)\.filter\(\(c\) => !settledDemand\(c\)\);/.test(state)
      && /if \(kept\.length\) \{/.test(state));
  }

  // ── C2 · THE EVIDENCE SEES DEEDS ──
  gate('T23.4 A DEED RESOLVES ITS ITEM — the evidence reads the room’s mail regardless of status (the board still holds only live work)',
    !!grounding
    && !/select\('id, work_title, status, source_data'\)[^\n]*\.eq\('status', 'pending'\)/.test(grounding)
    && /\.order\('last_activity_at', \{ ascending: false, nullsFirst: false \}\)/.test(grounding)
    && /if \(String\(it\.status \?\? 'pending'\) !== 'pending'\) continue;/.test(grounding));
  gate('T23.4b …and the evidence still gets the thread + the people BEFORE that filter (a settled thread is the proof)',
    !!grounding && (() => {
      const i = grounding.indexOf('threadRefs.push({');
      const j = grounding.indexOf("!== 'pending') continue;");
      return i > 0 && j > i;
    })());
  gate('T23.5 THE PERSON-BRIDGE LAW IN ITS CALENDAR FORM — the user’s own identity is never a match key',
    !!ge && /THE PERSON-BRIDGE LAW/.test(ge)
    && /const self = new Set<string>\(\);/.test(ge)
    && /userAddresses/.test(ge)
    && /!self\.has\(f\)/.test(ge));
  gate('T23.6 FUTURE FIRST — what is BOOKED outranks what already happened, so the line budget can never drop the upcoming entry',
    !!ge && /FUTURE FIRST/.test(ge) && /const isFuture =/.test(ge)
    && /\.\.\.rows\.filter\(isFuture\),/.test(ge));
  gate('T23.6b the evidence stays generic facts — still not one branch about invites or links',
    !!ge && !/invite|meeting link/i.test(ge.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));

  // ── C3 · NARRATION HAS ITS OWN CLOCK ──
  gate('T23.7 THE FOLD SURVIVES THE VERSION-BUMP WINDOW — with no brief, narration expires on its own age',
    !!rail && /NARRATION_GRACE_MS/.test(rail)
    && /\(foldBriefAt \? t\.at < foldBriefAt : narrationAged\(t\.at, NARRATION_GRACE_MS\)\)/.test(rail)
    && !/const isExpiredNarration = \(t: Turn\) => !!foldBriefAt/.test(rail));

  // ── C4 · AN ANTICIPATION IS A PREP NARRATION ──
  gate('T23.8 `anticipate:` joins the prep class at BOTH seams (the fold and the render)',
    !!rail && (rail.match(/\^\(prep:\|meeting-prep:\|anticipate:\)/g) || []).length >= 2);
  gate('T23.8b …and an anticipation that outlived its own horizon folds regardless of any card',
    !!rail && /const isAgedAnticipation =/.test(rail) && /ANTICIPATION_LIFE_MS/.test(rail)
    && /!isAgedAnticipation\(t\)/.test(rail));

  // ── C5 · THE EVENT LINE CARRIES THE OUTCOME ──
  gate('T23.9 NO RAW CUT ON PROSE — the verdict’s reason never reaches a narration through .slice()',
    !!av && !/verdict\.reason\.slice\(/.test(av) && !/revisit\.reason\.slice\(/.test(av)
    && !/title\.slice\(/.test(av) && /import \{ clip \} from '@\/lib\/room\/turns';/.test(av));
  gate('T23.9b ONE LINE, ONE OUTCOME — the stream states the deed under a cap; the argument lives in Activity',
    // RE-POINTED (proactive-reach W4, census fix #4): the per-item `clip(expired ? … : …)` became
    // `composeResolutionLine` — ONE composer for the singular line AND the coalesced count, still
    // clipped to the same cap, with the argument still living only on the activity record. The law
    // is unchanged; its seat moved.
    !!av && /const NARRATION_MAX = 140;/.test(av)
    && /export function composeResolutionLine/.test(av)
    && /text: composeResolutionLine\(entries\)/.test(av)
    && new RegExp(String.raw`return clip\(e\.expired`).test(av)
    && /clip\(`\$\{body\} — undo from Activity\.`, NARRATION_MAX\)/.test(av)
    && /reason: clip\(verdict\.reason, 300\)/.test(av)
    && !/I marked it done; undo from Activity/.test(av));

  // ── C6 · MEMBERSHIP IS NOT ABOUTNESS ──
  gate('T23.10 THE MOVE POINTS AT ITS OWN OBJECT — board membership alone no longer earns the link',
    !!brief && /MEMBERSHIP IS NOT ABOUTNESS/.test(brief)
    && /namesOverlap\(label, about\)/.test(brief)
    && !/boardRefs\.has\(String\(mv\.target\)\)/.test(brief));
  gate('T23.10b …reusing the house distinctive-token primitive, never a fork, and degrading to UNLINKED',
    !!brief && /const \{ GENERIC_WORK_WORDS, namesOverlap \} = await import\('@\/lib\/entities\/recognize'\);/.test(brief)
    && /return \{ label, ref: null \};/.test(brief));
}

// ── T24 · THE CARD GROWS UP — the editor, the working state, and no dead controls ───────────────
// The owner walked the email card, Sep 9. Four findings, four laws:
//   (a) "tabs not clickable" — the body reported itself EDITED on a click (the donor textarea fired
//       its edit callback from onBlur), and the host answered an edit by withholding every handler.
//       Two bugs in one screen: a dirty flag that read events instead of content, and a design in
//       which editing produced inert chrome. Both die here.
//   (b) "cc/bcc, also more format options? the basic ones. and also attach?" — the card became the
//       place the mail is actually written, so it carries the composer's real machinery, MOUNTED
//       (the inbox's own contentEditable + FormatToolbar), never forked — and only where its door
//       can carry the field.
//   (c) "always show a smooth animation state so the user knows something is happening" — every
//       regenerating click puts the card in its working state in the same frame.
//   (d) the invite card inherits the grammar: same working state, no control that lies either way.
console.log('\nT24 · THE CARD EDITOR — content-truth, live controls, one composer, one motion idiom');
{
  const cards = read('components/thread/thread-cards.tsx');
  const types = read('components/thread/types.ts');
  const mapper = read('lib/prepare/email-card.ts');
  const host = read('components/home/email-card.tsx');
  const invite = read('components/home/invite-card.tsx');
  const people = read('components/home/people-chips.tsx');
  const sendReply = read('app/api/inbox/[id]/send-reply/route.ts');
  const coworkerSend = read('app/api/work/threads/[id]/send-coworker-email/route.ts');
  const emailView = (cards ?? '').slice((cards ?? '').indexOf('function EmailCardView'));

  // ── (a) THE DIRTY TEST IS THE CONTENT, NEVER THE EVENT ──
  gate('T24.1 an edit is a CHANGE — the flag is decided by comparing the words, in one pure place',
    !!mapper && /export function sameBody\(/.test(mapper)
    && !!host && /if \(sameBody\(value, servedRef\.current\)\) return;/.test(host)
    // and the comparison lives exactly once
    && (() => {
      const defs = sourceFiles('components').concat(sourceFiles('lib'))
        .filter((f) => /export function sameBody\(/.test(read(f) || ''));
      return defs.length === 1 && defs[0] === 'lib/prepare/email-card.ts';
    })());
  gate('T24.1b THE ROOT CAUSE IS GONE — no body editor reports an edit from focus or blur',
    !!emailView && !/onBlur=\{\(\) => \{ card\.onEditBody/.test(emailView)
    && /onChange=\{\(e\) => card\.onEditBody!\(e\.target\.value\)\}/.test(emailView)
    && /onInput=\{\(html\) => card\.onEditBody!\(html\)\}/.test(emailView));

  // ── (a2) NO DEAD CONTROLS ──
  gate('T24.2 the tab handler is UNCONDITIONAL on a live card — editing adds a tab, it never removes the row',
    !!host && /onPickVariant: pickVariant,/.test(host)
    && !/\(dirty \? \{\} : \{ onPickVariant/.test(host)
    // …and the tone menu / steer field survive an edit too
    // RE-POINTED (Sep 21): the predicate is now named — `itemLane` (an item, and neither of the
    // two card-owned lanes). Same condition, same law: these survive an edit.
    && /\.\.\.\(itemLane \? \{ onSteer/.test(host) && /\.\.\.\(itemLane \? \{ toneOptions/.test(host)
    && !/item && !dirty/.test(host));
  gate('T24.2b …and nothing anywhere drops the user’s version once it exists (no silent reset)',
    !!host && !/setUserEdit\(null\)/.test(host));
  gate('T24.3 A CONTROL IS LIVE OR ABSENT — the kit still renders plain text where a handler is missing',
    !!emailView && /if \(!card\.onPickVariant\) return <span key=\{v\.id\} className=\{cls\}>/.test(emailView)
    && !!cards && /if \(!onPick\) return <div className=\{cls\}>\{body\}<\/div>;/.test(cards));

  // ── (b) THE EDITOR IS MOUNTED, NEVER FORKED ──
  gate('T24.4 ONE RICH COMPOSER — the card mounts the inbox’s own ReplyEditor/FormatToolbar, and forks none',
    !!cards && /import ReplyEditor from '@\/components\/inbox\/reply-editor';/.test(cards)
    && /<ReplyEditor/.test(cards)
    && !/execCommand/.test(cards) && !/queryCommandState/.test(cards)
    && (() => {
      const forks = sourceFiles('components/thread')
        .filter((f) => /execCommand|function FormatToolbar|from '\.\/format-toolbar'/.test(read(f) || ''));
      return forks.length === 0;
    })());
  gate('T24.5 ONE BODY SERIALIZATION — a card send and a stage send of the same words produce the same HTML',
    !!mapper && /export function emailBodyHTML\(/.test(mapper)
    && !!host && /customMessage: emailBodyHTML\(text\)/.test(host)
    // the host's own local converter is gone; markup authored in the editor passes through untouched
    && !/function draftHTML\(/.test(host)
    // ⟲ RE-POINTED (Sep 22 — stabilization W0.1 RENDER SAFETY): editor markup still passes through as
    // markup, but through the ONE draft sanitizer (no handlers, no remote fetch) — same words, same HTML.
    && /if \(BLOCK_MARKUP\.test\(v\)\) return sanitizeDraftHtml\(v\);/.test(mapper)
    && (() => {
      const defs = sourceFiles('components').concat(sourceFiles('lib'))
        .filter((f) => /export function emailBodyHTML\(/.test(read(f) || ''));
      return defs.length === 1 && defs[0] === 'lib/prepare/email-card.ts';
    })());
  gate('T24.5b the editor is re-seeded when the MACHINE speaks and never under the user’s caret',
    !!host && /setBodyRev\(\(n\) => n \+ 1\)/.test(host)
    && !!emailView && /key=\{card\.bodyRev \?\? 'v0'\}/.test(emailView)
    // typing does not bump the revision (the bump lives only where the host serves content)
    && /const serve = \(id: string, text: string\) => \{/.test(host!)
    && !/setBody\(value\);[\s\S]{0,80}setBodyRev/.test(host!));

  // ── (b2) A FIELD ONLY WHERE ITS DOOR CARRIES IT ──
  gate('T24.6 Cc/Bcc are the Gmail idiom — collapsed beside To, opening the SAME people editor',
    !!emailView && /card\.onOpenCc/.test(emailView) && /card\.onOpenBcc/.test(emailView)
    && /card\.ccEditor/.test(emailView) && /card\.bccEditor/.test(emailView)
    && !!host && /chips\(cc, setCc\)/.test(host) && /chips\(bcc, setBcc\)/.test(host)
    && /AttendeeChips/.test(host));
  gate('T24.6b TRUTH BEFORE PRESENTATION at the address rows — bcc renders only on the door that carries bcc',
    // the mailbox door models cc AND bcc…
    !!sendReply && /cc, bcc, to \} = await request\.json\(\)/.test(sendReply)
    && /bcc: bcc \|\| undefined/.test(sendReply)
    // …the coworker door models cc and NOT bcc…
    && !!coworkerSend && /const \{ to, cc, subject, body, agentId, draftId \} = await req\.json\(\);/.test(coworkerSend)
    && !/bcc/.test(coworkerSend)
    // …so the card offers bcc only on the mailbox lane, and sends what it collected
    // RE-POINTED (Sep 21): bcc is the ITEM lane's alone now — the standalone door models
    // to/cc/subject/body and nothing else, so it shows no bcc either. The law is unchanged and now
    // covers one more door.
    && !!host && /\.\.\.\(itemLane \? \{\s*\n\s*onOpenBcc/.test(host)
    && /\.\.\.\(bcc\.length \? \{ bcc \} : \{\}\)/.test(host));
  gate('T24.7 ATTACH IS THE INBOX’S OWN MODEL, and it rides the send that can carry it',
    !!host && /type PendingAttachment = \{ filename: string; content: string; mimeType: string \}/.test(host)
    && /KbFilePicker/.test(host) && /\/api\/kb\/attachment\?fileId=/.test(host)
    && /\.\.\.\(attachments\.length \? \{ attachments \} : \{\}\)/.test(host)
    && /ATTACH_MAX_TOTAL_BYTES/.test(host)
    && !!sendReply && /attachments: rawAttachments/.test(sendReply)
    // the coworker route carries no attachment field, so that lane wears no paperclip
    && !!coworkerSend && !/attachments/.test(coworkerSend));
  gate('T24.7b the attachment chips are the receipt, with a way back out',
    !!emailView && /card\.attachments!\.map/.test(emailView) && /a\.onRemove &&/.test(emailView)
    && !!host && /setAttachments\(\(prev\) => prev\.filter\(\(_, j\) => j !== i\)\)/.test(host));
  gate('T24.7c a rich toolbar only where the door carries HTML (the Resend lane escapes its body)',
    !!types && /richBody\?: boolean;/.test(types)
    // RE-POINTED (Sep 21): a standalone draft with no connected mailbox rides the SAME Resend
    // channel, so it takes the same words-not-markup treatment. One predicate, both Resend lanes.
    && !!host && /\.\.\.\(coworker \|\| viaCoworker \? \{\} : \{ richBody: true \}\)/.test(host)
    && /const text = coworker \|\| viaCoworker \? emailBodyText\(body\)\.trim\(\) : body;/.test(host));

  // ── (c) THE WORKING STATE ──
  gate('T24.8 ONE MOTION IDIOM for a card that is working — and it honours reduced motion',
    !!cards && /const workingClass = \(busy\?: boolean\) =>/.test(cards)
    && /motion-safe:animate-pulse/.test(cards)
    && (() => {
      const defs = sourceFiles('components/thread').filter((f) => /const workingClass = /.test(read(f) || ''));
      return defs.length === 1;
    })());
  gate('T24.8b EVERY regenerating path binds it — variant · tone · typed steer · the send itself',
    !!host && /const busy = !!redrafting \|\| sending;/.test(host) && /\n    busy,/.test(host)
    // the authored doors (typed steer · tone) run through `redraft`, which owns `redrafting`…
    && /setRedrafting\(targetVariant\)/.test(host)
    && (host.match(/void redraft\(/g) ?? []).length >= 2
    // …and the direction tab's own cold click raises the SAME working state on the preview lane
    && /setRedrafting\(id\); setVariant\(id\);/.test(host));
  gate('T24.8c the body pulses and the commit row STANDS DOWN while it does',
    !!emailView && (emailView.match(/workingClass\(card\.busy\)/g) ?? []).length >= 3
    && /disabled=\{card\.sendDisabled \|\| card\.busy\}/.test(emailView)
    && /<ToneMenu options=\{card\.toneOptions!\} onPick=\{card\.onPickTone\} disabled=\{card\.busy\} \/>/.test(emailView));

  // ── (d) THE INVITE INHERITS THE GRAMMAR ──
  gate('T24.9 the invite card wears the SAME working state, from the same helper',
    !!cards && /className=\{cn\('flex flex-col gap-2\.5 px-4 py-3\.5', workingClass\(card\.busy\)\)\}/.test(cards)
    && !!invite && /busy: sending,/.test(invite)
    // THE INTERACTIVE KINDS DECLARE THE WORKING STATE AND NOBODY ELSE DOES. Three of them since
    // the attention arc's bulk deed (A7) joined the invite and the email — the count moves with the
    // grammar, honestly, rather than the law being loosened to a >= .
    // RE-POINTED (Sep 22, never weakened — the same "count moves with the grammar" law): the
    // collection card's ROW VERB declares its own working state, so the honest count is 4.
    // RE-POINTED AGAIN (Wave 2): the EVENT card's verb is the fifth — an outward deed in flight
    // must be able to say so, or a second click lands on a provider call already running.
    // RE-POINTED AGAIN (W3-C, Sep 22): the FORWARD card is the sixth, for exactly that reason —
    // its commit leaves the building, so an in-flight send has to stand the card down.
    // RE-POINTED AGAIN (W4-A, Sep 22): the PROPOSAL card is the seventh — the room's one primary
    // deed can be in flight (its click sends or navigates), and a card that cannot say so lets the
    // reader fire it twice. The count keeps moving with the grammar rather than becoming a >=.
    && !!types && (types.match(/busy\?: boolean;/g) ?? []).length === 7);
  // ── (e) THE DOOR BELONGS TO THE CARD ──
  gate('T24.10 THE THREAD DOOR RENDERS WHEREVER A HOST HANDS ONE — even on a sent card, never gated on liveness',
    // ⚠️ RE-POINTED (Sep 14): the door stopped depending on a host remembering the prop — on the
    // item lane the card falls back to its own address, so it renders at EVERY mount (T29.7).
    !!host && /\.\.\.\(openThread \? \{ onOpenThread: openThread, threadLabel: 'Thread →' \} : \{\}\),/.test(host)
    // it sits OUTSIDE the `live` block (which begins at `...(live ? {`) — one spread, before it
    && host.indexOf("onOpenThread: openThread, threadLabel") < host.indexOf('...(live ? {')
    && !!emailView && /card\.onOpenThread && \(/.test(emailView));

  gate('T24.9b AN EDITOR NEVER SWALLOWS WHAT WAS TYPED — a closed people field commits its address',
    !!people && /useEffect\(\(\) => \(\) => \{/.test(people)
    && /if \(v\.includes\('@'\)\) liveRef\.current\.onPick\(v\);/.test(people));

  // ── (f) THE POLISH WAVE (owner walk, Sep 10) ──
  // "take long to change between tabs" · "editor looks messy" · "wasn't considered in the email
  // context… nor to open/see the document". Three laws, one card.

  // The wait is a real model call; the SILENCE was the bug. The clicked tab takes the selection in
  // the same frame and gives it back on failure — the card never sits on a variant it does not hold.
  gate('T24.11 THE CLICK ANSWERS IN THE SAME FRAME — the tab selects before the round-trip, and reverts on failure',
    !!host && /const previous = variant;/.test(host)
    && /setRedrafting\(targetVariant\); setVariant\(targetVariant\); setErr\(null\);/.test(host)
    // every failure exit hands the selection back — the two in `redraft` and the cold click's own
    && (host.match(/setVariant\(previous\);/g) ?? []).length === 3
    && /\}, \[item, redrafting, variant\]\);/.test(host));

  // A PREVIEW IS NOT A DEED (Sep 10 — re-pointed, strictly stronger). The old form of this gate
  // forbade pre-generation outright, because the only redraft door PERSISTED (it versioned the
  // draft and moved `inbox_items.source_data.draft`). The law it was protecting was never "do not
  // pre-generate" — it was "a direction NOBODY PICKED must never rewrite the room's prepared
  // reply". So the ban now sits where the danger is: background work may flow ONLY through the
  // preview lane, and the persisting door stays reachable only from an instruction the user
  // authored (a typed steer, a tone tweak).
  gate('T24.11b PRE-GENERATION FLOWS ONLY THROUGH THE PREVIEW LANE — the persisting door stays for picked steers',
    !!host && /A PREVIEW IS NOT A DEED/.test(host)
    // every background/tab producer is the preview fetch; the persisting call lives in `redraft`
    // exactly ONE request body in the host carries the preview flag, and it is the warm lane's
    && (host.match(/JSON\.stringify\(\{[^}]*preview: true/g) ?? []).length === 1
    && /body: JSON\.stringify\(\{ kind: 'email', id: item\.id, text: instruction, preview: true \}\)/.test(host)
    && (host.match(/'\/api\/items\/steer'/g) ?? []).length === 2
    // the pre-gen timer and the hover warm call the PREVIEW, never `redraft`
    && !/setTimeout\([^)]*redraft/.test(host)
    && /await previewBody\(directionVariantId\(i\), directionInstruction\(d\), ctrl\.signal\)/.test(host)
    && /const warmVariant = \(id: string\) => \{[\s\S]{0,400}previewBody\(/.test(host)
    // …and the direction tabs (cold click included) never reach the persisting door
    && !/redraft\((?:id|targetVariantId)[^)]*directionInstruction/.test(host)
    && /void previewBody\(id, directionInstruction\(dir\)\)/.test(host));

  gate('T24.14 THE PREVIEW LANE WRITES NOTHING — every persisting site sits behind `persist`',
    (() => {
      const conv = read('lib/converse/index.ts') || '';
      const helper = conv.slice(conv.indexOf('async function redraftItemDraft('), conv.indexOf('/** THE entry —'));
      if (!helper) return false;
      // the preview returns BEFORE the writes, in both lanes
      const returns = (helper.match(/if \(!persist\) return body;/g) ?? []).length === 2;
      // and every write site named in the report lives AFTER one of those returns
      const firstReturn = helper.indexOf('if (!persist) return body;');
      const sites = [
        "title: 'Reply draft — prior version'", "title: 'Reply draft — steered'",
        'evaluateDeliverable', "from('inbox_items').update(", 'law_version:',
        "kind: 'commitment', entity_id: scope.itemId, type: 'draft'",
      ];
      const guarded = sites.every((s) => helper.indexOf(s) > firstReturn);
      // the preview never runs the classifier or any other branch: it short-circuits in `converse`
      const shortCircuit = /if \(opts\.preview\) \{[\s\S]{0,400}redraftItemDraft\(client, userId, scope, text, \{ persist: false \}\)/.test(conv)
        && conv.indexOf('if (opts.preview) {') < conv.indexOf('const turn = await converseInner(');
      return returns && guarded && shortCircuit;
    })());

  gate('T24.14b ONE DRAFTER, ONE GROUNDING — the preview is the SAME call the deed makes',
    (() => {
      const conv = read('lib/converse/index.ts') || '';
      // exactly one call of each drafter in the core, and one composition of the steering note.
      // RE-POINTED (Sep 21, HANDS FOR THE SCOPE): the draft door's STANDALONE lane — a message in
      // no inbox of ours — calls the SAME `generateReplyDraft` with the SAME steering-note
      // composition rather than minting a second drafter, so the core now holds two call sites and
      // three notes. The law is unchanged and now covers one more door: ONE drafter, ONE grounding.
      return (conv.match(/generateReplyDraft\(userId, sd, client, instr\)/g) ?? []).length === 1
        && (conv.match(/generateReplyDraft\(userId, sd, client,\n/g) ?? []).length === 1
        && (conv.match(/generateNudgeDraft\(userId, \{/g) ?? []).length === 1
        && (conv.match(/THE USER'S STEERING NOTE/g) ?? []).length === 3
        // …and the persisting door calls the very same helper
        && /await redraftItemDraft\(client, userId, scope, text, \{ persist: true, learned: turn\.learned \}\)/.test(conv);
    })());

  gate('T24.14c THE PREVIEW DOOR IS A READ — it carries no decision consequence and returns only words',
    (() => {
      const route = read('app/api/items/steer/route.ts') || '';
      return /const preview = body\.preview === true;/.test(route)
        && /converse\(supabase, user\.id, \{ kind: 'item', itemKind: kind, itemId: id \}, text, \{ preview: true \}\)/.test(route)
        // the preview return sits ABOVE the decision-contract rewrite (a preview is never a deed)
        && route.indexOf('if (preview && kind !==') < route.indexOf('if (body.decision?.option)')
        && /preview: true, say: '', refs: \[\], draft: turn\.draft \?\? null/.test(route);
    })());

  gate('T24.14d PRE-GENERATION IS BOUNDED — ≤3 tabs, one at a time, after idle, abandoned on unmount',
    !!host && /const PREGEN_MAX = 3;/.test(host) && /const PREGEN_IDLE_MS = 1000;/.test(host)
    && /directions\.slice\(0, PREGEN_MAX\)\.entries\(\)/.test(host)
    && /\}, PREGEN_IDLE_MS\);/.test(host)
    && /if \(ctrl\.signal\.aborted\) return;/.test(host)
    && /return \(\) => \{ clearTimeout\(timer\); ctrl\.abort\(\); \};/.test(host)
    // one direction is never generated twice: a click joins the running warm
    && /const running = inFlightRef\.current\.get\(id\);/.test(host)
    && /if \(running\) return running;/.test(host));

  gate('T24.14e THE COLD CLICK STILL SHOWS ITSELF — the tab selects, pulses, and reverts on failure',
    !!host && /setRedrafting\(id\); setVariant\(id\);/.test(host)
    && /setVariant\(previous\); setErr\("I couldn't redraft that one/.test(host)
    && /setRedrafting\(\(cur\) => \(cur === id \? null : cur\)\)/.test(host)
    // the pulse still binds every regenerating path (T24.8b's variants: loading flag)
    && /variants: props\.variants\.map\(\(v\) => \(\{ \.\.\.v, loading: redrafting === v\.id \}\)\)/.test(host)
    // the kit's hover door exists and is optional — a host that passes none never warms
    && !!types && /onWarmVariant\?: \(id: string\) => void;/.test(types)
    && !!cards && /onMouseEnter=\{card\.onWarmVariant \? \(\) => card\.onWarmVariant!\(v\.id\) : undefined\}/.test(cards));

  // ONE PARAGRAPH RHYTHM, AT REST AND UNDER THE CARET — the read view now obeys the SAME block
  // spacing the global `[contenteditable]` rules give the editor, last-child included, and occupies
  // the same box, so clicking into the draft never re-flows it.
  gate('T24.12 the draft does not re-space itself when it is clicked into',
    !!emailView && /\[&_p\]:mb-\[0\.6em\]/.test(emailView)
    && /\[&_p:last-child\]:mb-0/.test(emailView)
    && /'-mx-2 cursor-text rounded border border-transparent px-2 py-1\.5'/.test(emailView)
    && /'-mx-2 rounded border border-indigo-300 px-2 py-1\.5'/.test(emailView)
    // …and the global rules it mirrors really say that
    && (() => { const css = read('app/globals.css') || '';
      return /\[contenteditable\] p \{ margin: 0 0 0\.6em; \}/.test(css)
        && /\[contenteditable\] p:last-child \{ margin-bottom: 0; \}/.test(css); })());

  gate('T24.12b the subject stays quiet at the right and never pushes the recipients into a second line',
    !!emailView && /ml-auto flex min-w-0 max-w-\[46%\] items-baseline gap-1 text-\[11px\] text-neutral-400/.test(emailView));

  gate('T24.12c THE TOOLBAR IS AN EDITING AFFORDANCE — it exists only while the body is being edited',
    !!emailView && /\{editingBody && card\.onEditBody && card\.richBody \? \(/.test(emailView)
    // the ONLY ReplyEditor mount in the card is inside that branch
    && (emailView.match(/<ReplyEditor/g) ?? []).length === 1
    && emailView.indexOf('<ReplyEditor') > emailView.indexOf('{editingBody && card.onEditBody && card.richBody ? ('));

  // THE MATERIAL IS PART OF THE EMAIL CONTEXT — the source message's attachments read where the
  // reply is written, through the ONE chip and the ONE viewer, and they never pose as outgoing.
  gate('T24.13 the card shows what CAME WITH the message it answers — counted, never claimed',
    !!types && /contextFiles\?: Array<\{ name: string; size\?: number \| null; onOpen\?: \(\) => void \}>;/.test(types)
    && !!emailView && /\(card\.contextFiles\?\.length \?\? 0\) > 0 && \(/.test(emailView)
    && /<AttachmentChip key=\{`\$\{f\.name\}:\$\{i\}`\} name=\{f\.name\} size=\{f\.size\} onClick=\{\(\) => f\.onOpen\?\.\(\)\}/.test(emailView)
    // ONE CHIP GRAMMAR (T25.9c) — the kit MOUNTS the shared chip, it does not redraw one
    && !!cards && /import \{ AttachmentChip \} from '@\/components\/ui\/attachment-lightbox';/.test(cards)
    && !/function AttachmentChip\(/.test(cards));

  gate('T24.13b …read-only by construction — context files never wear a remove, and never ride the send',
    !!emailView && (() => {
      const i = emailView.indexOf('card.contextFiles!.map');
      const j = emailView.indexOf('THE ATTACHMENT CHIPS');
      return i > 0 && j > i && !/onRemove/.test(emailView.slice(i, j));
    })()
    // the host maps them from the SOURCE thread, and the send body still carries only `attachments`
    && !!host && /sourceFiles\?: LightboxFile\[\] \| null;/.test(host)
    && /contextFiles: sourceList\.map/.test(host)
    && /\.\.\.\(attachments\.length \? \{ attachments \} : \{\}\),/.test(host));

  gate('T24.13c ONE VIEWER, ONE CONTEXT — the host raises the shared lightbox over the whole file list',
    !!host && /import \{ AttachmentLightbox, type LightboxFile \} from '@\/components\/ui\/attachment-lightbox';/.test(host)
    && /<AttachmentLightbox\n?\s*files=\{sourceList\} index=\{sourceOpenAt\}/.test(host)
    // and the room hands it the array the drawer's Files tab already reads — no second fetch
    && (() => { const d = read('components/home/item-detail.tsx') || '';
      return /sourceFiles=\{thread\?\.attachments \?\? null\}/.test(d)
        && /files: \(thread\?\.attachments \?\? \[\]\)\.map/.test(d); })());
}

// ── T25 · THE ITEM'S ONE CONTEXT DRAWER + THE ONE VIEWER (owner walk, Sep 9) ────────────────────
// "The side panel just flags all items that might be related… make this more meaningful… allow to
// see the threads… should be within the same sidebar as the rest, just well organized and
// intuitively and simply." · "I see the thread button on top, not clear. maybe move it to the
// component as the others." · "Allow the user to see and open (modal pop up for those kinds of
// things? like google? and next/back arrows if multiple attachments)."
console.log('\nT25 · THE CONTEXT DRAWER READS, THE ROWS MEAN, THE FILES OPEN');
{
  const detail = read('components/home/item-detail.tsx');
  const room = read('components/entities/entity-room.tsx');
  const box = read('components/ui/attachment-lightbox.tsx');
  const msgs = read('components/inbox/thread-messages.tsx');
  const card = read('components/home/email-card.tsx');
  const uiIndex = read('components/ui/index.ts');

  // ── (a) THE THREAD READS IN THE DRAWER — through the SHARED renderer, never a second one ──
  gate('T25.1 the drawer holds a THREAD section, and it is the SHARED <ThreadMessages/> (no second thread renderer)',
    !!detail && /id: 'thread', label: `\$\{extra\.threadLabel \?\? 'Thread'\}\$\{n > 1 \? ` · \$\{n\}` : ''\}`/.test(detail)
    && /threadLabel: objectKind === 'email_thread' \? 'Thread' : 'Source',/.test(detail)
    && /thread: threadErr/.test(detail)
    // both reading kinds hand the ONE renderer in
    && (detail.match(/<ThreadMessages messages=\{threadMessages\}/g) ?? []).length === 4
    // …and the renderer has exactly one home in the tree
    && (() => sourceFiles('components').filter((f) => /export function ThreadMessages\(/.test(read(f) || '')).length === 1)());
  gate('T25.1b GROUNDED OR ABSENT — no source to read, no section (an absent fact never gets a seat)',
    !!detail && /thread: \(threadErr \|\| \(threadMessages\?\.length \?\? 0\) > 0 \|\| thread\?\.body\)/.test(detail)
    && /: null,\n      files:/.test(detail)
    && /if \(extra\?\.thread\) \{/.test(detail)
    // the follow-up door refuses the same way — a commitment with no linked thread gets no section
    && /: hasMessages\n\s*\? <ThreadMessages/.test(detail));
  gate('T25.1c the section count is COUNTED, never claimed (a one-message thread wears no number)',
    !!detail && /const n = extra\.threadCount \?\? 0;/.test(detail)
    && /threadCount: threadMessages\?\.length \?\? 0,/.test(detail));

  // ── (b) RELATED IS ROWS THAT MEAN SOMETHING — a chip is a noun; a row is the fact ──
  gate('T25.2 related work renders as ROWS carrying kind · who · when — never a flat chip list',
    !!detail && /function RelatedRows\(/.test(detail) && /function DrawerRow\(/.test(detail)
    && /note=\{t\.who \? `Email · \$\{t\.who\.split\('<'\)\[0\]\.trim\(\)\}` : 'Email'\}/.test(detail)
    && /note="Meeting"/.test(detail)
    && /note=\{c\.who \? `Commitment · \$\{c\.who\.split\('<'\)\[0\]\.trim\(\)\}` : 'Commitment'\}/.test(detail)
    && /at=\{t\.at \? fmtMonthDay\(t\.at\) : null\}/.test(detail));
  gate('T25.2b the drawer stopped mounting the old chip strip, and it never asks for anything',
    !!detail && !/<ContextStrip/.test(detail) && !/from '@\/components\/room\/context-strip'/.test(detail)
    // the founding ask had a home already — the header's filing control, on all four kinds
    && (detail.match(/membership: <AddToProjectControl/g) ?? []).length === 4
    && !/Start a project from this/.test(detail));

  // ── (c) FILES OPEN — one viewer, one serving door ──
  gate('T25.3 the drawer holds a FILES section: what came with the item, then what is filed on the work',
    !!detail && /function FilesRows\(/.test(detail)
    && /note: 'Came with this email'/.test(detail)
    && /ref: \{ kind: 'kb', id: f\.id \}, note: 'Filed on this work'/.test(detail)
    // counted, never subtracted, and deduped so one document never wears two seats
    && /label: `Files · \$\{files\.length\}`/.test(detail) && /const seen = new Set<string>\(\);/.test(detail));
  gate('T25.4 ONE LIGHTBOX COMPONENT EXISTS, and it is the only file modal in the tree',
    !!box && /export function AttachmentLightbox\(/.test(box)
    && !!uiIndex && /export \{ AttachmentLightbox, AttachmentChip, fmtBytes \}/.test(uiIndex)
    && (() => sourceFiles('components').filter((f) => /export function AttachmentLightbox\(/.test(read(f) || '')).length === 1)()
    // the room's own donor modal RETIRED into it — a second file modal is the class this closes
    && !!room && !/function FilePreviewModal/.test(room) && !/<FilePreviewModal/.test(room));
  gate('T25.4b EVERY attachment mount raises it — the item drawer, the shared thread renderer, the project room',
    !!detail && /<AttachmentLightbox files=\{files\} index=\{at\}/.test(detail)
    && !!msgs && /<AttachmentLightbox files=\{allFiles\} index=\{lightbox\}/.test(msgs)
    && !!room && /<AttachmentLightbox files=\{viewableFiles\} index=\{previewAt\}/.test(room)
    // …and no surface hand-rolls a preview iframe of its own any more
    && (() => sourceFiles('components')
        .filter((f) => f !== 'components/ui/attachment-lightbox.tsx')
        .filter((f) => /files\/preview/.test(read(f) || '') && /<iframe/.test(read(f) || '')).length === 0)());
  gate('T25.5 ARROWS ONLY WITH A SECOND FILE — and the keys agree with the chrome',
    !!box && /const many = total > 1;/.test(box)
    && (box.match(/\{many && \(\n\s*<button onClick=\{\(\) => go\(/g) ?? []).length === 2
    && /if \(!many\) return;\n\s*if \(e\.key === 'ArrowRight'\)/.test(box)
    && /if \(!many\) return;\n\s*onIndex\(\(i \+ d \+ total\) % total\);/.test(box)
    && /\{many && <span[\s\S]{0,120}\{i \+ 1\} of \{total\}<\/span>\}/.test(box));
  gate('T25.6 THE OVERLAY LAW — it PORTALS to document.body (z-index never wins across stacking contexts)',
    !!box && /createPortal\(/.test(box) && /document\.body,/.test(box)
    && /import \{ createPortal \} from 'react-dom';/.test(box));
  gate('T25.6b it closes three ways — ✕ · Escape · the scrim — and never on mouse-leave',
    !!box && /if \(e\.key === 'Escape'\)/.test(box)
    && /className="absolute inset-0 bg-neutral-900\/55 backdrop-blur-\[2px\]" onClick=\{onClose\}/.test(box)
    && /aria-label="Close"/.test(box) && !/onMouseLeave/.test(box));
  gate('T25.6c the reduced-motion floor holds for the viewer’s own arrival',
    !!box && /prefers-reduced-motion: reduce[\s\S]{0,120}aug-lightbox/.test(box));
  gate('T25.7 ONE SERVING DOOR — every ref resolves through /api/files/preview, and resolutions are cached per file',
    !!box && (box.match(/fetch\('\/api\/files\/preview'/g) ?? []).length === 1
    && /cacheRef\.current\.set\(i, r\);/.test(box)
    && /export type LightboxRef =/.test(box));
  gate('T25.7b NEVER A BROKEN EMBED — an un-embeddable type gets an honest file card, not an <iframe>',
    !!box && /isPdf\(file, res\)/.test(box) && /isImage\(file, res\)/.test(box)
    && /This kind of file opens outside the preview\./.test(box)
    && /Could not open this one\./.test(box));

  // ── (d) THE CARD OWNS THE DOOR; THE HEADER STOPPED WEARING A BARE WORD ──
  gate('T25.8 the item room passes the card its "Thread →", and the door lands ON the Thread section',
    !!detail && /onOpenThread=\{\(\) => openDrawerAt\('thread'\)\}/.test(detail)
    && /const openDrawerAt = \(tab: string\) => setDrawerReq\(\(r\) => \(\{ tab, v: \(r\?\.v \?\? 0\) \+ 1 \}\)\);/.test(detail)
    && /drawerSignal: drawerReq,/.test(detail)
    // the frame honours it, re-fireably (a second click is never dead) — the pane itself lands on
    // the named section, since it owns its own tab state now (ONE drawer, both doors)
    && /if \(!sigV\) return;\n\s*setDrawerOpen\(true\);/.test(detail)
    && (() => { const dr = read('components/room/filed-drawer.tsx') ?? ''; return /if \(sigTab\) setTab\(sigTab\);/.test(dr); })()
    // …and the card carries the door the host handed it
    && !!card && /\.\.\.\(openThread \? \{ onOpenThread: openThread, threadLabel: 'Thread →' \} : \{\}\)/.test(card));

  // ── (e) THE SHARED RENDERER'S ATTACHMENT LANE IS OPT-IN (the inbox inherits, never regresses) ──
  gate('T25.9 attachments are OPTIONAL in the shared renderer — a caller that serves none renders no lane',
    !!msgs && /attachments\?: ThreadAttachment\[\] \| null;/.test(msgs)
    && /\(list && list\.length > 0\) \? \(/.test(msgs)
    && /export type ThreadAttachment = LightboxFile;/.test(msgs));
  gate('T25.9b ONE CONTEXT for the arrows — every file the thread holds, in thread order',
    !!msgs && /const allFiles: ThreadAttachment\[\] = useMemo\(/.test(msgs)
    && /for \(const m of messages \?\? \[\]\) for \(const a of m\.attachments \?\? \[\]\) out\.push\(a\);/.test(msgs)
    && /const at = allFiles\.indexOf\(a\);/.test(msgs));
  gate('T25.9c ONE CHIP GRAMMAR — the chip lives with the viewer, never redrawn per surface',
    !!box && /export function AttachmentChip\(/.test(box)
    && (() => sourceFiles('components').filter((f) => /export function AttachmentChip\(/.test(read(f) || '')).length === 1)()
    && !!msgs && /<AttachmentChip key=/.test(msgs));
  // Found ONLY by the browser walk (Sep 9): the lightbox's PDF <iframe> rendered a broken-document
  // glyph — CSP frame-src did not allow the Supabase signed-URL host, silently blanking every PDF
  // preview. The CSP grant is load-bearing for the viewer; tightening it kills the lane invisibly.
  gate('T25.10 THE PREVIEW HOST IS CSP-ALLOWED — frame-src carries the storage host the lightbox frames',
    (() => { const cfg = read('next.config.ts') || ''; const m = cfg.match(/"frame-src [^"]*"/);
      return !!m && m[0].includes('https://*.supabase.co'); })());

  // ── (e) ONE CHROME BAND PER ROOM (owner walk, Sep 10) ──
  // "confusing to have 2 elements… like a header and then the conversation. not sure its necessary"
  // · "this header part seems redundant?" The item door stacked the room's 52px header on top of
  // the rail's own name row ("About this" / the project name). The rail's row is gone at BOTH
  // doors, and the ONE header absorbed the only thing it held alone: the project DOOR.
  const rail = read('components/home/item-rail.tsx');
  gate('T25.11 the rail carries NO name band — the room’s one header is the only chrome',
    !!rail && !/'About this'/.test(rail)
    && !/\{!inRoom && \(\s*\n\s*<div className="h-10 flex items-center gap-2 px-3/.test(rail)
    // and the band's imports left with it (a dead import is a band waiting to come back)
    && !/ChatBubbleLeftRightIcon/.test(rail)
    && !/from '@\/lib\/room\/project-href'/.test(rail)
    && /ONE CHROME BAND PER ROOM/.test(rail));

  gate('T25.11b NOTHING THE BAND HELD IS LOST — the project door moved INTO the one header',
    !!detail && /project\?: \{ id: string; name: string; tracked\?: boolean \} \| null;/.test(detail)
    && /<Link href=\{projectHref\(room\.project\.id\)\}/.test(detail)
    // every kind that wears the filing chip also hands the door
    && (detail.match(/project: railView\?\.entity \?\? null,/g) ?? []).length
       === (detail.match(/membership: <AddToProjectControl/g) ?? []).length
    // A DOOR WITH NOWHERE TO GO IS A LYING DOOR — an untracked entity has no room to open, and the
    // filing chip beside it already names it.
    && /room\.project && room\.project\.tracked !== false && \(/.test(detail));

  // ── (f) A ROW THAT OPENS SOMETHING SAYS SO ──
  // "here action just open the email clicked? or" — the Related rows always navigated; nothing on
  // them said they would.
  gate('T25.12 EVERY related row carries a real door — the project row opens the project room',
    !!detail && (() => {
      const from = detail.indexOf('function RelatedRows');
      const to = detail.indexOf('function FilesRows');
      if (from < 0 || to < from) return false;
      const block = detail.slice(from, to);
      const rows = block.match(/<DrawerRow\b/g) ?? [];
      const doors = block.match(/onClick=\{\(\) => router\.push\(/g) ?? [];
      return rows.length >= 4 && doors.length === rows.length
        && /router\.push\(projectHref\(ent\.id\)\)/.test(block)
        && /router\.push\(`\/item\/\$\{t\.id\}`\)/.test(block);
    })());

  gate('T25.12b …and it LOOKS like a door — the chevron and the hover exist only where a handler does',
    !!detail && /\{onClick && <ChevronRightIcon/.test(detail)
    && /group-hover:text-indigo-700/.test(detail)
    && /className="group w-full flex items-start gap-2\.5 rounded-lg px-2 py-1\.5 text-left transition-colors hover:bg-indigo-50\/50"/.test(detail)
    // the inert branch stays inert: no group, no chevron, no hover
    && /<div className="w-full flex items-start gap-2\.5 rounded-lg px-2 py-1\.5">\{inner\}<\/div>/.test(detail));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T26 · AN ITEM'S OWN DOCUMENT IS THE ITEM'S OWN CONTEXT (owner walk, Sep 10)
//
// An inbound email carried a debt notice — fetched at sync, stored, extracted, rendered in the
// Files tab — and the drafted reply, one click from being mailed to a real counterparty, said the
// attachment had never arrived. The pinned brief told the user to send the counterparty their own
// document back. Nothing hallucinated: no reasoner in the item's lane was ever handed the file.
// These gates keep the document in the room: the drafter reads its text, the tight readers (judge,
// board) carry its name + gist + DIRECTION, extraction is cached fill-if-empty, and every clip
// declares itself.
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  console.log('\nT26 · THE ITEM CARRIES ITS OWN DOCUMENTS');
  const ctx = read('lib/inbox/attachment-context.ts');
  const drafter = read('lib/inbox/draft-reply.ts');
  const judge = read('lib/work/judge.ts');
  const ground = read('lib/room/grounding.ts');
  const draftRoute = read('app/api/inbox/[id]/draft/route.ts');
  const pass_ = read('lib/prepare/pass.ts');

  gate('T26.1 ONE resolver for an item’s own documents — and it is the only one',
    !!ctx && /export async function readItemAttachments\(/.test(ctx)
    && /export function renderAttachedDocumentsBlock\(/.test(ctx)
    && /export function attachmentFactBlock\(/.test(ctx)
    && (() => sourceFiles('lib').concat(sourceFiles('app'))
        .filter((f) => /export async function readItemAttachments\(/.test(read(f) || '')).length === 1)());

  gate('T26.2 THE DRAFTER IS HANDED THE DOCUMENT — its text rides the grounding of the one drafter',
    !!drafter && /readItemAttachments/.test(drafter) && /renderAttachedDocumentsBlock/.test(drafter)
    && /const attachBlock = await readItemAttachments\(/.test(drafter)
    && /\$\{attachBlock \? `\\n\$\{attachBlock\}/.test(drafter));

  gate('T26.3 NEVER CLAIM A DOCUMENT IS MISSING — the rule is composed into the block, both halves',
    !!ctx && /NEVER say a document was not received, is missing, did not arrive/.test(ctx)
    && /never offer to send \` \+\n\s*`THEIR OWN document back to them/.test(ctx)
    // …and the grounding half: figures come from the text, never a guess
    && /must be \` \+\n\s*`taken from the text below — never estimated, never invented/.test(ctx));

  gate('T26.4 AN UNREADABLE FILE IS STILL RECEIVED — the honest branch never invents an absence',
    !!ctx && /IS in our possession; its text could not be \` \+/.test(ctx)
    && /never say it was not received/.test(ctx));

  gate('T26.5 THE EXCERPT-HONESTY LAW holds on every clip in the lane — no raw slice feeds a prompt',
    !!ctx && /clipForPrompt\(a\.text, DRAFT_CLIP\)/.test(ctx)
    && /clipForPrompt\(a\.text\.replace\(\/\\s\+\/g, ' '\), GIST_CLIP\)/.test(ctx)
    && /EXCERPT_RULE/.test(ctx)
    // the drafter's own email body + earlier-thread clips are boundary clips, not slices
    && !!drafter && /clipForPrompt\(body, 3000\)/.test(drafter) && /clipForPrompt\(body, 1200\)/.test(drafter)
    && !/body\.slice\(0, ?\d+\)/.test(drafter)
    && /EXCERPT_RULE/.test(drafter));

  gate('T26.6 EXTRACTION IS FILL-IF-EMPTY AND CACHED — read once, never overwrite, never re-extract',
    !!ctx && /const needText = atts\.filter\(\(a\) => !a\.text && a\.storagePath\);/.test(ctx)
    && /if \(!needText\.length\) return atts;/.test(ctx)
    && /if \(String\(rec\.extractedText \?\? ''\)\.trim\(\)\) continue;/.test(ctx)
    && /MAX_LAZY_BYTES/.test(ctx) && /MAX_ATTACHMENTS/.test(ctx));

  gate('T26.7 THE STEER PATH SHARES THE ONE GROUNDING — no forked drafter behind /api/items/steer',
    (() => {
      const route = read('app/api/items/steer/route.ts') || '';
      const conv = read('lib/converse/index.ts') || '';
      return /converse\(supabase, user\.id, scope, text\)/.test(route)
        && /await import\('@\/lib\/inbox\/draft-reply'\)/.test(conv)
        && /generateReplyDraft\(userId, sd, client, instr\)/.test(conv)
        // and it never assembles an attachment block of its own
        && !/renderAttachedDocumentsBlock/.test(conv);
    })());

  gate('T26.8 THE JUDGE HOLDS THE FACT — names + gist reach the one reasoned call, with the direction',
    !!judge && /let attachFacts = '';/.test(judge)
    && /attachFacts = attachmentFactBlock\(await readItemAttachments\(client, userId, sd, String\(it\.id\)\), who\);/.test(judge)
    // ⟲ RE-POINTED (W3.1 judge half): the booked-calendar block became LATER EVIDENCE and moved
    // beside the sibling settlement fact; the attachment fact stays in the brain-neighbourhood run.
    // ⟲ W5c: the WITHDRAWN block (hidden artifacts, never "already prepared") rides beside the pool.
    && /poolBlock \+ (?:withdrawnBlock \+ )?attachFacts \+/.test(judge)
    && !!ctx && /sent these TO the user/.test(ctx)
    && /never propose sending the \` \+\n\s*`sender their own document back/.test(ctx));

  gate('T26.9 THE BOARD CARRIES IT — the room’s one page names an item’s documents and their direction',
    !!ground && /attachments: string\[\];/.test(ground)
    && /attachmentFactLines\(await readItemAttachments\(client, userId, sd, String\(it\.id\)\)\)/.test(ground)
    && /ATTACHED TO IT \(\$\{b\.who \? `\$\{b\.who\} sent these TO the user`/.test(ground)
    && /never propose sending the counterparty their own document back/.test(ground));

  gate('T26.10 A DRAFT WRITTEN UNDER THE OLD LAW IS SUPERSEDED — the lie never survives the fix',
    !!ctx && /export const DRAFT_LAW_VERSION = /.test(ctx) && /export function draftLawStale\(/.test(ctx)
    // both serve gates consult it
    && !!draftRoute && /draftLawStale\(sd\.draft \?\? null\)/.test(draftRoute)
    // ⟲ RE-POINTED (W9.1): the pass's reply lane hands the law to THE ONE DECISION (a machine draft
    // under the old law regenerates; the user's own edit is never replaced by a law bump).
    && !!pass_ && /lawStale: !!existing\?\.body && draftLawStale\(existing\)/.test(pass_)
    // and every fresh writer stamps it
    && /law_version: DRAFT_LAW_VERSION\b/.test(draftRoute)
    && (pass_.match(/law_version: DRAFT_LAW_VERSION_C/g) ?? []).length >= 2
    && (() => /law_version: \(await import\('@\/lib\/inbox\/attachment-context'\)\)\.DRAFT_LAW_VERSION/.test(read('lib/converse/index.ts') || ''))());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T27 · LAW 2 — THE EXPIRY LAW (THE PROACTIVE REACH ARC, docs/proactive-reach-plan.md)
//
// The commitment lane had two outcomes — close on a fulfilling message, or nag forever — so a
// lapsed obligation kept its seat on the deck months after its moment passed. The third outcome
// is NOMINATE (deterministic, on the USER'S clock) → JUDGE (one cheap reasoned pass) → and ONLY
// `expired` closes, undoably. These gates hold the asymmetry (failure is never a verdict), the
// ordering (a lapsed obligation never mints a fresh deck row in the same breath it should die),
// and LAW 1's commitment clause (no unjudged row leads the deck).
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  console.log('\nT27 · THE EXPIRY LAW — a lapsed obligation gets a verdict, not a nag');
  const exp = read('lib/commitments/expiry.ts');
  // ⟲ RE-POINTED (W7.1 HEARTBEAT THROUGHPUT): the commitments sweep is a DISPATCHER; the expiry lane
  // runs in the per-account pass (lib/work/evidence-sweep.ts). The laws below read BOTH files.
  const sweep = read('app/api/cron/commitments-sweep/route.ts') + '\n' + read('lib/work/evidence-sweep.ts');
  const ful = read('lib/commitments/fulfillment.ts');
  const restore = read('lib/activity/restore.ts');

  gate('T27.1 THE THIRD OUTCOME EXISTS — one module, the NOMINATE→JUDGE idiom, three verdicts',
    !!exp && /verdict: 'expired' \| 'still_owed' \| 'unclear'/.test(exp)
    && /export async function judgeCommitmentExpiry\(/.test(exp)
    && /export async function applyExpiryVerdict\(/.test(exp)
    && /export function isPastDue\(/.test(exp)
    // …and it is the ONLY implementation (the site-list decay class)
    && (() => sourceFiles('lib').concat(sourceFiles('app'))
        .filter((f) => /export async function judgeCommitmentExpiry\(/.test(read(f) || '')).length === 1)());

  gate('T27.2 ONLY `expired` CLOSES — still_owed / unclear / a failed judge change NOTHING',
    !!exp && /if \(verdict\.verdict !== 'expired'\) return false;/.test(exp)
    // the close is the guarded status flip, never a delete
    && /\.update\(\{ status: 'dismissed', resolved_at: nowIso, resolved_reason: 'expired'/.test(exp)
    && /\.eq\('status', 'open'\)/.test(exp)
    && !/\.delete\(\)\s*\n?\s*\.eq\('id', commitment\.id\)/.test(exp));

  gate('T27.3 FAILURE IS NEVER A VERDICT — an outage returns unclear and is deliberately NOT cached',
    !!exp && /catch \(e\) \{[\s\S]*?return \{ verdict: 'unclear', reason: 'expiry judge unavailable' \};/.test(exp)
    // the cache write lives only on the success path, above the catch
    && exp.indexOf("kind: 'expiry', entity_id: cacheKey.entity") < exp.indexOf("expiry judge unavailable"));

  gate('T27.4 THE NOMINATION IS DETERMINISTIC AND ZERO-AI — a pure past-due predicate on the user’s day',
    !!exp && /export function isPastDue\(commitment: \{ due_date\?: string \| null \}, todayStr: string\): boolean \{/.test(exp)
    && /return \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(due\) && due < todayStr;/.test(exp)
    // an undated obligation has no moment to have passed — it can never be nominated
    && /An undated commitment can never be nominated/.test(exp)
    // …and the sweep decides "today" on the USER'S clock, never the server's
    && !!sweep && /localNow\(await userTimezone\((sb|admin), userId\)\)\.dateStr/.test(sweep)
    && !/const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/.test(sweep));

  // ⟲ RE-POINTED (W2.3 RETIRE THE MIRRORS): the aging surface is GONE — the sweep writes no inbox
  // mirror any more (a commitment has one home). The order law survives as: the expiry verdict
  // still short-circuits the loop, and no `inbox_items` insert exists anywhere after it.
  gate('T27.5 THE ORDER HOLDS — expiry closes short-circuit the loop and no mirror is ever minted after them',
    // ⟲ (W7.1) the expiry branch is the pass's LAST step per row — a close ends that row's work.
    !!sweep && /if \(await applyExpiryVerdict\(admin, userId, c, ev\)\) out\.expiry\.expired\+\+;/.test(sweep)
    && !/from\('inbox_items'\)\s*\.insert\(/.test(sweep) && /RETIRED, W2\.3/.test(sweep));

  gate('T27.6 BOUNDED + HONEST — a cap per sweep, the remainder counted and logged, never silent',
    // ⟲ RE-POINTED (W7.1): the cap is per ACCOUNT per run now (each account has its own pass).
    !!sweep && /export const EXPIRY_JUDGMENTS_PER_USER = \d+;/.test(sweep)
    && /out\.expiry\.leftBehind\+\+;/.test(sweep)
    && /expiry cap reached/.test(sweep)
    // ⟲ RE-POINTED (Sep 22 — W3.1): the response now also carries the evidence lanes' counts, so the
    // expiry remainder is one field among several — still RETURNED, not only logged.
    // ⟲ (W7.1) RETURNED: the pass's result carries expiry.leftBehind beside the evidence lanes' counts.
    && /expiry: \{ judged: number; expired: number; leftBehind: number; deferred: number \}/.test(sweep));

  gate('T27.7 THE CACHE SIG CARRIES THE LAW VERSION — an older law’s verdict never satisfies this one',
    !!exp && /export const EXPIRY_LAW_VERSION = \d+;/.test(exp)
    && /sig: `\$\{EXPIRY_LAW_VERSION\}:\$\{due\}`/.test(exp));

  gate('T27.8 THE CLOSE IS UNDOABLE — it logs a registered reversible type, restored through the ONE door',
    !!exp && /type: 'commitment_expired',/.test(exp)
    && /metadata: \{ reason: verdict\.reason/.test(exp)
    && !!restore && /commitment_expired: 'commitment',/.test(restore)
    // /api/restore's commitment branch is the flip back to open — ⟲ RE-POINTED (W7.6): the flip moved
    // into THE ONE restore flip (lib/activity/reopen.ts), which the route calls and the repairs share.
    && (() => /reopenCommitment\(supabase, user\.id, entityId\)/.test(read('app/api/restore/route.ts') || '')
      && /status: 'open', resolved_at: null, resolved_reason: null/.test(read('lib/activity/reopen.ts') || ''))());

  // ⟲ RE-POINTED (W2.3 RETIRE THE MIRRORS): there is no surfaced row to judge — the commitment leads
  // the deck through its OWN lane, judged natively (`judgeWork({kind:'commitment'})` from the spine's
  // candidates). The clause holds structurally: the sweep never writes a deck row, so an unjudged
  // hand-built row cannot lead; the spine and the brief pool exclude the historical mirrors.
  gate('T27.9 LAW 1’s COMMITMENT CLAUSE — no hand-built deck row exists; the commitment is judged in its own lane',
    !!sweep && !/work_state: 'action_required'/.test(sweep) && !/source: 'commitment'/.test(sweep)
    && /kind: 'inbox' \| 'commitment'/.test(read('lib/work/judge.ts') || '')
    && /\.neq\('source', MIRROR_SOURCE\)/.test(read('lib/work-items/model.ts') || ''));

  gate('T27.10 THE UNDATED CLAUSE — open age is a FACT both judges see, and a version bump rides it',
    !!exp && /export function openAgeDays\(/.test(exp)
    && !!ful && /import \{ openAgeDays \} from '@\/lib\/commitments\/expiry';/.test(ful)
    // ⟲ RE-POINTED (Sep 22 — W3.1 EVIDENCE SETTLES): the judge now reads an OBLIGATION (commitment or
    // actionable item) against a candidate SET; the age fact rides unchanged, and the version floor
    // replaces the exact pin (an exact pin breaks on every lawful bump — the recorded lesson).
    && /const ageDays = openAgeDays\((commitment|obligation)\.created_at\);/.test(ful)
    && /this obligation has been open \$\{ageDays\} day\(s\)/.test(ful)
    && (() => { const m = ful.match(/export const FULFILLMENT_LAW_VERSION = (\d+);/); return !!m && Number(m[1]) >= 4; })());

  gate('T27.11 THE AGNOSTIC CLAUSE — the lane names no sender, token, vendor or language',
    !!exp && !/augmtd|gmail|outlook|@[a-z0-9-]+\.(com|pt|de)/i.test(exp.replace(/@\/lib\/[a-z-/]+/g, ''))
    && !/\b(condominium|invoice number|AHK|iScore)\b/i.test(exp));

  gate('T27.12 RETRO-REPAIR BY LAW — the same lane over the backlog, dry-run by default, guarded',
    (() => {
      const s = read('scripts/tmp-sweep-expired-commitments.ts') || '';
      return /const APPLY = process\.argv\.includes\('--apply'\);/.test(s)
        && /isPastDue\(c, today\)/.test(s) && /judgeCommitmentExpiry\(/.test(s) && /applyExpiryVerdict\(/.test(s)
        && /const ALL = process\.argv\.includes\('--all'\);/.test(s)
        && /CAP/.test(s);
    })());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T28 · THE PROJECT THREAD IS A THREAD (the owner's project-room walk, Sep 14)
//
// "Everything should flow in the conversation thread… why isn't this using the email component we
// did? is it because it's a project? … this still looks super confusing — we are overcomplicating."
//
// He opened a project room on a prepared reply. The pinned CTA raised the OLD two-pane stage: the
// raw thread with a Reply/Forward toolbar one click, a floating "Your reply — draft prepared"
// composer the next (state decided which, not the URL), and the EmailCard — the one rendering of
// this deliverable kind — never appeared at all, because the room served it as a bare row.
//
// Four laws, one per find:
//   1. THE CARD KIND IS THE ONE RENDERING, IN EVERY THREAD — the project room mounts the SAME
//      EmailCard the item room does, bounded to the room's own agenda (one card, never three).
//   2. THE CTA IS A DOOR TO THE CARD — it scrolls to the rendered deliverable; it does not raise
//      a stage, and click 1 does exactly what click 2 does.
//   3. THE ROOM SPEAKS ONCE — no chip row, no reopen delta (both retired above, gated there).
//   4. A NEVER-BLOCKING DOOR MUST STILL MAKE SENSE — the go-ahead renders only where proceeding
//      produces the work, says plainly what it skips, and a failure never strands in the record.
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  console.log('\nT28 · THE PROJECT THREAD IS A THREAD — the card, the door, the honest go-ahead');
  const rail = read('components/home/item-rail.tsx');
  // W3-A (Sep 22): the seats these laws moved to — the two hosts and the kit itself.
  const askHost = read('components/home/input-card.tsx');
  const kit = read('components/thread/thread-cards.tsx');
  const room = read('components/entities/entity-room.tsx');
  const detail = read('components/home/item-detail.tsx');
  const drawer = read('components/room/filed-drawer.tsx');
  const goAhead = read('lib/room/go-ahead.ts');

  // 1 — THE CARD REACHES THE PROJECT THREAD
  gate('T28.1 the project room mounts the ONE EmailCard for its prepared reply (same host, same Send)',
    !!room && /import \{ EmailCard \} from '@\/components\/home\/email-card'/.test(room)
    && /<EmailCard item=\{\{ id: boardRowItemId\(r\) \}\}/.test(room)
    && /THE CARD CONTRACT REACHES THE PROJECT THREAD/.test(room));
  gate('T28.2 …and it is the SAME component the item room mounts (one rendering, never a project fork)',
    !!detail && /<EmailCard/.test(detail)
    && sourceFiles('components').filter((f) => /from '@\/components\/home\/email-card'/.test(read(f) ?? ''))
      .every((f) => /<EmailCard/.test(read(f) ?? '')));
  gate('T28.3 ONE CARD, THE ROOM’S OWN AGENDA — the move’s target, else the single prepared reply; never an arbitrary pick',
    !!room && /const cardRowId = \(\(\) => \{/.test(room)
    && /const target = moveTargetId\(rail\?\.move\?\.ref \?\? rail\?\.entity\?\.move\?\.ref \?\? null\);/.test(room)
    // compared on the RAW id at both ends (the walk's find: a raw ref against a spine key never matched)
    && /replyRows\.some\(\(r\) => boardRowItemId\(r\) === target\)/.test(room)
    && /return replyRows\.length === 1 \? boardRowItemId\(replyRows\[0\]\) : null;/.test(room));
  // ⚠️ RE-POINTED, WIDENED (the orchestrator's walk of the SAME room, Sep 14): candidacy tested the
  // `prepared` TOKEN for the string 'draft'. That token is an attribution, not a deed — the live
  // "Send RIB…" row is judged `send_file`, was prepared by a coworker (so its token reads her NAME)
  // and carries a real outgoing draft. It mounted no card and its CTA fell through to the stage.
  // The predicate is now the DEED'S SHAPE, in ONE pure exercisable place.
  gate('T28.4 candidacy is the DEED’S SHAPE, not the verb string — ONE pure predicate, used by the room',
    (() => {
      const pres = read('lib/room/presentation.ts') ?? '';
      return /export function mountsEmailCard\(row: CardCandidateRow\): boolean \{/.test(pres)
        && !!room && /\.filter\(\(r\) => mountsEmailCard\(r\)\)/.test(room)
        // ⟲ RE-POINTED (stabilization W2.1, Sep 22): the same import now also carries `prepAnchorKey`
        // (the ONE reader-side prep anchor producer) — the predicate's home is unchanged.
        && /import \{ railCoversItem, moveTargetId, mountsEmailCard, boardRowItemId(?:, prepAnchorKey)? \} from '@\/lib\/room\/presentation'/.test(room)
        // the room no longer decides candidacy on a token string of its own (the LABEL may still
        // read `prepared`; what may not is the filter that decides whether a card mounts)
        && !/filter\([^)]*prepared === 'draft'/.test(room)
        // …and the predicate has exactly ONE implementation
        && sourceFiles('lib').concat(sourceFiles('components'), sourceFiles('app'))
          .filter((f) => /export function mountsEmailCard\(/.test(read(f) ?? '')).length === 1;
    })());
  {
    // EXERCISED, on the walked row's OWN shape: judged send_file, prepared BY A COWORKER (token
    // "Clara"), carrying a real outgoing draft — the case that was missed.
    const { mountsEmailCard } = require('../lib/room/presentation') as typeof import('../lib/room/presentation');
    const sendFileRow = { href: '/item/c24e47ed', preparedKind: 'email_draft' as const, source: null };
    const replyRow = { href: '/item/abc', preparedKind: 'email_draft' as const, source: 'email' };
    gate('T28.4a a send_file row WITH a draft mounts the card (the walked shape), and so does a plain reply',
      mountsEmailCard(sendFileRow) === true && mountsEmailCard(replyRow) === true);
    gate('T28.4b …and a row whose object the card cannot serve never does (no draft · a commitment · a meeting row)',
      mountsEmailCard({ href: '/item/abc', preparedKind: null, source: null }) === false
      && mountsEmailCard({ href: '/item/abc?kind=commitment', preparedKind: 'email_draft', source: null }) === false
      && mountsEmailCard({ href: '/item/abc?kind=meeting', preparedKind: 'email_draft', source: null }) === false
      && mountsEmailCard({ href: '/item/abc', preparedKind: 'email_draft', source: 'meeting' }) === false);
    gate('T28.4c THE DEED SHAPE IS SERVED, not inferred at the client — the detail route reads the draft body itself',
      (() => {
        const det = read('app/api/entities/[id]/detail/route.ts') ?? '';
        return /const emailDraft = new Set<string>\(\);/.test(det)
          && /typeof \(sd\.draft as \{ body\?: unknown \} \| undefined\)\?\.body === 'string'/.test(det)
          && /preparedKind: emailDraft\.has\(rawId\) \? 'email_draft' as const : null,/.test(det);
      })());
    gate('T28.4d the card’s doors accept BOTH verbs — the draft door names reply AND send_file, and the Send is the SAME route the stage used',
      (() => {
        const draftRoute = read('app/api/inbox/[id]/draft/route.ts') ?? '';
        const card = read('components/home/email-card.tsx') ?? '';
        const detail = read('components/home/item-detail.tsx') ?? '';
        return /cachedWork === 'reply' \|\| cachedWork === 'send_file'/.test(draftRoute)
          && /await fetch\(`\/api\/inbox\/\$\{item!\.id\}\/send-reply`/.test(card)
          && /fetch\(`\/api\/inbox\/\$\{id\}\/send-reply`/.test(detail)
          // the file half of a send_file rides the card's own attach surface
          && /onAttachFile: \(\) => fileInputRef\.current\?\.click\(\)/.test(card)
          && /onAttachFromKb: \(\) => setKbPickerOpen\(true\)/.test(card);
      })());
  }
  gate('T28.4h the card-bearing row LEADS the three-card cap — a CTA can never point at a card the stream declined to render',
    !!room && /const ordered = \[\.\.\.rows\]\.sort\(\(a, b\) => \(boardRowItemId\(a\) === cardRowId \? -1 : boardRowItemId\(b\) === cardRowId \? 1 : 0\)\);/.test(room)
    && /return ordered\.slice\(0, 3\)\.map/.test(room));
  gate('T28.4i ONE DEED CHANNEL — the card announces its send once (announceDeed → DEED_EVENT); the room does not wire a second callback for the same fact',
    !!room && !/<EmailCard[\s\S]{0,200}onSent=/.test(room)
    && /window\.addEventListener\(DEED_EVENT, onPrepared\)/.test(room)
    && (() => { const card = read('components/home/email-card.tsx') ?? ''; return /announceDeed\(\);/.test(card); })());
  // ⚠️ WIDENED (Sep 18, a live data eviction): the one-card fallback answered a move with NO ref and
  // stopped there — a VALIDATED ref whose row had been evicted from the board fell straight past it
  // onto the stage rungs below. Same law, the second way in: with exactly one card of the move's own
  // kind mounted there is nothing to guess.
  gate('T28.4e A MOVE WHOSE CARD THE BOARD CANNOT NAME STILL REACHES ITS ONE CARD (never inert, never the stage) — and code never guesses between two',
    !!rail && /const mountedCards = \(artifacts \?\? \[\]\)\.filter\(\(a\) => !!a\.node\);/.test(rail)
    && /return mountedCards\.length === 1 \? mountedCards\[0\] : null;/.test(rail)
    // the validated-ref branch falls through to the SAME rule instead of dying at a missed match
    && /const ofKind = mountedCards\.filter\(\(a\) => \(stageOfArtifactKey\(a\.key\) === 'reply'\) === moveIsMail\);/.test(rail)
    // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the sole card of the move's kind binds only when it
    // is THIS DOOR'S OWN for that target (lib/room/door.ts cardMayBindTarget — names the target, or
    // carries no id on an item door). The latent guess between members on the entity door is closed.
    && /return ofKind\.length === 1 && cardMayBindTarget\(door, ofKind\[0\], respMoveTargetId\) \? ofKind\[0\] : null;/.test(rail)
    && /const live = \(cardForMove \|\| moveHref \|\| selfTarget \|\| mergedArt\) && moveClick;/.test(rail));
  gate('T28.4j THE FALLBACK NEVER RAISES A REPLY COMPOSER — a mail move with no card goes to the THREAD or SAYS SO; it never asks for a reply stage',
    !!rail && /const moveIsMail = \(respMove\?\.ref \?\? ''\)\.startsWith\('inbox:'\);/.test(rail)
    && (() => {
      const i = rail!.indexOf('const moveClick = resp?.move');
      const seg = rail!.slice(i, i + 2600);
      // the mail branch stands BEFORE the two rungs that end in a stage…
      return seg.indexOf("onStage?.('reply', id)") > 0
        && seg.indexOf('if (moveIsMail) {') < seg.indexOf("onStage?.('reply', id)")
        // …it goes no deeper than the thread…
        && /if \(moveHref && !selfTarget\) \{ go\(moveHref\); return; \}/.test(seg)
        // …and with nowhere to go it speaks, in the room's own ephemeral idiom (never persisted)
        && /pushDealTurn\(roomKey,\s*\n\s*"That prepared work isn't on the board right now/.test(seg)
        && /\{ key: 'move-without-card', ephemeral: true \}\);/.test(seg);
    })());
  gate('T28.4f ONE EDITOR, ONE PLACE — a stage whose item is edited elsewhere raises NO composer, and the card and the overlay can never both stand',
    (() => {
      const det = read('components/home/item-detail.tsx') ?? '';
      return /if \(hideArtifactCards\) return;/.test(det)
        && /const replyCardInStage = embedded && !hideArtifactCards/.test(det)
        && /\{composerOpen && !replyCardInStage && \(/.test(det);
    })());
  gate('T28.4g THE SAME DOOR SHOWS THE SAME VIEW EVERY TIME — a plain focus bumps the signal and lowers the stages (no intent, no raise)',
    !!room && /setStageNonce\(\(n\) => n \+ 1\);\s*\n\s*setInjectedDraft\(null\)/.test(room)
    && (() => {
      const det = read('components/home/item-detail.tsx') ?? '';
      return /if \(!initialStage\) \{ lowerStage\(\); return; \}/.test(det)
        && /\}, \[stageSignal, hideArtifactCards\]\);/.test(det);
    })());
  gate('T28.5 A DEED PRESENTS EXACTLY ONCE — the deep read never grows a second card for the same item',
    !!room && /hideArtifactCards=\{railCoversItem\(rail\?\.move\?\.ref, focused\.id\) \|\| cardRowId === focused\.id\}/.test(room));
  gate('T28.6 an artifact that CARRIES a card is never merged into the pinned card as a sentence',
    !!rail && /mergedArtifactKey\(respMove, \(artifacts \?\? \[\]\)\.filter\(\(a\) => !a\.node\)\)/.test(rail));

  // 2 — THE CTA IS A DOOR TO THE CARD (and the stage is not reachable through it)
  gate('T28.7 the move’s CTA points at the rendered card, BEFORE any stage intent can fire',
    !!rail && /const cardForMove = \(\(\) => \{/.test(rail)
    && /if \(cardForMove\) \{ focusCard\(cardForMove\.key\); return; \}/.test(rail)
    && (() => {
      const i = rail!.indexOf('const moveClick = resp?.move');
      const seg = rail!.slice(i, i + 900);
      return seg.indexOf('focusCard(cardForMove.key)') < seg.indexOf('onStage?.(stageOfArtifactKey');
    })());
  gate('T28.8 the door has a REAL destination — ONE producer for the card’s DOM handle, written by the wrapper, read by the CTA',
    !!rail && /const cardDomId = \(artifactKey: string\) => `aug-card-\$\{artifactKey\}`;/.test(rail)
    && /id=\{cardDomId\(art\.key\)\}/.test(rail)
    && /document\.getElementById\(cardDomId\(key\)\)\?\.scrollIntoView/.test(rail)
    && (rail.match(/`aug-card-/g) ?? []).length === 1);
  gate('T28.9 the same click every time — the door is pure navigation-in-place (no nonce, no stage, no state deciding which view)',
    !!rail && (() => {
      const i = rail!.indexOf('const focusCard = (key: string) => {');
      const seg = rail!.slice(i, i + 460);
      return /setPulseCard\(key\)/.test(seg) && /scrollIntoView/.test(seg)
        && !/setFocus|onStage|router\.push/.test(seg);
    })());

  // 3 — THE ROOM SPEAKS ONCE (the retirements, asserted from the room's side too)
  gate('T28.10 the room carries no chip row and no reopen-delta seat',
    !!rail && !/offerChips/.test(rail) && !/since-you-were-here/.test(rail));

  // 4 — THE NEVER-BLOCKING DOOR IS HONEST
  gate('T28.11 the test is ONE pure, client-safe module — structural, no model, no document vocabulary',
    !!goAhead && /export function askAllowsGoAhead\(/.test(goAhead)
    && !/import /.test(goAhead)
    && !/aiCall|getAIClient|openai|anthropic/i.test(goAhead));
  gate('T28.12 with no context to judge against, the door is ABSENT (never offered on faith)',
    !!goAhead && /if \(!ctx\) return false;/.test(goAhead));
  gate('T28.13 EVERY ask seat consults it — the folded ask, the lifted ask, a coworker’s own ask',
    // RE-POINTED (W3-A, Sep 22 — docs/component-map.md §2a): the three seats now reach the law
    // through the ONE host, which calls it exactly once. So the gate asserts BOTH halves: three
    // seats, one call site. (The old form counted three calls in one file, which was the drift.)
    !!rail && (rail.match(/askCard\(\{ \.\.\./g) ?? []).length === 3
    && !/askAllowsGoAhead\(/.test(rail)
    && !!askHost && (askHost.match(/askAllowsGoAhead\(/g) ?? []).length === 1
    && /const askContext = \(t: Pick<Extract<Turn, \{ role: 'system' \}>, 'refs'>\)/.test(rail));
  gate('T28.14 the context is the WORK’s own names — the ask’s item ref, the room’s move, the item anchor',
    !!rail && (() => {
      const i = rail!.indexOf('const askContext = ');
      const seg = rail!.slice(i, i + 420);
      return /\(t\.refs \?\? \[\]\)\.map\(\(r\) => r\.label\)/.test(seg)
        // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the entity's own next move is the ENTITY
        // door's context only — on an item door it would be a second voice.
        && /resp\?\.move\?\.label \?\? \(inRoom \? ent\?\.nextMove \?\? null : null\)/.test(seg)
        && /view\.anchor\?\.ask \?\? null/.test(seg);
    })());
  // The sweep is scoped to SPEECH — every surface the user reads, plus the room routes that write
  // his own turns. The engine's contract text to a coworker ("THE PRINCIPAL HAS SAID: go ahead…",
  // lib/prepare) is a different register and deliberately untouched: it is an instruction, not a
  // sentence anyone is shown.
  gate('T28.15 the door SAYS what it skips (plain speech, singular/plural), and the old slogan is gone from every surface that SPEAKS',
    !!goAhead && /Go ahead without them →/.test(goAhead) && /Go ahead without it →/.test(goAhead)
    && sourceFiles('components').concat(sourceFiles('app/api/room'))
      .every((f) => !/go ahead with what's available/i.test((read(f) ?? '').replace(/^\s*\/\/.*$/gm, ''))));
  gate('T28.16 the coworker go-ahead is speech a PERSON would say (no engine instruction in the user’s bubble)',
    // RE-POINTED (W3-A, Sep 22): the utterance is composed in the ONE ask host, not at the seat.
    !!askHost && /o ahead without it — use what you have and tell me what’s missing\./.test(askHost)
    && !/work with what I've shared and note any gaps/.test(askHost)
    && (() => {
      const asks = read('app/api/room/asks/route.ts') ?? '';
      return /go\` : 'Go'\} ahead without it — use what you have and tell me what's missing\./.test(asks);
    })());
  // ── THE WALK'S SECOND ROUND (owner-walk evidence, Sep 14): the card mounted HOLLOW, and one
  // button still produced two views. Two root causes, both structural.
  gate('T28.27 THE ROW’S ID FOR A DOOR — served raw, read through ONE producer; no surface strips a prefix at a call site',
    (() => {
      const pres = read('lib/room/presentation.ts') ?? '';
      const det = read('app/api/entities/[id]/detail/route.ts') ?? '';
      const { boardRowItemId } = require('../lib/room/presentation') as typeof import('../lib/room/presentation');
      return /export function boardRowItemId\(/.test(pres)
        // served beside the spine key
        && /\n        rawId,\n/.test(det)
        // …and it does what it says, on the walked row's own shape
        && boardRowItemId({ id: 'inbox:c24e47ed-bb3a-48e3-90ed-a41ff7f66238' }) === 'c24e47ed-bb3a-48e3-90ed-a41ff7f66238'
        && boardRowItemId({ id: 'commit:abc', rawId: 'abc' }) === 'abc'
        && boardRowItemId({ id: 'abc' }) === 'abc'
        // ONE implementation
        && sourceFiles('lib').concat(sourceFiles('components'), sourceFiles('app'))
          .filter((f) => /export function boardRowItemId\(/.test(read(f) ?? '')).length === 1;
    })());
  gate('T28.28 EVERY ROW DEED ADDRESSES THE RAW ROW — the card’s id, the anchor key, and every per-item route in the room',
    !!room && /<EmailCard item=\{\{ id: boardRowItemId\(r\) \}\}/.test(room)
    // ⟲ RE-POINTED (stabilization W2.1, Sep 22): the anchor key is the WRITER's shape (`prep:<spineId>`,
    // lib/prepare/pass.ts) produced by `prepAnchorKey` from the raw row id — `prep:<rawId>` never
    // matched a persisted narration, so every card appended at the stream's end. The raw-row law
    // still holds: the helper is handed boardRowItemId(r).
    && /anchorKey: prepAnchorKey\(.*boardRowItemId\(r\)\)/.test(room)
    && /cardRowId === boardRowItemId\(r\)/.test(room)
    // no per-item route in this room is still handed the spine key
    && !/\/api\/(?:inbox|commitments)\/\$\{w\.id\}/.test(room)
    && !/id: w\.id \}\)/.test(room));
  gate('T28.29 FILLED OR LOADING, NEVER HOLLOW — a card whose doors return nothing says so and points at the thread, instead of renting an empty editor',
    (() => {
      const card = read('components/home/email-card.tsx') ?? '';
      // ⚠️ RE-POINTED (owner walk, Sep 15 — "components take time to load"): the two fill legs no
      // longer join, so the dead-end verdict is decided at the SETTLE seam (when the LAST leg lands)
      // instead of inside a Promise.all. The law is stricter, not weaker: `unfilled` still needs
      // BOTH answers, so a slow thread can never paint "couldn't load" over a draft still arriving.
      return /const \[unfilled, setUnfilled\] = useState\(false\);/.test(card)
        && /const settle = \(\) => \{/.test(card)
        // ⟲ RE-POINTED (W13.2): a draft the one vet HELD BACK is an answer, not a hollow card — the
        // inbox lane prints the withheld line over the open editor (as the compose lane already did).
        && /setUnfilled\(!preparedOut && !heldOut && !\(item\.to\?\.length \|\| threadHasFrom\)\);/.test(card)
        && /if \(!alive \|\| --left > 0\) return;/.test(card)
        && /if \(unfilled && !dirty\) \{/.test(card)
        && /I couldn&apos;t load this draft just now\./.test(card)
        // the loading state still stands in front of it (the third state, now card-shaped — T30.3)
        && /if \(loading\) \{[\s\S]{0,600}animate-pulse/.test(card);
    })());
  gate('T28.30 NO HYDRATION FALLBACK — the room can never raise a reply composer, so one button cannot have two behaviours',
    !!room && /if \(stage === 'reply'\) \{ openHref\(`\/item\/\$\{itemId\}\?kind=email`, false\); return true; \}/.test(room)
    && /THE ROOM NEVER RAISES A REPLY COMPOSER/.test(room)
    // …and the only remaining stage intents are the two whose cards are not in the thread yet
    && /setFocusStage\(stage === 'forward' \? 'forward' : 'invite'\)/.test(room));
  gate('T28.31 THE SHAPE RIDES THE KEY — a room payload’s shape change invalidates every cached envelope (no stale-shape first open)',
    (() => {
      const warm = read('lib/room/warm-room.ts') ?? '';
      return /const ROOM_CACHE_SHAPE = 'v\d+';/.test(warm)
        && /aug-entity-detail-\$\{ROOM_CACHE_SHAPE\}-\$\{entityId\}/.test(warm)
        && /aug-entity-rail-\$\{ROOM_CACHE_SHAPE\}-\$\{entityId\}/.test(warm)
        // still ONE producer per key, imported by both the warm and the mount
        && !!room && /import \{ roomDetailKey, roomRailKey \} from '@\/lib\/room\/warm-room'/.test(room);
    })());

  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): components/home/waiting-on-you.tsx (the Home's
  // global ask band) was already orphaned at HEAD — no surface has mounted it since the threads
  // arc — and the import graph proved it, so it retired. The LAW is not about that band: it is
  // that the go-ahead test has ONE implementation and every ask host asks IT. The live ask host is
  // components/home/input-card.tsx (mounted by the rail AND the deep-dive), so the gate reads
  // there — and adds the class form: NO other UI file may spell the test for itself.
  gate('T28.18 ONE IMPLEMENTATION, EVERY ASK SURFACE — every ask host asks the SAME module (a law with two spellings is the site-list decay class), and the kit decides nothing',
    (() => {
      const host = read('components/home/input-card.tsx') ?? '';
      const cards = read('components/thread/thread-cards.tsx') ?? '';
      const types = read('components/thread/types.ts') ?? '';
      const UIFiles = sourceFiles('components').concat(sourceFiles('app'));
      const spellers = UIFiles.filter((f) => /askAllowsGoAhead\(|goAheadLabel\(/.test(read(f) ?? ''));
      return /from '@\/lib\/room\/go-ahead'/.test(host)
        && /askAllowsGoAhead\(spec\.items, spec\.context\)/.test(host)
        && /goAheadLabel\(spec\.items\)/.test(host)
        // exactly ONE host spells the test; a second speller is the decay this gate exists to catch
        && spellers.length === 1 && spellers[0] === 'components/home/input-card.tsx'
        // the kit renders the door it is GIVEN — the omission is the host's decision, not its own
        && /\{card\.onProceed && \(/.test(cards)
        && /The kit renders the door it is given; it never decides\./.test(types);
    })());
  // ── THE SAME WALK, CONTINUED (owner's four amendments, Sep 14) ─────────────────────────────────
  // 1 · THE OPENING IS A MESSAGE ("this can just look like a message, so remove border and the
  //     'pinned' label") — the seat and the behaviour stand; the frame and the label go.
  gate('T28.19 the pinned opening renders in the ACTOR-BUBBLE grammar — no card frame, no badge anywhere in the kit',
    (() => {
      const tl = read('components/thread/thread-timeline.tsx') ?? '';
      const types = read('components/thread/types.ts') ?? '';
      const i = tl.indexOf('function Pinned({ item }');
      const seg = tl.slice(i, i + 1100);
      return i > 0
        && !/rounded-xl border border-neutral-200\/80 bg-white px-\[18px\]/.test(seg)
        && !/item\.badge/.test(tl)
        && /<AvatarStatus name=\{item\.actorName\} actorId=\{item\.actorId\} size=\{28\}/.test(seg)
        && /<ActionRow actions=\{item\.actions\} \/>/.test(seg)
        // the type no longer carries a badge at all (no corpse), and no caller passes one
        && !/badge\?: string;/.test(types)
        && sourceFiles('components').concat(sourceFiles('app'))
          .every((f) => !/type: 'pinned'[\s\S]{0,200}badge:/.test(read(f) ?? ''));
    })());
  // ⚠️ RE-POINTED (Sep 14): "exempt from the fold" was the second half of this law, and there is no
  // fold any more — the record left the stream (T3.7/T29.5). What survives is the seat itself: the
  // rail pushes the opening FIRST, and the kit renders it as the pinned item.
  gate('T28.20 …and it is still THE PINNED SEAT — pushed first, rendered as the opening',
    !!rail && /type: 'pinned', id: 'brief'/.test(rail)
    && (() => {
      const i = rail!.indexOf('const items: ThreadItem[] = [];');
      const j = rail!.indexOf("type: 'pinned', id: 'brief'");
      // the FIRST push into the timeline is the opening — nothing seats above it
      const firstPush = rail!.indexOf('items.push(', i);
      return i > 0 && j > i && firstPush > 0 && firstPush < j
        && /case 'pinned':/.test(read('components/thread/thread-timeline.tsx') ?? '');
    })());

  // 2 · NEW CHAT STAYS IN THE PROJECT ("new chat should maybe just reset the current project chat,
  //     instead of redirecting to home? … keep a chats tab as well under filed").
  // ⚠️ RE-POINTED AND STRENGTHENED (orchestrator walk, Sep 15, live on a real project: New chat left
  // the reader's own go-ahead bubble standing in an otherwise empty room). The handle boundary was
  // written for ENGINE narrations, CARDS and COWORKER speech — three kinds of SYSTEM record — and it
  // was silently applied to the reader too, making a keyed user utterance immortal. The boundary
  // itself is unchanged and still lives in one place; the gate now says WHICH HALF it governs.
  gate('T28.21 the boundary is STRUCTURAL and lives in ONE place — a SYSTEM turn with a durable handle stays',
    (() => {
      const turns = read('lib/room/turns.ts') ?? '';
      return /export async function archiveRoomChat\(/.test(turns)
        && /\.eq\('role', 'system'\)\s*\n\s*\.is\('dedupe_key', null\)\.is\('component', null\)\.is\('author', null\)/.test(turns)
        && sourceFiles('lib').concat(sourceFiles('app'), sourceFiles('components'))
          .filter((f) => /\.is\('dedupe_key', null\)\.is\('component', null\)/.test(read(f) ?? '')).length === 1;
    })());
  gate('T28.22 the room’s New chat resets IN the room (no Home redirect, no scope hand-off) and the record survives',
    // ⚠️ RE-POINTED (Sep 15): the "no Home redirect" clause was asserted file-wide, and the file
    // now holds a legitimate /home navigation — THE DELETE DOOR, which leaves a project that no
    // longer exists. The law was always about THE RESET, so it is asserted on the reset handler's
    // own body: New chat archives in place and navigates nowhere.
    !!room && /\/api\/room\/turns\?key=\$\{encodeURIComponent\(entityId\)\}&scope=chat`, \{ method: 'DELETE' \}/.test(room)
    && !/aug-new-chat-scope/.test(room)
    && (() => {
      const i = room!.indexOf('&scope=chat`, { method: \'DELETE\' })');
      const seg = room!.slice(i, i + 420);
      return /aug:room-chat-reset/.test(seg) && !/router\.push/.test(seg);
    })()
    && /NEW CHAT STAYS IN THE PROJECT/.test(room)
    && (() => {
      const route = read('app/api/room/turns/route.ts') ?? '';
      return /getStringParam|searchParams\.get\('scope'\) === 'chat'/.test(route)
        && /archiveRoomChat\(supabase, user\.id, key\)/.test(route);
    })());
  gate('T28.23 the conversation clears its LIVE cache AND its stamped envelope (a warm must not re-paint an archived session)',
    !!rail && /addEventListener\('aug:room-chat-reset', onReset\)/.test(rail)
    && (() => {
      const i = rail!.indexOf('const onReset = (ev: Event) => {');
      const seg = rail!.slice(i, i + 900);
      // ⚠️ RE-POINTED AND STRENGTHENED (owner walk, Sep 15: "although it resets…" — an in-flight
      // steer landing after the archive re-populated the emptied stream). The clearing clauses are
      // untouched; what is added is the ORDER that makes them stick — the reset generation moves
      // BEFORE anything is cleared, so a response already in flight is stale from that instant.
      const bumpAt = seg.indexOf('bumpGen(roomKey)');
      const clearAt = seg.indexOf('_dealTurns.set(roomKey, [])');
      return bumpAt > 0 && clearAt > bumpAt
        && /saveLS\(roomTurnsKey\(roomKey\), \{ turns: \[\] \}\)/.test(seg)
        && /setTurnsNonce/.test(seg);
    })());
  gate('T28.24 the saved sessions are LISTED and READ under Filed → Conversations, through the SAME door that archived them',
    !!room && /<ChatSessionRows\s/.test(room)
    && /roomKey=\{entityId\} sessions=\{chatSessions\}/.test(room)
    && /\/api\/room\/turns\?key=\$\{encodeURIComponent\(entityId\)\}&sessions=1/.test(room)
    && /&session=\$\{encodeURIComponent\(at\)\}/.test(room)
    // THE SUM LAW: the tab counts exactly what it lists
    && /label: `Conversations · \$\{\(d\.conversations \?\? \[\]\)\.length \+ chatSessions\.length\}`/.test(room));

  // 2b · A SAVED CHAT IS RESUMABLE, NOT A TRANSCRIPT (owner walk, Sep 14: "shouldn't clicking on
  //      saved chats open the actual chat? and allow to resume from there?").
  //      ⚠️ RE-POINTED, not weakened: T28.24's old "inventory only" clause said a drawer never
  //      re-enters a past session. The owner's word changed the law — a room holds ONE live chat and
  //      "saved" is a boundary, not a demotion — so the seat moves here, with the atomicity and the
  //      durable-handle exclusion the new deed needs.
  gate('T28.32 the RESTORE DOOR exists in the one turns module, SAVES the live exchange first, and never resurrects a durable handle',
    (() => {
      const turns = read('lib/room/turns.ts') ?? '';
      const i = turns.indexOf('export async function restoreRoomSession(');
      if (i < 0) return false;
      const seg = turns.slice(i, i + 2200);   // widened Sep 15: the mirror carries two passes now
      // save-then-restore, in that order, through the ONE boundary module
      const saveAt = seg.indexOf('archiveRoomChat(client, userId, roomKey)');
      const restoreAt = seg.indexOf("archived_at: null");
      return saveAt > 0 && restoreAt > saveAt
        && /\.eq\('archived_at', sessionId\)/.test(seg)
        // the exchange only: an engine ask/card/attributed turn can never come back to live
        && /\.is\('dedupe_key', null\)\.is\('component', null\)\.is\('author', null\)/.test(seg)
        // ⚠️ ADDED (Sep 15): archive and restore filter by the SAME rule, both halves — a mirror
        // that dropped the user half would resume half a conversation.
        && /\.eq\('role', 'user'\)/.test(seg) && /\.eq\('role', 'system'\)/.test(seg);
    })());
  gate('T28.33 the resume rides ONE authed door (PATCH ?key&session) — no second restore implementation',
    (() => {
      const route = read('app/api/room/turns/route.ts') ?? '';
      return /export async function PATCH\(/.test(route)
        && /restoreRoomSession\(supabase, user\.id, key, session\)/.test(route)
        && /searchParams\.get\('session'\)/.test(route)
        // TWO DEEDS, NEVER TWO SPELLINGS OF ONE. Un-archiving happens in exactly two places and they
        // answer different questions: RESUME swaps one chat session (turns.ts, chat-shaped turns
        // only) and UNDO-A-DELETE brings a deleted chat room back whole, cards included
        // (app/api/rooms/restore). Anything else un-archiving — and any client doing it itself — is
        // a third spelling and fails here.
        && sourceFiles('lib').concat(sourceFiles('app'), sourceFiles('components'))
          .filter((f) => /archived_at: null/.test(read(f) ?? ''))
          .every((f) => f.endsWith('lib/room/turns.ts') || f.endsWith('app/api/rooms/restore/route.ts'))
        && sourceFiles('lib').filter((f) => /archived_at: null/.test(read(f) ?? '')).length === 1
        && sourceFiles('components').filter((f) => /archived_at: null/.test(read(f) ?? '')).length === 0;
    })());
  gate('T28.34 the saved-chat row RESUMES (and the peek stays) — the live conversation swaps and the drawer gets out of the way',
    !!room && (() => {
      const i = room!.indexOf('function ChatSessionRows(');
      const seg = room!.slice(i, i + 3200);
      const resumes = /method: 'PATCH'/.test(seg) && /onResume\(\)/.test(seg)
        && /Resuming…/.test(seg) && /void toggle\(sn\.at\)/.test(seg);   // read-only peek survives
      // the host: ONE echo for "the live session changed" (the same one New chat fires), the session
      // list re-reads because the swap saved the outgoing exchange, and the drawer closes.
      const j = room!.indexOf('onResume={() => {');
      const host = room!.slice(j, j + 420);
      return resumes && j > 0
        && /aug:room-chat-reset/.test(host) && /setChatSessionsNonce/.test(host) && /setDrawerOpen\(false\)/.test(host);
    })());

  // 3 · THE DRAWER IS THE READER'S TO SIZE
  // ⚠️ RE-POINTED (Sep 14, same day): the width law moved INTO the one drawer, so BOTH doors got it
  // — which is the whole point of the extraction. One key, one clamp, stated once.
  gate('T28.25 the Filed drawer is wider by default, drag-resized from its own edge, clamped and persisted (the Gantt idiom) — for EVERY door',
    !!drawer && /const FILED_W_KEY = 'aug-filed-w';/.test(drawer)
    // ⚠️ RE-POINTED (owner walk, Sep 15: the pane opens at its widest by default). The clamp, the
    // one key and the persistence are UNCHANGED — only the pre-preference width moved, and it is
    // now DERIVED from the max rather than restated as a second number that could drift from it.
    && /const FILED_W_DEFAULT = FILED_W_MAX;/.test(drawer)
    && /const FILED_W_MAX = 720;/.test(drawer)
    && /export const clampFiledW = \(w: number\) => Math\.max\(FILED_W_MIN, Math\.min\(FILED_W_MAX, Math\.round\(w\)\)\);/.test(drawer)
    && /style=\{\{ maxWidth: filedW \}\}/.test(drawer)
    && /cursor-col-resize/.test(drawer)
    && /saveLS\(FILED_W_KEY, w\)/.test(drawer)
    // ONE spelling of the key in the whole tree
    && sourceFiles('components').concat(sourceFiles('lib'), sourceFiles('app'))
      .filter((f) => /'aug-filed-w'/.test(read(f) ?? '')).length === 1);

  // 4 · THE DEED ANSWERS IN THE SAME FRAME
  gate('T28.26 Mark done and ✕ paint immediately and ROLL BACK on failure (an optimistic render is never a false receipt)',
    !!room && /const \[settling, setSettling\] = useState<Set<string>>\(new Set\(\)\);/.test(room)
    && /const \[detached, setDetached\] = useState<Set<string>>\(new Set\(\)\);/.test(room)
    && /if \(res\?\.ok\) onRefresh\(\);\s*\n\s*else \{ mark\(setSettling, w\.id, false\); toast\(/.test(room)
    && /catch \{ mark\(setDetached, w\.id, false\); toast\(/.test(room)
    // the row SHOWS it: struck, faded, and no longer clickable
    && /settled \? 'opacity-50'/.test(room) && /line-through decoration-neutral-300/.test(room)
    && /onClick=\{settled \? undefined : onDone\} disabled=\{settled\}/.test(room)
    // …and the write's outcome can actually reach the row (the swallowed catch is gone)
    && /if \(!res\.ok\) throw new Error\('membership write failed'\);/.test(room));

  gate('T28.17 A FAILURE IS NOT HISTORY — a failed deed renders its apology and never persists it',
    !!rail && (() => {
      const i = rail!.indexOf('const send = async (raw: string)');
      const seg = rail!.slice(i, i + 2400);
      // no durable write on either failure path of the one send door…
      return !/addTurn\(\{ role: 'system', text: d\.error/.test(seg)
        && /setTurns\(\(prev\) => \[\.\.\.prev, \{ role: 'system', text: d\.error \|\| "That didn't go through/.test(seg);
    })()
    // …and the engine proceed answers instead of dying silently.
    // RE-POINTED (W3-A, Sep 22): the proceed door moved into the ONE ask host, and its apology moved
    // with it — onto the CARD, which is strictly better than a system turn: the card is render-only
    // by construction, so a failure now CANNOT persist into the room's record.
    && !!askHost && /setError\('That didn’t go through — try it again in a moment\.'\)/.test(askHost)
    && !/addTurn/.test(askHost) && !/persistTurn/.test(askHost));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T29 · THE PARITY CONSOLIDATION (owner, Sep 14: "not sure you're walking the changes through
// projects AND single loose task items AND adhoc prompts — all changes should be applied across the
// board… the component is different across projects, loose items… now we're screwed as you have to
// double or triple the maintenance work. very sloppy.")
//
// He is right, and the answer is structural, not a promise to be careful: a law that must hold at
// two doors LIVES ONCE. This section is the standing guard on that — it asserts the COUNT of
// implementations, not the behaviour of one of them (the behaviour gates above already do that at
// the single seat each law now occupies). A second spelling appearing anywhere fails here.
//
//   1 · THE DRAWER      one component, mounted by both doors, zero lookalikes
//   2 · THE AGENDA      pinned-seat folding + the CTA law live in the shared rail only
//   3 · THE RECORD      history left the stream at both doors; the drawer files it at both
//   4 · THE CARD DOOR   "Thread →" renders wherever a card answers a real thread
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  console.log('\nT29 · THE PARITY CONSOLIDATION — one law, one implementation, every door');
  const rail = read('components/home/item-rail.tsx');
  const room = read('components/entities/entity-room.tsx');
  const detail = read('components/home/item-detail.tsx');
  const drawer = read('components/room/filed-drawer.tsx');
  const card = read('components/home/email-card.tsx');
  const timeline = read('components/thread/thread-timeline.tsx');
  const ALL = sourceFiles('components').concat(sourceFiles('app'));

  // 1 · THE DRAWER
  gate('T29.1 THE FILED DRAWER IS ONE COMPONENT — and it is the only one in the tree',
    !!drawer && /export function FiledDrawer\(/.test(drawer)
    && ALL.filter((f) => /export function FiledDrawer\(/.test(read(f) ?? '')).length === 1
    // the pane's own marks exist exactly once (no lookalike kept its markup)
    && ALL.filter((f) => /aug-drawer absolute top-0 right-0/.test(read(f) ?? '')).length === 1
    // ⚠️ RE-POINTED (Sep 15): the pane's title reads "<work> — Details" now, and the NAME is a
    // single exported constant, so "exactly one pane" is asserted on the constant's one home.
    && ALL.filter((f) => /export const FILED_LABEL = /.test(read(f) ?? '')).length === 1
    && ALL.filter((f) => /— \{FILED_LABEL\}<\/span>/.test(read(f) ?? '')).length === 1);
  gate('T29.2 BOTH DOORS MOUNT IT — the project room and the loose item room, with sections as DATA',
    !!room && /<FiledDrawer$/m.test(room) && /sections=\{\(\[/.test(room)
    && !!detail && /<FiledDrawer$/m.test(detail) && /sections=\{tabs\}/.test(detail)
    // …and neither door keeps a tab state, an escape handler or a drag of its own any more
    && !/const \[rightTab, setRightTab\]/.test(room)
    && !/ev\.key === 'Escape'\) setDrawerOpen\(false\)/.test(room)
    && !/ev\.key === 'Escape'\) setDrawerOpen\(false\)/.test(detail)
    && !/clampFiledW/.test(room) && !/clampFiledW/.test(detail));
  gate('T29.3 KIND VARIANCE IS DATA — no door branch inside the pane itself',
    !!drawer && !/kind ===/.test(drawer) && !/'project'/.test(drawer) && !/'item'/.test(drawer)
    && /sections: FiledSection\[\];/.test(drawer));

  // 2 · THE AGENDA — one rail, so one seam; the gate is that no door forked it.
  gate('T29.4 THE AGENDA LAWS LIVE IN THE SHARED RAIL ONLY (both doors mount it; neither re-implements it)',
    !!rail && /const pinnedSpeaks = /.test(rail) && /const foldedAsk = pinnedSpeaks/.test(rail)
    && ALL.filter((f) => /const foldedAsk = /.test(read(f) ?? '')).length === 1
    // RE-POINTED (W4-A, Sep 22): the pinned seat's ONE deed is the `proposal` card now — the law
    // is unchanged (exactly one implementation of it, in the shared rail).
    && ALL.filter((f) => /const moveCard: ThreadCard \| null = /.test(read(f) ?? '')).length === 1
    && !!room && /<ItemRail kind="entity"/.test(room)
    && !!detail && /<ItemRail kind="email"/.test(detail));

  // 3 · THE RECORD
  gate('T29.5 THE "earlier" HANDLE EXISTS NOWHERE — not in the kit, not at either door',
    !!timeline && !/setExpanded/.test(timeline) && !/foldIndex/.test(timeline)
    && ALL.every((f) => !/earlier \(\$\{/.test(read(f) ?? '') && !/variant: 'fold'/.test(read(f) ?? '')
      && !/id: 'fold'/.test(read(f) ?? '')));
  gate('T29.6 THE RECORD IS FILED, ONCE — one reporter, one renderer, a section at both doors',
    !!rail && /onHistory\?: \(lines: RoomHistoryLine\[\]\) => void;/.test(rail)
    && !!drawer && /export function RoomHistorySection\(/.test(drawer)
    && ALL.filter((f) => /export function RoomHistorySection\(/.test(read(f) ?? '')).length === 1
    // the project door files it…
    && !!room && /onHistory=\{setHistoryLines\}/.test(room)
    && /id: 'record', icon: \w+, label: `History · \$\{historyLines\.length\}`/.test(room)
    // …and every kind of the loose door does, through the ONE assembler
    && !!detail && (detail.match(/onHistory=\{setHistoryLines\}/g) ?? []).length === 4
    && /tabs\.push\(\{ id: 'record', label: `History · \$\{hist\.length\}`/.test(detail));

  // 4 · THE CARD'S OWN DOOR
  gate('T29.7 "Thread →" IS STRUCTURAL — the item lane always has a door, host-supplied or its own address',
    !!card && /const openThread = onOpenThread \?\? \(item \? \(\) => router\.push\(`\/item\/\$\{item\.id\}\?kind=email`\) : undefined\);/.test(card)
    && /\.\.\.\(openThread \? \{ onOpenThread: openThread, threadLabel: 'Thread →' \} : \{\}\)/.test(card)
    // the unfillable state points at the thread through the same derivation
    && /\{openThread && \(/.test(card)
    // and both room mounts still hand it the door they own
    && !!room && /<EmailCard item=\{\{ id: boardRowItemId\(r\) \}\} onOpenThread=/.test(room)
    && !!detail && /onOpenThread=\{\(\) => openDrawerAt\('thread'\)\}/.test(detail));

  // …AND IT IS ALWAYS IN VIEW (owner walk, Sep 14: "where is the option to open email thread?" +
  // "these are not scrollable sideways"). Four reasoned directions overflow a 560px card; seated
  // inside the same flex row, the door was the first thing pushed off the edge. The strip scrolls in
  // its own container (the wide-content law) and the door sits OUTSIDE it — structural, not a
  // width guess.
  gate('T29.8 THE TAB ROW SCROLLS IN ITS OWN CONTAINER AND THE DOOR IS PINNED OUTSIDE IT',
    (() => {
      const cards = read('components/thread/thread-cards.tsx') ?? '';
      const i = cards.indexOf('{(variantCount > 0 || card.onOpenThread) && (');
      if (i < 0) return false;
      const seg = cards.slice(i, i + 2600);
      const stripAt = seg.indexOf('overflow-x-auto');
      const doorAt = seg.indexOf('card.onOpenThread && (');
      const closeAt = seg.indexOf('</div>');   // the scroll container closes BEFORE the door
      return stripAt > 0 && doorAt > 0 && closeAt > stripAt && closeAt < doorAt
        // no scrollbar chrome, no bounce onto the page (the inbox top bar's own idiom)
        && /\[&::-webkit-scrollbar\]:hidden/.test(seg) && /overscroll-x-contain/.test(seg)
        // the fades are honest — measured, per side, never painted over a row that fits
        && /const measureStrip = /.test(cards) && /left: over && el\.scrollLeft > 1/.test(cards)
        && /stripMask/.test(seg);
    })());

  // ── THE HOME'S VISUAL LAYER (owner walk, Sep 15) ───────────────────────────────────────────────
  // Three corrections, each a law rather than a screenshot fix.
  const mark15 = read('components/home/alive-mark.tsx') ?? '';
  const home15 = read('components/home/home-view.tsx') ?? '';
  const row15 = read('components/work/work-row.tsx') ?? '';

  // 1 · THE ORB IS ALIVE, NOT A DISCO BALL.
  //
  // RE-POINTED Sep 18 (owner walk: "feels like a disco ball… I just want something that feels or
  // conveys 'it's alive'"). The Sep 15 reading held "a neural MESH, not a plasma ball" — and a
  // lat/long wireframe with a scatter of glinting dots turned out to be the third thing: a mirror
  // ball. The law underneath it never changed and is asserted UNWEAKENED below (the morph is the
  // motion, the frame path allocates nothing, every gradient is built once outside it); what moved
  // is WHICH FORM satisfies it. v4 is a soft-bodied luminous form — a noise-displaced silhouette
  // under layered, additively-composited light — and it is the DEFAULT. v3 survives whole, behind
  // an explicit variant, because a reverted owner call should cost one word.
  const v4 = mark15.slice(mark15.indexOf('export function makeSoftBodyDraw('), mark15.indexOf('v3 · THE MESH SPHERE'));
  // The seated painter's own slice — T29.9a asserts the DEFAULT carries no mesh, so it has to read
  // the renderer the default actually names, not the one it used to name.
  const eyesPainter = (() => {
    const from = mark15.indexOf('function makeEyesDraw(');
    return from < 0 ? '' : mark15.slice(from, from + 9000);
  })();
  gate('T29.9 THE ORB IS ALIVE, NOT A DISCO BALL — a morphing soft body, layered light, zero-alloc',
    v4.length > 500
    // THE MORPH IS THE MOTION — the silhouette is displaced by the noise field, sampled on the
    // circle (seamless at the wrap), on THREE octaves. Nothing rotates: there is no rotation term.
    && /const SAMPLES = /.test(mark15) && /const SIL_C = new Float32Array\(SAMPLES\);/.test(mark15)
    && (v4.match(/vnoise\(/g) || []).length >= 4
    && !/\brot\b|Math\.cos\(rot\)/.test(v4)
    // …and the per-frame scratch is preallocated at module scope — zero allocation in the loop
    && /const SIL_X = new Float32Array\(SAMPLES\);/.test(mark15)
    // THE LIGHT IS LAYERED — a feathered body, aurora fields and a core, composited ADDITIVELY,
    // with every gradient built ONCE, outside the frame path (the drift is a transform, not a
    // new gradient).
    && /createRadialGradient/.test(v4)
    && v4.lastIndexOf('createRadialGradient') < v4.indexOf('return function drawSoftBody(')
    && /globalCompositeOperation = 'lighter'/.test(v4)
    && /ctx\.setTransform\(dpr, 0, 0, dpr, x \* dpr, y \* dpr\)/.test(v4)
    // IT BREATHES, and the edge FEATHERS (no rim to catch a highlight on)
    && /BREATH_PERIOD/.test(mark15) && /const breath = Math\.sin\(/.test(v4)
    && /const BLUR_BODY = /.test(v4) && /ctx\.filter = BLUR_BODY;/.test(v4)
    // the plasma ball the mesh replaced is still gone, and so is the mesh's own disco
    && !/conic-gradient/.test(mark15) && !/mix-blend-screen/.test(mark15));

  // 1b · THE DISCO IS UNREACHABLE WITHOUT ASKING FOR IT. Nothing lat/long, nothing dot-gridded, no
  // stroked wireframe survives in the v4 path — the geometry is not toned down, it is absent — and
  // the product seat never names the old variant.
  // RE-POINTED (Sep 20): the owner picked 'eyes' from the harness, so the DEFAULT moved. The law
  // this gate protects never did — the disco stays unreachable without asking for it, and the
  // seated renderer carries none of the mesh's geometry. Asserting the default is the OWNER'S PICK
  // (not a particular renderer forever) is the version of this gate that survives the next call.
  gate('T29.9a THE SEATED MARK CARRIES NO DISCO — the default is the owner\'s pick, and no mesh, nodes, halo specks or strokes ride with it',
    /variant = 'eyes'/.test(mark15)
    && !/RINGS|EDGES|NODE_IDX|ctx\.stroke\(\)/.test(eyesPainter)
    && /variant === 'v3' \? makeMeshDraw\(ctx, size\) : makeSoftBodyDraw\(ctx, size, dpr\)/.test(mark15)
    // the v4 painter touches NONE of the mesh's tables and strokes nothing
    && !/RINGS|EDGES|NODE_IDX|BUCKET_ALPHA|NODE_ALPHA|HALO_ALPHA|TILT_C/.test(v4)
    && !/ctx\.stroke\(\)|strokeStyle|lineWidth/.test(v4)
    // …and no product surface asks for v3 (the dev harness is the only place both are mounted)
    && !/variant="v3"|variant: 'v3'/.test(read('components/home/orb-entrance.tsx') ?? '')
    && !/variant="v3"/.test(home15)
    // RE-POINTED AGAIN (Sep 21): the comparison is over, so the dev harness no longer mounts the
    // candidates at all. The law is now stronger and simpler — the SEATED DEFAULT IS THE ONLY
    // RENDERER MOUNTED ANYWHERE: no file under app/ or components/ (alive-mark.tsx excepted, it
    // owns them) passes `variant=` to AliveMark or names 'v3'/'v4'/'v5' as a variant.
    && (() => {
      const offenders = [...sourceFiles('app'), ...sourceFiles('components')]
        .filter((f) => f !== path.join('components', 'home', 'alive-mark.tsx'))
        .filter((f) => {
          const src = read(f) ?? '';
          if (!/AliveMark/.test(src)) return false;
          // a mounted variant in any spelling: variant="v5" / variant={'v4'} / v: 'v3' as const
          return /variant\s*=\s*\{?\s*['"](v3|v4|v5)['"]|['"](v3|v4|v5)['"]\s+as const|variant=\{/.test(src);
        });
      return offenders.length === 0;
    })());

  // 1c · THE PERF CLAIM IS A MEASURED NUMBER, NOT A HOPE. The file's own budget comment carries the
  // figure and the method, so the next renderer is argued against a number rather than a feeling.
  gate('T29.9b THE LOOP BUDGET IS STATED AND MEASURED — draw calls, ms/frame, and how it was timed',
    /THE LOOP BUDGET/.test(mark15)
    // A NUMBER, not a feeling — and the method beside it, so it can be re-measured. The digits are
    // evidence, never the law, so the gate demands a stated measurement rather than one value.
    && /MEASURED JS COST: 0\.\d+ ms\/frame/.test(mark15)
    && /MEASURED 0\.\d+ ms\/frame/.test(mark15)
    && /recording stub/.test(mark15) && /scripts\/tmp-mark-perf\.ts/.test(mark15)
    && /TEN draw calls per frame/.test(mark15));

  // 2 · TWO ROWS TALL, ONE COLUMN OF ITS OWN ("orb column 2 rows height") — in BOTH shapes, so the
  // load never reflows into a different header.
  gate('T29.10 THE HEADER IS TWO COLUMNS — the mark spans the date row AND the greeting row',
    // The mark defaults to the two-row height, not the old single-line bullet size. RE-POINTED
    // Sep 15 (owner: "make it slightly bigger as well") 56 → 70 — a size constant is the gate's
    // evidence, never its law, so the anchor follows the number while the guarantee (a default
    // that spans the date row AND the greeting row, never a bullet) is unchanged.
    /size = 70/.test(mark15)
    && (() => {
      const seg = home15.slice(home15.indexOf('function CalmGreeting('), home15.indexOf('/** ONE WHISPERED LINE'));
      // orb column beside a text column holding date OVER greeting, left-aligned to itself
      // RE-POINTED Sep 18 (THE ENTRANCE): the mark's column is now the entrance's SEAT — a
      // fixed-size box the mark never leaves, which is what keeps the two-column geometry honest
      // while the wrapper inside it is transformed out to the centre and back.
      return /flex items-center justify-center gap-4/.test(seg)
        && /<OrbSeat entrance=\{entrance\} loading=\{loading\} \/>\s*\n\s*<div className="flex flex-col gap-1\.5 text-left" style=\{entrance\.veil\(0\)\}>/.test(seg)
        && seg.indexOf('toLocaleDateString') < seg.indexOf('<h1')
        // the old stacked "mark rides the date line" shape is gone
        && !/flex flex-col items-center gap-3\.5 text-center/.test(seg);
    })()
    // …and the SEAT itself is a pinned box of the mark's own size, so nothing it does reflows the
    // header (the skeleton's second copy of this shape is gone — there is only one shape now)
    && (() => {
      const seat = read('components/home/orb-entrance.tsx') ?? '';
      return /export function OrbSeat\(/.test(seat)
        && /style=\{\{ width: size, height: size \}\}/.test(seat)
        && /size = 70/.test(seat);
    })());

  // 3 · THE LOAD IS THE ORB — FINISHED Sep 18 ("we're missing smooth animation/transition of the
  // orb when home is loading. ideally orb only centered shapeshifting and then when home is loaded,
  // transits into place — not instant new-page-load style").
  //
  // RE-POINTED from the skeleton it used to assert. The Sep 15 reading held "one orb, two moments,
  // no ghost of a retired element"; the second moment was a SECOND TREE, and swapping trees is the
  // cut the owner then named. The law is now the stronger one it was always reaching for: ONE ORB,
  // ONE MOUNT, ONE LAYOUT — the cold Home is the page itself, veiled, with the mark transformed out
  // to the centre of its own column and flown back by a measured FLIP when the brief lands. The
  // mark's own energy easing survives untouched: it still runs energetic while `loading` and lerps
  // to rest on landing, which is what makes the arrival settle rather than stop.
  gate('T29.11 THE LOAD IS THE ORB — it holds the centre, then flies home; one node, one layout',
    (() => {
      const orb = read('components/home/orb-entrance.tsx') ?? '';
      return /export function useOrbEntrance\(/.test(orb)
        // the centre it holds is LARGER, and it is a transform on the one node — never a resize
        && /const CENTER_SCALE = /.test(orb)
        && /fly\.style\.transform = `translate3d\(/.test(orb)
        // …and the flight is a real FLIP: measured seat rect, animated to identity
        && /seat\.getBoundingClientRect\(\)/.test(orb)
        && /transition = `transform \$\{FLIGHT_MS\}ms \$\{EASE\}`/.test(orb)
        && /fly\.style\.transform = 'translate3d\(0px, 0px, 0\) scale\(1\)';/.test(orb)
        // the skeleton's ghosts (and its whole tree) are gone from the Home
        && !/w-5 h-5 rounded-full bg-neutral-200 animate-pulse/.test(home15)
        && !/if \(loading\) \{\s*\n\s*return \(/.test(home15);
    })()
    // ONE orb: the loading state is a prop on the one mark, and it EASES (a lerp toward a target)
    && /loading = false/.test(mark15) && /loadingRef/.test(mark15)
    && /let carriedEnergy = 0;/.test(mark15)
    && /energy \+= \(target - energy\)/.test(mark15)
    && /carriedEnergy = energy;/.test(mark15)
    // the rows land on the HOUSE motion, never a bespoke pop
    && /<RiseIn delay=\{60\}>/.test(home15));

  // 4 · THE RAIL SPEAKS, WITHOUT COLLISION ("longer labels in front of action buttons in home" — and
  // his screenshot showed the row's own words reading THROUGH the controls). Three structural
  // clauses: the word is permanent, the backing is solid, and the native tooltip dies with it (a
  // title beside a visible label is a second copy of the same word, floating over the row).
  gate('T29.12 THE HOVER RAIL SPEAKS — permanent words, a solid backing, no duplicate tooltip',
    (() => {
      const seg = row15.slice(row15.indexOf('function RowAction('), row15.indexOf('// ── ADD TO PROJECT'));
      return /whitespace-nowrap text-\[11px\] font-medium leading-none/.test(seg)
        // the per-control hover reveal is gone — the word does not wait to be earned
        && !/group\/act/.test(seg) && !/max-w-0/.test(seg)
        // …and so is the tooltip that duplicated it
        && !/title=\{label\}/.test(seg);
    })()
    // ONE implementation, so both seats inherit: no other row control keeps a title-only glyph
    && !/title="Mark done"/.test(row15) && !/title="Dismiss"/.test(row15)
    // THE SOLID BACKING — the gradient is only the leading edge, the controls sit on the row's colour
    && /const RAIL_BG = \{/.test(row15)
    && /<span className=\{`w-12 bg-gradient-to-r from-transparent \$\{to\}`\} \/>/.test(row15)
    && /\$\{solid\} pointer-events-none group-hover:pointer-events-auto/.test(row15)
    // the whisper seat inherits it untouched (one rail, no private backing)
    && /<RowHoverRail>/.test(home15));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T30 — THE ROOM, OWNER WALK Sep 15 (part B): the reset that stuck, the CoS who opens, the card
// that loads honestly, the pane people can name, and the one deed that had no door.
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  const rail30 = read('components/home/item-rail.tsx');
  const room30 = read('components/entities/entity-room.tsx');
  const card30 = read('components/home/email-card.tsx');
  const drawer30 = read('components/room/filed-drawer.tsx');
  const route30 = read('app/api/entities/[id]/route.ts');

  // 1 · THE RESET GENERATION — a response from before the reset is never believed.
  gate('T30.1 THE RESET GENERATION — the room carries one, every turn-producing op captures it, and a stale landing renders nothing and persists nothing',
    !!rail30 && /const _resetGen = new Map<string, number>\(\);/.test(rail30)
    && /const genOf = \(roomKey: string\): number =>/.test(rail30)
    && /const bumpGen = \(roomKey: string\): void =>/.test(rail30)
    && /const stale = \(gen: number\) => genOf\(roomKey\) !== gen;/.test(rail30)
    // captured at the START of every async op that can produce a turn…
    && (rail30.match(/const gen = genOf\(roomKey\);/g) ?? []).length >= 4
    // …and checked at every landing (never a single guarded seam)
    && (rail30.match(/if \(stale\(gen\)\) \{ dropStale\(\);/g) ?? []).length >= 5
    // exactly one generation store in the tree — a second one is a second truth about "now"
    && sourceFiles('components').concat(sourceFiles('lib'), sourceFiles('app'))
      .filter((f) => /const _resetGen = new Map/.test(read(f) ?? '')).length === 1);
  gate('T30.2 THE DROPPED OP SWEEPS — a durable write that raced the archive is filed through THE SAME door the reset used, never a second mechanism',
    !!rail30 && (() => {
      const i = rail30.indexOf('const dropStale = ()');
      if (i < 0) return false;
      const seg = rail30.slice(i, i + 460);
      return /\/api\/room\/turns\?key=\$\{encodeURIComponent\(roomKey\)\}&scope=chat`, \{ method: 'DELETE' \}/.test(seg)
        && /setTurnsNonce/.test(seg);
    })());

  // 2 · THE CoS OPENS — derived, never restating the pinned card, ephemeral until answered.
  gate('T30.3 THE CoS OPENS — a room with no word of the reader’s leads with the seat’s own line, DERIVED from served state (zero AI) and never a second composed voice',
    !!rail30 && /const openerText = \(\) => \{|const openerText = \(\(\) => \{/.test(rail30)
    && /if \(turns\.some\(\(t\) => t\.role === 'user'\)\) return null;/.test(rail30)
    // it wears the seat, in the seat's own bubble grammar
    && /type: 'actor_bubble', id: 'opener', actorId: seatId, actorName: seatName/.test(rail30)
    // …and it makes NO model call of its own: no fetch, no cache key, no signature in its derivation
    && (() => {
      const i = rail30.indexOf('const openerText =');
      const seg = rail30.slice(i, rail30.indexOf('const openerRef'));
      return i > 0 && !/fetch\(/.test(seg) && !/await /.test(seg);
    })());
  gate('T30.3b A ROOM WITH A RECORD IS NEVER GREETED AS A NEW ONE — "Fresh start" is reserved for a room with no past at all',
    !!rail30 && (() => {
      const i = rail30.indexOf('const openerText =');
      const seg = rail30.slice(i, rail30.indexOf('const openerRef'));
      return i > 0
        // the record is DERIVED from what the room already holds — no second fetch, no new fact
        // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the brief watermark is the DOOR's own opening's
        // (`opening.at` — the entity's on the entity door, the item's on an item door).
        && /const hasRecord = !!pinned \|\| !!opening\.at \|\| !!sum \|\| turns\.length > 0;/.test(seg)
        // …both branches exist, and the fresh one is the ELSE
        && /Picking \$\{name\} back up — what do you want to look at\?/.test(seg)
        && /Fresh start on \$\{name\}\. What do you want to pick up\?/.test(seg)
        // …the fresh wording is the ELSE of the record test, not the default
        && /const invite = hasRecord\s*\n\s*\? \(name \? `Picking/.test(seg)
        // one wording, one seat: the no-brief return goes through the derived invite
        // (RE-POINTED Sep 19 — THE OPENING CONTRACT clause 5 moved the PINNED branch off `invite`
        // entirely; see T30.3c below. The record law this gate exists for is unchanged.)
        && /return name \? invite : null;/.test(seg)
        && !/return name \? `Fresh start/.test(seg);
    })());
  // THE OPENING CONTRACT, clause 5 (owner walk, Sep 19): "Fresh start on X" / "Picking X back up"
  // standing under a pinned brief is the room naming its own subject twice, in two bubbles.
  gate('T30.3c THE OPENER NEVER STANDS AS A SECOND GREETER — with a brief pinned it is PURELY the invitation, and under a brief that already asks something it does not render at all',
    !!rail30 && (() => {
      const i = rail30.indexOf('const openerText =');
      const seg = rail30.slice(i, rail30.indexOf('const openerRef'));
      return i > 0
        // the pinned branch carries NO preamble and NO subject — just the forward question
        && /if \(pinned\) return \/\\\?\\s\*\$\/\.test\(pinned\.trim\(\)\) \? null : 'What do you want to pick up\?';/.test(seg)
        // …and it is still derived, with no second composed voice behind it
        && !/fetch\(/.test(seg) && !/await /.test(seg)
        // the preamble wordings survive ONLY for the no-brief case they were written for
        && /Picking \$\{name\} back up/.test(seg) && /Fresh start on \$\{name\}/.test(seg);
    })());
  gate('T30.4 THE OPENER IS EPHEMERAL UNTIL ANSWERED — it is written exactly once, by the reply that answers it, so N resets can never stack N greetings',
    !!rail30 && /const openerRef = useRef<string \| null>\(null\);/.test(rail30)
    && (() => {
      const i = rail30.indexOf('if (openerRef.current) {');
      if (i < 0) return false;
      const seg = rail30.slice(i, i + 620);
      // claimed before the write (so a double-send cannot double-persist), then persisted ONCE
      return seg.indexOf('openerRef.current = null;') < seg.indexOf("method: 'POST'")
        && /role: 'system', text: o/.test(seg);
    })()
    // the ONLY place it persists — the render never writes it
    && (rail30.match(/openerRef\.current = null;/g) ?? []).length === 1);

  // 3 · THE CARD LOADS IN ITS OWN SHAPE.
  gate('T30.5 THE LOADING STATE IS THE CARD’S SHAPE — tab row, to-row, body lines and commit row, never a bare pill',
    !!card30 && (() => {
      const i = card30.indexOf('if (loading) {');
      if (i < 0) return false;
      const seg = card30.slice(i, i + 2200);
      return /aria-busy="true"/.test(seg)
        && /the direction tabs/.test(seg) && /the to-row/.test(seg)
        && /the body/.test(seg) && /the commit row/.test(seg)
        // the old bare pill is gone
        && !/<div className="h-28 animate-pulse rounded-lg bg-neutral-100" \/>/.test(card30);
    })());
  gate('T30.6 TWO LEGS, NOT ONE WAIT — the draft and the thread land independently, and the body’s arrival alone clears the skeleton',
    !!card30 && (() => {
      const i = card30.indexOf('let preparedOut =');
      if (i < 0) return false;
      const seg = card30.slice(i, i + 2000);
      // the join is gone from the fill effect…
      return !/Promise\.all\(\[\s*\n\s*fetch\(`\/api\/inbox\/\$\{item\.id\}\/draft`/.test(card30)
        // …the draft leg clears loading on its own…
        && /setLoading\(false\);\s*\n\s*settle\(\);/.test(seg)
        // …and the thread leg fills to/subject without gating the paint
        && /if \(!item\.to\?\.length && t\.fromAddress\) setTo\(\[String\(t\.fromAddress\)\]\);/.test(seg);
    })());

  // 4 · THE PANE PEOPLE CAN NAME + THE ICONS.
  gate('T30.7 ONE NAME FOR THE PANE — "Details" is an exported constant, both doors and the title import it, and the word "Filed" labels nothing on screen',
    !!drawer30 && /export const FILED_LABEL = 'Details';/.test(drawer30)
    && /aria-label=\{`\$\{title\} — \$\{FILED_LABEL\}`\}/.test(drawer30)
    // no surface hardcodes the old word as a label any more
    && sourceFiles('components').concat(sourceFiles('app'))
      .filter((f) => /<FiledIcon \/>Filed[^_A-Za-z]/.test(read(f) ?? '')).length === 0
    && sourceFiles('components').filter((f) => /Filed — \{/.test(read(f) ?? '')).length === 0);
  gate('T30.8 THE SECTIONS WEAR ICONS — the type carries an optional mark, the kit leads the label with it, and every project section supplies one',
    !!drawer30 && /icon\?: React\.ComponentType<\{ className\?: string \}>/.test(drawer30)
    && !!room30
    && ["id: 'work', icon:", "id: 'schedule', icon:", "id: 'meetings', icon:",
      "id: 'conv', icon:", "id: 'files', icon:", "id: 'history', icon:", "id: 'record', icon:"]
      .every((t) => room30.includes(t)));

  // 5 · THE ⋯ MENU SIMPLIFIES, AND GAINS THE ONE DEED THAT HAD NO DOOR.
  gate('T30.9 THE MENU CARRIES THE LIFECYCLE, THE CATEGORY AND THE DELETE — and the three rows the owner named are gone',
    !!room30
    // the rows themselves — asserted on the RENDER (a label sits between an icon and the tag's
    // close), so the retirement note that names them in prose is not mistaken for the row
    && !/\/>Not a project</.test(room30)
    && !/\/>Share a status update</.test(room30)
    && !/\/>Add a goal or rule</.test(room30)
    && !/setIntentOpen\(true\)/.test(room30) && !/setStatusShare\(true\)/.test(room30)
    // what stays
    && /Mark done<\/button>/.test(room30) && /Archive<\/button>/.test(room30)
    && /ENTITY_CATEGORIES\.map/.test(room30)
    && /Delete project…/.test(room30));
  gate('T30.10 THE IRREVERSIBLE VERB ASKS FIRST — a confirm dialog that names what dies AND what survives, says there is no undo, and only then fires',
    !!room30 && /const \[confirmDelete, setConfirmDelete\] = useState\(false\);/.test(room30)
    && /Deletes this project for you: its context, chats, briefs and links\./.test(room30)
    && /The emails and\s*\n?\s*meetings themselves stay in your account, unlinked\./.test(room30)
    && /This can’t be undone\./.test(room30)
    // the menu row raises the dialog; only the dialog's own button calls the door
    && /setConfirmDelete\(true\)/.test(room30)
    && (room30.match(/method: 'DELETE' \}\);/g) ?? []).length >= 1
    && /const deleteProject = async \(\) => \{/.test(room30)
    && /router\.push\('\/home'\)/.test(room30));
  gate('T30.11 THE DELETE DOOR IS CONSERVATIVE — it deletes this user’s project and its context, UNFILES files, and never touches an item, an email or a meeting',
    !!route30 && /export async function DELETE\(/.test(route30)
    && (() => {
      const i = route30.indexOf('export async function DELETE(');
      const seg = route30.slice(i, route30.indexOf('export async function PATCH('));
      const owns = /\.eq\('user_id', user\.id\)/;
      return owns.test(seg)
        // the inventory, each row keyed to THIS entity and THIS user
        && /from\('room_turns'\)\.delete\(\)\.eq\('user_id', user\.id\)\.eq\('room_key', id\)/.test(seg)
        && /from\('item_plans'\)\.delete\(\)\.eq\('user_id', user\.id\)\.eq\('entity_id', id\)/.test(seg)
        && /from\('entity_reflections'\)\.delete\(\)\.eq\('user_id', user\.id\)\.like\('pair_key', `%\$\{id\}%`\)/.test(seg)
        && /from\('entity_links'\)\.delete\(\)\.eq\('user_id', user\.id\)\.eq\('entity_id', id\)/.test(seg)
        && /from\('work_entities'\)\.delete\(\)\.eq\('id', id\)\.eq\('user_id', user\.id\)/.test(seg)
        // UNFILE, NEVER DELETE
        && /from\('knowledge_files'\)\.update\(\{ entity_id: null \}\)/.test(seg)
        && !/from\('knowledge_files'\)\.delete\(\)/.test(seg)
        // THE WORK ITSELF IS NEVER TOUCHED
        && !/from\('inbox_items'\)\.delete\(\)/.test(seg)
        && !/from\('emails'\)\.delete\(\)/.test(seg)
        && !/from\('meeting_transcripts'\)\.delete\(\)/.test(seg)
        && !/from\('commitments'\)\.delete\(\)/.test(seg)
        && !/from\('calendar_events'\)\.delete\(\)/.test(seg)
        // a stranger's project is indistinguishable from one that never existed, and the deed is recorded
        && /return NextResponse\.json\(\{ error: 'not found' \}, \{ status: 404 \}\);/.test(seg)
        && /type: 'entity_deleted'/.test(seg);
    })());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T30.12–T30.13 — A USER TURN IS CHAT BY DEFINITION (orchestrator walk, Sep 15, live on a real
// project). New chat archived everything it was allowed to and left the reader's own go-ahead
// bubble standing — written server-side with a dedupe key for IDEMPOTENCE, which the handle
// boundary read as DURABILITY. One utterance became immortal, and the room could never be fresh.
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  const turns30 = read('lib/room/turns.ts') ?? '';
  const rail30b = read('components/home/item-rail.tsx') ?? '';

  gate('T30.12 A USER TURN IS CHAT BY DEFINITION — the chat scope archives every role=user turn whatever handles it carries, and the handle boundary governs the SYSTEM half only',
    (() => {
      const i = turns30.indexOf('export async function archiveRoomChat(');
      if (i < 0) return false;
      const seg = turns30.slice(i, i + 1800);
      const userPass = seg.indexOf(".eq('role', 'user')");
      const sysPass = seg.indexOf(".eq('role', 'system')");
      return userPass > 0 && sysPass > userPass
        // the user pass carries NO handle filter — that is the whole law
        && !/\.eq\('role', 'user'\)\s*\n\s*\.is\('dedupe_key', null\)/.test(seg)
        // the system pass keeps the boundary, untouched
        && /\.eq\('role', 'system'\)\s*\n\s*\.is\('dedupe_key', null\)\.is\('component', null\)\.is\('author', null\)/.test(seg)
        // ONE STAMP = ONE SESSION across both passes (listRoomSessions groups by archived_at)
        && /const at = new Date\(\)\.toISOString\(\);/.test(seg)
        && (seg.match(/\.update\(\{ archived_at: at \}\)/g) ?? []).length === 2
        // …and no `.or()` on an UPDATE at this seam (the known 42703 class — a silent failure here
        // means "your chat did not reset")
        && !/\.or\(/.test(seg);
    })());

  gate('T30.13 THE KEY IS FOR IDEMPOTENCE, NOT DURABILITY — the go-ahead is still written once, as the user, and a reset can now clear it (so the opener can see a fresh room)',
    (() => {
      const asks = read('app/api/room/asks/route.ts') ?? '';
      // RE-POINTED Sep 22 (W4-B, THE TYPE-IT DOOR — STRENGTHENED, not moved): this route now
      // writes TWO user turns (the go-ahead, and the typed fact — a supply is speech too), so the
      // first `role: 'user',` in the file is no longer necessarily the go-ahead's. The gate reads
      // the go-ahead's own seam BY ITS KEY, and then holds the same law over EVERY user turn the
      // route writes: keyed for idempotence, authorless, componentless — chat, not record.
      // The unit is THE TURN ITSELF — the object literal handed to writeRoomTurn, not a window of
      // surrounding lines (the route legitimately edits the ask's `component` right beside the
      // supply's turn, and proximity would read that as the turn carrying one).
      const segs = [...asks.matchAll(/writeRoomTurn\([\s\S]*?\n\s*\}\)/g)].map((m) => m[0])
        .filter((s) => /role: 'user',/.test(s));
      if (!segs.length) return false;
      const seg = segs.find((s) => /dedupeKey: `proceed:\$\{turn\.id\}`/.test(s)) ?? '';
      return segs.every((s) => /dedupeKey: `/.test(s) && !/author:/.test(s) && !/component:/.test(s))
        && /dedupeKey: `proceed:\$\{turn\.id\}`/.test(seg)
        // it stays user speech with no author and no component — the two handles that DO mean record
        && !/author:/.test(seg) && !/component:/.test(seg)
        // …and the rail's freshness test is the reader's own words, so clearing them opens the room
        && /if \(turns\.some\(\(t\) => t\.role === 'user'\)\) return null;/.test(rail30b);
    })());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T31 — THE REVIEW-FIRST DOC CARD (docs/attention-plan.md law D, completing the card contract).
//
// Four laws, gated where each is structural:
//   D1 THE DEED IS REVIEW — the card is a HANDLE and the document is NEVER embedded in a thread.
//   D2 REVIEW OPENS THE SIDE PANEL — the ONE panel, with its version chain; a revision lands on
//      the SAME card (the chain is the truth, never client memory).
//   D3 THE EDIT LADDER, HONEST PER TYPE — no editor over rendered pixels, anywhere.
//   D4 ANY TYPE, ONE ANATOMY — one glyph table, one player, and the universal preview rides the
//      compute sandbox's LibreOffice → PDF lane, cached per version, degrading honestly.
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  const types31 = read('components/thread/types.ts') ?? '';
  const kit31 = read('components/thread/thread-cards.tsx') ?? '';
  // THE DOC CARD'S OWN SOURCE — bounded by the NEXT top-level function, not by the switch far
  // below it (TIGHTENED Wave 2, never weakened: the old slice swallowed every card kind declared
  // after the doc card, so the event card's note field tripped a law about DOCUMENTS. A gate must
  // assert its own subject).
  const docCard31 = (() => {
    const start = kit31.indexOf('function DocCardView(');
    const next = kit31.indexOf('\nfunction ', start + 1);
    return kit31.slice(start, next === -1 ? kit31.indexOf('// \u2500\u2500 the card renders') : next);
  })();
  const resolver31 = read('lib/documents/doc-card.ts') ?? '';
  const panel31 = read('components/work/chat-artifact-panel.tsx') ?? '';
  const route31 = read('app/api/work/threads/[id]/artifacts/[artifactId]/preview/route.ts') ?? '';
  const host31 = read('components/home/home-ask.tsx') ?? '';
  const bubble31 = read('components/work/chat-message.tsx') ?? '';

  // ── D1 · THE HANDLE ──
  gate('T31.1 the `doc` card joins the grammar (contract · renderer · kind list)',
    /kind: 'doc';/.test(types31) && /THREAD_CARD_KINDS[\s\S]{0,400}'doc'/.test(types31)
    && /case 'doc':/.test(kit31) && /function DocCardView\(/.test(kit31));

  gate('T31.2 THE DOCUMENT IS NEVER EMBEDDED — the doc card has no body/preview/excerpt field, and its view renders none',
    (() => {
      const i = types31.indexOf('export interface DocCard extends CardBase');
      if (i < 0) return false;
      const seg = types31.slice(i, types31.indexOf('export type ThreadCard =', i));
      // no content-carrying field may exist on the contract at all — a host cannot pass what the
      // type does not have, so "docs can get big" is solved by construction, not by discipline
      if (/\b(body|preview|excerpt|content|html|firstPage)\??:/.test(seg)) return false;
      const v = docCard31;
      return !/dangerouslySetInnerHTML/.test(v) && !/card\.(body|preview|content|excerpt)/.test(v);
    })());

  gate('T31.3 THE META LINE IS JOINED FROM KNOWN FACTS — pages only when known, and a lone version word is the chain\'s own',
    /card\.typeLabel,/.test(kit31)
    && /typeof card\.pages === 'number' && card\.pages > 0/.test(kit31)
    && /card\.versionLabel \|\| null/.test(kit31)
    && /\.filter\(Boolean\)\.join\(' · '\)/.test(kit31)
    // the glyph is a house SVG per family — no emoji, no vendor mark
    && /const DOC_GLYPHS: Record<DocCard\['docType'\], React\.ReactNode>/.test(kit31)
    && ['pdf', 'word', 'slides', 'sheet', 'doc'].every((k) => new RegExp(`\\n  ${k}: \\(`).test(kit31))
    && !/[\u{1F300}-\u{1FAFF}]/u.test(kit31.slice(kit31.indexOf('const DOC_GLYPHS'), kit31.indexOf('function DocCardView('))));

  gate('T31.4 THE COMMIT DOOR ONLY WHERE A SEND-DEED EXISTS — no handler, no button (the kit\'s standing law, one kind over)',
    (() => {
      const v = docCard31;
      return /\{\(card\.onSend \|\| card\.receipt\) && \(/.test(v) && /\{card\.onSend && \(/.test(v)
        // …and no host in the repo wires a doc send it does not have: the Home mounts Review only
        && /kind: 'doc', id: `\$\{key\}-doc-\$\{j\}`/.test(host31) && !/kind: 'doc'[\s\S]{0,400}onSend:/.test(host31);
    })());

  // ── D2 · REVIEW OPENS THE ONE PANEL ──
  gate('T31.5 REVIEW RAISES THE ONE PANEL — the host\'s only doc deed is openArtifact, and the kit itself raises nothing',
    /onReview: \(\) => void openArtifact\(c\.art!\.tid, c\.art!\.id\)/.test(host31)
    && /<ThreadArtifactsPanel/.test(host31)
    // presentational purity holds for the new kind too
    && !/fetch\(/.test(kit31) && !/useRouter/.test(kit31));

  gate('T31.6 ONE PLAYER, ONE FILE — every panel MOUNTS DocumentPlayer; nobody defines a second one',
    (() => {
      const files = sourceFiles('components').concat(sourceFiles('app'));
      const definers = files.filter((f) => /function DocumentPlayer\(/.test(read(f) ?? ''));
      const mounts = files.filter((f) => /<DocumentPlayer\b/.test(read(f) ?? ''));
      // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): the second mount was the /workers island's own
      // components/workers/artifact-panel.tsx, proven unreachable and retired. ONE panel is left,
      // so the law is asserted where it now bites: one definer, one mount, and every HOST reaches
      // the player only by mounting that one panel — never by defining a player of its own.
      const hosts = files.filter((f) => /ThreadArtifactsPanel/.test(read(f) ?? '')
        && f !== 'components/work/chat-artifact-panel.tsx');
      return definers.length === 1 && definers[0].replace(/\\/g, '/') === 'components/work/chat-artifact-panel.tsx'
        && mounts.length === 1 && mounts[0] === definers[0]
        && hosts.length >= 2
        && hosts.every((f) => /from '@\/components\/work\/chat-artifact-panel'/.test(read(f) ?? ''));
    })());

  gate('T31.7 A REVISION LANDS ON THE SAME CARD — the fold reads the STORED chain (one version-utils), keeps ONE card per chain, and repoints it at the current version',
    /export function resolveDocVersion\(/.test(resolver31)
    && /computeVersionedArtifacts/.test(resolver31)
    && /function foldDocCards\(turns: Turn\[\], tid: string, artifacts: DocumentArtifact\[\]\): Turn\[\]/.test(host31)
    && /if \(seen\.has\(g\)\) return false;/.test(host31)
    && /art: \{ tid, id: v\.id \}/.test(host31)
    // it runs on BOTH lanes — the rehydrate and the live open
    && (host31.match(/foldDocCards\(prev, tid, /g) ?? []).length >= 2);

  gate('T31.8 ONE RENDERING PER KIND — the coworker DM\'s document chip is the SAME kit card (the email artifact, a different kind, keeps its own)',
    /import \{ ThreadCardView \} from '@\/components\/thread'/.test(bubble31)
    && /kind: 'doc', title: meta\?\.title \?\? 'Document'/.test(bubble31)
    && /meta\?\.type !== 'email'/.test(bubble31));

  // ── D3 · THE EDIT LADDER ──
  gate('T31.9 NEVER AN EDITOR OVER PIXELS — no contentEditable/editable surface anywhere in the doc card or the player',
    (() => {
      const v = docCard31;
      const p = panel31.slice(panel31.indexOf('export function DocumentPlayer('), panel31.indexOf('// ── QA report panel'));
      return !/contentEditable/i.test(v) && !/<textarea|<input/.test(v)
        && !/contentEditable/i.test(p) && !/<textarea|<input/.test(p)
        && /sandbox|iframe/.test(p);
    })());

  // ── D4 · ONE ANATOMY, THE UNIVERSAL PREVIEW ──
  gate('T31.10 THE PREVIEW CONVERTS SERVER-SIDE, IN THE LOCKED ROOM — the compute sandbox\'s LibreOffice lane, with the profile/HOME the sandbox requires',
    /runComputeForOutputs/.test(route31)
    && /soffice/.test(route31) && /-env:UserInstallation=file:\/\/\/tmp\/lo_profile/.test(route31)
    && /HOME="\/tmp"/.test(route31)
    // the client asks a route; it never converts, and never reaches a converter itself
    && !/soffice/.test(panel31) && /fetch\(`\/api\/work\/threads\/\$\{threadId\}\/artifacts\/\$\{artifactId\}\/preview`\)/.test(panel31));

  gate('T31.11 ONE CONVERSION PER VERSION — the preview path derives from the version\'s OWN storage path, is served from cache thereafter, and is written with cacheControl 0',
    route31.includes("const previewPath = `${path.replace(/\\.[^.]+$/, '')}.preview.pdf`")
    && /const cached = await admin\.storage\.from\(BUCKET\)\.createSignedUrl\(previewPath, 600\);/.test(route31)
    // the cache is consulted BEFORE any conversion is attempted (the call site, not the import)
    && route31.indexOf('const cached =') < route31.indexOf('await runComputeForOutputs({')
    && /cacheControl: '0'/.test(route31));

  gate('T31.12 THE HONEST DEGRADE — an unconfigured or failed converter answers with a REASON, and the player shows it beside Download (never a spinner that never ends)',
    /if \(!process\.env\.COMPUTE_SERVICE_URL \|\| !process\.env\.COMPUTE_SECRET\)/.test(route31)
    && /return unavailable\('the document converter is not available on this deployment'\)/.test(route31)
    && /return unavailable\('this document could not be rendered for preview'\)/.test(route31)
    && /function unavailable\(reason: string\)/.test(route31)
    && /available: false, reason/.test(route31)
    && /Preview unavailable — \{state\.reason\}/.test(panel31)
    && /\/download\?artifactId=\$\{artifactId\}/.test(panel31));

  gate('T31.13 THE PAGE COUNT IS A PRINTED FACT — read from the converter\'s own output, never estimated',
    /function pagesOf\(stdout\?: string \| null\): number \| null/.test(route31)
    && /PAGES:/.test(route31) && /Number\.isFinite\(n\) && n > 0 \? n : null/.test(route31));

  gate('T31.14 THE PREVIEW DOOR IS OWNER-SCOPED — both lookups filter by the reader\'s own user_id',
    (() => {
      const i = route31.indexOf("from('work_threads')");
      const seg = route31.slice(i, i + 700);
      return (seg.match(/\.eq\('user_id', user\.id\)/g) ?? []).length === 2
        && /if \(!user\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);/.test(route31);
    })());

  gate('T31.15 THE TWO FACTS COME FROM ONE RESOLVER — the type is read from the FILE\'S OWN extension first, and hosts never hand-map a glyph',
    /export function docCardTypeOf\(/.test(resolver31)
    && /const ext = String\(pathOrName \?\? ''\)\.split\('\.'\)\.pop\(\)/.test(resolver31)
    && resolver31.indexOf('BY_EXT[ext]') < resolver31.indexOf("case 'presentation':")
    && (host31.match(/docCardTypeOf\(/g) ?? []).length >= 3
    && /docCardTypeOf\(/.test(bubble31));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T32 — THE ONE OBJECT CARD + KIT RENDER DISCIPLINE
// (docs/threads-plan.md "THE OPENING CONTRACT — SPEAK · SHOW · OFFER", clauses 1, 2 and 5;
//  the owner's Sep-19 walk of six screenshots.)
//
// What the walk found, three times in one evening: a decision card asking to approve a thing that
// was nowhere on screen; a room opening with an ask and no reminder of what was asked; and, in the
// chrome, one speaker announcing themself twice in a row above a bubble that mixed three type
// treatments. The owner's constraints are the gates' shape:
//   1  ONE RENDERING PER OBJECT KIND, on every surface — a host mounts the kit card or shows
//      nothing, and never authors excerpt markup of its own.
//   2  NO ASK, DECISION OR BRIEF SERVES WITHOUT ITS OBJECT IN REACH — and "ask me to pull it
//      together" is dead copy, because the machine pulls it.
//   5  KIT-SIDE RENDER DISCIPLINE — one face+name header per RUN, one type scale per bubble, and
//      punctuation that belongs to a word.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT32 · THE ONE OBJECT CARD — the ask and the thing asked about, on one surface');
{
  const types32 = read('components/thread/types.ts') ?? '';
  const kit32 = read('components/thread/thread-cards.tsx') ?? '';
  const card32 = read('components/thread/source-object-card.tsx') ?? '';
  const door32 = read('lib/inbox/thread-door.ts') ?? '';
  const mount32 = read('components/room/source-object.tsx') ?? '';
  const deck32 = read('components/triage/triage-deck.tsx') ?? '';
  const rail32 = read('components/home/item-rail.tsx') ?? '';
  // RE-POINTED (W3-C, Sep 22 — docs/component-map.md §2 item 7): the hand-drawn
  // components/work/decision-card.tsx converged into the kit's `decision` kind behind ONE host.
  // The LAW is unchanged — a decision still shows its source where the honest line used to stand —
  // so the gate follows the seam rather than the file.
  const dcardKit32 = read('components/thread/thread-cards.tsx') ?? '';
  const dcardHost32 = read('components/home/decision-card.tsx') ?? '';
  const room32 = read('components/entities/entity-room.tsx') ?? '';
  const timeline32 = read('components/thread/thread-timeline.tsx') ?? '';

  // ── clause 1 · THE CARD ──
  gate('T32.1 the `source` card joins the grammar (contract · enumeration · its own component · the ONE switch)',
    /kind: 'source';/.test(types32) && /THREAD_CARD_KINDS[\s\S]{0,400}'source'/.test(types32)
    && /source: 'email' \| 'meeting' \| 'document';/.test(types32)
    && !!card32 && /export function SourceObjectCard/.test(card32)
    && /case 'source':/.test(kit32) && /<SourceObjectCard card=\{card\} \/>/.test(kit32));

  gate('T32.2 THE KIT INVENTS NOTHING — the card clips no text, reads no clock and formats no size; it mounts the ONE shared chip',
    !!card32 && !/clipForPrompt|topMessageOf|slice\(0,/.test(card32)
    && !/toLocaleDateString|new Date\(/.test(card32)
    && !/fmtBytes/.test(card32)
    && /import \{ AttachmentChip \} from '@\/components\/ui\/attachment-lightbox'/.test(card32)
    // …and it is presentational like the rest of the kit (T3.12's law, asserted at this file too)
    && !/\bfetch\(/.test(card32) && !/useRouter|supabase/i.test(card32));

  gate('T32.3 NO LYING DOORS ON THE OBJECT — the door and each chip render only with a handler',
    !!card32 && /card\.onOpen && \(/.test(card32) && /f\.onOpen\s*\n?\s*\?/.test(card32)
    // TRUTH BEFORE PRESENTATION: nothing to show is no card, never an empty labelled frame
    && /if \(!messages\.length && !card\.excerpt && !files\.length && !card\.title\) return null;/.test(card32));

  // ── clause 1 · ONE READ OF THE THREAD DOOR ──
  gate('T32.4 THE DECK AND THE KIT SHARE ONE THREAD-TAIL IMPLEMENTATION — the loader lives in lib/inbox/thread-door.ts and the deck\'s inline copy is GONE',
    !!door32 && /export function loadThreadDoor/.test(door32) && /export function loadThreadTail/.test(door32)
    // ⟲ RE-POINTED (W3.7 ROOM SPEED): the door now holds ONE raw read (`_rawFlight` + `_raw`) and
    // derives the narrowed door data from it (`_cache.set(itemId, readPayload(d …))`) — so the
    // email room's full-payload read and the object card's narrowed read are one request.
    && /_rawFlight/.test(door32) && /_cache\.set\(itemId, readPayload\(/.test(door32)
    && /import \{ threadTail, type TriageMessage \} from '@\/lib\/triage\/words'/.test(door32)
    // the deck imports it and keeps NO cache, NO flight map and NO fetch of the thread door
    // ⟲ RE-POINTED (Sep 22, W3.6): the exact import LIST was pinned; the deck card now also warms a
    // handed commitment's founding thread through the SAME door (`loadThreadDoor`) before mounting
    // THE ONE OBJECT CARD. The law is that every thread read goes through the ONE door module —
    // asserted as "imports loadThreadTail + peekThreadDoor from it", not "imports exactly those two".
    && /import \{[^}]*\bloadThreadTail\b[^}]*\bpeekThreadDoor\b[^}]*\} from '@\/lib\/inbox\/thread-door'/.test(deck32)
    && !/_tailCache|_tailFlight/.test(deck32)
    && !/fetch\(`\/api\/inbox\/\$\{itemId\}\/thread`\)/.test(deck32));

  gate('T32.5 THE EXCERPT LANE HAS ONE ENTRANCE — no component imports the tail clipper directly; they mount the card or read the door',
    sourceFiles('components').every((f) => !/threadTail/.test(read(f) ?? '')));

  gate('T32.6 THE HOST OWNS THE READ AND THE VIEWER (the kit owns neither) — one door read, THE ONE lightbox, no second previewer',
    !!mount32 && /from '@\/lib\/inbox\/thread-door'/.test(mount32)
    && /<ThreadCardView card=\{\{\s*\n?\s*kind: 'source'/.test(mount32)
    && /<AttachmentLightbox files=\{files\}/.test(mount32)
    // the in-flight rule: what is served paints at once (the deck's warm is this mount's first paint)
    && /peekThreadDoor\(itemId\)/.test(mount32));

  // ── clause 2 · THE THREE SEATS ──
  gate('T32.7 THE DECISION SHOWS ITS SOURCE — the card takes an objectNode and renders it where the honest line used to stand',
    /objectNode\?: ReactNode;/.test(read('components/thread/types.ts') ?? '')
    && /\{card\.objectNode\s*\n?\s*\? <div className="mx-4 mb-2 mt-1">\{card\.objectNode\}<\/div>/.test(dcardKit32)
    && /: card\.quietLine/.test(dcardKit32)
    // …and a SOURCE never makes anything recommendable: the structural test still reads the
    // PREPARED object, which the host holds and the mounted node is never mistaken for
    && /const recommends = mayRecommend\(spec\.object\);/.test(dcardHost32)
    && /\.\.\.\(preparedNode \? \{ objectNode: preparedNode \}/.test(dcardHost32));

  gate('T32.8 "ask me to pull it together" IS DEAD COPY — the string survives nowhere in components/ or lib/',
    sourceFiles('components').concat(sourceFiles('lib')).concat(sourceFiles('app'))
      .every((f) => !/pull it together/i.test(read(f) ?? '')));

  gate('T32.9 THE ROOM MOUNTS THE OBJECT AT ITS THREE SEATS — the decision, the opening, the ask — through the ONE mount',
    // RE-POINTED (W7.3): the import also brings the meeting mount (a meeting-born commitment's source)
    /import \{ SourceObjectMount(, [^}]+)? \} from '@\/components\/room\/source-object'/.test(rail32)
    && /<SourceObjectMount itemId=\{objectItemId\}/.test(rail32)
    && /objectNode: objectCard/.test(rail32)          // the decision seat
    && /pinnedSeatsObject && <div className="pt-0.5">\{objectCard\}<\/div>/.test(rail32)  // the opening
    && /askSeatsObject \? \[\{ kind: 'custom' as const, id: 'lifted-ask-object', node: objectCard \}\]/.test(rail32));

  gate('T32.10 NEVER TWO EXCERPTS OF ONE THREAD — only a card that RENDERS THE INBOUND\'S WORDS suppresses the object, and exactly ONE seat takes it',
    // RE-POINTED Sep 19 (THE OPENING CONTRACT, the owner walk): the test used to be "is any card
    // mounted", which hid the inbound on the commonest door of all — an item with a prepared reply.
    /const objectAlreadyMounted = !!objectItemId\s*\n?\s*&& mountedCards\.some\(\(a\) => !!a\.showsSource/.test(rail32)
    && /const decisionSeatsObject = !!objectCard && decisionIsPrimary && !decision\?\.object;/.test(rail32)
    && /const askSeatsObject = !!objectCard && !decisionSeatsObject/.test(rail32)
    && /const pinnedSeatsObject = !!objectCard && !decisionSeatsObject && !askSeatsObject;/.test(rail32));

  gate('T32.10b THE INBOUND, THEN THE ANSWER — the EmailCard is the REPLY (it never shows the message being answered), so the object card mounts ABOVE it instead of standing down',
    // the declaration exists and is opt-IN (default false ⇒ the object mounts)
    /showsSource\?: boolean/.test(rail32)
    // …and no artifact author claims it today — the reply card and the invite card show neither
    && ['components/home/item-detail.tsx', 'components/entities/entity-room.tsx']
      .every((f) => !/showsSource:\s*true/.test(read(f) ?? ''))
    // …the object's seat is the PINNED bubble, which renders above the stream's cards
    && /pinnedSeatsObject && <div className="pt-0.5">\{objectCard\}<\/div>/.test(rail32)
    // …and the EmailCard really is outbound-only: it builds the kit's `email` card (the reply being
    // written), never a `source` card, and it reads no thread tail of its own.
    && (() => {
      const ec = read('components/home/email-card.tsx') ?? '';
      return /kind: 'email',/.test(ec) && !/kind: 'source'/.test(ec)
        && !/SourceObjectMount|loadThreadDoor|topMessageOf/.test(ec);
    })());

  gate('T32.10c THE ASK LINE SPEAKS THE COUNTERPARTY\'S OWN ASK — our disposition ("decide…") is attributed to us, the claim renders or is not made, and the name lands once',
    // OUR framing is detected and never put in their mouth
    // ⟲ RE-POINTED (W8.4 THE ROOM SPEAKS TRUE): the detection + the attribution moved into the ONE
    // pure fallback ladder (lib/room/opening-fallback.ts — "From <who> — <ask>", their seat and our
    // frame never fused); the rail calls it. smoke-room-voice C1–C4 hold the ladder's fixtures.
    /const line = fallbackOpeningLine\(\{ who, ask: a\?\.ask \?\? null, preparedClause: prep \}\);/.test(rail32)
    && /const MACHINE_FRAMED = \/\^\(decide\|choose\|determine\|assess\|evaluate\|weigh\|consider\|review\|triage\|judge\)\\b\/;/.test(read('lib/room/opening-fallback.ts') ?? '')
    && /\? `From \$\{who\} — \$\{ask\}\$\{tail\}\.` : `\$\{who\} is asking you to \$\{ask\}\$\{tail\}\.`/.test(read('lib/room/opening-fallback.ts') ?? '')
    // "drafted a reply below" only while that card is in THIS stream
    && /const replyMounted = mountedCards\.some\(\(c\) => c\.key === 'reply'\);/.test(rail32)
    && /a\?\.prepared && replyMounted/.test(rail32)
    // the two speech laws are IMPORTED, never re-written here
    && /import \{ collapseSelfVoice \} from '@\/lib\/room\/self-voice'/.test(rail32)
    && /import \{ nameOncePerSentence \} from '@\/lib\/room\/opening-discipline'/.test(rail32)
    && /return line \? nameOncePerSentence\(line, \[who\]\) : null;/.test(rail32)
    // …and the drafter's name can NEVER reach the page un-collapsed: the only construction of that
    // sentence in the file is the argument of collapseSelfVoice.
    && /collapseSelfVoice\(\s*\n\s*a\.prepared === 'draft' \? 'I drafted a reply below' : `\$\{a\.prepared\.split\(' '\)\[0\]\} drafted a reply below`,/.test(rail32)
    && (rail32.match(/a\.prepared\.split\(' '\)/g) ?? []).length === 1);

  // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the object is the DOOR's OWN source through one pure
  // rule (lib/room/door.ts objectIdForDoor) — an email door is itself, a commitment door takes the
  // source the door serves, and ONLY the entity door may fall back to its mail MOVE's target (a
  // member it owns). The item-door move fallback is dead: it mounted a sibling's email under a
  // commitment's title (owner walk, Sep 23). smoke-one-door H1–H5 test the rule.
  gate('T32.11 EVERY DOOR, ONE OBJECT RULE — the email door is its own object, the commitment door takes its served source, the project room hands over its focused mail, and only the entity door falls back to its mail MOVE',
    /const objectItemId = objectIdForDoor\(door, \{ sourceItemId, moveRef: respMove\?\.ref \?\? null \}\);/.test(rail32)
    && !/\(sourceItemId \|\| \(moveIsMail \? respMoveTargetId : null\)\)/.test(rail32)
    && /sourceItemId=\{focused\?\.kind === 'email' \? focused\.id : null\}/.test(room32));

  // ── clause 5 · KIT-SIDE RENDER DISCIPLINE ──
  gate('T32.12 ONE FACE PER RUN — the pinned opening is part of its speaker\'s run, so the bubble under it never re-announces the same face',
    /prev\.type === 'actor_bubble' \|\| prev\.type === 'pinned'/.test(timeline32)
    && /prevActorId === item\.actorId/.test(timeline32));

  // ⟲ RE-POINTED (W3.5 (e), Sep 22): "one muted tone" was still a SECOND tone inside one bubble —
  // 13px text-neutral-500 lines under a 13px text-neutral-800 sentence. Clause 5 says hierarchy by
  // spacing, never per-paragraph size/color: the pinned lines now wear the bubble's own tone.
  gate('T32.13 ONE TYPE SCALE PER BUBBLE — the pinned opening speaks at one size in the bubble\'s own tone (hierarchy by spacing only)',
    (() => {
      const i = rail32.indexOf('const pinnedNode =');
      if (i < 0) return false;
      const seg = rail32.slice(i, rail32.indexOf('// ── THE ARTIFACT CARDS', i));
      // no second body size, and no second colour inside the one bubble
      return !/text-\[12\.5px\]/.test(seg) && !/text-neutral-500/.test(seg)
        && (seg.match(/text-\[13px\] leading-\[1\.5\] text-neutral-800/g) ?? []).length >= 4;
    })());

  // RE-POINTED (Sep 22, T41): the filter lives in the kit's ONE `EventLine` piece now (the trace
  // line renders through the same renderer). Same law, same single seat, new spelling.
  gate('T32.14 A SEPARATOR BELONGS TO A WORD — a blank-labelled ref never renders its own " ·"',
    /refs\?\.filter\(\(r\) => !!r\.label\?\.trim\(\)\)/.test(timeline32));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T33 · THE ONE COLLECTION CARD (docs/component-map.md §6, Wave 1 — the CLIENT half)
//
// "What workflows do I have" · "find the document about X" · "what did I record last week" · "what's
// on tomorrow" all answered in prose, and the owner asked for interactive components — with one
// constraint that is the gates' shape: "I don't want us to have multiple components for the same
// thing in different ways." So: ONE kit kind for every set of the user's own objects, ONE host that
// owns the verbs, and the verbs go through the doors those objects ALREADY have.
//
//   (a) the kit owns the kind — contract, grammar, enumeration, the one switch
//   (b) NO LYING DOORS, and at most TWO verbs a row — enforced in the RENDERER, not asked of hosts
//   (c) the host derives verbs from `state`, never from a label; every deed is a door that existed
//   (d) a persisted card is a POINTER — rehydrate re-reads, never a stored snapshot
//   (e) `isCollectionSpec` guards BOTH mounts (live and rehydrated)
//   (f) calendar is READ-ONLY in this wave, by design
//   (g) the harness carries the fixtures
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT33 · THE ONE COLLECTION CARD — a set of the user’s own objects, as one card');
{
  const types33 = read('components/thread/types.ts') ?? '';
  const kit33 = read('components/thread/thread-cards.tsx') ?? '';
  const contract33 = read('lib/present/collection.ts') ?? '';
  const host33 = read('components/home/collection-card.tsx') ?? '';
  const route33 = read('app/api/collections/route.ts') ?? '';
  const ask33 = read('components/home/home-ask.tsx') ?? '';
  const harness33 = read('app/(main)/dev/thread-preview/preview-client.tsx') ?? '';

  // ── (a) THE KIND ──
  gate('T33.1 the `collection` card joins the grammar (contract · enumeration · the ONE switch · its own view)',
    /kind: 'collection';/.test(types33)
    // MEMBERSHIP, never the neighbour list (the BD7.1 re-pointing lesson, Sep 21)
    && /THREAD_CARD_KINDS[\s\S]{0,400}'collection'/.test(types33)
    && /export interface CollectionRow \{/.test(types33) && /export interface CollectionRowVerb \{/.test(types33)
    && /case 'collection':/.test(kit33) && /<CollectionCardView card=\{card\} \/>/.test(kit33)
    && /function CollectionCardView\(/.test(kit33) && /function CollectionRowView\(/.test(kit33));

  gate('T33.2 ONE CONTRACT BETWEEN THE HALVES — the pure leaf both sides import, and the client half never edits its shapes',
    /export const COLLECTION_KINDS/.test(contract33)
    && /export function isCollectionSpec/.test(contract33)
    && !/\bfetch\(|supabase/i.test(contract33) && !/^import /m.test(contract33)
    && /from '@\/lib\/present\/collection'/.test(kit33)
    && /from '@\/lib\/present\/collection'/.test(host33));

  // ── (b) NO LYING DOORS · THE CAP IS THE RENDERER'S ──
  gate('T33.3 NO LYING DOORS — a verb with no handler renders as plain text, and so does the title and the "and N more" line',
    /if \(!verb\.onClick\) return <span/.test(kit33)
    && /row\.onOpen \? \([\s\S]{0,260}<button type="button" onClick=\{row\.onOpen\}[\s\S]{0,400}\) : \([\s\S]{0,200}<span/.test(kit33)
    // the cap's door is OpenLink, which is already the kit's no-handler-is-text affordance
    && /<OpenLink label=\{card\.more\.label \?\? `and \$\{card\.more\.count\} more →`\} onClick=\{card\.more\.onOpen\} \/>/.test(kit33));

  gate('T33.4 AT MOST TWO VERBS A ROW, ENFORCED IN THE RENDERER — the cap is one exported number, sliced by the kit, never a rule hosts are asked to keep',
    /export const COLLECTION_ROW_MAX_VERBS = 2;/.test(types33)
    && /\(row\.verbs \?\? \[\]\)\.slice\(0, COLLECTION_ROW_MAX_VERBS\)/.test(kit33));

  gate('T33.5 THE TWO-STEP IS IN PLACE — the verb swaps itself for a confirm + a way out; no modal, no native confirm()',
    /verb\.confirm && armed/.test(kit33)
    && /\{verb\.confirm\.label\}/.test(kit33) && /Cancel<\/button>/.test(kit33)
    && !/window\.confirm|globalThis\.confirm|createPortal/.test(kit33));

  gate('T33.6 THE KIT STAYS PRESENTATIONAL and forks nothing — no fetch/router/supabase, ONE expander idiom, ONE fold number',
    !/\bfetch\(/.test(kit33) && !/useRouter|supabase/i.test(kit33)
    && /import \{ ExpandableRows \} from '@\/components\/home\/expandable-rows'/.test(kit33)
    && /<ExpandableRows\s+items=\{card\.rows\}/.test(kit33)
    && /card\.foldAfter \?\? COLLECTION_INLINE_ROWS/.test(kit33)
    // …and an empty set says so plainly rather than wearing row-shaped ghosts
    && /card\.rows\.length === 0 \?/.test(kit33) && /\{card\.emptyLine \?\? 'Nothing here yet\.'\}/.test(kit33));

  // ── (c) THE HOST OWNS THE VERBS, AND EVERY DEED IS A DOOR THAT ALREADY EXISTED ──
  gate('T33.7 THE STATE DECIDES, NEVER THE LABEL — the verb map reads `state` and never a status word',
    /const state = live\.state \?\? row\.state;/.test(host33)
    && /if \(state === 'active'\)[\s\S]{0,200}'pause'/.test(host33)
    && /else if \(state === 'paused'\)[\s\S]{0,200}'resume'/.test(host33)
    // a status LABEL never reaches a verb decision anywhere in the host
    && !/row\.status/.test(host33));

  gate('T33.8 EVERY DEED IS THE LEDGER’S OWN DOOR — pause/resume is its PATCH, run is its run door, the material predicate is imported not re-written',
    /fetch\(`\/api\/workflows\/\$\{row\.id\}`, \{\s*\n?\s*method: 'PATCH'/.test(host33)
    && /body: JSON\.stringify\(\{ status: to \}\)/.test(host33)
    && /fetch\(`\/api\/workflows\/\$\{row\.id\}\/run`, \{/.test(host33)
    && /import \{ asksForMaterial \} from '@\/components\/workflows\/run-material-sheet'/.test(host33)
    // …and the ledger still owns those doors (they are not this wave's invention)
    && (() => {
      const ledger = read('components/workflows/workflows-ledger.tsx') ?? '';
      return /fetch\(`\/api\/workflows\/\$\{w\.id\}`, \{ method: 'PATCH'/.test(ledger)
        && /fetch\(`\/api\/workflows\/\$\{w\.id\}\/run`/.test(ledger);
    })());

  gate('T33.9 THE RE-READ DOOR IS GET-ONLY — no mutation route was minted under /api/collections',
    !!route33 && /export async function GET\(/.test(route33)
    && !/export async function (POST|PATCH|PUT|DELETE)\(/.test(route33)
    && sourceFiles('app/api/collections').every((f) => !/export async function (POST|PATCH|PUT|DELETE)\(/.test(read(f) ?? ''))
    // …and it is authed, user-scoped and zero-AI: it re-derives through the ONE builder
    && /supabase\.auth\.getUser\(\)/.test(route33)
    && /buildCollection\(supabase, user\.id, kind, params\)/.test(route33)
    && !/getAIClient|aiCall/.test(route33));

  gate('T33.10 AN OPTIMISTIC FLIP ROLLS BACK — a failed deed restores the state it found and says so in one quiet line',
    /patch\(row\.id, \{ state: to, busy: true, error: undefined \}\);/.test(host33)
    && /patch\(row\.id, \{ state: from, busy: false, settled: undefined, error: 'That could not be changed — try again\.' \}\);/.test(host33)
    && /error: 'The run could not start — try again\.'/.test(host33));

  gate('T33.17 THE CHIP FOLLOWS THE FLIP, AND NO WORD LANDS TWICE — a paused row says "paused" once, and keeps only the way back',
    /const WORKFLOW_CHIP: Record<string, \{ word: string; tone: 'active' \| 'paused' \| 'draft' \}>/.test(host33)
    && /live\.state && live\.state !== r\.state && WORKFLOW_CHIP\[live\.state\]/.test(host33)
    // the settle flag is what the verb map reads — the receipt word is never load-bearing state
    && /settled\?: 'paused' \| 'resumed' \| 'ran';/.test(host33)
    && /if \(live\.settled === 'paused'\)/.test(host33) && /if \(live\.settled\) return \[\];/.test(host33)
    // …and a RUN, which has no chip, keeps its receipt and no button that would spend twice
    && /settled: 'ran', receipt: 'running'/.test(host33));

  // ── (d) A PERSISTED CARD IS A POINTER ──
  gate('T33.11 A PERSISTED COLLECTION IS A POINTER — the stored component carries `{kind, params}` and the host RE-READS; no stored row snapshot is ever mounted',
    /t\.component\?\.key === 'collection_card'/.test(ask33)
    && (() => {
      const i = ask33.indexOf("t.component?.key === 'collection_card'");
      const seg = ask33.slice(i, i + 900);
      // the rehydrated turn gets a POINTER and nothing else — no `spec:` off the stored state
      return /pointer: \{/.test(seg) && /kind: \(t\.component\.state as/.test(seg) && !/spec:/.test(seg);
    })()
    && /fetch\(`\/api\/collections\?\$\{qs\.toString\(\)\}`\)/.test(host33)
    // the live turn paints from the SERVED spec (no round-trip for a fresh answer)
    && /d\.collection && isCollectionSpec\(d\.collection\.spec\)/.test(ask33));

  // ── (e) THE GUARD, BOTH MOUNTS ──
  gate('T33.12 `isCollectionSpec` GUARDS BOTH MOUNTS — a malformed spec renders nothing, live or rehydrated',
    /isCollectionSpec\(seed\)/.test(host33)
    && /isCollectionSpec\(json\?\.spec\)/.test(host33)
    && /isCollectionSpec\(d\.collection\.spec\)/.test(ask33)
    // …and while it is still reading it shows NOTHING, never a skeleton of rows it has not read
    && /if \(!spec\) \{/.test(host33) && !/animate-pulse/.test(host33));

  // ── (f) READ-ONLY WHERE A VERB WOULD LIE ──
  gate('T33.13 CALENDAR CARRIES NO VERBS IN THIS WAVE — RSVP/reschedule/cancel have no registry row, no chat door and no commit-door claim, so they are not offered',
    !/'calendar'[\s\S]{0,400}verbs/.test(host33)
    && /CALENDAR IS READ-ONLY IN THIS WAVE/.test(host33)
    // the verb map's last word for any other kind is the empty set
    && /\n    return \[\];\n  \}, \[onAsk, router, runWorkflow, setWorkflowStatus\]\);/.test(host33));

  gate('T33.14 "Ask about it" IS A WORD, NOT A DEED — it prefills the ONE composer, and without that seam the set is read-only',
    /if \(!onAsk\) return \[\];/.test(host33)
    && /onAsk\(`About "\$\{row\.title\}": `\)/.test(host33)
    && /onAsk=\{\(text\) => \{ setPrefill\(text\); focusComposer\(\); \}\}/.test(ask33));

  gate('T33.15 ONE VIEWER, ONE ADDRESS — a document opens in the library’s own lightbox, a recording at THE ONE note address, and no second previewer is drawn',
    /import \{ AttachmentLightbox, type LightboxFile \} from '@\/components\/ui\/attachment-lightbox'/.test(host33)
    && /ref: \{ kind: 'kb', id: r\.id \}/.test(host33)
    && /router\.push\(`\/meetings\/\$\{str\(row\.facts\?\.eventId\) \?\? row\.id\}`\)/.test(host33)
    && /router\.push\(`\/workflows\/\$\{row\.id\}`\)/.test(host33));

  // ── (g) THE HARNESS ──
  gate('T33.16 the harness carries the fixtures — workflows (active · paused-with-undo · running-receipt · draft · a handler-less verb · a confirm) · documents (capped) · recordings · a calendar day · an empty set',
    /WORKFLOWS_COLLECTION/.test(harness33) && /DOCUMENTS_COLLECTION/.test(harness33)
    && /RECORDINGS_COLLECTION/.test(harness33) && /CALENDAR_COLLECTION/.test(harness33)
    && /EMPTY_COLLECTION/.test(harness33)
    && /confirm: \{ label: 'Run it' \}/.test(harness33)
    && /receipt: 'running'/.test(harness33)
    && /\{ id: 'pause', label: 'Pause', tone: 'quiet' \}/.test(harness33)   // no handler ⇒ plain text
    && /more: \{ count: 12, onOpen: noop \}/.test(harness33)
    && /emptyLine: 'No workflows yet\.'/.test(harness33)
    && /cards: \[WORKFLOWS_COLLECTION\]/.test(harness33) && /cards: \[DOCUMENTS_COLLECTION\]/.test(harness33));

  // ── (h) THE COWORKER DM IS THE SAME CARD, NOT A SECOND ONE ──
  // The DM was deferred in the first pass because its seams sat in two agents' files. Wired now,
  // under the constraint that motivated the whole wave: ONE host, ONE re-read door, and a stored
  // card that is a pointer. A second mount or a second fetch path here IS the fork the owner asked
  // us not to build ("multiple components for the same thing in different ways").
  const dm33 = read('app/api/work/threads/[id]/chat/route.ts') ?? '';
  gate('T33.18 THE DM MOUNTS THE ONE HOST THROUGH THE ONE RE-READ DOOR — live spec or stored pointer, no second card and no second fetch path',
    // the client half: exactly ONE CollectionCard mount and ONE /api/collections reader in the app
    (ask33.match(/<CollectionCard\b/g) ?? []).length === 1
    && !/\/api\/collections\?/.test(ask33)
    && /import CollectionCard, \{ type CollectionPointer \} from '@\/components\/home\/collection-card'/.test(ask33)
    // the DM's LIVE frame paints from the served spec, guarded by the one validator
    && /event\.type === 'collection' && event\.collection\?\.id && isCollectionSpec\(event\.collection\.spec\)/.test(ask33)
    && /collections\.push\(\{ collectionId: event\.collection\.id, spec: event\.collection\.spec \}\)/.test(ask33)
    // …and the RELOAD hands the host a pointer off the DM message's own metadata — never a spec
    && (() => {
      // the LAST occurrence is the mapping (the first is the keep-this-message filter above it)
      const i = ask33.lastIndexOf('m.metadata?.collections?.length');
      if (i === -1) return false;
      const seg = ask33.slice(i, i + 700);
      return /pointer: \{/.test(seg) && /isCollectionKind\(c\.kind\)/.test(seg) && !/spec:/.test(seg);
    })());

  gate('T33.19 THE PERSISTED DM COLLECTION IS A POINTER — kind, re-read params, framing; the ROWS are never stored, and the card rides BESIDE the coworker’s prose',
    // RE-POINTED (W4-C, Sep 22): the shape moved into the ONE shared helper
    // (lib/present/pointer.ts) because THREE producers now write it. The law is unchanged and the
    // check is strictly stronger — it now reads the helper itself, so no producer can widen it.
    /const allCollections: CollectionTurnPointer\[\] = \[\];/.test(dm33)
    && (() => {
      const ptr = read('lib/present/pointer.ts') ?? '';
      const i = ptr.indexOf('export function collectionPointer(');
      if (i === -1) return false;
      const body = ptr.slice(i, i + 400);
      return /kind: spec\.kind/.test(body) && /framing: spec\.framing/.test(body)
        && /params: spec\.params/.test(body) && !/rows/.test(body);
    })()
    && /\.\.\.\(allCollections\.length > 0 \? \{ collections: allCollections \} : \{\}\),/.test(dm33)
    && (() => {
      const i = dm33.indexOf('const takeCollection = (spec?: CollectionSpec) => {');
      if (i === -1) return false;
      const seg = dm33.slice(i, i + 500);
      // the pointer carries no rows, and the LIVE frame carries the spec
      return !/rows/.test(seg)
        && /allCollections\.push\(collectionPointer\(id, spec\)\);/.test(seg)
        && /send\(\{ type: 'collection', collection: \{ id, spec \} \}\);/.test(seg);
    })()
    // …and the coworker's own prose still streams (the card is an addition, never a replacement)
    && /event\.type === 'text'\) \{ acc \+= event\.delta \?\? ''; patchLast\(acc\); \}/.test(ask33));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T34 · THE EVENT CARD (docs/component-map.md §6, Wave 2 — the CLIENT half)
//
// The first card whose verbs depend on WHO the user is to the object and WHEN it is. That is what
// makes it the seat of the gen-UI rule — REASONED SELECTION, DETERMINISTIC RENDERING — and these
// gates are that rule's client half:
//
//   (a) the kit owns the kind — contract, enumeration, the ONE switch, its own view
//   (b) THE CLIENT NEVER RE-DERIVES THE LADDER: `spec.verbs` IS the permitted set, served; no
//       component imports `validEventVerbs`, and the words come from `EVENT_VERB_WORDS`
//   (c) THE SECOND CLICK IS THE APPROVAL — arming fires nothing; a proposal arms, it never sends
//   (d) AN IRREVERSIBLE VERB SAYS WHAT IT COSTS, for exactly `IRREVERSIBLE_VERBS`
//   (e) a persisted card is a POINTER — the host re-reads on mount, and again on a 409
//   (f) `isEventSpec` guards BOTH mounts; every deed is the ONE door
//   (g) the harness carries every state the card can be in
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT34 · THE EVENT CARD — one calendar event, and only the verbs its state permits');
{
  const types34 = read('components/thread/types.ts') ?? '';
  const kit34 = read('components/thread/thread-cards.tsx') ?? '';
  const contract34 = read('lib/present/event.ts') ?? '';
  const host34 = read('components/home/event-card.tsx') ?? '';
  const ask34 = read('components/home/home-ask.tsx') ?? '';
  const coll34 = read('components/home/collection-card.tsx') ?? '';
  const harness34 = read('app/(main)/dev/thread-preview/preview-client.tsx') ?? '';

  // ── (a) THE KIND ──
  gate('T34.1 the `event` card joins the grammar (contract · enumeration · the ONE switch · its own view)',
    /kind: 'event';/.test(types34)
    && /export interface EventCard extends CardBase \{/.test(types34)
    && /export interface EventCardVerb \{/.test(types34)
    // MEMBERSHIP, never the neighbour list (the BD7.1 re-pointing lesson)
    && /THREAD_CARD_KINDS[\s\S]{0,400}'event'/.test(types34)
    && /case 'event':/.test(kit34) && /<EventCardView card=\{card\} \/>/.test(kit34)
    && /function EventCardView\(/.test(kit34));

  gate('T34.2 ONE CONTRACT BETWEEN THE HALVES — the pure leaf both sides import, and the client half never edits its shapes',
    /export const EVENT_VERBS/.test(contract34)
    && /export function isEventSpec/.test(contract34)
    && /export function validEventVerbs/.test(contract34)
    && !/\bfetch\(|supabase/i.test(contract34) && !/^import /m.test(contract34)
    && /from '@\/lib\/present\/event'/.test(host34));

  // ── (b) THE CLIENT NEVER RE-DERIVES THE LADDER ──
  gate('T34.3 `spec.verbs` IS THE PERMITTED SET — no component imports or calls the ladder, and the host renders the served order untouched',
    // no client file pulls the ladder or the sanitizer out of the contract…
    sourceFiles('components').every((f) => {
      const src = read(f) ?? '';
      const imports = [...src.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+'@\/lib\/present\/event'/g)]
        .map((m) => m[1]).join(',');
      return !/validEventVerbs|sanitizeProposal/.test(imports) && !/validEventVerbs\(|sanitizeProposal\(/.test(src);
    })
    // …and the host maps the SERVED array, in place, wording it from the contract's own table
    && /spec\.verbs\.map\(\(v\) => \(\{/.test(host34)
    && /label: EVENT_VERB_WORDS\[v\]\.label,/.test(host34)
    && /armedLabel: EVENT_VERB_WORDS\[v\]\.armed,/.test(host34)
    // …and a rehydrated proposal is honoured ONLY while the served ladder still permits it
    && /pointer\?\.proposal && spec\.verbs\.includes\(pointer\.proposal\.verb\)/.test(host34));

  gate('T34.4 THE LOUDEST VERB IS NEVER THE COSTLIEST ONE — at rest every verb is quiet text; the primary appears only on the ARMED step, wearing the contract’s armed word',
    // the resting button is the muted one…
    /onClick=\{\(\) => setArmed\(v\.id\)\}[\s\S]{0,260}text-neutral-400/.test(kit34)
    // …and the armed one is the single filled button, saying `EVENT_VERB_WORDS[verb].armed`
    && /bg-indigo-600[\s\S]{0,200}\{v\.busy \? `\$\{v\.armedLabel\}…` : v\.armedLabel\}/.test(kit34)
    && /EVENT_VERB_WORDS: Record<EventVerb, \{ label: string; armed: string; done: string \}>/.test(contract34));

  // ── (c) THE SECOND CLICK IS THE APPROVAL ──
  gate('T34.5 THE FIRST CLICK ARMS, THE SECOND COMMITS — arming calls nothing, the deed is reached from exactly one place, and a way out is always rendered',
    // the un-armed branch ONLY arms
    /onClick=\{\(\) => setArmed\(v\.id\)\}/.test(kit34)
    // the armed branch is the ONLY caller of the host's hands, through the one `fire`
    && (kit34.match(/v\.onConfirm\?\.\(/g) ?? []).length === 1
    && /const fire = \(v: EventCardVerb\) => \{/.test(kit34)
    && /onClick=\{\(\) => fire\(v\)\}/.test(kit34)
    // Escape and a click away disarm — a two-step's way out is never only a button
    && /if \(e\.key === 'Escape'\) setArmed\(null\)/.test(kit34)
    && /document\.addEventListener\('mousedown', onDown\)/.test(kit34)
    && /Cancel<\/button>/.test(kit34)
    // …and no modal, no native confirm()
    && !/window\.confirm|globalThis\.confirm|createPortal/.test(kit34));

  gate('T34.6 A PROPOSAL ARMS, IT NEVER SENDS — the served selection seats the armed verb on the first paint and nothing else moves',
    /React\.useState<string \| null>\(card\.armedVerbId \?\? null\)/.test(kit34)
    && /React\.useEffect\(\(\) => \{ setArmed\(card\.armedVerbId \?\? null\); \}, \[card\.armedVerbId\]\);/.test(kit34)
    && /armedVerbId: proposal\.verb/.test(host34)
    // the proposal's own arguments arrive editable — the note prefilled, the window stated
    && /\.\.\.\(proposal\?\.note \? \{ note: proposal\.note \} : \{\}\)/.test(host34)
    && /\.\.\.\(proposal\?\.newLabel \? \{ proposedLabel: proposal\.newLabel \} : \{\}\)/.test(host34));

  // ── (d) WHAT IT COSTS, WHILE IT CAN STILL BE STOPPED ──
  gate('T34.7 EXACTLY THE IRREVERSIBLE VERBS CARRY A CONSEQUENCE LINE — the set is the contract’s, not a list this file keeps',
    (() => {
      const block = host34.match(/const CONSEQUENCE: Partial<Record<EventVerb, string>> = \{([\s\S]*?)\n\};/);
      if (!block) return false;
      const keys = [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
      const irreversible = (contract34.match(/export const IRREVERSIBLE_VERBS[^=]*=\s*\[([^\]]*)\]/) ?? [])[1] ?? '';
      const want = [...irreversible.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
      return want.length > 0 && JSON.stringify(keys) === JSON.stringify(want);
    })()
    // the host gates the line on the contract's own predicate, and the kit prints only what it is given
    && /IRREVERSIBLE_VERBS\.includes\(v\) && CONSEQUENCE\[v\]/.test(host34)
    && /armedVerb\?\.consequence && \(/.test(kit34));

  // ── (e) THE KIT DERIVES NOTHING, AND THE HOST OWNS THE CLOCK ──
  gate('T34.8 THE KIT READS NO CLOCK AND COMPOSES NO ISO — the picked wall time leaves as the three fields the user touched; the host turns it into a deed',
    !/new Date\(|Date\.now\(|toISOString/.test(kit34)
    && !/\bfetch\(/.test(kit34) && !/useRouter|supabase/i.test(kit34)
    && /pick\?: \{ date: string; time: string; durationMin: number \};/.test(types34)
    && /function windowFromPick\(/.test(host34)
    && /newStartISO: start\.toISOString\(\), newEndISO: end\.toISOString\(\)/.test(host34)
    // the picker starts on THE EVENT'S OWN window, never today and never a guess
    && /function pickerDefaultsOf\(spec: (EventSpec|Pick<EventSpec, 'startISO' \| 'endISO'>)\)/.test(host34)
    // ⟲ RE-POINTED (Sep 22 — W0.4): the defaults are MEMOIZED on the event's own window (a fresh
    // object per render reset the user's half-typed pick on every streamed token).
    && /useMemo\(\s*\(\) => \(specId \? pickerDefaultsOf\(/.test(host34));

  // ── (f) THE RE-READ, THE ONE DOOR, THE GUARD ──
  gate('T34.9 A PERSISTED CARD IS A POINTER — the stored component carries `{eventId, proposal?}` and the host RE-READS the event through its own door',
    /export type EventPointer = \{ eventId: string; proposal\?: EventProposal \| null \};/.test(host34)
    && /fetch\(`\/api\/events\/\$\{id\}\/card`\)/.test(host34)
    // ⟲ RE-POINTED (Sep 22 — W0.4): the re-read is keyed on the POINTER'S ID (a primitive), never the
    // pointer object — a parent re-render no longer cancels and refetches the card.
    && /pointer\?\.eventId/.test(host34) && !/\[pointer, /.test(host34)
    // the chief room's rehydrate hands over a POINTER and never a stored spec
    && /t\.component\?\.key === 'event_card'/.test(ask34)
    && (() => {
      const i = ask34.indexOf("t.component?.key === 'event_card'");
      const seg = ask34.slice(i, i + 900);
      return /pointer: \{/.test(seg) && !/\bspec:/.test(seg);
    })()
    // …and so does the DM's
    && (() => {
      const i = ask34.lastIndexOf('m.metadata?.events?.length');
      if (i === -1) return false;
      const seg = ask34.slice(i, i + 600);
      return /pointer: \{ eventId: e\.id/.test(seg) && !/\bspec:/.test(seg);
    })());

  gate('T34.10 THE 409 IS AN HONEST CORRECTION, NOT A RETRY — a withdrawn verb re-reads the event and says so in one quiet line',
    /if \(res\.status === 409\) \{/.test(host34)
    && /const fresh = await reread\(spec\.id\);/.test(host34)
    && /setError\('That’s no longer possible/.test(host34)
    // a plain failure restores the card and speaks once — never a toast
    && /setError\('That didn’t go through — try again\.'\);/.test(host34)
    && !/toast\(/.test(host34));

  gate('T34.11 `isEventSpec` GUARDS EVERY MOUNT — live, rehydrated, and the deed’s own reply; a malformed spec renders nothing',
    /isEventSpec\(seed\)/.test(host34)
    && /isEventSpec\(json\?\.spec\)/.test(host34)
    && /!isEventSpec\(json\?\.spec\)\) throw new Error\('deed'\)/.test(host34)
    && /isEventSpec\(d\.event\.spec\)/.test(ask34)
    && /isEventSpec\(event\.event\?\.spec \?\? event\.card\?\.spec\)/.test(ask34)
    // still-reading shows NOTHING rather than a skeleton of facts it has not read
    && /if \(!spec\) \{/.test(host34) && !/animate-pulse/.test(host34));

  gate('T34.12 EVERY DEED IS THE ONE DOOR — one POST to /api/events/<id>/deed, and the host mints no provider call of its own',
    /fetch\(`\/api\/events\/\$\{spec\.id\}\/deed`, \{\s*\n?\s*method: 'POST'/.test(host34)
    && (host34.match(/method: 'POST'/g) ?? []).length === 1
    && !/googleapis|graph\.microsoft|\/api\/invites\/|\/api\/calendar\//.test(host34)
    // …and the HOST is mounted once per surface, never a second card for the same object
    && (ask34.match(/<EventCard\b/g) ?? []).length === 1
    && /import EventCard, \{ type EventPointer \} from '@\/components\/home\/event-card'/.test(ask34));

  // ── (g) THE ROW OPENS IN PLACE, AND THE HARNESS HOLDS EVERY STATE ──
  gate('T34.13 THE CALENDAR ROW OPENS ITS EVENT IN PLACE — the row’s own door raises THE ONE event card under it, and the row still carries no RSVP verb of its own',
    /import EventCard from '@\/components\/home\/event-card'/.test(coll34)
    && /<EventCard pointer=\{\{ eventId: ev \}\} \/>/.test(coll34)
    && /expanded\?: ReactNode;/.test(types34)
    && /\{row\.expanded && <div className="px-4 pb-3">\{row\.expanded\}<\/div>\}/.test(kit34)
    // ONE STAGE AT A TIME — at most one row stands open
    && /setOpenRow\(\(cur\) => \(cur === row\.id \? null : row\.id\)\)/.test(coll34));

  gate('T34.14 the harness carries every state the card can be in — the three invitee sets · the organizer pair · an armed refusal with its note · an armed move with its window · a spent deed · a move’s receipt · a past event · a read-only calendar · an honest failure · DM mode',
    [
      'EVENT_INVITEE_NO_REPLY', 'EVENT_INVITEE_ACCEPTED', 'EVENT_ORGANIZER', 'EVENT_ARMED_DECLINE',
      'EVENT_ARMED_RESCHEDULE', 'EVENT_DONE', 'EVENT_MOVED', 'EVENT_PAST', 'EVENT_READ_ONLY', 'EVENT_FAILED',
    ].every((f) => harness34.includes(f))
    && /armedVerbId: 'decline'/.test(harness34) && /armedVerbId: 'reschedule'/.test(harness34)
    && /proposedLabel: 'Thu 25 Sep · 10:00–10:30'/.test(harness34)
    && /quietLine: 'This one’s in the past\.'/.test(harness34)
    && /quietLine: 'Read-only calendar\.'/.test(harness34)
    && /done: 'Declined'/.test(harness34)
    && /verbs: \[\]/.test(harness34)
    // the Event tab exists, and the SAME card also stands in DM mode (one card, every surface)
    && /\{ value: 'event', label: 'Event' \}/.test(harness34)
    && /items=\{EVENT_ITEMS\}/.test(harness34)
    && /cards: \[EVENT_ORGANIZER\][\s\S]{0,4000}RECORDINGS_COLLECTION/.test(harness34));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T35 · THE CONVERGENCE OF THE ASK AND THE GATE (W3-A — docs/component-map.md §2a, Sep 22)
//
// THE LAW OF THE WAVE: ONE OBJECT, ONE RENDERING. Every THREAD-SHAPED surface mounts the kit kind
// through one of two hosts; every NON-thread surface shares the same PIECES and the same DEED
// MODULE; and there is exactly ONE state vocabulary per object.
//
// Zero-AI and source-level, like the rest of this suite.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT35 · THE ASK AND THE GATE — one object, one rendering, one vocabulary');
{
  const kit = read('components/thread/thread-cards.tsx') ?? '';
  const types = read('components/thread/types.ts') ?? '';
  const rows = read('components/thread/ask-rows.tsx') ?? '';
  const gateHost = read('components/home/approval-card.tsx') ?? '';
  const askHost = read('components/home/input-card.tsx') ?? '';
  const doors = read('lib/deeds/gate-doors.ts') ?? '';
  const pieces = read('components/workflows/gate-pieces.tsx') ?? '';
  const vocab = read('lib/workflows/process-state.ts') ?? '';
  const rail = read('components/home/item-rail.tsx') ?? '';
  const detail = read('components/home/item-detail.tsx') ?? '';
  const drawer = read('components/workflows/process-drawer.tsx') ?? '';
  const form = read('components/workflows/input-supply-form.tsx') ?? '';
  const harness = read('app/(main)/dev/thread-preview/preview-client.tsx') ?? '';

  /** Every source file that could plausibly draw a card — the sweep's universe. */
  const UI = sourceFiles('components').concat(sourceFiles('app'));
  /** The two files allowed to compose an approval/input card, plus the kit and the harness. */
  const CARD_AUTHORS = new Set([
    'components/home/approval-card.tsx',
    'components/home/input-card.tsx',
    'components/thread/thread-cards.tsx',
    'components/thread/types.ts',
    'app/(main)/dev/thread-preview/preview-client.tsx',
    // RE-POINTED Sep 22 (THE CATALOGUE, T37 — never weakened): the dev harness's fixtures moved
    // into a second file when the index was added. Both harness files are the SAME carve-out, and
    // for the same reason: a preview's job is to render the states a reader meets, so it composes
    // card literals on purpose. Every PRODUCT surface still mounts a host.
    'app/(main)/dev/thread-preview/preview-catalogue.tsx',
    // ⟲ RE-POINTED Sep 22 (stabilization W0.3b, THE CONFIRM CARD — never weakened): a PREPARED
    // STATE CHANGE (lib/work/pending-change.ts) is a different OBJECT from a run gate, with the
    // same shape of question — apply this, or not — so its ONE host composes the kit's `approval`
    // kind with its own words (CHANGE_WORDS) and its own doors (/api/changes/[id]/apply · dismiss).
    // The law stands: ONE host per object. This is the change's host, not a third gate rendering;
    // smoke-confirm-cards.ts C9 pins it as the only file that mounts the change.
    'components/home/change-card.tsx',
  ]);

  // ── 1 · THE KIT EXPRESSES EVERY STATE THE COPIES EXPRESSED ────────────────────────────────────
  // RE-POINTED (W3-C, Sep 22 — never weakened): the judged DECISION is the THIRD kind whose whole
  // existence is a question put to the reader, so it carries the same lifecycle. The count moves
  // with the grammar, honestly, rather than the law being loosened to a >=.
  gate('T35.1 every answerable kind carries a LIFECYCLE — open · busy · settled — declared once, in the contract',
    /export type AnswerableState = 'open' \| 'busy' \| 'settled';/.test(types)
    && /state\?: AnswerableState;/.test(types)
    && (types.match(/state\?: AnswerableState;/g) ?? []).length === 3
    // …and the kit actually branches on it, on EVERY one of them
    && /const aState = card\.state \?\? 'open';/.test(kit)
    && /const iState = card\.state \?\? 'open';/.test(kit)
    && /const state = card\.state \?\? 'open';/.test(kit));

  gate('T35.2 A SETTLED CARD KEEPS NO VERBS — one receipt line stands where the deed stood, on both kinds',
    (() => {
      for (const k of ["case 'approval': {", "case 'input': {"]) {
        const i = kit.indexOf(k);
        if (i < 0) return false;
        const seg = kit.slice(i, i + 3400);
        // the verbs live strictly on the NOT-settled branch
        if (!/\{aSettled \? \(|\{iSettled \? \(/.test(seg)) return false;
        if (!/settledLine/.test(seg)) return false;
      }
      const a = kit.slice(kit.indexOf("case 'approval': {"), kit.indexOf("case 'input': {"));
      // Approve/Reject are inside the else-branch only
      return a.indexOf('aSettled ? (') < a.indexOf('onClick={card.onApprove}') + 1
        || /\) : \(\s*<>[\s\S]{0,1400}card\.onApprove/.test(a);
    })());

  gate('T35.3 AN ERROR IS A LINE, NEVER A STATE — the question it was asking is still the question',
    /error\?: string;/.test(types)
    && (kit.match(/card\.error && <div className="text-\[12px\] text-rose-600">/g) ?? []).length === 2
    && /There is deliberately no `error` state/.test(types));

  gate('T35.4 THE APPROVAL EXPRESSES EVERYTHING ITS COPIES DID — gate word · provenance · standing line · markdown object · the note · a footer',
    ['gateWord?: string;', 'meta?: string;', 'standingNode?: ReactNode;', 'previewNode?: ReactNode;',
      'noteValue?: string;', 'onNote?: (v: string) => void;', 'footer?: ReactNode;', 'statusChip?: string;']
      .every((f) => types.includes(f))
    // the markdown half is the SHARED renderer, mounted by the host — the kit renders no markdown
    && /<GateObject preview=\{spec\.preview\}/.test(gateHost)
    && !/MarkdownText/.test(kit));

  gate('T35.5 THE ASK EXPRESSES EVERYTHING ITS COPIES DID — the concrete rows · the station’s own supply form · the arrived trail',
    ['items?: string[];', 'supplyNode?: ReactNode;', 'contextNode?: ReactNode;'].every((f) => types.includes(f))
    // RE-POINTED Sep 22 (W4-B, THE TYPE-IT DOOR): the rows mount now forwards the per-row doors.
    // The LAW is unchanged and still exactly what is read — the kit mounts THE ONE rows leaf with
    // the card's own items, and draws no rows of its own.
    && /<AskRows rows=\{card\.items\}/.test(kit)
    && !/w-1 h-1 rounded-full bg-neutral-300/.test(kit)
    // the station's deed is the ONE shared form, mounted by the host — the kit draws no paste box
    && /<InputSupplyForm/.test(askHost)
    && !/textarea/.test(kit.slice(kit.indexOf("case 'input': {"), kit.indexOf("case 'input': {") + 3400)));

  gate('T35.6 THE SUPPLY FORM AND THE CHIPS ARE NEVER BOTH OFFERED (two doors to one deed)',
    /\{!card\.supplyNode && \(card\.onAttach \|\| card\.onPaste \|\| card\.onPickFile \|\| card\.onProceed\)/.test(kit));

  // ── 2 · ONE HOST PER OBJECT, AND IT IS THE ONLY THREAD-SHAPED RENDERING ────────────────────────
  gate('T35.7 NO FILE OUTSIDE THE KIT AND THE TWO HOSTS COMPOSES AN approval/input CARD',
    UI.filter((f) => !CARD_AUTHORS.has(f))
      .every((f) => {
        const src = (read(f) ?? '').replace(/^\s*\/\/.*$/gm, '');
        // a CARD literal (`kind: 'approval',`) — not a step-kind type union, which is a different
        // object and legitimately names the same word (run-record-drawer's `'approval' | 'handoff'`).
        return !/kind: 'approval',/.test(src) && !/kind: 'input',/.test(src);
      }),
    UI.filter((f) => !CARD_AUTHORS.has(f) && /kind: '(approval|input)',/.test((read(f) ?? '').replace(/^\s*\/\/.*$/gm, ''))).join(', '));

  gate('T35.8 THE OLD COPIES ARE GONE — the room’s hand-drawn gate and checklist, the deep-dive’s own optimistic gate, the band’s amber rows',
    // the room rail: no checklist block, no proceed chip, no inline resume fetch, no hand-typed chips
    !/const checklistBlock/.test(rail) && !/const proceedChip/.test(rail) && !/const proceedEngineAsk/.test(rail)
    && !/approved — delivering/.test(rail) && !/waiting on you/.test(rail)
    // the deep-dive: no gate state machine of its own
    && !/setSettled\('approved'/.test(detail) && !/const decidedWord =/.test(detail) && !/const settledWord =/.test(detail)
    // RE-POINTED (W4-D, Sep 22): the band whose amber checklist idiom this clause chased was
    // retired; the negative is now swept over EVERY UI file, so no surface can reintroduce it.
    && sourceFiles('components').concat(sourceFiles('app'))
      .every((f) => !/border-amber-100 bg-amber-50\/40/.test(read(f) ?? '')));

  gate('T35.9 EVERY THREAD-SHAPED SURFACE MOUNTS A HOST — the room stream, the pinned fold, the lifted ask, and both deep-dive gates',
    /import ApprovalCard from '@\/components\/home\/approval-card';/.test(rail)
    && /import InputCard from '@\/components\/home\/input-card';/.test(rail)
    && /<ApprovalCard/.test(rail) && /<InputCard/.test(rail)
    && /import ApprovalCard from '@\/components\/home\/approval-card';/.test(detail)
    && /import InputCard from '@\/components\/home\/input-card';/.test(detail)
    && /<ApprovalCard/.test(detail) && /<InputCard/.test(detail)
    // and the deep-dive no longer knows what a paste box looks like
    && !/import InputSupplyForm/.test(detail));

  gate('T35.10 A DRAWER IS NOT A THREAD — the process drawer shares the PIECES, and mounts no kit card',
    /import \{ GateStandingLine, GateAsk, GateObject \} from '@\/components\/workflows\/gate-pieces';/.test(drawer)
    && !/function GateStandingLine\(/.test(drawer) && !/function GateAsk\(/.test(drawer) && !/function GateObject\(/.test(drawer)
    && !/ThreadCardView/.test(drawer));

  gate('T35.11 ONE IMPLEMENTATION OF EVERY SHARED PIECE, across the whole tree',
    ['function GateStandingLine(', 'function GateAsk(', 'function GateObject(', 'function GateOutcomeChip(']
      .every((sig) => UI.filter((f) => (read(f) ?? '').includes(`export ${sig}`) || (read(f) ?? '').includes(sig)).length === 1)
    && /export function AskRows\(/.test(rows)
    && UI.filter((f) => /function AskRows\(/.test(read(f) ?? '')).length === 1);

  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): the "Needs your input" band this named
  // (components/home/waiting-on-you.tsx) had been unmounted since the threads arc and was retired
  // as unreachable — so the gate can no longer read the law off one instance. It reads the CLASS
  // instead, which is what the law always meant: the ask leaf and the proceed door each have ONE
  // implementation, and no surface anywhere draws its own rows or its own proceed fetch.
  gate('T35.12 EVERY ASK LIST SHARES THE LEAF AND THE DOOR, NOT A COPY (the class, not one band)',
    (() => {
      const UIFiles = sourceFiles('components').concat(sourceFiles('app'));
      const leafDefs = UIFiles.filter((f) => /export function AskRows\(/.test(read(f) ?? ''));
      const ownRows = UIFiles.filter((f) => f !== 'components/thread/ask-rows.tsx'
        && /function AskRows\(/.test(read(f) ?? ''));
      const ownProceed = UIFiles.filter((f) => /fetch\(['`]\/api\/room\/asks/.test(
        (read(f) ?? '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
      return leafDefs.length === 1 && leafDefs[0] === 'components/thread/ask-rows.tsx'
        && ownRows.length === 0 && ownProceed.length === 0
        && /export async function proceedAsk\(/.test(doors)
        && /import \{ proceedAsk, supplyAskText \} from '@\/lib\/deeds\/gate-doors';/
             .test(read('components/home/input-card.tsx') ?? '');
    })());

  // ── 3 · EXACTLY ONE CLIENT MODULE PER DOOR ────────────────────────────────────────────────────
  gate('T35.13 ONE CLIENT RESUME-DOOR MODULE — every approve/reject/supply in the product goes through it',
    /export async function resumeRun\(/.test(doors)
    && UI.filter((f) => /export async function resumeRun\(/.test(read(f) ?? '')).length === 0
    && (() => {
      const callers = UI.filter((f) => /\/api\/workflows\/runs\/\$\{[^}]+\}\/resume/.test((read(f) ?? '').replace(/^\s*\/\/.*$/gm, '')));
      return callers.length === 0;
    })()
    // …and the three surfaces that used to hold their own fetch now import it
    && /import \{ resumeRun/.test(drawer)
    && /import \{ resumeRun \} from '@\/lib\/deeds\/gate-doors';/.test(form)
    && /import \{ resumeRun, outcomeOf \} from '@\/lib\/deeds\/gate-doors';/.test(gateHost));

  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): one of the two callers was the Home's ask band
  // (components/home/waiting-on-you.tsx), unmounted since the threads arc and now retired. The law
  // is unchanged and the count follows the live seats: the ONE ask host fires the ONE door, and no
  // surface anywhere holds a raw fetch of its own.
  gate('T35.14 ONE CLIENT PROCEED-DOOR MODULE — the go-ahead is fired from the ask host alone, through it',
    /export async function proceedAsk\(/.test(doors)
    && UI.filter((f) => /fetch\('\/api\/room\/asks'/.test((read(f) ?? '').replace(/^\s*\/\/.*$/gm, ''))).length === 0
    && (() => {
      const callers = UI.filter((f) => /proceedAsk\(/.test(read(f) ?? ''));
      return callers.length === 1 && callers[0] === 'components/home/input-card.tsx';
    })());

  gate('T35.15 THE CONFLICT IS A FACT, NOT A RETRY — 409 is its own reason, and every caller reads it',
    /reason: 'conflict'/.test(doors) && /res\.status === 409/.test(doors)
    && /res\.reason === 'conflict'/.test(gateHost)
    && /res\.reason === 'conflict'/.test(askHost)
    && /res\.reason === 'conflict'/.test(drawer)
    // RE-POINTED (W4-D, Sep 22): the retired ask band was the fourth caller; the law is asserted as
    // the class instead — EVERY file that calls the door reads its conflict reason.
    && /res\.reason === 'conflict'/.test(read('components/home/input-card.tsx') ?? '')
    // the host does NOT roll back on a conflict (the gate really is closed)
    && /setElsewhere\(res\.message \?\? GATE_SETTLED_ELSEWHERE\)/.test(gateHost));

  gate('T35.16 THE NOTE RIDES THE DEED AND NEVER GATES IT — one implementation, best-effort, before the decision',
    /await fetch\(`\/api\/workflows\/runs\/\$\{runId\}\/comments`/.test(doors)
    && /catch \{ \/\* the decision is what matters — the note is a courtesy \*\//.test(doors)
    && /notable: true/.test(detail)
    // the deep-dive no longer posts the comment itself
    && !/runs\/\$\{runId\}\/comments/.test(detail));

  // ── 4 · ONE STATE VOCABULARY ──────────────────────────────────────────────────────────────────
  gate('T35.17 THE ONE GATE-OUTCOME VOCABULARY lives beside GATE_WORDS and nowhere else',
    /export type GateOutcome = 'approved' \| 'rejected' \| 'supplied';/.test(vocab)
    && /export const GATE_OUTCOME_WORDS: Record<GateOutcome/.test(vocab)
    && /export const GATE_SETTLED_ELSEWHERE =/.test(vocab)
    && /export const GATE_WAITING_CHIP =/.test(vocab)
    && sourceFiles('lib').concat(UI).filter((f) => /export const GATE_OUTCOME_WORDS/.test(read(f) ?? '')).length === 1);

  gate('T35.18 NO SURFACE DECLARES A GATE-STATE UNION OF ITS OWN — `decided`/`settled` derive from the one type or die',
    UI.every((f) => {
      const src = (read(f) ?? '').replace(/^\s*\/\/.*$/gm, '');
      // the three retired spellings, as TYPE unions (the drift the census found)
      return !/'approved' \| 'held'/.test(src)
        && !/'supplied' \| 'held' \| null/.test(src)
        && !/useState<'approved' \| 'rejected' \| 'supplied' \| null>/.test(src);
    }),
    UI.filter((f) => /'approved' \| 'held'|useState<'approved' \| 'rejected' \| 'supplied' \| null>/.test((read(f) ?? '').replace(/^\s*\/\/.*$/gm, ''))).join(', '));

  gate('T35.19 THE OUTCOME WORDS ARE READ, NEVER TYPED — no surface hand-writes a settle sentence',
    // The HARNESS types them deliberately: its whole job is to show the RENDERED state, so its
    // fixtures are the words as a reader meets them. Every PRODUCT surface reads the table.
    // (RE-POINTED Sep 22, THE CATALOGUE — the harness is TWO files now, the walks and the index;
    //  the carve-out follows the harness, not one filename. The law is unchanged.)
    UI.filter((f) => !f.startsWith('app/(main)/dev/thread-preview/'))
      .every((f) => {
        const src = (read(f) ?? '').replace(/^\s*\/\/.*$/gm, '');
        return !/'Approved — the run is delivering\.'/.test(src)
          && !/'Held back — nothing was delivered\.'/.test(src)
          && !/'This one has already been answered\.'/.test(src);
      })
    && /GATE_OUTCOME_WORDS\[outcome\]\.line/.test(gateHost)
    && /GATE_OUTCOME_WORDS\[outcome\]\.chip/.test(gateHost)
    && /GATE_OUTCOME_WORDS\.rejected\.line/.test(drawer));

  gate('T35.20 THE GATE WORD IS STILL GATE_WORDS’ — the host reads the kind table, it types no station word',
    /GATE_WORDS\[kind\]\.station/.test(gateHost)
    && !/'Your approval'/.test(gateHost) && !/'Needs input from you'/.test(gateHost));

  // ── 5 · THE BEHAVIOURS THE WAVE MUST NOT LOSE ─────────────────────────────────────────────────
  gate('T35.21 THE NEXT GATE ARMS — a fresh park at a LATER station still clears the decision state in place',
    // (CLAUDE.md, Sep 1 pilot wave (a): found ONLY by the browser walk — the polls refreshed
    //  everything except the gate cards, and sticky `decided` kept later gates 'upcoming'.)
    /if \(!decided\) return;/.test(drawer)
    && /process\.stepsDone > decidedStepsRef\.current/.test(drawer)
    && /setDecided\(null\);/.test(drawer)
    && /decidedStepsRef\.current = process\.stepsDone;/.test(drawer));

  gate('T35.22 A GO-AHEAD DOES NOT CLOSE AN ASK — it withdraws the door it used, and the missing things stay missing',
    /const wentAhead =/.test(askHost)
    && /const settled = settledAs === 'supplied' \|\| settledAs === 'held'/.test(askHost)
    && /!settled && !wentAhead && askAllowsGoAhead\(/.test(askHost));

  // RE-POINTED (W4-D, Sep 22 — THE RETIREMENT): the second caller was the retired ask band. The
  // law's point is that the test is not spelled at a seat — now literally one caller, the host.
  gate('T35.23 THE GO-AHEAD LAW HAS ONE CALLER AMONG THE ASK SEATS, and it is the host',
    UI.filter((f) => /askAllowsGoAhead\(/.test((read(f) ?? '').replace(/^\s*\/\/.*$/gm, ''))).length === 1
    && /askAllowsGoAhead\(/.test(askHost));

  gate('T35.24 THE STATION’S DEED IS STILL THE ONE SHARED FORM, mounted in exactly the places that can answer it',
    UI.filter((f) => /<InputSupplyForm/.test(read(f) ?? '')).length === 2
    && /<InputSupplyForm/.test(askHost) && /<InputSupplyForm/.test(drawer)
    // …and there is still exactly ONE paste box in the product
    && UI.filter((f) => /placeholder="Paste it here…"/.test(read(f) ?? '')).length === 1);

  gate('T35.25 THE HOSTS ARE HOSTS — they fetch through the door module and hold no route string of their own',
    !/fetch\(/.test(gateHost)
    && (askHost.match(/fetch\(/g) ?? []).length === 0
    && /THE CONFLICT IS NOT A ROLLBACK/.test(gateHost));

  // RE-POINTED Sep 22 (W4-B, THE TYPE-IT DOOR — narrowed, not relaxed). The rows leaf's blanket
  // `no useState` was a PROXY for presentational purity. A row now carries an inline field (typing
  // the fact is the whole door), and the draft text has to live somewhere: lifting it to the host
  // would put a text buffer in four surfaces — the exact fork this leaf exists to prevent. So the
  // law is now stated instead of proxied: the leaf may hold the EPHEMERAL FIELD and nothing else —
  // no fetch, no router, no supabase, and NO LIFECYCLE AT ALL (no effect, no ref, no timer), so it
  // still cannot observe, subscribe to, or mutate anything outside its own render.
  gate('T35.26 PRESENTATIONAL PURITY SURVIVES — the kit still fetches nothing and routes nowhere; the rows leaf holds the ephemeral field and no lifecycle',
    !/fetch\(/.test(kit) && !/useRouter/.test(kit) && !/supabase/i.test(kit)
    && !/fetch\(/.test(rows) && !/useRouter|next\/navigation/.test(rows) && !/supabase/i.test(rows)
    && !/useEffect|useLayoutEffect|useRef|setTimeout|setInterval/.test(rows)
    && (rows.match(/useState/g) ?? []).length <= 4);

  // ── 6 · THE HARNESS STOPS PROMISING MORE THAN THE PRODUCT ─────────────────────────────────────
  gate('T35.27 the harness mounts THE PRODUCT’S OWN HOSTS for the live states (not a fixture of a card nobody ships)',
    /import ApprovalCard from '@\/components\/home\/approval-card';/.test(harness)
    && /import InputCard from '@\/components\/home\/input-card';/.test(harness)
    && /<ApprovalCard/.test(harness) && /<InputCard/.test(harness)
    && /\{ value: 'gates', label: 'Gates & asks' \}/.test(harness));

  gate('T35.28 the harness carries EVERY state the two kinds can be in — open (gate · station · engine ask · a no-go-ahead ask) · busy · approved · held back · answered elsewhere · an honest failure',
    ['GATE_OPEN_HOST', 'GATE_STATION_HOST', 'ASK_ENGINE_HOST', 'ASK_NO_GO_AHEAD',
      'GATE_BUSY', 'GATE_SETTLED_APPROVED', 'GATE_SETTLED_REJECTED', 'GATE_SETTLED_ELSEWHERE', 'GATE_ERROR',
      'ASK_BUSY', 'ASK_SETTLED', 'ASK_ERROR'].every((f) => harness.includes(f))
    && /state: 'busy'/.test(harness) && /state: 'settled'/.test(harness)
    && /items=\{GATE_ITEMS\}/.test(harness));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T36 · THE DECISION AND THE FORWARD BECOME KIT KINDS (W3-C — docs/component-map.md §2 items 7–8)
//
// The last two interactive room objects with no kind of their own: the judged DECISION (a kit-less
// component in components/work/, whose DEED was hand-copied into two callers) and the prepared
// FORWARD (a local function inside item-detail.tsx, with the repo's FOURTH recipients editor and
// its own HTML thread rendering, whose artifact row degraded to "Open →").
//
// THE LAW OF THE WAVE, again: ONE OBJECT, ONE RENDERING — the kit renders, ONE host owns the door,
// and every state the old component could express survives in the contract.
//
// Zero-AI and source-level, like the rest of this suite.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT36 · THE DECISION AND THE FORWARD — the last two room objects join the grammar');
{
  const types36 = read('components/thread/types.ts') ?? '';
  const kit36 = read('components/thread/thread-cards.tsx') ?? '';
  const decHost = read('components/home/decision-card.tsx') ?? '';
  const fwdHost = read('components/home/forward-card.tsx') ?? '';
  const rail36 = read('components/home/item-rail.tsx') ?? '';
  const detail36 = read('components/home/item-detail.tsx') ?? '';
  const room36 = read('components/entities/entity-room.tsx') ?? '';
  const harness36 = read('app/(main)/dev/thread-preview/preview-client.tsx') ?? '';

  // ── 1 · THE TWO KINDS JOIN THE GRAMMAR ────────────────────────────────────────────────────────
  gate('T36.1 the `decision` and `forward` kinds join the grammar (contract · enumeration · the ONE switch · their own views)',
    /kind: 'decision';/.test(types36) && /export interface DecisionCard extends CardBase \{/.test(types36)
    && /export interface DecisionOption \{/.test(types36)
    && /kind: 'forward';/.test(types36) && /export interface ForwardCard extends CardBase \{/.test(types36)
    // MEMBERSHIP, never the neighbour list (the BD7.1 re-pointing lesson)
    && /THREAD_CARD_KINDS[\s\S]{0,500}'decision'/.test(types36)
    && /THREAD_CARD_KINDS[\s\S]{0,500}'forward'/.test(types36)
    && /case 'decision':/.test(kit36) && /<DecisionCardView card=\{card\} \/>/.test(kit36)
    && /case 'forward':/.test(kit36) && /<ForwardCardView card=\{card\} \/>/.test(kit36)
    && /function DecisionCardView\(/.test(kit36) && /function ForwardCardView\(/.test(kit36));

  gate('T36.2 THE HAND-DRAWN COPIES ARE GONE — no `DecisionCard`/`ForwardPreviewCard` component is defined anywhere but the kit and its two hosts',
    !fs.existsSync(path.join(ROOT, 'components/work/decision-card.tsx'))
    && sourceFiles('components').every((f) => {
      const src = read(f) ?? '';
      // A DEFINITION, not a mention: the kit's own view functions and the two hosts are the only
      // places either name may be declared.
      const defines = /function (DecisionCard|ForwardPreviewCard|ForwardCard)\b/.test(src)
        || /(const|let) (DecisionCard|ForwardPreviewCard|ForwardCard)\s*[:=]/.test(src);
      if (!defines) return true;
      return /components\/home\/(decision-card|forward-card)\.tsx$/.test(f);
    })
    // …and the retired local one leaves no orphan behind in the deep-dive
    && !/ForwardPreviewCard\s*[({]/.test(detail36));

  // ── 2 · ONE DOOR PER DEED, AND IT LIVES AT THE HOST ───────────────────────────────────────────
  gate('T36.3 THE DECISION’S ONE DOOR — the host is the only client caller of the steer door for a decision, and it carries THE FORWARD-MOTION LAW’s contract',
    /fetch\('\/api\/items\/steer'/.test(decHost)
    && (decHost.match(/fetch\(/g) ?? []).length === 1
    && /decision: \{\s*\n?\s*option: label,/.test(decHost)
    && /tradeoff: opt\?\.tradeoff \?\? null,/.test(decHost)
    // …and NEITHER caller re-types it any more (the two hand-copies this wave killed)
    && !/\/api\/items\/steer[\s\S]{0,400}decision:/.test(detail36)
    && !/\/api\/items\/steer[\s\S]{0,400}decision:/.test(room36)
    && /onChosen:/.test(detail36) && /onResolved:/.test(detail36)
    && /onChosen:/.test(room36) && /onResolved:/.test(room36));

  gate('T36.4 THE SECOND CLICK IS THE DEED (decision) — the un-armed click only arms, and every confirm call sits inside the armed branch',
    /isArmed \? \(setArmed\(null\), card\.onConfirm\?\.\(o\.label\)\) : setArmed\(o\.id\)/.test(kit36)
    && /\{isArmed && card\.onConfirm && \(/.test(kit36)
    // Escape and a click away disarm — a two-step's way out is never only a button
    && /if \(e\.key === 'Escape'\) setArmed\(null\)/.test(kit36)
    && /Never mind<\/button>/.test(kit36)
    && !/window\.confirm|globalThis\.confirm/.test(kit36));

  gate('T36.5 WITH NO OBJECT, NOTHING IS RECOMMENDED — the host reads the structural predicate and the kit only prints the mark it is handed',
    /import \{[\s\S]{0,160}mayRecommend/.test(decHost)
    && /const recommends = mayRecommend\(spec\.object\);/.test(decHost)
    && /const rec = recommends && isRec\(o\.label, spec\.recommendation\);/.test(decHost)
    // the kit derives nothing: it marks `recommended` and prints `why` only on a marked route
    && !/mayRecommend\(|\.recommendation\b/.test(kit36)
    && /\{o\.recommended && o\.why && \(/.test(kit36)
    // …and with no object at all, the honest sentence (ONE copy, from the law's own module)
    && /NO_DECISION_OBJECT_LINE/.test(decHost)
    && /quietLine: NO_DECISION_OBJECT_LINE/.test(decHost));

  gate('T36.6 OPTIMISTIC, WITH A ROLLBACK AND AN HONEST REFUSAL — the decision settles at once, a 409 stays settled, and only a real failure puts the question back',
    /setChosen\(label\);\s*\/\/ optimistic/.test(decHost)
    && /if \(res && res\.status === 409\) \{/.test(decHost)
    && /setElsewhere\(DECISION_WORDS\.settledElsewhere\);/.test(decHost)
    && /setChosen\(null\);\s*\/\/ rollback/.test(decHost)
    && /setError\(DECISION_WORDS\.failed\);/.test(decHost)
    // ONE VOCABULARY: the settled word is composed from the host's own table, never typed at a kit
    && /export const DECISION_WORDS = \{/.test(decHost)
    && /settledLine: elsewhere \?\? \(chosen \? DECISION_WORDS\.chosen\(chosen\) : undefined\)/.test(decHost)
    && !/toast\(/.test(decHost));

  // ── 3 · THE FORWARD: TWO DOORS, ONE ARMED COMMIT ──────────────────────────────────────────────
  gate('T36.7 THE FORWARD FIRES ONE DOOR, AND ONLY FROM THE ARMED CONFIRM — prepare READS, execute SENDS through the commit door, and the kit’s resting button only arms',
    // the host holds exactly two doors: the grounded read and the one commit
    /fetch\('\/api\/items\/prepare'/.test(fwdHost)
    && /fetch\('\/api\/items\/execute'/.test(fwdHost)
    // ⟲ RE-POINTED (W9.1 THE USER'S HAND WINS): + THE EDIT DOOR (saves the user's edited
    // recipients/note onto the prepared forward — never a send); still ONE send door.
    && (fwdHost.match(/fetch\(/g) ?? []).length === 3
    && /fetch\('\/api\/items\/prepared'/.test(fwdHost)
    && !/googleapis|graph\.microsoft|\/api\/emails\/send|\/api\/invites\//.test(fwdHost)
    && /action: \{ type: 'forward', to, note \}/.test(fwdHost)
    // the kit: resting arms, armed fires, and the deed is reached from exactly one place
    && /onClick=\{\(\) => setArmed\(true\)\}/.test(kit36)
    && (kit36.match(/card\.onSend!\(\)/g) ?? []).length === 1
    && /\{card\.armedLabel \?\? 'Confirm forward'\}/.test(kit36)
    // …and the host's only wiring of it
    && /onSend: \(\) => void send\(\)/.test(fwdHost));

  gate('T36.8 THE RECIPIENTS EDITOR IS THE ONE EDITOR — the forward mounts the shared people chips, and no fourth chips editor survives in the deep-dive',
    /import \{ AttendeeChips \} from '@\/components\/home\/people-chips'/.test(fwdHost)
    && /<AttendeeChips attendees=\{to\}/.test(fwdHost)
    // the local copy (and its private typeahead import) left item-detail with the card
    && !/function RecipientChips\(/.test(detail36)
    && !/PeopleSuggestInput/.test(detail36)
    // ONE COMPONENT NAME across the repo's people fields
    && sourceFiles('components').filter((f) => /export function AttendeeChips\(/.test(read(f) ?? '')).length === 1);

  gate('T36.9 THE MESSAGE BEING FORWARDED RIDES THE `source` KIND — one object rendering, folded, and no second thread renderer or HTML lane anywhere on this card',
    /import \{ SourceObjectMount \} from '@\/components\/room\/source-object'/.test(fwdHost)
    && /sourceNode: <SourceObjectMount itemId=\{entityId\} \/>/.test(fwdHost)
    && /\{showSource && card\.sourceNode\}/.test(kit36)
    // the retired card's own body renderer is gone from both the kit and the host
    && !/__html/.test(fwdHost)
    // …and the forward VIEW draws no HTML of its own (the email card's own lane is untouched)
    && !/dangerouslySetInnerHTML/.test((kit36.match(/function ForwardCardView\([\s\S]*?\n\}/) ?? [''])[0])
    && !/forwardedBody/.test(fwdHost)
    && !/forwardedBody/.test(detail36));

  gate('T36.10 TRUTH BEFORE PRESENTATION ON THE COMMIT ROW — no recipient carries no Send, and a sent forward keeps only its receipt',
    /state: sent \? 'sent' : to\.length === 0 \? 'needs_recipient' : 'ready'/.test(fwdHost)
    && /\{!sent && ready && card\.onSend && \(armed \? \(/.test(kit36)
    && /\.\.\.\(sent \? \{\} : \{ onSend: \(\) => void send\(\) \}\)/.test(fwdHost)
    && /receipt: sent \? FORWARD_WORDS\.sentLine\(to\)/.test(fwdHost)
    && /export const FORWARD_WORDS = \{/.test(fwdHost));

  gate('T36.11 THE PREPARED FORWARD ARRIVES AS ITSELF — its artifact row mounts the card instead of degrading to "Open →", and both deep-dive seats mount the same host',
    /key: 'forward', label: 'Forward prepared/.test(detail36)
    && /node: <ForwardCard kind="email" entityId=\{id\}/.test(detail36)
    && (detail36.match(/<ForwardCard\b/g) ?? []).length === 3
    && /import ForwardCard from '@\/components\/home\/forward-card'/.test(detail36));

  // ── 4 · PRESENTATIONAL PURITY, AND THE HARNESS ────────────────────────────────────────────────
  gate('T36.12 the kit still fetches nothing and routes nowhere (the two new kinds included)',
    !/fetch\(/.test(kit36) && !/useRouter/.test(kit36) && !/supabase/i.test(kit36)
    && !/new Date\(|Date\.now\(/.test(kit36));

  gate('T36.13 the harness carries every state both cards can be in — the decision open · with nothing to review · armed · in flight · settled · failed, and the forward ready · with no recipient · sending · sent · failed',
    ['DECISION_OPEN', 'DECISION_NO_OBJECT', 'DECISION_ARMED', 'DECISION_BUSY', 'DECISION_SETTLED', 'DECISION_ERROR',
      'FORWARD_READY', 'FORWARD_NEEDS_RECIPIENT', 'FORWARD_SENDING', 'FORWARD_SENT', 'FORWARD_ERROR',
    ].every((f) => harness36.includes(f))
    && /armedOptionId: 'o1'/.test(harness36)
    && /settledLine: 'Chosen: Advance all four to interviews'/.test(harness36)
    && /quietLine: 'Nothing is attached to review yet\.'/.test(harness36)
    && /state: 'needs_recipient'/.test(harness36)
    // both live cards stand on the PROJECT thread, and the rest on the HOME one
    && /cards: \[DECISION_OPEN\]/.test(harness36) && /cards: \[FORWARD_READY\]/.test(harness36)
    && /cards: \[DECISION_NO_OBJECT, DECISION_BUSY, DECISION_SETTLED, DECISION_ERROR\]/.test(harness36)
    && /cards: \[FORWARD_NEEDS_RECIPIENT, FORWARD_SENDING, FORWARD_SENT, FORWARD_ERROR\]/.test(harness36));
}

// ── T37 · THE CATALOGUE (owner, Sep 22: "update the dev/threads with all components we have") ───
// The harness's five tabs are WALKS — stories that happen to contain cards — and they were never a
// promise of coverage: `bulk` had no fixture at all, and email · doc · deliverable · invite · frame ·
// proposal each had exactly one state on screen while their contracts carried three to seven. So the
// harness gained an INDEX (app/(main)/dev/thread-preview/preview-catalogue.tsx): one section per kind
// of THREAD_CARD_KINDS, every state of each, then the pieces that are not cards.
//
// THE GATE THAT MATTERS IS T37.2: it reads the state unions OUT OF THE CONTRACT and demands a
// fixture per literal — so the day a state is added to a card's union without a specimen, this
// suite says so. A catalogue nobody gates goes stale in a week, and a stale catalogue is worse than
// none: it is a claim about the product that stopped being true.
//
// (RE-POINTED note, Sep 22: T33/T34/T36's harness gates still read preview-client.tsx — the five
// walks and their fixtures stayed exactly where they were. The catalogue is additive by design, so
// no existing tab-or-fixture count moved.)
console.log('\nT37 · THE CATALOGUE — every kind the kit owns, in every state its contract can be in');
{
  const cat = read('app/(main)/dev/thread-preview/preview-catalogue.tsx') ?? '';
  const client37 = read('app/(main)/dev/thread-preview/preview-client.tsx') ?? '';
  const types37 = read('components/thread/types.ts') ?? '';

  // THE KIND LIST COMES FROM THE CONTRACT, never from a list typed into this suite.
  const kindsBlock = (types37.match(/export const THREAD_CARD_KINDS: ThreadCardKind\[\] = \[[\s\S]*?\];/) ?? [''])[0];
  const KINDS = [...kindsBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  // Each section of the catalogue is one object carrying `section: '<kind>'`; a section's block runs
  // to the next marker, so a fixture is attributed to the kind whose section it stands in.
  const marks = [...cat.matchAll(/\n    section: '([a-z_]+)',/g)];
  const block = new Map<string, string>();
  marks.forEach((m, i) => {
    const start = m.index ?? 0;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? cat.length) : cat.length;
    block.set(m[1], cat.slice(start, end));
  });

  gate('T37.0 the Catalogue is the harness’s LAST tab and its fixtures live in their own file',
    cat.length > 0
    && /import \{ ThreadCatalogue \} from '\.\/preview-catalogue'/.test(client37)
    && /\{ value: 'catalogue', label: 'Catalogue' \}/.test(client37)
    && /\{tab === 'catalogue' && <ThreadCatalogue \/>\}/.test(client37)
    // …last: the gates tab is declared before it
    && client37.indexOf("value: 'catalogue'") > client37.indexOf("value: 'gates'"));

  // (1) EVERY KIND HAS A SEAT — a kind the kit owns that the index cannot show is a kind nobody
  // can review, which is how `bulk` went un-previewed for a whole arc.
  {
    const missing = KINDS.filter((k) => !block.has(k) || !new RegExp(`kind: '${k}'`).test(block.get(k) ?? ''));
    gate('T37.1 every kind of THREAD_CARD_KINDS has a catalogue section with at least one real fixture',
      // RE-POINTED (W4-A, Sep 22): 16 → 15. `routine` was retired — it had no producer in the
      // product (T38.1). The law is unchanged: EVERY kind the contract declares has a specimen.
      KINDS.length === 15 && missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `${KINDS.length} kinds`);
  }

  // (2) EVERY STATE OF EVERY STATEFUL KIND — read out of the contract's own unions.
  {
    const answerable = [...((types37.match(/export type AnswerableState =[^;]+;/) ?? [''])[0])
      .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const bodies = [...types37.matchAll(/export interface \w+ extends CardBase \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    const expected: Array<[string, string[]]> = [];
    for (const body of bodies) {
      const k = (body.match(/\n  kind: '([a-z_]+)';/) ?? [])[1];
      const st = body.match(/\n  state\??: ([^;]+);/);
      if (!k || !st) continue;
      const raw = st[1].trim();
      const lits = raw === 'AnswerableState'
        ? answerable
        : [...raw.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      if (lits.length) expected.push([k, lits]);
    }
    const holes: string[] = [];
    for (const [k, lits] of expected) {
      const b = block.get(k) ?? '';
      for (const lit of lits) if (!new RegExp(`state: '${lit}'`).test(b)) holes.push(`${k}·${lit}`);
    }
    gate('T37.2 EVERY STATE LITERAL OF EVERY CARD UNION HAS A FIXTURE (parsed from types.ts, so a new state fails this)',
      answerable.length === 3 && expected.length === 7 && holes.length === 0,
      holes.length ? `no fixture for: ${holes.join(', ')}`
        : `${expected.length} stateful kinds · ${expected.reduce((n, [, l]) => n + l.length, 0)} states`);
  }

  // (3) THE PIECES ARE MOUNTED, NEVER COPIED — the index must not grow a second drawing of the
  // header, the avatar, the composer or the mark (the whole reason a catalogue is trustworthy).
  {
    const MOUNTS: [string, RegExp, RegExp][] = [
      ['the header', /<ThreadHeader\b/, /function ThreadHeader\(/],
      ['the avatar ring', /<AvatarStatus\b/, /function AvatarStatus\(/],
      ['the composer', /<ThreadComposer\b/, /function ThreadComposer\(/],
      ['the timeline items', /<ThreadTimeline\b/, /function ThreadTimeline\(/],
      ['the eyes mark', /<AliveMark\b/, /function AliveMark\(/],
    ];
    const bad = MOUNTS.filter(([, use, copy]) => !use.test(cat) || copy.test(cat)).map(([l]) => l);
    gate('T37.3 the Pieces block MOUNTS the kit’s own pieces by import (header · avatar · composer · timeline · mark), and redefines none',
      bad.length === 0
      && /from '@\/components\/thread'/.test(cat)
      && /import \{ AliveMark \} from '@\/components\/home\/alive-mark'/.test(cat)
      && /import \{ OrbSeat, type OrbEntrance \} from '@\/components\/home\/orb-entrance'/.test(cat)
      // …and the product's own composer takes the seat, rather than a lookalike of it
      && /import \{ WorkerMentionInput \} from '@\/components\/workers\/worker-mention-input'/.test(cat),
      bad.join(', '));
  }

  // (3b) THE HOSTS ARE REAL WHERE A HOST EXISTS — a state seen here is a state the product has.
  gate('T37.3b the kinds a HOST owns mount that host (gate · ask · decision · collection · event)',
    /<ApprovalCard\b/.test(cat) && /<InputCard\b/.test(cat) && /<DecisionCard\b/.test(cat)
    && /<CollectionCard\b/.test(cat) && /<EventCard\b/.test(cat)
    // the forward host READS its artifact on mount, so the index says so instead of faking an id
    && /it READS its prepared artifact on mount/.test(cat));

  // (4) NO REAL NAMES ANYWHERE — the standing hard rule, swept on the fixtures themselves.
  {
    // The deny list itself must never live in the repo (that would be the violation it guards
    // against): it is read from the gitignored `.smoke-names.local` (one name per line, `#` comments).
    let REAL: RegExp | null = null;
    try {
      const names = fs.readFileSync(path.join(ROOT, '.smoke-names.local'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      if (names.length) REAL = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
    } catch { /* no local list — the gate states it and passes */ }
    const hit = REAL ? cat.match(REAL) : null;
    gate('T37.4 the catalogue’s fixtures carry NO real person or company names',
      !hit, hit ? `found "${hit[0]}"` : (REAL ? '' : 'no .smoke-names.local — sweep skipped'));
  }

  // (5) THE WALKS SURVIVE — the index is additive; the five scenario tabs are still there by label.
  {
    const LABELS = ['Project', 'Coworker DM', 'Home', 'Event', 'Gates & asks'];
    const gone = LABELS.filter((l) => !client37.includes(`label: '${l}'`));
    gate('T37.5 the five scenario tabs still stand (the catalogue is an index, never a replacement)',
      gone.length === 0, gone.join(', '));
  }
}

// ── T38 · THE PREVIEW IS THE PRODUCT (W4-A, Sep 22) ─────────────────────────────────────────────
// Owner, Sep 22: "in dev/threads I'd like to have the up to date working components, if that means
// retiring the sketches and including the actual ones and using them where they should be used, so
// be it."
//
// T37 proved the catalogue shows every kind the kit OWNS. It could not say whether anything in the
// PRODUCT ever builds one — so three kinds (`routine`, `frame`, `proposal`) sat in the contract, in
// the switch and in the harness while the product drew their objects by hand somewhere else. A kit
// kind nobody produces is a promise the preview makes on the product's behalf.
//
// T38.1 is the INVERSE of T37.1: for every kind of THREAD_CARD_KINDS, at least one PRODUCT file
// (components/ lib/ app/, excluding the kit itself and the dev harness) constructs `kind: '<k>'`.
// The day a kind is added to the contract without a producer, this suite says so.
console.log('\nT38 · THE PREVIEW IS THE PRODUCT — every kind the kit owns has a producer in the product');
{
  const types38 = read('components/thread/types.ts') ?? '';
  const kindsBlock38 = (types38.match(/export const THREAD_CARD_KINDS: ThreadCardKind\[\] = \[[\s\S]*?\];/) ?? [''])[0];
  const KINDS38 = [...kindsBlock38.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  // THE PRODUCT = everything but the kit's own presentational files and the dev harness. (The kit
  // may not produce its own cards — that is what made the three sketches invisible.)
  const files38 = [...sourceFiles('components'), ...sourceFiles('lib'), ...sourceFiles('app')]
    .filter((f) => !f.startsWith(path.join('components', 'thread'))
      && !f.includes(path.join('dev', 'thread-preview')));
  const producers = new Map<string, string[]>();
  for (const f of files38) {
    const s = read(f) ?? '';
    if (!/kind: '/.test(s)) continue;
    // …and it must SPEAK THE KIT: a file with a private union of its own that happens to share a
    // word is not a producer (the orphaned worker-activity-tab has its own `kind: 'routine'`).
    if (!/from '@\/components\/thread'/.test(s)) continue;
    for (const m of s.matchAll(/kind: '([a-z_]+)'(?: as const)?[,\s}]/g)) {
      if (!KINDS38.includes(m[1])) continue;
      const list = producers.get(m[1]) ?? [];
      if (!list.includes(f)) list.push(f);
      producers.set(m[1], list);
    }
  }
  const orphans = KINDS38.filter((k) => !(producers.get(k) ?? []).length);
  gate('T38.1 THE INVERSE GATE — every kind of THREAD_CARD_KINDS is CONSTRUCTED by at least one product file',
    KINDS38.length > 0 && orphans.length === 0,
    orphans.length ? `no producer for: ${orphans.join(', ')}` : `${KINDS38.length} kinds, all produced`);

  // T38.2 · ONE SANDBOX, ONE PRIMITIVE. Converging `frame` onto the kit must not grow a second
  // SCRIPT-RUNNING iframe: the srcdoc sandbox that runs code lives in components/frames/frame-card.tsx
  // and nowhere else. ⟲ RE-POINTED (Sep 22 — stabilization W0.1, precedence ruled in the laws
  // registry): inbound mail now renders in a second sandboxed frame with scripts OFF
  // (components/inbox/thread-messages.tsx). The law's actual protection — never OUR origin together
  // with running script — holds: allow-same-origin may appear only where allow-scripts never does
  // (smoke-render-safety enforces the pair per attribute).
  {
    const withIframe = [...sourceFiles('components'), ...sourceFiles('lib'), ...sourceFiles('app')]
      .filter((f) => /<iframe/.test(read(f) ?? ''));
    const code = (f: string) => (read(f) ?? '').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const scripted = withIframe.filter((f) => /['"`][^'"`\n]*allow-scripts/.test(code(f)) && /sandbox=/.test(code(f)));
    const sandboxed = withIframe.filter((f) => /sandbox=/.test(read(f) ?? ''));
    const allowedSandboxes = [path.join('components', 'frames', 'frame-card.tsx'), path.join('components', 'inbox', 'thread-messages.tsx')];
    const emailFrame = read(path.join('components', 'inbox', 'thread-messages.tsx')) ?? '';
    const frameCard = read(path.join('components', 'frames', 'frame-card.tsx')) ?? '';
    gate('T38.2 THE ONE FRAME PRIMITIVE — the script-running sandbox lives only in frame-card.tsx; the only other sandbox is the scripts-off mail frame; our origin never meets running script',
      scripted.length === 1 && scripted[0] === path.join('components', 'frames', 'frame-card.tsx')
      && sandboxed.every((f) => allowedSandboxes.includes(f))
      && !/allow-same-origin/.test(frameCard.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
      && /EMAIL_FRAME_SANDBOX = '[^']*'/.test(emailFrame) && !/EMAIL_FRAME_SANDBOX = '[^']*allow-scripts/.test(emailFrame),
      `scripted: ${scripted.join(', ') || 'none'} · sandboxed: ${sandboxed.join(', ') || 'none'}`);
  }

  // T38.3 · THE MOVE IS A CARD. The room's one primary deed used to be a bare ThreadAction pushed
  // into the pinned bubble's action row; it is the kit's `proposal` kind now, and no second
  // hand-drawn move row survives in the rail.
  {
    const rail38 = read('components/home/item-rail.tsx') ?? '';
    gate('T38.3 THE RAIL PRODUCES `proposal` — the MOVE is the kit kind, its target still code-validated against the board, and no bespoke move action row is left',
      /kind: 'proposal'/.test(rail38)
      && rail38.includes('THE MOVE + THE OFFERS')
      // the ref validation the MOVE has always carried (an invented ref renders no door)
      && /moveTargetId\(/.test(rail38)
      // …and the old seat is gone: nothing pushes the move into the pinned ACTION row any more
      && !/pinnedActions\.push\(\{ label: resp\.move\.label/.test(rail38),
      '');
  }

  // T38.4 · OFFERS ARE WORDS. The proposal's secondary offers carry a `say` and reach the room's
  // ONE composer door (`send`) — a chip that navigates instead of speaking is a different object.
  {
    const rail38 = read('components/home/item-rail.tsx') ?? '';
    const typ38 = read('components/thread/types.ts') ?? '';
    const propBody = (typ38.match(/export interface ProposalCard extends CardBase \{[\s\S]*?\n\}/) ?? [''])[0];
    gate('T38.4 THE OFFERS STAY UTTERANCES — the contract carries `say`, and the rail sends them through its one composer door',
      /offers\?: Array<\{ label: string; say: string \}>/.test(propBody)
      && /onSay\?: /.test(propBody)
      && /onSay: \(say: string\) => \{ void send\(say\); \}/.test(rail38));
  }

  // T38.5 · THE SKETCH IS RETIRED. `routine` had no producer and never will: a standing
  // responsibility is rendered by the standing-spec card (its proposal) and by the collection card
  // (the list of them). The kind is gone from the contract, the enumeration, the switch and the
  // catalogue — a dead kind in a union is a promise nobody keeps.
  {
    const typ38 = read('components/thread/types.ts') ?? '';
    const cards38 = read('components/thread/thread-cards.tsx') ?? '';
    const cat38 = read('app/(main)/dev/thread-preview/preview-catalogue.tsx') ?? '';
    gate('T38.5 `routine` IS RETIRED from the contract, the switch and the catalogue (the standing-spec card and the collection card are its rendering)',
      !/'routine'/.test(typ38) && !/RoutineCard/.test(typ38)
      && !/case 'routine'/.test(cards38)
      && !/section: 'routine'/.test(cat38)
      && (read('components/home/item-rail.tsx') ?? '').includes('Confirm — start it'));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T39 · THE TYPE-IT DOOR (W4-B, Sep 22 — owner: "banking details for example could just be typed if
// IBAN only? we should try to allow to be as easy as possible to the user (typing short info easier
// than finding attachment) but keeping options open")
//
// An ask's two doors both sent the reader hunting for a FILE. Most of what an ask is missing is a
// fact — a reference, an IBAN, an amount, an address — and for those, typing it is the cheapest
// honest answer in the product. The laws this section holds:
//
//   ONE DOOR        the typed supply posts to exactly one route, through exactly one client caller.
//   ONE KEY         a typed fact and a resolved file stage under the SAME `require:<label>`, so
//                   artifactTruth, the judge route's "everything staged" count and the D3 re-open
//                   cannot tell them apart.
//   FAIL-CLOSED     a label the ask does not carry is a 404, decided BEFORE anything is written.
//   ONE SETTLE      the ask settles through settleAsksForItem — never a second covers/settle.
//   ONE RE-OPEN     the typed door and the attach funnel call the same re-open.
//   OPTIONS OPEN    all three doors on every row, always; `lead` only REORDERS them.
//   THEIR CLICK     a line already typed in the composer is OFFERED, never consumed (the
//                   ask-direction floor, in the other direction).
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT39 · THE TYPE-IT DOOR — an ask answered by saying the fact');
{
  const asksRoute = read('app/api/room/asks/route.ts') ?? '';
  const doors = read('lib/deeds/gate-doors.ts') ?? '';
  const supplyLib = read('lib/prepare/supply.ts') ?? '';
  const reqs = read('lib/prepare/requirements.ts') ?? '';
  const ingest = read('app/api/items/ingest/route.ts') ?? '';
  const judgeRoute = read('app/api/items/judge/route.ts') ?? '';
  const rows = read('components/thread/ask-rows.tsx') ?? '';
  const host = read('components/home/input-card.tsx') ?? '';
  const cards = read('components/thread/thread-cards.tsx') ?? '';
  const typ = read('components/thread/types.ts') ?? '';

  gate('T39.1 THE DOOR EXISTS AND IS THE ONE CALLER — the asks route takes action:"supply", gate-doors owns the only client post of it, and nothing else in the app posts a typed supply',
    /action !== 'proceed' && body\.action !== 'supply'|body\.action === 'supply'/.test(asksRoute)
    && /export async function supplyAskText\(/.test(doors)
    && /action: 'supply'/.test(doors)
    && (() => {
      const others = [...sourceFiles('components'), ...sourceFiles('app'), ...sourceFiles('hooks')]
        .filter((f) => !f.endsWith('api/room/asks/route.ts'))
        .filter((f) => /action:\s*'supply'/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
      return others.length === 0;
    })());

  gate('T39.2 FAIL-CLOSED ON AN UNKNOWN LABEL — the row must be one the ask is CARRYING (exact match, not a prefix), and the 404 is decided BEFORE anything is staged',
    /const row = items\.find\(\(i\) => i === wanted\)/.test(asksRoute)
    && /if \(!row\) return NextResponse\.json\(\{ error: 'ask not found' \}, \{ status: 404 \}\)/.test(asksRoute)
    && asksRoute.indexOf("if (!row) return NextResponse.json({ error: 'ask not found' }") < asksRoute.indexOf('await stageTypedSupply(')
    && /SUPPLY_TEXT_MAX/.test(asksRoute));

  gate('T39.3 ONE REQUIREMENT KEY — `require:<label>` is spelled ONCE (lib/prepare/supply.ts), and the resolver, the judge route and the typed door all read it through that one function',
    /export function requireTaskId\(label: string\): string \{\s*return `require:\$\{String\(label \?\? ''\)\.toLowerCase\(\)\.slice\(0, 60\)\}`/.test(supplyLib)
    && /taskId: requireTaskId\(label\)/.test(reqs)
    && /requires\.map\(\(r\) => requireTaskId\(r\.label\)\)/.test(judgeRoute)
    // No hand-spelled copy survives anywhere in lib/ or app/ but the one definition.
    && (() => {
      const hand = [...sourceFiles('lib'), ...sourceFiles('app')]
        .filter((f) => !f.endsWith('lib/prepare/supply.ts'))
        .filter((f) => /`require:\$\{/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
      return hand.length === 0;
    })());

  gate('T39.4 THE STAGED ROW IS THE SAME FACT AS A RESOLVED FILE — same key, same item scope, same `metadata.requirement` and the same `source: requirement_resolution` the resolver stamps (the drafter cannot tell a typed fact from a found one)',
    /taskId: requireTaskId\(args\.label\)/.test(supplyLib)
    && /source: 'requirement_resolution'/.test(supplyLib)
    && /requirement: args\.label/.test(supplyLib)
    && /source: 'requirement_resolution', requirement: label/.test(reqs)
    // …and the honest difference: a typed fact is a `text` deliverable, whose body renders inline.
    && /type: 'text'/.test(supplyLib));

  gate('T39.5 ONE SETTLE — the ask settles through the shared covers-aware settleAsksForItem, only when the LAST row is covered, and the route defines no settle of its own',
    /if \(!remaining\.length\) \{[\s\S]{0,200}settleAsksForItem/.test(asksRoute)
    && /const \{ settleAsksForItem \} = await import\('@\/lib\/room\/turns'\)/.test(asksRoute)
    && !/archived_at: new Date\(\)\.toISOString\(\)/.test(asksRoute)
    // the ONE implementation still lives in lib/room/turns.ts and nowhere else
    && (() => {
      const impls = [...sourceFiles('lib'), ...sourceFiles('app')]
        .filter((f) => /export async function settleAsksForItem/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
      return impls.length === 1 && impls[0].endsWith('lib/room/turns.ts');
    })());

  gate('T39.6 ONE RE-OPEN — the typed door and the rail’s attach funnel call the SAME reopenAfterSupply, and the ingest route no longer drops `generated_at` by hand',
    /export async function reopenAfterSupply\(/.test(supplyLib)
    && /reopenAfterSupply\(supabase, userId, \{ itemKind: item\.kind, itemId: item\.id \}\)/.test(asksRoute)
    && /reopenAfterSupply\(supabase, user\.id/.test(ingest)
    && !/draft: \{ \.\.\.dr, generated_at: undefined \}/.test(ingest)
    && /draft: \{ \.\.\.dr, generated_at: undefined \}/.test(supplyLib));

  gate('T39.7 ZERO AI ON THE SUPPLY LANE — the door reasons about nothing: it stages what it was given',
    !/aiCall|getAIClient|aiCreate/.test(asksRoute) && !/aiCall|getAIClient|aiCreate/.test(supplyLib));

  // ── THE DEFAULT DOOR: the truth table, run against the REAL predicate ────────────────────────
  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { askItemShape, saidItLabels } = require('../lib/room/go-ahead') as typeof import('../lib/room/go-ahead');
    const DOCS: Array<[string, string]> = [
      ['EN', 'The signed addendum'], ['EN', 'Last quarter’s statement'], ['EN', 'The candidate’s CV'],
      ['PT', 'O extrato bancário'], ['PT', 'O contrato assinado'], ['PT', 'A fatura de Julho'],
      ['DE', 'Der unterschriebene Vertrag'], ['DE', 'Der Kontoauszug'], ['DE', 'Die Rechnung'],
      ['FR', 'Le contrat signé'], ['FR', 'Le relevé bancaire'], ['FR', 'La facture'],
    ];
    const FACTS: Array<[string, string]> = [
      ['EN', 'The IBAN'], ['EN', 'The account reference'], ['EN', 'The delivery address'],
      ['PT', 'O IBAN da conta'], ['PT', 'A morada de entrega'], ['PT', 'O número de contribuinte'],
      ['DE', 'Die IBAN'], ['DE', 'Die Lieferadresse'], ['DE', 'Der Ansprechpartner'],
      ['FR', 'L’IBAN'], ['FR', 'Le montant exact'], ['FR', 'La date de livraison'],
    ];
    const wrongDoc = DOCS.filter(([, l]) => askItemShape(l) !== 'document').map(([g, l]) => `${g}:${l}`);
    const wrongFact = FACTS.filter(([, l]) => askItemShape(l) !== 'fact').map(([g, l]) => `${g}:${l}`);
    gate(`T39.8 THE DEFAULT DOOR IS DETERMINISTIC AND FOUR-LANGUAGE — ${DOCS.length} document-shaped and ${FACTS.length} fact-shaped labels across EN · PT · DE · FR lead with the right door`,
      wrongDoc.length === 0 && wrongFact.length === 0,
      [...wrongDoc.map((x) => `doc→fact ${x}`), ...wrongFact.map((x) => `fact→doc ${x}`)].join(' · '));

    gate('T39.9 THE SAID-IT OFFER IS NARROW BY CONSTRUCTION — a short fact-shaped line on a small fact-shaped ask offers; a question, a paragraph, a long line, a document gap or a crowded ask offers nothing',
      saidItLabels(['The IBAN'], 'PT50 0000 0000 0000 0000 0000 0').length === 1
      && saidItLabels(['The IBAN', 'The account reference'], 'REF-0000').length === 2
      && saidItLabels(['The IBAN'], 'what IBAN do you mean?').length === 0
      && saidItLabels(['The IBAN'], 'line one\nline two').length === 0
      && saidItLabels(['The IBAN'], 'x'.repeat(400)).length === 0
      && saidItLabels(['The signed addendum'], 'REF-0000').length === 0
      && saidItLabels(['The IBAN', 'The reference', 'The amount'], 'REF-0000').length === 0
      && saidItLabels(['The IBAN'], '').length === 0);
  }

  gate('T39.10 OPTIONS STAY OPEN — `lead` only REORDERS: Attach and Type it are in BOTH branches of the row’s door list, and nothing in the leaf can drop a door the host handed over',
    (() => {
      const list = (rows.match(/const doorList = [\s\S]*?\: \[\];/) ?? [''])[0];
      const fact = (list.match(/d\.lead === 'fact'[\s\S]*?\]\s*\n\s*\/\/ A DOCUMENT/) ?? [''])[0];
      const doc = list.slice(list.indexOf('// A DOCUMENT'));
      return /canType \?/.test(fact) && /d\.onAttach \?/.test(fact)
        && /canType \?/.test(doc) && /d\.onAttach \?/.test(doc)
        && /d\.onPointToIt \?/.test(fact) && /d\.onPointToIt \?/.test(doc);
    })());

  gate('T39.11 THE DOORS RIDE THE ROW, AND ONLY ONCE — the contract carries `rowDoors`, the kit hands them to the ONE rows leaf, and a card with rows never ALSO wears the card-level chips (one deed, one door)',
    /rowDoors\?: Array<AskRowDoors \| null>/.test(typ)
    && /<AskRows rows=\{card\.items\} \{\.\.\.\(card\.rowDoors \? \{ doors: card\.rowDoors \} : \{\}\)\} \/>/.test(cards)
    && /spec\.items\.length\s*\?\s*\{ rowDoors \}/.test(host)
    // the host still hands a shaped lead per row, from the ONE predicate
    && /lead: askItemShape\(label\)/.test(host));

  gate('T39.12 THE ROWS LEAF STAYS PRESENTATIONAL — a field and a callback, never a fetch, a router or a client of its own',
    !/fetch\(|supabase|useRouter|next\/navigation/.test(rows)
    && /onType\?: \(text: string\) => void \| Promise<boolean \| void>/.test(rows)
    // …and a failure never destroys what was typed: the field keeps it.
    && /if \(ok === false\) return;/.test(rows));

  gate('T39.13 THE RECEIPT IS THE ROW AND THE LAST ROW SETTLES — a supplied row shows what was typed, and the card settles as `supplied` once every row is covered',
    /supplied\?: string \| null/.test(rows)
    && /d\?\.supplied &&/.test(rows)
    && /if \(Object\.keys\(next\)\.length >= total\) settle\('supplied'\)/.test(host)
    // a conflict stays a FACT here too — the ask was answered elsewhere, not a retry
    && /res\.reason === 'conflict'[\s\S]{0,120}setElsewhere/.test(host));

  gate('T39.14 THE HARNESS CARRIES THE NEW ROW STATES — fact-led · document-led · mid-deed · refused · supplied ✓ · the said-it offer, and the Gates tab mounts the product’s own host with all three doors',
    (() => {
      const cat = read('app/(main)/dev/thread-preview/preview-catalogue.tsx') ?? '';
      const cli = read('app/(main)/dev/thread-preview/preview-client.tsx') ?? '';
      return /fact-led: Type it leads/.test(cat)
        && /document-led: Attach leads/.test(cat)
        && /supplied: 'PT50 0000 0000/.test(cat)
        && /saidIt: \{ label: 'Use this as/.test(cat)
        && /busy: true/.test(cat)
        && /error: 'That’s longer than this door takes/.test(cat)
        && /ASK_TYPE_IT/.test(cli) && /recentUserText: 'REF-0000-2026'/.test(cli);
    })());
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// T40 · THE LIVE CARDS REACH THE LANES THAT HAD NONE (W4-C, Sep 22 — docs/component-map.md §6)
//
// Three seats where the product BUILT a card and then could not show it:
//
//   THE AGENTOS DM   a coworker on the box calls a Python @tool → our own internal route → the SAME
//                    executor the native loop runs, which already returns BOTH halves. Only
//                    `modelText` could get home: a tool's return STRING is the only channel back to
//                    the box, and rows in a model's context are the leak THE PRESENTATION LAW ends.
//                    So the DATA half takes a SIDE-CHANNEL (lib/present/dm-channel.ts) — written by
//                    the internal route, drained by the bridge, emitted as the SAME frames the
//                    native route emits. NOTHING model-facing changes.
//   THE ROOMS        the one core already handed rooms `collection` / `event`; nothing wrote the
//                    turn, so nothing rendered. A CARD IS A TURN — the pointer rides
//                    `room_turns.component` in the SAME shape the Home chat stores.
//   THE DELEGATION   the artifact lane hard-coded the word "document" over every deliverable,
//                    including frames. THE TYPE IS STATED, NOT GUESSED: the production door's own
//                    verdict rides up with the id.
//
// ONE POINTER SHAPE across all of it: `{id, kind, framing, params}` / `{eventId, proposal}`, from
// lib/present/pointer.ts — never the rows, never the verb ladder, because those are exactly what a
// reload would lie about.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT40 · THE LIVE CARDS, WHERE THEY WERE MISSING');
{
  const bridge = read('lib/work/agentos-bridge.ts') ?? '';
  const channel = read('lib/present/dm-channel.ts') ?? '';
  const pointer = read('lib/present/pointer.ts') ?? '';
  const nativeDM = read('app/api/work/threads/[id]/chat/route.ts') ?? '';
  const toolsRoute = read('app/api/internal/agentos/tools/route.ts') ?? '';
  const tasksRoute = read('app/api/internal/agentos/tasks/route.ts') ?? '';
  const pyData = read('infra/agentos/tools_data.py') ?? '';
  const pyTasks = read('infra/agentos/tools_tasks.py') ?? '';
  const rail = read('components/home/item-rail.tsx') ?? '';
  const steer = read('app/api/items/steer/route.ts') ?? '';
  const ask = read('components/home/home-ask.tsx') ?? '';
  const delegate = read('lib/home/delegate.ts') ?? '';

  gate('T40.1 THE BRIDGE EMITS THE NATIVE ROUTE’S OWN FRAMES — the AgentOS lane drains the side-channel and sends byte-identical `{type:collection}` / `{type:event}` shapes, on presenting tools and once more at the end',
    /clearDmPresents\(adminClient, userId, threadId\)/.test(bridge)
    && /const drainPresents = async \(\)/.test(bridge)
    && /PRESENTING_TOOLS\.includes\(name\)\) await drainPresents\(\)/.test(bridge)
    // the last drain runs on the completion path, not only inside the tool branch
    && /thinking_done' \}\)\n\s*\/\/[\s\S]{0,260}?await drainPresents\(\)/.test(bridge)
    && /send\(\{ type: 'collection', collection: \{ id, spec: e\.collection \} \}\)/.test(bridge)
    && /send\(\{ type: 'event', event: \{ id: crypto\.randomUUID\(\), spec: e\.event \} \}\)/.test(bridge)
    // …and the native route still emits exactly those two shapes (the comparison this gate makes)
    && /send\(\{ type: 'collection', collection: \{ id, spec \} \}\)/.test(nativeDM)
    && /send\(\{ type: 'event', event: \{ id: crypto\.randomUUID\(\), spec \} \}\)/.test(nativeDM));

  gate('T40.2 ONE POINTER, ONE HELPER — both coworker lanes persist `collections`/`events` through collectionPointer/eventPointer, and NEITHER hand-types the pointer object',
    /export function collectionPointer\(/.test(pointer) && /export function eventPointer\(/.test(pointer)
    && /allCollections\.push\(collectionPointer\(id, spec\)\)/.test(nativeDM)
    && /allEventCards\.push\(eventPointer\(spec\)\)/.test(nativeDM)
    && /allCollections\.push\(collectionPointer\(id, e\.collection\)\)/.test(bridge)
    && /allEventCards\.push\(eventPointer\(e\.event\)\)/.test(bridge)
    // the record carries the pointer on BOTH lanes, under the same metadata names
    && [nativeDM, bridge].every((s) =>
      /\{ collections: allCollections \}/.test(s) && /\{ events: allEventCards \}/.test(s))
    // nobody rebuilds the shape by hand beside the helper
    && !/allCollections\.push\(\{\s*id/.test(bridge) && !/allEventCards\.push\(\{\s*eventId/.test(bridge));

  gate('T40.3 THE MODEL NEVER HOLDS THE DATA — the internal routes answer with `result` ONLY (the spec goes to the side-channel), and the Python tool list now carries prepare_event_action',
    // both internal doors return exactly one body shape, and it is the model's half
    /return NextResponse\.json\(\{ result \}\);/.test(toolsRoute)
    && /return NextResponse\.json\(\{ result \}\);/.test(tasksRoute)
    && !/NextResponse\.json\(\{[^}]*present/.test(toolsRoute)
    && !/NextResponse\.json\(\{[^}]*spec/.test(toolsRoute)
    && !/NextResponse\.json\(\{[^}]*rows/.test(tasksRoute)
    // the present lanes exist on both doors and write ONLY to the channel
    && /pushDmPresent\(ac, user_id, thread_id, \{ turn: turnId/.test(toolsRoute)
    && /pushDmPresent\(ac, user_id, threadId, \{ turn: turnId/.test(tasksRoute)
    // the box's own vocabulary carries the verb, and the thread/turn keys reach both doors
    && /^def prepare_event_action\(/m.test(pyData)
    && /prepare_event_action,/.test(pyData)
    && /"turn_id": deps\.get\("turn_id"\)/.test(pyData)
    && /"thread_id": deps\.get\("thread_id"\)/.test(pyTasks)
    // the drain table names every presenting tool the routes can leave a card for
    && ['list_tasks', 'search_knowledge_base', 'get_meeting_context', 'check_calendar', 'prepare_event_action']
      .every((t) => new RegExp(`'${t}'`).test(channel)));

  gate('T40.4 THE ROOMS MOUNT THE TWO HOSTS — the rail reads both component keys back as POINTERS and mounts the SAME CollectionCard / EventCard the Home chat mounts; the room door writes the turn',
    /import CollectionCard, \{ type CollectionPointer \}/.test(rail)
    && /import EventCard, \{ type EventPointer \}/.test(rail)
    && /t\.component\?\.key === 'collection_card'/.test(rail)
    && /t\.component\?\.key === 'event_card'/.test(rail)
    && /<CollectionCard/.test(rail) && /<EventCard/.test(rail)
    // the rehydrated turn hands over the POINTER, never a stored spec
    && /turn\.collection = \{[\s\S]{0,200}?pointer: \{\s*\n?\s*kind:/.test(rail)
    && !/turn\.collection = \{[\s\S]{0,200}?rows:/.test(rail)
    // …and the room's converse door persists it through the ONE shared component builder
    && /collectionTurnComponent, eventTurnComponent/.test(steer)
    && /component: collectionTurnComponent\(turn\.collection\.id, turn\.collection\.spec\)/.test(steer)
    && /component: eventTurnComponent\(turn\.event\.spec\)/.test(steer)
    && /export function collectionTurnComponent\(/.test(pointer)
    && /export function eventTurnComponent\(/.test(pointer)
    // the stored shape is the one home-ask already reads (same key, same state fields)
    && /key: 'collection_card', refId: p\.id/.test(pointer)
    && /key: 'event_card', refId: p\.eventId/.test(pointer));

  gate('T40.5 THE ARTIFACT LANE READS A STATED TYPE — the production door’s own verdict rides from materialize through the delegation to the card, and the chat lane no longer hard-codes "document"',
    /artifacts\.push\(\{ id: artifactId, title, threadId: artifactThread, type: m\.type \}\)/.test(delegate)
    && /artifacts\?: Array<\{ id: string; title: string; threadId: string; type\?: string \}>/.test(delegate)
    && /const at = String\(a\.type \?\? 'document'\)/.test(ask)
    && /if \(at === 'frame'\)/.test(ask)
    && /frame: \{ artifactId: a\.id \}/.test(ask)
    && /docCardTypeOf\(at, null\)/.test(ask)
    && !/docCardTypeOf\('document', null\)/.test(ask));

  gate('T40.6 THE SIDE-CHANNEL IS A TRANSPORT, NOT A RECORD — cleared before the run, deleted the moment it is read, capped, turn-stamped, and never allowed to break a chat',
    /export const DM_PRESENT_KIND = 'dm_present'/.test(channel)
    && /export async function clearDmPresents/.test(channel)
    && /await clearDmPresents\(admin, userId, threadId\);/.test(channel)   // the drain deletes
    && /DM_PRESENT_MAX/.test(channel)
    && /e\.turn == null \|\| turn == null \|\| e\.turn === turn/.test(channel)
    // every door is best-effort: a channel failure can never change what the model was told
    && (channel.match(/catch \{/g) ?? []).length >= 3
    && /catch \{ return \[\]; \}/.test(channel));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T41 · THE TRACE LINE + THE CITATIONS (Sep 22 — the coworker DM's receipt layer)
//
// THE GAP, named by the retirement census ("Harvested" §1): tool chips and KB citation chips
// reached the user through ONE render — the /workers chat tab's five SSE branches — and that file
// is gone. Retiring it did not create the gap, it made it visible: a coworker could read your
// calendar, your Knowledge and your inbox and say nothing about having done so.
//
// THE RECEIPT IS NOT A WIDGET. Two laws close it, and neither adds a kind:
//
//   THE TRACE LINE      is the timeline's MUTED EVENT LINE — "deltas, not events", no author, no
//                       affordance. One line per call while the work runs, folded to ONE once the
//                       answer lands. Its WORDS come only from lib/work/trace.ts; a tool absent
//                       from that table renders NOTHING (never its id, never the model's prose —
//                       the drift lib/work/tool-summaries.ts was written to end). What persists is
//                       `{tool, ok}`: a receipt carrying arguments or results is a second copy of
//                       the user's data.
//   THE CITATIONS       are a `documents` COLLECTION — the card the product already has, through
//                       the host it already has, with `cited` as the rows' status word. No new
//                       kind, no new host, no bespoke chip. Built from the groups the answer was
//                       GROUNDED IN (one read, two renderings); nothing cited ⇒ no card at all.
//
// ONE HELPER ON BOTH RUNTIMES: `buildTrace` is the only producer of `metadata.trace`, and
// `toolResultOk` the only reader of an outcome, so the native DM route and the AgentOS bridge
// cannot disagree about what happened or how to say it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nT41 · THE TRACE LINE + THE CITATIONS');
{
  const trace = read('lib/work/trace.ts') ?? '';
  const summaries = read('lib/work/tool-summaries.ts') ?? '';
  const timeline = read('components/thread/thread-timeline.tsx') ?? '';
  const threadTypes = read('components/thread/types.ts') ?? '';
  const nativeDM = read('app/api/work/threads/[id]/chat/route.ts') ?? '';
  const bridge = read('lib/work/agentos-bridge.ts') ?? '';
  const ask = read('components/home/home-ask.tsx') ?? '';
  const build = read('lib/present/build.ts') ?? '';
  const toolsRoute = read('app/api/internal/agentos/tools/route.ts') ?? '';
  const cat = read('app/(main)/dev/thread-preview/preview-catalogue.tsx') ?? '';
  const cli = read('app/(main)/dev/thread-preview/preview-client.tsx') ?? '';

  // ── the behavioural half: the REAL module, on fixtures ────────────────────────────────────────
  // (pure + leaf by construction — T41.2 asserts that property, which is what lets this run here)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const T = require('../lib/work/trace') as typeof import('../lib/work/trace');

  gate('T41.1 THE WORDING IS THE TABLE’S, AND SILENCE IS THE FALLBACK — an unknown tool composes to NOTHING (never its id, never a de-underscored guess), and a line made only of unknown tools is null',
    T.traceWording('check_calendar') !== null
    && T.traceWording('some_future_tool') === null
    && T.tracePhrase({ tool: 'some_future_tool', ok: true }) === null
    && T.traceLine([{ tool: 'some_future_tool', ok: true }]) === null
    && T.traceLine([]) === null
    // the id itself can never appear in what a person reads
    && !String(T.traceLine([{ tool: 'check_calendar', ok: true }, { tool: 'some_future_tool', ok: true }]) ?? '').includes('_')
    && T.traceLine([{ tool: 'check_calendar', ok: true }, { tool: 'some_future_tool', ok: true }]) === 'Checked the calendar');

  gate('T41.2 THREE TENSES, ONE ROW — doing while the call is open, past when it settled, the HONEST word when it failed; and the module is PURE and leaf (no IO, no React, no imports) so both the server and the kit can read it',
    T.tracePhrase({ tool: 'check_calendar' }) === 'Checking the calendar…'
    && T.tracePhrase({ tool: 'check_calendar', ok: true }) === 'Checked the calendar'
    && T.tracePhrase({ tool: 'check_calendar', ok: false }) === 'Couldn’t reach the calendar'
    // every row carries all three words — a table with a hole would fall back to silence mid-turn
    && Object.values(T.TRACE_WORDING).every((w) => !!w.doing && !!w.done && !!w.failed)
    // …and covers the whole live tool vocabulary (TOOL_LABELS is the one in-flight label table)
    && Object.keys(T.TRACE_WORDING).length >= 35
    // PURE + LEAF: no import statement, no require, no module specifier of any kind, and no React
    // or Supabase symbol used (the words appear in its own doc comment, so the check is on USE).
    && !/^import |require\(|from '/m.test(trace)
    && !/useState|useMemo|createClient|supabase\./.test(trace) && !/<[A-Z]/.test(trace));

  gate('T41.3 THE FOLD IS EXECUTION ORDER, DEDUPED, CAPPED — repeats fold, a FAILURE never folds into a success (the thing a dedupe must not swallow), the cap counts the rest, and nothing is ever re-sorted',
    T.traceLine([{ tool: 'check_calendar', ok: true }, { tool: 'search_knowledge_base', ok: true }, { tool: 'check_calendar', ok: true }])
      === 'Checked the calendar · searched Knowledge'
    // the same tool, two outcomes, two phrases
    && T.traceLine([{ tool: 'check_calendar', ok: true }, { tool: 'check_calendar', ok: false }])
      === 'Checked the calendar · couldn’t reach the calendar'
    // alphabetical would have put "Checked" first — execution order does not
    && String(T.traceLine([{ tool: 'web_search', ok: true }, { tool: 'check_calendar', ok: true }]))
      .startsWith('Searched the web')
    && T.traceLine(
      ['check_calendar', 'search_knowledge_base', 'get_emails', 'web_search', 'read_document', 'list_tasks', 'fetch_url']
        .map((tool) => ({ tool, ok: true })),
    )?.endsWith('· and 2 more') === true
    && T.TRACE_LINE_CAP === 5);

  gate('T41.4 WHAT PERSISTS IS `{tool, ok}` AND NOTHING ELSE — buildTrace strips every other field, drops what has no word (unsayable ⇒ unstored), dedupes, and caps; a receipt that carried arguments or results would be a second copy of the user’s data',
    (() => {
      const out = T.buildTrace([
        // deliberately over-fed: the extra fields must not survive
        { name: 'check_calendar', ok: true, args: { from: '2026-09-22' }, result: 'Wednesday 10:00 with Sam' },
        { name: 'check_calendar', ok: true },
        { name: 'some_future_tool', ok: true },
        { name: 'search_knowledge_base', ok: false },
      ] as Array<{ name: string; ok: boolean }>);
      const keys = new Set(out.flatMap((e) => Object.keys(e)));
      return out.length === 2
        && [...keys].sort().join(',') === 'ok,tool'
        && out[0].tool === 'check_calendar' && out[0].ok === true
        && out[1].tool === 'search_knowledge_base' && out[1].ok === false
        && T.buildTrace(Array.from({ length: 40 }, (_, i) => ({ name: i % 2 ? 'web_search' : 'check_calendar', ok: !!(i % 3) }))).length <= T.TRACE_MAX
        // …and the TYPE itself admits nothing else — a third field is the door a payload walks in
        && /export type TraceEntry = \{ tool: string; ok\?: boolean \};/.test(trace);
    })());

  gate('T41.5 ONE WRITER, ONE OUTCOME READ, BOTH RUNTIMES — the native DM route and the AgentOS bridge each accumulate `{name, ok}` from the SHARED toolResultOk and persist through the SHARED buildTrace; neither hand-types a trace entry, and nothing else in the app writes `metadata.trace`',
    /import \{ buildTrace \} from '@\/lib\/work\/trace'/.test(nativeDM)
    && /import \{ buildTrace \} from '@\/lib\/work\/trace'/.test(bridge)
    && /toolResultOk/.test(nativeDM) && /toolResultOk/.test(bridge)
    && /const traceCalls: Array<\{ name: string; ok: boolean \}> = \[\]/.test(nativeDM)
    && /const traceCalls: Array<\{ name: string; ok: boolean \}> = \[\]/.test(bridge)
    && /const trace = buildTrace\(traceCalls\)/.test(nativeDM)
    && /const trace = buildTrace\(traceCalls\)/.test(bridge)
    && /\.\.\.\(trace\.length > 0 \? \{ trace \} : \{\}\)/.test(nativeDM)
    && /\.\.\.\(trace\.length > 0 \? \{ trace \} : \{\}\)/.test(bridge)
    // the outcome predicate lives ONCE, beside the chip table that reads the same sentences
    && /export function toolResultOk/.test(summaries)
    && (() => {
      const writers = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]
        .filter((f) => /\.\.\.\(trace\.length > 0 \? \{ trace \} : \{\}\)|buildTrace\(/.test(read(f) ?? ''))
          .filter((f) => !/agentos-bridge\.ts$|chat[\\/]route\.ts$|lib[\\/]work[\\/]trace\.ts$/.test(f));
      return writers.length === 0;
    })());

  gate('T41.6 THE TRACE IS AN ITEM, NOT A CARD, AND IT REUSES THE ONE MUTED LINE — `trace_line` is in the ThreadItem union and NOT in ThreadCardKind; the timeline renders it through the SAME EventLine piece the event line uses, composing the words itself; a line that composes to nothing renders nothing',
    /\| TraceLineItem;/.test(threadTypes)
    && /interface TraceLineItem \{\n\s*type: 'trace_line';/.test(threadTypes)
    && !/'trace_line'/.test((threadTypes.match(/export type ThreadCardKind =[\s\S]*?;/) ?? [''])[0])
    && !/kind: 'trace/.test(threadTypes)
    // ONE muted-line renderer, used twice — never a second component with its own grey
    && /function EventLine\(\{ text, refs \}/.test(timeline)
    && (timeline.match(/<EventLine /g) ?? []).length === 2
    && /import \{ traceLine \} from '@\/lib\/work\/trace'/.test(timeline)
    && /const line = traceLine\(item\.entries\);/.test(timeline)
    && /return line \? <EventLine key=\{item\.id\} text=\{line\} \/> : null;/.test(timeline)
    // THE HOST HANDS OVER FACTS, NEVER WORDS: it cannot even reach the vocabulary (no import of
    // traceLine / tracePhrase / TRACE_WORDING), and no trace phrase exists as a string literal in
    // it. Composition lives in the kit, over `{tool, ok}` — that is the whole point of the item.
    && !/traceLine|tracePhrase|TRACE_WORDING/.test(ask)
    && !/['"`]Check(ing|ed) the /.test(ask));

  gate('T41.7 THE LINE LIVES AND FOLDS AT THE HOST — the DM accumulates `{tool, ok}` from the stream’s own frames, mounts one line PER CALL while the work runs and ONE folded line after, and reads the stored trace back on the next open; the old "· Checking…" text typed INTO the coworker’s own bubble is gone',
    // the retired hack: machinery wearing a person's voice, wiped the moment it settled
    !/patchLast\(`\$\{acc\}\$\{acc \? '\\n\\n' : ''\}· /.test(ask)
    && /event\.type === 'tool_start' && event\.name/.test(ask)
    && /trace\.push\(\{ tool: event\.name \}\)/.test(ask)
    && /trace\[at\] = \{ tool: event\.name, ok \}/.test(ask)
    && /if \(inFlight\) t\.trace\.forEach\(\(e, j\) => out\.push\(\{ type: 'trace_line', id: `\$\{key\}-trace-\$\{j\}`, entries: \[e\] \}\)\);/.test(ask)
    && /out\.push\(\{ type: 'trace_line', id: `\$\{key\}-trace`, entries: t\.trace \}\)/.test(ask)
    // the reload path, structurally validated (a malformed entry never renders half-read)
    && /m\.metadata\.trace\.filter\(isTraceEntry\)/.test(ask)
    // …and both runtimes put `ok` on the wire so the line can settle in place
    && /type: 'tool_result'[^}]*summary, ok/.test(nativeDM)
    && /send\(\{ type: 'tool_result', name, id: tool\.tool_call_id \?\? name, summary, ok \}\)/.test(bridge));

  gate('T41.8 THE CITATIONS ARE A `documents` COLLECTION, THROUGH THE ONE POINTER AND THE ONE HOST — both coworker lanes build it from the SAME documentSpec over the groups the answer was grounded in, the rows say `cited`, the framing names the source in CODE, and NOTHING CITED PRODUCES NO CARD',
    // one builder, two lanes — the native executor and the AgentOS internal route
    /const \{ documentSpec \} = await import\('@\/lib\/present\/build'\)/.test(nativeDM)
    && /documentSpec\(kbCtx\.groups, query\)/.test(nativeDM)
    && /const \{ documentSpec \} = await import\('@\/lib\/present\/build'\)/.test(toolsRoute)
    && /documentSpec\(kbCtx\.groups, query\)/.test(toolsRoute)
    // an empty group set never becomes a pointer, on EITHER lane
    && /if \(kbCtx\.groups\?\.length\) \{/.test(nativeDM)
    && /if \(kbCtx\.groups\?\.length\) \{/.test(toolsRoute)
    // the pointer is the shared one (never hand-typed) and the persisted half is a pointer
    && /collectionPointer\(id, spec\)/.test(nativeDM)
    && /collectionPointer\(id, e\.collection\)/.test(bridge)
    // the row's word, and the framing composed by code from the rows + the user's own query
    && /status: \{ word: 'cited', tone: 'neutral' as RowTone \}/.test(build)
    && /From your Knowledge — \$\{plural\(total, 'document'\)\} mention/.test(build)
    // NO BESPOKE CITATION CHIP IS REBORN. The /workers tab's chip row died with it; the ONE
    // remnant is `CitationChip` inside components/work/chat-message.tsx, which survives only
    // because `MarkdownText` lives in the same file — it is unreachable (nothing imports
    // ChatMessageBubble) and must stay that way. The kit and every live thread host carry none.
    && [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]
      .filter((f) => /CitationChip|citation-chip|KbCitation|kbCitationChip/.test(read(f) ?? ''))
      .join('|') === 'components/work/chat-message.tsx'
    && [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]
      .filter((f) => f !== 'components/work/chat-message.tsx' && /ChatMessageBubble/.test(read(f) ?? '')).length === 0);

  gate('T41.9 THE CATALOGUE CARRIES THE THREE STATES AND THE DM CARRIES THE RECEIPT — the Pieces block shows in-progress · one receipt · the fold WITH A FAILURE INSIDE, all as machine facts through the real timeline; and the Coworker DM tab shows a real answer with its folded trace and its citations collection under it',
    /trace · in progress/.test(cat) && /trace · one receipt/.test(cat)
    && /trace · the fold, with a failure inside/.test(cat)
    && /entries: \[\{ tool: 'check_calendar' \}\]/.test(cat)
    && /entries: \[\{ tool: 'check_calendar', ok: true \}\]/.test(cat)
    && /\{ tool: 'slack_read_messages', ok: false \}/.test(cat)
    // the specimens run through the REAL timeline, not a hand-drawn picture of one
    && /PIECE_TRACE\.map\(\(t\) => \(/.test(cat) && /<ThreadTimeline items=\{t\.items\} \/>/.test(cat)
    // the DM walk: the citations card, and the folded receipt beneath the answer
    && /type: 'trace_line', id: 'dm4-trace'/.test(cli)
    && /\{ tool: 'search_knowledge_base', ok: true \}, \{ tool: 'read_document', ok: true \}/.test(cli)
    && /status: \{ word: 'cited', tone: 'neutral' \}/.test(cli));
}


// ── THE ID-UNIQUENESS GUARD (Sep 14) ────────────────────────────────────────────────────────────
// Two agents in one day added gates under ids the suite already used — both sets ran, both passed,
// and a failure report would have been ambiguous. The suite doesn't enforce uniqueness at gate()
// (names are free strings), so this guard scans the suite's OWN source: every gate id (the leading
// T-token of each gate('…') name) must appear exactly once. A duplicate FAILS the run loudly.
{
  const own = read('scripts/smoke-threads.ts') || '';
  const ids = [...own.matchAll(/gate\(\s*'(T\d+\.\d+[a-z0-9-]*)[\s']/g)].map((m) => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) { console.log(`\n✗ GATE-ID COLLISION — duplicated ids: ${dupes.join(', ')}`); process.exit(1); }
}

// ── summary ─────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} gates green${fail ? ` — ${fail} FAILING` : ''}`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
