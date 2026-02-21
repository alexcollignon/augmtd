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
      const { PDFParse } = await import('pdf-parse');
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

    // Images, spreadsheets, etc.
    console.log(`[Attachments] Skipped unsupported MIME type: ${mimeType} (${filename})`);
    return null;
  } catch (err) {
    console.error(`[Attachments] Failed to extract text from ${filename}:`, err);
    return null;
  }
}
