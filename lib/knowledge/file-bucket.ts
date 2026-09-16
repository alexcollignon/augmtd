// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILE CARRIES ITS BUCKET (Sep 14 — owner-found: a project-room PDF born from an email
// attachment previewed as plain TEXT, never as the real file).
//
// A `knowledge_files` row records `storage_path` but, until now, never WHERE that path lives. The
// bytes of one KB row can sit in any of three buckets — `drive-uploads` (Drive/seed-kit/supply
// uploads), `email-attachments` (mail attachments + /work chat attachments), `work-artifacts`
// (generated deliverables indexed back into the KB) — so every reader that signed a single
// hardcoded bucket was right only by luck: the sign failed for every other row and the caller fell
// back to extracted text (the preview) or a bucket probe (compute).
//
// THE LAW: the bucket is PROVENANCE and rides with the row. It is persisted in the existing
// `origin` jsonb (no migration — the same column that already carries {kind, ref}; `origin.kind` is
// the only field anything reads, so an extra key is inert), written at every ingest seam, and read
// by every byte-reader through `bucketOfKbFile`. `drive-uploads` stays the legacy default for rows
// written before this law, and `signedUrlForKbFile` HEALS such a row in place the first time it is
// read from a different bucket — the live door never lies while a backfill catches up.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

/** Where a KB row's bytes lived before the row carried its own bucket. */
export const DEFAULT_KB_BUCKET = 'drive-uploads';

/** Every bucket a knowledge_files row's bytes can legitimately live in. */
export const KB_BUCKETS = ['drive-uploads', 'email-attachments', 'work-artifacts'] as const;
export type KbBucket = (typeof KB_BUCKETS)[number];

export type KbFileRowMeta = { id?: string | null; storage_path?: string | null; origin?: unknown };

/** THE ONE READER. A row's own bucket, or the legacy default when it predates the law. */
export function bucketOfKbFile(row: KbFileRowMeta | null | undefined): string {
  const b = (row?.origin as { bucket?: unknown } | null | undefined)?.bucket;
  return typeof b === 'string' && b ? b : DEFAULT_KB_BUCKET;
}

/** Merge the bucket into a row's origin WITHOUT clobbering {kind, ref}. Non-fatal by contract
 *  (pre-migration DBs have no origin column; provenance must never fail an ingest). */
export async function stampFileBucket(admin: SupabaseClient, fileId: string, bucket: string): Promise<void> {
  try {
    const { data } = await admin.from('knowledge_files').select('origin').eq('id', fileId).maybeSingle();
    const prev = (data?.origin as Record<string, unknown> | null) ?? null;
    if (prev && prev.bucket === bucket) return;
    await admin.from('knowledge_files').update({ origin: { ...(prev ?? {}), bucket } }).eq('id', fileId);
  } catch { /* non-fatal — provenance is an enhancement, never a gate on the file itself */ }
}

/** A short-lived signed URL for a KB row's RAW BYTES, signed against the row's OWN bucket.
 *  If that fails (a row written before the law, or moved), the remaining known buckets are probed
 *  once and the discovered bucket is stamped back onto the row — the heal. Null = no object at all
 *  (a connected-drive row, or bytes that are genuinely gone): the caller falls back honestly. */
export async function signedUrlForKbFile(
  admin: SupabaseClient,
  row: KbFileRowMeta,
  expiresInSeconds = 600,
): Promise<{ url: string; bucket: string } | null> {
  const path = row.storage_path;
  if (!path) return null;
  const recorded = bucketOfKbFile(row);
  const order = [recorded, ...KB_BUCKETS.filter((b) => b !== recorded)];
  for (const bucket of order) {
    const { data } = await admin.storage.from(bucket).createSignedUrl(String(path), expiresInSeconds);
    if (data?.signedUrl) {
      if (bucket !== recorded && row.id) await stampFileBucket(admin, String(row.id), bucket);
      return { url: data.signedUrl, bucket };
    }
  }
  return null;
}

/** The download twin of `signedUrlForKbFile` — same provenance-first ladder, same heal. */
export async function downloadKbFile(
  admin: SupabaseClient,
  row: KbFileRowMeta,
): Promise<{ bytes: Buffer; bucket: string } | null> {
  const path = row.storage_path;
  if (!path) return null;
  const recorded = bucketOfKbFile(row);
  const order = [recorded, ...KB_BUCKETS.filter((b) => b !== recorded)];
  for (const bucket of order) {
    const { data } = await admin.storage.from(bucket).download(String(path));
    if (data) {
      if (bucket !== recorded && row.id) await stampFileBucket(admin, String(row.id), bucket);
      return { bytes: Buffer.from(await data.arrayBuffer()), bucket };
    }
  }
  return null;
}
