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
      const { getDocumentProxy, extractText } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return text.trim() || null;
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

    if (mimeType === 'text/plain') {
      return buffer.toString('utf-8');
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
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort();
      const slideTexts: string[] = [];
      for (const slidePath of slideFiles) {
        const xml = await zip.files[slidePath].async('text');
        const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) slideTexts.push(text);
      }
      return slideTexts.join('\n\n') || null;
    }

    if (mimeType === 'text/csv') {
      return buffer.toString('utf-8');
    }

    // Images, unsupported, etc.
    console.log(`[Attachments] Skipped unsupported MIME type: ${mimeType} (${filename})`);
    return null;
  } catch (err) {
    console.error(`[Attachments] Failed to extract text from ${filename}:`, err);
    return null;
  }
}
