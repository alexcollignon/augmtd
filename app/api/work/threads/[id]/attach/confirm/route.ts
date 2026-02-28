import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';

const CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const ZIP_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
];

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

interface UploadEntry {
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
}

// POST /api/work/threads/[id]/attach/confirm
// Body: { uploads: [{ storagePath, filename, mimeType, size }], inputId }
// Downloads each file from Supabase Storage, expands ZIPs, extracts text,
// then updates user_attachments + plan. Called after direct client uploads.
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
      .select('id, plan, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const uploads: UploadEntry[] = body.uploads ?? [];
    const inputId: string = body.inputId ?? '';

    if (!uploads.length || !inputId) {
      return NextResponse.json({ error: 'uploads and inputId are required' }, { status: 400 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const newAttachments: Array<{
      inputId: string;
      filename: string;
      mimeType: string;
      size: number;
      storagePath: string;
      extractedText: string | null;
    }> = [];

    for (const upload of uploads) {
      const isZip = ZIP_MIME_TYPES.includes(upload.mimeType) || upload.filename.toLowerCase().endsWith('.zip');

      const { data: blob, error: downloadError } = await adminClient.storage
        .from('email-attachments')
        .download(upload.storagePath);

      if (downloadError || !blob) {
        console.error('[Attach/Confirm] Download failed:', upload.storagePath, downloadError);
        continue;
      }

      const buffer = Buffer.from(await blob.arrayBuffer());

      if (isZip) {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buffer);

        for (const [entryPath, entry] of Object.entries(zip.files)) {
          if (entry.dir) continue;
          const baseName = entryPath.split('/').pop() ?? entryPath;
          if (baseName.startsWith('.') || baseName.startsWith('__MACOSX')) continue;
          const entryMime = mimeFromFilename(baseName);
          if (!entryMime || !CONTENT_TYPES.includes(entryMime)) continue;

          const entryBuffer = Buffer.from(await entry.async('arraybuffer'));
          const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const entryStoragePath = `${user.id}/${threadId}/${inputId}-${safeName}`;

          await adminClient.storage
            .from('email-attachments')
            .upload(entryStoragePath, entryBuffer, { contentType: entryMime, upsert: true });

          const extracted = await extractTextFromAttachment(entryBuffer, entryMime, baseName);
          newAttachments.push({
            inputId,
            filename: baseName,
            mimeType: entryMime,
            size: entryBuffer.length,
            storagePath: entryStoragePath,
            extractedText: extracted ? extracted.slice(0, 3000) : null,
          });
        }

        // Remove the raw ZIP — individual files have been stored
        await adminClient.storage.from('email-attachments').remove([upload.storagePath]);
      } else {
        const extracted = await extractTextFromAttachment(buffer, upload.mimeType, upload.filename);
        newAttachments.push({
          inputId,
          filename: upload.filename,
          mimeType: upload.mimeType,
          size: buffer.length,
          storagePath: upload.storagePath,
          extractedText: extracted ? extracted.slice(0, 3000) : null,
        });
      }
    }

    if (newAttachments.length === 0) {
      return NextResponse.json(
        { error: 'No supported files found (ZIP may contain unsupported types).' },
        { status: 400 }
      );
    }

    // Replace all existing attachments for this inputId
    const existing = ((thread as any).user_attachments || []) as Array<{ inputId: string }>;
    const updatedAttachments = [
      ...existing.filter((a) => a.inputId !== inputId),
      ...newAttachments,
    ];

    // Mark plan input as "provided"
    const fileCount = newAttachments.length;
    const providedFilename = fileCount === 1
      ? newAttachments[0].filename
      : `${newAttachments[0].filename} + ${fileCount - 1} more`;

    const plan = thread.plan as any;
    if (plan?.inputs) {
      plan.inputs = plan.inputs.map((input: { id: string }) =>
        input.id === inputId
          ? { ...input, status: 'provided', providedFilename }
          : input
      );
    }

    await adminClient
      .from('work_threads')
      .update({
        user_attachments: updatedAttachments,
        plan,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({ attachments: newAttachments, plan });
  } catch (error) {
    console.error('[Attach/Confirm] Error:', error);
    return NextResponse.json({ error: 'Failed to confirm attachment' }, { status: 500 });
  }
}
