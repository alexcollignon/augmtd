// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W38 · A DELIVERED FILE OPENS AND CARRIES ITS SOURCE'S FIGURES. ZERO AI, ZERO network, no data.
// The outcome half is the unit tier (pure functions, called — never grepped): tests/unit/generated-files.
// The live half is scripts/verify-generated-files.ts (real producers on probe #3 of each tier, the real
// sandbox and bucket, every stored file judged in code) — run once per wave, never on the board.
//
// THE LAW (docs/laws-registry.json): `delivered-file-truth` (+ `one-production-door`, `facts-floor`,
// `content-floor`, `render-verification-gate`).
// Gates:
//   F1 · THE OUTCOME — the unit file passes (checker · download name · attachment · shape floor ·
//        character-art floor · table finder · hygiene gate · output MIME · the door's explicit kinds)
//   F2 · THE SEATS — each floor is called at its one seat (F2a–F2k)
// Run: npx tsx scripts/smoke-generated-files.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
/** Code only — comments stripped, so a gate never passes on a sentence ABOUT the code. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

console.log('F1 · the outcome (tests/unit/generated-files)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/generated-files.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('F1 the delivered-file floors pass', good && !!m && Number(m[1]) >= 25, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nF2 · each floor at its one seat');
const route = code('app/api/work/threads/[id]/download/route.ts');
ok('F2a the download route names the file through downloadHeaders (the bytes\' extension, the title\'s letters)',
  route.includes('downloadHeaders(artifact.title, artifact.type, artifact.storage_path)') && !/replace\(\/\[\^a-z0-9/.test(route));
const wf = code('lib/workflows/run-workflow.ts');
ok('F2b the workflow e-mail attaches the delivered file (attachmentForArtifact), never a re-render by the configured kind',
  wf.includes('attachmentForArtifact(admin, materialised.artifact') && !/buildArtifactFile\(docType/.test(wf));
const door = code('lib/documents/materialize.ts');
ok('F2c the door: character-art floor first, explicit office kinds beat the frame words, the shape floor before the builders',
  /const content = stripCharacterArt\(args\.content\)/.test(door)
  && /const explicitOffice = !!typed \|\| args\.forceType === 'spreadsheet' \|\| args\.forceType === 'presentation'/.test(door)
  && /!explicitOffice && \(FRAME_WORDS\.test\(request\)/.test(door)
  && /docToSheets\(doc as DocContent\) : docToSlides\(doc as DocContent\)/.test(door)
  && !/textToDocContent\(title, args\.content\)/.test(door));
const comp = code('lib/compute/document-compiler.ts');
ok('F2d the compiler runs the text-hygiene gate inside its validation (a failure feeds the one repair)',
  /officeHygieneProblems\(out\.bytes, args\.ext/.test(comp) && /let problem = await validate\(run\)/.test(comp));
ok('F2j the compiler\'s repair sees the real exception (scriptErrorTail) and every job runs the cache prelude',
  /scriptErrorTail\(r\.stderr\)/.test(comp) && (comp.match(/script: SCRIPT_PRELUDE \+ script/g) ?? []).length === 2);
const tool = code('lib/tools/compute.ts');
ok('F2e compute outputs are stored and indexed with their extension\'s MIME (outputMime)',
  (tool.match(/outputMime\(o\.name, o\.mime\)/g) ?? []).length === 2 && /mimeType: mime, userId/.test(tool));
const dm = code('lib/work/generate-thread-document.ts');
ok('F2f the DM author sees the attached table and writes from code-computed facts',
  /tabularBlock\(groundingContext\)/.test(dm) && /computeDataFacts\(adminClient, userId/.test(dm) && /COMPUTED FACTS/.test(dm) && /THE ATTACHED DATA/.test(dm));
ok('F2g a DM file title is a label (author H1 or clipLabel), never a raw slice of the ask',
  /authoredTitle \|\| clipLabel\(instructions, 60\)/.test(dm) && !/title: instructions\.slice/.test(dm) && !/\?\? instructions\.slice\(0, 60\)/.test(dm));
const idx = code('lib/knowledge/indexer.ts');
const getOrCreate = idx.slice(idx.indexOf('export async function getOrCreateAugmtdSource'), idx.indexOf('export async function getOrCreateAugmtdSource') + 900);
ok('F2k the AUGMTD source read takes the oldest row and checks its error (a .maybeSingle() over a raced pair snowballed a new source per index)',
  /\.order\('created_at', \{ ascending: true \}\)\s*\.limit\(1\)/.test(getOrCreate) && /if \(readErr\)/.test(getOrCreate) && !/maybeSingle/.test(getOrCreate));
const facts = code('lib/compute/data-facts.ts');
ok('F2h the facts codegen has room for a script (≥2500 tokens — at 900 every script truncated → no facts, silently)',
  Number(/maxTokens: (\d+), source: 'brain_synthesis'/.exec(facts)?.[1] ?? 0) >= 2500);
const live = readFileSync('scripts/verify-generated-files.ts', 'utf8');
ok('F2i the live verifier exists, runs probe #3 only, and dry-runs by default',
  /\[3\]/.test(live) && /host\.k !== 3/.test(live) && /DRY RUN/.test(live));

console.log(`\n${pass}/${pass + fail} gates passed`);
process.exit(fail ? 1 : 0);
