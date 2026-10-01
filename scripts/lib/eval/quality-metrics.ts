// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NON-GENERATIVE QUALITY METRICS (pure, zero-AI) — shared by the three labelled live suites:
//   scripts/eval-retrieval.ts      recall@k · MRR · wrong-version rate (KB search)
//   scripts/eval-ingestion.ts      word/char accuracy · numbers exact · table rows kept · truncation
//   scripts/eval-transcription.ts  word error rate · numbers/dates kept · latency
// Unit-tested in tests/unit/quality-metrics.test.ts. No I/O here, ever.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const stripMarks = (s: string) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Fold for comparison: NFKD, lower-case, strip diacritics, punctuation → space, collapse spaces.
 *  A THOUSANDS separator (a mark followed by exactly three digits, then no digit) is folded out —
 *  "4,318.75" and "4318.75" compare equal — while a list separator ("182500,184250.5") and a plain
 *  space ("1 318.75" = two numbers) are not. */
export function foldText(s: string): string {
  return stripMarks(s)
    .replace(/(\d)[.,'](?=\d{3}(?!\d))/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const isAlnum = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
/** A regex that finds `token` in raw text: case/diacritic-blind, any (or no) grouping/decimal mark
 *  between digits, any punctuation run where the token has punctuation, alnum boundaries. */
export function tokenPattern(token: string): RegExp {
  const t = stripMarks(token).trim();
  let src = '';
  for (let i = 0; i < t.length; i++) {
    // A bare run of 4+ digits may print with thousands marks ("12600" ↔ "12.600" / "12 600").
    const run = /^\d{4,}/.exec(t.slice(i))?.[0];
    if (run && !/\d/.test(t[i - 1] ?? '')) {
      const head = run.length % 3 || 3;
      src += run.slice(0, head) + (run.slice(head).match(/\d{3}/g) ?? []).map((g) => `[.,'\\s\\u00a0\\u202f]?${g}`).join('');
      i += run.length - 1;
      continue;
    }
    if (isAlnum(t[i])) { src += t[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    let j = i;
    while (j < t.length && !isAlnum(t[j])) j++;
    const betweenDigits = /\d/.test(t[i - 1] ?? '') && /\d/.test(t[j] ?? '') && j - i === 1 && /[.,'\s\u00a0\u202f]/.test(t[i]);
    src += betweenDigits ? "[.,'\\s\\u00a0\\u202f]?" : '[^\\p{L}\\p{N}]*';
    i = j - 1;
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${src}(?![\\p{L}\\p{N}])`, 'u');
}

export const words = (s: string): string[] => foldText(s).split(' ').filter(Boolean);

/** Levenshtein distance over arbitrary token arrays (two-row DP). */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Word error rate of a hypothesis against a reference (both folded). 0 = perfect; can exceed 1. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const r = words(reference), h = words(hypothesis);
  if (!r.length) return h.length ? 1 : 0;
  return editDistance(r, h) / r.length;
}

/** Character accuracy = 1 − CER over folded text (spaces kept as separators). Floored at 0. */
export function charAccuracy(reference: string, hypothesis: string): number {
  const r = [...foldText(reference)], h = [...foldText(hypothesis)];
  if (!r.length) return h.length ? 0 : 1;
  return Math.max(0, 1 - editDistance(r, h) / r.length);
}

/** Share of the reference's words that appear in the hypothesis (bag-of-words recall, order-free —
 *  extraction may legitimately reorder table cells / slide boxes). */
export function wordRecall(reference: string, hypothesis: string): number {
  const r = words(reference);
  if (!r.length) return 1;
  const bag = new Map<string, number>();
  for (const w of words(hypothesis)) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of r) { const n = bag.get(w) ?? 0; if (n > 0) { hit++; bag.set(w, n - 1); } }
  return hit / r.length;
}

/** Which expected tokens (numbers, codes, dates — compared folded) are present in the text. */
export function tokensKept(expected: readonly string[], text: string): { kept: string[]; lost: string[] } {
  const hay = stripMarks(text);
  const kept: string[] = [], lost: string[] = [];
  for (const t of expected) (tokenPattern(t).test(hay) ? kept : lost).push(t);
  return { kept, lost };
}

/** Table rows kept: a row counts when all of its cells appear, in order, on one line of the text. */
export function tableRowsKept(rows: readonly (readonly string[])[], text: string): { kept: number; total: number; lostRows: string[] } {
  const lines = String(text ?? '').split(/\n/).map((l) => ` ${foldText(l)} `);
  let kept = 0;
  const lostRows: string[] = [];
  for (const row of rows) {
    const cells = row.map((c) => foldText(c)).filter(Boolean);
    const ok = lines.some((l) => {
      let at = 0;
      for (const c of cells) { const i = l.indexOf(` ${c} `, at); if (i < 0) return false; at = i + c.length + 1; }
      return true;
    });
    if (ok) kept++; else lostRows.push(row.join(' | '));
  }
  return { kept, total: rows.length, lostRows };
}

// ── retrieval ────────────────────────────────────────────────────────────────────────────────────

/** 1-based rank of the first relevant id in a ranked list; null when absent. */
export function firstRelevantRank(ranked: readonly string[], relevant: readonly string[]): number | null {
  const want = new Set(relevant);
  const i = ranked.findIndex((id) => want.has(id));
  return i < 0 ? null : i + 1;
}

export type RetrievalCase = { ranked: readonly string[]; relevant: readonly string[]; /** ids that are the WRONG version of the asked doc */ wrongVersion?: readonly string[] };

export type RetrievalScore = { n: number; recall1: number; recall3: number; mrr: number; wrongVersionRate: number | null; versionCases: number };

/** recall@1, recall@3, MRR over cases; wrong-version rate = share of version cases whose #1 is a
 *  wrong-version id (null when the set has no version cases). */
export function scoreRetrieval(cases: readonly RetrievalCase[]): RetrievalScore {
  let r1 = 0, r3 = 0, rr = 0, vc = 0, vw = 0;
  for (const c of cases) {
    const k = firstRelevantRank(c.ranked, c.relevant);
    if (k === 1) r1++;
    if (k !== null && k <= 3) r3++;
    if (k !== null) rr += 1 / k;
    if (c.wrongVersion?.length) { vc++; if (c.wrongVersion.includes(c.ranked[0] ?? '')) vw++; }
  }
  const n = cases.length || 1;
  return { n: cases.length, recall1: r1 / n, recall3: r3 / n, mrr: rr / n, wrongVersionRate: vc ? vw / vc : null, versionCases: vc };
}

/** Percentile (nearest-rank) of a list of numbers; NaN for an empty list. */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export const pct = (x: number | null): string => (x === null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`);
