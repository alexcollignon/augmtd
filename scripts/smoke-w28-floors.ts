// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W28 · THE PRODUCER EFFORT, THE QUOTE NAMES ITS ACTOR, THE QUOTE SEPARATES, THE OVERDUE DEBT
// OUTRANKS A FRESH ASK. ZERO AI, ZERO network, no data. The outcome half is the unit tier (pure functions,
// called — never grepped): tests/unit/w28-extraction-and-move-floors + tests/unit/ai-effort.
//
// THE LAWS (docs/laws-registry.json): `quote-names-its-actor` (direction from the verified quote's grammar,
// a suggestion owns nothing, a CC'd sender's promise to the To: party is nobody's, a mail's asks in
// different sentences never merge) · `one-voice-brief` (rank (c) — the user's due debt outranks a fresh
// ask — in code, with a code-built label).
// Gates:
//   W1 · THE OUTCOME — the two unit files pass
//   W2 · THE SEATS — each floor is wired at its one seat (source; the outcome is W1's)
// Run: npx tsx scripts/smoke-w28-floors.ts
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

console.log('W1 · the outcome (tests/unit/w28-extraction-and-move-floors + tests/unit/ai-effort)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w28-extraction-and-move-floors.test.ts tests/unit/ai-effort.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('W1 the W28 unit tier passes (quote actor · quote separates · overdue debt · producer effort)',
  good && !!m && Number(m[1]) >= 30, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nW2 · each floor sits at its one seat');
const ex = code('lib/commitments/extract.ts');
ok('W2a the extraction reads the quote\'s actor before the seat law, and the seat law drops a CC\'d sender\'s promise',
  /quoteDirectionFloor\(c, \{/.test(ex) && ex.indexOf('quoteDirectionFloor(c, {') < ex.indexOf('seatStripsObligation(`')
  && /actors\.get\(c\) !== 'author'/.test(ex));
ok('W2b the G1 merge never joins a mail\'s asks stated in different sentences', /mergeableByQuote\(/.test(ex) && /!separateByQuote\(x\)/.test(ex));
const b = code('lib/room/brief.ts');
ok('W2c the room brief enforces the overdue-debt rank after the calm floor',
  /overdueDebtOutranks\(g\.board, move\?\.ref \?\? null, todayLocal\)/.test(b) && b.indexOf('overdueDebtOutranks(g.board') > b.indexOf('calmContradictsBoard(g.board)'));
const producers: Array<[string, RegExp]> = [
  ['lib/ai/email-processor.ts', /\{ producer: 'inbox\.understanding' \}/],
  ['lib/work/judge.ts', /effortProducer: 'work\.judge'/],
  ['lib/commitments/fulfillment.ts', /effortProducer: 'commitments\.fulfillment'/],
  ['lib/room/brief.ts', /effortProducer: 'room\.brief'/],
  ['lib/commitments/extract.ts', /\{ producer: 'commitments\.extract' \}/],
];
const missing = producers.filter(([p, re]) => !re.test(code(p))).map(([p]) => p);
ok('W2d every measured producer names itself on its call (lib/ai/effort.ts PRODUCER_EFFORT decides)', missing.length === 0, missing.join(', '));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
