// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — SUMMARIES, THE PARITY VERDICT, MERGE / RECHECK and THE REPORT (pure; recomputed from the saved
// runs every time, so a --merge or a --recheck never carries a stale number).
// THE BAR (owner): AUGMTD ≥ EACH plain column on every surface AND on every scenario. The verdict is
// reported per surface × tier × column: the primary metric (higher is better, cost negated), the
// paired bootstrap 90% CI of the per-case delta, and the scenarios where AUGMTD sits below.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { aggregateField, primaryValue, repeatConsistency, pairedBootstrap, mean, sd, type FieldAggregate } from './metrics';
import { labelScoreFor, runChecksFor, type EngineResult, type SurfaceResult, type CaseResult } from './runner';
import type { AnyAdapter, ColumnId, ColumnRun, EvalCase, LabelScore } from './types';
import { PLAIN_COLUMNS } from './types';

export type ColumnSummary = {
  column: ColumnId;
  runs: number;
  scored: number;
  unscored: number;
  skipped: number;
  errors: number;
  withheld: number;
  primary: number | null;
  caseMeans: Record<string, number | null>;
  caseSds: Record<string, number | null>;
  aggs: FieldAggregate[];
  consistency: number | null;
  checksPassed: number;
  checksTotal: number;
  costEur: number;
  judgeCostEur: number;
  latencyMs: number;
  models: string[];
  reused: boolean;
  /** Mean provider-reported reasoning tokens per run (the thinking ACTUALLY used; 0 = none reported). */
  reasoningPerRun: number;
};

export type Parity = { vs: ColumnId; ok: boolean | null; delta: number | null; ci: { lo: number; hi: number } | null; casesBelow: string[]; why: string };

export type SurfaceSummary = {
  surface: string; tier: string; title: string; scoring: 'labelled' | 'judged';
  primaryLabel: string;
  columns: Partial<Record<ColumnId, ColumnSummary>>;
  parity: Parity[];
  /** AUGMTD ≥ every plain column present, on the surface AND on every scenario. null = not measurable. */
  verdict: boolean | null;
};

const live = (runs: ColumnRun[] | undefined) => (runs ?? []).filter((r) => !r.skipped);

export function summarizeSurface(adapter: AnyAdapter | undefined, sr: SurfaceResult): SurfaceSummary {
  const cols = sr.columns.map((c) => c.id);
  const out: SurfaceSummary = {
    surface: sr.surface, tier: sr.tier, title: sr.title, scoring: sr.scoring,
    primaryLabel: sr.scoring === 'labelled' && adapter?.scoring.kind === 'labelled'
      ? `${adapter.scoring.primary.metric.replace(/_/g, ' ')} · ${adapter.scoring.primary.field}` : 'judge mean (1–5)',
    columns: {}, parity: [], verdict: null,
  };
  for (const col of cols) {
    const all = sr.cases.flatMap((c) => c.runs[col] ?? []);
    const lv = all.filter((r) => !r.skipped);
    const caseMeans: Record<string, number | null> = {}, caseSds: Record<string, number | null> = {};
    for (const c of sr.cases) {
      const xs = live(c.runs[col]).map((r) => r.score).filter((x): x is number => x != null);
      caseMeans[c.caseId] = mean(xs); caseSds[c.caseId] = sd(xs);
    }
    let aggs: FieldAggregate[] = [];
    let primary: number | null = null;
    let consistency: number | null = null;
    if (sr.scoring === 'labelled' && adapter?.scoring.kind === 'labelled') {
      const scores = lv.map((r) => r.label).filter((x): x is LabelScore => !!x);
      aggs = adapter.scoring.fields.map((f) => aggregateField(f, scores));
      primary = primaryValue(adapter.scoring, aggs);
      consistency = repeatConsistency(sr.cases.map((c) => live(c.runs[col]).map((r) => r.label).filter((x): x is LabelScore => !!x)));
    } else {
      primary = mean(Object.values(caseMeans).filter((x): x is number => x != null));
    }
    out.columns[col] = {
      column: col, runs: all.length, scored: lv.filter((r) => r.score != null).length, unscored: lv.filter((r) => r.score == null && !r.out.error).length,
      skipped: all.length - lv.length, errors: lv.filter((r) => !!r.out.error).length, withheld: lv.filter((r) => r.out.withheld).length,
      primary, caseMeans, caseSds, aggs, consistency,
      checksPassed: lv.reduce((n, r) => n + r.checks.filter((x) => x.pass).length, 0),
      checksTotal: lv.reduce((n, r) => n + r.checks.length, 0),
      costEur: lv.reduce((n, r) => n + r.out.costEur, 0), judgeCostEur: lv.reduce((n, r) => n + (r.verdict?.costEur ?? 0), 0),
      latencyMs: lv.length ? lv.reduce((n, r) => n + r.out.latencyMs, 0) / lv.length : 0,
      models: [...new Set(lv.flatMap((r) => r.out.models))], reused: all.some((r) => !!r.reusedFrom),
      reasoningPerRun: lv.length ? lv.reduce((n, r) => n + (r.out.reasoningTokens ?? 0), 0) / lv.length : 0,
    };
  }
  const aug = out.columns.augmtd;
  if (aug) {
    for (const col of cols.filter((c) => (PLAIN_COLUMNS as ColumnId[]).includes(c))) {
      const other = out.columns[col]!;
      const ids = sr.cases.map((c) => c.caseId).filter((id) => aug.caseMeans[id] != null && other.caseMeans[id] != null);
      const a = ids.map((id) => aug.caseMeans[id]!), b = ids.map((id) => other.caseMeans[id]!);
      const below = ids.filter((id) => aug.caseMeans[id]! + 1e-9 < other.caseMeans[id]!);
      const ci = pairedBootstrap(a, b);
      if (aug.primary == null || other.primary == null) { out.parity.push({ vs: col, ok: null, delta: null, ci: null, casesBelow: below, why: 'not measurable (no scored runs)' }); continue; }
      const delta = aug.primary - other.primary;
      const why: string[] = [];
      if (delta < -1e-9) why.push(`primary ${delta.toFixed(3)}`);
      if (below.length) why.push(`${below.length} scenario(s) below`);
      out.parity.push({ vs: col, ok: !why.length, delta, ci: ci ? { lo: ci.lo, hi: ci.hi } : null, casesBelow: below, why: why.join(', ') });
    }
    const measured = out.parity.filter((p) => p.ok != null);
    out.verdict = measured.length ? measured.every((p) => p.ok) : null;
  }
  return out;
}

// ── merge / recheck ─────────────────────────────────────────────────────────────────────────────

/** Fold another saved run in: columns this result lacks (per surface × tier × case) are copied over.
 *  Use it to reuse plain-column runs when only AUGMTD changed. Spend is not re-added. */
export function mergeEngine(base: EngineResult, other: EngineResult): { result: EngineResult; added: string[] } {
  const added: string[] = [];
  for (const os of other.surfaces) {
    const bs = base.surfaces.find((s) => s.surface === os.surface && s.tier === os.tier);
    if (!bs) { base.surfaces.push(os); added.push(`${os.surface}[${os.tier}] (whole surface)`); continue; }
    const have = new Set(bs.columns.map((c) => c.id));
    const add = os.columns.filter((c) => !have.has(c.id));
    if (!add.length) continue;
    const byCase = new Map(os.cases.map((c) => [c.caseId, c]));
    for (const cr of bs.cases) {
      const o = byCase.get(cr.caseId);
      if (!o) continue;
      for (const col of add) if (o.runs[col.id]?.length) cr.runs[col.id] = o.runs[col.id];
    }
    const order = (id: ColumnId) => ['augmtd', 'same', 'sonnet55', 'gpt56'].indexOf(id);
    bs.columns = [...bs.columns, ...add].sort((a, b) => order(a.id) - order(b.id));
    added.push(`${os.surface}[${os.tier}]: ${add.map((c) => c.id).join(', ')}`);
  }
  if (other.judgeModel !== base.judgeModel && other.judgeModel && base.judgeModel) base.notes.push(`⚠ merged a run judged by ${other.judgeModel} into one judged by ${base.judgeModel} — judged scores are not comparable`);
  return { result: base, added };
}

/** Re-score a saved result with the CURRENT adapters (zero AI): plain answers are re-parsed, labels
 *  re-scored, checks re-run; judge verdicts are kept as they were. */
export function recheckEngine(result: EngineResult, adapters: AnyAdapter[]): EngineResult {
  for (const sr of result.surfaces) {
    const a = adapters.find((x) => x.id === sr.surface);
    if (!a) continue;
    const cases = new Map(a.cases().map((c) => [c.id, c as EvalCase]));
    const now = new Date(result.now);
    for (const cr of sr.cases) {
      const c = cases.get(cr.caseId);
      if (!c) continue;
      cr.truth = a.resolveTruth ? a.resolveTruth(c, now) : c.truth;
      for (const runs of Object.values(cr.runs)) {
        for (const r of runs ?? []) {
          if (r.skipped) continue;
          if (r.column !== 'augmtd' && a.scoring.kind === 'labelled' && !r.out.error) r.out.value = a.parse(r.out.text, c);
          // THE SERVED VIEW (types.ts): a saved AUGMTD value that predates the adapter's served
          // projection gets it now (idempotent — a value already projected is unchanged).
          if (r.column === 'augmtd' && a.servedView && r.out.value && !r.out.error) r.out.value = a.servedView(r.out.value, c, now, r.out.text);
          r.checks = runChecksFor(a, c, r);
          labelScoreFor(a, c, r, now);
        }
      }
    }
  }
  return result;
}

/** JSON-safe serialisation (functions never serialise; truth is data). */
export function serialize(result: EngineResult): string {
  return JSON.stringify(result, (_k, v) => (typeof v === 'function' ? undefined : v), 0);
}

// ── the report ──────────────────────────────────────────────────────────────────────────────────

const f2 = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(2));
const f3 = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(3));
const pctS = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100)}%`);
const eurS = (n: number) => `€${n.toFixed(4)}`;
const cellS = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const oneLine = (s: string, max = 220) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length <= max ? t : `${t.slice(0, max)} …`; };

/** W27.C — the scoreboard's AUGMTD effort cell: the effort the column ran at (override or the
 *  producer's own), the efforts the meter saw SENT, and the mean reasoning tokens per unit (one unit =
 *  one case × repeat; provider-reported, or estimated for Bedrock thinking). */
function augmtdEffortCell(sr: SurfaceResult, s: SurfaceSummary): string {
  const meta = sr.columns.find((c) => c.id === 'augmtd');
  if (!meta) return '—';
  const runs = sr.cases.flatMap((c) => live(c.runs.augmtd));
  const sent = [...new Set(runs.flatMap((r) => r.out.efforts ?? []))];
  const per = s.columns.augmtd?.reasoningPerRun ?? 0;
  return `${meta.effort ?? 'floor'}${sent.length ? ` (sent: ${sent.join('/')})` : ''} · ${per ? Math.round(per) : 0}`;
}

export function renderEngineReport(result: EngineResult, adapters: AnyAdapter[], meta: { title?: string; notes?: string[] } = {}): string {
  const L: string[] = [];
  L.push(`# ${meta.title ?? 'W26 — every output vs plain models'}`, '');
  L.push(`Run ${result.startedAt} → ${result.finishedAt} · clock ${result.now} · repeat ${result.repeat}${result.stubbed ? ' · **STUBBED TRANSPORT (zero AI — proves wiring, not quality)**' : ''}`, '');
  L.push(`- **Judge**: ${result.judgeModel ? `\`${result.judgeModel}\` (blind)` : 'none'}`);
  if (result.effortOverride && Object.keys(result.effortOverride).length) L.push(`- **AUGMTD effort override (eval-only)**: ${Object.entries(result.effortOverride).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  L.push(`- **Spend (metered)**: ${eurS(result.totalCostEur)} of €${result.budgetEur.toFixed(2)}${result.budgetHit ? ' — **BUDGET HIT, later runs skipped**' : ''}`);
  for (const n of [...result.notes, ...(meta.notes ?? [])]) L.push(`- ${n}`);
  L.push('');
  const sums = result.surfaces.map((sr) => ({ sr, s: summarizeSurface(adapters.find((a) => a.id === sr.surface), sr) }));

  // Cross-surface summary.
  L.push('## Scoreboard — AUGMTD vs each plain column', '');
  L.push('Primary metric per column (higher is better; cost-weighted error shown negated). Verdict ✓ = AUGMTD ≥ that column on the surface AND on every scenario.', '');
  L.push('| Surface | Tier | Primary | augmtd | same | sonnet55 | gpt56 | AUGMTD effort · reasoning tok/unit | Verdict |', '|---|---|---|---|---|---|---|---|---|');
  for (const { sr, s } of sums) {
    const colCell = (id: ColumnId) => {
      const c = s.columns[id];
      if (!c) return '—';
      const p = s.parity.find((x) => x.vs === id);
      return `${f3(c.primary)}${p ? (p.ok == null ? ' ?' : p.ok ? ' ✓' : ' ✗') : ''}${c.reused ? ' ↺' : ''}`;
    };
    L.push(`| ${s.surface} | ${s.tier} | ${s.primaryLabel} | ${colCell('augmtd')} | ${colCell('same')} | ${colCell('sonnet55')} | ${colCell('gpt56')} | ${augmtdEffortCell(sr, s)} | ${s.verdict == null ? 'not measurable' : s.verdict ? '**≥ every column**' : `**below**: ${s.parity.filter((p) => p.ok === false).map((p) => `${p.vs} (${p.why})`).join('; ')}`} |`);
  }
  L.push('', '↺ = reused from the other tier (tier-independent plain column).', '');

  for (const { sr, s } of sums) {
    const a = adapters.find((x) => x.id === sr.surface);
    L.push(`## ${sr.surface} · ${sr.tier} — ${sr.title}`, '');
    if (a) L.push(`Producer: \`${a.producer.fn}\` (${a.producer.file}) · slot ${a.producer.slot}${a.status === 'stub' ? ' · **STUB (fixtures pending)**' : ''}`, '');
    L.push('| Column | Model | Effort sent | Reasoning tok/run (reported) | Primary | Runs (scored/unscored/err/skip) | Withheld | Checks | Consistency | Cost | Judge cost | Latency |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const cm of sr.columns) {
      const c = s.columns[cm.id]!;
      L.push(`| ${cm.id} | \`${cm.model}\` | ${cm.effort ?? 'none sent (provider default)'} | ${c.reasoningPerRun ? Math.round(c.reasoningPerRun) : '0 / not reported'} | ${f3(c.primary)} | ${c.runs} (${c.scored}/${c.unscored}/${c.errors}/${c.skipped}) | ${c.withheld} | ${c.checksPassed}/${c.checksTotal} | ${pctS(c.consistency)} | ${eurS(c.costEur)} | ${eurS(c.judgeCostEur)} | ${(c.latencyMs / 1000).toFixed(1)} s |`);
    }
    L.push('');
    if (s.parity.length) {
      L.push('**Parity** (AUGMTD − column):', '');
      for (const p of s.parity) L.push(`- vs **${p.vs}**: ${p.ok == null ? 'not measurable' : p.ok ? '✓' : '✗'} Δ ${f3(p.delta)}${p.ci ? ` (90% CI of per-case Δ ${f3(p.ci.lo)} … ${f3(p.ci.hi)})` : ''}${p.casesBelow.length ? ` · below on: ${p.casesBelow.join(', ')}` : ''}`);
      L.push('');
    }
    if (sr.scoring === 'labelled' && a?.scoring.kind === 'labelled') {
      for (const f of a.scoring.fields) {
        L.push(`### field \`${f.name}\``, '');
        if (f.kind === 'enum') {
          L.push('| Column | Accuracy | Macro-F1 | ' + (f.costly ? `${f.costly} P / R | ` : '') + 'Cost / case |', '|---|---|---|' + (f.costly ? '---|' : '') + '---|');
          for (const cm of sr.columns) {
            const g = s.columns[cm.id]!.aggs.find((x) => x.field === f.name);
            if (!g) continue;
            L.push(`| ${cm.id} | ${pctS(g.accuracy)} | ${f3(g.macroF1)} | ${f.costly ? `${f2(g.costly?.precision)} / ${f2(g.costly?.recall)} | ` : ''}${f3(g.costPerCase)} |`);
          }
          L.push('');
          for (const cm of sr.columns) {
            const g = s.columns[cm.id]!.aggs.find((x) => x.field === f.name);
            if (!g || !g.n) continue;
            const preds = [...new Set(Object.values(g.confusion).flatMap((r) => Object.keys(r)))].sort();
            L.push(`<details><summary>confusion · ${cm.id} (rows = truth)</summary>`, '', `| truth \\ pred | ${preds.join(' | ')} |`, `|---|${preds.map(() => '---').join('|')}|`);
            for (const [t, row] of Object.entries(g.confusion)) L.push(`| ${t} | ${preds.map((p) => row[p] ?? 0).join(' | ')} |`);
            L.push('', '</details>', '');
          }
        } else {
          L.push('| Column | Precision | Recall | F1 | Exact cases | Flags |', '|---|---|---|---|---|---|');
          for (const cm of sr.columns) {
            const g = s.columns[cm.id]!.aggs.find((x) => x.field === f.name);
            if (!g?.set) continue;
            L.push(`| ${cm.id} | ${f2(g.set.precision)} | ${f2(g.set.recall)} | ${f2(g.set.f1)} | ${pctS(g.accuracy)} | ${Object.entries(g.set.flags).map(([k, v]) => `${k}=${v}`).join(', ') || '–'} |`);
          }
          L.push('');
        }
      }
    }
    // Per case.
    L.push('### Per case (mean ± sd over repeats)', '');
    const hasAug = sr.columns.some((c) => c.id === 'augmtd');
    L.push(`| Case | ${sr.columns.map((c) => c.id).join(' | ')}${hasAug ? ' | augmtd reasoning tok (per run)' : ''} |`, `|---|${sr.columns.map(() => '---').join('|')}${hasAug ? '|---' : ''}|`);
    for (const cr of sr.cases) {
      const cells = sr.columns.map((cm) => {
        const c = s.columns[cm.id]!;
        const m = c.caseMeans[cr.caseId];
        const preds = sr.scoring === 'labelled' ? live(cr.runs[cm.id]).map((r) => (r.label?.fields ?? []).filter((x) => !x.skipped).map((x) => x.pred).join('/')).join(', ') : '';
        return `${f2(m)} ± ${f2(c.caseSds[cr.caseId])}${preds ? ` · ${cellS(preds)}` : ''}`;
      });
      const truth = sr.scoring === 'labelled' ? ` · truth ${cellS(Object.entries(cr.truth).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${String(v)}`).join(' '))}` : '';
      const augR = hasAug ? ` | ${live(cr.runs.augmtd).map((r) => (r.out.error ? 'err' : String(r.out.reasoningTokens ?? 0))).join(' / ') || '–'}` : '';
      L.push(`| **${cr.caseId}** ${cellS(cr.title)}${truth} | ${cells.join(' | ')}${augR} |`);
    }
    L.push('');
    // Failures.
    const fails: string[] = [];
    for (const cr of sr.cases) for (const [col, runs] of Object.entries(cr.runs)) for (const r of runs ?? []) {
      const lines: string[] = [];
      if (r.out.error) lines.push(`error: ${oneLine(r.out.error)}`);
      for (const ch of r.checks.filter((x) => !x.pass)) lines.push(`check ✗ ${ch.name}${ch.detail ? `: ${oneLine(ch.detail)}` : ''}`);
      if (r.verdict?.error) lines.push(`judge error: ${oneLine(r.verdict.error)}`);
      if (r.verdict?.hardFails?.length) lines.push(`HARD FAIL on condition(s) ${r.verdict.hardFails.join(', ')}`);
      for (const f of r.verdict?.failures ?? []) lines.push(`judge: “${oneLine(f, 200)}”`);
      for (const fs of r.label?.fields ?? []) if (!fs.correct && !fs.skipped) lines.push(`${fs.field}: truth ${fs.truth} · got ${fs.pred}${fs.cost ? ` (cost ${fs.cost})` : ''}`);
      if (lines.length) fails.push(`- **${cr.caseId} · ${col} · r${r.repeat + 1}**: ${lines.join(' · ')}`);
    }
    if (sr.teardownErrors.length) fails.push(`- **teardown**: ${sr.teardownErrors.map((x) => oneLine(x)).join(' · ')}`);
    L.push('<details><summary>Failures and misses</summary>', '', ...(fails.length ? fails : ['None.']), '', '</details>', '');
    // Outputs.
    L.push('<details><summary>Outputs</summary>', '');
    for (const cr of sr.cases) for (const [col, runs] of Object.entries(cr.runs)) for (const r of runs ?? []) {
      if (r.skipped) continue;
      const body = r.out.error ? `ERROR: ${r.out.error}` : (r.out.turns?.length ? r.out.turns.map((t, i) => `[turn ${i + 1}] ${t}`).join('\n\n') : r.out.text) || '(empty)';
      L.push(`**${cr.caseId} · ${col} · r${r.repeat + 1}** (${r.out.calls} call(s), ${r.out.promptTokens}+${r.out.completionTokens} tok, ${r.out.models.join('+') || 'no model'}${r.out.withheld ? ', withheld' : ''}${r.reusedFrom ? `, reused from ${r.reusedFrom}` : ''}):`, '', '```', body.length > 2000 ? `${body.slice(0, 2000)}\n… [${body.length - 2000} more chars]` : body, '```', '');
    }
    L.push('</details>', '');
  }
  return L.join('\n');
}

export type { CaseResult };
