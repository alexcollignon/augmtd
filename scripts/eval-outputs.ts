// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — EVERY OUTPUT VS PLAIN MODELS · the one runner of the quality engine (scripts/lib/eval/engine).
// Columns: AUGMTD (the real producer, in-process, over a seeded fixture world on a PROBE HOST, fresh
// ids per repeat) · same-model plain · Claude Sonnet 5.5 plain · GPT-5.6-terra plain. Labelled
// surfaces score against truth; written surfaces are judged blind by claude-opus-5-5. Verdict per
// surface: AUGMTD ≥ each plain column on the surface and on every scenario.
//
//   npx tsx scripts/eval-outputs.ts --stage 1a                       # DRY RUN (default): plan + estimate
//   npx tsx scripts/eval-outputs.ts --stage 1a --tier both --yes     # live (the orchestrator runs it)
//   npx tsx scripts/eval-outputs.ts --self-check [--tier both]       # zero AI: every adapter end to end,
//                                                                    #   model stubbed, egress fenced
//   npx tsx scripts/eval-outputs.ts --probe-columns --yes            # ~€0.002: one tiny call per column
//                                                                    #   (proves model ids + stated efforts are accepted)
//   npx tsx scripts/eval-outputs.ts --recheck scratchpad/w26-eval-….json   # zero AI rescoring
// Flags: --surfaces a,b (ids, `judgment.` prefixes, or bare names) · --stage 1a|chat|… · --tier
//   standard|eu|both (default standard) · --repeat n (default 3) · --columns augmtd,same,sonnet55,gpt56 ·
//   --max-eur n (hard stop, default 5; the run refuses to start when the estimate exceeds it unless
//   --allow-over-estimate) · --merge a.json,b.json (fold saved plain-column runs in) · --no-judge ·
//   --effort sonnet55=medium,gpt56=medium (plain columns) and/or <slot>=<effort> (THE EFFORT A/B, W27.C:
//   e.g. --effort classification=low,summarization=low runs the AUGMTD producers of those slots at that
//   effort through the factory's eval-only AI_EFFORT_OVERRIDE; the same-model column keeps its own) — or a
//   PRODUCER key (W28, lib/ai/effort.ts EFFORT_PRODUCERS: e.g. --effort work.judge=minimal A/Bs exactly that
//   producer against its PRODUCER_EFFORT default; a slot override never reaches a producer that resolves its own) ·
//   --cases id,id · --canary (include canaries) ·
//   --judge-style w24|reason-first (conversation.home-chat only; w24 = comparable with W22–W24) ·
//   --create-eu-probe (provision the EU probe host once) · --out <path.md> · --planned (dry-run estimate at
//   the PLANNED case counts, priced off each stub adapter's canary)
// Throughput + safety: --concurrency n (units = tier × surface × case × repeat in flight, default 6; the
//   columns of a unit run in parallel) · --world-lanes n (seeded worlds alive per probe host, default 1 —
//   isolation; the self-check defaults to --concurrency) · --provider-caps anthropic=4,openai=4,openai-mini=6,
//   bedrock=3,other=4 (in-flight model calls per provider; 429s back off in the factory's bounded retry) ·
//   --resume <run.json> (continue a stopped run from its .jsonl journal, same run clock; errored runs retry) ·
//   SIGINT/SIGTERM once = stop scheduling, finish + tear down in-flight units, write journal + report;
//   twice = exit now · --sweep [--apply] [--tier …] (find/delete eval leftovers on the probe hosts; both by default)
// THE TWO CLOCKS (W27.C): truths + plain prompts resolve on the RUN clock (a --resume keeps it); AUGMTD worlds
//   are seeded on the WALL clock the product reads. A resume on another calendar day is refused
//   (--allow-day-drift overrides). The process runs in TZ=UTC like the production servers.
// THE PROBE POOL: --probe-pool std=4,eu=3 (accounts #1..n per tier; a range std=2-4 skips #1) — default:
//   every provisioned pool account of the selected tiers. One live world per ACCOUNT (--world-lanes is per
//   account); each AUGMTD unit leases a free account of its tier. Provision/verify the pool with
//   `npx tsx scripts/probe-pool.ts [--create]`. The run refuses a pool whose accounts' config differs.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
// W27.C — PROD PARITY: the servers run in UTC, so a producer that reads the SERVER's zone by mistake
// (new Date().getHours(), toLocaleDateString without a timeZone) must misbehave here exactly as it does
// live — never be masked by the operator's laptop zone. Node re-reads TZ on assignment.
process.env.TZ = 'UTC';
config({ path: '.env.local', quiet: true } as never);
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { selectAdapters, ADAPTERS } from './lib/eval/engine/registry';
import { estimateRun, slotModel } from './lib/eval/engine/estimate';
import { runEngine, TIER_FREE, type EngineResult, type TierEnv } from './lib/eval/engine/runner';
import { Journal, loadResume, journalPathOf, isFinished, fingerprintMismatch, writeAtomic, resumeDayDrift, type RunRecord } from './lib/eval/engine/journal';
import { parseEffortOverride, effortOverrideArmed, EFFORT_PRODUCERS, PRODUCER_EFFORT } from '../lib/ai/effort';
import { makeProviderGate, parseProviderCaps } from './lib/eval/engine/concurrency';
import { setCallGate } from './lib/eval/meter';
import { renderEngineReport, mergeEngine, recheckEngine, serialize, summarizeSurface } from './lib/eval/engine/report';
import { COLUMN_IDS, type AnyAdapter, type ColumnId, type EvalCase, type Tier } from './lib/eval/engine/types';
import { snapshotCounts, diffCounts } from './lib/eval/engine/world';
import { parsePoolSpec, type PoolAccount, type PoolSpec } from './lib/eval/engine/probes';
import { selfCheckProblems } from './lib/eval/engine/selfcheck';
import { priceOf, eur, priceCalls } from './lib/eval/engine/pricing';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string): string | null => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const list = (n: string) => opt(n)?.split(',').map((x) => x.trim()).filter(Boolean) ?? null;
const die = (m: string): never => { console.error(m); process.exit(2); };

const selfCheck = flag('self-check');
const live = flag('yes') && !selfCheck;
const tierArg = opt('tier') ?? 'standard';
const tiers: Tier[] = tierArg === 'both' ? ['standard', 'eu'] : tierArg === 'eu' ? ['eu'] : tierArg === 'standard' ? ['standard'] : die('--tier must be standard|eu|both');
const repeat = Math.max(1, Math.floor(Number(opt('repeat') ?? (selfCheck ? '1' : '3'))));
const columns = (list('columns') ?? COLUMN_IDS) as ColumnId[];
if (columns.some((c) => !COLUMN_IDS.includes(c))) die(`--columns must be a subset of ${COLUMN_IDS.join(',')}`);
const maxEur = Number(opt('max-eur') ?? (selfCheck ? '1' : '5'));
const useJudge = !flag('no-judge');
const caseIds = list('cases');
const judgeStyle = opt('judge-style') ?? 'w24';
if (!['w24', 'reason-first'].includes(judgeStyle)) die('--judge-style must be w24|reason-first');
process.env.W26_JUDGE_STYLE = judgeStyle;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const posInt = (n: string, d: string) => { const v = Math.floor(Number(opt(n) ?? d)); return v >= 1 ? v : die(`--${n} must be an integer ≥ 1`); };
const concurrency = posInt('concurrency', '6');
// The self-check runs its worlds concurrently too (proves teardown is exact under concurrency); a
// measured run keeps one world per probe host by default (runner.ts: THE WORLD LANE).
const worldLanes = posInt('world-lanes', selfCheck ? String(concurrency) : '1');
const poolSpec: PoolSpec | null = (() => { try { return parsePoolSpec(opt('probe-pool')); } catch (e) { return die((e as Error).message); } })();
const providerCaps = (() => { try { return parseProviderCaps(opt('provider-caps')); } catch (e) { return die((e as Error).message); } })();
const { efforts, augmtdEffort } = (() => {
  const e = { sonnet55: 'medium' as string | null, gpt56: 'medium' as string | null };
  const slotParts: string[] = [];
  for (const kv of list('effort') ?? []) {
    const [k, v] = kv.split('=');
    if (k === 'sonnet55' || k === 'gpt56') { e[k] = v === 'default' || v === 'none-stated' ? null : v; continue; }
    slotParts.push(kv);
  }
  // THE EFFORT A/B (W27.C): slot keys become the factory's eval-only override for the AUGMTD producers.
  const { map, producers, problems } = parseEffortOverride(slotParts.join(','));
  if (problems.length) die(`--effort: ${problems.join('; ')} (keys: sonnet55, gpt56, a slot: classification, summarization, generation, planning, conversation, assignment, ocr, or a producer: ${EFFORT_PRODUCERS.join(', ')})`);
  return { efforts: e, augmtdEffort: { ...map, ...producers } as Partial<Record<string, string>> };
})();
const augmtdEffortSpec = Object.entries(augmtdEffort).map(([k, v]) => `${k}=${v}`).join(',');
if (augmtdEffortSpec) {
  process.env.AI_EFFORT_OVERRIDE = augmtdEffortSpec;
  process.env.AUGMTD_EVAL = '1';
  if (!effortOverrideArmed()) die(`--effort ${augmtdEffortSpec}: the override is refused in this process (NODE_ENV=${process.env.NODE_ENV ?? ''} VERCEL_ENV=${process.env.VERCEL_ENV ?? ''}) — it is honoured only outside production`);
} else {
  // A stale shell export must never silently change what the AUGMTD column measures.
  delete process.env.AI_EFFORT_OVERRIDE;
}

const adapters = selectAdapters({ surfaces: list('surfaces'), stage: opt('stage') });
if (!adapters.length && !opt('recheck') && !flag('probe-columns')) die(`no adapter matches (have: ${ADAPTERS.map((a) => `${a.id} [${a.stage}]`).join(', ')})`);

/** Which cases run: explicit ids > canaries (self-check) > authored cases (live). An adapter with no
 *  canary contributes its first case to the self-check. */
function selectCase(a: AnyAdapter, c: EvalCase): boolean {
  if (caseIds) return caseIds.includes(c.id);
  if (selfCheck) {
    const cs = a.cases();
    return cs.some((x) => x.canary) ? !!c.canary : c.id === cs[0]?.id;
  }
  return flag('canary') ? true : !c.canary;
}

function outPath(name: string): string {
  const out = opt('out') ?? path.join(process.cwd(), 'scratchpad', name);
  mkdirSync(path.dirname(out), { recursive: true });
  return out;
}

function printPlan(now: Date): number {
  const est = estimateRun({
    adapters, tiers, columns, repeat, judge: useJudge ? 'claude-opus-5-5' : null, now, select: selectCase,
    plainModels: { sonnet55: 'claude-sonnet-5-5', gpt56: 'gpt-5.6-terra' }, planned: flag('planned'), augmtdEffort,
  });
  console.log(`\nW26 · eval-outputs · tiers ${tiers.join('+')} · repeat ${repeat} · columns ${columns.join(', ')} · judge ${useJudge ? 'claude-opus-5-5 (blind)' : 'off'} · efforts sonnet55=${efforts.sonnet55 ?? 'provider default'} gpt56=${efforts.gpt56 ?? 'provider default'} · AUGMTD effort ${augmtdEffortSpec ? `OVERRIDE ${augmtdEffortSpec} (eval-only)` : 'the product\'s own (PRODUCER_EFFORT, else the param floor)'} · TZ=${process.env.TZ}`);
  for (const a of adapters) {
    const n = a.cases().filter((c) => selectCase(a, c as EvalCase)).length;
    console.log(`  ${a.id.padEnd(28)} [${a.stage}] ${a.status.padEnd(5)} ${String(n).padStart(3)} case(s) · producer ${a.producer.fn} (${a.producer.slot}: ${tiers.map((t) => `${t}=${slotModel(t, a.producer.slot)}`).join(', ')})${a.status === 'stub' ? ` · planned ${a.planned.reduce((x, g) => x + g.count, 0)}` : ''}`);
  }
  console.log('\nESTIMATE (€, conservative; reasoning columns at 3× visible output; tier-free plain columns once):');
  console.log('  surface                      tier      cases   augmtd     same  sonnet55    gpt56    judge    total');
  for (const r of est.rows) {
    const f = (x?: number) => (x == null ? '       –' : x.toFixed(3).padStart(8));
    console.log(`  ${r.surface.padEnd(28)} ${r.tier.padEnd(9)} ${String(r.cases).padStart(5)} ${f(r.byColumn.augmtd)} ${f(r.byColumn.same)}  ${f(r.byColumn.sonnet55)} ${f(r.byColumn.gpt56)} ${f(r.judge)} ${f(r.total)}${r.unpriced.length ? `  UNPRICED: ${r.unpriced.join(', ')}` : ''}`);
  }
  console.log(`  TOTAL ≈ €${est.total.toFixed(2)} (hard stop --max-eur ${maxEur})${flag('planned') ? ' — PLANNED case counts priced off each stub\'s canary' : ''}`);
  const unpriced = [...new Set(est.rows.flatMap((r) => r.unpriced))];
  if (unpriced.length) console.log(`  ✗ unpriced models: ${unpriced.join(', ')} — a live run refuses`);
  return est.total;
}

/** The pool of probe accounts per tier (#1 = the tier's original probe host). The engine never creates a
 *  pool account (scripts/probe-pool.ts --create does); #1 keeps its old self-provisioning path. */
async function resolvePool(admin: import('@supabase/supabase-js').SupabaseClient, poolTiers: Tier[], opts: { createEu: boolean; strict: boolean }): Promise<Record<Tier, PoolAccount[]>> {
  const { resolveProbeUser } = await import('./probe-user');
  const { resolveEuProbeUser, resolveProbePool } = await import('./lib/eval/engine/probes');
  const wants = (t: Tier, k: number) => poolTiers.includes(t) && (poolSpec ? (poolSpec[t] ?? []).includes(k) : true);
  if (wants('standard', 1)) await resolveProbeUser(admin);
  if (wants('eu', 1) || opts.createEu) {
    const st = await resolveEuProbeUser(admin, { create: opts.createEu });
    console.log(`EU probe host: ${st.userId ? st.userId.slice(0, 8) : 'missing'} · workspace ${st.companyId ? st.companyId.slice(0, 8) : 'missing'} · ai_tier ${st.tier ?? '—'}${st.created.length ? ` · created: ${st.created.join(', ')}` : ''}${st.problems.length ? ` · PROBLEMS: ${st.problems.join('; ')}` : ''}`);
    if (wants('eu', 1) && opts.strict && (!st.userId || st.problems.length || st.tier !== 'bedrock_optimised')) die('EU probe host not ready — run once with --create-eu-probe (owner-approved test account)');
  }
  const spec: PoolSpec = {};
  for (const t of poolTiers) if (poolSpec) spec[t] = poolSpec[t] ?? []; 
  const r = await resolveProbePool(admin, { spec, create: false, discover: !poolSpec });
  const out: Record<Tier, PoolAccount[]> = { standard: [], eu: [] };
  for (const a of r.accounts) if (poolTiers.includes(a.tier)) out[a.tier].push(a);
  const probs = [...r.problems, ...r.missing.map((m) => `${m} is not provisioned (npx tsx scripts/probe-pool.ts --create)`)];
  if (probs.length) (opts.strict ? die : console.log)(`PROBE POOL: ${probs.join('; ')}`);
  for (const t of poolTiers) {
    if (opts.strict && !out[t].length) die(`PROBE POOL: no account for tier ${t} (--probe-pool ${opt('probe-pool') ?? '(all available)'})`);
    console.log(`probe pool ${t}: ${out[t].map((a) => `${a.label} ${a.userId.slice(0, 8)}`).join(' · ') || 'none'}`);
  }
  return out;
}

/** --sweep: find (dry run) or delete (--apply) every eval-seeded leftover on the probe hosts. */
async function runSweep(liveMod: typeof import('./lib/eval/engine/live')): Promise<void> {
  const { sweepProbe, describeSweep, fixtureIdentity } = await import('./lib/eval/engine/sweep');
  const admin = liveMod.adminClient();
  const sweepTiers: Tier[] = opt('tier') ? tiers : ['standard', 'eu'];
  const pool = await resolvePool(admin, sweepTiers, { createEu: false, strict: false });
  const hosts = sweepTiers.flatMap((t) => pool[t]).map((a) => ({ tier: a.tier, userId: a.userId, label: a.label }));
  liveMod.armProbeFence(process.env.NEXT_PUBLIC_SUPABASE_URL!, hosts.map((h) => h.userId), (r) => { console.error(`probe fence: ${r}`); process.exitCode = 1; });
  const fixture = fixtureIdentity(ADAPTERS);
  console.log(`\nSWEEP (${flag('apply') ? 'APPLY' : 'dry run'}) · markers: eval-w26… / eval:w26… / "Eval fixtures w26…" / links "eval fixture" · fixture identity: ${fixture.names.length} name(s), ${fixture.emails.length} address(es)`);
  for (const h of hosts) {
    const { snapshotCounts } = await import('./lib/eval/engine/world');
    const pre = await snapshotCounts(admin, h.userId);
    console.log(`  ${h.label} probe ${h.userId.slice(0, 8)} holds: ${Object.entries(pre).map(([t, n]) => `${t} ${n}`).join(' · ')}`);
    const r = await sweepProbe(admin, h.userId, { apply: flag('apply'), fixture });
    console.log(`  → ${describeSweep(r)}`);
    if (r.errors.length) process.exitCode = 1;
    if (flag('apply')) {
      const post = await snapshotCounts(admin, h.userId);
      console.log(`  after: ${Object.entries(post).map(([t, n]) => `${t} ${n}`).join(' · ')}`);
      const again = await sweepProbe(admin, h.userId, { apply: false, fixture });
      console.log(`  re-check: ${again.total} eval row(s) left${again.total ? ` — ${describeSweep(again)}` : ' ✓'}`);
      if (again.total) process.exitCode = 1;
    }
  }
  if (!flag('apply')) console.log('\nDRY RUN — nothing deleted. Add --apply to delete (probe hosts only).');
}

async function main() {
  // 0 · recheck: zero AI, zero network.
  const recheck = opt('recheck');
  if (recheck) {
    const saved = recheckEngine(JSON.parse(readFileSync(recheck, 'utf8')) as EngineResult, ADAPTERS);
    const base = recheck.replace(/\.json$/, '');
    writeFileSync(`${base}-rechecked.md`, renderEngineReport(saved, ADAPTERS, { notes: [`Re-checked ${new Date().toISOString()} with the current adapters (judge verdicts kept).`] }));
    writeFileSync(`${base}-rechecked.json`, serialize(saved));
    printScoreboard(saved);
    console.log(`rechecked → ${base}-rechecked.md`);
    return;
  }
  if (flag('sweep')) { await runSweep(await import('./lib/eval/engine/live')); return; }

  // Resume: the journal fixes the run clock (fixtures resolve against it) and the measurement settings.
  const resumePath = opt('resume');
  const resume = resumePath ? loadResume(resumePath) : null;
  const now = resume?.header?.now ? new Date(resume.header.now) : new Date();
  const fingerprint = { judgeStyle, efforts, augmtdEffort: augmtdEffortSpec || null, judge: useJudge ? 'claude-opus-5-5' : null, stubbed: selfCheck };
  if (resume) {
    const bad = fingerprintMismatch(resume.header?.fingerprint ?? {}, fingerprint);
    if (bad.length) die(`--resume REFUSED: the journal measured with different settings (${bad.join('; ')}) — rerun with the same flags`);
    const wall = new Date();
    console.log(`↻ resuming ${resume.from}: ${resume.records.filter((r) => isFinished(r.run)).length} finished column run(s) · truths on the RUN clock ${now.toISOString()} · worlds on the WALL clock ${wall.toISOString()} (${((wall.getTime() - now.getTime()) / 3_600_000).toFixed(1)} h later)${resume.torn ? ` (${resume.torn} torn line(s) ignored)` : ''}`);
    const tzs = ['UTC', ...adapters.flatMap((a) => a.cases().filter((c) => selectCase(a, c as EvalCase)).map((c) => (c as EvalCase).world.tz ?? 'UTC'))];
    const drift = resumeDayDrift(now, wall, tzs);
    if (drift.length && !flag('allow-day-drift')) die(`--resume REFUSED: today is a different day than the run clock (${drift.join('; ')}) — date truths would disagree with the product by a day. Start a fresh run, or pass --allow-day-drift to accept it (the report counts the drifted units).`);
  }
  const estimateFull = printPlan(now);
  const doneShare = resume ? Math.min(1, resume.records.filter((r) => isFinished(r.run)).length / Math.max(1, plannedColumnRuns())) : 0;
  const estimate = estimateFull * (1 - doneShare);
  if (resume) console.log(`  REMAINING ≈ €${estimate.toFixed(2)} (${Math.round(doneShare * 100)}% of the column runs already finished)`);
  if (opt('expand') && !flag('yes')) { printExpandPlan(); console.log('\nDRY RUN — --expand spends; add --yes (the orchestrator runs it).'); return; }
  if (!live && !selfCheck && !flag('probe-columns') && !opt('expand')) { console.log('\nDRY RUN — nothing spent. Re-run with --yes to spend (the orchestrator runs it).'); return; }
  if (live && estimate > maxEur && !flag('allow-over-estimate')) die(`\nREFUSED: the estimate €${estimate.toFixed(2)} exceeds --max-eur ${maxEur} (raise it, narrow the run, or pass --allow-over-estimate)`);

  // 1 · the meter (and in stub mode the egress fence) BEFORE the first factory client exists.
  const liveMod = await import('./lib/eval/engine/live');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? die('NEXT_PUBLIC_SUPABASE_URL missing');
  liveMod.armMeter(selfCheck);
  const providerGate = makeProviderGate(providerCaps);
  setCallGate(providerGate.gate);
  if (selfCheck) await liveMod.installEgressFence(supabaseUrl);
  if (flag('probe-columns')) { if (!flag('yes')) die('--probe-columns spends (~€0.002): add --yes'); await probeColumns(liveMod); return; }
  if (opt('expand')) { await expandCases(liveMod); return; }
  if (live) liveMod.assertPriced([...(columns.includes('sonnet55') ? [liveMod.SONNET55] : []), ...(columns.includes('gpt56') ? [liveMod.GPT56] : []), ...(useJudge ? [liveMod.JUDGE_MODEL] : []),
    ...tiers.flatMap((t) => adapters.map((a) => slotModel(t, a.producer.slot)))]);

  const admin = liveMod.adminClient();
  const pool = await resolvePool(admin, tiers, { createEu: flag('create-eu-probe'), strict: true });
  const accounts = tiers.flatMap((t) => pool[t]);
  const blocked: string[] = [];
  liveMod.armProbeFence(supabaseUrl, accounts.map((a) => a.userId), (r) => blocked.push(r));
  // THE FAIRNESS CHECK: identical config across a tier's pool accounts (profile config, workspace
  // membership + tier, config tables, the model every factory slot resolves to) — else a result would
  // depend on which account ran a case. A live run refuses an unfair pool; the self-check reports it.
  const { readProbeConfig, poolFairnessProblems } = await import('./lib/eval/engine/probes');
  const fairRows = [];
  for (const a of accounts) fairRows.push({ label: a.label, tier: a.tier, config: { ...await readProbeConfig(admin, a.userId), models: await liveMod.slotModels(admin, a.userId) } });
  const unfair = poolFairnessProblems(fairRows);
  if (unfair.length && !selfCheck) die(`PROBE POOL UNFAIR — accounts of one tier differ (fix with scripts/probe-pool.ts --create):\n  - ${unfair.join('\n  - ')}`);

  // 2 · a clean start: any eval leftover (an interrupted run) is swept BEFORE the symmetry snapshot.
  const { sweepProbe, describeSweep, fixtureIdentity } = await import('./lib/eval/engine/sweep');
  const fixture = fixtureIdentity(ADAPTERS);
  const notes: string[] = [];
  for (const a of accounts) {
    const r = await sweepProbe(admin, a.userId, { apply: true, fixture });
    if (r.total || r.errors.length) { const line = `Pre-run sweep ${a.label} (leftovers of an interrupted run): ${describeSweep(r)}`; notes.push(line); console.log(line); }
  }

  // One env per pool account; the first of a tier is its primary (runner.ts THE PROBE POOL).
  const envs: TierEnv[] = [];
  const before: Record<string, Record<string, number>> = {};
  for (const a of accounts) {
    const session = adapters.some((x) => x.family === 'conversation') ? await liveMod.probeSession(admin, a.email) : null;
    envs.push({ ...await liveMod.buildTierEnv({ tier: a.tier, admin, userId: a.userId, session, now, stubbed: selfCheck, efforts }), host: a.label });
    before[a.label] = await snapshotCounts(admin, a.userId);
  }
  // Standing rows differ across accounts (other suites' leftovers on #1): informational — adapters seed
  // every record their cases read; the conversation family (which reads standing state) stays on #1.
  for (const t of tiers) {
    const [ref, ...rest] = pool[t];
    for (const a of rest) {
      const d = diffCounts(before[ref.label], before[a.label]);
      if (d.length) notes.push(`Standing rows ${a.label} vs ${ref.label} (informational): ${d.join('; ')}`);
    }
  }
  // Self-check: the plain columns answer the TRUTH (good stub) — except GPT, which answers garbage.
  if (selfCheck) for (const a of adapters) for (const c of a.cases()) if (selectCase(a, c as EvalCase) && a.stubAnswer) liveMod.stubAnswers.set(a.plainPrompt(c as EvalCase, now).user, a.stubAnswer(c as EvalCase, now));

  // 3 · the journal (append-safe) + the stop signal.
  const name = `${selfCheck ? 'w26-eval-selfcheck' : 'w26-eval'}-${tiers.join('+')}-${stamp}`;
  const jsonPath = resume ? resume.from.replace(/\.jsonl$/, '.json') : opt('out') ? outPath('').replace(/\.(md|json)$/, '') + '.json' : outPath(`${name}.json`);
  const md = jsonPath.replace(/\.json$/, '.md');
  const journal = new Journal(journalPathOf(jsonPath));
  journal.open({ type: 'header', version: 1, now: now.toISOString(), startedAt: new Date().toISOString(), repeat, columns, tiers, judgeModel: useJudge ? 'claude-opus-5-5' : null, fingerprint }, !!resume);
  if (resume) journal.markResume(now.toISOString(), resume.from);
  let stopReason: string | null = null;
  let firstSignalAt = 0;
  const onSignal = (sig: string) => {
    // A terminal Ctrl-C reaches npx, tsx and node at once and tsx forwards it — one keypress can
    // arrive twice within milliseconds. Only a signal ≥ 3 s after the first means "exit now".
    const t = Date.now();
    if (firstSignalAt && t - firstSignalAt < 3000) return;
    if (firstSignalAt) { console.error(`\n${sig} again — exiting NOW. In-flight worlds may be left on the probe hosts: run \`npx tsx scripts/eval-outputs.ts --sweep --apply\`, then --resume ${jsonPath}`); process.exit(130); }
    firstSignalAt = t;
    stopReason = `${sig} received`;
    console.error(`\n${sig}: no new units will start; in-flight units finish (and tear down), then the journal and report are written. Send it again to exit immediately.`);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const judge = useJudge ? await liveMod.buildJudge() : null;
  const reserve = reserveFn(now);
  const t0 = Date.now();
  const runOnce = (prior: RunRecord[], shouldStop: () => string | null) => runEngine({
    adapters, envs, columns, repeat, maxEur, judge, meter: liveMod.meterPort,
    price: (r) => priceCalls(r), selectCase, now, log: (l) => console.log(l),
    concurrency, worldLanes, reserve, prior, onRun: (r) => journal.append(r), shouldStop,
    worldClock: () => new Date(), effortOverride: augmtdEffort,
  });
  let result: EngineResult;
  let resumeLeg: string | null = null;
  if (selfCheck && !resume && !flag('no-resume-leg')) {
    // THE RESUME LEG (self-check): stop after roughly half the column runs, then resume from the journal
    // ON DISK — the path a stopped paid run takes. Every unit must land exactly once across both legs.
    const half = Math.max(1, Math.floor(plannedColumnRuns() / 2));
    let finished = 0;
    const leg1 = await runEngine({
      adapters, envs, columns, repeat, maxEur, judge, meter: liveMod.meterPort, price: (r) => priceCalls(r), selectCase, now, log: (l) => console.log(l),
      concurrency, worldLanes, reserve, onRun: (r) => { finished++; journal.append(r); }, shouldStop: () => stopReason ?? (finished >= half ? 'self-check resume leg: simulated stop' : null),
      worldClock: () => new Date(), effortOverride: augmtdEffort,
    });
    const back = loadResume(jsonPath.replace(/\.json$/, '.jsonl'));
    console.log(`\n↻ self-check resume leg: stopped after ${finished} column run(s) (${leg1.pendingUnits} unit(s) pending) → resuming from ${path.basename(back.from)} (${back.records.length} record(s))`);
    result = await runOnce(back.records, () => stopReason);
    result.totalCostEur = leg1.spentThisRunEur! + result.spentThisRunEur!;
    // Per-account host stats cover both legs (the pool assertions judge the whole run).
    for (const [k, h] of Object.entries(leg1.concurrency?.hosts ?? {})) {
      const cur = result.concurrency?.hosts?.[k];
      if (cur) { cur.runs += h.runs; cur.peakWorlds = Math.max(cur.peakWorlds, h.peakWorlds); }
    }
    resumeLeg = `leg 1 stopped with ${leg1.pendingUnits} unit(s) pending after ${finished} run(s); leg 2 resumed ${result.resumedRuns} run(s) from the journal`;
  } else {
    result = await runOnce(resume?.records ?? [], () => stopReason);
  }
  const wallS = (Date.now() - t0) / 1000;
  result.notes.push(...notes);
  if (resume?.saved) for (const sr of result.surfaces) for (const cr of sr.cases) if (cr.groundTruth == null) {
    const old = resume.saved.surfaces.find((x) => x.surface === sr.surface && x.tier === sr.tier)?.cases.find((x) => x.caseId === cr.caseId);
    if (old?.groundTruth != null) cr.groundTruth = old.groundTruth;
  }
  const late = liveMod.lateSpend();
  result.totalCostEur += late.eur + late.orphanEur;
  result.notes.push(`Background calls billed after their run: ${late.calls} (€${late.eur.toFixed(4)}); calls outside any run: ${late.orphans} (€${late.orphanEur.toFixed(4)}).`);
  result.notes.push(`Clocks: truths + plain prompts on the run clock ${now.toISOString()}; AUGMTD worlds seeded on the wall clock (max skew ${((result.clock?.maxSkewMs ?? 0) / 60_000).toFixed(1)} min)${result.clock?.dayDrift.length ? ` — **${result.clock.dayDrift.length} unit(s) on another calendar day than their truths**: ${result.clock.dayDrift.slice(0, 8).join('; ')}${result.clock.dayDrift.length > 8 ? ' …' : ''}` : ''}; process TZ=${process.env.TZ}.`);
  result.notes.push(`AUGMTD effort: ${augmtdEffortSpec ? `**OVERRIDE ${augmtdEffortSpec}** (eval-only AI_EFFORT_OVERRIDE; the factory adds output headroom — lib/ai/effort.ts)` : `the product's own — PRODUCER_EFFORT (lib/ai/effort.ts: ${Object.entries(PRODUCER_EFFORT).map(([k, v]) => `${k}=${Object.entries(v ?? {}).map(([f, e]) => `${e}@${f}`).join('/')}`).join(', ')}), else the param floor`}.`);
  result.notes.push(`Plain-column efforts: same = the param floor's value for the model, stated explicitly (a plain same-model baseline — not the producer's PRODUCER_EFFORT) · sonnet55 = ${efforts.sonnet55 ?? 'provider default'} · gpt56 = ${efforts.gpt56 ?? 'provider default'}. System prompt for every plain column: "You are a helpful assistant.".`);
  result.notes.push(`Probe pool: ${accounts.map((a) => `${a.label} ${a.userId.slice(0, 8)} (${result.concurrency?.hosts?.[a.label]?.runs ?? 0} AUGMTD run(s))`).join(' · ')} — identical config per tier (fairness check${unfair.length ? ` FAILED: ${unfair.join('; ')}` : ' passed'}); fixture worlds seeded per repeat with fresh ids, torn down after each run.`);
  result.notes.push(`Scheduling: ${concurrency} unit(s) in flight (peak ${result.concurrency?.peakUnits ?? '?'}), ${worldLanes} seeded world(s) at a time per probe account${worldLanes > 1 ? ' (worlds on one account could see each other\'s records — isolation traded for speed)' : ''}, provider caps ${Object.entries(providerCaps).map(([k, v]) => `${k} ${v}`).join(' · ')} (peak ${Object.entries(providerGate.peak).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}); wall ${wallS.toFixed(1)}s.`);
  if (result.resumedRuns) result.notes.push(`Resumed: ${result.resumedRuns} finished column run(s) kept from the journal (€${(result.priorCostEur ?? 0).toFixed(4)} spent then); this invocation spent €${(result.spentThisRunEur ?? 0).toFixed(4)}.`);
  if (resumeLeg) result.notes.push(`Self-check resume leg: ${resumeLeg}.`);
  if (result.stopped) result.notes.push(`**STOPPED EARLY** (${result.stopped}): ${result.pendingUnits} unit(s) not started — continue with \`--resume ${jsonPath}\`.`);
  if (blocked.length) result.notes.push(`**PROBE FENCE refused ${blocked.length} write(s) naming a non-probe user**: ${[...new Set(blocked)].join('; ')}`);

  // 4 · teardown symmetry, run-level: the post-run sweep catches any leak (a failure of the harness),
  //     then the probe's counts after the run must equal its counts before it.
  const leaks: string[] = [];
  for (const a of accounts) {
    try {
      const r = await sweepProbe(admin, a.userId, { apply: true, fixture });
      if (r.total || r.errors.length) leaks.push(`${a.label}: ${describeSweep(r)}`);
    } catch (e) { leaks.push(`${a.label}: post-run sweep failed — ${(e as Error).message} (run --sweep --apply)`); }
  }
  if (leaks.length) result.notes.push(`⚠ post-run sweep deleted rows teardown left behind: ${leaks.join(' | ')}`);
  const residue: string[] = [];
  for (const a of accounts) {
    const after = await snapshotCounts(admin, a.userId);
    residue.push(...diffCounts(before[a.label], after).map((d) => `${a.label}: ${d}`));
  }
  if (residue.length) result.notes.push(`⚠ probe row counts changed across the run (residue, or a concurrent suite on the probe host): ${residue.join('; ')}`);

  for (const mp of list('merge') ?? []) {
    const other = JSON.parse(readFileSync(mp, 'utf8')) as EngineResult;
    const m = mergeEngine(result, other);
    result = m.result;
    result.notes.push(`Merged from ${path.basename(mp)}: ${m.added.join('; ') || 'nothing new'} (its spend was counted when it ran).`);
  }

  writeAtomic(md, renderEngineReport(result, ADAPTERS, { title: selfCheck ? 'W26 — engine self-check (real producers, stubbed model, zero AI)' : undefined }));
  writeAtomic(jsonPath, serialize(result));
  printScoreboard(result);
  console.log(`\nreport → ${md}\njournal → ${journalPathOf(jsonPath)}\nwall ${wallS.toFixed(1)}s · concurrency ${concurrency} (peak ${result.concurrency?.peakUnits}) · world lanes ${worldLanes} per account × ${accounts.length} account(s) (${accounts.map((a) => `${a.label} ${result.concurrency?.hosts?.[a.label]?.runs ?? 0}`).join(', ')})\nTHIS RUN metered cost: €${(result.spentThisRunEur ?? result.totalCostEur).toFixed(4)}${result.resumedRuns ? ` (+ €${(result.priorCostEur ?? 0).toFixed(4)} before the resume)` : ''}${result.budgetHit ? ' (BUDGET HIT — later units skipped)' : ''}`);
  if (result.stopped) { console.log(`\nSTOPPED (${result.stopped}) — ${result.pendingUnits} unit(s) pending. Continue: npx tsx scripts/eval-outputs.ts ${argv.filter((a, i) => a !== '--resume' && argv[i - 1] !== '--resume').join(' ')} --resume ${jsonPath}`); process.exitCode = process.exitCode || 3; }

  if (selfCheck) {
    const problems = selfCheckProblems(result, residue, blocked, {
      leaks, caps: providerCaps, peak: providerGate.peak, concurrency,
      expectResume: !!resumeLeg, plannedRuns: plannedColumnRuns(),
      pool: { worldLanes, unfair, accounts: accounts.map((a) => ({ label: a.label, tier: a.tier })) },
    });
    if (problems.length) { console.log(`\n✗ SELF-CHECK FAILED:\n  - ${problems.join('\n  - ')}`); process.exitCode = 1; }
    else console.log(`\n✓ self-check: ${result.surfaces.length} surface run(s) — seed → real producer (stubbed model) → plain columns → score → teardown, ${concurrency} unit(s) concurrent (peak ${result.concurrency?.peakUnits}), provider caps held, stop + resume from the journal, symmetric, zero AI.`);
  }
}

/** Column runs the plan will execute (tier-free columns once) — the resume share and the self-check's count. */
function plannedColumnRuns(): number {
  let n = 0;
  tiers.forEach((t, ti) => {
    for (const a of adapters) {
      if (!a.tiers.includes(t)) continue;
      const cases = a.cases().filter((c) => selectCase(a, c as EvalCase)).length;
      const firstTierHas = a.tiers.includes(tiers[0]);
      const cols = columns.filter((c) => !(ti > 0 && firstTierHas && TIER_FREE.includes(c))).length;
      n += cases * repeat * cols;
    }
  });
  return n;
}

/** The per-unit budget reservation: the estimate's per-(case × repeat) share of its surface × tier row,
 *  scaled to the columns the unit still runs. */
function reserveFn(now: Date): (a: AnyAdapter, tier: Tier, c: EvalCase, cols: ColumnId[]) => number {
  const est = estimateRun({
    adapters, tiers, columns, repeat, judge: useJudge ? 'claude-opus-5-5' : null, now, select: selectCase,
    plainModels: { sonnet55: 'claude-sonnet-5-5', gpt56: 'gpt-5.6-terra' }, augmtdEffort,
  });
  const per = new Map(est.rows.map((r) => [`${r.tier}|${r.surface}`, { unit: r.total / Math.max(1, r.cases * repeat), cols: Object.keys(r.byColumn).length || 1 }]));
  return (a, tier, _c, cols) => {
    const p = per.get(`${tier}|${a.id}`);
    return p ? p.unit * Math.min(1, cols.length / p.cols) : 0;
  };
}

function printScoreboard(r: EngineResult): void {
  console.log('\nSCOREBOARD (primary metric; ✓ = AUGMTD ≥ that column on the surface and every scenario)');
  for (const sr of r.surfaces) {
    const s = summarizeSurface(ADAPTERS.find((a) => a.id === sr.surface), sr);
    const cells = sr.columns.map((c) => {
      const p = s.parity.find((x) => x.vs === c.id);
      const v = s.columns[c.id]?.primary;
      return `${c.id} ${v == null ? '–' : v.toFixed(3)}${p ? (p.ok == null ? '?' : p.ok ? '✓' : '✗') : ''}`;
    });
    console.log(`  ${sr.surface.padEnd(28)} ${sr.tier.padEnd(9)} ${cells.join(' | ')} → ${s.verdict == null ? 'not measurable' : s.verdict ? '≥ every column' : 'BELOW'}`);
  }
}

const EXPAND_MODEL = 'claude-sonnet-5-5';
function expandSeeds(a: AnyAdapter): EvalCase[] {
  const cs = a.cases() as EvalCase[];
  const authored = cs.filter((c) => !c.canary);
  return (authored.length ? authored : cs).slice(0, 6);
}
function printExpandPlan(): number {
  const n = Math.max(1, Number(opt('expand')));
  const p = priceOf(EXPAND_MODEL)!;
  let total = 0;
  for (const a of adapters) {
    const inTok = Math.ceil(JSON.stringify(expandSeeds(a)).length / 4) + 1500;
    const outTok = n * 700;
    const c = eur(p, inTok, outTok * 2);
    total += c;
    console.log(`  --expand ${a.id}: ${n} proposal(s) from ${expandSeeds(a).length} seed(s) · ~${inTok} in / ~${outTok} out (+ reasoning) · €${c.toFixed(3)}`);
  }
  console.log(`  EXPAND TOTAL ≈ €${total.toFixed(2)} (${EXPAND_MODEL}); proposals go to scratchpad/ for human review — fixtures are never written`);
  return total;
}
/** --expand N: a strong model proposes N variants per surface from its seed cases; the engine
 *  validates each (fixtureProblems) and writes them to scratchpad/ for HUMAN review. Never a fixture write. */
async function expandCases(liveMod: typeof import('./lib/eval/engine/live')): Promise<void> {
  const n = Math.max(1, Number(opt('expand')));
  const est = printExpandPlan();
  if (est > maxEur) die(`REFUSED: expand estimate €${est.toFixed(2)} exceeds --max-eur ${maxEur}`);
  const { getEndpointClient, aiCreate } = await import('../lib/ai/factory');
  const { metered } = await import('./lib/eval/meter');
  const { priceCalls } = await import('./lib/eval/engine/pricing');
  const { buildExpandPrompt, parseProposals, fixtureProblems } = await import('./lib/eval/engine/expand');
  const client = getEndpointClient({ provider: 'anthropic', model: EXPAND_MODEL, baseURL: 'https://api.anthropic.com/v1' } as Parameters<typeof getEndpointClient>[0]);
  let spent = 0;
  for (const a of adapters) {
    const { result, bucket } = await metered(() => aiCreate(client, { model: EXPAND_MODEL, max_tokens: 16000, reasoning_effort: (efforts.sonnet55 ?? 'medium') as 'minimal', messages: [{ role: 'user', content: buildExpandPrompt(a, expandSeeds(a), n) }] }));
    spent += priceCalls(bucket.calls).costEur;
    const proposals = parseProposals(String(result.choices?.[0]?.message?.content ?? ''));
    const reviewed = proposals.map((c) => ({ case: c, problems: fixtureProblems(c, a) }));
    const out = outPath(`w26-expand-${a.id}-${stamp}.json`);
    writeFileSync(out, JSON.stringify({ surface: a.id, model: EXPAND_MODEL, status: 'PROPOSED — human review required; never auto-committed', proposals: reviewed }, null, 1));
    console.log(`  ${a.id}: ${proposals.length} proposal(s), ${reviewed.filter((r) => !r.problems.length).length} pass the fixture hygiene → ${out}`);
  }
  void liveMod;
  console.log(`expand spend: €${spent.toFixed(4)}`);
}

async function probeColumns(liveMod: typeof import('./lib/eval/engine/live')): Promise<void> {
  const { getEndpointClient, aiCreate } = await import('../lib/ai/factory');
  const { metered } = await import('./lib/eval/meter');
  const { priceCalls } = await import('./lib/eval/engine/pricing');
  const cases: Array<{ id: string; model: string; provider: 'anthropic' | 'openai'; effort: string | null }> = [
    { id: 'sonnet55', model: liveMod.SONNET55, provider: 'anthropic', effort: efforts.sonnet55 },
    { id: 'gpt56', model: liveMod.GPT56, provider: 'openai', effort: efforts.gpt56 },
    { id: 'judge', model: liveMod.JUDGE_MODEL, provider: 'anthropic', effort: null },
  ];
  let total = 0;
  for (const c of cases) {
    const client = getEndpointClient({ provider: c.provider, model: c.model, ...(c.provider === 'anthropic' ? { baseURL: 'https://api.anthropic.com/v1' } : {}) } as Parameters<typeof getEndpointClient>[0]);
    try {
      const { result, bucket } = await metered(() => aiCreate(client, { model: c.model, max_tokens: 2000, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], ...(c.effort ? { reasoning_effort: c.effort as 'minimal' } : {}) }));
      const p = priceCalls(bucket.calls);
      total += p.costEur;
      console.log(`  ✓ ${c.id} ${c.model} effort=${c.effort ?? 'unstated'} → "${String(result.choices?.[0]?.message?.content ?? '').trim().slice(0, 40)}" · ${p.promptTokens}+${p.completionTokens} tok · €${p.costEur.toFixed(5)}`);
    } catch (e) {
      console.log(`  ✗ ${c.id} ${c.model} effort=${c.effort ?? 'unstated'} → ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
  console.log(`probe-columns spend: €${total.toFixed(5)}`);
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
