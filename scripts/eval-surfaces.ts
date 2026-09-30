// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 — EVERY SURFACE WHERE AI WRITES FOR THE USER vs THE PLAIN MODELS (the Home-chat eval's method,
// scripts/eval-home-chat.ts, extended to the other writing surfaces). Surfaces (scripts/lib/eval-surfaces):
//   dm.coworker     coworker DMs (Luca · Max · Clara)   → POST /api/work/threads/[id]/chat, in-process
//   room.chat       item · task · project room chats    → lib/converse converse (item/commitment/entity)
//   workflow.step   a workflow step with declared output → lib/workflows/execute-step executeStep
//   handoff.result  the hand-off deliverable posted back → converse hand-off → runDelegation → post
//   draft.reply     drafted email replies                → draftThroughVet(generateReplyDraft)
// Columns: augmtd (the real producer over a seeded world on a PROBE HOST) · same (the same model,
// "You are a helpful assistant.") · sonnet55 · gpt56 — the W26 engine's columns, runner, blind Opus judge
// (reason first, then 1-5), pricing, metering and report (scripts/lib/eval/engine, imported unchanged).
// Verdict per surface AND per scenario: AUGMTD ≥ each plain column.
//
// PROBE HOSTS: account #1 of each tier by default — smoke-probe@ (standard) and smoke-probe-eu@ (EU). The pool
// accounts #2+ belong to scripts/eval-outputs.ts and are touched here ONLY when named with --probe-host
// std=k,eu=k (W30 — e.g. the account carrying a candidate model's tenant_configs override).
//
//   npx tsx scripts/eval-surfaces.ts --quick                 # DRY RUN: plan + estimate (spends nothing)
//   npx tsx scripts/eval-surfaces.ts --quick --yes           # QUICK: 1 repeat, ≤2 scenarios/surface, all four columns
//   npx tsx scripts/eval-surfaces.ts --yes                   # FULL: 3 repeats, every scenario, all four columns
//   npx tsx scripts/eval-surfaces.ts --self-check            # zero AI: real producers, stubbed model, egress fenced
// Flags: --surfaces dm,room,… · --tier standard|eu|both (default both) · --repeat n · --columns a,b ·
//   --cases id,id · --max-eur n (hard stop; quick default 3, full default 30; the run refuses to start when
//   the estimate exceeds it unless --allow-over-estimate) · --concurrency n (units in flight, default 4) ·
//   --no-judge · --out <path.md> · --probe-host std=k,eu=k (a named, provisioned pool account per tier)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
process.env.TZ = 'UTC';
config({ path: '.env.local', quiet: true } as never);
// The route bridge goes in BEFORE any product module loads (see route-shim.ts) — a side-effect import.
import './lib/eval-surfaces/arm';
import { mintProbeSession } from './lib/eval-surfaces/route-shim';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { selectSurfaces } from './lib/eval-surfaces/registry';
import { setRunClock, scenarioRows, renderScenarioTable, surfaceMeans, quickSubset } from './lib/eval-surfaces/common';
import { removeTeams } from './lib/eval-surfaces/team';
import { estimateRun, slotModel } from './lib/eval/engine/estimate';
import { runEngine, type EngineResult, type TierEnv } from './lib/eval/engine/runner';
import { renderEngineReport, serialize } from './lib/eval/engine/report';
import { makeProviderGate, DEFAULT_PROVIDER_CAPS } from './lib/eval/engine/concurrency';
import { setCallGate } from './lib/eval/meter';
import { priceCalls } from './lib/eval/engine/pricing';
import { snapshotCounts, diffCounts, probePoolEmail, probeHostOf } from './lib/eval/engine/world';
import { COLUMN_IDS, type AnyAdapter, type ColumnId, type EvalCase, type Tier } from './lib/eval/engine/types';
import { parseProbeHostSpec } from './lib/eval/engine/probes';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string): string | null => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const list = (n: string) => opt(n)?.split(',').map((x) => x.trim()).filter(Boolean) ?? null;
const die = (m: string): never => { console.error(m); process.exit(2); };

const quick = flag('quick');
const selfCheck = flag('self-check');
const live = flag('yes') && !selfCheck;
const tierArg = opt('tier') ?? 'both';
const tiers: Tier[] = tierArg === 'both' ? ['standard', 'eu'] : tierArg === 'eu' ? ['eu'] : tierArg === 'standard' ? ['standard'] : die('--tier must be standard|eu|both');
const repeat = Math.max(1, Math.floor(Number(opt('repeat') ?? (quick || selfCheck ? '1' : '3'))));
// The owner's bar is every column, so the quick mode runs all four too (--columns augmtd,same for a cheap probe).
const columns = (list('columns') ?? COLUMN_IDS) as ColumnId[];
if (columns.some((c) => !COLUMN_IDS.includes(c)) || !columns.includes('augmtd')) die(`--columns must include augmtd and be a subset of ${COLUMN_IDS.join(',')}`);
const maxEur = Number(opt('max-eur') ?? (selfCheck ? '1' : quick ? '5' : '30'));
const useJudge = !flag('no-judge');
const caseIds = list('cases');
const concurrency = Math.max(1, Math.floor(Number(opt('concurrency') ?? '4')));
// W30 — --probe-host std=k,eu=k: run on a NAMED pool account instead of #1 (default #1 per tier).
const probeHostSpec = (() => { try { return parseProbeHostSpec(opt('probe-host')); } catch (e) { return die((e as Error).message); } })();
const adapters: AnyAdapter[] = selectSurfaces(list('surfaces'));
if (!adapters.length) die('no surface matches --surfaces');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const quickIds = new Map(adapters.map((a) => [a.id, new Set(quickSubset(a.cases() as EvalCase[]).map((c) => c.id))]));
function selectCase(a: AnyAdapter, c: EvalCase): boolean {
  if (caseIds?.length) return caseIds.includes(c.id);
  if (quick || selfCheck) return quickIds.get(a.id)!.has(c.id);
  return true;
}

function plan(now: Date): { total: number; rows: ReturnType<typeof estimateRun>['rows'] } {
  const est = estimateRun({
    adapters, tiers, columns, repeat, judge: useJudge ? 'claude-opus-5-5' : null, now, select: selectCase,
    plainModels: { sonnet55: 'claude-sonnet-5-5', gpt56: 'gpt-5.6-terra' },
  });
  console.log(`\nW28 · eval-surfaces · ${quick ? 'QUICK' : selfCheck ? 'SELF-CHECK' : 'FULL'} · tiers ${tiers.join('+')} · repeat ${repeat} · columns ${columns.join(', ')} · judge ${useJudge ? 'claude-opus-5-5 (blind, reason first)' : 'off'} · concurrency ${concurrency}`);
  for (const a of adapters) {
    const cs = (a.cases() as EvalCase[]).filter((c) => selectCase(a, c));
    console.log(`  ${a.id.padEnd(16)} ${String(cs.length).padStart(2)} case(s) · ${a.producer.fn} · ${tiers.map((t) => `${t}=${slotModel(t, a.producer.slot)}`).join(', ')}`);
    for (const c of cs) console.log(`      ${c.id.padEnd(24)} ${c.title}`);
  }
  console.log('\nESTIMATE (€, conservative; reasoning columns at 3× visible output; tier-free plain columns once):');
  for (const r of est.rows) console.log(`  ${r.surface.padEnd(16)} ${r.tier.padEnd(9)} ${String(r.cases).padStart(3)} case(s)  ${columns.map((c) => `${c} ${(r.byColumn[c] ?? 0).toFixed(3)}`).join(' · ')} · judge ${r.judge.toFixed(3)} · total ${r.total.toFixed(3)}${r.unpriced.length ? `  UNPRICED ${r.unpriced.join(',')}` : ''}`);
  console.log(`  TOTAL ≈ €${est.total.toFixed(2)} (hard stop --max-eur ${maxEur})`);
  return est;
}

/** A read that may hit a transient network failure: three tries. */
async function retry<T>(fn: () => Promise<T>, n = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
}

function outPath(name: string): string {
  const out = opt('out') ?? path.join(process.cwd(), 'scratchpad', name);
  mkdirSync(path.dirname(out), { recursive: true });
  return out;
}

/** The probe hosts this harness may touch: account #1 of each requested tier (verified by address) —
 *  or, with --probe-host std=k,eu=k (W30), the NAMED pool account of that tier (e.g. one carrying a
 *  candidate model override). A named #k ≥ 2 must already be provisioned (scripts/probe-pool.ts). */
async function probeHosts(admin: import('@supabase/supabase-js').SupabaseClient): Promise<Array<{ tier: Tier; userId: string; email: string; label: string }>> {
  const hosts: Array<{ tier: Tier; userId: string; email: string; label: string }> = [];
  for (const tier of tiers) {
    const k = probeHostSpec[tier] ?? 1;
    const email = probePoolEmail(tier, k);
    let userId: string | null = null;
    if (k > 1) {
      const { resolveProbePool } = await import('./lib/eval/engine/probes');
      const r = await resolveProbePool(admin, { spec: { [tier]: [k] }, create: false });
      if (r.problems.length || r.missing.length || !r.accounts[0]) die(`probe host ${tier}#${k} not ready: ${[...r.problems, ...r.missing].join('; ') || 'not found'} (provision with scripts/probe-pool.ts --create)`);
      userId = r.accounts[0].userId;
    } else if (tier === 'standard') userId = await (await import('./probe-user')).resolveProbeUser(admin);
    else {
      const st = await (await import('./lib/eval/engine/probes')).resolveEuProbeUser(admin, { create: false });
      if (!st.userId || st.problems.length || st.tier !== 'bedrock_optimised') die(`EU probe host not ready: ${st.problems.join('; ') || st.tier}`);
      userId = st.userId;
    }
    const { data, error } = await admin.auth.admin.getUserById(userId!);
    if (error || probeHostOf(data?.user?.email)?.k !== k || probeHostOf(data?.user?.email)?.tier !== tier) die(`REFUSED: ${userId} is not the ${tier} probe host #${k}`);
    hosts.push({ tier, userId: userId!, email, label: `${tier === 'standard' ? 'std' : 'eu'}#${k}` });
  }
  return hosts;
}

/** --sweep [--apply]: what a stopped run left on the probe hosts (fixture worlds + the seeded team). */
async function runSweep(): Promise<void> {
  const liveMod = await import('./lib/eval/engine/live');
  const admin = liveMod.adminClient();
  const hosts = await probeHosts(admin);
  liveMod.armProbeFence(process.env.NEXT_PUBLIC_SUPABASE_URL!, hosts.map((h) => h.userId), (r) => { console.error(`probe fence: ${r}`); process.exitCode = 1; });
  const { sweepProbe, describeSweep, fixtureIdentity } = await import('./lib/eval/engine/sweep');
  const { sweepTeam } = await import('./lib/eval-surfaces/team');
  const fixture = fixtureIdentity(adapters);
  for (const h of hosts) {
    const w = await sweepProbe(admin, h.userId, { apply: flag('apply'), fixture });
    const t = await sweepTeam(admin, h.userId, flag('apply'));
    console.log(`${h.label} ${h.userId.slice(0, 8)}: worlds → ${describeSweep(w)} · team → ${t.workers} coworker row(s), ${t.threads} thread(s)${t.errors.length ? ` · ERRORS ${t.errors.join('; ')}` : ''}`);
    if (w.errors.length || t.errors.length) process.exitCode = 1;
  }
  if (!flag('apply')) console.log('DRY RUN — nothing deleted. Add --apply to delete (the probe hosts above only).');
}

/** --rejudge <run.json> [--twice N]: score a saved run again with the CURRENT blind judge prompt (no
 *  regeneration; every column the same judge), and optionally judge a sample twice (grader consistency). */
async function runRejudge(file: string): Promise<void> {
  const { readFileSync } = await import('fs');
  const { judgeableRuns, judgeRun, agreement } = await import('./lib/eval-surfaces/rejudge');
  const result = JSON.parse(readFileSync(file, 'utf8')) as EngineResult;
  setRunClock(new Date(result.now));
  const liveMod = await import('./lib/eval/engine/live');
  liveMod.armMeter(false);
  const gate = makeProviderGate(DEFAULT_PROVIDER_CAPS);
  setCallGate((await import('./lib/eval-surfaces/failures')).failureGate(gate.gate));
  liveMod.assertPriced([liveMod.JUDGE_MODEL]);
  const judge = await liveMod.buildJudge();
  const { SURFACES } = await import('./lib/eval-surfaces/registry');
  let spent = 0;
  const call = async (sys: string, user: string, nudge: boolean) => {
    const { result: raw, calls } = await liveMod.meterPort.run(() => judge.call(sys, user, nudge));
    spent += priceCalls(calls).costEur;
    return raw;
  };
  const all = judgeableRuns(result);
  const runAt = (t: { si: number; ci: number; col: string; rep: number }) => (result.surfaces[t.si].cases[t.ci].runs as Record<string, import('./lib/eval/engine/types').ColumnRun[]>)[t.col][t.rep];
  // A run already re-judged carries the marker (a resumed re-judge only does what is left).
  const rejudged = (t: { si: number; ci: number; col: string; rep: number }) => !!(runAt(t).verdict as { rejudged?: boolean } | null | undefined)?.rejudged
    || ((runAt(t).verdict?.costEur ?? 1) === 0 && (runAt(t).verdict?.promptTokens ?? 1) === 0);
  const todo = flag('only-unrejudged') ? all.filter((t) => !rejudged(t)) : all;
  const twiceN = Math.max(0, Math.floor(Number(opt('twice') ?? '0')));
  const sample = twiceN ? all.filter((_, i) => i % Math.max(1, Math.floor(all.length / twiceN)) === 0).slice(0, twiceN) : [];
  console.log(`re-judging ${todo.length} saved column run(s) of ${path.basename(file)} (+ ${sample.length} judged twice) · judge ${liveMod.JUDGE_MODEL} · run clock ${result.now} · hard stop €${maxEur}`);
  const first = new Map<string, { score: number | null; hard: boolean }>();
  let i = 0, stopped = false;
  const worker = async () => {
    for (;;) {
      const k = i++;
      if (k >= todo.length) return;
      if (spent >= maxEur) { stopped = true; return; }
      const t = todo[k];
      const sr = result.surfaces[t.si], cr = sr.cases[t.ci];
      const adapter = SURFACES.find((a) => a.id === sr.surface)!;
      const c = (adapter.cases() as EvalCase[]).find((x) => x.id === cr.caseId)!;
      const run = (cr.runs as Record<string, import('./lib/eval/engine/types').ColumnRun[]>)[t.col][t.rep];
      const { verdict, score } = await judgeRun(adapter, c, run, call);
      run.verdict = { ...verdict, costEur: 0, promptTokens: 0, completionTokens: 0, rejudged: true } as never;
      run.score = score;
      first.set(`${t.si}|${t.ci}|${t.col}|${t.rep}`, { score, hard: !!verdict.hardFails?.length });
      if ((k + 1) % 25 === 0) console.log(`  ${k + 1}/${todo.length} · €${spent.toFixed(2)}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Reused tier-free copies take their source's new verdict.
  for (const sr of result.surfaces) for (const cr of sr.cases) for (const [col, runs] of Object.entries(cr.runs)) (runs ?? []).forEach((r, rep) => {
    if (!r?.reusedFrom) return;
    const src = result.surfaces.find((x) => x.surface === sr.surface && x.tier === r.reusedFrom)?.cases.find((x) => x.caseId === cr.caseId)?.runs[col as ColumnId]?.[rep];
    if (src) { r.score = src.score; r.verdict = src.verdict; }
  });
  // Grader consistency: the sample judged a second time.
  const pairs: Array<[number | null, number | null, boolean, boolean]> = [];
  for (const t of sample) {
    if (spent >= maxEur) break;
    const sr = result.surfaces[t.si], cr = sr.cases[t.ci];
    const adapter = SURFACES.find((a) => a.id === sr.surface)!;
    const c = (adapter.cases() as EvalCase[]).find((x) => x.id === cr.caseId)!;
    const run = (cr.runs as Record<string, import('./lib/eval/engine/types').ColumnRun[]>)[t.col][t.rep];
    const again = await judgeRun(adapter, c, run, call);
    const f = first.get(`${t.si}|${t.ci}|${t.col}|${t.rep}`) ?? (rejudged(t) ? { score: run.score, hard: !!run.verdict?.hardFails?.length } : undefined);
    if (!f) continue;
    pairs.push([f.score ?? null, again.score, !!f.hard, !!again.verdict.hardFails?.length]);
  }
  const agr = agreement(pairs);
  const columns = [...new Set(result.surfaces.flatMap((sr) => sr.columns.map((c) => c.id)))] as ColumnId[];
  const rows = scenarioRows(result);
  const means = surfaceMeans(rows, columns);
  const out = file.replace(/\.json$/, '').replace(/-rejudged$/, '') + '-rejudged';
  result.notes.push(`RE-JUDGED ${new Date().toISOString()} with the current judge prompt (world facts: today + zone, the user, seeded states) — no regeneration; €${spent.toFixed(2)}${stopped ? ' (BUDGET STOP — some runs keep their old verdict)' : ''}.`);
  const head = [
    `# W28 — full run re-judged (same saved answers, current judge, every column alike)`, '',
    `Re-judge spend **€${spent.toFixed(2)}**${stopped ? ' — budget stop hit' : ''} · judge ${liveMod.JUDGE_MODEL} · run clock ${result.now}`, '',
    `## Grader consistency (${agr.n} answers judged twice)`, '',
    `exact same score ${agr.exactPct.toFixed(0)}% · within 0.5 ${agr.within05Pct.toFixed(0)}% · mean |Δ| ${agr.meanAbsDiff.toFixed(2)} · hard-fail agreement ${agr.hardFailAgreePct.toFixed(0)}%`, '',
    '## Per surface (mean judge score 1–5)', '',
    `| surface | tier | ${columns.join(' | ')} | scenario×column pairs below |`, `|---|---|${columns.map(() => '---:').join('|')}|---:|`,
    ...means.map((m) => `| ${m.surface} | ${m.tier} | ${columns.map((c) => (m.means[c] == null ? '–' : m.means[c]!.toFixed(2))).join(' | ')} | ${m.below} |`),
    '', '## Per scenario', '', renderScenarioTable(rows, columns), '',
  ].join('\n');
  writeFileSync(`${out}.md`, head);
  writeFileSync(`${out}.json`, serialize(result));
  console.log(head.split('## Per scenario')[0]);
  console.log(renderScenarioTable(rows, columns).split('\n').slice(-1)[0]);
  console.log(`→ ${out}.md`);
}

async function main() {
  if (flag('sweep')) { await runSweep(); return; }
  if (opt('rejudge')) { await runRejudge(opt('rejudge')!); return; }
  const now = new Date();
  setRunClock(now);
  const est = plan(now);
  if (!live && !selfCheck) { console.log('\nDRY RUN — nothing spent. Add --yes to run (the orchestrator runs it).'); return; }
  if (live && est.total > maxEur && !flag('allow-over-estimate')) die(`\nREFUSED: the estimate €${est.total.toFixed(2)} exceeds --max-eur ${maxEur}`);

  // 1 · the meter (+ in self-check the egress fence) BEFORE the first factory client exists.
  const liveMod = await import('./lib/eval/engine/live');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? die('NEXT_PUBLIC_SUPABASE_URL missing');
  liveMod.armMeter(selfCheck);
  const gate = makeProviderGate(DEFAULT_PROVIDER_CAPS);
  setCallGate((await import('./lib/eval-surfaces/failures')).failureGate(gate.gate));
  if (selfCheck) await liveMod.installEgressFence(supabaseUrl);
  if (live) liveMod.assertPriced([...(columns.includes('sonnet55') ? [liveMod.SONNET55] : []), ...(columns.includes('gpt56') ? [liveMod.GPT56] : []), ...(useJudge ? [liveMod.JUDGE_MODEL] : []),
    ...tiers.map((t) => slotModel(t, 'conversation'))]);

  // 2 · THE PROBE HOSTS — account #1 of each tier, or the pool account named with --probe-host.
  const admin = liveMod.adminClient();
  const hosts = await probeHosts(admin);
  const blocked: string[] = [];
  liveMod.armProbeFence(supabaseUrl, hosts.map((h) => h.userId), (r) => blocked.push(r));
  const { sweepProbe, describeSweep, fixtureIdentity } = await import('./lib/eval/engine/sweep');
  const fixture = fixtureIdentity(adapters);
  const notes: string[] = [];
  // W30 — the models each host ACTUALLY resolves (tier default merged with its tenant_configs
  // model_overrides), so a candidate-model run says what it measured.
  {
    const { getAIClient } = await import('../lib/ai/factory');
    for (const h of hosts) {
      const slots = ['conversation', 'generation', 'classification', 'summarization', 'planning'] as const;
      const got = await Promise.all(slots.map(async (t) => `${t}=${(await getAIClient(h.userId, t, admin)).model}`));
      const line = `Models on ${h.label}: ${got.join(' · ')}`;
      console.log(`  ${line}`);
      notes.push(line);
    }
  }
  const countExtra = async (uid: string) => {
    const out: Record<string, number> = {};
    for (const t of ['custom_agents', 'work_threads', 'room_turns']) {
      const { count, error } = await admin.from(t).select('user_id', { count: 'exact', head: true }).eq('user_id', uid);
      if (error) throw new Error(`count ${t}: ${error.message}`);
      out[t] = count ?? 0;
    }
    return out;
  };
  const before: Record<string, Record<string, number>> = {};
  for (const h of hosts) {
    const r = await sweepProbe(admin, h.userId, { apply: true, fixture });
    if (r.total || r.errors.length) { const line = `Pre-run sweep ${h.label}: ${describeSweep(r)}`; notes.push(line); console.log(line); }
    before[h.label] = { ...await snapshotCounts(admin, h.userId), ...await countExtra(h.userId) };
  }

  // 3 · one env per probe host (the engine's live wiring; the session is the probe's own RLS session).
  const envs: TierEnv[] = [];
  for (const h of hosts) {
    const s = await mintProbeSession(admin, h.email);
    if (s.userId !== h.userId) die(`REFUSED: minted session is ${s.userId}, not ${h.userId}`);
    envs.push({ ...await liveMod.buildTierEnv({ tier: h.tier, admin, userId: h.userId, session: s.client, now, stubbed: selfCheck, efforts: liveMod.DEFAULT_EFFORTS }), host: h.label });
  }
  const judge = useJudge ? await liveMod.buildJudge() : null;
  let stopReason: string | null = null;
  let firstSignalAt = 0;
  const onSignal = (sig: string) => {
    // One keypress reaches npx, tsx and node at once (and tsx forwards it): only a signal ≥ 3 s after
    // the first means "exit now" (then run --sweep --apply).
    const t = Date.now();
    if (firstSignalAt && t - firstSignalAt < 3000) return;
    if (firstSignalAt) { console.error(`\n${sig} again — exiting NOW; clean the probe hosts with: npx tsx scripts/eval-surfaces.ts --sweep --apply`); process.exit(130); }
    firstSignalAt = t;
    stopReason = `${sig} received`;
    console.error(`\n${sig}: no new units; in-flight units finish and tear down, then the report is written. Again (≥ 3 s later) to exit now.`);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  // Per-unit budget reservation: the estimate's share of its surface × tier row.
  const perUnit = new Map(est.rows.map((r) => [`${r.tier}|${r.surface}`, r.total / Math.max(1, r.cases * repeat)]));
  const t0 = Date.now();
  let result: EngineResult;
  try {
    result = await runEngine({
      adapters, envs, columns, repeat, maxEur, judge, meter: liveMod.meterPort, price: (c) => priceCalls(c), selectCase, now,
      log: (l) => console.log(l.startsWith('  ') ? `[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]${l}` : l), concurrency, worldLanes: 1, reserve: (a, tier) => (selfCheck ? 0 : perUnit.get(`${tier}|${a.id}`) ?? 0),
      shouldStop: () => stopReason, worldClock: () => new Date(),
    });
  } finally {
    const teamErrs = await removeTeams(admin);
    if (teamErrs.length) notes.push(`⚠ team teardown: ${teamErrs.join('; ')}`);
  }
  const wallS = (Date.now() - t0) / 1000;
  const late = liveMod.lateSpend();
  result.totalCostEur += late.eur + late.orphanEur;
  result.notes.push(...notes);
  result.notes.push(`Probe hosts: ${hosts.map((h) => `${h.label} ${h.userId.slice(0, 8)}`).join(' · ')} (${Object.keys(probeHostSpec).length ? 'named with --probe-host' : 'account #1 of each tier only'}). Worlds seeded per unit with fresh ids and torn down; the coworker team was seeded through lib/workers/seed.ts ensureWorkers and removed after the run.`);
  result.notes.push(`Plain columns: "You are a helpful assistant." + the same request, preceded by the neutral rendering of the same records (scripts/lib/eval/engine/neutral.ts); hand-offs drop only the routing preface ("Ask Max to"); workflow steps add the same upstream outputs and declared format line. Efforts: same = the producer's own (param floor) · sonnet55/gpt56 = medium.`);
  result.notes.push(`Background calls billed after their run: ${late.calls} (€${late.eur.toFixed(4)}); calls outside any run: ${late.orphans} (€${late.orphanEur.toFixed(4)}). Wall ${wallS.toFixed(0)} s, concurrency ${concurrency} (peak ${result.concurrency?.peakUnits ?? '?'}).`);
  if (blocked.length) result.notes.push(`**PROBE FENCE refused ${blocked.length} write(s)**: ${[...new Set(blocked)].join('; ')}`);

  // 4 · symmetry: post-run sweep + row counts equal to before.
  const residue: string[] = [];
  for (const h of hosts) {
    try {
      const r = await sweepProbe(admin, h.userId, { apply: true, fixture });
      if (r.total || r.errors.length) residue.push(`${h.label} post-run sweep: ${describeSweep(r)}`);
    } catch (e) { residue.push(`${h.label} post-run sweep failed: ${(e as Error).message}`); }
    try {
      const after = await retry(async () => ({ ...await snapshotCounts(admin, h.userId), ...await countExtra(h.userId) }));
      residue.push(...diffCounts(before[h.label], after).map((d) => `${h.label}: ${d}`));
    } catch (e) { residue.push(`${h.label}: post-run snapshot failed — ${(e as Error).message}`); }
  }
  if (residue.length) result.notes.push(`⚠ probe residue after the run: ${residue.join('; ')}`);

  const rows = scenarioRows(result);
  const means = surfaceMeans(rows, columns);
  const head = [
    `# W28 — every writing surface vs plain models (${quick ? 'QUICK' : selfCheck ? 'SELF-CHECK — stubbed model, zero AI' : 'FULL'})`, '',
    `This run's metered spend: **€${result.totalCostEur.toFixed(4)}** of €${maxEur} · repeat ${repeat} · tiers ${tiers.join('+')} · judge ${result.judgeModel ?? 'off'}`, '',
    '## Per surface (mean judge score 1–5)', '',
    `| surface | tier | ${columns.join(' | ')} | scenario×column pairs below |`, `|---|---|${columns.map(() => '---:').join('|')}|---:|`,
    ...means.map((m) => `| ${m.surface} | ${m.tier} | ${columns.map((c) => (m.means[c] == null ? '–' : m.means[c]!.toFixed(2))).join(' | ')} | ${m.below} |`),
    '', '## Per scenario — AUGMTD ≥ column?', '', renderScenarioTable(rows, columns), '', '---', '',
  ].join('\n');
  const md = outPath(`w28-surfaces-${quick ? 'quick' : selfCheck ? 'selfcheck' : 'full'}-${stamp}.md`);
  writeFileSync(md, head + renderEngineReport(result, adapters, { title: 'Engine report (W26 engine, W28 surfaces)' }));
  writeFileSync(md.replace(/\.md$/, '.json'), serialize(result));
  console.log(`\n${head.split('## Per scenario')[0]}`);
  console.log(renderScenarioTable(rows, columns));
  console.log(`\nreport → ${md}\nTHIS RUN metered cost: €${result.totalCostEur.toFixed(4)}${result.budgetHit ? ' (BUDGET HIT — later units skipped)' : ''} · wall ${wallS.toFixed(0)} s`);
  if (residue.length) { console.log(`⚠ residue: ${residue.join('; ')}`); process.exitCode = 1; }
  if (selfCheck) {
    const all = result.surfaces.flatMap((s) => s.cases.flatMap((c) => Object.values(c.runs).flat()));
    const runs = all.filter((r) => r && !r.skipped);
    const errs = [...runs.filter((r) => r?.out.error), ...all.filter((r) => r?.skipped).map((r) => ({ out: { error: `skipped: ${r!.skipped}` } }))];
    const td = result.surfaces.flatMap((s) => s.teardownErrors);
    if (errs.length || td.length || !runs.length) {
      console.log(`✗ SELF-CHECK: ${errs.length} errored run(s)${errs[0] ? ` — ${errs[0].out.error}` : ''}${td.length ? ` · teardown: ${td.join('; ')}` : ''}`);
      process.exitCode = 1;
    } else console.log(`✓ self-check: ${runs.length} column run(s) across ${result.surfaces.length} surface×tier — seed → real producer (stubbed model) → plain columns → judge → teardown, symmetric, zero AI.`);
  }
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
