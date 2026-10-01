// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AGNOSTIC GATE (stabilization plan W4.4, PART IV — THE AGNOSTIC CLAUSE) + THE NO-REAL-NAMES GATE
// (house rule 2).
//
// Owner rule, verbatim: "any work we do is supposed to be agnostic." Client specifics belong to
// DATA + OPS SCRIPTS, never to the product's own code — and NO real person / client / prospect name
// appears anywhere in the repo (code, prompts, fixtures, scripts, tests, docs, infra).
//
// TWO CHECKS:
//   G1 — NO REAL-NAME WORD anywhere in lib/ app/ components/ scripts/ tests/ docs/ infra/ supabase/.
//        The banned words are stored as HASHES (first 16 hex of sha256 of the lower-cased,
//        accent-stripped word) so this file itself never carries a real name. Text is split into
//        alphanumeric words and each word is hashed — whole-word only, so "awareness" never trips a
//        short name. To ban a new name: `printf %s word | shasum -a 256 | cut -c1-16`, append below.
//        The per-file ALLOWLIST is for files another in-flight wave owns — a to-do, never a loophole.
//   G2 — lib/tenders/** carries no hard-coded CLIENT folder name or doc source-attribution string.
//        (The client values live in DATA: the caller passes them, or generic defaults apply.)
// Run: npx tsx scripts/smoke-agnostic.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['lib', 'app', 'components', 'scripts', 'tests', 'docs', 'infra', 'supabase'];
const TEXT_EXT = new Set(['.ts', '.tsx', '.md', '.json', '.py', '.sql', '.html', '.example', '.js', '.mjs', '.yml', '.yaml']);

export const BANNED_NAME_HASHES: ReadonlySet<string> = new Set([
  '63c5d687c64d4894', '30bb91ba6ae41f18', '936872c6674e036d', '0f8915bad3d2ac7a', '919e680ee460849a', '5fc6f3f999c35ffe', 'd23f84377dd34b60', 'c75339cba23666e7', '4b8d45a5908713d6', '85839402d7b2ba26', 'a005bf305a870409', 'f7e2626570a65583', '4cde945202335899', '271d9a9399da5bf9', '01324f5cde3499ee', '80c95d0e9e710a56', '9b8df39d949e3573', 'd79bfacea2a08964', '156d16861c251e11', '225c59479c3ddc20', 'f7693a6d79577c1e', '03fa5e7090f6cc48', '02b3de0d60f9a4d7', '91458d5e1d91ce7a', 'b63e307194fad7ae', 'fd2870489eb862dc', '6292a92f92089202', 'c1cf9ec4642e50e5', '0e903a02f06756b7', 'd9e6ed6b27344f31', '92ec38902e89c6c1', 'ba2436bd25a09dd5',
]);

const wordHash = (w: string): string => createHash('sha256').update(w).digest('hex').slice(0, 16);
const normalise = (line: string): string => line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function bannedWordsIn(line: string): string[] {
  const found: string[] = [];
  for (const w of normalise(line).split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && BANNED_NAME_HASHES.has(wordHash(w))) found.push(wordHash(w));
  }
  return found;
}

// Per-file allowlist for G1 — KNOWN, OWNED debt: files another in-flight wave owns this cycle.
// Remove an entry once its owner sweeps the file; adding one needs a reason (never a bare path).
const G1_ALLOWLIST: readonly string[] = [
  'app/privacy/page.tsx', // the owner's own public legal contact address (mailto); moves to config with the legal-pages pass
  'app/terms/page.tsx',   // same contact address
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

let failures = 0;
const fail = (msg: string) => { console.log(`  ✗ ${msg}`); failures++; };
const pass = (msg: string) => console.log(`  ✓ ${msg}`);

console.log('\n═══ THE AGNOSTIC GATE (smoke-agnostic) ═══\n');

// ── G1 ──────────────────────────────────────────────────────────────────────────────────────────
console.log(`G1 — no real-name word in ${SCAN_DIRS.join('/')} (outside the allowlist)`);
const allowSet = new Set(G1_ALLOWLIST);
const hits: { file: string; line: number; hash: string }[] = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (allowSet.has(rel)) continue;
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      for (const h of bannedWordsIn(line)) hits.push({ file: rel, line: i + 1, hash: h });
    });
  }
}
if (hits.length) {
  for (const h of hits.slice(0, 50)) fail(`${h.file}:${h.line} — banned real-name word (hash ${h.hash})`);
  if (hits.length > 50) fail(`… and ${hits.length - 50} more`);
} else {
  pass(`zero real-name hits across ${SCAN_DIRS.join('/')}`);
}

// ── G2 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('\nG2 — lib/tenders has no hard-coded client folder/source string');
const TENDERS_LITERAL_BANS = ["'Chamber Member companies'", '"Chamber Member companies"', 'Quelle: Chamber-Mitgliederverzeichnis'];
let g2ok = true;
for (const file of walk(join(ROOT, 'lib', 'tenders'))) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const banned of TENDERS_LITERAL_BANS) {
    if (text.includes(banned)) { fail(`${rel} — hard-coded literal ${JSON.stringify(banned)}`); g2ok = false; }
  }
}
// Positive check: the generic defaults must exist and be exported (the module didn't just delete
// the client value without replacing it with a real parameterized default).
try {
  const memberDir = readFileSync(join(ROOT, 'lib', 'tenders', 'member-directory.ts'), 'utf8');
  if (!/export const DEFAULT_MEMBER_FOLDER_NAME\s*=/.test(memberDir)) { fail('DEFAULT_MEMBER_FOLDER_NAME is missing from lib/tenders/member-directory.ts'); g2ok = false; }
  if (!/export const DEFAULT_MEMBER_SOURCE_LABEL\s*=/.test(memberDir)) { fail('DEFAULT_MEMBER_SOURCE_LABEL is missing from lib/tenders/member-directory.ts'); g2ok = false; }
} catch { fail('lib/tenders/member-directory.ts not found'); g2ok = false; }
if (g2ok) pass('no hard-coded client folder/source literal; generic defaults present');

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure${failures === 1 ? '' : 's'}\n`);
process.exit(failures === 0 ? 0 : 1);
