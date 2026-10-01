// ════════════════════════════════════════════════════════════════════════════════════════════════
// KB SEARCH RANKING — the pure half of lib/knowledge/search.ts (eval-retrieval, Oct 1). Measured on a
// labelled corpus (scripts/eval-retrieval.ts); every rule here fixed a class of misses there:
//   • THE NAME IS EVIDENCE — a file whose NAME strongly carries the query ("DPA", "T&E policy",
//     "SOW-ACME-07") joins the candidates and is fused as a third ranked list (search.ts).
//   • THE EXACT TOKEN IS EVIDENCE — a number/code the user typed ("318.75") found verbatim in a
//     candidate's text ranks it in a fourth fused list (two near-identical invoices, one carries it).
//   • AN ACRONYM MATCHES ITS SPELLING-OUT — the entity gate's "MFA" is mentioned by "multi-factor
//     authentication" (it used to gate out the very policy that answered).
//   • THE CURRENT VERSION LEADS — two files whose names differ only by a version marker or a year
//     ("Pricing Policy v1 (2025)" / "… v2 (2026)") are one family; unless the query names a version,
//     the newest member takes the family's best rank and the older ones follow it.
//   (Measured and REJECTED: OR-ing the keyword side's words — Postgres ts_rank has no IDF, so common
//   words like "policy"/"days" flooded the keyword list; recall@1 fell 95% → 78%.)
// No I/O. Unit-tested in tests/unit/kb-rank.test.ts.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const STOP = new Set([
  // en
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'is', 'are', 'be', 'was',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'do', 'does', 'did', 'our', 'my', 'we', 'i', 'me', 'us',
  'this', 'that', 'these', 'those', 'it', 'its', 'any', 'all', 'about', 'there', 'their', 'can', 'should', 'must',
  'many', 'much', 'last', 'latest', 'current', 'new', 'find', 'show', 'get', 'give', 'need', 'please', 'file', 'files',
  'document', 'documents', 'doc', 'docs', 'pdf', 'copy',
  // fr / pt / es / de (the common function words)
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'en', 'au', 'aux', 'pour', 'par', 'sur', 'avec',
  'o', 'os', 'as', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por', 'com',
  'el', 'los', 'las', 'del', 'y', 'con', 'una', 'que',
  'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'und', 'oder', 'mit', 'von', 'zu', 'im', 'fur',
]);

const fold = (s: string) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Tokens of a name or query: letters/digits, keeping an inner `&` ("t&e") — folded. */
export function nameTokens(s: string): string[] {
  return fold(s).split(/[^\p{L}\p{N}&]+/u).map((t) => t.replace(/^&+|&+$/g, '')).filter(Boolean);
}

/** The query's content tokens (stop words and 1-char tokens out). */
export function queryContentTokens(query: string): string[] {
  return [...new Set(nameTokens(query).filter((t) => t.length >= 2 && !STOP.has(t)))];
}

/** True when the token reads as an identifier: ALL-CAPS (≥ 2), letter+digit code, or `&` inside. */
function isIdentifier(raw: string): boolean {
  return /^[A-Z]{2,}s?$/.test(raw) || /\d/.test(raw) && /\p{L}/u.test(raw) || /\p{L}&\p{L}/u.test(raw);
}

/** How strongly a file's NAME answers the query, 0..1: the squared share of the query's content
 *  tokens the name carries (a name echoing one word of a long question barely counts), plus a lift
 *  when an identifier the user typed (an acronym, a code) is a token of the name. Pure. */
export function nameAffinity(query: string, filename: string): number {
  const q = queryContentTokens(query);
  if (!q.length) return 0;
  const base = String(filename ?? '').replace(/\.[a-z0-9]{1,5}$/i, '');
  const name = new Set(nameTokens(base));
  // Plural-tolerant: "okrs" in the query finds "okr" in a name and vice versa.
  const has = (t: string) => name.has(t) || name.has(t.replace(/s$/, '')) || name.has(`${t}s`);
  const hits = q.filter(has).length;
  const coverage = hits / q.length;
  const ids = String(query ?? '').split(/[\s,;:()"'’?!]+/).filter((r) => r && isIdentifier(r)).map((r) => nameTokens(r).join('&'));
  const idHit = ids.some((id) => id && (has(id) || nameTokens(base).join('-').includes(id.replace(/&/g, '-'))));
  return Math.min(1, coverage * coverage + (idHit ? 0.5 : 0));
}

// ── versions ─────────────────────────────────────────────────────────────────────────────────────

export type VersionInfo = { family: string; version: number | null; year: number | null; marker: boolean };

// Lookarounds, not \b: `_` is a word character, and names are full of them ("DPA_Acme_v3").
const VERSION_RE = /(?<![\p{L}\d])(?:v|ver|version|rev|revision)\s*\.?\s*(\d+(?:\.\d+)?)(?![\d])/iu;
const YEAR_RE = /(?<!\d)((?:19|20)\d{2})(?!\d)/;
const FULL_DATE_RE = /(?<!\d)(?:19|20)\d{2}[-_.](?:0?[1-9]|1[0-2])[-_.](?:0?[1-9]|[12]\d|3[01])(?!\d)|(?<!\d)(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?!\d)/;
const STAGE: Record<string, number> = { draft: 0, old: 0, superseded: 0, updated: 2, final: 3, signed: 3 };

/** A file name's version family + its version / year. Names with a FULL DATE are dated records
 *  (minutes, statements), never versions of each other → no family (family ''). Pure. */
export function versionInfo(filename: string): VersionInfo {
  const base = String(filename ?? '').replace(/\.[a-z0-9]{1,5}$/i, '');
  if (FULL_DATE_RE.test(base)) return { family: '', version: null, year: null, marker: false };
  const v = VERSION_RE.exec(base);
  const y = YEAR_RE.exec(base);
  const words = nameTokens(base);
  const stage = words.map((w) => STAGE[w]).find((s) => s !== undefined);
  const family = nameTokens(base
    .replace(new RegExp(VERSION_RE.source, 'giu'), ' ')
    .replace(new RegExp(YEAR_RE.source, 'g'), ' '))
    .filter((w) => STAGE[w] === undefined && !/^\d{1,2}$/.test(w)).join(' ');
  return {
    family,
    version: v ? Number(v[1]) : stage !== undefined ? stage / 10 : null,
    year: y ? Number(y[1]) : null,
    marker: !!v || stage !== undefined || !!y,
  };
}

/** Versions / years the query itself names ("v1", "version 2", "2025"). Pure. */
export function namedVersions(query: string): { versions: number[]; years: number[] } {
  const q = String(query ?? '');
  const versions = [...q.matchAll(new RegExp(VERSION_RE.source, 'giu'))].map((m) => Number(m[1]));
  const years = [...q.matchAll(new RegExp(YEAR_RE.source, 'g'))].map((m) => Number(m[1]));
  return { versions, years };
}

/**
 * Reorder ranked items so that, inside each version family present, the CURRENT member leads: the
 * member the query names (by version or year) if any, else the newest (version number, then year
 * in the name, then the file's own modified date). The leader takes the family's best slot and the
 * other members follow it directly; non-family items keep their places. Pure.
 */
export function preferCurrentVersion<T>(
  items: T[], query: string,
  get: (t: T) => { filename: string; modifiedAt?: string | null },
): T[] {
  const infos = items.map((t) => ({ t, ...versionInfo(get(t).filename), at: Date.parse(String(get(t).modifiedAt ?? '')) || 0 }));
  const families = new Map<string, typeof infos>();
  for (const i of infos) if (i.family) families.set(i.family, [...(families.get(i.family) ?? []), i]);
  const named = namedVersions(query);
  const out = [...items];
  // Newest first: by version when both carry one, else by the year in the name, else by date.
  const newer = (a: (typeof infos)[number], b: (typeof infos)[number]) =>
    a.version !== null && b.version !== null && a.version !== b.version ? b.version - a.version
      : a.year !== null && b.year !== null && a.year !== b.year ? b.year - a.year
        : b.at - a.at;
  for (const members of families.values()) {
    // A family needs two members and at least one explicit marker (a plain name twice is a dupe).
    if (members.length < 2 || !members.some((m) => m.marker)) continue;
    const pick = members.find((m) => (m.version !== null && named.versions.includes(m.version)))
      ?? members.find((m) => m.year !== null && named.years.includes(m.year))
      ?? [...members].sort(newer)[0];
    const slots = members.map((m) => out.indexOf(m.t)).sort((a, b) => a - b);
    const ordered = [pick, ...members.filter((m) => m !== pick).sort((a, b) => out.indexOf(a.t) - out.indexOf(b.t))];
    // the family keeps its first slot for the leader; the rest follow directly after it
    const first = slots[0];
    const rest = out.filter((x) => !members.some((m) => m.t === x));
    rest.splice(Math.min(first, rest.length), 0, ...ordered.map((m) => m.t));
    out.splice(0, out.length, ...rest);
  }
  return out;
}

// ── the entity gate's matcher ────────────────────────────────────────────────────────────────────

/** Does the text mention the identifier? Verbatim (case-blind), or — for an ALL-CAPS acronym of
 *  3+ letters — spelled out: the initials of consecutive words (hyphen parts count as words), so
 *  "MFA" is mentioned by "multi-factor authentication" and "KYC" by "Know Your Customer". Pure. */
export function mentionsEntity(text: string, entity: string): boolean {
  const hay = String(text ?? '').toLowerCase();
  const e = String(entity ?? '').toLowerCase();
  if (!e) return false;
  if (hay.includes(e)) return true;
  if (!/^[A-Z]{3,}$/.test(entity)) return false;
  const initials = fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w[0]).join('');
  return initials.includes(e);
}

/** The exact tokens of a query that only a document carrying them verbatim can answer: numbers of
 *  3+ digits or with a decimal mark ("318.75", "4417") and letter+digit codes ("INV-2026-0417",
 *  "Z100"). Lower-cased. Pure. */
export function queryIdentifiers(query: string): string[] {
  const raw = String(query ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}.,\-/]*[\p{L}\p{N}]|\p{N}+/gu) ?? [];
  return [...new Set(raw.filter((t) => (/^\d[\d.,]*$/.test(t) && (/\d[.,]\d/.test(t) || t.replace(/\D/g, '').length >= 3))
    || (/\d/.test(t) && /\p{L}/u.test(t))).map((t) => t.toLowerCase()))];
}
