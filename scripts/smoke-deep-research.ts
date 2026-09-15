// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEEP-RESEARCH SUITE (permanent — laws need gates).
//
// Three laws, all of which already failed in production:
//
//   DR1  THE SOURCE FLOOR (no AI) — the structure that makes the synthesis round possible:
//        a tool_choice:'none' path exists, the per-round execution slices to the REMAINING
//        budget, and assistant messages are pushed back WITH their tool_calls (the protocol —
//        every role:'tool' message must answer a declared tool_call_id).
//
//   DR2  THE SYNTHESIS LAW (live) — a real run must end in a synthesis of the search results,
//        never the round-1 preamble ("I'll search for recent information about X."), which is
//        what most production runs shipped while the loop exited on searchCount.
//
//   DR3  THE HONESTY LAW (live) — when every search fails (Tavily 432 quota exhaustion, Aug 31
//        and Sep 15), the output says so. It never dresses model prose up as research.
//
// Costs a few cents — two real Bedrock topics and up to four Tavily searches.
// Run: npx tsx --env-file=.env.local scripts/smoke-deep-research.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { executeDeepResearch } from '@/lib/tools/deep-research';

/** The suite may be run bare — load .env.local ourselves so the header command is the whole one. */
async function loadEnv() {
  if (process.env.TAVILY_API_KEY && process.env.AWS_BEDROCK_ACCESS_KEY) return;
  try {
    const raw = await readFile('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* the checks below say what is missing */ }
}

/** The body of the first topic section — everything before the `---` separator, minus the
 *  topic heading line. (The synthesis itself may contain markdown headings, so the section
 *  boundary is the separator, never the next "##".) */
function firstSectionBody(out: string): string {
  const firstSection = out.split(/\n+---\n+/)[0] ?? out;
  return firstSection.replace(/^##\s+.*(\n|$)/, '').trim();
}

async function main() {
  await loadEnv();

  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const note = (t: string) => console.log(`  · ${t}`);

  // ── DR1 — THE SOURCE FLOOR (no AI, no network) ────────────────────────────────────────────────
  console.log('\nDR1 — THE SOURCE FLOOR (structure, no AI)');
  const src = await readFile('lib/tools/deep-research.ts', 'utf8');

  ok("DR1 a tool_choice:'none' synthesis path exists (the budget-exhausted round must synthesise)",
    /tool_choice:\s*remaining\s*>\s*0\s*\?\s*'auto'\s*:\s*'none'/.test(src));
  ok('DR1 the loop is bounded by ROUNDS, not by the search counter',
    /for\s*\(let round\s*=\s*0;\s*round\s*<\s*MAX_ROUNDS/.test(src) && !/while\s*\(searchCount\s*<\s*maxSearches\)/.test(src));
  ok('DR1 per-round execution is capped by the REMAINING budget',
    /executedThisRound\s*>=\s*remaining/.test(src) && /const remaining\s*=/.test(src));
  ok('DR1 an over-budget tool call still receives a tool message',
    /Search budget exhausted/.test(src));
  ok('DR1 a duplicate query is skipped and still answered',
    /Duplicate query skipped/.test(src) && /queriesRun\.has/.test(src));
  ok('DR1 assistant messages are pushed WITH their tool_calls (the protocol)',
    /msg\.tool_calls\?\.length\s*\?\s*\{\s*tool_calls:\s*msg\.tool_calls\s*\}/.test(src));
  ok('DR1 the model calls route through aiCreate (retry + telemetry)',
    /import\s*\{\s*aiCreate\s*\}/.test(src) && /await aiCreate\(/.test(src)
      && !/\(client as any\)\.chat\.completions\.create/.test(src));
  ok("DR1 Tavily defaults to 'basic' depth (1 credit, not 2)",
    /searchDepth:\s*'basic'\s*\|\s*'advanced'\s*=\s*'basic'/.test(src) && /search_depth:\s*searchDepth/.test(src));
  ok('DR1 a pre-search preamble can never stand in as the synthesis',
    /synthesisAfterResults/.test(src) && /research degraded/.test(src));

  const liveReady = !!process.env.TAVILY_API_KEY && !!process.env.AWS_BEDROCK_ACCESS_KEY;
  if (!liveReady) {
    console.log('\n  ! TAVILY_API_KEY / AWS_BEDROCK_ACCESS_KEY missing — the live gates cannot run.');
    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(1);
  }

  // ── DR2 — THE SYNTHESIS LAW (live) ────────────────────────────────────────────────────────────
  console.log('\nDR2 — THE SYNTHESIS LAW (live Bedrock + Tavily)');
  const out = await executeDeepResearch({
    focus: 'European business news relevance',
    queries: ['European Central Bank interest rate decisions September 2026'],
    max_searches: 2,
  }, '');

  const body = firstSectionBody(out);
  note(`section body: ${body.length} chars · first line: ${body.split('\n')[0].slice(0, 110)}`);

  ok('DR2 the topic section carries a real synthesis (>300 chars)', body.length > 300, `${body.length} chars`);
  ok('DR2 the synthesis is not an intent preamble ("I\'ll search for…")',
    !/^I('|’)ll (search|look)/i.test(body), body.slice(0, 80));
  ok('DR2 at least one source URL was collected',
    /^\d+\.\s.+—\shttps?:\/\//m.test(out.split(/##\s+(?:Sources|Quellen)/)[1] ?? ''),
    'no Sources list');
  ok('DR2 a healthy run carries no degraded note', !out.includes('[research degraded') && !/_Note: research was degraded/.test(out));

  // ── DR3 — THE HONESTY LAW (live, with a deliberately broken key) ───────────────────────────────
  console.log('\nDR3 — THE HONESTY LAW (every search fails)');
  const realKey = process.env.TAVILY_API_KEY;
  let degraded = '';
  try {
    process.env.TAVILY_API_KEY = 'invalid-key-for-honesty-gate';
    degraded = await executeDeepResearch({
      focus: 'European business news relevance',
      queries: ['European Central Bank interest rate decisions September 2026'],
      max_searches: 2,
    }, '');
  } finally {
    process.env.TAVILY_API_KEY = realKey;
  }

  const degradedBody = firstSectionBody(degraded);
  note(`degraded body: ${degradedBody.length} chars · ${degradedBody.slice(0, 140)}`);

  ok('DR3 the output says the research is degraded/unavailable',
    degraded.includes('[research degraded') || degraded.includes('research unavailable'),
    degradedBody.slice(0, 120));
  ok('DR3 no prose synthesis pretends to be research (>300 chars)',
    degradedBody.length <= 300, `${degradedBody.length} chars`);

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
