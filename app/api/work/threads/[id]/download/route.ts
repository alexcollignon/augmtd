import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/work/threads/[id]/download — download generated .docx from Supabase Storage
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify thread belongs to user and has artifact
    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, artifact')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    if (!thread.artifact) {
      return NextResponse.json({ error: 'No document generated yet' }, { status: 404 });
    }

    const artifact = thread.artifact;

    // Download from Supabase Storage using service role
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: fileData, error: downloadError } = await adminClient.storage
      .from('work-artifacts')
      .download(artifact.storage_path);

    if (downloadError || !fileData) {
      console.error('[Download] Storage download error:', downloadError);
      return NextResponse.json({ error: 'Failed to retrieve document' }, { status: 500 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const safeTitle = (artifact.title || 'document').replace(/[^a-z0-9\s-_]/gi, '').trim() || 'document';

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeTitle}.docx"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('[Download] Error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
