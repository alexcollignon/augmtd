// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W37 · THE WORKFLOW STEP'S FLOORS. ZERO AI, ZERO network, no data. The outcome half is the unit
// tier (pure functions, called — never grepped): tests/unit/w37-step-floors. The measured half is
// scripts/eval-surfaces.ts --surfaces workflow.step (both tiers vs the plain models).
//
// THE LAW (docs/laws-registry.json): `step-deliverable-floors` (+ `time-truth`, `anchor-law`).
// Gates:
//   S1 · THE OUTCOME — the unit file passes
//   S2 · THE SEATS — each floor is wired at its one seat (source; the outcome is S1's)
// Run: npx tsx scripts/smoke-w37-step-floors.ts
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

console.log('S1 · the outcome (tests/unit/w37-step-floors)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w37-step-floors.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('S1 the W37 step-floors unit tier passes (user-zone clock · weekday pair · requested count)',
  good && !!m && Number(m[1]) >= 8, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nS2 · each floor sits at its one seat');
const ex = code('lib/workflows/execute-step.ts');
const aiStep = ex.slice(ex.indexOf('async function executeAIStep'), ex.indexOf('export function unwrapJsonFence'));
const agentDetailed = ex.slice(ex.indexOf('export async function executeAgentStepDetailed'));
ok('S2a the AI step\'s clock is the user\'s local day (never the UTC weekday line)',
  /const dateLine = await stepClockFor\(ctx\);/.test(aiStep) && !/timeZone: 'UTC' \}\)\}, `/.test(aiStep));
ok('S2b the agent step carries the same clock (inline header and the AgentOS message)',
  /await stepClockFor\(ctx\),\s*\]\.filter\(Boolean\)/.test(agentDetailed) && /<clock>\\n\$\{await stepClockFor\(ctx\)\}/.test(agentDetailed));
ok('S2c a weekday↔date pair in a step\'s output is settled by code (AI step, not the gate; agent step)',
  /step\.use_worker_identity === false \? text : enforceWeekdayDatePairs\(text/.test(aiStep) && /enforceWeekdayDatePairs\(raw, \{ now: new Date\(\), userText: step\.prompt \}\)/.test(agentDetailed));
ok('S2d a workflow agent step passes the requested count, the claims floor (one rewrite when gutted) and the work-claims slot',
  /return floorAgentDeliverable\(step, ctx, produced\);/.test(ex) &&
  /let text = enforceRequestedCount\(produced\.text, step\.prompt\);/.test(ex) &&
  /groundClaims\(ctx\.supabase, ctx\.userId, \{ draft: text, material \}\)/.test(ex) &&
  /flooringGutted\(floored\)/.test(ex) && /slotUnsupportedWork\(floored\.text, material\)/.test(ex));
ok('S2e the floor checks against everything the writer had (the task and its material first, then the system context — the floor clips), and skips the AgentOS lane that hands none back',
  /material: \[userPrompt, researchBlock, systemParts\.join\('\\n\\n'\)\]/.test(agentDetailed) && /if \(!text\.trim\(\) \|\| !produced\.material\) return text;/.test(ex));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
