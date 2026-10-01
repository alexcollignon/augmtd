// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W36 · THE WORDS SENT IN THE USER'S NAME. ZERO AI, ZERO network, no data. The outcome half is
// the unit tier (pure functions, called — never grepped): tests/unit/w36-sent-floors. The measured half
// is scripts/eval-surfaces.ts --surfaces sent (compose · cover · slack · report vs the plain models).
//
// THE LAWS (docs/laws-registry.json): `sent-in-the-users-name` (+ `untrusted-input-is-data` for the
// machine-addressed floor, `one-conduct-every-producer` for the two draft rules).
// Gates:
//   S1 · THE OUTCOME — the unit file passes
//   S2 · THE SEATS — each floor is wired at its one seat (source; the outcome is S1's)
// Run: npx tsx scripts/smoke-w36-sent-floors.ts
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

console.log('S1 · the outcome (tests/unit/w36-sent-floors)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w36-sent-floors.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('S1 the W36 sent-floors unit tier passes (group ping · bullet contract · mrkdwn · dated promise · machine-addressed · register · cover body · draft rules)',
  good && !!m && Number(m[1]) >= 14, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nS2 · each floor sits at its one seat');
const route = code('app/api/compose/draft/route.ts');
ok('S2a the compose door reads the thread\'s present as tagged DATA, machine-addressed lines removed, and states the inbound rule',
  /inboundBlock\('message', withoutMachineAddressed\(words\), 1200, \{ attrs \}\)/.test(route) && /threadBlock \|\| sourceBody \? INBOUND_DATA_RULE : ''/.test(route));
ok('S2b the compose door regenerates once on a claim nothing on record shows, then serves a named slot, never the claim',
  /const claims = first \? unsupportedWorkClaims\(first, promiseMaterial\) : \[\];/.test(route) && /return slotUnsupportedWork\(again \|\| first, promiseMaterial\)\.text;/.test(route));
ok('S2c the compose door reads the language and the form of address from the correspondents\' own words',
  /detectLanguage\(languageSource \|\| context\)/.test(route) && /addressRegisterOf\(languageSource\)/.test(route));
ok('S2d the compose door never signs as "me": profile → account metadata → the sent mail\'s display name',
  !/let userName = 'me'/.test(route) && /\.eq\('is_from_user', true\)\.not\('from_name', 'is', null\)/.test(route));
ok('S2e no raw .slice clips a prompt in the compose door (excerpt law)', !/\.slice\(0, (1500|2000|2500)\)/.test(route));
const rw = code('lib/workflows/run-workflow.ts');
ok('S2f the cover email: the document rides clipped with machine-addressed lines removed; only the body is sent',
  /clipForPrompt\(withoutMachineAddressed\(content\), 6000\)/.test(rw) && /return coverBodyOf\(completion\.choices/.test(rw) && !/content\.slice\(0, 2000\)/.test(rw) && !/finalText\.slice\(0, 2000\)/.test(rw));
const sm = code('lib/workflows/slack-message.ts');
ok('S2g the Slack message: material as clipped DATA, then the group-ping, mrkdwn and bullet-contract floors, never cut mid-sentence',
  /clipForPrompt\(withoutMachineAddressed\(opts\.context\), 6000\)/.test(sm)
  && /holdBulletContract\(toSlackMrkdwn\(neutraliseBroadcasts\(text, opts\.instruction\)\), opts\.instruction\)/.test(sm)
  && /finish_reason === 'length' \? endAtBoundary\(raw\) : raw/.test(sm));
ok('S2h the compose door composes promises-as-given and their register (the shared draft profile does not)',
  /\$\{CONDUCT_RULES\.promises_as_given\}\\n\$\{CONDUCT_RULES\.correspondent_register\}/.test(route)
  && !/draft: \{\s*rules: \[[^\]]*'promises_as_given'/.test(code('lib/ai/conduct.ts')));

const dr = code('lib/inbox/draft-reply.ts');
ok('S2i the reply drafter reads a payment-detail change in code, gives the safe-reply contract, and holds the draft (one rewrite, then the offending sentences dropped)',
  /const riskyAsk = asksPaymentDetailChange\(/.test(dr) && /\$\{riskyAsk \? `\$\{RISKY_CHANGE_REPLY\} ` : ''\}/.test(dr)
  && /const agreed = riskyAgreementIn\(checked\.body\);/.test(dr) && /body: dropRiskyAgreement\(again\.body \|\| checked\.body\)/.test(dr));
const dl = code('lib/home/delegate.ts');
ok('S2j the hand-off drops research narration and never presents the user\'s own context picked from search',
  /OPENING_NARRATION/.test(dl) && /THE USER'S OWN CONTEXT IS NOT SEARCHABLE/.test(dl));
ok('S2k the claims floor never slots a non-concrete claim', /if \(!correction && !useRemove && !isConcreteClaim\(v\.quote\)\)/.test(code('lib/prepare/claims-floor.ts')));
console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
