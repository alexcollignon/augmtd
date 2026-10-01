// ════════════════════════════════════════════════════════════════════════════════════════════════
// W38 — THE FILE CHECKER (pure, zero AI). A delivered file is judged IN CODE, never by a model:
// it opens (OOXML is a zip of XML parts — parsed here with jszip + SheetJS, both already deps),
// its declared extension/MIME match its bytes, its structure is there (sheets/columns, slides,
// headings, tables, embedded charts), its formulas are real formulas that evaluate to the source's
// figures, every figure it states traces to the source data, and it carries no placeholder garbage
// ("undefined", "NaN", "[object Object]", lorem ipsum, template braces).
//
// Used by scripts/verify-generated-files.ts (the live suite) and tests/unit/file-check.test.ts.
// Nothing here touches the network or the database.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import JSZip from 'jszip';
import { textHygieneProblems } from '../../lib/documents/office-hygiene';

export type FileFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'html' | 'csv' | 'unknown';

export const MIME_BY_EXT: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  html: 'text/html',
  csv: 'text/csv',
};

/** What the bytes ARE (never what the name says). OOXML kinds by their main part. */
export async function sniffFormat(bytes: Buffer): Promise<FileFormat> {
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x504b0304) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      if (zip.file('word/document.xml')) return 'docx';
      if (zip.file('xl/workbook.xml')) return 'xlsx';
      if (zip.file('ppt/presentation.xml')) return 'pptx';
    } catch { return 'unknown'; }
    return 'unknown';
  }
  const head = bytes.subarray(0, 512).toString('utf8');
  if (head.startsWith('%PDF')) return 'pdf';
  if (/^\s*(<!doctype html|<html|<head|<body)/i.test(head)) return 'html';
  if (/^[^\n,]{1,80}(,[^\n,]{0,80}){1,}\r?\n/.test(head)) return 'csv';
  return 'unknown';
}

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

/** Visible text of a WordprocessingML / DrawingML part: paragraphs on their own lines. */
export function xmlText(xml: string, run: 'w:t' | 'a:t'): string {
  const paraTag = run === 'w:t' ? 'w:p' : 'a:p';
  return xml
    .split(new RegExp(`</${paraTag}>`))
    .map((p) => [...p.matchAll(new RegExp(`<${run}(?:\\s[^>]*)?>([^<]*)</${run}>`, 'g'))].map((m) => decodeXml(m[1])).join(''))
    .map((s) => s.trim()).filter(Boolean).join('\n');
}

export type Cell = { v: string | number | boolean | null; f: string | null };
export type SheetView = { name: string; cells: Record<string, Cell>; rows: Array<Array<string | number | boolean | null>> };

export type FileView = {
  format: FileFormat;
  /** All visible text, one block per part (docx body · each slide · each sheet's cells · html body). */
  text: string;
  docx?: { headings: string[]; tables: number; images: number; paragraphs: number };
  pptx?: { slides: Array<{ title: string; text: string }>; charts: number; images: number; chartValues: number[] };
  xlsx?: { sheets: SheetView[]; formulas: number; charts: number };
  html?: { scripts: number; remoteRefs: string[] };
};

/** Open a file and read its structure. Throws only on bytes that do not open as their format. */
export async function readFileView(bytes: Buffer): Promise<FileView> {
  const format = await sniffFormat(bytes);
  if (format === 'docx') {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    const text = xmlText(xml, 'w:t');
    const paras = xml.split('</w:p>');
    const headings = paras
      .filter((p) => /<w:pStyle w:val="(Heading|Title|heading|Titre)[^"]*"/.test(p) || /<w:outlineLvl /.test(p))
      .map((p) => xmlText(`${p}</w:p>`, 'w:t')).filter(Boolean);
    // Template renderers style headings via HeadingLevel → pStyle Heading1/2; compiled python-docx uses the same.
    const images = Object.keys(zip.files).filter((n) => /^word\/media\//.test(n)).length;
    const tables = (xml.match(/<w:tbl>/g) ?? []).length;
    const extraParts = await Promise.all(Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n)).map((n) => zip.file(n)!.async('string')));
    return { format, text: [text, ...extraParts.map((x) => xmlText(x, 'w:t'))].filter(Boolean).join('\n'), docx: { headings, tables, images, paragraphs: paras.length - 1 } };
  }
  if (format === 'pptx') {
    const zip = await JSZip.loadAsync(bytes);
    const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
    const slides: Array<{ title: string; text: string }> = [];
    for (const n of slideNames) {
      const xml = await zip.file(n)!.async('string');
      // The title: a title placeholder's text when declared, else the first text run on the slide.
      const shapes = xml.split('</p:sp>');
      const titleShape = shapes.find((s) => /<p:ph[^>]*type="(title|ctrTitle)"/.test(s));
      const text = xmlText(xml, 'a:t');
      slides.push({ title: (titleShape ? xmlText(titleShape, 'a:t') : text.split('\n')[0] ?? '').trim(), text });
    }
    const chartNames = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d*\.xml$/.test(n));
    const chartValues: number[] = [];
    for (const n of chartNames) {
      const xml = await zip.file(n)!.async('string');
      for (const vals of xml.matchAll(/<c:val>([\s\S]*?)<\/c:val>/g)) {
        for (const m of vals[1].matchAll(/<c:v>([^<]*)<\/c:v>/g)) { const x = Number(m[1]); if (Number.isFinite(x)) chartValues.push(x); }
      }
    }
    const images = Object.keys(zip.files).filter((n) => /^ppt\/media\//.test(n)).length;
    return { format, text: slides.map((s) => s.text).join('\n'), pptx: { slides, charts: chartNames.length, images, chartValues } };
  }
  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    // sheetStubs: a formula written without a cached value (openpyxl, xlsxwriter) is a stub cell —
    // without the flag SheetJS drops it and a live formula reads as an empty cell.
    const wb = XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellNF: false, cellText: true, sheetStubs: true });
    const sheets: SheetView[] = [];
    let formulas = 0;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const cells: Record<string, Cell> = {};
      for (const [ref, c] of Object.entries(ws)) {
        if (ref.startsWith('!')) continue;
        const cell = c as { v?: unknown; f?: string; t?: string };
        if (cell.t === 'z' && !cell.f) continue;
        if (cell.f) formulas++;
        cells[ref] = { v: (cell.t === 'z' ? null : cell.v ?? null) as Cell['v'], f: cell.f ?? null };
      }
      const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(ws, { header: 1, defval: null, raw: true });
      sheets.push({ name, cells, rows });
    }
    const zip = await JSZip.loadAsync(bytes);
    // A chart is a native chart part OR an embedded picture (the compiler's matplotlib charts).
    const charts = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d*\.xml$/.test(n) || /^xl\/media\//.test(n)).length;
    const text = sheets.map((s) => s.rows.map((r) => r.filter((x) => x != null).join(' | ')).join('\n')).join('\n');
    return { format, text, xlsx: { sheets, formulas, charts } };
  }
  if (format === 'html') {
    const html = bytes.toString('utf8');
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n').split('\n').map((s) => decodeXml(s).trim()).filter(Boolean).join('\n');
    const remoteRefs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)].map((m) => m[1])
      .concat([...html.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/gi)].map((m) => m[1]));
    return { format, text: body, html: { scripts: (html.match(/<script\b/gi) ?? []).length, remoteRefs } };
  }
  // Cells are separated so a figure after a delimiter reads as its own number.
  if (format === 'csv') return { format, text: bytes.toString('utf8').replace(/[,;\t]/g, ' | ') };
  if (format === 'pdf') return { format, text: '' };
  throw new Error('the bytes do not open as any known document format');
}

// ── GARBAGE ─────────────────────────────────────────────────────────────────────────────────────

const GARBAGE: Array<[RegExp, string]> = [
  [/\bundefined\b/, '"undefined"'],
  [/\bNaN\b/, '"NaN"'],
  [/\[object Object\]/, '"[object Object]"'],
  [/\blorem ipsum\b/i, 'lorem ipsum'],
  [/\{\{[^}]*\}\}/, 'an unfilled {{template}} slot'],
  [/\b(?:Infinity)\b/, '"Infinity"'],
  [/#(?:REF!|VALUE!|DIV\/0!|NAME\?|N\/A)/, 'a spreadsheet error value'],
  [/\[(?:INSERT|PLACEHOLDER|TBD|TODO)[^\]]*\]/i, 'a placeholder bracket'],
  [/\bnull\s*(?:,|\n|$)/, 'a bare "null" value'],
];

/** Placeholder garbage in a file's visible text — each hit named once. `syntax` (default on) also
 *  names leaked markdown / ASCII-art (lib/documents/office-hygiene.ts — the product's own gate); off
 *  for formats where | or # are legitimate content (csv, html source). */
export function garbageHits(text: string, opts: { syntax?: boolean } = {}): string[] {
  const t = String(text ?? '');
  const hits = GARBAGE.filter(([re]) => re.test(t)).map(([, label]) => label);
  if (opts.syntax !== false) {
    for (const p of textHygieneProblems(t)) if (!/placeholder garbage/.test(p)) hits.push(p.split(' — ')[0]);
  }
  return hits;
}

// ── NUMBERS ─────────────────────────────────────────────────────────────────────────────────────

/** Every number a reader would see in the text, normalised (1,240 · 1 240 · 1.240,5 · 13 600 €).
 *  Three-digit groups are thousands; a single trailing 1-2 digit group after , or . is decimals. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![\w.,])-?\d{1,3}(?:[   ,.'](?:\d{3}))+(?:[.,]\d{1,2})?(?![\d])|(?<![\w.,])-?\d+(?:[.,]\d+)?(?![\d])/g;
  for (const m of String(text ?? '').matchAll(re)) {
    let s = m[0];
    const grouped = /^-?\d{1,3}(?:[   ,.'](?:\d{3}))+/.exec(s);
    if (grouped && grouped[0].length < s.length) {
      // grouped thousands + decimals: the LAST separator is the decimal mark
      const dec = s.slice(grouped[0].length + 1);
      s = `${grouped[0].replace(/[   ,.']/g, '')}.${dec}`;
    } else if (grouped) {
      s = s.replace(/[   ,.']/g, '');
    } else {
      s = s.replace(',', '.');
    }
    const x = Number(s);
    if (Number.isFinite(x)) out.push(x);
  }
  return out;
}

/** Figures the file states that are NOT derivable from the source. `allowed` is the source's
 *  derivable set (values, row/column totals, differences…); integers in [min, ∞) are judged,
 *  plausible years and small counts are not (they are prose, not figures). */
export function unsourcedFigures(text: string, allowed: number[], opts: { min?: number; tolerance?: number } = {}): number[] {
  const min = opts.min ?? 100;
  const tol = opts.tolerance ?? 0.51;
  const bad = new Set<number>();
  const thresholds = new Set(comparisonThresholds(text));
  for (const x of numbersIn(text)) {
    const a = Math.abs(x);
    if (thresholds.has(x)) continue; // "above 3,000" is a stated threshold, not a claimed figure
    if (a < min) continue;
    if (Number.isInteger(x) && x >= 1990 && x <= 2100) continue; // years
    if (!allowed.some((y) => Math.abs(Math.abs(y) - a) <= tol)) bad.add(x);
  }
  return [...bad];
}

/** Round numbers used as comparison thresholds ("above 3,000", "plus de 1 000", "under 500"). Pure. */
export function comparisonThresholds(text: string): number[] {
  const out: number[] = [];
  const re = /\b(?:above|below|over|under|more than|less than|at least|at most|exceed(?:s|ing)?|beyond|plus de|moins de|au-dessus de|en dessous de|au moins|über|unter|mehr als|weniger als|acima de|abaixo de|mais de|menos de|más de|por encima de|por debajo de)\s+((?:\d{1,3}(?:[ \u00a0\u202f,.']\d{3})+|\d+))/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const n = numbersIn(m[1])[0];
    if (n != null && n % 100 === 0) out.push(n);
  }
  return out;
}

/** Expected figures the text does NOT carry (tolerance for rounding). */
export function missingFigures(text: string, expected: number[], tolerance = 0.51): number[] {
  const have = numbersIn(text);
  return expected.filter((e) => !have.some((h) => Math.abs(h - e) <= tolerance));
}

/** The derivable set of a numeric table: every value, row sums, column sums, the grand total,
 *  row/column means, and every within-row / within-column difference. */
export function derivableFigures(rows: number[][]): number[] {
  const s = new Set<number>();
  const add = (x: number) => { if (Number.isFinite(x)) { s.add(Math.round(x * 100) / 100); s.add(Math.round(x)); } };
  const cols = rows[0]?.length ?? 0;
  let grand = 0;
  for (const r of rows) {
    r.forEach(add);
    const sum = r.reduce((a, b) => a + b, 0); add(sum); add(sum / r.length); grand += sum;
    for (let i = 0; i < r.length; i++) for (let j = 0; j < r.length; j++) if (i !== j) add(r[i] - r[j]);
  }
  for (let c = 0; c < cols; c++) {
    const col = rows.map((r) => r[c]);
    const sum = col.reduce((a, b) => a + b, 0); add(sum); add(sum / col.length);
    for (let i = 0; i < col.length; i++) for (let j = 0; j < col.length; j++) if (i !== j) add(col[i] - col[j]);
  }
  // column-sum differences (quarter-over-quarter totals) and pair sums; the same for row totals,
  // plus each total's gap to the mean of the totals ("905 above the regional average").
  const colSums = Array.from({ length: cols }, (_, c) => rows.reduce((a, r) => a + r[c], 0));
  const rowSums = rows.map((r) => r.reduce((a, b) => a + b, 0));
  for (const sums of [colSums, rowSums]) {
    const mean = sums.reduce((a, b) => a + b, 0) / Math.max(1, sums.length);
    for (let i = 0; i < sums.length; i++) {
      add(sums[i] - mean); add(mean - sums[i]);
      for (let j = 0; j < sums.length; j++) if (i !== j) { add(sums[i] - sums[j]); add(sums[i] + sums[j]); }
    }
  }
  // within-column pair sums (two regions combined in one quarter)
  for (let c = 0; c < cols; c++) for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) add(rows[i][c] + rows[j][c]);
  add(grand); add(grand / Math.max(1, rows.length)); add(grand / Math.max(1, cols)); add(grand / Math.max(1, rows.length * cols));
  return [...s];
}

/** A stated reference figure (a target, a budget) and everything told against it: the reference, its
 *  scalings (per row / per column / overall) and each derivable figure's gap to each of them — e.g.
 *  "267 below target" = 1,400 − the mean per cell (13,600 / 12). Pure. */
export function withReferenceGaps(allowed: number[], refs: number[]): number[] {
  const out = new Set<number>(allowed);
  for (const r of refs) {
    out.add(r);
    for (const a of allowed) { const g = r - a; out.add(Math.round(g * 100) / 100); out.add(Math.round(g)); out.add(-Math.round(g)); out.add(-Math.round(g * 100) / 100); }
  }
  return [...out];
}

// ── FORMULAS ────────────────────────────────────────────────────────────────────────────────────

const colNum = (c: string) => c.toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const colName = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function rangeRefs(a: string, b: string): string[] {
  const pa = /^([A-Z]+)(\d+)$/.exec(a.replace(/\$/g, '')), pb = /^([A-Z]+)(\d+)$/.exec(b.replace(/\$/g, ''));
  if (!pa || !pb) return [];
  const out: string[] = [];
  const [c1, c2] = [colNum(pa[1]), colNum(pb[1])].sort((x, y) => x - y);
  const [r1, r2] = [Number(pa[2]), Number(pb[2])].sort((x, y) => x - y);
  for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) out.push(`${colName(c)}${r}`);
  return out;
}

/**
 * Evaluate a spreadsheet formula over a sheet's cells — the subset documents use: + - * / ( ),
 * cell refs, SUM/AVERAGE/MIN/MAX/COUNT over refs and ranges, ROUND(x, n). Returns null when the
 * formula uses anything else (it is then "present as a formula", not "evaluated"). Never `eval`.
 */
export function evalFormula(formula: string, cells: Record<string, Cell>, depth = 0): number | null {
  if (depth > 20) return null;
  const src = formula.replace(/^=/, '').replace(/\$/g, '').trim();
  let i = 0;
  const value = (ref: string): number | null => {
    const c = cells[ref];
    if (!c) return 0;
    if (c.f) return evalFormula(c.f, cells, depth + 1);
    return typeof c.v === 'number' ? c.v : c.v == null || c.v === '' ? 0 : Number.isFinite(Number(c.v)) ? Number(c.v) : null;
  };
  const ws = () => { while (src[i] === ' ') i++; };
  const args = (): Array<number | null> => {
    const out: Array<number | null> = [];
    ws();
    if (src[i] === ')') { i++; return out; }
    for (;;) {
      ws();
      const rm = /^([A-Z]+\d+):([A-Z]+\d+)/.exec(src.slice(i));
      if (rm) { i += rm[0].length; for (const r of rangeRefs(rm[1], rm[2])) out.push(value(r)); }
      else out.push(expr());
      ws();
      if (src[i] === ',' || src[i] === ';') { i++; continue; }
      if (src[i] === ')') { i++; return out; }
      throw new Error('bad args');
    }
  };
  const atom = (): number | null => {
    ws();
    if (src[i] === '(') { i++; const v = expr(); ws(); if (src[i] !== ')') throw new Error('paren'); i++; return v; }
    if (src[i] === '-') { i++; const v = atom(); return v == null ? null : -v; }
    const fm = /^([A-Z]+)\(/.exec(src.slice(i));
    if (fm) {
      i += fm[0].length;
      const xs = args();
      if (xs.some((x) => x == null)) return null;
      const n = xs as number[];
      switch (fm[1]) {
        case 'SUM': return n.reduce((a, b) => a + b, 0);
        case 'AVERAGE': return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
        case 'MIN': return n.length ? Math.min(...n) : null;
        case 'MAX': return n.length ? Math.max(...n) : null;
        case 'COUNT': return n.length;
        case 'ROUND': return n.length === 2 ? Math.round(n[0] * 10 ** n[1]) / 10 ** n[1] : null;
        default: throw new Error('unsupported fn');
      }
    }
    const rm = /^([A-Z]+\d+)/.exec(src.slice(i));
    if (rm) { i += rm[0].length; return value(rm[1]); }
    const nm = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (nm) { i += nm[0].length; return Number(nm[0]); }
    throw new Error('unsupported token');
  };
  const term = (): number | null => {
    let v = atom();
    for (;;) {
      ws();
      const op = src[i];
      if (op !== '*' && op !== '/') return v;
      i++;
      const r = atom();
      v = v == null || r == null ? null : op === '*' ? v * r : r === 0 ? null : v / r;
    }
  };
  const expr = (): number | null => {
    let v = term();
    for (;;) {
      ws();
      const op = src[i];
      if (op !== '+' && op !== '-') return v;
      i++;
      const r = term();
      v = v == null || r == null ? null : op === '+' ? v + r : v - r;
    }
  };
  try {
    const v = expr();
    ws();
    return i === src.length ? v : null;
  } catch { return null; }
}

/** Every formula in a sheet, evaluated (null = present but outside the evaluable subset). */
export function evaluateSheetFormulas(sheet: SheetView): Array<{ ref: string; f: string; value: number | null }> {
  return Object.entries(sheet.cells).filter(([, c]) => c.f).map(([ref, c]) => ({ ref, f: c.f!, value: evalFormula(c.f!, sheet.cells) }));
}

// ── LANGUAGE ────────────────────────────────────────────────────────────────────────────────────

const STOP: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'for', 'with', 'this', 'that', 'by', 'are'],
  fr: ['le', 'la', 'les', 'et', 'des', 'du', 'en', 'est', 'pour', 'une', 'dans', 'sur', 'au', 'par'],
  de: ['der', 'die', 'das', 'und', 'ist', 'mit', 'für', 'den', 'von', 'zu', 'im', 'auf'],
  pt: ['o', 'os', 'da', 'do', 'das', 'dos', 'em', 'para', 'com', 'uma', 'por', 'não'],
  es: ['el', 'los', 'las', 'y', 'del', 'en', 'para', 'con', 'una', 'por', 'es', 'que'],
};

/** The dominant language of a text by stop-word share, or null when there is too little prose. */
export function guessLanguage(text: string): string | null {
  const words = String(text ?? '').toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 20) return null;
  let best: string | null = null; let bestN = 0;
  for (const [lang, stops] of Object.entries(STOP)) {
    const set = new Set(stops);
    const n = words.filter((w) => set.has(w)).length;
    if (n > bestN) { best = lang; bestN = n; }
  }
  return bestN >= 3 ? best : null;
}

// ── IDENTITY / NAMING ───────────────────────────────────────────────────────────────────────────

/** Email addresses in the file that are NOT on a reserved test domain (.test/.example/.invalid/
 *  example.com|org|net) — a probe-account file carrying any other address leaked real data. */
export function nonTestAddresses(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? '').matchAll(/[\w.+-]+@([\w-]+\.)+[a-z]{2,}/gi)) {
    const a = m[0].toLowerCase();
    if (/\.(test|example|invalid|localhost)$/.test(a) || /@example\.(com|org|net)$/.test(a)) continue;
    out.add(a);
  }
  return [...out];
}

/** A title/filename is not a raw mid-word cut of the request it came from. */
export function isMidWordClip(title: string, request: string): boolean {
  const t = String(title ?? '').trim(); const r = String(request ?? '').trim();
  if (!t || t.length >= r.length || !r.startsWith(t)) return false;
  return /[\p{L}\p{N}]/u.test(r[t.length] ?? '') && /[\p{L}\p{N}]$/u.test(t);
}

/** Ext + MIME + bytes agree. Returns problems (empty = consistent). */
export function formatConsistency(format: FileFormat, ext: string, mime: string | null): string[] {
  const p: string[] = [];
  const e = ext.replace(/^\./, '').toLowerCase();
  if (format !== e) p.push(`bytes are ${format} but the extension says .${e}`);
  const want = MIME_BY_EXT[e];
  if (mime != null && want && mime.split(';')[0].trim().toLowerCase() !== want) p.push(`MIME ${mime} ≠ ${want}`);
  return p;
}

/** File size sanity per format (bytes). */
export function sizeProblem(format: FileFormat, size: number): string | null {
  const min: Record<string, number> = { docx: 3000, xlsx: 2500, pptx: 15000, html: 300, csv: 20, pdf: 500 };
  if (size < (min[format] ?? 1)) return `${size} bytes is too small for a real .${format}`;
  if (size > 20 * 1024 * 1024) return `${size} bytes exceeds 20 MB`;
  return null;
}
