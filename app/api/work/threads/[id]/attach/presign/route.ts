import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
]);

// POST /api/work/threads/[id]/attach/presign
// Body: { files: [{ filename, mimeType, size }], inputId }
// Returns signed upload URLs for direct client → Supabase Storage upload,
// bypassing the Vercel 4.5 MB function payload limit.
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
      .select('id')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const files: Array<{ filename: string; mimeType: string; size: number }> = body.files ?? [];
    const inputId: string = body.inputId ?? '';

    if (!files.length || !inputId) {
      return NextResponse.json({ error: 'files and inputId are required' }, { status: 400 });
    }

    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File too large (max 10 MB): ${f.filename}` },
          { status: 400 }
        );
      }
      const isZip = f.filename.toLowerCase().endsWith('.zip');
      if (!isZip && !ALLOWED_MIME_TYPES.has(f.mimeType)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${f.filename}` },
          { status: 400 }
        );
      }
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const uploads = await Promise.all(
      files.map(async (f) => {
        const safeName = f.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${user.id}/${threadId}/${inputId}-${safeName}`;
        const { data, error } = await adminClient.storage
          .from('email-attachments')
          .createSignedUploadUrl(storagePath, { upsert: true });
        if (error || !data) {
          console.error(`[Attach/Presign] Supabase error for ${f.filename}:`, JSON.stringify(error));
          throw new Error(`Failed to create signed URL for ${f.filename}`);
        }
        return {
          storagePath,
          signedUrl: data.signedUrl,
          filename: f.filename,
          mimeType: f.mimeType,
          size: f.size,
        };
      })
    );

    return NextResponse.json({ uploads });
  } catch (error) {
    console.error('[Attach/Presign] Error:', error);
    return NextResponse.json({ error: 'Failed to create upload URLs' }, { status: 500 });
  }
}
