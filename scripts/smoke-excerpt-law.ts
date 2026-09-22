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

  // ── HAND-OFF SEAMS (the clipped text is assembled into a prompt that declares the rule) ────────
  'lib/inbox/refresh-understanding.ts':
    'A HAND-OFF SEAM, not an assembler: it clips the message\'s OWN words (topMessageOf) into the '
    + '`body` field of computeUnderstanding — lib/ai/email-processor.ts builds that prompt and carries '
    + 'EXCERPT_RULE above the Body line, where the body\'s own tail cannot strip it.',
  'lib/inbox/thread-now.ts':
    'A HAND-OFF SEAM, not an assembler: THE WATERMARK READ clips only ThreadNow.gist, which two '
    + 'assemblers consume and both declare — lib/entities/state.ts (the entity ledger\'s NOW clause) '
    + 'and lib/room/ground-evidence.ts, whose GROUND_EVIDENCE_RULE carries EXCERPT_RULE to every '
    + 'reasoner that reads the page (ONE constant, N importers — never N hand-copies).',

  // ── USER-FACING EXCERPT PANES (the reader is a PERSON; the marker is the honesty, not a leak) ──
  // A LABEL gets clipLabel (no marker — chrome in a title reads as a defect). A quoted EXCERPT a
  // human reads is the other half of the same law: the marker TELLS THEM there is more, and there
  // is no prompt here to carry a rule into. Both sites below are asserted by smoke-quality, which
  // requires the marker — so the rule these files owe is owed to a reader, and it is paid in words.
  'lib/home/attention.ts':
    'NO PROMPT IS ASSEMBLED HERE: the clip is HeldBandRow.excerpt, served to the triage card and '
    + 'rendered to a person (components/triage/triage-deck.tsx). smoke-quality gates the marker on '
    + 'this exact call — the excerpt-honesty law here is owed to a human reader, not a model.',
  'lib/triage/words.ts':
    'NO PROMPT IS ASSEMBLED HERE: `threadTail` builds the card\'s own message tail, rendered to a '
    + 'person in the triage deck. smoke-quality gates the marker on each tail body — the card must '
    + 'not lie about its own length any more than a prompt may.',
  'app/api/commitments/[id]/route.ts':
    'NO PROMPT IS ASSEMBLED HERE: `arrivedText` clips already-arrived step outputs into the INPUT '
    + 'STATION card\'s served context, which a person reads and scrolls (components/home/item-detail'
    + '.tsx). The route\'s own header states the law; the marker is what tells the reader the pane '
    + 'holds only the first 480 chars of the run\'s bytes.',
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LAW'S FOURTH MANIFESTATION (Sep 21 — found by the T2 replay, mis-read as live-AI variance for
// days). Nobody broke the excerpt law either: the two seams that produced the lie are seams the law
// never covered, because neither is a prompt excerpt.
//   (a) A LABEL IS NOT AN EXCERPT — `itemLabel: task.slice(0, 80)` cut a classifier task mid-word
//       ("…'Last Week's Highlights' s"), the report-back's FACTS block quoted it as `Task: "…"`, and
//       the coworker reported to the user that the work "stops at 'Last Week's Highlights' s".
//   (b) THE TRUNCATION FLOOR IS A GUESS — `evaluateDeliverable`'s mechanical test read "no terminal
//       punctuation" as "cut off", so a bullet list (the format the user asked for IN WORDS) was
//       condemned, retried, condemned again, and handed back as "regenerate it, it's truncated".
// Both floors are pure and testable, so they are tested here, on live values.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nTHE LABEL SEAM (a title is clipped for display — at a boundary, and without a marker):');
{
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { clipLabel, EXCERPT_MARK } = require('../lib/utils/clip-for-prompt') as {
    clipLabel: (t: string, m: number) => string; EXCERPT_MARK: string;
  };
  const task = "Reformat the weekly meeting brief into bullet points: 'Last Week's Highlights' section and 'This Week's Strategic Priorities' section";
  const label = clipLabel(task, 80);
  ok('the incident\'s own value no longer ends mid-word', !/\bs$/.test(label.replace(/…$/, '')) && label.endsWith('…'), label);
  ok('a label never carries the prompt marker (chrome inside a title reads as a defect)',
    !label.includes(EXCERPT_MARK), label);
  ok('a short label passes through untouched', clipLabel('Weekly brief', 80) === 'Weekly brief', '');
  ok('the delegation door clips its label (no raw slice on the task)',
    conv.includes('clipLabel(task, 80)') && !conv.includes('itemLabel: task.slice(0, 80)'), '');
  ok('the delegation module clips its run labels too',
    !/workflowName: `Delegation[^`]*`\.slice\(/.test(dele), '');
}

console.log('\nTHE TRUNCATION FLOOR (a structured ending is a boundary — a heuristic may not destroy finished work):');
{
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { looksMechanicallyTruncated } = require('../lib/prepare/evaluate') as {
    looksMechanicallyTruncated: (c: string) => boolean;
  };
  const filler = 'Detail line about the item that was agreed and who owes it next. '.repeat(8);
  const bulleted = `## Last Week's Highlights\n\n- **Engagement letter signed** (Aug 7)\n- ${filler}\n\n## This Week's Strategic Priorities\n\n- **Kick-off call** — availability confirmation needed\n- **Amended assessment questions** — 4 days overdue, send immediately`;
  ok('THE INCIDENT: a complete bullet list is NOT truncated (it ends like a list, not a paragraph)',
    looksMechanicallyTruncated(bulleted) === false, '');
  ok('…and a complete table row is not either',
    looksMechanicallyTruncated(`${filler}\n\n| Item | Owner |\n| --- | --- |\n| Proposal | the analyst`.concat(' team')) === false, '');
  ok('A REAL PROSE CUT STILL FIRES (the original class is not weakened)',
    looksMechanicallyTruncated(`${filler}Gap: Cloud-native da`) === true, '');
  ok('…and a cut INSIDE a list item fires (unclosed emphasis)',
    looksMechanicallyTruncated(`${bulleted.slice(0, bulleted.length - 30)}\n- **Amended assessment que`) === true, '');
  ok('…and a list item cut at a connector fires',
    looksMechanicallyTruncated(`${bulleted}\n- Four items due for the programme,`) === true, '');
  ok('a short artifact is never judged by this floor', looksMechanicallyTruncated('- one bullet') === false, '');
  const ev = readFileSync('lib/prepare/evaluate.ts', 'utf8');
  ok('THE RECEIPT OUTRANKS THE GUESS — a producer-confirmed complete output skips the heuristic',
    /sourceComplete/.test(ev) && ev.includes("args.sourceComplete !== true && looksMechanicallyTruncated"), '');
  const ex = readFileSync('lib/workflows/execute-step.ts', 'utf8');
  ok('…and the producer actually reads its own finish_reason (and retries a budget cut once)',
    /finish_reason === 'length'/.test(ex) && /executeAgentStepDetailed/.test(ex), '');
}

console.log('\nTHE HAND-BACK LAW (our own repair is never a chore for the principal):');
{
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { stripRegenerationAsk, readerFacingProblem } = require('../lib/workflows/report-back') as {
    stripRegenerationAsk: (t: string) => string; readerFacingProblem: (o: string) => string;
  };
  const said = 'Hey — I reformatted the weekly brief, but it got cut off at the end. Could you regenerate it so it\'s complete? I left what I have in the thread.';
  ok('THE INCIDENT: the regeneration ask is removed from the hand-back',
    !/regenerate/i.test(stripRegenerationAsk(said)) && stripRegenerationAsk(said).includes('I left what I have'), stripRegenerationAsk(said));
  ok('…and a hand-back that is ONLY an ask degrades to an honest line, never an empty one',
    stripRegenerationAsk('Could you please regenerate it?').length >= 20, '');
  ok('a clean report passes through untouched',
    stripRegenerationAsk('Done — the brief is reformatted into bullets.') === 'Done — the brief is reformatted into bullets.', '');
  ok('a reviewer objection is stripped of its system-facing instruction before the reader sees it',
    !/regenerate/i.test(readerFacingProblem('The deliverable appears CUT OFF mid-sentence at the end — regenerate it complete; never hand over a truncated document.')), '');
  const rb = readFileSync('lib/workflows/report-back.ts', 'utf8');
  ok('the composed report is swept deterministically (a prompt rule alone coin-flips)',
    /return stripRegenerationAsk\(linkifyReport\(/.test(rb), '');
  ok('…and the prompt states the law beside it',
    rb.includes('NEVER ask them to regenerate'), '');
  ok('the report FACTS clip the gist honestly and declare the cut',
    rb.includes('clipForPrompt(f.deliverableGist, 500)') && rb.includes('EXCERPT_RULE'), '');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
