// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KB ATTACHMENT — ONE loader for "the bytes of this knowledge file, to ride an email".
//
// W13 · A CLAIM RENDERS (owner live walk, Sep 24): a draft served with a staged file said "Document is
// attached", yet the card showed no chip and no send door attached anything. The chip must show what
// rides the send, and the send must attach exactly what the chip shows — so the send doors load the
// staged file's bytes SERVER-SIDE through this one loader (no 4 MB base64 round trip through the
// browser), and /api/kb/attachment (the KB picker's door) is a thin wrapper over it.
//
// Two places a KB row's bytes can live, both read here: a storage bucket (email attachments, chat
// uploads, generated docs — `storage_path` + the row's own bucket, lib/knowledge/file-bucket.ts) and a
// connected drive (the knowledge source's provider, read with the mailbox connection's token). The
// row is read through the CALLER's client (RLS — a user can only load their own file); the source,
// connection and bucket reads use the service role (those tables' RLS is restrictive), scoped to the
// caller's user id.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export type KbAttachment = { filename: string; content: Buffer; mimeType: string };
export type KbAttachmentResult = { ok: true; file: KbAttachment } | { ok: false; status: number; error: string };

const admin = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Load one KB file's bytes for an outgoing email — or say plainly why not. Never throws. */
export async function loadKbAttachment(client: SupabaseClient, userId: string, fileId: string): Promise<KbAttachmentResult> {
  try {
    if (!fileId) return { ok: false, status: 400, error: 'fileId required' };
    const { data: file, error } = await client.from('knowledge_files')
      .select('id, filename, mime_type, provider_file_id, source_id, storage_path, origin')
      .eq('id', fileId).eq('user_id', userId).maybeSingle();
    if (error || !file) return { ok: false, status: 404, error: 'File not found' };
    const mimeType = String(file.mime_type || 'application/octet-stream');
    const filename = String(file.filename || 'attachment');
    const sb = admin();
    // 1 · Bytes we hold in storage (the row's own bucket, healed by the provenance ladder).
    if (file.storage_path) {
      const { downloadKbFile } = await import('@/lib/knowledge/file-bucket');
      const got = await downloadKbFile(sb, { id: file.id as string, storage_path: file.storage_path as string, origin: file.origin }).catch(() => null);
      if (got) return { ok: true, file: { filename, content: got.bytes, mimeType } };
    }
    // 2 · A connected drive's file, read with the mailbox connection's token.
    if (!file.source_id || !file.provider_file_id) return { ok: false, status: 404, error: 'The file bytes are not available' };
    const { data: source } = await sb.from('knowledge_sources').select('provider').eq('id', file.source_id as string).eq('user_id', userId).maybeSingle();
    if (!source) return { ok: false, status: 404, error: 'Source not found' };
    const connectionProvider = source.provider === 'google_drive' ? 'gmail' : 'outlook';
    const { data: connection } = await sb.from('connections').select('metadata')
      .eq('user_id', userId).eq('provider', connectionProvider).eq('status', 'active').limit(1).maybeSingle();
    const tokens = (connection?.metadata as { tokens?: string } | null)?.tokens;
    if (!tokens) return { ok: false, status: 404, error: 'No active connection found' };
    let content: Buffer | string | null;
    if (source.provider === 'google_drive') {
      const { readDriveFile } = await import('@/lib/knowledge/google-drive');
      content = await readDriveFile(tokens, file.provider_file_id as string, mimeType);
    } else {
      const { readOneDriveFile } = await import('@/lib/knowledge/onedrive');
      content = await readOneDriveFile(tokens, file.provider_file_id as string);
    }
    if (!content) return { ok: false, status: 500, error: 'Failed to download file' };
    return { ok: true, file: { filename, content: Buffer.isBuffer(content) ? content : Buffer.from(content), mimeType } };
  } catch (e) {
    console.error('[kb-attachment] load failed:', e);
    return { ok: false, status: 500, error: 'Failed to fetch file' };
  }
}

/** The staged-file ids a send door accepts — the card's chips, verbatim; bounded, deduped, uuid-shaped. */
export function stagedFileIdsOf(raw: unknown): string[] {
  return [...new Set((Array.isArray(raw) ? raw : []).map((x) => String(x ?? '').trim()).filter((x) => /^[0-9a-f-]{8,64}$/i.test(x)))].slice(0, 5);
}

/**
 * Load EVERY staged file a send carries, or refuse the send: all-or-nothing, so a message never goes
 * out saying "attached" with one of its files silently dropped. The error names the file.
 */
export async function loadStagedAttachments(
  client: SupabaseClient, userId: string, fileIds: string[],
): Promise<{ ok: true; files: KbAttachment[] } | { ok: false; error: string }> {
  const files: KbAttachment[] = [];
  for (const id of fileIds) {
    const r = await loadKbAttachment(client, userId, id);
    if (!r.ok) {
      const { data } = await client.from('knowledge_files').select('filename').eq('id', id).eq('user_id', userId).maybeSingle();
      return { ok: false, error: `Couldn't load "${String(data?.filename ?? 'the attached file')}" to attach — remove it from the message or try again.` };
    }
    files.push(r.file);
  }
  return { ok: true, files };
}
