// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W35 · THE BILL HAS ONE PAYER · INPUTS HAVE A KIND · MEETING NOTES RETRY · FIGURES ON RECORD ·
// TWO ASKS, BOTH NAMED · THE LAST REVISION. ZERO AI, ZERO network, no data. The outcome half is the unit
// tier (pure functions, called — never grepped): tests/unit/w35-bill-inputs-figures +
// tests/unit/w35-meeting-notes-retry.
//
// THE LAWS (docs/laws-registry.json): `bill-has-one-payer` · `inputs-have-a-kind` · `meeting-notes-retry`
// · `figures-on-record` (+ `one-conduct-every-producer` reaches the Home briefing, `quote-names-its-actor`
// reads a request opened by its own verb).
// Gates:
//   V1 · THE OUTCOME — the two unit files pass
//   V2 · THE SEATS — each floor is wired at its one seat (source; the outcome is V1's)
// Run: npx tsx scripts/smoke-w35-floors.ts
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

console.log('V1 · the outcome (tests/unit/w35-bill-inputs-figures + tests/unit/w35-meeting-notes-retry)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w35-bill-inputs-figures.test.ts tests/unit/w35-meeting-notes-retry.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('V1 the W35 unit tier passes (bill · input kinds · figures · two asks · last revision · notes retry)',
  good && !!m && Number(m[1]) >= 20, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nV2 · each floor sits at its one seat');
const ex = code('lib/commitments/extract.ts');
ok('V2a the extraction gate lets an addressed notice debt through, and the ONE payment rule rides the prompt',
  /if \(addressedNoticeDebt\(f\)\) return \{ delta, extract: true, basis: 'addressed-notice-debt' \};/.test(ex) && /- \$\{PAYMENT_REQUEST_RULE\(who\)\}/.test(ex));
const j = code('lib/work/judge.ts');
ok('V2b the judge states the bill law in verbs and asks each requirement its kind',
  /A BILL OR PAYMENT REQUEST/.test(j) && /"input":"attach\|answer"/.test(j) && /const input = inputOf\(/.test(j));
const rq = code('lib/prepare/requirements.ts');
ok('V2c the resolver verifies kinds with the thread in view, never searches an answer, and marks answers on the ask',
  /attachableSplit\(admin, userId, requires, \{ thread, work: args\.work \?\? null \}\)/.test(rq)
  && /requires = split\.kept\.filter\(\(r\) => r\.input !== 'answer'\);/.test(rq) && /\.\.\.\(uncovered\.some\(\(m2\) => m2\.input === 'answer'\)/.test(rq));
ok('V2d the ask card leads an answer row with the type-it door', /lead: spec\.answers\?\.includes\(label\) \? 'fact' : askItemShape\(label\)/.test(code('components/home/input-card.tsx')));
const bm = code('lib/integrations/meeting-bot/bot-manager.ts');
ok('V2e a failed insights call is marked, recorded, retried on the bounded sweep, and said on the page',
  /failed: true, failureReason:/.test(bm) && /export async function retryFailedMeetingInsights\(/.test(bm)
  && /retryFailedMeetingInsights\(supabase, \{ max: 2/.test(code('app/api/cron/sync-calendar/route.ts'))
  && /insightsFailedWords\(/.test(code('components/meetings/inline-note-view.tsx'))
  && !/storage\.from\(['"]meeting-recordings['"]\)\.remove/.test(bm));
ok('V2f the room grounding carries FIGURES ON RECORD; the briefing carries the ONE conduct rule',
  /figuresBlock\(figureSources\),/.test(code('lib/room/grounding.ts')) && /\$\{CONDUCT_RULES\.conflicting_values\}/.test(code('lib/briefing/compose.ts')));
ok('V2g the verify gate ships the last revision, and re-runs once when a claimed correction is not in the draft',
  /const body = lastRevision\(raw\.slice\(0, cut\)\);/.test(code('lib/workflows/execute-step.ts'))
  && /const unapplied = result\.verdict\.reported \? unappliedCorrections\(/.test(code('lib/workflows/execute-step.ts')));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
