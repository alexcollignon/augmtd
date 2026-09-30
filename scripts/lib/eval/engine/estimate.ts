// W26 — THE PRE-RUN ESTIMATE (pure; no network). Per surface × tier × column, from each adapter's
// token model and the REAL plain prompts, priced at the models each column resolves to (the tier
// table for AUGMTD/same, the eval table for Sonnet 5.5 / GPT-5.6 / the judge). Reasoning columns
// are billed at 3× their visible output (reasoning tokens are billed as output). Conservative.
import { TIER_DEFAULTS } from '../../../../lib/ai/defaults';
import { PRODUCER_EFFORT, effortFamily, isEffortProducer } from '../../../../lib/ai/effort';
import { priceOf, eur } from './pricing';
import { approxTokens } from '../home-chat-harness';
import type { AnyAdapter, ColumnId, EvalCase, Tier } from './types';
import { TIER_FREE } from './runner';

export const TIER_KEY: Record<Tier, 'standard' | 'bedrock_optimised'> = { standard: 'standard', eu: 'bedrock_optimised' };
export const REASONING_MULTIPLIER = 3;
export const JUDGE_IN_OVERHEAD = 1600;
export const JUDGE_OUT = 450;

export type EstimateRow = { surface: string; tier: Tier; cases: number; byColumn: Partial<Record<ColumnId, number>>; judge: number; total: number; unpriced: string[] };

export function slotModel(tier: Tier, slot: string): string {
  return (TIER_DEFAULTS[TIER_KEY[tier]] as Record<string, { model: string }>)[slot]?.model ?? 'unknown';
}

export function estimateRun(a: {
  adapters: AnyAdapter[]; tiers: Tier[]; columns: ColumnId[]; repeat: number; judge: string | null; now: Date;
  select: (ad: AnyAdapter, c: EvalCase) => boolean; plainModels: { sonnet55: string; gpt56: string };
  /** --planned: price a stub adapter's PLANNED case count off its canary (the fixtures are not written yet). */
  planned?: boolean;
  /** W27.C — the eval-only effort override (slot → effort): an AUGMTD producer whose slot thinks is
   *  priced like a reasoning column (visible output × REASONING_MULTIPLIER). */
  augmtdEffort?: Partial<Record<string, string>>;
}): { rows: EstimateRow[]; total: number } {
  const rows: EstimateRow[] = [];
  let total = 0;
  for (const tier of a.tiers) {
    for (const ad of a.adapters) {
      if (!ad.tiers.includes(tier)) continue;
      let cases = ad.cases().filter((c) => a.select(ad, c as EvalCase)) as EvalCase[];
      let mult = 1;
      if (a.planned && ad.status === 'stub') {
        const canary = (ad.cases() as EvalCase[]).find((c) => c.canary);
        const n = ad.planned.filter((g) => !/PENDING/.test(g.note)).reduce((x, g) => x + g.count, 0);
        if (canary && n) { cases = [canary]; mult = n; }
      }
      if (!cases.length) continue;
      const row: EstimateRow = { surface: ad.id, tier, cases: cases.length * mult, byColumn: {}, judge: 0, total: 0, unpriced: [] };
      const slotM = slotModel(tier, ad.producer.slot);
      const priceFor = (m: string) => { const p = priceOf(m); if (!p && !row.unpriced.includes(m)) row.unpriced.push(m); return p ?? { inputPer1M: 4.6, outputPer1M: 23 }; };
      for (const c of cases) {
        const e = ad.estimate?.(c) ?? { augmtd: { calls: 2, inTok: 4000, outTok: 400 }, plainIn: 1500, plainOut: 250 };
        const plainIn = ad.family === 'conversation' ? e.plainIn : approxTokens(ad.plainPrompt(c, a.now).user) + 20;
        let answerOut = 0;
        for (const col of a.columns) {
          if (TIER_FREE.includes(col) && tier !== a.tiers[0]) continue; // reused from the first tier
          let cost = 0;
          if (col === 'augmtd') {
            // W28: the producer's own effort (PRODUCER_EFFORT) or its key override, else the slot override.
            const key = ad.producer.effortKey;
            const own = isEffortProducer(key) ? PRODUCER_EFFORT[key]?.[effortFamily(slotM)] : undefined;
            const eff = (key ? a.augmtdEffort?.[key] : undefined) ?? own ?? a.augmtdEffort?.[ad.producer.slot];
            cost = eur(priceFor(slotM), e.augmtd.inTok, e.augmtd.outTok * (eff && eff !== 'minimal' ? REASONING_MULTIPLIER : 1));
          }
          else if (col === 'same') cost = eur(priceFor(slotM), plainIn, e.plainOut);
          else cost = eur(priceFor(col === 'sonnet55' ? a.plainModels.sonnet55 : a.plainModels.gpt56), plainIn, e.plainOut * REASONING_MULTIPLIER);
          row.byColumn[col] = (row.byColumn[col] ?? 0) + cost * a.repeat * mult;
          answerOut = Math.max(answerOut, e.plainOut);
        }
        if (a.judge && ad.scoring.kind === 'judged') {
          const judged = a.columns.filter((col) => !(TIER_FREE.includes(col) && tier !== a.tiers[0])).length;
          row.judge += mult * judged * a.repeat * eur(priceFor(a.judge), JUDGE_IN_OVERHEAD + (ad.family === 'conversation' ? e.plainIn + answerOut * 2 : answerOut + 600), JUDGE_OUT);
        }
      }
      row.total = Object.values(row.byColumn).reduce((x, y) => x + (y ?? 0), 0) + row.judge;
      total += row.total;
      rows.push(row);
    }
  }
  return { rows, total };
}
