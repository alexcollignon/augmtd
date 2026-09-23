// ─── THE OUTCOME-QUARANTINE GATE (W0.6, Sep 22) ─────────────────────────────────────────────────
// THE LAW: LAW 7 (lib/prepare/outcome-facts.ts) feeds a currently ONE-SIDED ledger (only
// `prepared_discarded` rows are ever written; accepts/edits/external-replies are not logged yet)
// into the judge and the drafter. Paused via `OUTCOME_FACTS_ENABLED` (default OFF) until W3.2 builds
// the two-way ledger. This gate is zero-AI and does not touch the database — it asserts, with the
// flag left at its default (unset), that:
//
//   Q1 DEFAULT OFF — `OUTCOME_FACTS_ENABLED` is false when the env var is unset.
//   Q2 NO DB READ WHEN OFF — `readOutcomeFacts` returns null before any Supabase call, and does so
//      deterministically (same input, same output, no memo side effect that could leak a stale
//      truthy value in once flipped).
//   Q3 STABLE '' DOWNSTREAM — every fact-rendering export (`outcomeHistoryFact`, `outcomeRegisterFact`,
//      `outcomeSigPart`, `outcomeDigest`) renders '' on the null the quarantine returns — i.e. the
//      judge/drafter sig and prompts are BYTE-IDENTICAL to a world where this module never ran.
//   Q4 ONE ENTRY POINT — the judge and the drafter reach the ledger ONLY through `readOutcomeFacts`
//      (never `computeOutcomeFacts` directly, which would bypass the quarantine).
//
// Run: npx tsx scripts/smoke-outcome-quarantine.ts

import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function main() {
  console.log('THE OUTCOME-QUARANTINE GATE\n');

  delete process.env.OUTCOME_FACTS_ENABLED; // assert the DEFAULT, not whatever the shell happens to carry

  const mod = await import('../lib/prepare/outcome-facts');

  ok('Q1 OUTCOME_FACTS_ENABLED is false by default (env unset)', mod.OUTCOME_FACTS_ENABLED === false);

  // A Supabase client stub that throws on ANY method call — if readOutcomeFacts is truly quarantined
  // it must never touch it while the flag is off.
  const poison = new Proxy({}, {
    get() { throw new Error('DB touched while OUTCOME_FACTS_ENABLED is off — quarantine breached'); },
  }) as any;

  let threw = false;
  let result: unknown;
  try {
    result = await mod.readOutcomeFacts(poison, 'probe-user', '2026-09-22');
  } catch {
    threw = true;
  }
  ok('Q2 readOutcomeFacts never touches the client while the flag is off', !threw);
  ok('Q2 readOutcomeFacts returns null while the flag is off', result === null);

  // Determinism: call it again with a different day/user — still null, still no throw.
  let threw2 = false;
  let result2: unknown;
  try {
    result2 = await mod.readOutcomeFacts(poison, 'another-user', '2000-01-01');
  } catch {
    threw2 = true;
  }
  ok('Q2 deterministic across calls (no memo/side-channel leak)', !threw2 && result2 === null);

  // Q3 — every downstream renderer is '' on null (byte-identical to the pre-LAW-7 world).
  ok("Q3 outcomeDigest(null) === ''", mod.outcomeDigest(null) === '');
  ok("Q3 outcomeSigPart(null) === ''", mod.outcomeSigPart(null) === '');
  ok("Q3 outcomeHistoryFact(null) === ''", mod.outcomeHistoryFact(null) === '');
  ok("Q3 outcomeRegisterFact(null) === ''", mod.outcomeRegisterFact(null) === '');
  ok("Q3 speakableRows(null) is empty", Array.isArray(mod.speakableRows(null)) && mod.speakableRows(null).length === 0);

  // Q4 — source floor: judge.ts and draft-reply.ts import readOutcomeFacts (the guarded door), and
  // neither imports computeOutcomeFacts directly (which would bypass the quarantine flag).
  for (const f of ['lib/work/judge.ts', 'lib/inbox/draft-reply.ts']) {
    const src = readFileSync(f, 'utf8');
    ok(`Q4 ${f} reaches the ledger only via readOutcomeFacts`, /readOutcomeFacts/.test(src) && !/computeOutcomeFacts/.test(src));
  }
  const facts = readFileSync('lib/prepare/outcome-facts.ts', 'utf8');
  ok('Q4 the quarantine check runs before any DB access in readOutcomeFacts', (() => {
    const fnStart = facts.indexOf('export async function readOutcomeFacts');
    const guardIdx = facts.indexOf('if (!OUTCOME_FACTS_ENABLED) return null;', fnStart);
    const firstDbCall = facts.indexOf("client.from(", fnStart);
    return fnStart >= 0 && guardIdx >= 0 && (firstDbCall === -1 || guardIdx < firstDbCall);
  })());

  console.log(`\n${pass}/${pass + fail} passed`);
  console.log('\nTo re-enable after W3.2 ships the two-way ledger: set OUTCOME_FACTS_ENABLED=true.');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
