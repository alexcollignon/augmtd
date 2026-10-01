// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W37 · THE NARRATION TRUTH LAW. ZERO AI, ZERO network, no data. The outcome half is the unit
// tier (pure functions, called — never grepped): tests/unit/w37-narration-floors. The measured half is
// scripts/eval-surfaces.ts --surfaces narrate,prep (both tiers vs the plain models).
//
// THE LAW (docs/laws-registry.json): `narration-truth` (+ `time-truth`, `excerpt-honesty`, `untrusted-input-is-data`).
// Gates:
//   N1 · THE OUTCOME — the unit file passes
//   N2 · THE SEATS — every narrator reads the one rules copy and its floors at its one seat
// Run: npx tsx scripts/smoke-w37-narration.ts
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

console.log('N1 · the outcome (tests/unit/w37-narration-floors)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w37-narration-floors.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('N1 the narration floors pass (truth rules · page sections · figures floor · message days · clean silence · unmeasured is absent)',
  good && !!m && Number(m[1]) >= 12, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nN2 · every narrator reads the one copy, at its one seat');
const state = code('lib/entities/state.ts');
const person = code('lib/people/brain.ts');
const status = code('app/api/entities/[id]/status-update/route.ts');
const antic = code('lib/home/anticipation.ts');
const prep = code('app/api/meetings/[id]/prep/route.ts');
const proc = code('lib/calendar/meeting-processor.ts');
ok('N2a the state synthesis reads the rules, the threads\' own words from the one page, and a dated gist that keeps a figure with its target',
  /\$\{NARRATION_TRUTH_RULES\}/.test(state) && /pickPageSections\(g\?\.text \?\? '', \['FIGURES ON RECORD', 'THE THREADS THEMSELVES', 'THE LEDGER NOW'\]\)/.test(state)
  && /annotateMessageDays\(withoutMachineAddressed\(topMessageOf\(/.test(state) && /LEDGER_GIST_CHARS\);/.test(state) && /effort: STATE_EFFORT/.test(state));
ok('N2b the person state reads the rules, the inbound words and the user\'s own sent words, each line saying who wrote to whom',
  /\$\{NARRATION_TRUTH_RULES\}/.test(person) && /gist: own \? clipForPrompt\(own, PERSON_GIST_CHARS\)/.test(person) && /sentWords\.get\(/.test(person) && /email FROM \$\{e\.actor\} TO you/.test(person));
ok('N2c the status update reads the one grounding on the voice slot, with the figures floor',
  /assembleRoomGrounding\(supabase, user\.id, \{ kind: 'entity', entityId: id \}\)/.test(status) && /shape: \{ output: 'json', voice: true \}/.test(status)
  && /\$\{NARRATION_TRUTH_RULES\}/.test(status) && /figuresLeftOut\(g\.text, text\)/.test(status));
ok('N2d the room\'s meeting prep reads the page whole under the excerpt law (no raw head cut) and the rules',
  /clipForPrompt\(g\.text\.replace\(/.test(antic) && !/g\.text[^\n]*\.slice\(0, 3500\)/.test(antic) && /\$\{NARRATION_TRUTH_RULES\}/.test(antic));
ok('N2e the meeting panel brief reads real columns (no emails.snippet), as dated data, with machine lines removed',
  !/snippet, body/.test(prep) && /inboundBlock\('email', annotateMessageDays\(withoutMachineAddressed\(/.test(prep) && /INBOUND_DATA_RULE/.test(prep) && /dayRelativeTo\(/.test(prep));
ok('N2f the agenda prep goes through the factory door (aiCreate) and reads its mail + invite description as data',
  /await aiCreate\(openai, \{/.test(proc) && !/chat\.completions\.create\(/.test(proc) && /inboundBlock\('description', withoutMachineAddressed\(event\.description\)/.test(proc));
ok('N2h UNMEASURED IS ABSENT: the pattern analyzer stores no default acceptance rate',
  /acceptanceRate: null,/.test(code('lib/calendar/pattern-analyzer.ts')) && !/acceptanceRate: 0\.\d/.test(code('lib/calendar/pattern-analyzer.ts')));

ok('N2j the figures are stated by code: the room opening and the room prep append figuresOnRecordLine and re-ask once on an adopted figure',
  /figuresOnRecordLine\(g\.text, abs\.text\)/.test(code('lib/room/brief.ts')) && /adoptsOneFigure\(g\.text, String\(res\.json\?\.brief/.test(code('lib/room/brief.ts'))
  && /figuresOnRecordLine\(g\.text, brief\)/.test(antic) && /adoptsOneFigure\(g\.text, brief\)/.test(antic));
ok('N2i the unrendered agenda prep is gated off in the crons (flag, default off)',
  /if \(!meetingAgendaPrepEnabled\(\)\) return \{ processed: 0, created: 0 \};/.test(proc) && /process\.env\.MEETING_AGENDA_PREP_ENABLED === 'true'/.test(proc));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
