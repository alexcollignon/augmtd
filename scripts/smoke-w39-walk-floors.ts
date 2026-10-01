// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W39 · THE OCT 1 WALK'S FLOORS. ZERO AI, ZERO network, no data. The outcome half is the unit
// tier (pure functions + a rendered leaf, called — never grepped): tests/unit/w39-walk-floors.
//
// THE LAWS (docs/laws-registry.json): `no-mutation-and-address` (THE EMPTY ACTION SEAT IS A SKELETON) ·
// `a-claim-renders` (the item exchange's net) · `inputs-have-a-kind` (the kind drives the doors) ·
// `the-reader-is-you` · `active-means-alive` · `one-receipt-per-deed`.
// Gates:
//   W1 · THE OUTCOME — the unit file passes
//   W2 · THE SEATS — each floor is wired at its one seat (source; the outcome is W1's)
// Run: npx tsx scripts/smoke-w39-walk-floors.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
/** Code only — comments stripped, so a gate never passes on a sentence ABOUT the code. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

console.log('W1 · the outcome (tests/unit/w39-walk-floors)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w39-walk-floors.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('W1 the W39 unit tier passes (empty seat · claim net · answer words · input-kind doors · linked-row words · reader voice)',
  good && !!m && Number(m[1]) >= 14, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nW2 · each floor sits at its one seat');
const detail = code('components/home/item-detail.tsx');
const rail = code('components/home/item-rail.tsx');
ok('W2a the item view fills an EMPTY seat from a held landing — seat fields only, via the one law module',
  /else if \(mayFillEmptySeat\(seatRef\.current\)\) setView\(\(prev\) => \(prev \? fillEmptySeat\(prev, d as ItemViewData, ITEM_SEAT_FIELDS\) : d\)\);/.test(detail)
  && /const ITEM_SEAT_FIELDS = \['prepared', 'machineState', 'verdict', 'mootAskKeys'/.test(detail)
  // …and a landing held while the seat was a placeholder fills it the moment the seat reports empty
  && /else heldRef\.current = d as ItemViewData;/.test(detail)
  && /if \(held && mayFillEmptySeat\(s\)\) \{ heldRef\.current = null;/.test(detail)
  && !/ITEM_SEAT_FIELDS = \[[^\]]*'brief'/.test(detail));
ok('W2b every item door with an item page reports its seat (email · commitment · follow-up)',
  (detail.match(/onSeat=\{reportSeat\} onUnseatedClaim=\{refillSeat\}/g) ?? []).length === 3);
ok('W2c the rail reports what the seat PAINTED, and a door with no item page reports nothing (its hold stands)',
  /const seatPaint: SlotPaint \| null = !itemPage \? null\s*: !items\.some\(\(x\) => x\.id === 'action'\) \? 'empty'\s*: itemPage\.plan\.action \? 'widget' : 'placeholder';/.test(rail));
ok('W2d the item exchange passes the claim net against the seat it renders, and an unseated claim asks for ONE seat-only re-read',
  /const net = t\.text \? dropUnseatedClaims\(t\.text, seated\) : null;/.test(rail)
  && /if \(unseatedClaim && seatPaint === 'empty'\) onUnseatedRef\.current\?\.\(\);/.test(rail)
  && /if \(refilledRef\.current\) return;/.test(detail));
ok('W2e a late reply seeds an EMPTY email draft (the reader\'s own words still win)',
  /if \(!viewReply\?\.content \|\| draft\?\.trim\(\) \|\| userTypedRef\.current\) return;/.test(detail));
const answerSurfaces = ['lib/workflows/process-state.ts', 'lib/workflows/standing.ts', 'components/workflows/process-drawer.tsx', 'lib/tools/worker-tasks.ts']
  .map((p) => readFileSync(p, 'utf8')).join('\n');
ok('W2f no answer surface calls a typed/attached answer "Sent" (the send word is for mail that left)',
  !/Sent — [^\n]*picked up from there|You sent it — the run|\bSent \$\{what\} to/.test(answerSurfaces));
const rows = code('components/thread/ask-rows.tsx');
ok('W2g a document row offers no Type it while an Attach or Point-me-to-it door stands',
  /canType && !d\.onAttach && !d\.onPointToIt \? \{ key: 'type'/.test(rows));
ok('W2h linked work carries the shared WORDS, never a bare percentage',
  !/matchScore|\}%<\/span>/.test(code('app/api/meetings/[id]/linked-work/route.ts') + code('components/meetings/linked-work-panel.tsx'))
  && /shared: sharedWords\(f\.filename\)/.test(code('app/api/meetings/[id]/linked-work/route.ts')));
ok('W2i a workflow description is spoken to its reader — written and served',
  /toReaderVoice\(noSentinel\(generated\.description\)\)/.test(code('lib/workflows/generate-config.ts'))
  && /\{toReaderVoice\(description\)\}/.test(code('components/workflows/workflow-detail.tsx')));
const ledger = code('components/workflows/workflows-ledger.tsx');
ok('W2j ACTIVE means alive — the active strip counts only live states; a delivery is its own line',
  /const ACTIVE_STATES = new Set<string>\(\['needs_you', 'running', 'waiting_on_others'\]\);/.test(ledger)
  && /PROCESS_BUCKETS\.filter\(\(b\) => ACTIVE_STATES\.has\(b\.state\)/.test(ledger)
  && /\{liveProcesses\.length > 0 && \(<>/.test(ledger));
ok('W2k one receipt per deed — creating a workflow says it is live once (the card), never also a toast',
  !/toast\.success\([^)]*is live/.test(code('components/workflows/workflow-draft-card.tsx')));

ok('W2l a reader\'s deed re-prepares THE ITEM IT NAMES (never "find it in the whole spine or do nothing"), and a typed answer is an input: never served as prepared work, matched across label re-wordings, its value handed to every lane',
  /const \{ prepareItemById \} = await import\('@\/lib\/prepare\/prepare-by-id'\);/.test(code('app/api/room/asks/route.ts'))
  && !/buildWorkItems\(admin, userId, \{ todayStr, skipReconcile: true \}\)/.test(code('app/api/room/asks/route.ts'))
  && /if \(isTypedAnswerRow\(d\)\) continue;/.test(code('lib/prepare/read.ts'))
  && /const hit = matchTypedLabel\(label, typed\);/.test(code('lib/prepare/requirements.ts'))
  && /input: 'answer',/.test(code('lib/prepare/supply.ts'))
  // only a FILE makes a doc-send (a typed answer in hand is a drafted reply — no "found the file")
  && /did: reqs\.have\.some\(\(h\) => !!h\.file\) \? 'docsend' : 'draft'/.test(code('lib/prepare/pass.ts'))
  // the ask doors name their item and the item's view re-reads the post-deed world on a bounded beat
  && /window\.dispatchEvent\(new CustomEvent\('aug:item-deed'/.test(code('lib/deeds/gate-doors.ts'))
  && /return NextResponse\.json\(\{ ok: true, settled, remaining: remaining\.length, item \}\);/.test(code('app/api/room/asks/route.ts'))
  && /window\.addEventListener\('aug:item-deed', onDeed\);/.test(code('components/home/item-detail.tsx'))
  && /if \(sig === before && beats < 6\)/.test(code('components/home/item-detail.tsx')));

const rail2 = code('components/home/item-rail.tsx');
const detail2 = code('components/home/item-detail.tsx');
ok('W2m an EMPTY conversation and a still-judging seat are skeletons the fresh read fills (capped beats); the reader\'s own deed turns land at once, never read as orphans, and the work they produced follows them',
  /useLiveRefresh\(!pending && turns\.length === 0, \(\) => setTurnsNonce\(\(n\) => n \+ 1\),\s*\{ everyMs: 6_000, maxTicks: 10 \}\);/.test(rail2)
  && /window\.addEventListener\('aug:item-deed', onItemDeed\);/.test(rail2)
  && /if \(isAskDeedKey\(t\.key\)\) turn\.deed = true;/.test(rail2)
  && /if \(actionFollowsExchange\(plan\.artifact, itemExchange\)\)/.test(rail2)
  && /const settling = transientState === 'preparing' \|\| transientState === 'unjudged';/.test(detail2)
  && /if \(beats > 10 \|\| !mayFillEmptySeat\(seatRef\.current\)\) \{ clearInterval\(t\); return; \}/.test(detail2)
  && /return last\.role === 'user' && !last\.deed \? last : null;/.test(code('components/home/room-chat.ts')));

console.log('\nW3 · the laws are registered');
{
  const reg = JSON.parse(readFileSync('docs/laws-registry.json', 'utf8')) as { laws: Array<{ id: string; statement: string; gates: Array<{ suite: string }>; collides_with: Array<{ law: string; precedence: string }> }> };
  const nm = reg.laws.find((l) => l.id === 'no-mutation-and-address');
  ok('W3a the no-mutation law states the EMPTY-SEAT rule, names this gate, and its precedence over `a-claim-renders`',
    !!nm && /EMPTY action seat/i.test(nm.statement) && nm.gates.some((g) => g.suite === 'smoke-w39-walk-floors')
    && nm.collides_with.some((c) => c.law === 'a-claim-renders' && /empty seat/i.test(c.precedence)));
  for (const id of ['the-reader-is-you', 'active-means-alive', 'one-receipt-per-deed']) {
    const l = reg.laws.find((x) => x.id === id);
    ok(`W3b \`${id}\` is registered with this gate`, !!l && l.gates.some((g) => g.suite === 'smoke-w39-walk-floors'));
  }
  ok('W3c the board runs this gate', /npx tsx scripts\/smoke-w39-walk-floors\.ts/.test(readFileSync('package.json', 'utf8')));
}

// ── W4 · THE PHONE SEAT (the Oct 1 mobile walk at 390×844, emulated). Floors, not a law: each is the
//   structural reason a page was unusable at phone width, held at its one seat. Visual truth is the walk.
console.log('W4 · the phone seat (390px)');
{
  const side = code('components/one/one-sidebar.tsx');
  ok('W4a the sidebar is an off-canvas drawer below md (static column at md+) with a top-bar opener, and any navigation closes it',
    /md:static/.test(side) && /-translate-x-full/.test(side) && /aria-label="Open menu"/.test(side)
    && /useEffect\(\(\) => \{ setMobileOpen\(false\); \}, \[pathname\]\)/.test(side)
    && (side.match(/setMobileOpen\(false\)/g)?.length ?? 0) >= 4 && /closest\?\.\('a\[href\]'\)/.test(side));
  ok('W4b the shell stacks the top bar over the page below md', /flex flex-col md:flex-row/.test(code('app/(main)/layout.tsx')));
  ok('W4c rooms fill the column (never the viewport) at phone width — the top bar would push their composer off-screen',
    /h-\[100dvh\] max-md:h-full/.test(code('components/entities/entity-room.tsx')) && /h-\[100dvh\] max-md:h-full/.test(code('components/room/room-shell.tsx')));
  const vs = code('components/home/view-switcher.tsx');
  ok('W4d the view island docks as a bottom pill on phones and steps aside over a live conversation',
    /max-md:!top-auto max-md:bottom-4/.test(vs) && /phoneHidden \? 'max-md:hidden'/.test(vs)
    && /phoneHidden=\{chatActive\}/.test(code('components/home/home-view.tsx')));
  const ms = code('components/meetings/meetings-shell.tsx');
  ok('W4e meetings: the folder rail steps aside and the calendar starts closed + overlays on phones',
    /hidden md:flex w-\[204px\]/.test(code('components/meetings/meetings-left-panel.tsx'))
    && /setRightPanel\(phone \? null : 'calendar'\)/.test(ms) && /max-md:absolute max-md:inset-y-0 max-md:right-0/.test(ms));
  ok('W4f documents: the scope rail stacks above the library on phones', /flex flex-col md:flex-row/.test(code('components/knowledge/knowledge-panel.tsx')));
  const led = code('components/workflows/workflows-ledger.tsx');
  ok('W4g workflow rows: the verbs wrap under the name, run rows wrap', /flex flex-wrap md:flex-nowrap items-center/.test(led) && /max-md:w-full max-md:pl-\[49px\]/.test(led) && /flex flex-wrap items-center gap-x-3 gap-y-1/.test(led));
  ok('W4h touch hit areas: ask doors and row deeds grow their hit area on coarse pointers (zero layout shift)',
    /\[@media\(pointer:coarse\)\]:py-2\.5 \[@media\(pointer:coarse\)\]:-my-2\.5/.test(code('components/thread/ask-rows.tsx'))
    && /\[@media\(pointer:coarse\)\]:py-2\.5 \[@media\(pointer:coarse\)\]:-my-2\.5/.test(code('components/work/work-row.tsx')));
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
