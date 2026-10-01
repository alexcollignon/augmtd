export type AttachmentMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword'
  | 'text/plain'
  | string;

// Deterministic HTML→markdown for mammoth's docx output (h1-h6 · p · ul/ol/li · table ·
// strong/em · br). No dependency, no AI — structure either maps or degrades to plain text.
export function htmlToMarkdown(html: string): string {
  let h = html.replace(/\r/g, '');
  const inner = (s: string) => s
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
  // Tables → markdown tables (header from the first row; forms live in tables).
  h = h.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
    const rows = [...tbl.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => inner(c[1]).replace(/\n+/g, ' ')));
    if (!rows.length) return '';
    const md = [`| ${rows[0].join(' | ')} |`, `|${rows[0].map(() => '---').join('|')}|`,
      ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)];
    return `\n${md.join('\n')}\n`;
  });
  // Lists → markdown items (ordered numbering preserved).
  h = h.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, body: string) => {
    let n = 0;
    return '\n' + body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, li: string) => `${++n}. ${inner(li)}\n`) + '\n';
  });
  h = h.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, body: string) =>
    '\n' + body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, li: string) => `- ${inner(li)}\n`) + '\n');
  // Headings + paragraphs.
  h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl: string, body: string) =>
    `\n${'#'.repeat(Math.min(Number(lvl), 6))} ${inner(body)}\n`);
  h = h.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, body: string) => `\n${inner(body)}\n`);
  return inner(h).replace(/\n{3,}/g, '\n\n');
}

export async function extractTextFromAttachment(
  buffer: Buffer,
  mimeType: AttachmentMimeType,
  filename: string
): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      // THE LINES SURVIVE (eval-ingestion, Oct 1): `mergePages: true` collapses every newline of the
      // document into a space — a 40-page PDF became ONE line, so a table's rows ran together and the
      // chunker (which splits on blank lines) saw one paragraph. Pages keep their lines; pages are
      // separated by a blank line.
      const pages = await extractPdfPages(buffer);
      return pages.join('\n\n').trim() || null;
    }

    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      // THE FIDELITY CHAIN (document hands slice 2, Aug 11): raw-text extraction flattened
      // headings, tables, and numbering — so a "fill this in" delegation never SAW the form's
      // structure and couldn't mirror it. Convert to HTML and down to markdown so structure
      // survives INTO the material; the structured renderer (slice 1) carries it back OUT.
      const mammoth = await import('mammoth');
      try {
        const html = await mammoth.convertToHtml({ buffer });
        const md = htmlToMarkdown(html.value || '');
        if (md.trim()) return md.trim();
      } catch { /* fall through to raw text — structure is an enhancement, text is the floor */ }
      const result = await mammoth.extractRawText({ buffer });
      return result.value || null;
    }

    if (mimeType === 'application/msword') {
      // Legacy .doc format — skip gracefully
      console.log(`[Attachments] Skipped legacy .doc format: ${filename}`);
      return null;
    }

    // Every plain-text family member reads as UTF-8 text (BOM dropped): markdown, CSV, JSON, … — a
    // `.md` used to come back null ("unsupported") while the supply door accepted it (eval-ingestion).
    if (isPlainTextMime(mimeType, filename)) {
      return decodeUtf8(buffer) || null;
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = workbook.SheetNames.map((name: string) => {
        return `Sheet "${name}":\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`;
      });
      return sheets.join('\n\n') || null;
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buffer);
      // Slides in DECK order (slide2 before slide10 — a string sort put 10–19 after 1), one line per
      // paragraph, table rows as `a | b | c`, XML entities decoded (eval-ingestion, Oct 1).
      const slideNo = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => slideNo(a) - slideNo(b));
      const slideTexts: string[] = [];
      for (const slidePath of slideFiles) {
        const xml = await zip.files[slidePath].async('text');
        const text = pptxSlideText(xml);
        if (text) slideTexts.push(`## Slide ${slideNo(slidePath)}\n${text}`);
      }
      return slideTexts.join('\n\n') || null;
    }

    // Images, unsupported, etc.
    console.log(`[Attachments] Skipped unsupported MIME type: ${mimeType} (${filename})`);
    return null;
  } catch (err) {
    console.error(`[Attachments] Failed to extract text from ${filename}:`, err);
    return null;
  }
}

/** A PDF's text, one string per page, each page keeping its line breaks (pdfjs `hasEOL`). */
export async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [String(text ?? '')]).map((t) => t.replace(/[ \t]+\n/g, '\n').trim());
}

const PLAIN_TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml']);
/** text/* (but not HTML — markup is not text), JSON, or a plain-text extension behind an unhelpful
 *  octet-stream mime. Pure. */
export function isPlainTextMime(mimeType: string, filename: string): boolean {
  const m = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (m === 'text/html' || m === 'application/xhtml+xml') return false;
  if (m.startsWith('text/') || m === 'application/json') return true;
  const ext = String(filename || '').toLowerCase().split('.').pop() ?? '';
  return (m === '' || m === 'application/octet-stream') && PLAIN_TEXT_EXT.has(ext);
}

/** UTF-8 decode with the byte-order mark dropped. Pure. */
export function decodeUtf8(buffer: Buffer): string {
  const s = buffer.toString('utf-8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Decode the five XML entities + numeric character references. Pure. */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** One slide's text: a line per DrawingML paragraph (`<a:p>`), `<a:br/>` as a line break, a table
 *  row (`<a:tr>`) as one `cell | cell` line, entities decoded. Pure. */
export function pptxSlideText(xml: string): string {
  const paraText = (p: string) => [...p.matchAll(/<a:br\s*\/>|<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((m) => (m[0].startsWith('<a:br') ? '\n' : decodeXmlEntities(m[1] ?? ''))).join('');
  const paras = (x: string) => [...x.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map((m) => paraText(m[1]).trim()).filter(Boolean);
  const lines: string[] = [];
  // Tables first become placeholders so their cells read as rows, not as one paragraph per cell.
  const rows: string[] = [];
  const body = xml.replace(/<a:tr(?:\s[^>]*)?>([\s\S]*?)<\/a:tr>/g, (_, tr: string) => {
    const cells = [...tr.matchAll(/<a:tc(?:\s[^>]*)?>([\s\S]*?)<\/a:tc>/g)].map((c) => paras(c[1]).join(' '));
    rows.push(cells.join(' | '));
    return `<a:p><a:t>\u0003${rows.length - 1}\u0003</a:t></a:p>`;
  });
  for (const p of paras(body)) {
    const m = /^\u0003(\d+)\u0003$/.exec(p);
    lines.push(m ? rows[Number(m[1])] : p);
  }
  return lines.join('\n').trim();
}
