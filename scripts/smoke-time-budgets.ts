// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TIME-BUDGET FLOOR (W0.5, Sep 22) — pure source gates, zero AI, zero DB. Guards against the
// class CLAUDE.md already names twice (the join-route after() seed died at the ~15s platform
// default; both OAuth callbacks need maxDuration=300 for the same reason): a route that fires
// background work in `after()` but declares no `maxDuration` gets killed mid-work by the platform
// default, and the work — often AI-bearing entity/room/prep re-synthesis — silently never happens.
//
// Four gates:
//   1. SOURCE FLOOR — every app/api route file calling `after(` declares `export const maxDuration`.
//   2. ONE MERGE — no direct `.update({ home_brief` outside lib/home/brief-store.ts (excluding the
//      deliberate full-wipe `home_brief: null` resets, which are a different, intentional operation).
//   3. CLAIM-AFTER-WORK — lib/home/anticipation.ts stamps its long TTL only after the pass's work
//      runs, never up front (the claim-before-work race that silently ate 6h of pre-briefs/chases).
//   4. PAGED/ORDERED READ — the brief's open-commitments read carries a stable `.order()` (an
//      unordered `.limit()` hands back an ARBITRARY slice once a user's pool exceeds the cap).
//
// Run: npx tsx scripts/smoke-time-budgets.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (entry === 'route.ts' || entry === 'route.tsx') out.push(p);
  }
  return out;
}

console.log('GATE 1 — SOURCE FLOOR: every app/api route calling after() declares maxDuration');
const routeFiles = walk('app/api');
let checked = 0;
for (const f of routeFiles) {
  const src = readFileSync(f, 'utf8');
  // Match the real next/server `after(` call, not incidental substrings (e.g. a comment mentioning
  // "thereafter(" never occurs in this codebase, but keep the match narrow: `after(` preceded by a
  // word boundary — `.after(` or ` after(` or `(after(` etc. Cheap and sufficient here.
  const callsAfter = /(?:^|[^.\w])after\(/.test(src);
  if (!callsAfter) continue;
  checked++;
  const declaresMaxDuration = /export\s+const\s+maxDuration\s*=/.test(src);
  ok(`${f} declares maxDuration`, declaresMaxDuration,
    'calls after() but has no export const maxDuration — a killed invocation silently drops its background work');
}
console.log(`  (${checked} route files call after())`);

console.log('\nGATE 2 — THE ONE MERGE: no direct home_brief patch-write outside brief-store.ts');
const briefStorePath = join('lib', 'home', 'brief-store.ts');
function scanForDirectWrites(dir: string, out: Array<{ file: string; line: number; text: string }> = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.next-build' || entry.startsWith('.git')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) { scanForDirectWrites(p, out); continue; }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (p === briefStorePath) continue; // the one legitimate writer
    const src = readFileSync(p, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\.update\(\s*\{\s*home_brief\s*:/.test(line)) return;
      // Exclude the deliberate FULL WIPE (`home_brief: null`) — a different, intentional operation
      // (guarded sweeps, first-look's new-user reset), not the read-modify-write patch race this
      // gate targets.
      if (/home_brief\s*:\s*null\s*\}/.test(line)) return;
      out.push({ file: p, line: i + 1, text: line.trim() });
    });
  }
  return out;
}
const directWrites = [...scanForDirectWrites('app'), ...scanForDirectWrites('lib')];
ok('no direct partial-patch write to home_brief outside brief-store.ts', directWrites.length === 0,
  directWrites.map((w) => `${w.file}:${w.line}`).join(', '));

console.log('\nGATE 3 — CLAIM-AFTER-WORK: anticipation.ts stamps its long TTL only after the pass runs');
const anticipation = readFileSync('lib/home/anticipation.ts', 'utf8');
ok('a short in-flight guard exists (not the long RUN_TTL)', /IN_FLIGHT_TTL_MS/.test(anticipation));
ok('the long RUN_TTL is referenced only in the read-side gate, not the up-front claim',
  (() => {
    // The up-front claim block (before the pass's numbered steps) must not write a tasks blob that
    // looks like the FINAL completion record — it must be the inFlight marker.
    const claimMatch = anticipation.match(/\/\/ THE CLAIM:[\s\S]{0,400}/);
    return !!claimMatch && /inFlight:\s*true/.test(claimMatch[0]) && !/completedAt/.test(claimMatch[0]);
  })());
ok('a completion stamp exists AFTER the pass work (not before)',
  (() => {
    const idx = anticipation.indexOf('THE COMPLETION STAMP');
    const claimIdx = anticipation.indexOf('THE CLAIM:');
    return idx > -1 && claimIdx > -1 && idx > claimIdx && /completedAt/.test(anticipation.slice(idx, idx + 400));
  })());
ok('the completion stamp sits after the last pass section (silence watch), not before the meeting loop',
  (() => {
    const meetingLoopIdx = anticipation.indexOf('MEETING PREP');
    const completionIdx = anticipation.indexOf('THE COMPLETION STAMP');
    return meetingLoopIdx > -1 && completionIdx > meetingLoopIdx;
  })());

console.log('\nGATE 4 — PAGED/ORDERED READ: the brief\'s open-commitments read carries a stable order');
const briefRoute = readFileSync('app/api/home/brief/route.ts', 'utf8');
const commitsQueryMatch = briefRoute.match(/supabase\.from\('commitments'\)\.select\((?:'\*'|OPEN_COMMITMENT_COLS)\)[\s\S]{0,200}/); // column-named since event-spine P0 (hot-path-law)
ok('the commitments query exists', !!commitsQueryMatch);
ok('the commitments query carries an .order(', !!commitsQueryMatch && /\.order\(/.test(commitsQueryMatch[0]),
  'unordered .limit() returns an ARBITRARY slice once the pool exceeds the cap');
ok('a saturation warning exists for the commitments cap', /open-commitments pool SATURATED/.test(briefRoute));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
