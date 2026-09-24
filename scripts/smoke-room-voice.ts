/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE ROOM SPEAKS TRUE AND FAST (stabilization W8.4, Sep 23 — docs/stabilization-plan.md
 * PART VI; registry laws `one-voice-brief` · `no-mutation-and-address` · `no-internal-text` ·
 * `one-object-one-door`).
 *
 * The owner's walk + the dev logs, Sep 23:
 *   1. THE NAME CLASH — a colleague whose SURNAME is the CoS seat's given name made every opening
 *      "narrate the speaker in the third person"; the composition was refused on every open and the
 *      model re-bought each time.
 *   2. THE FALLBACK LIED — "I'll keep it standalone" under a "connects to … Track" chip; "This needs
 *      you to <title>" as the robotic ask.
 *   3. (smoke-one-door K) the source card's "Thread →" opened a separate page on the rail.
 *   4. internal text — the prepare-now `reason` (the judge's own reasoning) printed as the reply.
 *   5. SPEED — the view waited ~1s on the compose every open; the plan POST fired 3–6× per open; a
 *      hover warm paid AI; the thread door ran its reads back to back.
 *   6. (W8.5) the project room door still awaited its compose; the Home re-fired its plan pre-gen
 *      POSTs on every remount (section I).
 *
 * ZERO-AI, zero DB, deterministic: pure fixtures for every rule + source floors. Exit 1 on failure.
 *   npx tsx scripts/smoke-room-voice.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { narratesSpeakerInThirdPerson } from '../lib/room/self-voice';
import { fallbackOpeningLine, FALLBACK_FORBIDDEN, prepareNoneLine } from '../lib/room/opening-fallback';
import { createSingleFlight } from '../lib/room/single-flight';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ═══ A · THE NAME CLASH ═══
  console.log('\nA · the third-person refusal fires only when the name denotes the SPEAKER');
  {
    const S = 'Clara';
    gate('A1 pure: "Sam Clara replied" with speaker Clara PASSES (a surname is someone else — with or without the grounding\'s people)',
      !narratesSpeakerInThirdPerson('Sam Clara replied on Tuesday.', S)
      && !narratesSpeakerInThirdPerson('Sam Clara replied on Tuesday.', S, ['Sam Clara'])
      && !narratesSpeakerInThirdPerson('The budget moved after Sam Clara messaged on September 3.', S));
    gate('A2 pure: "Clara drafted it" is REFUSED (and after a sentence-opening adverb, and mid-sentence)',
      narratesSpeakerInThirdPerson('Clara drafted it.', S)
      && narratesSpeakerInThirdPerson('Yesterday Clara drafted the nudge.', S)
      && narratesSpeakerInThirdPerson('Sam asked, and Clara drafted a reply.', S));
    gate('A3 pure: first person, "<Seat> <Surname>", a possessive and an unnamed seat are never refused',
      !narratesSpeakerInThirdPerson('I drafted it.', S) && !narratesSpeakerInThirdPerson('Clara Mendes sent the file.', S)
      && !narratesSpeakerInThirdPerson("Clara's draft is below.", S) && !narratesSpeakerInThirdPerson('Clara drafted it.', null));
    const brief = src('lib/room/brief.ts');
    gate('A4 the composer asks THE NAME TEST with the page\'s own people (board counterparties + askers) — the bare `<Seat>\\s+\\p{Ll}` regex is gone',
      /const knownPeople = \[\.\.\.g\.board\.map\(\(b\) => b\.who\), \.\.\.g\.asks\.map\(\(a\) => a\.who\)\];/.test(brief)
      && /if \(narratesSpeakerInThirdPerson\(voiced, speaker, knownPeople\)\) \{/.test(brief)
      && !/new RegExp\(`\\\\b\$\{selfFirst/.test(brief) && !/const selfFirst = /.test(brief));
  }

  // ═══ B · A REFUSAL IS CACHED FOR ITS SIG ═══
  console.log('\nB · a refused composition is remembered for its sig (never re-bought per open), last-good served');
  {
    const brief = src('lib/room/brief.ts');
    gate('B1 the refusal and the fully-degraded brief both stamp refuseForSig before returning null (last-good untouched)',
      /await refuseForSig\(client, userId, roomKey, sig\);\n    return null;/.test(brief)
      && /if \(!text\) \{ await refuseForSig\(client, userId, roomKey, sig\); return null; \}/.test(brief));
    gate('B2 refuseForSig stamps ONLY `refusedSig` on the stored row (text/move/offers/at/sig kept, the row\'s clock kept); an absent row gets an empty carrier',
      /export async function refuseForSig\(/.test(brief)
      && /\{ \.\.\.t, refusedSig: sig \} as never, \{ updatedAt: data\?\.updated_at \?\? undefined \}/.test(brief)
      && /\{ v: ROOM_BRIEF_VERSION, sig: '', text: '', at: '', refusedSig: sig \}/.test(brief));
    gate('B3 BOTH ensure* consult the sig gate that honours a refused sig (no raw `cachedSig === sig` left)',
      (brief.match(/if \(await sigStands\(client, userId, (entityId|roomKey), sig\)\) return null;/g) ?? []).length === 2
      && !/cachedSig\(/.test(brief)
      && /return stored\.sig === sig \|\| stored\.refusedSig === sig;/.test(brief));
    gate('B4 an AI FAILURE (empty/thrown composition) is NOT cached — a transient 503 retries on the next open, and last-good serves meanwhile',
      /if \(!composed\) return null; \/\/ AI failure never overwrites last-good/.test(brief)
      && !/if \(!composed\) \{ await refuseForSig/.test(brief));
    // the gate's own pure form (imported lazily: brief.ts is a server module, but pure at this export)
    const { sigGateStands } = await import('../lib/room/brief');
    gate('B5 pure: the stored row settles its composed sig AND its refused sig, and nothing else',
      sigGateStands({ sig: 'a', refusedSig: 'b' }, 'a') && sigGateStands({ sig: '', refusedSig: 'b' }, 'b')
      && !sigGateStands({ sig: 'a', refusedSig: 'b' }, 'c') && !sigGateStands(null, 'a'));
  }

  // ═══ C · THE FALLBACK NEVER CONTRADICTS ═══
  console.log('\nC · the fallback makes no claim a served fact can contradict — the item\'s own ask, or nothing');
  {
    const lines = [null, 'Sam'].flatMap((who) => [null, 'Share updated report', 'Decide whether to engage'].flatMap((ask) =>
      [null, 'I drafted a reply below'].map((p) => fallbackOpeningLine({ who, ask, preparedClause: p }) ?? '')));
    gate('C1 pure: NO input yields a membership claim ("standalone" · "isn\'t tied") — the header\'s connection line is membership\'s only voice',
      lines.every((l) => !FALLBACK_FORBIDDEN.test(l)));
    gate('C2 pure: never the title template ("This needs you to <title>"); the ask speaks as a colleague would, or nothing',
      lines.every((l) => !/^This needs you to/.test(l))
      && fallbackOpeningLine({ who: null, ask: 'Share updated report' }) === 'Still open: share updated report.'
      // ⟲ RE-POINTED (W16.2 — DIRECTION-TRUE): "<who> asked you to …" only when the item's own data
      // says it was THEIR ask (origin their_ask); with no origin no direction is claimed ("From <who> — …").
      // Stricter: the old unconditional "<who> is asking you to …" was false on the user's own promise.
      && fallbackOpeningLine({ who: 'Sam', ask: 'Send the signed form', origin: 'their_ask' }) === 'Sam asked you to send the signed form.'
      && fallbackOpeningLine({ who: 'Sam', ask: 'Send the signed form' }) === 'From Sam — send the signed form.'
      && fallbackOpeningLine({ who: 'Sam', ask: 'Decide whether to engage', origin: 'their_ask' }) === 'From Sam — decide whether to engage.'
      && fallbackOpeningLine({ who: 'Sam', ask: 'Decide whether to engage' }) === 'From Sam — decide whether to engage.'
      && fallbackOpeningLine({ who: null, ask: null }) === null);
    const rail = src('components/home/item-rail.tsx');
    gate('C3 the rail speaks through the ONE ladder; the standalone claim and the title template are gone from its source',
      // ⟲ RE-POINTED (W16.2): the same one ladder, handed the served origin too.
      /const line = fallbackOpeningLine\(\{ who, ask: a\?\.ask \?\? null, preparedClause: prep, origin: a\?\.origin \?\? null \}\);/.test(rail)
      && !/keep it standalone/.test(rail) && !/isn't tied to a bigger body of work/.test(rail)
      && !/`This needs you to \$\{askText\}/.test(rail)
      && /: anchorLine\);/.test(rail));
    gate('C4 the reply clause rides the fallback ONLY while the reply card is mounted (a claim renders)',
      /const prep = a\?\.prepared && replyMounted/.test(rail) && /const replyMounted = mountedCards\.some\(\(c\) => c\.key === 'reply'\);/.test(rail));
  }

  // ═══ D · NO INTERNAL TEXT ═══
  console.log('\nD · no internal text in the room surfaces');
  {
    const rail = src('components/home/item-rail.tsx');
    gate('D1 the prepare-now answer is a house line (prepareNoneLine) — never the raw `reason` / `error` (the judge\'s reasoning)',
      /: prepareNoneLine\(d\.reason\);/.test(rail) && !/\(d\.reason \|\| /.test(rail) && !/\(d\.error \|\| "I couldn't prepare/.test(rail));
    const judge = 'resolved by the verdict (replied): the counterparty confirmed the slot in the latest message';
    gate('D2 pure: a judge-reason never reaches the line; unknown reasons fall to one honest sentence',
      !/verdict|counterparty/.test(prepareNoneLine(judge))
      && prepareNoneLine('something new and internal') === 'Nothing for me to prepare here — this one needs you.'
      && /try again/.test(prepareNoneLine('preparation failed — try again')));
    const drawer = src('components/room/filed-drawer.tsx');
    gate('D3 no raw ISO date renders in the rail or the drawer\'s history (the ONE short-date grammar)',
      !/\.slice\(0, 10\)\}<\/span>/.test(drawer) && /fmtMonthDay\(l\.at\)/.test(drawer)
      && !/first run \$\{String\(t\.standingSpec\.firstRun\)\.slice\(0, 10\)\}/.test(rail));
    gate('D4 no room surface renders a verdict reason / judgedReason',
      ['components/home/item-rail.tsx', 'components/home/item-detail.tsx', 'components/room/source-object.tsx', 'components/home/email-card.tsx']
        .every((p) => !/\{[^}]*verdict\??\.reason[^}]*\}|judgedReason/.test(src(p))));
  }

  // ═══ E · THE VIEW NEVER WAITS ON COMPOSITION ═══
  console.log('\nE · the view door never blocks on composition; a hover warm is zero-AI');
  {
    const view = src('app/api/items/view/route.ts');
    gate('E1 the view has NO await on a compose (no briefBeforePaint, no awaited ensure*/joinCompose); it reads last-good in one select',
      // ⟲ RE-POINTED (W13.5): the ONE awaited compose sits inside the onOpen/after() block, chained after
      // the budgeted re-prepare trip; outside it nothing awaits a compose. Last-good is read in one select
      // and re-validated against the current board before the paint (lib/room/serve-truth).
      !/await[^;\n]*(ensureLooseRoomBrief|ensureRoomBrief|joinCompose|briefBeforePaint|paintP)/.test(view.replace(/onOpen\(async \(\) => \{\s*\n\s*if \(tripDue\)[\s\S]*?anchorForBrief\)\);\s*\n\s*\}\);/, ''))
      && !/briefBeforePaint\(/.test(view)
      && /const lastGoodP = readRoomResponse\(supabase, user\.id, looseKey, \{ allowStaleVersion: true \}\)/.test(view)
      && /const lastGood = await lastGoodP;/.test(view));
    gate('E2 the compose runs under after() through the SAME joinCompose + ensureLooseRoomBrief (one flight with the warm)',
      // ⟲ RE-POINTED (W13.5): the same joinCompose + ensureLooseRoomBrief, under onOpen, after the trip.
      /onOpen\(async \(\) => \{\s*\n\s*if \(tripDue\) \{[^\n]*\}\s*\n\s*await joinCompose\(uid, looseKey, \(\) => ensureLooseRoomBrief\(supabase, uid, looseKey, anchorForBrief\)\);/.test(view));
    gate('E3 `?warm=1` schedules NOTHING: every after() in the door sits behind the one `onOpen` guard (compose · recognize · re-prepare)',
      /const warm = request\.nextUrl\.searchParams\.get\('warm'\) === '1';/.test(view)
      && /const onOpen = \(work: \(\) => Promise<unknown>\) => \{ if \(!warm\) after\(/.test(view)
      && (view.match(/\bafter\(async/g) ?? []).length === 1
      // ⟲ RE-POINTED (W13.5): the re-prepare trip rides the compose's onOpen block (it runs first).
      && /onOpen\(async \(\) => \{ const \{ recognizeOnOpen \}/.test(view)
      && /onOpen\(async \(\) => \{\s*\n\s*if \(tripDue\) \{ const \{ reprepareTrip \} = await import\('@\/lib\/room\/open-kicks'\);/.test(view));
    gate('E4 pending = nothing current painted (no last-good / an older version) → the client\'s ONE late re-check APPENDS',
      // ⟲ RE-POINTED (W13.5): a withheld last-good, or a trip about to correct the board, is pending too.
      /const briefPending = !r \|\| !!r\.staleVersion \|\| serve\.withheld \|\| tripDue;/.test(view));
    const kicks = src('lib/room/open-kicks.ts');
    gate('E5 the open\'s background work has ONE home (recognize · trip · the joined-open kick), composing through the same sig-gated door',
      /export async function recognizeOnOpen\(/.test(kicks) && /export async function reprepareTrip\(/.test(kicks)
      && /export async function kickOpenedItem\(/.test(kicks)
      && /joinCompose\(uid, roomKey, \(\) => ensureLooseRoomBrief\(client, uid, roomKey, anchorForBrief\)\)/.test(kicks)
      && /anchorOf\(linkKind, row, arts\)/.test(kicks) && /looseTitleOf\(linkKind, row\)/.test(kicks));
    const warmRoute = src('app/api/items/warm/route.ts');
    gate('E6 the budgeted warm door runs the joined open\'s kick for ONE item under after()',
      /if \(body\?\.open === true\) \{/.test(warmRoute) && /const it = items\[0\];/.test(warmRoute)
      && /await kickOpenedItem\(supabase, uid, it\)/.test(warmRoute));
    const detail = src('components/home/item-detail.tsx');
    gate('E7 the deep-dive\'s re-checks are pure reads (`&warm=1`) — they pick up what the open kicked, never buy it again',
      (detail.match(/fetch\(`\/api\/items\/view\?kind=\$\{kind\}&id=\$\{id\}&warm=1`\)/g) ?? []).length === 2);

    // pure — the client: a hover warm asks warm=1; the joined open kicks ONCE; a fresh open asks plainly
    type Call = { url: string; body?: string };
    const calls: Call[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body });
      await sleep(20);
      return { ok: true, json: async () => (String(url).includes('/api/items/view') ? { anchor: null, prepared: [] } : { queued: 1 }) } as unknown as Response;
    };
    const wc = await import('../lib/room/warm-client');
    const vid = 'dddddddd-0000-0000-0000-00000000aa01';
    wc.prefetchItemView(`/item/${vid}?kind=commitment`, { immediate: true });
    await Promise.all([wc.fetchItemView('commitment', vid), wc.fetchItemView('commitment', vid)]);
    const viewCalls = calls.filter((c) => c.url.includes(`/api/items/view?kind=commitment&id=${vid}`));
    const kicksSent = calls.filter((c) => c.url === '/api/items/warm' && (c.body ?? '').includes('"open":true'));
    gate('E8 pure: hover warm = ONE view request with `&warm=1`; the open(s) joining it add NO view request and exactly ONE open kick',
      viewCalls.length === 1 && viewCalls[0].url.endsWith('&warm=1') && kicksSent.length === 1
      && JSON.parse(kicksSent[0].body ?? '{}').items?.[0]?.id === vid, `views=${viewCalls.length} kicks=${kicksSent.length}`);
    calls.length = 0;
    const vid2 = 'dddddddd-0000-0000-0000-00000000aa02';
    await wc.fetchItemView('email', vid2);
    gate('E9 pure: an open with no warm in flight asks the door plainly (the door itself schedules the open\'s work) and kicks nothing',
      calls.length === 1 && !calls[0].url.includes('warm=1'));
  }

  // ═══ F · THE PLAN IS ONE FLIGHT ═══
  console.log('\nF · POST /api/items/plan is one flight per (user, kind, item), memo stated, PATCH forgets');
  {
    const plan = src('app/api/items/plan/route.ts');
    gate('F1 the POST computes through planFlight.run keyed per user/kind/item; memo windows are stated; an unpersisted fallback is held longer',
      /const planFlight = createSingleFlight<\{ tasks: ItemPlanTask\[\] \}>\(\);/.test(plan)
      && /const flightKey = `\$\{user\.id\}\|\$\{kind\}\|\$\{entityId\}`;/.test(plan)
      && /await planFlight\.run\(flightKey, async \(\) => \{/.test(plan)
      && /const PLAN_MEMO_MS = [\d_]+;/.test(plan) && /memoMs: isFallback \? PLAN_FALLBACK_MEMO_MS : PLAN_MEMO_MS/.test(plan));
    gate('F2 a PATCH forgets the key\'s memo (the reader\'s own edit is never masked)',
      /planFlight\.forget\(`\$\{user\.id\}\|\$\{kind\}\|\$\{entityId\}`\);/.test(plan));
    let calls = 0;
    const sf = createSingleFlight<number>();
    const fn = async () => { calls++; await sleep(10); return { value: 42, memoMs: 1_000 }; };
    const got = await Promise.all(Array.from({ length: 6 }, () => sf.run('u|email|x', fn)));
    const again = await sf.run('u|email|x', fn);
    sf.forget('u|email|x');
    await sf.run('u|email|x', fn);
    gate('F3 pure: six concurrent POSTs → ONE computation; inside the window → zero; after forget → one more',
      got.every((v) => v === 42) && again === 42 && calls === 2, `calls=${calls}`);
  }

  // ═══ G · THE THREAD DOOR'S ONE WAVE ═══
  console.log('\nG · GET /api/inbox/[id]/thread runs its reads in ONE wave; no module-global rules race');
  {
    const t = src('app/api/inbox/[id]/thread/route.ts');
    gate('G1 rules · thread · invite object run in ONE Promise.all after the item read',
      /const \[rules, threadRows, invite\] = await Promise\.all\(\[/.test(t)
      && /buildInviteObject\(supabase, user\.id, sd\)\.catch\(/.test(t) && !/let invite: InviteObject \| null = null;/.test(t));
    gate('G2 the rules reach classifyItem DIRECTLY — the cross-request `setInboxRules` global is not touched by this door',
      /classifyItem\(item as any, rules\)/.test(t) && !/setInboxRules/.test(t));
    gate('G3 explicit selects, errors checked',
      /error: itemErr/.test(t) && /error: tErr/.test(t) && /error: eErr/.test(t));
  }

  // ═══ I · W8.5 — THE PROJECT DOOR NEVER WAITS; THE HOME WARMS A PLAN ONCE ═══
  console.log('\nI · W8.5: the project room door never awaits the compose; the Home pre-gens each plan once per session');
  {
    const room = src('app/api/entities/[id]/room/route.ts');
    // strip comments so a prose mention can never satisfy or fail a code floor
    const code = room.replace(/\/\/[^\n]*/g, '');
    gate('I1 the project door serves LAST-GOOD in the read wave (one select, older version allowed) — no briefBeforePaint, no await on a compose',
      /readRoomResponse\(supabase, uid, id, \{ allowStaleVersion: true \}\)/.test(code)
      // ⟲ RE-POINTED (W13.5): the current board (serve-time truth) rides the same read wave.
      && /await Promise\.all\(\[\s*buildRoomView\(supabase, uid, id, null\), lastGoodP, entityServeBoard\(supabase, uid, id\),\s*\]\)/.test(code)
      && !/briefBeforePaint/.test(code) && !/await\s+paintP/.test(code)
      && !/await\s+(?:joinCompose|ensureRoomBrief)\(/.test(code.replace(/after\(async \(\) => \{[^\n]*\}\);/g, '')));
    gate('I2 the compose runs ONLY under after() (joinCompose-wrapped), and `?warm=1` schedules none (a pure read)',
      /if \(request\.nextUrl\.searchParams\.get\('warm'\) !== '1'\) \{\n\s+after\(async \(\) => \{ try \{ await joinCompose\(uid, id, \(\) => ensureRoomBrief\(supabase, uid, id\)\); \} catch/.test(code)
      && (code.match(/ensureRoomBrief\(/g) ?? []).length === 1);
    gate('I3 pending = nothing CURRENT painted (the item door\'s rule); the stale flag rides',
      // ⟲ RE-POINTED (W13.5): a withheld last-good is pending too.
      /const briefPending = !r \|\| !!r\.staleVersion \|\| serve\.withheld;/.test(code) && /\n      briefPending,\n/.test(code)
      && /briefStaleVersion: true/.test(code));
    const eroom = src('components/entities/entity-room.tsx');
    gate('I4 the project room\'s ONE late re-check is a pure read (`?warm=1`) on the item door\'s window, and lands as an APPEND',
      /const ROOM_LATE_BRIEF_RECHECK_MS = 6_500;/.test(eroom)
      && /if \(data\.briefPending && !data\.entity\.brief\) \{\n\s+setTimeout\(\(\) => \{\n\s+fetch\(`\/api\/entities\/\$\{entityId\}\/room\?warm=1`\)/.test(eroom)
      && /\}, ROOM_LATE_BRIEF_RECHECK_MS\);/.test(eroom)
      && /lateBrief: \{ text, at: d2\.entity\.briefAt \?\? null \}/.test(eroom));
    const home = src('components/home/home-view.tsx');
    gate('I5 the Home\'s plan pre-gen memo lives at MODULE scope (keyed kind:id → staleness stamp) — the per-mount ref is gone',
      /^const PLAN_PREGEN_MEMO = new Map<string, string>\(\);$/m.test(home)
      && /function needsPlanPreGen\(key: string, stamp: string\): boolean \{\n\s+return PLAN_PREGEN_MEMO\.get\(key\) !== stamp;/.test(home)
      && !/preGennedRef/.test(home) && !/useRef<Set<string>>\(new Set\(\)\);\n[^\n]*\n[^\n]*preGen/.test(home));
    gate('I6 every plan POST is claimed in the memo first, and the filter consults it — one POST per item per session, never per remount',
      (home.match(/fetch\('\/api\/items\/plan'/g) ?? []).length === 1
      && /if \(seen\.has\(key\) \|\| !needsPlanPreGen\(key, t\.stamp \?\? ''\)\) return false;/.test(home)
      && /claimPlanPreGen\(`\$\{t\.kind\}:\$\{t\.entityId\}`, t\.stamp \?\? ''\);\n\s+setTimeout\(/.test(home));
    // pure — the memo's contract, lifted verbatim from the source (no React, no DOM)
    const memoSrc = home.match(/const PLAN_PREGEN_MEMO[\s\S]*?\nfunction claimPlanPreGen[^\n]*\n[^\n]*\n\}/)?.[0] ?? '';
    const tsBody = memoSrc.replace(/new Map<string, string>\(\)/, 'new Map()').replace(/\((key): string, (stamp): string\): (boolean|void)/g, '($1, $2)');
    const memo = new Function(`${tsBody}; return { needsPlanPreGen, claimPlanPreGen };`)() as { needsPlanPreGen: (k: string, s: string) => boolean; claimPlanPreGen: (k: string, s: string) => void };
    const k = 'email:aaaa';
    const first = memo.needsPlanPreGen(k, '2026-09-23T08:00:00Z');
    memo.claimPlanPreGen(k, '2026-09-23T08:00:00Z');
    const remount = memo.needsPlanPreGen(k, '2026-09-23T08:00:00Z');
    const moved = memo.needsPlanPreGen(k, '2026-09-23T09:30:00Z');
    gate('I7 pure: first sight → warm; same key + same stamp (a remount) → never again; a moved stamp → eligible once more',
      first && !remount && moved, `first=${first} remount=${remount} moved=${moved}`);
  }

  // ═══ H · REGISTERED + ON THE BOARD ═══
  console.log('\nH · registered and on the board');
  {
    const json = JSON.parse(src('docs/laws-registry.json')) as { laws: Array<{ id: string; gates: Array<{ suite: string }> }> };
    const byId = (id: string) => json.laws.find((l) => l.id === id);
    gate('H1 the registry names this suite on one-voice-brief · no-mutation-and-address · no-internal-text',
      ['one-voice-brief', 'no-mutation-and-address', 'no-internal-text'].every((id) => byId(id)?.gates.some((g) => g.suite === 'smoke-room-voice')));
    gate('H2 the board runs this suite before smoke-laws', (() => {
      const pkg = src('package.json');
      const a = pkg.indexOf('npx tsx scripts/smoke-room-voice.ts'); const b = pkg.indexOf('npx tsx scripts/smoke-laws.ts');
      return a > 0 && b > a;
    })());
  }

  console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${pass} passed · ${failures.length} failed${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
