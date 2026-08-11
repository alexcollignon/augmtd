import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import type { AttachmentMimeType } from '@/lib/attachments/text-extractor';

export const maxDuration = 60;

// POST /api/home/extract-attach — synchronous text extraction for chat-borne attachments
// (THE PRODUCTION HAND-OFF, Aug 10). The KB upload indexes in the BACKGROUND, so a "fill this
// in" sent right after attaching used to race the index and the coworker worked blind. This
// door extracts NOW and the text rides the ask itself — the KB upload stays the durable copy.
// Multipart 'file' fields; returns { attachments: [{ name, text }] }. Extraction failures are
// per-file and honest (text: null), never a dead request.

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT = 20000;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain',
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const files = (formData.getAll('file') as File[]).slice(0, 5);
    if (!files.length) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const attachments: Array<{ name: string; text: string | null; image?: { dataB64: string; mime: string } }> = [];
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) { attachments.push({ name: f.name, text: null }); continue; }
      // The browser's mime is unreliable for dragged Office files — extension is the fallback.
      const extMime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
      const mime = f.type && f.type !== 'application/octet-stream'
        ? f.type
        : MIME_BY_EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] ?? extMime[f.name.split('.').pop()?.toLowerCase() ?? ''] ?? f.type;
      try {
        const buf = Buffer.from(await f.arrayBuffer());
        // AN IMAGE rides as BYTES (≤1MB) — THE MOMENT THEME needs the logo itself ("brand this
        // with the attached logo"), not a text extraction that would be empty anyway.
        if (/^image\/(png|jpe?g|webp)$/.test(mime) && buf.length <= 1024 * 1024) {
          attachments.push({ name: f.name, text: null, image: { dataB64: buf.toString('base64'), mime } });
          continue;
        }
        const text = await extractTextFromAttachment(buf, mime as AttachmentMimeType, f.name);
        attachments.push({ name: f.name, text: text ? text.slice(0, MAX_TEXT) : null });
      } catch { attachments.push({ name: f.name, text: null }); }
    }
    return NextResponse.json({ attachments });
  } catch (e) {
    console.error('[home/extract-attach] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
