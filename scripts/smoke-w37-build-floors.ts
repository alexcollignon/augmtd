// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W37 · THE BUILDER'S FLOORS. ZERO AI, ZERO network, no data. The outcome half is the unit tier
// (pure functions, called — never grepped): tests/unit/w37-build-floors. The measured half is
// scripts/eval-surfaces.ts --surfaces build,plan,compute (both tiers vs the plain models).
//
// THE LAW (docs/laws-registry.json): `authoring-says-what-it-cannot`.
// Gates:
//   S1 · THE OUTCOME — the unit file passes
//   S2 · THE SEATS — each floor is wired at its one seat (source; the outcome is S1's)
// Run: npx tsx scripts/smoke-w37-build-floors.ts
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

console.log('S1 · the outcome (tests/unit/w37-build-floors)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w37-build-floors.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('S1 the W37 build-floors unit tier passes (unsupported note · chat patch merge · eval build checks)',
  good && !!m && Number(m[1]) >= 9, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nS2 · each floor sits at its one seat');
const gc = code('lib/workflows/generate-config.ts');
ok('S2a the authoring door asks for the unsupported parts and code speaks them on the step channel',
  /"unsupported": \[\]/.test(gc) && /unsupportedNote\(\(generated as Record<string, unknown>\)\.unsupported\)/.test(gc) && /if \(note\) stepNotes\.push\(note\)/.test(gc));
ok('S2b the authoring door knows the user\'s clock and zone', /userTimezone\(supabase, userId\)/.test(gc));
const chat = code('app/api/workflows/[id]/chat/route.ts');
ok('S2c the Studio chat merges its patch over the workflow (never the preview as the prompt) and runs through aiCreate',
  /mergePatchSteps\(workflow, result\.patch\)/.test(chat) && /await aiCreate\(client,/.test(chat) && !/chat\.completions\.create\(/.test(chat));
const sug = code('app/api/workflows/[id]/suggestions/route.ts');
ok('S2d the suggestions read the steps themselves and parse a fenced answer',
  /stepLines\.join/.test(sug) && /parseModelJSON<unknown>\(raw, null\)/.test(sug) && !/JSON\.parse\(raw\.trim\(\)\)/.test(sug));
const ow = code('app/api/inbox/[id]/open-workflow/route.ts');
ok('S2e the email-born plan clips its email by the excerpt law and carries the plan floor (today · pending figures · the user\'s own acts)',
  /clipForPrompt\(sd\.body \|\| '', \d+\)/.test(ow) && !/\(sd\.body \|\| ''\)\.slice\(/.test(ow) && /SYSTEM_PROMPT \+ userContextNote \+ planFloor/.test(ow));
const gen = code('app/api/work/saved-workflows/generalize/route.ts');
ok('S2f the template door writes in the task\'s language with a generic example (no real names)', /same language as the input/.test(gen) && /Input: Draft an email introducing our onboarding service to Acme/.test(gen));

const ss = code('lib/work/standing-spec.ts');
ok('S2g the standing spec refuses a cron that ORs day-of-month and day-of-week (repair, then honest error)',
  (ss.match(/!cronOrTrap\(cron\)/g) ?? []).length >= 2);
const al = code('lib/company/synthesize-alignment.ts');
ok('S2h the strategy suggestions write in the goals\' language and judge each goal on its own evidence', /language the goals are written in/.test(al) && /OWN evidence/.test(al));

ok('S2i the run-health line is counted in code, and the sources the model chose are said on the draft',
  /const healthLine = failCounts\.size/.test(sug) && /Run health \(counted in code\)/.test(sug) && /I chose these sources myself/.test(gc));
ok('S2j the strategy language is stated up front (code-detected, else declared first in the JSON)', /detectLanguage\(goals\.map/.test(al) && /\$\{langLine\}/.test(al));

ok('S2k the email-born plan gets the named weekdays resolved in code; the compiler sees the data file\'s real head',
  /weekdayFacts\(`\$\{subject\}/.test(ow) && /USER_ACT\.test\(String\(st\?\.action/.test(ow) && /THE HEAD OF data\.txt/.test(code('lib/compute/document-compiler.ts')));

const ip = code('lib/home/item-plan.ts');
ok('S2l a reply/draft step is never folded as a trivial check; an all-green history is said by code on the first suggestion',
  /t\.capability === 'draft'\) return false;\s*if \(isReplyLikeStep\(t\)\) return false;/.test(ip) && /All \$\{runs\.length\} recent runs succeeded/.test(sug));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
