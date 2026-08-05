import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const BUCKET = 'meeting-recordings';
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB (audio can be large)

// POST /api/meetings/recordings/presign
// Body: { filename: string, mimeType: string, calendarEventId?: string }
// Returns: { signedUrl, storagePath }
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { filename, mimeType } = body as { filename: string; mimeType: string; calendarEventId?: string };

    if (!filename || !mimeType) {
      return NextResponse.json({ error: 'filename and mimeType are required' }, { status: 400 });
    }

    // Validate MIME type: must be audio or video/webm
    if (!mimeType.startsWith('audio/') && mimeType !== 'video/webm') {
      return NextResponse.json({ error: 'Only audio/* or video/webm files are accepted' }, { status: 400 });
    }

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Ensure bucket exists (no-op if already created) AND carries the intended size limit.
    // createBucket alone is not enough: on a pre-existing bucket it's a no-op, so the limit
    // silently stays whatever the bucket was created with (this bucket predates the limit and
    // had none — uploads were capped by the PROJECT-global limit instead, which rejected a
    // >50MB conference recording with a bare 400; found live Aug 5). NB the effective cap is
    // min(bucket, project global) — the global limit must also be raised in the dashboard.
    await adminClient.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
    });
    await adminClient.storage.updateBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
    }).catch(() => { /* limit assertion is best-effort — presign must still serve */ });

    const { randomUUID } = await import('crypto');
    const storagePath = `${user.id}/${randomUUID()}.webm`;

    const { data, error } = await adminClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: true });

    if (error || !data) {
      throw new Error(`Failed to create signed URL: ${error?.message}`);
    }

    return NextResponse.json({ signedUrl: data.signedUrl, storagePath });
  } catch (error) {
    console.error('[Recordings/Presign] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
