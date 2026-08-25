// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXCERPT-LAW FLOOR (permanent, Aug 17 — the Rene incident): the excerpt-honesty law (Aug 4)
// was applied as a LIST OF SITES and decayed one arc later — lib/converse was built after the law
// and hard-cut transcript lines mid-word ("…move forward after qu"), so a delegated coworker read
// OUR budget cut as "the task description got cut off", confabulated the quote ("5 wo..."), and
// reported itself blocked while handing back finished work. A law enforced by discipline decays;
// a law enforced by a gate doesn't. These are pure source floors — zero AI, run in seconds.
// Run: npx tsx scripts/smoke-excerpt-law.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STRUCTURAL SWEEP (Aug 25 — the law's THIRD manifestation, found live on a fairness-critical
// run): a fired workflow PENALISED a candidate (−2 points, "CV clipped by system; recruiter must
// verify no disqualifying information in the unextracted portion") for OUR clip marker. Nobody had
// broken a rule: reactions.ts assembled a prompt out of text the SEAMS had already clipped, and it
// simply never emitted EXCERPT_RULE. The site list would have grown by one more line — and decayed
// again at the next arc. So the floor below is a SWEEP, not a site: every source file that CALLS
// the clipper must also carry the rule, or sit on an allowlist WITH ITS REASON (the tier-routing
// allowlist idiom). Adding a clipping caller is now a deliberate act with two outcomes only.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A file may clip WITHOUT carrying the rule only for a stated structural reason. */
const CLIP_WITHOUT_RULE: Record<string, string> = {
  'lib/utils/clip-for-prompt.ts':
    'THE PRIMITIVE ITSELF — it defines the mark, the rule and the clipper.',
  'app/api/drive/upload/confirm/route.ts':
    'A HAND-OFF SEAM, not an assembler: it clips into ReactionEvent.gist/material and assembles no '
    + 'prompt — triggerBlock (lib/workflows/reactions.ts) declares the cut where the prompt is built.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

console.log('\nTHE STRUCTURAL SWEEP (every clipping assembler declares its cuts):');
{
  const files = [...walk('lib'), ...walk('app')];
  const clippers = files.filter((f) => /\bclipForPrompt\s*\(/.test(readFileSync(f, 'utf8')));
  ok('the sweep actually finds the clipping sites (a silent zero would pass forever)',
    clippers.length >= 8, `${clippers.length} found`);
  const naked = clippers.filter((f) =>
    !readFileSync(f, 'utf8').includes('EXCERPT_RULE') && !(f in CLIP_WITHOUT_RULE));
  ok('NO ASSEMBLER CLIPS WITHOUT THE RULE — every clipping file carries EXCERPT_RULE or a stated reason',
    naked.length === 0, naked.join(', '));
  const stale = Object.keys(CLIP_WITHOUT_RULE).filter((f) => !clippers.includes(f));
  ok('…and the allowlist carries no ghosts (a stale exemption is a hole waiting for a new file)',
    stale.length === 0, stale.join(', '));
}

console.log('\nTHE FIRE CONTEXT (reactions.ts triggerBlock — the third manifestation\'s own site):');
{
  const rx = readFileSync('lib/workflows/reactions.ts', 'utf8');
  ok('the assembler imports the mark AND the rule',
    /import \{ clipForPrompt, EXCERPT_MARK, EXCERPT_RULE \} from '@\/lib\/utils\/clip-for-prompt'/.test(rx), '');
  ok('the rule rides the HEADER, outside the head\'s own cap (a tail-clip can never strip it)',
    /\(marked \? `\$\{EXCERPT_RULE\}\\n` : ''\) \+\n\s*headBody;/.test(rx), '');
  ok('the head\'s own cut is honest too (no raw .slice on the assembled head)',
    /clipForPrompt\(`\$\{item\.title\}[\s\S]{0,120}, 2400\)/.test(rx)
    && !/\$\{item\.gist\}`\.slice\(/.test(rx), '');
  ok('THE GIST YIELDS TO THE MATERIAL — the duplicated (clipped) copy never stands beside the whole one',
    /function gistBesideMaterial\(/.test(rx) && /gistBesideMaterial\(item\.gist, carried\)/.test(rx), '');
}

console.log('\nTHE FIRE CONTEXT — LIVE ASSEMBLY (the production function itself, zero AI):');
{
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { triggerBlock } = require('../lib/workflows/reactions') as {
    triggerBlock: (i: { title: string; from?: string | null; gist: string; material?: string }) => string;
  };
  const { EXCERPT_MARK, EXCERPT_RULE, clipForPrompt } = require('../lib/utils/clip-for-prompt') as {
    EXCERPT_MARK: string; EXCERPT_RULE: string; clipForPrompt: (t: string, m: number) => string;
  };

  // The file door's real shape: a 400-char clipped gist head beside the same document's whole text.
  const doc = `Sam Rivera — eight years in credit risk. ${'Detail sentence about the role held. '.repeat(60)}Referees on request.`;
  const gist = `cv-sam-rivera.pdf · PDF · 88KB uploaded to Knowledge\n${clipForPrompt(doc, 400)}`;
  const ctx = triggerBlock({ title: 'cv-sam-rivera.pdf', gist, material: doc });

  ok('THE FAIRNESS INCIDENT, GATED — the duplicated clipped copy is GONE, the document stands once and whole',
    !ctx.includes(EXCERPT_MARK) && ctx.includes('Referees on request.'), ctx.slice(0, 200));
  ok('…so nothing is left to declare, and the context says nothing about clipping (honest silence)',
    !ctx.includes(EXCERPT_RULE), '');
  ok('…and the gist\'s identity line (which the material does not carry) SURVIVES',
    ctx.includes('cv-sam-rivera.pdf · PDF · 88KB uploaded to Knowledge'), '');

  // The seam pre-clips what it hands us (mail caps each attachment at 2,600 chars; the file door at
  // 8,000) — THAT marker rides in, and the assembler must own it. This is the incident's own shape.
  const huge = triggerBlock({
    title: 'cv-sam-rivera.pdf', gist: 'cv-sam-rivera.pdf · PDF · 4.2MB uploaded to Knowledge',
    material: clipForPrompt(`${doc} ${'More detail. '.repeat(500)}`, 1200),
  });
  ok('A PRE-CLIPPED MATERIAL IS DECLARED — the marker never reaches a model unexplained',
    huge.includes(EXCERPT_MARK) && huge.includes(EXCERPT_RULE), huge.slice(0, 200));
  ok('…and the rule sits ABOVE the material (header position, never the tail)',
    huge.indexOf(EXCERPT_RULE) >= 0 && huge.indexOf(EXCERPT_RULE) < huge.indexOf('[WHAT IT CARRIED'), '');

  // Mail's shape: the gist is the EMAIL's own words + [Attached: …]; the material is the CV.
  const mail = triggerBlock({
    title: 'Application — analyst role', from: 'Sam Rivera',
    gist: 'Please find my CV attached, I am applying for the analyst role you advertised last week and would welcome a conversation.\n[Attached: cv-sam-rivera.pdf]',
    material: `--- cv-sam-rivera.pdf ---\n${doc}`,
  });
  ok('a gist the material does NOT duplicate is untouched (the drop is containment, not a guess)',
    mail.includes('Please find my CV attached') && mail.includes('[Attached: cv-sam-rivera.pdf]'), '');
  ok('…and a context with nothing clipped stays silent about clipping (no rule where there is no cut)',
    !mail.includes(EXCERPT_RULE) && !mail.includes(EXCERPT_MARK), '');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
