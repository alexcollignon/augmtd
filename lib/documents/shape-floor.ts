// ─── THE SHAPE FLOOR (W38 — the builder always receives the shape it reads) ──────────────────
// Pure + client-safe. Found by the W38 file verifier: the production door resolves the deliverable
// KIND from several signals (a DM's forced kind, deck words in the request) independently of the
// author's CONTENT, and when the author wrote markdown instead of a ```spreadsheet/```slides fence the
// template tier handed a DocContent to the sheet/deck builder — `content.sheets` / `content.slides`
// undefined → the build threw, and the user got no file at all (a DM's tool reported "Generation
// failed"; a delegation dropped its artifact as "non-fatal").
// The floor: markdown that IS tabular becomes a real sheet (its tables, figures kept as numbers);
// markdown under a deck kind becomes real slides (one per section); anything that cannot honestly
// take the asked shape lands as a DOCUMENT — never a crash, never an empty file.
import type { DocContent, PptxContent, XlsxContent, XlsxSheet } from '@/lib/types/inbox';

const isTableLine = (l: string) => { const t = l.trim(); return t.startsWith('|') && t.endsWith('|') && t.length > 2; };
const isSeparator = (l: string) => /^\|?[\s:|-]+\|?$/.test(l.trim()) && l.includes('-');
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/^\*\*(.*)\*\*$/, '$1'));

/** A cell's value: a plain figure (1,240 · 1 240 · 12.5 · 40% stays text) becomes a number. */
export function cellValue(raw: string): string | number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^-?\d{1,3}(?:[,   ]\d{3})+(?:\.\d+)?$/.test(t)) return Number(t.replace(/[,   ]/g, ''));
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return t;
}

/** Every markdown table in a document → sheets (named by their section). Null when there is none. Pure. */
export function docToSheets(doc: DocContent): XlsxContent | null {
  const sheets: XlsxSheet[] = [];
  const used = new Set<string>();
  for (const sec of doc.sections ?? []) {
    const lines = (sec.paragraphs ?? []).join('\n').split('\n');
    let block: string[] = [];
    const flush = () => {
      const rows = block.filter((l) => !isSeparator(l)).map(cells);
      block = [];
      if (rows.length < 2) return;
      const headers = rows[0].map((h, i) => h || `Column ${i + 1}`);
      let name = (sec.heading || doc.title || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
      for (let k = 2; used.has(name.toLowerCase()); k++) name = `${name.slice(0, 28)} ${k}`;
      used.add(name.toLowerCase());
      sheets.push({ name, headers, rows: rows.slice(1).map((r) => headers.map((_, i) => cellValue(r[i] ?? ''))) });
    };
    for (const l of lines) { if (isTableLine(l)) block.push(l); else if (block.length) flush(); }
    if (block.length) flush();
  }
  return sheets.length ? { title: doc.title, sheets } : null;
}

/** A document → a deck: a title slide, then one slide per section (its lines as bullets). Pure. */
export function docToSlides(doc: DocContent): PptxContent | null {
  const strip = (s: string) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
  const slides: PptxContent['slides'] = [{ title: doc.title, layout: 'title' }];
  for (const sec of doc.sections ?? []) {
    const bullets = (sec.paragraphs ?? []).join('\n').split('\n').map(strip)
      .filter((l) => l && !isTableLine(l) && !isSeparator(l))
      .map((l) => (l.length > 160 ? `${l.slice(0, 157).replace(/\s+\S*$/, '')}…` : l))
      .slice(0, 6);
    if (!bullets.length && !sec.heading) continue;
    slides.push({ title: (sec.heading || doc.title).slice(0, 160), layout: 'content', bullets });
  }
  return slides.length > 1 ? { title: doc.title, slides } : null;
}

/** THE CHARACTER-ART FLOOR (W38): an author asked for "a chart" sometimes DRAWS one with characters
 *  ("East : ######## (4,305)") — the content floor then copied it into the compiled file, and the
 *  template tier printed it verbatim. Charts are drawn by code from the data; a line that is a bar or
 *  a rule of characters is not content. Removes such lines (and a fenced block made only of them),
 *  leaving every word and figure line intact. Pure. */
export function stripCharacterArt(markdown: string): string {
  const ART = /[#█■▇▆▅▄▃▂▁=*]{8,}|[█■▇▆▅▄▃▂▁]{3,}/;
  const lines = String(markdown ?? '').split('\n');
  const out: string[] = [];
  let inTyped = false; // a typed ```spreadsheet/```slides fence is data — never touched
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inTyped) { out.push(l); if (/^\s*```\s*$/.test(l)) inTyped = false; continue; }
    if (/^\s*```(spreadsheet|slides)\s*$/.test(l)) { inTyped = true; out.push(l); continue; }
    // A fenced block (not a typed ```spreadsheet/```slides fence) whose non-empty lines are all art → dropped.
    const fence = /^\s*```(\w*)\s*$/.exec(l);
    if (fence && fence[1] !== 'spreadsheet' && fence[1] !== 'slides') {
      const end = lines.findIndex((x, k) => k > i && /^\s*```\s*$/.test(x));
      if (end > i) {
        const body = lines.slice(i + 1, end).filter((x) => x.trim());
        if (body.length && body.every((x) => ART.test(x))) { i = end; continue; }
      }
    }
    if (ART.test(l) && !/^\s*```/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n');
}
