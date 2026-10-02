// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE RUN-TIME FILE INGEST — a file handed to a run becomes a Knowledge document whose text is
// REAL before anyone is told it landed. Shared by the two doors that take a file for a run:
//   • the input station's attach  (app/api/workflows/runs/[id]/supply-upload/route.ts)
//   • the Run-with-material sheet (app/api/workflows/[id]/material-upload/route.ts)
// Each door owns its OWN authorization and its own provenance ref; everything a file IS at those
// doors (allowlist, size ceiling, user-scoped storage, the shared indexer, the honest 422, nothing
// hollow left behind) lives here, once.
//
// LAWS HELD HERE:
//  1. A SUPPLY IS AN ANSWER, NOT AN ARRIVAL. No door seam is reachable from this function — no
//     `checkSourceReactions`, no `onIndexed` handed to the indexer. A person directing a file AT A
//     RUN is not a thing arriving in Knowledge: firing doors here would let answering run 1 of a
//     workflow spawn run 2 of the same workflow off its own answer. The shared indexer takes its
//     door seam as an EXPLICIT argument so a non-door caller like this one cannot fire it.
//  2. THE TEXT IS REAL AT RETURN. Extraction is SYNCHRONOUS and verified against the row the run
//     will read (`knowledge_files.extracted_text`). No readable text → an honest 422 naming the
//     remedy, and the storage object AND the KB row are removed — never a hollow row left behind.
//  3. TIER PRIVACY. The bytes go to the user's own scoped path in the user's storage bucket and the
//     indexer embeds through the user's own tier (it is the same function every upload rides).
//  4. A DEDUPED UPLOAD NEVER DESTROYS A DOCUMENT IT DID NOT CREATE. The indexer returns the
//     existing row for identical bytes already in Knowledge; that row is the person's, so a refusal
//     removes only OUR storage object — never their row — and its provenance is left alone.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MATERIAL_FILE_MAX_BYTES, MATERIAL_KINDS_SENTENCE, humanSize, materialMimeFor,
} from '@/lib/workflows/material-files';

export type IngestedMaterial =
  | { ok: true; kbFileId: string; name: string; chars: number; created: boolean }
  | { ok: false; status: number; error: string };


/**
 * Store → extract → index → verify. `storagePrefix` is the user-scoped folder the door owns
 * (always starts with `<userId>/`); `ref` is the provenance the KB row is stamped with.
 */
export async function ingestMaterialFile(
  admin: SupabaseClient,
  userId: string,
  file: File,
  opts: { storagePrefix: string; ref: string; oversizeRemedy: string },
): Promise<IngestedMaterial> {
  if (!opts.storagePrefix.startsWith(`${userId}/`)) {
    return { ok: false, status: 500, error: 'failed' }; // a door may only write under its caller
  }
  if (file.size > MATERIAL_FILE_MAX_BYTES) {
    return {
      ok: false, status: 413,
      error: `That file is ${(file.size / (1024 * 1024)).toFixed(1)}MB — this box takes up to ${humanSize(MATERIAL_FILE_MAX_BYTES)}. ${opts.oversizeRemedy}`,
    };
  }
  const mimeType = materialMimeFor(file);
  if (!mimeType) {
    return {
      ok: false, status: 400,
      error: `I can't read ${file.name}. Send a ${MATERIAL_KINDS_SENTENCE} file — or paste what the run needs.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
  const storagePath = `${opts.storagePrefix.replace(/\/+$/, '')}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await admin.storage
    .from('drive-uploads')
    .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
  if (upErr) {
    console.error('[material-ingest] storage', upErr);
    return { ok: false, status: 500, error: 'Could not store that file. Try again.' };
  }

  /** Nothing hollow is left behind on any refusal path — and never a row we did not create. */
  const cleanUp = async (fileId?: string | null) => {
    try { await admin.storage.from('drive-uploads').remove([storagePath]); } catch { /* best-effort */ }
    if (fileId) {
      try { await admin.from('knowledge_chunks').delete().eq('file_id', fileId); } catch { /* best-effort */ }
      try { await admin.from('knowledge_files').delete().eq('id', fileId); } catch { /* best-effort */ }
    }
  };

  // THE ONE INGEST SEAM (lib/knowledge/indexer). NOTE THE ABSENT ARGUMENT: no `onIndexed` (law 1).
  const { indexUploadedFile } = await import('@/lib/knowledge/indexer');
  let kbFileId: string;
  try {
    kbFileId = await indexUploadedFile(
      { buffer, filename: file.name, mimeType, userId, storagePathInBucket: storagePath, bucket: 'drive-uploads' },
      admin,
    );
  } catch (e) {
    console.error('[material-ingest] index', e);
    await cleanUp();
    return { ok: false, status: 500, error: `Could not read ${file.name}. Try pasting it instead.` };
  }

  // LAW 2, VERIFIED AGAINST THE ROW THE RUN WILL READ (not against our own hopes).
  const { data: row, error: rowErr } = await admin.from('knowledge_files')
    .select('id, filename, extracted_text, storage_path').eq('id', kbFileId).maybeSingle();
  if (rowErr) {
    await cleanUp();
    return { ok: false, status: 500, error: `Could not read ${file.name}. Try again.` };
  }
  const r = (row ?? null) as { filename?: string | null; extracted_text?: string | null; storage_path?: string | null } | null;
  // LAW 4: identical bytes already in Knowledge come back as THAT row — it is not ours to delete.
  const created = r?.storage_path === storagePath;
  const text = String(r?.extracted_text ?? '').trim();
  if (!text) {
    await cleanUp(created ? kbFileId : null);
    return { ok: false, status: 422, error: `There's no readable text in ${file.name} — try pasting it instead.` };
  }
  if (!created) {
    // The person's existing document answers; our duplicate bytes go.
    try { await admin.storage.from('drive-uploads').remove([storagePath]); } catch { /* best-effort */ }
  } else {
    // THE FILE SPINE: the KB row says where it came from.
    try {
      const { stampFileMeta } = await import('@/lib/knowledge/ingest');
      await stampFileMeta(admin, kbFileId, { kind: 'upload', ref: opts.ref });
    } catch { /* provenance is a nicety; the material is the deed */ }
  }

  return { ok: true, kbFileId, name: String(r?.filename ?? file.name), chars: text.length, created };
}

// ── THE RUN DOOR'S HALF — attached files resolved into the text the run carries ─────────────────

export type ResolvedMaterialFiles =
  | { ok: true; files: Array<{ kbFileId: string; name: string; text: string }> }
  | { ok: false; status: number; error: string };

/** The ids the run body named, deduped and capped (a hand-written body cannot exceed the door). */
export function materialFileIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    const id = typeof r === 'string' ? r : (r && typeof r === 'object' ? String((r as { kbFileId?: unknown }).kbFileId ?? '') : '');
    const t = id.trim();
    if (!t || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Read each attached file's text from THE CALLER'S OWN Knowledge row (the same derivation the inputs
 * tray and the input station use — `documentTextFor`). A foreign id reads as absent (404 — a run door
 * must never mount a stranger's document); a row with no text in hand is REFUSED by name (409) —
 * NEVER A SILENT EMPTY RUN: a run started on a filename alone would work from nothing.
 */
export async function resolveMaterialFiles(
  admin: SupabaseClient, userId: string, ids: string[],
): Promise<ResolvedMaterialFiles> {
  const { documentTextFor } = await import('@/lib/workflows/inputs');
  const files: Array<{ kbFileId: string; name: string; text: string }> = [];
  for (const id of ids) {
    const doc = await documentTextFor(admin, userId, id);
    if (!doc) return { ok: false, status: 404, error: 'One of the attached files could not be found — remove it and attach it again.' };
    if (!doc.text.trim()) {
      return { ok: false, status: 409, error: `There's no readable text in "${doc.name}" — remove it, or paste what the run needs.` };
    }
    files.push({ kbFileId: id, name: doc.name, text: doc.text });
  }
  return { ok: true, files };
}

/** Provenance follows the deed: a file this door uploaded (`ref: workflow:<id>`) is re-stamped
 *  `run:<runId>` once a run carries it. A deduped, pre-existing document keeps its own provenance
 *  (the conditional on the ref). Best-effort — provenance never fails a run. */
export async function stampMaterialFilesForRun(
  admin: SupabaseClient, userId: string, workflowId: string, runId: string, ids: string[],
): Promise<void> {
  for (const id of ids) {
    try {
      const { data } = await admin.from('knowledge_files').select('origin')
        .eq('id', id).eq('user_id', userId).maybeSingle();
      const origin = (data as { origin?: { kind?: string; ref?: string; bucket?: string } | null } | null)?.origin;
      if (!origin || origin.ref !== `workflow:${workflowId}`) continue;
      await admin.from('knowledge_files').update({ origin: { ...origin, ref: `run:${runId}` } })
        .eq('id', id).eq('user_id', userId);
    } catch { /* best-effort */ }
  }
}
