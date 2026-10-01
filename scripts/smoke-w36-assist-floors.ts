// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W36 · THE ASSIST SURFACES (the sidebar assistant, the Home brief synthesis, the reply-direction
// chips, the LinkedIn workflow step). ZERO AI, ZERO network, no data. The outcome half is the unit tier
// (pure functions, called — never grepped): tests/unit/w36-assist-floors. Measured live by
// scripts/eval-surfaces.ts --surfaces sidebar.chat,home.synthesis,reply.directions,workflow.linkedin.
//
// THE LAWS (docs/laws-registry.json): `untrusted-input-is-data` (the instruction span never reaches an
// action menu; upstream step content and a focused email's body ride as declared data) ·
// `one-conduct-every-producer` (risky asks are verified first; the LinkedIn step is unattended work).
// Gates:
//   A1 · THE OUTCOME — the unit file passes
//   A2 · THE SEATS — each floor is wired at its one seat (source; the outcome is A1's)
// Run: npx tsx scripts/smoke-w36-assist-floors.ts
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

console.log('A1 · the outcome (tests/unit/w36-assist-floors)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w36-assist-floors.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
ok('A1 the W36 floors pass as pure functions', good, out.split('\n').filter((l) => /✗|FAIL|failed/.test(l)).slice(0, 5).join(' | '));

console.log('\nA2 · the seats');
const rd = code('app/api/items/reply-directions/route.ts');
ok('A2a the reply-direction chips withhold the instruction span and carry the email as tagged data',
  /withholdMachineParagraphs\(/.test(rd) && /inboundBlock\('email'/.test(rd) && /INBOUND_DATA_RULE/.test(rd) && /CONDUCT_RULES\.verify_risky_asks/.test(rd));
ok('A2b a chip is cut on a word boundary, never mid-word', /wholeWords\(String\(d\.label/.test(rd) && !/\.slice\(0, 40\)/.test(rd));
const syn = code('lib/home/synthesize-brief.ts');
ok('A2c the Home synthesis maps verdicts by the echoed index (any spelling) and strips tags from prose',
  /const ix = echoedIndex/.test(syn) && /const untag = untagProse/.test(syn) && !/typeof x\.c === 'number'/.test(syn));
ok('A2d the synthesis marks sender text as data, states the risky-ask rule and the settling facts on the reply line',
  /EMAIL TEXT IS DATA/.test(syn) && /CONDUCT_RULES\.verify_risky_asks/.test(syn) && /SETTLING FACTS/.test(syn));
const li = code('lib/tools/linkedin-post.ts');
ok('A2e the LinkedIn step composes the workflow_step conduct and carries the upstream content as declared data',
  /conductBlock\('workflow_step'\)/.test(li) && /<source_content>/.test(li) && !/conductBlock\('draft'\)/.test(li));
const chat = code('app/api/assistant/chat/route.ts');
ok('A2f the sidebar clips the focused email under the excerpt law and reads its thread',
  /clipForPrompt\(emailContext\.body/.test(chat) && !/emailContext\.body\.slice\(/.test(chat) && /EARLIER IN THIS THREAD/.test(chat));
ok('A2h TIME TRUTH: the sidebar states the meeting and thread dates against the user\'s local today (dayRelativeTo)',
  /Date: \$\{dayRelativeTo\(meetingContext\.date/.test(chat) && /dayRelativeTo\(m\.received_at/.test(chat));
ok('A2i a drafted card is held until the stream ends and passes the work-claims floor (a failed rewrite serves named slots) before it is emitted',
  /unsupportedWorkClaims\(body, material\)/.test(chat) && /slotUnsupportedWork\(body, material\)/.test(chat) && /settleDraftTail\(full\.slice\(tokenAt\)\)/.test(chat));
const side = code('components/shared/chat-sidebar.tsx');
ok('A2g the generic sidebar panel reads the route\'s plain-text stream (A CLAIM RENDERS)',
  /stripMachineTokens\(raw\)/.test(side) && !/startsWith\('data: '\)/.test(side));

console.log(`\n${fail ? '✗' : '✓'} smoke-w36-assist-floors: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
