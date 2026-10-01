// ─── CHUNK-SUMMARY PARSING (pure, zero AI) ────────────────────────────────────────────────────────
// The indexer asks the summariser for one sentence per chunk. Found Oct 1 (the re-embed sweep stopped on
// a "SUMMARY_FALLBACK 17/25"): Bedrock was healthy — the BATCH CONTRACT was fragile.
//   1. max_tokens was a flat 400 for 8 chunks: dense multilingual chunks (tender lists, figures, accented
//      names) need ~50–60 tokens a sentence, so the JSON array was cut mid-string (finish=length) and the
//      WHOLE batch fell back to raw text.
//   2. A positional array is all-or-nothing: one chunk that read as two topics came back as two strings,
//      the length check failed, and every chunk in the batch fell back.
// The contract is now a KEYED object ({"1": "…", "2": "…"}) with a per-batch token budget; this parser
// salvages every COMPLETE key/value pair (even from a truncated reply), still accepts the legacy array
// when its length matches, and reports which chunks are missing so the caller retries just those.

import { parseModelJSON } from '@/lib/ai/parse-json';

/** Output budget per batch: a generous sentence per chunk plus JSON/fence overhead. */
export const summaryMaxTokens = (n: number): number => 90 * n + 80;

export const summaryPrompt = (filename: string, chunkList: string): string =>
  'Summarize each chunk in ONE sentence (max 25 words). Focus on key facts, entities, dates, and topics. ' +
  'Return ONLY a JSON object mapping each chunk number to its sentence, e.g. {"1": "…", "2": "…"} — exactly one ' +
  `sentence per chunk number, even when a chunk covers several topics.\n\nFile: ${filename}\n\nCHUNKS:\n${chunkList}`;

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length >= 3 ? t : null;
};

/** Map a summariser reply onto `n` chunk slots (index 0..n-1). Missing slots are null. */
export function parseChunkSummaries(raw: string, n: number): Array<string | null> {
  const out: Array<string | null> = new Array(n).fill(null);
  const parsed = parseModelJSON<unknown>(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const i = Number(String(k).replace(/\D/g, '')) - 1;
      if (Number.isInteger(i) && i >= 0 && i < n) out[i] = clean(v);
    }
  } else if (Array.isArray(parsed)) {
    if (parsed.length === n) parsed.forEach((v, i) => { out[i] = clean(v); });
    else if (n === 1 && parsed.length > 1) out[0] = clean(parsed.filter((v) => typeof v === 'string').join(' '));
  }
  // Salvage complete pairs from a reply that did not parse whole (cut off at max_tokens).
  if (out.some((x) => x === null)) {
    const re = /"(\d+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    for (let m = re.exec(raw); m; m = re.exec(raw)) {
      const i = Number(m[1]) - 1;
      if (i >= 0 && i < n && out[i] === null) {
        let v: string | null = null;
        try { v = JSON.parse(`"${m[2]}"`) as string; } catch { v = m[2]; }
        out[i] = clean(v);
      }
    }
  }
  return out;
}

/** A provider refusing for capacity (stop the sweep) vs anything else (record and continue). */
export const isThrottleError = (msg: string): boolean =>
  /ThrottlingException|Too many (tokens|requests)|tokens per day|rate.?limit|\b429\b|ServiceQuotaExceeded/i.test(msg);
