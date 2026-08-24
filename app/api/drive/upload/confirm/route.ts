import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { clipForPrompt } from '@/lib/utils/clip-for-prompt';

// Indexing a large PDF (extract → ~200 chunk summaries → embeddings) can take minutes,
// so it runs in the background via after(); this ceiling covers that background work.
export const maxDuration = 300;

// POST /api/drive/upload/confirm
// Body: { path, filename, mimeType, sizeBytes, folderId? }
// Registers the file immediately (so it appears in Drive), then indexes in the background.
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

    const { indexUploadedFile, getOrCreateUploadSource } = await import('@/lib/knowledge/indexer');

    // Register the file immediately (lightweight row) so it shows in Drive right away —
    // the heavy extract/embed/chunk work runs in the background and upserts this same row
    // (onConflict user_id,provider_file_id), so a large book can't time out the request.
    const sourceId = await getOrCreateUploadSource(user.id, adminClient);
    const { data: fileRow, error: rowError } = await adminClient
      .from('knowledge_files')
      .upsert(
        {
          user_id: user.id,
          source_id: sourceId,
          provider_file_id: path,
          filename,
          mime_type: mimeType,
          size_bytes: buffer.length,
          storage_path: path,
          indexed_at: new Date().toISOString(),
          ...(folderId ? { folder_id: folderId } : {}),
        },
        { onConflict: 'user_id,provider_file_id' }
      )
      .select('id, filename, mime_type, size_bytes, indexed_at, folder_id, storage_path')
      .single();

    if (rowError || !fileRow) {
      console.error('[Drive/Confirm] Register error:', rowError);
      return NextResponse.json({ error: 'Failed to register file' }, { status: 500 });
    }

    // ── THE `file` FIRE DOOR (THE RELAY CANVAS — W1 opened it, W2 MATURED it) ───────────────────
    // "A file LANDS in Knowledge" is a HUMAN act, so the door lives at the UPLOAD seam and nowhere
    // else. This route is reached only by the four user-facing upload surfaces (Knowledge panel,
    // Home ask attach, the two agent-knowledge pickers) — workflow-generated documents and meeting
    // transcripts reach `knowledge_files` through `indexArtifact` / `indexSource` instead, which
    // are deliberately NOT doors: a workflow-produced file firing workflows is a loop nobody
    // authored. THE SEAM STAYS HERE, in the confirm-initiated flow, and is handed to the shared
    // indexer as an EXPLICIT listener — the indexer itself never guesses that a caller is a door.
    //
    // W2 MOVED THE MOMENT: the door used to fire on registration (filename + size only), so the
    // judge matched on a NAME. It now fires when extraction completes, and the gist carries the
    // CONTENT HEAD — the judge matches on SUBSTANCE, and the fired run has real material to work
    // with. Exactly-once is unchanged (`<workflowId>:file:<knowledge_file id>`).
    // Best-effort by contract: the upload has already succeeded and must never fail on a reaction.
    after(async () => {
      try {
        await indexUploadedFile(
          {
            buffer, filename, mimeType, userId: user.id, storagePathInBucket: path, folderId,
            onIndexed: async ({ fileId, extractedText }) => {
              const { checkSourceReactions } = await import('@/lib/workflows/reactions');
              const head = String(extractedText ?? '').replace(/\s+/g, ' ').trim();
              const kb = Math.max(1, Math.round(buffer.length / 1024));
              const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)}MB` : `${kb}KB`;
              const ext = (filename.split('.').pop() ?? '').toUpperCase().slice(0, 8);
              const label = `${filename} · ${ext || mimeType} · ${size} uploaded to Knowledge`;
              // Whitespace-bounded cut, declared — the judge must never read OUR clip as the
              // document ending there (the excerpt-honesty law).
              const body = head ? clipForPrompt(head, 400) : 'No readable text was extracted from this file.';
              const rx = await checkSourceReactions(adminClient, user.id, 'file', [{
                id: fileId, title: filename, gist: `${label}\n${body}`,
              }]);
              if (rx?.fired) console.log(`[reactions] file door fired ${rx.fired} run(s) for ${user.id.slice(0, 8)}`);
            },
          },
          adminClient
        );
      } catch (err) {
        console.error('[Drive/Confirm] Background index failed:', filename, err);
      }
    });

    return NextResponse.json(fileRow);
  } catch (error) {
    console.error('[Drive/Confirm] Error:', error);
    return NextResponse.json({ error: 'Failed to index file' }, { status: 500 });
  }
}
