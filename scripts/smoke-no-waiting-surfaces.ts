/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — NO WAITING, THE SURFACES (W17 · "the perfect app has no loading states"; registry law
 * `no-waiting`). The item page has its own gate; this one holds the OTHER surfaces: Home, the
 * one-at-a-time card, the held list, the chat/threads lane, the sidebar and All conversations.
 *
 * ZERO AI, ZERO DB: pure functions run on fixtures (the thread merges, the phase clock), the day
 * frame runs on a TIMED fake client (outcome, not wording), and the rest is source structure.
 *
 *   npx tsx scripts/smoke-no-waiting-surfaces.ts
 *
 *   NW1 · NO CHAINED READ THAT DOES NOT NEED ITS PREDECESSOR — the day frame's reads land in the
 *         fewest waves their data allows (measured on a timed fake); the brief, workers/home,
 *         rooms/recent and held routes start their user-only reads together.
 *   NW2 · EVERY SURFACE READ CARRIES ITS PHASE CLOCK (Server-Timing) — the waterfall is visible in
 *         the browser's own network panel.
 *   NW3 · A VISITED SURFACE PAINTS FROM ITS CACHE — each surface hydrates before its fetch, and the
 *         landing merges BEHIND the paint (painted rows keep their seats; nothing repeats).
 *   NW4 · INTENT WARMS THE NEXT PAGE — rows warm on hover/focus, a press skips the intent wait, the
 *         card in hand warms its room, the next card's evidence is read ahead.
 *   NW5 · NO SPINNER FOR DATA — no spinner glyph or "Loading…" word on a data wait in the fenced
 *         surfaces; W17's placeholders keep the shape of what lands and honour reduced motion.
 *   NW6 · SLOW READS OFF THE CRITICAL PATH — the Home's lens prefetch waits for the first paint.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildTodayZone, buildInMotionZone } from '../lib/home/day';
import type { WorkspaceFeatures } from '../lib/workspace/types';
import { mergeThreadLanding, threadCacheOf, readThreadCache, mergeKeyedListLanding } from '../lib/home/thread-cache';
import { phaseClock } from '../lib/utils/server-timing';

const ROOT = join(__dirname, '..');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
// ── A TIMED FAKE DB: every query resolves after DELAY ms and records WHEN it started. Waves are the
//    distinct start-time clusters — a chain shows as one wave per link. ─────────────────────────
const DELAY = 25;
function timedDb(tables: Record<string, unknown[]>) {
  const starts: Array<{ table: string; at: number }> = [];
  const t0 = Date.now();
  const make = (table: string) => {
    const rows = tables[table] ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => void) => {
            starts.push({ table, at: Date.now() - t0 });
            setTimeout(() => res({ data: table === 'item_plans' ? (rows.length ? rows : null) : rows, count: rows.length, error: null }), DELAY);
          };
        }
        return () => chain;
      },
    });
    return chain;
  };
  const waves = () => {
    const ats = starts.map((s) => s.at).sort((a, b) => a - b);
    let n = 0; let last = -Infinity;
    for (const a of ats) { if (a - last > DELAY / 2) { n++; last = a; } }
    return n;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { from: (t: string) => make(t) } as any, starts, waves };
}
const FEATURES = { email: true, meetings: true, drive: true, agents: true, studio: true } as unknown as WorkspaceFeatures;
const NOW = new Date('2026-09-17T09:00:00Z');

async function nw1() {
  console.log('\nNW1 · NO CHAINED READ THAT DOES NOT NEED ITS PREDECESSOR');
  {
    const ev = { id: 'ev1', title: 'Sync', start_time: '2026-09-17T14:00:00Z', end_time: '2026-09-17T15:00:00Z', is_all_day: false, attendees: [], status: 'confirmed' };
    const t = timedDb({ connections: [{ id: 'c1' }], calendar_events: [ev], item_plans: [] });
    const zone = await buildTodayZone(t.db, `u-nw-today-${Date.now()}`, FEATURES, 'sam@acme.example', NOW);
    gate('NW1.1 · the today zone reads in TWO waves (user-only reads together · then the prep records that need the events)',
      !!zone && t.waves() === 2, `waves=${t.waves()} starts=${JSON.stringify(t.starts)}`);
    const u = timedDb({ connections: [], calendar_events: [ev], item_plans: [] });
    gate('   …and the ladder still holds: unconnected → no zone (the wave never serves what it read)',
      (await buildTodayZone(u.db, `u-nw-unconn-${Date.now()}`, FEATURES, 'sam@acme.example', NOW)) === undefined);
    const m = timedDb({
      workflow_runs: [{ id: 'r1', workflow_id: 'wf1', status: 'running', step_outputs: [], started_at: null, created_at: '2026-09-17T08:00:00Z' }],
      workflows: [{ id: 'wf1', name: 'Weekly brief', agent_id: 'a1', steps: [{}, {}], status: 'active', trigger: { type: 'manual' }, next_run_at: null }],
      custom_agents: [{ id: 'a1', name: 'Sam', worker_role: null }], calendar_events: [],
    });
    const motion = await buildInMotionZone(m.db, `u-nw-motion-${Date.now()}`, FEATURES, NOW);
    gate('NW1.2 · the in-motion zone reads in ONE wave (zone · runs · workflows · faces · delivered pointer)',
      !!motion && m.waves() === 1, `waves=${m.waves()} starts=${JSON.stringify(m.starts)}`);
  }
  {
    const s = src('app/api/home/brief/route.ts');
    const firstAwait = s.indexOf("const { data: profileRow } = await");
    const hoisted = ['trackedP', 'userRulesP', 'campaignSigP', 'tzRowsP', 'clearedP', 'wentsP', 'connsP', 'featsP', 'soonP'];
    const missing = hoisted.filter((h) => { const i = s.indexOf(`const ${h} = inFlight(`); return i < 0 || i > firstAwait; });
    gate('NW1.3 · the brief starts every user-only read BEFORE its first await (the profile read)', firstAwait > 0 && !missing.length, missing.join(', '));
    const inline = [
      /await supabase\.from\('calendar_events'\)\.select\('timezone'\)/,
      /await loadUserRules\(/,
      /await getCampaignSignature\(/,
      /await supabase\.from\('connections'\)\.select\('id, last_sync'\)/,
    ].filter((re) => re.test(s));
    gate('   …and none of them is still read inline further down the line', !inline.length, inline.map(String).join(' '));
    gate('   …the cached-verdict read starts beside the thread read, not after it',
      s.indexOf('const judgedNoneP = inFlight(') > 0 && s.indexOf('const judgedNoneP = inFlight(') < s.indexOf("const { data: threadRows } = await"));
  }
  {
    const s = src('app/api/workers/home/route.ts');
    gate('NW1.4 · workers/home: the messages chain starts BEFORE the workers read',
      s.indexOf('const notifsP = (async') > 0 && s.indexOf('const notifsP = (async') < s.indexOf("const { data: workers } = await"));
    gate('   …workflows and deliverable threads (both need only the worker ids) read in one Promise.all',
      /const \[\{ data: workflows \}, \{ data: threads \}\] = await Promise\.all\(/.test(s));
  }
  {
    const s = src('app/api/rooms/recent/route.ts');
    const entsAwait = s.indexOf('const [entsRes, turnsRes] = await Promise.all(');
    gate('NW1.5 · rooms/recent: the roster and the runs badge start with the wave-1 reads',
      ['const workersP = (async', 'const workflowsUnreadP = (async'].every((d) => { const i = s.indexOf(d); return i > 0 && i < entsAwait; }));
    gate('   …every key-dependent lane lands in ONE wave-2 Promise.all',
      /await Promise\.all\(\[labelsP, itemProjectP, chatsP, workerConvosP, workflowsUnreadP, unreadP\]\)/.test(s));
  }
  {
    const s = src('app/api/home/held/route.ts');
    gate('NW1.6 · held: the derivation and the month receipt read together',
      /Promise\.all\(\[\s*deriveHeld\(/.test(s) && /countGraduatedThisMonth\(supabase, user\.id\),\s*\]\)/.test(s));
  }
}

function nw2() {
  console.log('\nNW2 · EVERY SURFACE READ CARRIES ITS PHASE CLOCK (Server-Timing)');
  let t = 0;
  const c = phaseClock(() => t);
  t = 5; c.mark('pool'); t = 12; c.mark('seat & serve');
  gate('NW2.1 · the clock records each phase\'s own cost and a total, as a valid header',
    c.header() === 'pool;dur=5, seat___serve;dur=7, total;dur=12' && c.headers()['Server-Timing'] === c.header(), c.header());
  for (const r of ['app/api/home/brief/route.ts', 'app/api/home/day/route.ts', 'app/api/workers/home/route.ts', 'app/api/rooms/recent/route.ts']) {
    const s = src(r);
    gate(`NW2.2 · ${r} answers with { headers: clock.headers() }`, /phaseClock\(\)/.test(s) && /headers: clock\.headers\(\)/.test(s));
  }
}

function nw3() {
  console.log('\nNW3 · A VISITED SURFACE PAINTS FROM ITS CACHE — AND THE LANDING MERGES BEHIND IT');
  const hydrates: Array<[string, string, RegExp]> = [
    ['Home deck', 'components/home/home-view.tsx', /loadLS<Brief>\('aug-home-brief-v1'/],
    ['day frame', 'components/home/day-frame.tsx', /loadLS<DayFrame>\(CACHE_KEY/],
    ['held list + one-at-a-time deck', 'components/home/held-quiet.tsx', /loadLS<HeldLedger>\(HELD_LS_KEY/],
    ['sidebar rooms', 'components/one/one-sidebar.tsx', /loadLS<Rooms>\(LS_KEY\)/],
    ['sidebar team', 'components/one/one-sidebar.tsx', /loadLS<TeamMate\[\]>\('aug-team-presence-v1'\)/],
    ['All conversations', 'components/one/all-conversations.tsx', /loadLS<Conversation\[\]>\(ALL_CONVERSATIONS_LS\)/],
    ['Home chat room', 'components/home/home-ask.tsx', /const cache = peekChatTurns\(key\)/],
    ['coworker DM', 'components/home/home-ask.tsx', /readThreadCache<Turn>\(loadLS\(DM_TURNS_LS\(agentId\)\)\)/],
    ['Documents library', 'components/knowledge/knowledge-panel.tsx', /loadLS<Overview>\(LS_KEY\)/],
  ];
  for (const [name, file, re] of hydrates) gate(`NW3.1 · ${name} hydrates from its cache`, re.test(src(file)), file);
  {
    const ask = src('components/home/home-ask.tsx');
    const lr = ask.slice(ask.indexOf('const loadRoom = (key: string) =>'), ask.indexOf('const loadRoom = (key: string) =>') + 4000);
    gate('NW3.2 · the chat paints its cache BEFORE its read is sent, and lands through the one merge',
      lr.indexOf('peekChatTurns(key)') > 0 && lr.indexOf('peekChatTurns(key)') < lr.indexOf('fetchChatTurns(key)') && /mergeThreadLanding\(paintedCache, prev, loaded\)/.test(lr));
    gate('   …a landing for a room the reader already left writes to nothing', /if \(chatRoomRef\.current !== key\) return;/.test(lr));
  }
  // THE MERGE, AS BEHAVIOUR — a 50-turn DM cached as its 40-turn tail.
  const full = Array.from({ length: 50 }, (_, i) => ({ id: i }));
  const cache = threadCacheOf(full, 40);
  const painted = cache.turns;
  const same = mergeThreadLanding(cache, painted, full);
  gate('NW3.3 · a tail paint + the full list: every turn exactly once, in order (the v1 duplicate bug is closed)',
    same.length === 50 && same.every((t, i) => t.id === i), `len=${same.length}`);
  gate('   …the painted turns keep their object identity (nothing read is rewritten)', same[10] === painted[0] && same[49] === painted[39]);
  const grown = [...full, { id: 50 }, { id: 51 }];
  const withNew = mergeThreadLanding(cache, painted, grown);
  gate('NW3.4 · genuinely new turns append at the foot', withNew.length === 52 && withNew[51].id === 51 && withNew[50].id === 50);
  gate('NW3.5 · a shorter server list (archived elsewhere) leaves this open\'s paint standing',
    mergeThreadLanding(cache, painted, full.slice(0, 45)) === painted);
  const local = [...painted, { id: 999 }];
  const afterLocal = mergeThreadLanding(cache, local, [...full, { id: 50 }]);
  gate('NW3.6 · the reader spoke on this open → no second copy of their turn (nothing appends this landing)',
    afterLocal.filter((t) => t.id === 999).length === 1 && !afterLocal.some((t) => t.id === 50) && afterLocal.length === 51);
  gate('NW3.7 · a cold open takes the server whole; a legacy bare-array cache is no cache',
    mergeThreadLanding(null, [], full) === full && readThreadCache([{ id: 1 }]) === null);
  const list = mergeKeyedListLanding([{ key: 'a', l: 1 }, { key: 'b', l: 1 }], [{ key: 'c', l: 1 }, { key: 'b', l: 2 }]);
  gate('NW3.8 · a keyed list landing: painted rows keep their seats (fresh copy in place), new rows arrive on top, none vanish',
    list.map((r) => r.key).join('') === 'cab' && list[2].l === 2);
}

function nw4() {
  console.log('\nNW4 · INTENT WARMS THE NEXT PAGE');
  const row = src('components/work/work-row.tsx');
  gate('NW4.1 · the row kit warms the item page through the ONE warm path (prefetchItemView)', /prefetchItemView\(href/.test(row));
  gate('   …and a press skips the intent wait (prefetchNow → immediate)',
    /const prefetchNow = \(\) => \{ prefetchItem\(item\.href, \{ immediate: true \}\)/.test(row));
  for (const f of ['components/work/work-row.tsx', 'components/home/held-quiet.tsx', 'components/home/home-view.tsx']) {
    gate(`NW4.2 · ${f}: rows warm on hover AND focus, the press warms at once`,
      /onMouseEnter=\{prefetch\} onFocus=\{prefetch\} onMouseDown=\{prefetchNow\} onTouchStart=\{prefetchNow\}/.test(src(f)));
  }
  const tri = src('components/triage/triage-deck.tsx');
  gate('NW4.3 · the one-at-a-time card warms its own room the moment it stands', /useEffect\(\(\) => \{ warmRoom\(\); \}, \[row\.id\]\)/.test(tri));
  gate('NW4.4 · the next card\'s evidence is read ahead — thread tail OR commitment source',
    /void loadTail\(next\.id\)/.test(tri) && /void loadDeckContext\(next\.id\)/.test(tri));
  const side = src('components/one/one-sidebar.tsx');
  const all = src('components/one/all-conversations.tsx');
  gate('NW4.5 · sidebar chat rows warm their turns on hover/focus/press', /onMouseEnter=\{\(\) => prefetchChatTurns\(c\.key\)\}/.test(side) && /prefetchChatTurns\(c\.key, \{ immediate: true \}\)/.test(side));
  gate('NW4.6 · All-conversations rows warm (chat turns · room route)', /prefetchChatTurns\(c\.key\)/.test(all) && /router\.prefetch\(c\.href\)/.test(all));
  const warm = src('components/home/chat-turns-warm.ts');
  gate('NW4.7 · A HOVER IS NOT A VISIT: the chat warm is a peek (no read-marker stamp), the open is not',
    /&peek=1/.test(warm) && /prefetchChatTurns[\s\S]*fetchChatTurns\(roomKey, \{ peek: true \}\)/.test(warm));
}

function nw5() {
  console.log('\nNW5 · NO SPINNER FOR DATA');
  const files = [
    'components/home/home-view.tsx', 'components/home/home-ask.tsx', 'components/home/held-quiet.tsx',
    'components/home/day-frame.tsx', 'components/home/orb-entrance.tsx', 'components/home/item-open-frame.tsx',
    'components/triage/triage-deck.tsx', 'components/triage/decision-frame.tsx',
    'components/one/one-sidebar.tsx', 'components/one/all-conversations.tsx', 'components/knowledge/knowledge-panel.tsx',
  ];
  // A DEED'S OWN progress glyph (retrying a file) is not a data wait — named, with its reason.
  const DEED_PROGRESS = [/retrying\.has\(f\.id\) \? 'animate-spin/];
  for (const f of files) {
    const lines = src(f).split('\n');
    const spins = lines.filter((l) => /animate-spin|<Spinner\b|Loader2/.test(l) && !DEED_PROGRESS.some((re) => re.test(l)));
    const words = lines.filter((l) => />\s*Loading…\s*</.test(l) || /\? 'Loading…'/.test(l) && !/busyScope/.test(l));
    gate(`NW5.1 · ${f}: no spinner / "Loading…" on a data wait`, !spins.length && !words.length, [...spins, ...words].map((l) => l.trim()).join(' | ').slice(0, 200));
  }
  const side = src('components/one/one-sidebar.tsx');
  gate('NW5.2 · the team roster\'s wait wears the row shape (28px face · name · state) and honours reduced motion',
    /team === null && \[0, 1\]\.map/.test(side) && /h-7 w-7[^"]*animate-pulse motion-reduce:animate-none/.test(side));
}

function nw6() {
  console.log('\nNW6 · SLOW READS OFF THE CRITICAL PATH');
  const hv = src('components/home/home-view.tsx');
  const eff = hv.slice(hv.indexOf('LENS_PREFETCH_AFTER_PAINT (W17)'), hv.indexOf('LENS_PREFETCH_AFTER_PAINT (W17)') + 1400);
  gate('NW6.1 · the Timeline lens warm waits for the first paint (loading false) and an idle beat — never a blind timer at mount',
    /if \(loading \|\| lensWarmedRef\.current\) return;/.test(eff) && /requestIdleCallback/.test(eff) && /\}, \[loading\]\);/.test(eff));
  gate('   …and no mount-time timeline fetch remains', (hv.match(/fetch\('\/api\/home\/timeline'\)/g) ?? []).length === 1);
  gate('NW6.2 · the Home paint waits on the brief alone — the team lane lands on its own', /THE PAINT WAITS ON THE BRIEF, AND ON NOTHING ELSE/.test(hv) && !/Promise\.all\(\[\s*fetch\('\/api\/workers\/home'\)/.test(hv));
}

(async () => {
  await nw1();
  nw2(); nw3(); nw4(); nw5(); nw6();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log('\nFAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
})();
