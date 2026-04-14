import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const BUCKET = 'drive-uploads';

// POST /api/drive/upload/presign
// Body: { files: [{ filename, mimeType, size }] }
// Returns: { uploads: [{ signedUrl, storagePath, filename, mimeType }] }
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      await requireFeature('drive', supabase, user.id);
    } catch (err) {
      return handleWorkspaceError(err);
    }

    const body = await request.json();
    const files: Array<{ filename: string; mimeType: string; size: number }> = body.files ?? [];

    if (!files.length) {
      return NextResponse.json({ error: 'files array is required' }, { status: 400 });
    }

    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `File too large (max 25 MB): ${f.filename}` }, { status: 400 });
      }
      if (!ALLOWED_MIME_TYPES.has(f.mimeType)) {
        return NextResponse.json({ error: `Unsupported file type for: ${f.filename}` }, { status: 400 });
      }
    }

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Ensure bucket exists (no-op if already created)
    await adminClient.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
    });
    // Ignore "already exists" — Supabase returns an error but the bucket is fine

    const { randomUUID } = await import('crypto');

    const uploads = await Promise.all(
      files.map(async (f) => {
        const ext = f.filename.includes('.') ? f.filename.slice(f.filename.lastIndexOf('.')) : '';
        const storagePath = `${user.id}/${randomUUID()}${ext}`;

        const { data, error } = await adminClient.storage
          .from(BUCKET)
          .createSignedUploadUrl(storagePath, { upsert: true });

        if (error || !data) {
          throw new Error(`Failed to create signed URL for ${f.filename}: ${error?.message}`);
        }

        return { signedUrl: data.signedUrl, storagePath, filename: f.filename, mimeType: f.mimeType };
      })
    );

    return NextResponse.json({ uploads });
  } catch (error) {
    console.error('[Drive/Presign] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
