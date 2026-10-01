// W26 — PRICES, fail closed. A model the engine may call must have a price (eval table first, then
// the product's table). The runner REFUSES a column whose model has no entry — an unpriced column
// would make the budget stop and the estimate lie (the meter used to fall back to €1/€3 with a warning).
import { MODEL_PRICING } from '../../../../lib/ai/pricing';
import { EVAL_PRICING, type MeterCall } from '../meter';

export type Price = { inputPer1M: number; outputPer1M: number };

export function priceOf(model: string): Price | null {
  return EVAL_PRICING[model] ?? MODEL_PRICING[model] ?? null;
}

/** Throws naming every unpriced model (the runner calls it before any spend). */
export function assertPriced(models: string[]): void {
  const missing = [...new Set(models)].filter((m) => !priceOf(m));
  if (missing.length) throw new Error(`REFUSED: no price for ${missing.join(', ')} — add it to scripts/lib/eval/meter.ts EVAL_PRICING (or lib/ai/pricing.ts) before running`);
}

export const eur = (p: Price, inTok: number, outTok: number): number => (inTok * p.inputPer1M + outTok * p.outputPer1M) / 1e6;

export type Priced = { promptTokens: number; completionTokens: number; costEur: number; calls: number; unmetered: number; models: string[]; unpriced: string[]; /** provider-reported reasoning tokens (the effort actually used) */ reasoningTokens: number; /** W27.C — the distinct efforts the calls were sent with */ efforts: string[] };

/** Price a list of metered calls. An unpriced model is billed at the most expensive known rate and
 *  NAMED (never silently cheap). */
export function priceCalls(calls: MeterCall[]): Priced {
  const out: Priced = { promptTokens: 0, completionTokens: 0, costEur: 0, calls: calls.length, unmetered: 0, models: [], unpriced: [], reasoningTokens: 0, efforts: [] };
  const ceiling: Price = { inputPer1M: 4.6, outputPer1M: 23.0 };
  for (const c of calls) {
    out.promptTokens += c.promptTokens; out.completionTokens += c.completionTokens; out.reasoningTokens += c.reasoningTokens ?? 0;
    if (!out.models.includes(c.model)) out.models.push(c.model);
    if (c.effort && !out.efforts.includes(c.effort)) out.efforts.push(c.effort);
    if (!c.metered) { out.unmetered++; continue; }
    const p = priceOf(c.model);
    if (!p && !out.unpriced.includes(c.model)) out.unpriced.push(c.model);
    out.costEur += eur(p ?? ceiling, c.promptTokens, c.completionTokens);
  }
  return out;
}
