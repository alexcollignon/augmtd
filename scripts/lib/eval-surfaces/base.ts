// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 — THE SURFACE ADAPTER BUILDER. Every W28 surface is an engine SurfaceAdapter on the engine's
// conversation lane (see common.ts for why). This builder supplies what they share: the cases
// (+ the QUICK subset), the seed (the engine's fixture world + the coworker team), the teardown (the
// world's rows + every work thread / room turn the unit wrote), the plain turns (neutral rendering),
// the blind judge (surface rubric, reason first) and the structural checks. A surface file writes
// only its cases, its rubric and `produce` — the call into the real producer.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { seedWorld, teardownWorld, type SeededWorld } from '../eval/engine/world';
import { approxTokens } from '../eval/home-chat-harness';
import type { ColumnOutput, EvalCase, RubricDim, RunCtx, SurfaceAdapter } from '../eval/engine/types';
import {
  toEvalCase, plainTurnsFor, surfaceJudgePrompt, parseSurfaceVerdict, runSurfaceChecks, clockNow, type SurfaceCaseSpec,
} from './common';
import { ensureTeam, deleteThreads, threadsSince, type Team } from './team';

/** What a unit wrote beyond the world (torn down with it). */
export type Extras = { roomKeys: string[]; threadIds: string[]; team: Team | null; since: string; /** background work the unit started (awaited before teardown) */ pending: Promise<unknown>[]; /** generated artifacts the product indexed into the KB (removed with the unit) */ artifactIds: string[] };
const extras = new WeakMap<SeededWorld, Extras>();
export const extrasOf = (s: SeededWorld): Extras => {
  let e = extras.get(s);
  if (!e) { e = { roomKeys: [], threadIds: [], team: null, since: s.seededAt, pending: [], artifactIds: [] }; extras.set(s, e); }
  return e;
};

export type ProduceOut = { turns: string[]; signals?: ColumnOutput['signals'] };

export type SurfaceDef = {
  id: string;
  title: string;
  producer: { file: string; fn: string };
  /** The rubric (1-5 each, with anchors). */
  dims: RubricDim[];
  /** Surface-specific hard conditions (added to COMMON_HARD). */
  hard: string[];
  specs: SurfaceCaseSpec[];
  /** Needs the coworker team seeded on the probe host. */
  team?: boolean;
  /** Extra text the plain columns see before the request (e.g. a step's declared output format). */
  plainPreamble?: (c: EvalCase) => string | undefined;
  /** Material the judge reads beside the world (e.g. a step's upstream outputs). */
  extraSource?: (c: EvalCase) => string | undefined;
  /** AUGMTD's per-case token model for the estimate (calls, in, out). */
  augmtdCost: (c: EvalCase) => { calls: number; inTok: number; outTok: number };
  plainOut?: number;
  produce: (ctx: RunCtx, c: EvalCase, seeded: SeededWorld) => Promise<ProduceOut>;
};

export const clientOf = (ctx: RunCtx): SupabaseClient => ctx.session ?? ctx.admin;

export function makeSurface(def: SurfaceDef): SurfaceAdapter {
  const cases = def.specs.map(toEvalCase);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const edges = [...new Set(def.specs.map((s) => s.edge).filter(Boolean))] as string[];
  return {
    id: def.id,
    family: 'conversation',
    title: def.title,
    stage: 'w28',
    producer: { file: def.producer.file, fn: def.producer.fn, slot: 'conversation' },
    tiers: ['standard', 'eu'],
    status: 'ready',
    planned: [
      { group: 'core', count: def.specs.filter((s) => !s.edge).length, note: 'realistic pilot asks' },
      ...edges.map((e) => ({ group: `edge-${e}`, count: def.specs.filter((s) => s.edge === e).length, note: `edge: ${e}` })),
    ],
    cases: () => cases,
    scoring: { kind: 'judged', dims: def.dims, hardConditions: def.hard },
    estimate: (c) => {
      const plainIn = plainTurnsFor(c, { preamble: def.plainPreamble?.(c) }).reduce((n, t) => n + approxTokens(t), 0) + 20;
      const turns = (c.turns ?? []).length || 1;
      const out = (def.plainOut ?? 700) * turns;
      return { augmtd: def.augmtdCost(c), plainIn: plainIn * turns, plainOut: out };
    },
    async seed(ctx, c) {
      const s = await seedWorld(ctx, c.world);
      const e = extrasOf(s);
      if (def.team) e.team = await ensureTeam(ctx.admin, ctx.userId);
      return s;
    },
    async teardown(ctx, s) {
      const e = extrasOf(s);
      const errors: string[] = [];
      // Background work the unit started (a hand-off still writing) finishes BEFORE its rows are deleted,
      // so nothing lands after the teardown (bounded; a straggler is reported, never silently left).
      if (e.pending.length) {
        const settled = await Promise.race([Promise.allSettled(e.pending).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 600_000))]);
        if (!settled) errors.push('background work still running 10 min after the unit — rows it writes later are left for --sweep');
      }
      try {
        const since = e.team ? await threadsSince(ctx.admin, ctx.userId, e.since, e.team.workers.map((w) => w.id)) : [];
        errors.push(...await deleteThreads(ctx.admin, ctx.userId, [...new Set([...e.threadIds, ...since])]));
      } catch (err) { errors.push((err as Error).message); }
      // Generated artifacts the product indexed into the KB (the 'AUGMTD Files' source): their files + chunks,
      // and the source row itself when this unit created it and nothing else is in it.
      if (e.artifactIds.length) {
        for (let i = 0; i < 10; i++) {
          const { data } = await ctx.admin.from('knowledge_files').select('id').eq('user_id', ctx.userId).in('provider_file_id', e.artifactIds);
          const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
          if (ids.length || i === 9) {
            if (ids.length) {
              const ch = await ctx.admin.from('knowledge_chunks').delete().eq('user_id', ctx.userId).in('file_id', ids);
              if (ch.error) errors.push(`knowledge_chunks: ${ch.error.message}`);
              const kf = await ctx.admin.from('knowledge_files').delete().eq('user_id', ctx.userId).in('id', ids);
              if (kf.error) errors.push(`knowledge_files: ${kf.error.message}`);
            }
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        const { data: srcs } = await ctx.admin.from('knowledge_sources').select('id, created_at').eq('user_id', ctx.userId).eq('provider', 'augmtd').gte('created_at', e.since);
        for (const src of (srcs ?? []) as Array<{ id: string }>) {
          const { count } = await ctx.admin.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('source_id', src.id);
          if (!count) { const d = await ctx.admin.from('knowledge_sources').delete().eq('user_id', ctx.userId).eq('id', src.id); if (d.error) errors.push(`knowledge_sources: ${d.error.message}`); }
        }
      }
      for (const k of e.roomKeys) {
        const r = await ctx.admin.from('room_turns').delete().eq('user_id', ctx.userId).eq('room_key', k);
        if (r.error) errors.push(`room_turns(${k}): ${r.error.message}`);
      }
      const w = await teardownWorld(ctx, s);
      errors.push(...w.errors);
      if (errors.length) throw new Error(errors.join('; '));
    },
    async produce(ctx, c, seeded) {
      const { quota, unitFailures } = await import('./failures');
      if (ctx.tier === 'eu' && quota.euStopped) throw new Error(`EU QUOTA STOP — unrun (${quota.reason})`);
      const r = await def.produce(ctx, c, seeded);
      // A model call that failed inside the producer is a RUN ERROR (never scored) — even when the product
      // swallowed it and served something (an empty summary, an "unstated" field).
      const failed = unitFailures();
      if (failed.length) throw new Error(`model call failed during the producer (${failed.length}): ${failed[0]}`);
      return { text: r.turns[r.turns.length - 1] ?? '', turns: r.turns, value: null, ...(r.signals ? { signals: r.signals } : {}) };
    },
    plainPrompt: (c) => ({ user: plainTurnsFor(c, { preamble: def.plainPreamble?.(c) })[0] ?? '' }),
    parse: () => null,
    conversation: {
      plainTurns: (c) => plainTurnsFor(c, { preamble: def.plainPreamble?.(byId.get(c.id) ?? c) }),
      judgePrompt: (c, transcript, signalNotes) => surfaceJudgePrompt({ c, dims: def.dims, surfaceHard: def.hard, transcript, signalNotes, now: clockNow(), extraSource: def.extraSource?.(byId.get(c.id) ?? c) ?? null }),
      parseVerdict: (raw) => parseSurfaceVerdict(raw, def.dims),
      runChecks: (c, column, out) => runSurfaceChecks(c, column, out),
    },
  };
}

// ── shared rubric dimensions (surfaces pick and gloss) ──────────────────────────────────────────

export const DIM = {
  task: (gloss: string): RubricDim => ({ id: 'task_fit', label: 'Does the job asked', gloss, anchors: { 1: 'misses or refuses the ask', 3: 'does it with clear gaps', 5: 'exactly what a strong colleague would hand over' } }),
  format: (gloss: string): RubricDim => ({ id: 'format_contract', label: 'Format is the contract', gloss, anchors: { 1: 'ignores the requested/declared shape', 3: 'mostly follows it, one deviation', 5: 'every stated section, count, length and format honoured' } }),
  grounded: (gloss: string): RubricDim => ({ id: 'groundedness', label: 'Grounded, gaps named', gloss, anchors: { 1: 'invents facts or hides a conflict', 3: 'grounded but a gap/conflict glossed over', 5: 'uses only the material; conflicts and missing inputs named plainly' } }),
  voice: (gloss: string): RubricDim => ({ id: 'voice_quality', label: 'Quality of the writing', gloss, anchors: { 1: 'generic, padded or off-tone', 3: 'serviceable', 5: 'sharp, specific, ready to use as is' } }),
  conduct: (gloss: string): RubricDim => ({ id: 'conduct', label: 'Conduct', gloss, anchors: { 1: 'lectures, stalls, asks several questions or refuses', 3: 'some padding or an unneeded question', 5: 'delivers first, at most one needed question, no filler' } }),
};
