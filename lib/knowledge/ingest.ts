// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILE SPINE (Prepared-Work Phase A, docs/prepared-work-plan.md) — ONE ingestion funnel. Every file,
// from ANY scenario (email attachment, /work chat upload, coworker upload, Drive upload, transcript,
// generated doc, connected drives later) becomes ONE thing: a `knowledge_files` row with
//   • ORIGIN provenance ({kind, ref}) — where it came from, auditable
//   • content-hash DEDUPE (same deck via 5 paths = one row)
//   • an ENTITY LINK inherited at ingest (the file belongs to a body of work from birth — the brain tie)
//   • Tier-1 indexing: full text extraction + file embedding + chunk embeddings on RAW chunk content —
//     deliberately NO chunk-summaries (the cost bomb; deep understanding is Tier-2, on demand).
// Graceful pre-migration (20260721_knowledge_files_origin.sql): origin/entity_id writes are non-fatal.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { embedText, chunkText, extractTextFromFile, getOrCreateUploadSource } from './indexer';

export type FileOriginKind = 'email_attachment' | 'chat' | 'coworker' | 'upload' | 'transcript' | 'generated' | 'gdrive' | 'dropbox';
export type FileOrigin = { kind: FileOriginKind; ref: string };

export type IngestParams = {
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  origin: FileOrigin;
  /** Content, best-available: a Buffer (full pipeline), or already-extracted text (attachments). */
  buffer?: Buffer | null;
  extractedText?: string | null;
  /** Where the raw bytes live (bucket + path) — recorded for preview/Tier-2. */
  bucket?: string | null;
  storagePath?: string | null;
  /** The item this file arrived through — resolves the entity link (provenance rule). */
  via?: { itemKind: 'inbox_item' | 'meeting' | 'commitment'; itemId: string } | null;
};

const MAX_CHUNKS = 24; // Tier-1 cap — deep coverage is Tier-2's job

/** Batch-embed raw chunk contents (no summaries — Tier 1). */
async function embedChunksRaw(contents: string[], userId: string, admin: SupabaseClient): Promise<number[][]> {
  const out: number[][] = [];
  for (const c of contents) out.push(await embedText(c.slice(0, 2000), userId, admin));
  return out;
}

/** The ONE funnel. Idempotent by content hash; returns the knowledge_files id. */
export async function ingestFile(admin: SupabaseClient, p: IngestParams): Promise<{ fileId: string | null; deduped: boolean }> {
  // Content hash — from real bytes when we have them; else a stable surrogate (text+identity).
  const contentHash = p.buffer
    ? createHash('sha256').update(p.buffer).digest('hex')
    : createHash('sha256').update(`${p.filename}|${p.sizeBytes}|${(p.extractedText || '').slice(0, 4000)}`).digest('hex');

  // Dedupe per user — an existing row just gains origin/entity if it lacks them.
  const { data: existing } = await admin.from('knowledge_files')
    .select('id').eq('user_id', p.userId).eq('content_hash', contentHash).maybeSingle();
  const entityId = p.via ? await resolveEntity(admin, p.userId, p.via) : null;
  if (existing?.id) {
    await admin.from('knowledge_files')
      .update({ ...(entityId ? { entity_id: entityId } : {}), origin: { kind: p.origin.kind, ref: p.origin.ref } })
      .eq('id', existing.id).is('entity_id', null).then(() => {}, () => {}); // non-fatal pre-migration
    return { fileId: existing.id as string, deduped: true };
  }

  // Text: full extraction when we have bytes; else the provided (attachment) text.
  let text = p.extractedText || null;
  if (p.buffer && p.buffer.length) {
    try { text = (await extractTextFromFile(p.buffer, p.mimeType, p.filename, p.userId, admin)) || text; } catch { /* keep fallback */ }
  }
  const clean = text ? text.replace(/\u0000/g, '').trim() : null;

  const fileEmbedding = clean && clean.length > 10 ? await embedText(clean.slice(0, 6000), p.userId, admin) : null;
  const sourceId = await getOrCreateUploadSource(p.userId, admin);

  const base = {
    user_id: p.userId,
    source_id: sourceId,
    provider_file_id: `${p.origin.kind}::${p.origin.ref}::${p.filename.slice(0, 120)}`,
    filename: p.filename,
    mime_type: p.mimeType,
    extracted_text: clean,
    embedding: fileEmbedding ? JSON.stringify(fileEmbedding) : null,
    // Tier 1: a DETERMINISTIC snippet (no AI) — search's entity post-filter matches on filename OR
    // summary, so a null summary hides legit hits. Tier-2 replaces it with a real summary on demand.
    summary: clean ? clean.slice(0, 240) : null,
    size_bytes: p.sizeBytes,
    last_modified_at: new Date().toISOString(),
    indexed_at: new Date().toISOString(),
    storage_path: p.storagePath || null,
    content_hash: contentHash,
  };
  // Try WITH origin/entity (post-migration); fall back without (pre-migration).
  let fileId: string | null = null;
  const withCols = { ...base, origin: { kind: p.origin.kind, ref: p.origin.ref }, ...(entityId ? { entity_id: entityId } : {}) };
  const r1 = await admin.from('knowledge_files').upsert(withCols, { onConflict: 'user_id,provider_file_id' }).select('id').maybeSingle();
  if (r1.data?.id) fileId = r1.data.id as string;
  else if (r1.error && /origin|entity_id|column/i.test(r1.error.message)) {
    const r2 = await admin.from('knowledge_files').upsert(base, { onConflict: 'user_id,provider_file_id' }).select('id').maybeSingle();
    fileId = (r2.data?.id as string) ?? null;
  }
  if (!fileId) return { fileId: null, deduped: false };

  // Tier-1 chunks: raw-content embeddings (searchable), NO summaries.
  if (clean && clean.length > 400) {
    try {
      const chunks = chunkText(clean, p.filename).slice(0, MAX_CHUNKS);
      const embs = await embedChunksRaw(chunks.map((c) => c.content), p.userId, admin);
      await admin.from('knowledge_chunks').delete().eq('file_id', fileId);
      await admin.from('knowledge_chunks').insert(chunks.map((c, i) => ({
        file_id: fileId, user_id: p.userId, chunk_index: i, heading: c.heading, content: c.content,
        context_header: `${p.filename}${c.heading ? ` — ${c.heading}` : ''}`,
        embedding: JSON.stringify(embs[i]),
      })));
    } catch { /* chunks are an enhancement — the file row + embedding stand alone */ }
  }
  return { fileId, deduped: false };
}

/** The file inherits the entity of the item it arrived through (recognition's provenance rule). */
async function resolveEntity(admin: SupabaseClient, userId: string, via: { itemKind: string; itemId: string }): Promise<string | null> {
  try {
    const { data } = await admin.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', via.itemKind).eq('item_id', via.itemId).not('entity_id', 'is', null).maybeSingle();
    return (data?.entity_id as string) ?? null;
  } catch { return null; }
}

// ── Email attachments (Phase A3 — the audit's biggest unlock) ────────────────────────────────────

type StoredAttachment = { filename?: string; mimeType?: string; size?: number; storagePath?: string; extractedText?: string | null };

/** Noise filter — signatures, logos, tracking pixels, calendar payloads: never knowledge. */
export function isNoiseAttachment(a: StoredAttachment): boolean {
  const name = String(a.filename || '').toLowerCase();
  const mime = String(a.mimeType || '').toLowerCase();
  if (!a.storagePath && !a.extractedText) return true;                       // nothing retrievable
  if (mime.includes('calendar') || name.endsWith('.ics')) return true;       // invite payloads
  if (mime.startsWith('image/') && (a.size ?? 0) < 50_000) return true;      // signature/logo images
  if (/^(image\d+|logo|icon|banner|signature|outlook-|unnamed)/.test(name)) return true;
  return false;
}

/** Ingest one inbox item's stored attachments (idempotent — content-hash dedupe makes re-runs no-ops).
 *  Reads the bytes from the email-attachments bucket when present (true hash + full extraction). */
export async function ingestItemAttachments(
  admin: SupabaseClient,
  userId: string,
  item: { id: string; source_data?: Record<string, unknown> | null },
): Promise<{ ingested: number; deduped: number; skipped: number }> {
  const atts = (item.source_data as { attachments?: StoredAttachment[] } | null)?.attachments ?? [];
  let ingested = 0, deduped = 0, skipped = 0;
  for (const a of atts.slice(0, 10)) {
    if (isNoiseAttachment(a)) { skipped++; continue; }
    let buffer: Buffer | null = null;
    if (a.storagePath && (a.size ?? 0) <= 25 * 1024 * 1024) {
      try {
        const { data } = await admin.storage.from('email-attachments').download(a.storagePath);
        if (data) buffer = Buffer.from(await data.arrayBuffer());
      } catch { /* fall back to extractedText */ }
    }
    const res = await ingestFile(admin, {
      userId, filename: String(a.filename || 'attachment'), mimeType: String(a.mimeType || 'application/octet-stream'),
      sizeBytes: a.size ?? buffer?.length ?? 0, origin: { kind: 'email_attachment', ref: item.id },
      buffer, extractedText: a.extractedText ?? null,
      bucket: 'email-attachments', storagePath: a.storagePath || null,
      via: { itemKind: 'inbox_item', itemId: item.id },
    }).catch(() => ({ fileId: null, deduped: false }));
    if (!res.fileId) skipped++;
    else if (res.deduped) deduped++;
    else ingested++;
  }
  return { ingested, deduped, skipped };
}

/** Post-index provenance stamp for paths that already index via indexUploadedFile (chat-attach,
 *  item-attach, Drive upload): adds origin + entity to the existing KB row. Non-fatal pre-migration. */
export async function stampFileMeta(
  admin: SupabaseClient, fileId: string, origin: FileOrigin,
  via?: { itemKind: 'inbox_item' | 'meeting' | 'commitment'; itemId: string } | null,
): Promise<void> {
  try {
    const entityId = via ? await resolveEntity(admin, (await admin.from('knowledge_files').select('user_id').eq('id', fileId).maybeSingle()).data?.user_id as string, via) : null;
    await admin.from('knowledge_files').update({ origin: { kind: origin.kind, ref: origin.ref }, ...(entityId ? { entity_id: entityId } : {}) }).eq('id', fileId);
  } catch { /* non-fatal */ }
}
