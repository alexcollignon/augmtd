// ════════════════════════════════════════════════════════════════════════════════════════════════
// W35 · FIGURES ON RECORD — two values, both named, as a FACT (docs/laws-registry.md `figures-on-record`).
//
// The conduct rule (lib/ai/conduct.ts CONDUCT_RULES.conflicting_values) tells every writer to name both
// of two conflicting values. A rule is a hope: the room's opening on the standard tier still framed the
// newer of two budget figures as REPLACING the older ("Lee updated the budget to €45,000") and made
// adopting it the move. The grounding now carries the figures themselves, code-read: every money amount
// the room's messages state, with WHO wrote it, WHEN, and the clause it sits in — so two amounts in the
// same currency sit side by side as data before any model reads the thread. Code does not decide that
// two amounts are "for the same thing" (that is judgment); it only makes the pair impossible to miss.
//
// Agnostic by construction: currency SYMBOLS and ISO codes, digits in any grouping (1,200 · 1.200 ·
// 1 200 · 1200,50), a k/m suffix — no vocabulary of any language. PURE, zero IO, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type FigureSource = { who: string; at: string | null; text: string };
export type Figure = { currency: string; value: number; raw: string; who: string; at: string | null; clause: string };

const SYMBOL: Record<string, string> = { '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'R$': 'BRL', 'CHF': 'CHF' };
const CODES = 'EUR|USD|GBP|CHF|JPY|INR|BRL|CAD|AUD|SEK|NOK|DKK|PLN|CZK|AED|SAR|EGP|MYR|SGD|ZAR';
const NUM = String.raw`\d{1,3}(?:[.,\s  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const SUFFIX = String.raw`(?:\s?(?:k|K|m|M)\b)?`;
// symbol/code BEFORE the number, or AFTER it.
const BEFORE = new RegExp(String.raw`(R\$|€|\$|£|¥|₹|\b(?:${CODES})\b)\s?(${NUM})(${SUFFIX})`, 'g');
const AFTER = new RegExp(String.raw`(${NUM})(${SUFFIX})\s?(€|\b(?:${CODES})\b)`, 'g');

/** "40,000" / "40.000" / "40 000" / "1.200,50" / "45k" → a number (null when unreadable). Pure. */
export function amountOf(num: string, suffix = ''): number | null {
  let n = num.replace(/[\s  ]/g, '');
  const lastSep = Math.max(n.lastIndexOf(','), n.lastIndexOf('.'));
  // A trailing 1–2 digit group after the last separator is a decimal part; a 3-digit one is grouping.
  if (lastSep >= 0 && n.length - lastSep - 1 <= 2) n = `${n.slice(0, lastSep).replace(/[.,]/g, '')}.${n.slice(lastSep + 1)}`;
  else n = n.replace(/[.,]/g, '');
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const s = suffix.trim().toLowerCase();
  return s === 'k' ? v * 1_000 : s === 'm' ? v * 1_000_000 : v;
}

/** The clause an amount sits in: its sentence, trimmed to a readable window around it. Pure. */
function clauseAround(text: string, index: number): string {
  // A sentence ends at . ! ? followed by a space or the end (never the point inside "1,200.50"), or a newline.
  const bounds = [...text.matchAll(/[.!?](?=\s|$)|\n/g)].map((m) => m.index ?? 0);
  const start = bounds.filter((b) => b < index).reduce((a, b) => Math.max(a, b + 1), 0);
  const end = bounds.find((b) => b >= index) ?? text.length;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** Every money amount stated in these messages, in order. Pure. */
export function figuresIn(sources: FigureSource[]): Figure[] {
  const out: Figure[] = [];
  for (const src of sources) {
    const text = String(src.text ?? '');
    const seen = new Set<number>();
    for (const m of text.matchAll(BEFORE)) {
      const value = amountOf(m[2], m[3]);
      if (value == null || value <= 0) continue;
      seen.add(m.index ?? 0);
      out.push({ currency: SYMBOL[m[1]] ?? m[1].toUpperCase(), value, raw: m[0].trim(), who: src.who, at: src.at, clause: clauseAround(text, m.index ?? 0) });
    }
    for (const m of text.matchAll(AFTER)) {
      if ([...seen].some((i) => Math.abs(i - (m.index ?? 0)) < 3)) continue;
      const value = amountOf(m[1], m[2]);
      if (value == null || value <= 0) continue;
      out.push({ currency: SYMBOL[m[3]] ?? m[3].toUpperCase(), value, raw: m[0].trim(), who: src.who, at: src.at, clause: clauseAround(text, m.index ?? 0) });
    }
  }
  return out;
}

/**
 * THE FIGURES WORTH STATING (pure): only a currency in which the messages state TWO OR MORE DIFFERENT
 * amounts — the case where a writer can mistake one for the other's replacement. One amount, or the same
 * amount repeated, needs no block. Bounded (`max` figures), newest last.
 */
export function figuresOnRecord(sources: FigureSource[], max = 6): Figure[] {
  const all = figuresIn(sources);
  const byCur = new Map<string, Figure[]>();
  for (const f of all) byCur.set(f.currency, [...(byCur.get(f.currency) ?? []), f]);
  const keep: Figure[] = [];
  for (const list of byCur.values()) {
    if (new Set(list.map((f) => f.value)).size >= 2) keep.push(...list);
  }
  return keep.slice(-max);
}
