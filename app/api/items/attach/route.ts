import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { indexUploadedFile } from '@/lib/knowledge/indexer';
import { writeDeliverable } from '@/lib/home/deliverable-pool';
import { logActivity } from '@/lib/activity/log';
import type { ItemPlanKind, ItemPlanTask } from '@/lib/home/item-plan';

export const maxDuration = 60;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/attach — task-workflows S3 "request-attachment from the user".
//
// When a plan step is in `awaiting_input` (it ASKED the user for a file — "Upload the pitch deck"), the
// user uploads via the panel's "Upload →" affordance, which POSTs the file here. This route MIRRORS the
// chat-attach pipeline (`app/api/work/threads/[id]/chat-attach`): store to the `email-attachments`
// bucket → extract text (`text-extractor`) → fire-and-forget KB indexing (`indexUploadedFile`, so it's
// searchable) → land the file as a `file` DELIVERABLE in the per-item pool (`writeDeliverable`) whose
// `content` is the EXTRACTED TEXT (note: AgentOS/coworker path is text-only — a scanned-image PDF with
// no extractable text won't help a coworker; we surface the text content, not the raw image). Downstream
// steps + coworkers then read it automatically via the pool (`renderPoolForContext`).
//
// On success the requesting step flips `awaiting_input → done` (its ask is satisfied) with the pool
// deliverable attached, so the stepper shows "Produced: {filename}".
//
// Body: multipart form-data — `file` (one file), `kind`, `entityId`, `taskId`.
// Non-fatal on the bookkeeping (plan persist / activity log / KB index) writes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const VALID_KINDS: ItemPlanKind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];

// ~4 MB — the Vercel request-body limit for an inline multipart upload. Bigger files should go via the
// Drive presign path (25 MB) and be @mentioned; this route is for the direct in-item upload.
const MAX_FILE_SIZE = 4 * 1024 * 1024;

// Same content types the chat-attach flow accepts (text-extractor + KB OCR cover these).
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kind = String(formData.get('kind') || '') as ItemPlanKind;
    const entityId = String(formData.get('entityId') || '');
    const taskId = String(formData.get('taskId') || '');
    // task-workflows S4 — the always-allow 📎 attach (any step, override) passes resolveStep=false: the
    // file lands in the pool but the step is NOT flipped to done (it wasn't a "provide a file" request).
    // The S3 awaiting_input upload omits it (defaults true → the requesting step resolves on upload).
    const resolveStep = String(formData.get('resolveStep') || 'true') !== 'false';

    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }
    if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large (max ~4 MB here). Upload it to Drive and @mention it instead.' },
        { status: 400 },
      );
    }

    // Resolve the mime (browsers sometimes send an empty type) + validate.
    const mimeType = ALLOWED_TYPES.includes(file.type) ? file.type : (mimeFromFilename(file.name) || file.type);
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.name}. Upload PDF, DOCX, TXT, or an image.` },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // ── Store to the email-attachments bucket (same bucket + path shape chat-attach uses). ──
    const attachId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${user.id}/items/${kind}/${entityId}/${attachId}-${safeName}`;
    const { error: uploadErr } = await adminClient.storage
      .from('email-attachments')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
    if (uploadErr) {
      console.error('[items/attach] storage upload failed:', uploadErr.message);
      return NextResponse.json({ error: 'Could not store the file.' }, { status: 502 });
    }

    // ── Extract text (fast path, no OCR) for the pool `content` — this is what downstream steps +
    // coworkers actually read (AgentOS path is text-only). A scanned PDF with no extractable text yields
    // null here; the fire-and-forget KB index below runs the full OCR pipeline so it's still searchable.
    const extracted = await extractTextFromAttachment(buffer, mimeType, file.name);
    const extractedText = extracted?.trim()
      ? extracted.trim().replace(/\u0000/g, '').slice(0, 8000)
      : null;

    // ── Fire-and-forget: index into the KB (full OCR + embeddings + chunking) so the file is searchable
    // and re-usable beyond this item. Returns knowledge_files.id; we don't block on it for the upload.
    let knowledgeFileId: string | null = null;
    try {
      knowledgeFileId = await indexUploadedFile(
        { buffer, filename: file.name, mimeType, userId: user.id, storagePathInBucket: storagePath },
        adminClient,
      );
    } catch (e) {
      // Non-fatal — the pool deliverable (with extracted text) still lands; indexing can be retried.
      console.error('[items/attach] KB index failed (non-fatal):', e);
    }

    // ── Land the file as a `file` DELIVERABLE in the per-item pool. `content` = extracted text (the
    // poolable body downstream steps read); `ref` = the knowledge_file id when indexed. task_id ties it
    // to the requesting step (dedup: a re-upload replaces the prior file for that step).
    const deliverable = await writeDeliverable(supabase, user.id, {
      kind,
      entityId,
      taskId,
      type: 'file',
      title: file.name.slice(0, 100),
      content: extractedText,
      ref: knowledgeFileId ?? storagePath,
      gist: extractedText
        ? extractedText.replace(/\s+/g, ' ').slice(0, 140)
        : `Uploaded file: ${file.name}`,
      metadata: {
        source: 'upload',
        mime: mimeType,
        storage_path: storagePath,
        ...(knowledgeFileId ? { knowledge_file_id: knowledgeFileId } : {}),
        filename: file.name,
      },
    });

    // ── Resolve the requesting step: flip awaiting_input → done, attach the deliverable, mark the
    // request fulfilled. Best-effort (a persist failure still returns the stored deliverable). Skipped
    // for the always-allow attach (resolveStep=false) — the file lands in the pool but the step stays as
    // it was (an active step the user just fed a doc to, not a fulfilled file request).
    if (resolveStep) try {
      const { data: row } = await supabase
        .from('item_plans')
        .select('tasks')
        .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
        .maybeSingle();
      if (row && Array.isArray(row.tasks)) {
        const tasks = row.tasks as ItemPlanTask[];
        const nextTasks = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'done' as const,
                done: true,
                ...(deliverable
                  ? { deliverable: { id: deliverable.id, type: 'file' as const, title: deliverable.title ?? file.name, gist: deliverable.gist ?? undefined } }
                  : {}),
                request: { ...(t.request ?? { prompt: `Upload ${file.name}` }), fulfilledRef: deliverable?.id },
              }
            : t,
        );
        await supabase
          .from('item_plans')
          .update({ tasks: nextTasks, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
      }
    } catch (e) {
      console.error('[items/attach] plan persist failed (non-fatal):', e);
    }

    await logActivity(supabase, user.id, {
      type: 'file_attached',
      title: `Uploaded: ${file.name.slice(0, 100)}`,
      entityType: kind,
      entityId,
      metadata: { taskId, ...(deliverable ? { deliverableId: deliverable.id } : {}), ...(knowledgeFileId ? { knowledgeFileId } : {}) },
    });

    return NextResponse.json({
      ok: true,
      deliverable: deliverable
        ? { id: deliverable.id, type: deliverable.type, title: deliverable.title, gist: deliverable.gist }
        : null,
      filename: file.name,
      hasText: !!extractedText,
    });
  } catch (error) {
    console.error('[items/attach] error:', error);
    return NextResponse.json({ error: 'Could not attach the file.' }, { status: 500 });
  }
}
