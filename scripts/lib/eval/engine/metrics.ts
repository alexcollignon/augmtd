// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — LABELLED METRICS (pure). Per-case scoring against truth (enum fields through a cost matrix,
// set fields through the adapter's one-to-one matcher), then per-column aggregates: accuracy,
// precision/recall/F1 per label, macro-F1, the costly class's recall/precision, cost-weighted error,
// set micro-P/R/F1 (+ named error flags such as hallucinated dates), and REPEAT CONSISTENCY.
// "Silence is correct": a WITHHELD AUGMTD output reads as the field's `silence` label, so serving
// nothing where nothing is owed scores as right — and where something was owed, as the miss it is.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { LabelField, LabelScoring, LabelScore, FieldScore, SetMatch } from './types';

export const UNPARSED = '∅';

export const norm = (v: unknown): string => {
  if (v == null) return UNPARSED;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v).trim().toLowerCase().replace(/\s+/g, '_') || UNPARSED;
};

/** The cost of predicting `pred` for `truth` (the most specific matrix entry wins). */
export function costOf(field: Extract<LabelField, { kind: 'enum' }>, truth: string, pred: string): number {
  if (truth === pred) return 0;
  const m = field.costs ?? {};
  const row = m[truth] ?? {};
  const any = m['*'] ?? {};
  if (row[pred] != null) return row[pred];
  if (row['*'] != null) return row['*'];
  if (any[pred] != null) return any[pred];
  if (any['*'] != null) return any['*'];
  return 1;
}

export function scoreCase(
  scoring: LabelScoring, value: Record<string, unknown> | null, truth: Record<string, unknown>, withheld = false,
): LabelScore {
  const fields: FieldScore[] = [];
  let wsum = 0, ssum = 0, costTotal = 0;
  for (const f of scoring.fields) {
    const w = f.weight ?? 1;
    if (f.when && !f.when(truth)) { fields.push({ field: f.name, truth: '-', pred: '-', correct: true, cost: 0, skipped: true }); continue; }
    if (f.kind === 'enum') {
      const t = norm(truth[f.name]);
      let p: string;
      if (value) p = norm(value[f.name]);
      else p = withheld && f.silence ? f.silence : UNPARSED;
      // An out-of-vocabulary answer is simply wrong, kept verbatim for the confusion matrix.
      // AMBIGUOUS cases may accept more than one label: truth.accept = { <field>: ['a', 'b'] }.
      const accept = ((truth.accept as Record<string, unknown[]> | undefined)?.[f.name] ?? []).map(norm);
      const correct = t === p || accept.includes(p);
      const cost = correct ? 0 : costOf(f, t, p);
      fields.push({ field: f.name, truth: t, pred: p, correct, cost });
      wsum += w; ssum += w * (correct ? 1 : 0); costTotal += cost * w;
    } else {
      const tItems = Array.isArray(truth[f.name]) ? (truth[f.name] as unknown[]) : [];
      const raw = value ? value[f.name] : withheld ? [] : null;
      const pItems = Array.isArray(raw) ? raw : raw == null && value ? [] : null;
      let m: SetMatch;
      if (pItems == null) m = { tp: 0, fp: 0, fn: tItems.length };
      else m = f.match(pItems, tItems);
      const f1 = setF1(m);
      fields.push({ field: f.name, truth: `${tItems.length} item(s)`, pred: pItems == null ? UNPARSED : `${pItems.length} item(s)`, correct: m.fp === 0 && m.fn === 0 && pItems != null, cost: m.fp + m.fn, set: m });
      wsum += w; ssum += w * f1; costTotal += (m.fp + m.fn) * w;
    }
  }
  return { fields, score: wsum ? ssum / wsum : 1, costTotal };
}

export function setF1(m: SetMatch): number {
  if (m.tp + m.fp + m.fn === 0) return 1; // nothing owed, nothing claimed
  const p = m.tp + m.fp ? m.tp / (m.tp + m.fp) : 0;
  const r = m.tp + m.fn ? m.tp / (m.tp + m.fn) : 0;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

export type LabelStat = { label: string; tp: number; fp: number; fn: number; precision: number | null; recall: number | null; f1: number | null };

export type FieldAggregate = {
  field: string;
  kind: 'enum' | 'set';
  n: number;
  accuracy: number | null;
  macroF1: number | null;
  perLabel: LabelStat[];
  costly?: { label: string; precision: number | null; recall: number | null };
  /** Mean cost per scored case. */
  costPerCase: number;
  confusion: Record<string, Record<string, number>>;
  set?: { tp: number; fp: number; fn: number; precision: number | null; recall: number | null; f1: number | null; flags: Record<string, number> };
};

/** Aggregate a column's per-run label scores (every repeat of every case) per field. */
export function aggregateField(field: LabelField, scores: LabelScore[]): FieldAggregate {
  const fs = scores.map((s) => s.fields.find((f) => f.field === field.name)).filter((f): f is FieldScore => !!f && !f.skipped);
  const n = fs.length;
  const costPerCase = n ? fs.reduce((a, f) => a + f.cost, 0) / n : 0;
  if (field.kind === 'set') {
    const tot = { tp: 0, fp: 0, fn: 0 };
    const flags: Record<string, number> = {};
    for (const f of fs) {
      tot.tp += f.set?.tp ?? 0; tot.fp += f.set?.fp ?? 0; tot.fn += f.set?.fn ?? 0;
      for (const [k, v] of Object.entries(f.set?.flags ?? {})) flags[k] = (flags[k] ?? 0) + v;
    }
    const p = tot.tp + tot.fp ? tot.tp / (tot.tp + tot.fp) : null;
    const r = tot.tp + tot.fn ? tot.tp / (tot.tp + tot.fn) : null;
    const f1 = p != null && r != null && p + r ? (2 * p * r) / (p + r) : tot.tp + tot.fp + tot.fn === 0 ? 1 : 0;
    const exact = fs.filter((f) => f.correct).length;
    return { field: field.name, kind: 'set', n, accuracy: n ? exact / n : null, macroF1: null, perLabel: [], costPerCase, confusion: {}, set: { ...tot, precision: p, recall: r, f1, flags } };
  }
  const confusion: Record<string, Record<string, number>> = {};
  for (const f of fs) { (confusion[f.truth] ??= {})[f.pred] = (confusion[f.truth][f.pred] ?? 0) + 1; }
  const labels = [...new Set([...Object.keys(field.labels), ...fs.map((f) => f.truth)])];
  const perLabel: LabelStat[] = labels.map((l) => {
    const tp = fs.filter((f) => f.truth === l && f.pred === l).length;
    const fp = fs.filter((f) => f.truth !== l && f.pred === l).length;
    const fn = fs.filter((f) => f.truth === l && f.pred !== l).length;
    const precision = tp + fp ? tp / (tp + fp) : null;
    const recall = tp + fn ? tp / (tp + fn) : null;
    const f1 = precision != null && recall != null ? (precision + recall ? (2 * precision * recall) / (precision + recall) : 0) : null;
    return { label: l, tp, fp, fn, precision, recall, f1 };
  });
  // Macro-F1 over the labels that occur in the TRUTH (a label no case carries says nothing).
  const present = perLabel.filter((s) => fs.some((f) => f.truth === s.label));
  const macroF1 = present.length ? present.reduce((a, s) => a + (s.f1 ?? 0), 0) / present.length : null;
  const accuracy = n ? fs.filter((f) => f.correct).length / n : null;
  const costly = field.costly ? perLabel.find((s) => s.label === field.costly) : undefined;
  return {
    field: field.name, kind: 'enum', n, accuracy, macroF1, perLabel, costPerCase, confusion,
    ...(field.costly ? { costly: { label: field.costly, precision: costly?.precision ?? null, recall: costly?.recall ?? null } } : {}),
  };
}

/** The surface's primary metric for one column, oriented so HIGHER IS BETTER (cost is negated). */
export function primaryValue(scoring: LabelScoring, aggs: FieldAggregate[]): number | null {
  const a = aggs.find((x) => x.field === scoring.primary.field);
  if (!a) return null;
  switch (scoring.primary.metric) {
    case 'accuracy': return a.accuracy;
    case 'macro_f1': return a.macroF1;
    case 'costly_recall': return a.costly?.recall ?? null;
    case 'costly_precision': return a.costly?.precision ?? null;
    case 'cost_weighted': return a.n ? 0 - a.costPerCase : null;
    case 'set_f1': return a.set?.f1 ?? null;
  }
}

/** Share of cases whose repeats all produced the SAME labels (1 = perfectly stable). */
export function repeatConsistency(byCase: LabelScore[][]): number | null {
  const multi = byCase.filter((reps) => reps.length > 1);
  if (!multi.length) return null;
  const sig = (s: LabelScore) => s.fields.map((f) => `${f.field}=${f.pred}${f.set ? `:${f.set.tp}/${f.set.fp}/${f.set.fn}` : ''}`).join('|');
  const stable = multi.filter((reps) => reps.every((r) => sig(r) === sig(reps[0]))).length;
  return stable / multi.length;
}

/** Deterministic PRNG (mulberry32) — a bootstrap must reproduce. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paired bootstrap CI of mean(a − b) over cases (per-case means). */
export function pairedBootstrap(a: number[], b: number[], opts: { samples?: number; level?: number; seed?: number } = {}): { delta: number; lo: number; hi: number } | null {
  const n = Math.min(a.length, b.length);
  if (!n) return null;
  const d = Array.from({ length: n }, (_, i) => a[i] - b[i]);
  const mean = d.reduce((x, y) => x + y, 0) / n;
  const S = opts.samples ?? 2000, level = opts.level ?? 0.9;
  const r = rng(opts.seed ?? 26);
  const means: number[] = [];
  for (let s = 0; s < S; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[Math.floor(r() * n)];
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const lo = means[Math.floor(((1 - level) / 2) * S)];
  const hi = means[Math.min(S - 1, Math.floor((1 - (1 - level) / 2) * S))];
  return { delta: mean, lo, hi };
}

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const sd = (xs: number[]): number | null => {
  const m = mean(xs);
  if (m == null) return null;
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
