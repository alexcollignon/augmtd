import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadKbAttachment } from '@/lib/knowledge/kb-attachment';

// GET /api/kb/attachment?fileId= — one KB file's bytes as the composer's attachment shape
// ({ filename, content (base64), mimeType }). W13: a thin wrapper over THE ONE loader
// (lib/knowledge/kb-attachment.ts), which now also reads bytes held in storage (email attachments,
// uploads, generated docs) — before, only connected-drive files could be attached from the KB.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const fileId = request.nextUrl.searchParams.get('fileId');
    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

    const r = await loadKbAttachment(supabase, user.id, fileId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({
      filename: r.file.filename,
      content: r.file.content.toString('base64'),
      mimeType: r.file.mimeType,
    });
  } catch (err) {
    console.error('[kb/attachment] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 });
  }
}
