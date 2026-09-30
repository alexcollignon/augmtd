// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE PROBE POOL (provision + verify). N identical, isolated TEST accounts per tier so the eval
// engine's AUGMTD column runs one live fixture world per account in parallel (scripts/eval-outputs.ts
// --probe-pool). Account #1 of a tier is its original probe host (never written here); #k ≥ 2 are
// `smoke-probe-pool-<k>@augmtd-internal.test` (standard) and `smoke-probe-eu-<k>@augmtd-internal.test`
// (EU, in the internal bedrock_optimised eval workspace #1 belongs to), provisioned as copies of #1's
// config. Idempotent; refuses any address that is not a probe-pool address.
//
//   npx tsx scripts/probe-pool.ts                          # verify std=4,eu=3 (read-only)
//   npx tsx scripts/probe-pool.ts --create                 # provision the missing accounts / config
//   npx tsx scripts/probe-pool.ts --probe-pool std=2-4,eu=2-3 [--create]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import { adminClient, slotModels } from './lib/eval/engine/live';
import { parsePoolSpec, resolveProbePool, readProbeConfig, poolFairnessProblems } from './lib/eval/engine/probes';
import { snapshotCounts } from './lib/eval/engine/world';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? null : null; };

async function main() {
  const create = argv.includes('--create');
  const spec = parsePoolSpec(opt('probe-pool') ?? 'std=4,eu=3')!;
  const admin = adminClient();
  const r = await resolveProbePool(admin, { spec, create });
  if (r.created.length) console.log(`created/synced: ${r.created.join(' · ')}`);
  if (r.missing.length) console.log(`missing (run with --create): ${r.missing.join(' · ')}`);
  const rows = [];
  for (const a of r.accounts) {
    const cfg = { ...await readProbeConfig(admin, a.userId), models: await slotModels(admin, a.userId) };
    rows.push({ label: a.label, tier: a.tier, config: cfg });
    const counts = await snapshotCounts(admin, a.userId);
    const standing = Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(' · ') || 'none';
    console.log(`  ${a.label.padEnd(6)} ${a.userId}  ${a.email}  models ${Object.values(cfg.models).join(', ')}  standing rows: ${standing}`);
  }
  // Fairness is judged against each tier's #1 whenever it is in the listing (the reference).
  const unfair = poolFairnessProblems(rows);
  if (r.problems.length) console.log(`\n✗ problems:\n  - ${r.problems.join('\n  - ')}`);
  if (unfair.length) console.log(`\n✗ UNFAIR (config differs within a tier):\n  - ${unfair.join('\n  - ')}`);
  if (!r.problems.length && !unfair.length && !r.missing.length) console.log(`\n✓ probe pool: ${r.accounts.length} account(s), identical config per tier`);
  process.exitCode = r.problems.length || unfair.length || r.missing.length ? 1 : 0;
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
