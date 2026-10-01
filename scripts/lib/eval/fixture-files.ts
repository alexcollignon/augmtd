// ════════════════════════════════════════════════════════════════════════════════════════════════
// LABELLED FIXTURE FILES, GENERATED IN CODE (for scripts/eval-ingestion.ts + scripts/eval-retrieval.ts).
// Every file is built from KNOWN content so extraction can be scored against the truth. Generic fake
// content only (Acme, Sam, "a pilot account"). No network, no AI.
//   • text PDF   — hand-written PDF 1.4 (Helvetica, WinAnsi), table cells placed as separate text
//                  objects the way real generators place them; multi-page.
//   • image PDF  — a page image wrapped in a PDF: JPEG (DCTDecode — phone scanners) or raw RGB
//                  (FlateDecode — office scanners / "print to PDF" of a scan).
//   • PNG/JPEG   — text rendered on a canvas, slightly rotated + noisy ("scanned").
//   • DOCX / PPTX / XLSX / CSV / TXT / MD via the libraries the app already depends on.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { deflateSync } from 'zlib';

// ── PDF ──────────────────────────────────────────────────────────────────────────────────────────

/** WinAnsi-encode a JS string into a PDF literal string body (escapes + octal for non-ASCII). */
function pdfString(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c < 127) out += ch;
    else if (c === 0x20ac) out += '\\200';                          // €
    else if (c >= 0xa0 && c <= 0xff) out += '\\' + c.toString(8);  // Latin-1 range = WinAnsi
    else out += '?';
  }
  return out;
}

/** One positioned run of text on a page. */
export type PdfRun = { x: number; y: number; text: string; size?: number; bold?: boolean };

function assemblePdf(objects: string[] | Array<string | Buffer>): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let len = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(len);
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const body = typeof o === 'string' ? Buffer.from(o, 'latin1') : o;
    const tail = Buffer.from('\nendobj\n', 'latin1');
    parts.push(head, body, tail);
    len += head.length + body.length + tail.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

function streamObj(dict: string, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
}

/** A text PDF: pages of positioned runs (A4, points). */
export function makeTextPdf(pages: PdfRun[][]): Buffer {
  // 1 catalog · 2 pages · 3 font · 4 bold font · then per page: page obj + content obj
  const objs: Array<string | Buffer> = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((runs, i) => {
    const content = runs.map((r) => `BT /${r.bold ? 'F2' : 'F1'} ${r.size ?? 10} Tf ${r.x} ${r.y} Td (${pdfString(r.text)}) Tj ET`).join('\n');
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`);
    objs.push(streamObj('', Buffer.from(content, 'latin1')));
  });
  return assemblePdf(objs);
}

/** Lay out a document (paragraph lines + optional tables) as PdfRuns over as many pages as needed. */
export function layoutTextPdf(blocks: Array<{ heading?: string; lines?: string[]; table?: { cols: number[]; rows: string[][] } }>): PdfRun[][] {
  const pages: PdfRun[][] = [[]];
  let y = 790;
  const need = (h: number) => { if (y - h < 60) { pages.push([]); y = 790; } };
  for (const b of blocks) {
    if (b.heading) { need(30); y -= 8; pages[pages.length - 1].push({ x: 56, y, text: b.heading, size: 13, bold: true }); y -= 20; }
    for (const l of b.lines ?? []) { need(14); pages[pages.length - 1].push({ x: 56, y, text: l, size: 10 }); y -= 14; }
    if (b.table) {
      for (const [ri, row] of b.table.rows.entries()) {
        need(16);
        row.forEach((cell, ci) => pages[pages.length - 1].push({ x: b.table!.cols[ci], y, text: cell, size: 10, bold: ri === 0 }));
        y -= 16;
      }
      y -= 6;
    }
  }
  return pages;
}

/** A one-image-per-page PDF (a "scan"). `jpeg` → DCTDecode; `rgb` → FlateDecode raw pixels. */
export function makeImagePdf(images: Array<{ kind: 'jpeg'; data: Buffer; w: number; h: number } | { kind: 'rgb'; data: Buffer; w: number; h: number }>): Buffer {
  const objs: Array<string | Buffer> = [];
  const pageIds = images.map((_, i) => 3 + i * 3);
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`);
  images.forEach((im, i) => {
    const pid = pageIds[i];
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${pid + 2} 0 R >> >> /Contents ${pid + 1} 0 R >>`);
    objs.push(streamObj('', Buffer.from('q 595 0 0 842 0 0 cm /Im0 Do Q', 'latin1')));
    const filter = im.kind === 'jpeg' ? '/DCTDecode' : '/FlateDecode';
    const data = im.kind === 'jpeg' ? im.data : deflateSync(im.data);
    objs.push(streamObj(`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter}`, data));
  });
  return assemblePdf(objs);
}

// ── rendered "scans" ─────────────────────────────────────────────────────────────────────────────

/** Render lines of text onto a white page image, slightly rotated with speckle noise. */
export async function renderScan(lines: string[], o: { w?: number; h?: number; font?: number; rotateDeg?: number; noise?: number } = {}): Promise<{ png: Buffer; jpeg: Buffer; rgb: Buffer; w: number; h: number }> {
  const { createCanvas } = await import('canvas');
  const w = o.w ?? 1240, h = o.h ?? 1754, font = o.font ?? 30;
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#fdfcf8'; x.fillRect(0, 0, w, h);
  x.save();
  x.translate(w / 2, h / 2); x.rotate(((o.rotateDeg ?? 0.8) * Math.PI) / 180); x.translate(-w / 2, -h / 2);
  x.fillStyle = '#1b1b1b'; x.font = `${font}px "Times New Roman", serif`;
  let y = 120;
  for (const l of lines) { x.fillText(l, 110, y); y += Math.round(font * 1.55); }
  x.restore();
  // deterministic speckle
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < (o.noise ?? 1800); i++) x.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 2), 1);
  const img = x.getImageData(0, 0, w, h).data;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < img.length; i += 4, j += 3) { rgb[j] = img[i]; rgb[j + 1] = img[i + 1]; rgb[j + 2] = img[i + 2]; }
  return { png: c.toBuffer('image/png'), jpeg: c.toBuffer('image/jpeg', { quality: 0.8 }), rgb, w, h };
}

// ── Office formats ───────────────────────────────────────────────────────────────────────────────

export async function makeDocx(blocks: Array<{ heading?: string; paras?: string[]; numbered?: string[]; table?: string[][] }>): Promise<Buffer> {
  const d = await import('docx');
  const children: unknown[] = [];
  for (const b of blocks) {
    if (b.heading) children.push(new d.Paragraph({ text: b.heading, heading: d.HeadingLevel.HEADING_1 }));
    for (const p of b.paras ?? []) children.push(new d.Paragraph({ children: [new d.TextRun(p)] }));
    for (const n of b.numbered ?? []) children.push(new d.Paragraph({ text: n, numbering: { reference: 'num', level: 0 } }));
    if (b.table) children.push(new d.Table({ rows: b.table.map((r) => new d.TableRow({ children: r.map((cell) => new d.TableCell({ children: [new d.Paragraph(cell)] })) })) }));
  }
  const doc = new d.Document({
    numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: '%1.', alignment: d.AlignmentType.START }] }] },
    sections: [{ children: children as never[] }],
  });
  return Buffer.from(await d.Packer.toBuffer(doc));
}

export async function makePptx(slides: Array<{ title: string; bullets: string[]; notes?: string }>): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const p = new PptxGenJS();
  for (const s of slides) {
    const sl = p.addSlide();
    sl.addText(s.title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 26, bold: true });
    sl.addText(s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.3, w: 9, h: 4, fontSize: 16 });
    if (s.notes) sl.addNotes(s.notes);
  }
  const out = await p.write({ outputType: 'nodebuffer' });
  return Buffer.from(out as ArrayBuffer);
}

export async function makeXlsx(sheets: Array<{ name: string; rows: Array<Array<string | number | Date>>; formulas?: Array<{ cell: string; f: string; v: number }> }>): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows, { cellDates: true });
    for (const f of s.formulas ?? []) ws[f.cell] = { t: 'n', f: f.f, v: f.v };
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
