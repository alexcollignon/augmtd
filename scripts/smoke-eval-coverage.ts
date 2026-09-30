// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE · W26 EVAL COVERAGE (zero AI, zero network). Every AI call site in lib/ app/ components/ and
// every thread-kit card kind must map to a registered quality-engine adapter, or to a stated
// pending surface / exemption with a reason (scripts/lib/eval/engine/coverage.ts). A new component or
// a new integration's output cannot ship unmeasured by accident: an unmapped file, a file that grew a
// call site, an adapter nobody maps to, or an entry naming an unregistered adapter fails the board.
//   npx tsx scripts/smoke-eval-coverage.ts            # the gate
//   npx tsx scripts/smoke-eval-coverage.ts --by-slot  # + the map grouped by task slot
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import path from 'path';
import { scanCallSites, scanCardKinds, checkCoverage, CALL_SITES, CARD_KINDS } from './lib/eval/engine/coverage';
import { ADAPTERS } from './lib/eval/engine/registry';

const root = path.resolve(__dirname, '..');
const sites = scanCallSites(root);
const kinds = scanCardKinds(readFileSync(path.join(root, 'components/thread/types.ts'), 'utf8'));
const rep = checkCoverage({ sites, kinds, registered: ADAPTERS.map((a) => a.id) });

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

console.log('\nW26 · eval coverage gate');
check('the call-site scan found the AI surface', sites.length >= 50, `${sites.length} files`);
check('the thread-kit kind union was read', kinds.length >= 10, kinds.join(', '));
check('every call site and card kind maps to an adapter or a stated reason', rep.failures.length === 0,
  rep.failures.length ? `\n      - ${rep.failures.join('\n      - ')}` : `${rep.counts.measured} measured · ${rep.counts.pending} pending (stated stage) · ${rep.counts.exempt} exempt`);
const exemptKinds = Object.entries(CARD_KINDS).filter(([, e]) => e.exempt).map(([k]) => k);
console.log(`  · card kinds exempt (no generated content): ${exemptKinds.join(', ')}`);
console.log(`  · adapters registered: ${ADAPTERS.map((a) => `${a.id}${a.status === 'stub' ? ' (stub)' : ''}`).join(', ')}`);
console.log(`  · call-site entries: ${Object.keys(CALL_SITES).length}`);
for (const w of rep.warnings) console.log(`  ⚠ ${w}`);
if (process.argv.includes('--by-slot')) {
  console.log('\n  by task slot (files; measured/pending/exempt):');
  for (const [slot, b] of Object.entries(rep.bySlot).sort()) console.log(`    ${slot.padEnd(22)} ${b.adapters}/${b.pending}/${b.exempt}  ${b.files.join(', ')}`);
}
console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ eval coverage: nothing ships unmeasured by accident');
process.exit(failed ? 1 : 0);
