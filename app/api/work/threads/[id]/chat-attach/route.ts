import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { indexUploadedFile } from '@/lib/knowledge/indexer';

export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ZIP_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
];

const CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const ALLOWED_TYPES = [...CONTENT_TYPES, ...ZIP_MIME_TYPES];

function mimeFromFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return ext ? (map[ext] ?? null) : null;
}

interface ContentFile {
  name: string;
  buffer: Buffer;
  mimeType: string;
}

async function expandFiles(files: File[]): Promise<ContentFile[]> {
  const result: ContentFile[] = [];
  for (const file of files) {
    const isZip = ZIP_MIME_TYPES.includes(file.type) || file.name.toLowerCase().endsWith('.zip');
    if (isZip) {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      for (const [entryPath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const baseName = entryPath.split('/').pop() ?? entryPath;
        if (baseName.startsWith('.') || baseName.startsWith('__MACOSX')) continue;
        const entryMime = mimeFromFilename(baseName);
        if (!entryMime || !CONTENT_TYPES.includes(entryMime)) continue;
        const buffer = Buffer.from(await entry.async('arraybuffer'));
        result.push({ name: baseName, buffer, mimeType: entryMime });
      }
    } else if (CONTENT_TYPES.includes(file.type)) {
      result.push({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type });
    }
  }
  return result;
}

// POST /api/work/threads/[id]/chat-attach
// Body: multipart form data — 'file' (one or more files)
// No inputId required — for chat context attachments only
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const rawFiles = formData.getAll('file') as File[];

    if (rawFiles.length === 0) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    for (const f of rawFiles) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `File too large (max 10 MB): ${f.name}` }, { status: 400 });
      }
      const isZip = ZIP_MIME_TYPES.includes(f.type) || f.name.toLowerCase().endsWith('.zip');
      if (!isZip && !CONTENT_TYPES.includes(f.type)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${f.name}. Upload PDF, DOCX, TXT, image, or ZIP.` },
          { status: 400 }
        );
      }
    }

    const contentFiles = await expandFiles(rawFiles);
    if (contentFiles.length === 0) {
      return NextResponse.json({ error: 'No supported files found (ZIP may contain unsupported types).' }, { status: 400 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const newAttachments = await Promise.all(contentFiles.map(async (cf) => {
      // Upload to storage first (needed for storagePath before indexing)
      const id = crypto.randomUUID();
      const safeName = cf.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${user.id}/${threadId}/chat-${id}-${safeName}`;
      await adminClient.storage
        .from('email-attachments')
        .upload(storagePath, cf.buffer, { contentType: cf.mimeType, upsert: true });

      // Extract text for inline AI context using the fast path only (no OCR).
      // For scanned PDFs with no extractable text, extractedText will be null and the
      // chat route's native PDF document block path handles them for Bedrock/Anthropic.
      // Full OCR + KB indexing runs fire-and-forget below via indexUploadedFile.
      const extracted = await extractTextFromAttachment(cf.buffer, cf.mimeType, cf.name);
      const extractedText = extracted?.trim() ? extracted.trim().replace(/\u0000/g, "").slice(0, 4000) : null;

      // Fire-and-forget: index into KB (includes full OCR pipeline for scanned PDFs)
      // + embeddings + chunking + summarization.
      indexUploadedFile({
        buffer: cf.buffer,
        filename: cf.name,
        mimeType: cf.mimeType,
        userId: user.id,
        storagePathInBucket: storagePath,
      }, adminClient).catch(() => {});

      return {
        chatAttachId: id,
        filename: cf.name,
        mimeType: cf.mimeType,
        size: cf.buffer.length,
        storagePath,
        extractedText,
      };
    }));

    const existing = ((thread as any).user_attachments || []) as unknown[];
    const updatedAttachments = [...existing, ...newAttachments];

    const { error: updateError } = await adminClient
      .from('work_threads')
      .update({
        user_attachments: updatedAttachments,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);
    if (updateError) console.error('[ChatAttach] user_attachments update failed:', updateError);

    return NextResponse.json({
      attachments: newAttachments.map(({ chatAttachId, filename, size }) => ({
        chatAttachId,
        filename,
        size,
      })),
    });
  } catch (error) {
    console.error('[ChatAttach] POST error:', error);
    return NextResponse.json({ error: 'Failed to attach file' }, { status: 500 });
  }
}

// DELETE /api/work/threads/[id]/chat-attach?chatAttachId=xxx
// Removes a specific chat attachment from storage and the thread record
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const chatAttachId = request.nextUrl.searchParams.get('chatAttachId');

  if (!chatAttachId) {
    return NextResponse.json({ error: 'chatAttachId is required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const existing = ((thread as any).user_attachments || []) as Array<{
      chatAttachId?: string;
      storagePath: string;
    }>;

    const toRemove = existing.find((a) => a.chatAttachId === chatAttachId);
    if (toRemove?.storagePath) {
      await adminClient.storage.from('email-attachments').remove([toRemove.storagePath]);
    }

    const updatedAttachments = existing.filter((a) => a.chatAttachId !== chatAttachId);

    await adminClient
      .from('work_threads')
      .update({
        user_attachments: updatedAttachments,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ChatAttach] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove attachment' }, { status: 500 });
  }
}
