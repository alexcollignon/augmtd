// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W27.B · THE WORK VERDICT, THE INPUT ASK, THE INVITE AND THE NEXT MOVE. ZERO AI, ZERO network,
// no data. The outcome half is tests/unit/w27b-judgment (pure functions, called — never grepped).
//
// THE LAWS (docs/laws-registry.json): `time-truth` (the invite's wall clock is converted by code in the
// stated/user zone, DST-true, never the server's; a past slot is refused; the voice teaches dates) ·
// `no-silent-caps` (the requires budget reports what it leaves behind) · `untrusted-input-is-data` (a
// secret is never an "attach it here" card; a credential/phishing ask is none; an item that instructs
// the assistant is never the move) · `staging-law` (a company document of no body of work may stage;
// another body of work's file never does).
// Gates:
//   J1 · THE OUTCOME — tests/unit/w27b-judgment (A invite slot · B multilingual offer trigger · C secret
//        class · D requires budget · E company documents · F verbs, earned calm, truncation, voice)
//   J2 · THE SEATS — each fix is wired at its one seat (source; the outcome is J1's)
// Run: npx tsx scripts/smoke-judgment-truth.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
/** Code only — comments stripped, so a gate never passes on a sentence ABOUT the code. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

console.log('J1 · the outcome (tests/unit/w27b-judgment)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w27b-judgment.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('J1 the W27.B unit tier passes (invite slot · offer trigger · secret class · requires budget · company documents · move/voice)',
  good && !!m && Number(m[1]) >= 40, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nJ2 · each fix sits at its one seat');
const pa = code('lib/home/prepare-action.ts');
ok('J2a the invite grounding converts through the ONE slot conversion (main + alternatives), keeps the tail, never parses an offset-less ISO',
  (pa.match(/slotFromModel\(/g) ?? []).length >= 4 && /clipTailForPrompt\(sourceText \|\| '', 3500\)/.test(pa)
  && !/new Date\(startISO\)\.toISOString\(\)/.test(pa) && /wallClockToInstant\(raw\.local, ctx\.timezone, zone\)/.test(pa));
const rq = code('lib/prepare/requirements.ts');
ok('J2b the resolver budgets its requires (reported), floors secrets before any model, and stages company documents through the same pick',
  /budgetRequires\(\(args\.requires \?\? \[\]\)/.test(rq) && /const split = await attachableSplit\(admin, userId, requires, \{ thread, work: args\.work \?\? null \}\);/.test(rq)
  && /const floored = splitSecrets\(requires\);/.test(rq) && /if \(isCompanyDocument\(c\)\) return c\.score >= STAGE_SCORE;/.test(rq)
  && !/\.slice\(0, 5\);\n/.test(rq.slice(rq.indexOf('export async function resolveRequirements'), rq.indexOf('export async function resolveRequirements') + 800)));
const j = code('lib/work/judge.ts');
ok('J2c the judge reads verbs with meanings, budgets requires with the remainder on the verdict, and never inventories a secret',
  /renderWorkOptions\(\)/.test(j) && /const \{ kept, leftBehind \} = budgetRequires\(all\);/.test(j) && /\.filter\(\(o\) => !isSecretInput\(o\.label\)\)/.test(j));
const b = code('lib/room/brief.ts');
ok('J2d the room composer: calm-label moves are null, truncation is retried once, the grounding clip is declared',
  /!moveDeclaresCalm\(/.test(b) && /if \(compositionTruncated\(res\.text, res\.json\)\)/.test(b)
  && /clipForPrompt\(g\.text, GROUNDING_BUDGET\)/.test(b) && (b.match(/await aiCall</g) ?? []).length === 1);
ok('J2e the one voice carries no relative delta', !/days? ago/.test(src('lib/room/voice.ts').split('export const TEAM_VOICE')[1] ?? ''));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
