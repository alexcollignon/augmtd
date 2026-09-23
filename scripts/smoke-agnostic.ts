// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AGNOSTIC GATE (stabilization plan W4.4, PART IV — THE AGNOSTIC CLAUSE).
//
// Owner rule, verbatim: "any work we do is supposed to be agnostic." Client specifics belong to
// DATA + OPS SCRIPTS, never to the product's own code. This gate is the standing check for that
// promise on the PRODUCT surfaces (lib/, app/, components/) — it does not police scripts/, which
// legitimately carries client-named ops tooling (sync drivers, one-off patches, the per-client
// smoke suites) under the same clause's own carve-out.
//
// TWO CHECKS:
//   G1 — NO CLIENT-NAME TOKEN in lib/ app/ components/, outside an explicit per-file ALLOWLIST.
//        The allowlist exists for files a DIFFERENT in-flight wave owns (see stabilization-plan.md
//        DO-NOT-TOUCH lists) — it is a name-by-name ledger, never a blanket exemption, and every
//        entry names the reason so it reads as a to-do, not a loophole.
//   G2 — lib/tenders/** carries no hard-coded CLIENT folder name or doc source-attribution string.
//        The member-directory module takes both as parameters with a generic default (see
//        DEFAULT_MEMBER_FOLDER_NAME / DEFAULT_MEMBER_SOURCE_LABEL) — the literal client values live
//        in scripts/ahk-member-sync.ts / scripts/ahk-member-enrich.ts, which this gate does not
//        scan (ops scripts are the agnostic clause's sanctioned home for client config).
//
// ZERO AI. ZERO DATABASE. Pure filesystem read + regex. Exits non-zero on any FAIL.
//   npx tsx scripts/smoke-agnostic.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['lib', 'app', 'components'];
const CODE_EXT = new Set(['.ts', '.tsx']);

// ── G1 — THE TOKEN LIST. One constant, grown as new client engagements are found leaking into
// product code. Word-bounded so a token never false-fires inside an unrelated word (the "awareness"
// contains "rene" trap, found writing this gate by hand — see the case-insensitive \b boundaries). ──
export const CLIENT_NAME_TOKENS: readonly string[] = [
  'René', 'Rene', 'Thorsten', 'Galp', 'Madalena', 'Wilson', 'Nevine', 'Nader',
  'EGBANK', 'EG Bank', 'STC Bahrain', 'Fidelidade', 'iScore', 'CelcomDigi', 'Léa', 'Lea Fontaine',
  'Transaction Focus', 'tfocus', 'AHK', 'Helen',
];

const tokenRegex = (t: string): RegExp =>
  new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

// Per-file allowlist for G1 — every entry is a KNOWN, OWNED debt, not a free pass. Paths are
// relative to the repo root. Remove an entry once its owning wave sweeps that file; adding an entry
// requires a reason in the trailing comment (never a bare path).
const G1_ALLOWLIST: readonly string[] = [
  // lib/prepare/** — DO NOT TOUCH this wave (in-flight elsewhere); "René sweep" comments.
  'lib/prepare/read.ts',
  'lib/prepare/requirements.ts',
  'lib/prepare/invite-from-conversation.ts',
  // lib/work/machine.ts — explicitly DO NOT TOUCH this wave; "René sweep" comments throughout.
  'lib/work/machine.ts',
  // lib/converse/** — DO NOT TOUCH this wave; "the Rene incident" / "STC Bahrain" comments.
  'lib/converse/index.ts',
  // lib/commitments/** — DO NOT TOUCH this wave; a "Send the deck to Rene" example.
  'lib/commitments/extract.ts',
  // lib/home/** — DO NOT TOUCH this wave; "the EG Bank benchmark" comment.
  'lib/home/delegate.ts',
  // app/api/cron/** — DO NOT TOUCH this wave; "the Fidelidade" comment.
  'app/api/cron/commitments-sweep/route.ts',
  // components/home/** — DO NOT TOUCH this wave; a "René sweep" comment.
  'components/home/item-detail.tsx',
  // components/entities/** — DO NOT TOUCH this wave; an "EG Bank" correction example.
  'components/entities/add-to-work-control.tsx',
  // lib/tenders/** + lib/tools/pt-tenders.ts reference the real doc filename
  // docs/ahk-tender-matching-plan.md and the real script scripts/ahk-member-sync.ts by path —
  // that is a citation of an existing (unrenamed) doc/script name, not a leaking client detail.
  'lib/tenders/member-directory.ts',
  'lib/tenders/enrich-members.ts',
  'lib/tenders/fetch.ts',
  'lib/tenders/write-profile-doc.ts',
  'lib/tools/pt-tenders.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (CODE_EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

let failures = 0;
const fail = (msg: string) => { console.log(`  ✗ ${msg}`); failures++; };
const pass = (msg: string) => console.log(`  ✓ ${msg}`);

console.log('\n═══ THE AGNOSTIC GATE (smoke-agnostic) ═══\n');

// ── G1 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('G1 — no client-name token in lib/ app/ components/ (outside the allowlist)');
const allowSet = new Set(G1_ALLOWLIST.map((p) => p.replace(/\\/g, '/')));
const hits: { file: string; token: string; line: number }[] = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (allowSet.has(rel)) continue;
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (const token of CLIENT_NAME_TOKENS) {
      const re = tokenRegex(token);
      lines.forEach((line, i) => { if (re.test(line)) hits.push({ file: rel, token, line: i + 1 }); });
    }
  }
}
if (hits.length) {
  for (const h of hits.slice(0, 50)) fail(`${h.file}:${h.line} — client-name token "${h.token}"`);
  if (hits.length > 50) fail(`… and ${hits.length - 50} more`);
} else {
  pass(`zero unallowlisted client-name hits across ${SCAN_DIRS.join('/')}`);
}

// ── G2 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('\nG2 — lib/tenders has no hard-coded client folder/source string');
const TENDERS_LITERAL_BANS = ["'AHK Member companies'", '"AHK Member companies"', 'Quelle: AHK-Mitgliederverzeichnis'];
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
