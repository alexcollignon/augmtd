import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CHARS = 6000;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Could not extract text from this file type' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await extractTextFromAttachment(buffer, file.type, file.name);

    if (!extracted) {
      return NextResponse.json({ error: 'Could not extract text from this file type' }, { status: 400 });
    }

    const extractedText = extracted.slice(0, MAX_CHARS);
    return NextResponse.json({ filename: file.name, extractedText });
  } catch (err) {
    console.error('[InboxChatAttach] POST error:', err);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}
