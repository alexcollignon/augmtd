import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/drive/upload/confirm
// Body: { path, filename, mimeType, sizeBytes, folderId? }
// Downloads from storage, indexes into KB, returns knowledge_files row
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { path, filename, mimeType, folderId } = body as {
      path: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      folderId?: string;
    };

    if (!path || !filename || !mimeType) {
      return NextResponse.json({ error: 'path, filename, and mimeType are required' }, { status: 400 });
    }

    // Validate path belongs to this user
    if (!path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Download buffer from storage
    const { data: fileData, error: downloadError } = await adminClient.storage
      .from('drive-uploads')
      .download(path);

    if (downloadError || !fileData) {
      console.error('[Drive/Confirm] Download error:', downloadError);
      return NextResponse.json({ error: 'Failed to retrieve uploaded file' }, { status: 500 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());

    const { indexUploadedFile } = await import('@/lib/knowledge/indexer');

    const fileId = await indexUploadedFile(
      {
        buffer,
        filename,
        mimeType,
        userId: user.id,
        storagePathInBucket: path,
        folderId,
      },
      adminClient
    );

    const { data: fileRow } = await adminClient
      .from('knowledge_files')
      .select('id, filename, mime_type, size_bytes, indexed_at, folder_id, storage_path')
      .eq('id', fileId)
      .single();

    return NextResponse.json(fileRow);
  } catch (error) {
    console.error('[Drive/Confirm] Error:', error);
    return NextResponse.json({ error: 'Failed to index file' }, { status: 500 });
  }
}
