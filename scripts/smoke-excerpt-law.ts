// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXCERPT-LAW FLOOR (permanent, Aug 17 — the Rene incident): the excerpt-honesty law (Aug 4)
// was applied as a LIST OF SITES and decayed one arc later — lib/converse was built after the law
// and hard-cut transcript lines mid-word ("…move forward after qu"), so a delegated coworker read
// OUR budget cut as "the task description got cut off", confabulated the quote ("5 wo..."), and
// reported itself blocked while handing back finished work. A law enforced by discipline decays;
// a law enforced by a gate doesn't. These are pure source floors — zero AI, run in seconds.
// Run: npx tsx scripts/smoke-excerpt-law.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const clip = readFileSync('lib/utils/clip-for-prompt.ts', 'utf8');
const conv = readFileSync('lib/converse/index.ts', 'utf8');
const dele = readFileSync('lib/home/delegate.ts', 'utf8');

console.log('THE PRIMITIVE:');
ok('clip-for-prompt exports the mark, the rule, and the clipper',
  clip.includes('EXCERPT_MARK') && clip.includes('EXCERPT_RULE') && clip.includes('export function clipForPrompt'), '');
ok('the marker text is stable (prompts and rules reference it verbatim)',
  clip.includes('[…clipped for length — the original continues]'), '');

console.log('\nTHE CONVERSE SEAMS (the Rene incident class):');
ok('converse imports the primitive', conv.includes("from '@/lib/utils/clip-for-prompt'"), '');
ok('NO raw transcript-line clip survives (the mid-word idiom is dead)',
  !conv.includes(".replace(/\\s+/g, ' ').slice(0,"), 'a raw slice on a normalized transcript line is back');
ok('the delegation detail clips its transcript block honestly',
  conv.includes('clipForPrompt(transcript, 4000)') && !conv.includes('transcript.slice(0, 4000)'), '');
ok('the delegation detail clips the attached material honestly',
  conv.includes('clipForPrompt(material, 18000)') && !conv.includes('material.slice(0, 18000)'), '');
ok('the router clips the transcript honestly',
  conv.includes('clipForPrompt(transcript, 1200)'), '');
ok('both transcript builders carry the rule IN THE HEADER (a tail-clip can never strip it)',
  (conv.match(/latest last; \$\{EXCERPT_RULE\}/g) ?? []).length >= 2, '');

console.log('\nTHE DELEGATION CONTRACT:');
ok('the consuming prompt carries the excerpt rule', dele.includes('EXCERPT_RULE'), '');
ok('…and forbids claiming a cut the source does not show',
  dele.includes('Never claim an instruction or document "got cut off"'), '');
ok('THE REPORT SPEAKS THE DELIVERABLE (blocked-while-finished is outlawed)',
  dele.includes('Never report yourself blocked while handing back'), '');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
