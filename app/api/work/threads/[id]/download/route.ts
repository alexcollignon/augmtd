import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFileExt, getMimeType } from '@/lib/artifacts/builders';
import { DeliverableType } from '@/lib/types/inbox';

// GET /api/work/threads/[id]/download — download generated file from Supabase Storage
// Optional query param: ?artifactId=<uuid> — download a specific version; defaults to latest
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const artifactId = new URL(request.url).searchParams.get('artifactId');

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify thread belongs to user
    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, artifact, artifacts')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    // Resolve artifact: specific id → latest in array → singular artifact (legacy)
    const artifactsArray = ((thread as any).artifacts as Array<{ id?: string; storage_path: string; title: string; type: string }>) || [];
    let artifact: { id?: string; storage_path: string; title: string; type: string } | null = null;
    if (artifactId && artifactsArray.length > 0) {
      artifact = artifactsArray.find((a) => a.id === artifactId) ?? artifactsArray[artifactsArray.length - 1];
    } else if (artifactsArray.length > 0) {
      artifact = artifactsArray[artifactsArray.length - 1];
    } else {
      artifact = (thread as any).artifact ?? null;
    }

    if (!artifact) {
      return NextResponse.json({ error: 'No document generated yet' }, { status: 404 });
    }

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
    const ext = getFileExt(artifact.type as DeliverableType);
    const mime = getMimeType(artifact.type as DeliverableType);

    return new Response(buffer, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${safeTitle}.${ext}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('[Download] Error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
