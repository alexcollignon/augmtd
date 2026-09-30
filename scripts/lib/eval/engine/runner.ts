// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE RUNNER. One scheduler for every surface: units of (tier × adapter × case × repeat), each
// running its columns → seed a FRESH world → the REAL producer (AUGMTD) / the neutral prompt (plain
// columns) → parse → score (labelled truth or the blind judge) + deterministic checks → teardown.
// Units run through a bounded pool (--concurrency), seeded worlds through a per-probe-host lane,
// model calls through per-provider caps (the meter's gate). Spend is metered per unit and a hard
// budget stop (with in-flight reservations) skips — never half-runs — whatever would exceed it.
// Every finished column run is handed to `onRun` (the journal) so a stopped run resumes.
// Pure orchestration: the DB, the model clients, the judge and the meter are INJECTED (TierEnv,
// PlainSystem, JudgePort, MeterPort), so the unit tests drive it end to end with fakes, and the CLI
// wires the real ones. Plain columns other than `same` are tier-independent: on --tier both they run
// once and are reused for the second tier (marked `reusedFrom`).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { MeterCall } from '../meter';
import { describeSignals } from '../home-chat-harness';
import { buildRubricPrompt, parseRubric, RETRY_NUDGE } from './judge';
import { scoreCase } from './metrics';
import { PRODUCER_EFFORT, effortFamily, isEffortProducer } from '../../../../lib/ai/effort';
import type { Priced } from './pricing';
import type {
  AnyAdapter, ColumnId, ColumnOutput, ColumnRun, EvalCase, RunCtx, Tier, CheckOutcome, RubricVerdict, SeededWorld, World,
} from './types';
import { localDate, type WorldCtx } from './world';
import { isFinished, unitKey, type RunRecord } from './journal';

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
export const PLAIN_SYSTEM_PROMPT = 'You are a helpful assistant.';
/** Plain columns whose model does not depend on the tier (reused across tiers). */
export const TIER_FREE: ColumnId[] = ['sonnet55', 'gpt56'];

export interface MeterPort { run<T>(fn: () => Promise<T>): Promise<{ result: T; calls: MeterCall[] }> }
export interface PlainSystem { column: ColumnId; label: string; model: string; effort: string | null; call(messages: ChatMsg[]): Promise<string> }
export interface JudgePort { model: string; call(system: string, user: string, nudge: boolean): Promise<string> }

export interface TierEnv {
  tier: Tier;
  /** THE PROBE POOL: this env's account label (e.g. `std#2`). Several envs may share a tier — the first
   *  of a tier is its PRIMARY (skeletons, plain columns, conversation adapters); every env of the tier
   *  hosts AUGMTD worlds (one lease per world, `worldLanes` per account). */
  host?: string;
  ctx: WorldCtx & { stubbed: boolean };
  plainFor(column: Exclude<ColumnId, 'augmtd'>, adapter: AnyAdapter): Promise<PlainSystem>;
  augmtdModel(adapter: AnyAdapter): Promise<string>;
  seed(ctx: RunCtx, world: World): Promise<SeededWorld>;
  teardown(ctx: RunCtx, s: SeededWorld): Promise<{ errors: string[] }>;
  /** W27.C — called after a world is seeded (`seeded`) and after it is torn down (null), whichever seed
   *  path ran: the live env scopes per-user process memos (the user's timezone) to the world. */
  worldScope?(ctx: RunCtx, seeded: SeededWorld | null): void;
}

export type ColumnMeta = { id: ColumnId; label: string; model: string; effort: string | null };

export type CaseResult = {
  caseId: string; group: string; title: string; canary?: boolean;
  truth: Record<string, unknown>;
  runs: Partial<Record<ColumnId, ColumnRun[]>>;
  /** Conversation family: the judge's ground-truth snapshot. */
  groundTruth?: string | null;
};

export type SurfaceResult = {
  surface: string; tier: Tier; family: string; title: string; scoring: 'labelled' | 'judged';
  columns: ColumnMeta[];
  cases: CaseResult[];
  /** Teardown problems (a residue is a failure of the harness, never of the product). */
  teardownErrors: string[];
};

export type EngineResult = {
  version: 1;
  startedAt: string;
  finishedAt: string;
  now: string;
  repeat: number;
  judgeModel: string | null;
  totalCostEur: number;
  budgetEur: number;
  budgetHit: boolean;
  stubbed: boolean;
  surfaces: SurfaceResult[];
  notes: string[];
  /** Spend of THIS invocation (totalCostEur also carries the resumed runs' spend). */
  spentThisRunEur?: number;
  /** Spend of the finished runs a --resume kept. */
  priorCostEur?: number;
  resumedRuns?: number;
  /** W27.C — the clocks this invocation ran on (see RunPlan.worldClock). */
  clock?: { run: string; wallStart: string; worldClock: 'wall' | 'run'; maxSkewMs: number; dayDrift: string[] };
  /** W27.C — the eval-only effort override the AUGMTD column ran under (slot → effort); absent = the product's own. */
  effortOverride?: Partial<Record<string, string>>;
  /** Why scheduling stopped early (a signal), or null. Units not started are left for --resume. */
  stopped?: string | null;
  pendingUnits?: number;
  concurrency?: {
    units: number; worldLanes: number; /** most units that were in flight at once */ peakUnits?: number;
    /** THE PROBE POOL: per account — AUGMTD runs it hosted and the most worlds it held at once. */
    hosts?: Record<string, { tier: Tier; runs: number; peakWorlds: number }>;
  };
};

const emptyOut = (error?: string): ColumnOutput => ({
  text: '', value: null, latencyMs: 0, promptTokens: 0, completionTokens: 0, costEur: 0, calls: 0, unmeteredCalls: 0, models: [], ...(error ? { error } : {}),
});

function fromPriced(p: Priced, latencyMs: number): Omit<ColumnOutput, 'text' | 'value'> {
  return { latencyMs, promptTokens: p.promptTokens, completionTokens: p.completionTokens, costEur: p.costEur, calls: p.calls, unmeteredCalls: p.unmetered, models: p.models, ...(p.reasoningTokens ? { reasoningTokens: p.reasoningTokens } : {}), ...(p.efforts?.length ? { efforts: p.efforts } : {}) };
}

export type RunPlan = {
  adapters: AnyAdapter[];
  envs: TierEnv[];
  columns: ColumnId[];
  repeat: number;
  maxEur: number;
  judge: JudgePort | null;
  meter: MeterPort;
  price: (calls: MeterCall[]) => Priced;
  /** Which cases run (default: non-canary cases). */
  selectCase?: (a: AnyAdapter, c: EvalCase) => boolean;
  now: Date;
  log?: (line: string) => void;
  /** Units — one (tier, surface, case, repeat) — in flight at once (default 1 = the sequential order). */
  concurrency?: number;
  /** Seeded worlds alive at once PER PROBE ACCOUNT (default 1). See THE WORLD LANE below. */
  worldLanes?: number;
  /** The budget reservation (€) for one unit before it starts — the pre-run estimate's per-unit share.
   *  The runner reserves max(this, the costliest finished unit of the surface × tier). */
  reserve?: (a: AnyAdapter, tier: Tier, c: EvalCase, columns: ColumnId[]) => number;
  /** --resume: runs already finished (journal records); their units are skipped. */
  prior?: RunRecord[];
  /** Called the moment a column run is final (the journal appends it). Never for reused copies. */
  onRun?: (r: RunRecord) => void;
  /** Polled before every unit is scheduled: true = schedule nothing more (in-flight units finish). */
  shouldStop?: () => string | null;
  /** W27.C — THE TWO CLOCKS. `now` is the RUN CLOCK: truths, plain prompts and the report resolve
   *  against it (a --resume keeps it, so every unit of one result is judged against the same days).
   *  `worldClock` is the WALL CLOCK an AUGMTD world is seeded on and its producer is handed: the
   *  product reads the real clock (Date.now()) inside its prompts, so a world seeded on a stale run clock
   *  (a resume hours later, or the tail of a long run) would age every message by the gap. Default: the
   *  run clock (tests, fakes). A unit whose wall-clock DAY differs from the run clock's day (in its
   *  world's zone) is counted in `result.clock.dayDrift` — its date truths may disagree with the product. */
  worldClock?: () => Date;
  /** W27.C — the eval-only effort override in force for the AUGMTD column (slot → effort), recorded
   *  in the column meta and the result header. The producers read it from AI_EFFORT_OVERRIDE. */
  effortOverride?: Partial<Record<string, string>>;
};

const skippedRun = (col: ColumnId, rep: number, why: string): ColumnRun => ({ column: col, repeat: rep, out: emptyOut(), checks: [], score: null, skipped: why });
const runCost = (r: ColumnRun) => r.out.costEur + (r.verdict?.costEur ?? 0);

type SurfaceSlot = { sr: SurfaceResult; plain: Map<ColumnId, PlainSystem>; cases: Map<string, CaseResult> };
type Unit = { env: TierEnv; first: boolean; adapter: AnyAdapter; c: EvalCase; rep: number; slot: SurfaceSlot; cr: CaseResult; run: ColumnId[]; reuse: ColumnId[] };
type Deferred = { promise: Promise<ColumnRun | null>; resolve: (r: ColumnRun | null) => void };
const deferred = (): Deferred => { let resolve!: (r: ColumnRun | null) => void; const promise = new Promise<ColumnRun | null>((r) => { resolve = r; }); return { promise, resolve }; };

/**
 * THE SCHEDULER. Units are queued case-major with the tiers interleaved (standard r1, eu r1, standard
 * r2, …) so both probe hosts stay busy, and run through a bounded pool (`concurrency`). Inside a unit
 * the columns run in parallel; the AUGMTD column keeps its order seed → produce → teardown.
 *
 * THE WORLD LANE: at most `worldLanes` seeded worlds live on one probe host at a time (default 1).
 * Producers read user-wide state (sent mail as voice samples and fulfilment evidence, the KB, person
 * state, the working circle), so two worlds alive on one host would see each other's records and the
 * AUGMTD column would no longer measure the world its case declares. Plain columns and the judge touch
 * no probe row, so they run fully concurrent — that is where the wall time goes (reasoning columns and
 * the Opus judge). Raising the lane is allowed (teardown deletes exactly its own rows either way) but
 * trades measurement isolation for speed; the report states the lane width.
 * THE PROBE POOL keeps the isolation AND the speed: N identical accounts per tier (several envs of one
 * tier), each holding at most `worldLanes` worlds; an AUGMTD run leases the least-loaded free account
 * of its tier (HostPool), seeds, produces, tears down, releases. The run records its host (`run.host`).
 *
 * THE BUDGET (hard stop): a unit starts only when spent + the reservations of in-flight units + its own
 * reservation stay within maxEur; otherwise it — and every later unit — is marked skipped (never
 * half-run). Spend is attributed per unit through the meter's async context, so concurrency never
 * mixes two units' calls.
 */
export async function runEngine(plan: RunPlan): Promise<EngineResult> {
  const log = plan.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const select = plan.selectCase ?? ((_a, c) => !c.canary);
  const concurrency = Math.max(1, Math.floor(plan.concurrency ?? 1));
  const worldLanes = Math.max(1, Math.floor(plan.worldLanes ?? 1));
  // THE PROBE POOL: the first env of a tier is its primary; every env of the tier is a world host.
  const primaries = plan.envs.filter((e, i) => plan.envs.findIndex((x) => x.tier === e.tier) === i);
  const hostLabel = (e: TierEnv) => e.host ?? `${e.tier}:${e.ctx.userId.slice(0, 8)}`;
  const pools = new Map<Tier, HostPool>();
  for (const p of primaries) pools.set(p.tier, new HostPool(plan.envs.filter((e) => e.tier === p.tier), worldLanes));
  const hostStats: Record<string, { tier: Tier; runs: number; peakWorlds: number }> = {};
  for (const e of plan.envs) hostStats[hostLabel(e)] = { tier: e.tier, runs: 0, peakWorlds: 0 };
  const priorByKey = new Map<string, ColumnRun>();
  for (const r of plan.prior ?? []) if (isFinished(r.run) && r.repeat < plan.repeat) priorByKey.set(unitKey(r), r.run);

  // 1 · skeletons, in the report's order (tier-major), so completion order never reorders a result.
  const surfaces: SurfaceResult[] = [];
  const slots = new Map<string, SurfaceSlot>(); // `${tier}|${surface}`
  for (const env of primaries) {
    for (const adapter of plan.adapters) {
      if (!adapter.tiers.includes(env.tier)) { log(`· ${adapter.id} [${env.tier}] skipped: adapter does not run on this tier`); continue; }
      const cases = adapter.cases().filter((c) => select(adapter, c as EvalCase)) as EvalCase[];
      if (!cases.length) { log(`· ${adapter.id} [${env.tier}]: no cases selected`); continue; }
      const columns: ColumnMeta[] = [];
      const plain = new Map<ColumnId, PlainSystem>();
      for (const col of plan.columns) {
        if (col === 'augmtd') {
          // W28 · a producer key override wins over a slot override (the producer's call names its key).
          // A producer whose own config resolves an effort is not reached by a SLOT override (effort.ts).
          const key = adapter.producer.effortKey;
          const model = await env.augmtdModel(adapter);
          const own = isEffortProducer(key) ? PRODUCER_EFFORT[key]?.[effortFamily(model)] : undefined;
          const overKey = key && plan.effortOverride?.[key] ? key : own ? null : adapter.producer.slot;
          const over = overKey ? plan.effortOverride?.[overKey] : undefined;
          columns.push({ id: 'augmtd', label: `AUGMTD — ${adapter.producer.fn}${over ? ` (effort override ${overKey}=${over})` : own ? ` (producer effort ${key}=${own})` : ''}`, model, effort: over ?? own ?? adapter.producer.effort ?? null });
          continue;
        }
        const sys = await env.plainFor(col, adapter);
        plain.set(col, sys);
        columns.push({ id: col, label: sys.label, model: sys.model, effort: sys.effort });
      }
      const sr: SurfaceResult = { surface: adapter.id, tier: env.tier, family: adapter.family, title: adapter.title, scoring: adapter.scoring.kind, columns, cases: [], teardownErrors: [] };
      const slot: SurfaceSlot = { sr, plain, cases: new Map() };
      for (const c of cases) {
        const cr: CaseResult = { caseId: c.id, group: c.group, title: c.title, ...(c.canary ? { canary: true } : {}), truth: adapter.resolveTruth ? adapter.resolveTruth(c, plan.now) : c.truth, runs: {} };
        sr.cases.push(cr);
        slot.cases.set(c.id, cr);
      }
      surfaces.push(sr);
      slots.set(`${env.tier}|${adapter.id}`, slot);
      log(`\n▶ ${adapter.id} [${env.tier}] · ${cases.length} case(s) × ${plan.repeat} · ${columns.map((c) => `${c.id}=${c.model}`).join(' · ')}`);
    }
  }

  // 2 · prefill finished runs (resume); build the queue of units with work left.
  let priorCost = 0;
  const place = (cr: CaseResult, col: ColumnId, rep: number, run: ColumnRun) => { (cr.runs[col] ??= [])[rep] = run; };
  const first = primaries[0];
  const tierFree = new Map<string, Deferred>(); // `${surface}|${case}|${col}|${rep}` → the first tier's run
  const units: Unit[] = [];
  for (const adapter of plan.adapters) {
    const cases = adapter.cases().filter((c) => select(adapter, c as EvalCase)) as EvalCase[];
    for (const c of cases) for (let rep = 0; rep < plan.repeat; rep++) for (const env of primaries) {
      const slot = slots.get(`${env.tier}|${adapter.id}`);
      if (!slot) continue;
      const cr = slot.cases.get(c.id)!;
      const isFirst = env === first;
      const run: ColumnId[] = [], reuse: ColumnId[] = [];
      for (const col of plan.columns) {
        const done = priorByKey.get(unitKey({ surface: adapter.id, tier: env.tier, caseId: c.id, repeat: rep, column: col }));
        const tfKey = `${adapter.id}|${c.id}|${col}|${rep}`;
        if (done) {
          place(cr, col, rep, { ...done, repeat: rep });
          priorCost += runCost(done);
          if (isFirst && TIER_FREE.includes(col)) { const d = deferred(); d.resolve(done); tierFree.set(tfKey, d); }
          continue;
        }
        if (TIER_FREE.includes(col) && !isFirst && tierFree.has(tfKey)) { reuse.push(col); continue; }
        if (isFirst && TIER_FREE.includes(col)) tierFree.set(tfKey, deferred());
        run.push(col);
      }
      if (run.length || reuse.length) units.push({ env, first: isFirst, adapter, c, rep, slot, cr, run, reuse });
    }
  }
  const resumed = priorByKey.size;
  if (resumed) log(`\n↻ resume: ${[...priorByKey.keys()].length} finished column run(s) kept (€${priorCost.toFixed(4)} already spent); ${units.length} unit(s) left`);

  // 3 · the pool.
  let spent = 0, reserved = 0, budgetHit = false, stopped: string | null = null, pending = 0, peakUnits = 0;
  const wallStart = new Date().toISOString();
  let maxSkewMs = 0;
  const dayDrift: string[] = [];
  const observedMax = new Map<string, number>(); // `${tier}|${surface}` → costliest finished unit
  const groundTruths = new Map<string, Promise<string | null>>();

  const resolveTierFree = (u: Unit, col: ColumnId, run: ColumnRun | null) => {
    if (u.first && TIER_FREE.includes(col)) tierFree.get(`${u.adapter.id}|${u.c.id}|${col}|${u.rep}`)?.resolve(run);
  };

  async function runColumn(u: Unit, col: ColumnId): Promise<number> {
    let tag = `${u.c.id} · ${col} · r${u.rep + 1}/${plan.repeat}${primaries.length > 1 ? ` · ${u.env.tier}` : ''}`;
    let run: ColumnRun | null = null;
    try {
      if (col === 'augmtd') {
        // Lease a free account of the tier (a conversation adapter reads the primary's standing state:
        // pinned to it). The world lives only while the lease is held.
        const pool = pools.get(u.env.tier)!;
        const host = await pool.acquire(u.adapter.family === 'conversation' ? u.env : null);
        const label = hostLabel(host);
        hostStats[label].runs++;
        hostStats[label].peakWorlds = Math.max(hostStats[label].peakWorlds, pool.load(host));
        try {
          // THE WALL CLOCK for the world + producer; the run clock stays the truths' (RunPlan.worldClock).
          const worldNow = plan.worldClock ? plan.worldClock() : plan.now;
          const skew = worldNow.getTime() - plan.now.getTime();
          maxSkewMs = Math.max(maxSkewMs, Math.abs(skew));
          const tz = u.c.world.tz ?? 'UTC';
          if (localDate(worldNow, tz) !== localDate(plan.now, tz)) dayDrift.push(`${u.adapter.id}/${u.c.id} r${u.rep + 1} (${localDate(plan.now, tz)} → ${localDate(worldNow, tz)} ${tz})`);
          const ctx: RunCtx = { ...host.ctx, now: worldNow, tier: u.env.tier, repeat: u.rep };
          run = await runAugmtd(plan, host, u.adapter, u.c, ctx, u.slot.sr);
        } finally { pool.release(host); }
        run.host = label;
        if (pool.size > 1) tag += ` @${label}`;
      } else {
        run = await runPlain(plan, u.slot.plain.get(col)!, u.adapter, u.c);
      }
      run.repeat = u.rep;
      const gtKey = `${u.env.tier}|${u.adapter.id}|${u.c.id}`;
      if (u.adapter.conversation?.groundTruth && !groundTruths.has(gtKey)) {
        groundTruths.set(gtKey, u.adapter.conversation.groundTruth({ ...u.env.ctx, tier: u.env.tier, repeat: 0 }).catch(() => null));
      }
      const gt = groundTruths.has(gtKey) ? await groundTruths.get(gtKey)! : null;
      if (gt != null) u.cr.groundTruth = gt;
      await scoreRun(plan, u.adapter, u.c, run, gt);
    } catch (e) {
      // The engine's own fault (a scorer threw): recorded on the run, never a crashed pool.
      run = { column: col, repeat: u.rep, out: emptyOut(`engine: ${(e as Error).message}`), checks: [], score: null };
    } finally {
      resolveTierFree(u, col, run);
    }
    place(u.cr, col, u.rep, run);
    plan.onRun?.({ surface: u.adapter.id, tier: u.env.tier, caseId: u.c.id, repeat: u.rep, column: col, run });
    log(`  ${tag}: ${run.out.error ? `ERROR ${run.out.error}` : `${run.score == null ? 'unscored' : run.score.toFixed(2)} · ${run.out.calls} call(s) · €${run.out.costEur.toFixed(4)}${run.out.withheld ? ' · withheld' : ''}`}`);
    return runCost(run);
  }

  async function reuseColumn(u: Unit, col: ColumnId): Promise<void> {
    const prior = await tierFree.get(`${u.adapter.id}|${u.c.id}|${col}|${u.rep}`)!.promise;
    if (prior) place(u.cr, col, u.rep, { ...prior, repeat: u.rep, reusedFrom: first.tier });
  }

  async function runUnit(u: Unit): Promise<number> {
    const costs = await Promise.all([...u.run.map((col) => runColumn(u, col)), ...u.reuse.map((col) => reuseColumn(u, col).then(() => 0))]);
    return costs.reduce((a, b) => a + b, 0);
  }

  const skipUnit = (u: Unit, why: string) => {
    for (const col of [...u.run, ...u.reuse]) {
      const r = skippedRun(col, u.rep, why);
      place(u.cr, col, u.rep, r);
      resolveTierFree(u, col, r);
    }
    log(`  ${u.c.id} · r${u.rep + 1}/${plan.repeat} · ${u.env.tier}: SKIPPED (${why})`);
  };

  const inflight = new Set<Promise<void>>();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!stopped) stopped = plan.shouldStop?.() ?? null;
    if (stopped) {
      // Not started: left for --resume (no skip marker); a tier-free source that will not run releases its waiters.
      pending++;
      for (const col of u.run) resolveTierFree(u, col, null);
      continue;
    }
    while (inflight.size >= concurrency) await Promise.race(inflight);
    if (!stopped) stopped = plan.shouldStop?.() ?? null;
    if (stopped) { pending++; for (const col of u.run) resolveTierFree(u, col, null); continue; }
    const key = `${u.env.tier}|${u.adapter.id}`;
    const need = Math.max(plan.reserve?.(u.adapter, u.env.tier, u.c, u.run) ?? 0, observedMax.get(key) ?? 0);
    if (budgetHit || spent + reserved + need > plan.maxEur + 1e-12 || spent >= plan.maxEur) {
      budgetHit = true;
      skipUnit(u, `budget €${plan.maxEur.toFixed(2)} reached`);
      continue;
    }
    reserved += need;
    const p: Promise<void> = runUnit(u).then((cost) => {
      spent += cost;
      observedMax.set(key, Math.max(observedMax.get(key) ?? 0, cost));
    }).finally(() => { reserved -= need; inflight.delete(p); });
    inflight.add(p);
    peakUnits = Math.max(peakUnits, inflight.size);
  }
  await Promise.all(inflight);

  // 4 · compact (sparse repeat slots → dense arrays, in repeat order).
  for (const sr of surfaces) for (const cr of sr.cases) {
    for (const col of Object.keys(cr.runs) as ColumnId[]) {
      const dense = (cr.runs[col] ?? []).filter(Boolean);
      if (dense.length) cr.runs[col] = dense; else delete cr.runs[col];
    }
  }
  return {
    version: 1, startedAt, finishedAt: new Date().toISOString(), now: plan.now.toISOString(), repeat: plan.repeat,
    judgeModel: plan.judge?.model ?? null, totalCostEur: spent + priorCost, budgetEur: plan.maxEur, budgetHit,
    stubbed: plan.envs.some((e) => e.ctx.stubbed), surfaces, notes: [],
    clock: { run: plan.now.toISOString(), wallStart, worldClock: plan.worldClock ? 'wall' : 'run', maxSkewMs, dayDrift },
    ...(plan.effortOverride && Object.keys(plan.effortOverride).length ? { effortOverride: plan.effortOverride } : {}),
    spentThisRunEur: spent, priorCostEur: priorCost, resumedRuns: resumed,
    stopped, pendingUnits: pending, concurrency: { units: concurrency, worldLanes, peakUnits, hosts: hostStats },
  };
}

/**
 * THE HOST POOL of one tier: each account holds at most `lanes` live worlds; `acquire` hands out the
 * least-loaded account with a free lane (or the pinned one), FIFO among waiters. Pure (no network).
 */
export class HostPool {
  private loads = new Map<TierEnv, number>();
  private waiters: Array<{ pin: TierEnv | null; grant: (e: TierEnv) => void }> = [];
  constructor(readonly hosts: TierEnv[], readonly lanes: number) {
    if (!hosts.length) throw new Error('HostPool: no host');
    for (const h of hosts) this.loads.set(h, 0);
  }
  get size(): number { return this.hosts.length; }
  load(h: TierEnv): number { return this.loads.get(h) ?? 0; }
  private free(pin: TierEnv | null): TierEnv | null {
    if (pin) return this.load(pin) < this.lanes ? pin : null;
    let best: TierEnv | null = null;
    for (const h of this.hosts) if (this.load(h) < this.lanes && (!best || this.load(h) < this.load(best))) best = h;
    return best;
  }
  acquire(pin: TierEnv | null = null): Promise<TierEnv> {
    // Every queued waiter is unsatisfiable right now (release grants all that fit), so a free fit is ours.
    const h = this.free(pin);
    if (h) { this.loads.set(h, this.load(h) + 1); return Promise.resolve(h); }
    return new Promise((grant) => this.waiters.push({ pin, grant }));
  }
  release(h: TierEnv): void {
    this.loads.set(h, Math.max(0, this.load(h) - 1));
    // Grant, in order, every waiter that now fits (a pinned waiter never blocks an unpinned one behind it).
    for (let i = 0; i < this.waiters.length; ) {
      const w = this.waiters[i];
      const f = this.free(w.pin);
      if (!f) { i++; continue; }
      this.waiters.splice(i, 1);
      this.loads.set(f, this.load(f) + 1);
      w.grant(f);
    }
  }
}

async function runAugmtd(plan: RunPlan, env: TierEnv, adapter: AnyAdapter, c: EvalCase, ctx: RunCtx, sr: SurfaceResult): Promise<ColumnRun> {
  const t0 = Date.now();
  let seeded: SeededWorld | null = null;
  try {
    const { result, calls } = await plan.meter.run(async () => {
      seeded = adapter.seed ? await adapter.seed(ctx, c) : await env.seed(ctx, c.world);
      env.worldScope?.(ctx, seeded);
      return adapter.produce(ctx, c, seeded);
    });
    const p = plan.price(calls);
    const out: ColumnOutput = {
      text: result.text, value: result.value, ...(result.withheld ? { withheld: true } : {}),
      ...(result.turns ? { turns: result.turns } : {}), ...(result.signals ? { signals: result.signals } : {}),
      ...fromPriced(p, Date.now() - t0),
    };
    return { column: 'augmtd', repeat: 0, out, checks: [], score: null };
  } catch (e) {
    return { column: 'augmtd', repeat: 0, out: { ...emptyOut(`${(e as Error).message}`), latencyMs: Date.now() - t0 }, checks: [], score: null };
  } finally {
    if (seeded) {
      const td = adapter.teardown ? await adapter.teardown(ctx, seeded).then(() => ({ errors: [] as string[] }), (e) => ({ errors: [String((e as Error).message)] }))
        : await env.teardown(ctx, seeded).catch((e) => ({ errors: [String((e as Error).message)] }));
      sr.teardownErrors.push(...td.errors.map((x) => `${c.id}: ${x}`));
      env.worldScope?.(ctx, null);
    }
  }
}

/** A plain column's latency = its calls' own time (a wait at a provider cap is not the model's
 *  latency); wall time when the meter reported no call timing (fakes). */
const ownMs = (calls: MeterCall[], t0: number) => (calls.length && calls.some((c) => c.ms > 0) ? calls.reduce((a, c) => a + c.ms, 0) : Date.now() - t0);

async function runPlain(plan: RunPlan, sys: PlainSystem, adapter: AnyAdapter, c: EvalCase): Promise<ColumnRun> {
  const t0 = Date.now();
  try {
    if (adapter.family === 'conversation' && adapter.conversation) {
      const turns = adapter.conversation.plainTurns(c);
      const msgs: ChatMsg[] = [{ role: 'system', content: PLAIN_SYSTEM_PROMPT }];
      const texts: string[] = [];
      const allCalls: MeterCall[] = [];
      for (const t of turns) {
        msgs.push({ role: 'user', content: t });
        const { result, calls } = await plan.meter.run(() => sys.call([...msgs]));
        allCalls.push(...calls);
        texts.push(result);
        msgs.push({ role: 'assistant', content: result });
      }
      const p = plan.price(allCalls);
      return { column: sys.column, repeat: 0, out: { text: texts[texts.length - 1] ?? '', turns: texts, value: null, ...fromPriced(p, ownMs(allCalls, t0)) }, checks: [], score: null };
    }
    const prompt = adapter.plainPrompt(c, plan.now);
    const { result, calls } = await plan.meter.run(() => sys.call([{ role: 'system', content: PLAIN_SYSTEM_PROMPT }, { role: 'user', content: prompt.user }]));
    const p = plan.price(calls);
    const value = adapter.scoring.kind === 'labelled' ? adapter.parse(result, c) : { text: result };
    return { column: sys.column, repeat: 0, out: { text: result, value, ...fromPriced(p, ownMs(calls, t0)) }, checks: [], score: null };
  } catch (e) {
    return { column: sys.column, repeat: 0, out: { ...emptyOut((e as Error).message), latencyMs: Date.now() - t0 }, checks: [], score: null };
  }
}

/** Deterministic checks (every column) — pure, reused by --recheck. */
export function runChecksFor(adapter: AnyAdapter, c: EvalCase, run: ColumnRun): CheckOutcome[] {
  const res: CheckOutcome[] = [];
  if (run.skipped) return res;
  for (const ch of adapter.checks ?? []) {
    if (ch.appliesTo && !ch.appliesTo.includes(run.column)) continue;
    if (run.out.error) { res.push({ name: ch.name, pass: false, detail: `run errored: ${run.out.error}` }); continue; }
    try {
      const r = ch.run({ column: run.column, out: run.out, kase: c });
      res.push(typeof r === 'boolean' ? { name: ch.name, pass: r } : { name: ch.name, ...r });
    } catch (e) { res.push({ name: ch.name, pass: false, detail: `check threw: ${(e as Error).message}` }); }
  }
  if (adapter.conversation?.runChecks) res.push(...adapter.conversation.runChecks(c, run.column, run.out));
  return res;
}

/** Labelled score (pure) — reused by --recheck. */
export function labelScoreFor(adapter: AnyAdapter, c: EvalCase, run: ColumnRun, now: Date): void {
  if (adapter.scoring.kind !== 'labelled' || run.skipped) return;
  const truth = adapter.resolveTruth ? adapter.resolveTruth(c, now) : c.truth;
  if (run.out.error) { run.label = scoreCase(adapter.scoring, null, truth, false); run.score = run.label.score; return; }
  run.label = scoreCase(adapter.scoring, run.out.value, truth, !!run.out.withheld);
  run.score = run.label.score;
}

async function scoreRun(plan: RunPlan, adapter: AnyAdapter, c: EvalCase, run: ColumnRun, groundTruth: string | null): Promise<void> {
  run.checks = runChecksFor(adapter, c, run);
  if (adapter.scoring.kind === 'labelled') { labelScoreFor(adapter, c, run, plan.now); return; }
  if (!plan.judge || run.out.error) return;
  const dims = adapter.scoring.dims.map((d) => d.id);
  let prompt: { system: string; user: string };
  let parse: (raw: string) => Pick<RubricVerdict, 'scores' | 'notes' | 'failures' | 'hardFails'> & { error?: string };
  if (adapter.family === 'conversation' && adapter.conversation) {
    const userTurns = adapter.conversation.plainTurns(c);
    const texts = run.out.turns ?? [run.out.text];
    const transcript = userTurns.flatMap((u, i) => (texts[i] != null ? [{ role: 'user' as const, text: u }, { role: 'assistant' as const, text: texts[i] }] : []));
    const notes = (run.out.signals ?? texts.map(() => ({ cards: [], sideEffects: [] }))).map((s) => describeSignals(s));
    prompt = adapter.conversation.judgePrompt ? adapter.conversation.judgePrompt(c, transcript, notes, groundTruth)
      : buildRubricPrompt({ title: c.title, task: userTurns.join('\n'), truthSheet: c.truthSheet ?? '', dims: adapter.scoring.dims, answer: transcript.map((t) => `${t.role.toUpperCase()}: ${t.text}`).join('\n\n') });
    parse = adapter.conversation.parseVerdict ?? ((raw) => parseRubric(raw, dims));
  } else {
    prompt = buildRubricPrompt({
      title: c.title, task: String(c.params?.task ?? adapter.title), truthSheet: c.truthSheet ?? '(none)', dims: adapter.scoring.dims,
      hardConditions: [...(adapter.scoring.hardConditions ?? []), ...(c.hardConditions ?? [])],
      answer: run.out.withheld ? '(no output — the system chose to serve nothing here)' : run.out.text,
    });
    parse = (raw) => parseRubric(raw, dims);
  }
  let verdict: RubricVerdict = { scores: {}, notes: '', failures: [], costEur: 0, promptTokens: 0, completionTokens: 0, error: 'not run' };
  let cost = 0, pIn = 0, pOut = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { result, calls } = await plan.meter.run(() => plan.judge!.call(prompt.system, prompt.user, attempt > 0));
      const p = plan.price(calls);
      cost += p.costEur; pIn += p.promptTokens; pOut += p.completionTokens;
      const parsed = parse(result);
      verdict = { ...parsed, scores: parsed.scores as Record<string, number | null>, costEur: cost, promptTokens: pIn, completionTokens: pOut };
    } catch (e) {
      verdict = { scores: {}, notes: '', failures: [], costEur: cost, promptTokens: pIn, completionTokens: pOut, error: `judge call failed: ${(e as Error).message}` };
    }
    if (!verdict.error) break;
  }
  run.verdict = verdict;
  const applicable = adapter.conversation?.dimsFor?.(c) ?? dims;
  const xs = applicable.map((d) => verdict.scores[d]).filter((x): x is number => typeof x === 'number');
  run.score = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  // A violated HARD condition fails the run outright (the rubric's pass/fail floor).
  if (run.score != null && verdict.hardFails?.length) run.score = 1;
}

export { RETRY_NUDGE };
