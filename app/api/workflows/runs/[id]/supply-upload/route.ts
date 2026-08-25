// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ATTACH DOOR (relay canvas, THE WAVE part 1) — a parked input station takes a FILE.
//
// The station already took a paste and a document already in Knowledge. The thing a person most
// often has at run time is neither: it is a file on their desk. This route is the third hand —
// upload → extract → index into Knowledge → hand the caller a `kbFileId` it then supplies through
// THE ONE RESUME DOOR (`{ input: { kbFileId } }`). It answers no station itself: it makes the
// material real, and the existing door remains the only place a run is answered.
//
// TWO LAWS, BOTH DELIBERATE, BOTH GATED:
//
//  1. A SUPPLY IS AN ANSWER, NOT AN ARRIVAL. This route NEVER fires the `file` door seam — no
//     `checkSourceReactions`, no `onIndexed` listener handed to the indexer. A person directing a
//     file AT A SPECIFIC PARKED RUN is not a thing "arriving" in Knowledge: firing doors here would
//     let answering run 1 of a workflow spawn run 2 of the same workflow off its own answer. The
//     shared indexer takes its door seam as an EXPLICIT argument precisely so a non-door caller
//     like this one cannot fire it by accident — we simply never pass it.
//
//  2. THE TEXT IS REAL AT RETURN. Extraction is SYNCHRONOUS (the chat-attach idiom, not Drive's
//     background confirm): the station refuses a document with no text in hand, so returning a
//     kbFileId whose content is still pending would hand the person a door that then refuses them.
//     No readable text → an honest 422 naming the remedy, and the storage object AND any KB row are
//     removed — never a hollow row left behind claiming to be material.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Extraction + embedding of a ≤4MB document runs inline (law 2) — this ceiling covers it.
export const maxDuration = 300;

/** THE CHAT-ATTACH GUARD'S CLASS (Vercel's request-body limit) — bigger material has its own door. */
const MAX_SUPPLY_BYTES = 4 * 1024 * 1024;

/** Everything lib/attachments/text-extractor can actually read — the allowlist never drifts BELOW
 *  the extractor's real ability (the Aug 10 lesson: pptx/xlsx/csv/doc were rejected at a door that
 *  the extractor handled fine). */
const CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

/** A browser's `file.type` is unreliable for dragged Office files — the extension is the truth of
 *  last resort (the same map the chat-attach door keeps). */
function mimeFromFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return ext ? (map[ext] ?? null) : null;
}

// POST /api/workflows/runs/[id]/supply-upload  — multipart, field `file`.
// → { kbFileId, name }, which the caller hands to the resume door as { input: { kbFileId } }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // THE SAME VISIBILITY RULE AS THE DOOR IT FEEDS — `canResumeRun`, imported, never re-implemented.
    // A refusal is indistinguishable from a missing run: a stranger learns nothing by probing here,
    // and the upload door can never be wider than the answer door it exists to serve.
    const { canResumeRun } = await import('@/lib/workflows/handoffs');
    const auth = await canResumeRun(admin, runId, user.id);
    if (!auth.ok || !auth.run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (file.size > MAX_SUPPLY_BYTES) {
      return NextResponse.json({
        error: `That file is ${(file.size / (1024 * 1024)).toFixed(1)}MB — this box takes up to 4MB. Upload it in Knowledge instead, then pin it here.`,
      }, { status: 413 });
    }
    const mimeType = CONTENT_TYPES.includes(file.type)
      ? file.type
      : mimeFromFilename(file.name);
    if (!mimeType || !CONTENT_TYPES.includes(mimeType)) {
      return NextResponse.json({
        error: `I can't read ${file.name}. Send a PDF, Word, Excel, PowerPoint, CSV, text or image file — or paste what the run needs.`,
      }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
    // User-scoped, and marked as what it is: material handed to a specific run.
    const storagePath = `${user.id}/supply/${runId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await admin.storage
      .from('drive-uploads')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
    if (upErr) {
      console.error('[supply-upload] storage', upErr);
      return NextResponse.json({ error: 'Could not store that file. Try again.' }, { status: 500 });
    }

    /** Nothing hollow is left behind on any refusal path. */
    const cleanUp = async (fileId?: string | null) => {
      try { await admin.storage.from('drive-uploads').remove([storagePath]); } catch { /* best-effort */ }
      if (fileId) {
        try { await admin.from('knowledge_chunks').delete().eq('file_id', fileId); } catch { /* best-effort */ }
        try { await admin.from('knowledge_files').delete().eq('id', fileId); } catch { /* best-effort */ }
      }
    };

    // THE ONE INGEST SEAM (lib/knowledge/indexer) — the same function every human upload rides, so
    // this file is a Knowledge document like any other: searchable, chunked, embedded, re-pinnable.
    // NOTE THE ABSENT ARGUMENT: no `onIndexed`. That is law 1, and it is enforced by omission.
    const { indexUploadedFile } = await import('@/lib/knowledge/indexer');
    let kbFileId: string;
    try {
      kbFileId = await indexUploadedFile(
        { buffer, filename: file.name, mimeType, userId: user.id, storagePathInBucket: storagePath },
        admin,
      );
    } catch (e) {
      console.error('[supply-upload] index', e);
      await cleanUp();
      return NextResponse.json({ error: 'Could not read that file. Try pasting it instead.' }, { status: 500 });
    }

    // LAW 2, VERIFIED AGAINST THE ROW THE STATION WILL READ (not against our own hopes): the
    // resolver reads `extracted_text`, so that is what must be real before we hand back an id.
    const { data: row } = await admin.from('knowledge_files')
      .select('id, filename, extracted_text').eq('id', kbFileId).maybeSingle();
    const text = String((row as { extracted_text?: string | null } | null)?.extracted_text ?? '').trim();
    if (!text) {
      await cleanUp(kbFileId);
      return NextResponse.json({
        error: `There's no readable text in ${file.name} — try pasting it instead.`,
      }, { status: 422 });
    }

    // THE FILE SPINE: the KB row says where it came from — material handed to this run.
    try {
      const { stampFileMeta } = await import('@/lib/knowledge/ingest');
      await stampFileMeta(admin, kbFileId, { kind: 'upload', ref: `run:${runId}` });
    } catch { /* provenance is a nicety; the material is the deed */ }

    return NextResponse.json({
      kbFileId,
      name: String((row as { filename?: string } | null)?.filename ?? file.name),
    });
  } catch (e) {
    console.error('[supply-upload]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
