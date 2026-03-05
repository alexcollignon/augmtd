export type AttachmentMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword'
  | 'text/plain'
  | string;

export async function extractTextFromAttachment(
  buffer: Buffer,
  mimeType: AttachmentMimeType,
  filename: string
): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      const imported = await import('pdf-parse');
      const PDFParse = (imported as any).PDFParse ?? (imported as any).default?.PDFParse;
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result.text || null;
    }

    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const mammoth = await import('mammoth');
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
