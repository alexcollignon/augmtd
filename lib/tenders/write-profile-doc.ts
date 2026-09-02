// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE WRITER FOR A PROFILE DOCUMENT.
//
// The sync writes profile docs; the website-enrichment pass rewrites them. Both must go through the
// SAME door, or the folder ends up holding two versions of one company under two heals: the
// content-hash fast-skip (a re-run costs nothing), the RENAME heal (a member renamed since its doc
// was written keeps one row), and the STUCK-ROW heal (text but zero chunks — the budget-kill class
// that both dedupe doors would otherwise skip forever).
//
// Lifted verbatim out of scripts/ahk-member-sync.ts when the enrichment pass became a second
// caller. Nothing about the behaviour moved.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createHash, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const KB_BUCKET = 'drive-uploads';

export type ProfileDocWrite = 'wrote' | 'skipped' | 'failed';

export async function writeProfileDoc(
  sb: SupabaseClient, userId: string, folderId: string, filename: string, markdown: string,
): Promise<ProfileDocWrite> {
  const { indexUploadedFile } = await import('@/lib/knowledge/indexer');
  const buffer = Buffer.from(markdown, 'utf-8');
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  const { data: already } = await sb.from('knowledge_files')
    .select('id, filename, folder_id, extracted_text')
    .eq('user_id', userId).eq('content_hash', contentHash).maybeSingle();

  if (already) {
    const hasText = typeof already.extracted_text === 'string' && already.extracted_text.trim().length > 10;
    let chunks = 0;
    if (hasText) {
      const { count } = await sb.from('knowledge_chunks')
        .select('id', { count: 'exact', head: true }).eq('file_id', already.id);
      chunks = count ?? 0;
    }
    if (!(hasText && chunks === 0)) {
      const patch: Record<string, unknown> = {};
      if (already.filename !== filename) patch.filename = filename;
      if (already.folder_id !== folderId) patch.folder_id = folderId;
      if (Object.keys(patch).length) await sb.from('knowledge_files').update(patch).eq('id', already.id);
      return 'skipped';
    }
    await sb.from('knowledge_files').delete().eq('id', already.id);
  }

  // A member whose text CHANGED keeps its filename but carries a new hash — the stale doc under the
  // same name must go, or the folder accumulates two versions of one company.
  const { data: stale } = await sb.from('knowledge_files').select('id')
    .eq('user_id', userId).eq('folder_id', folderId).eq('filename', filename);
  for (const row of stale ?? []) await sb.from('knowledge_files').delete().eq('id', (row as { id: string }).id);

  const storagePath = `${userId}/${randomUUID()}.md`;
  const { error: upErr } = await sb.storage.from(KB_BUCKET)
    .upload(storagePath, buffer, { contentType: 'text/plain', upsert: true });
  if (upErr) { console.error(`  ! upload failed ${filename}: ${upErr.message}`); return 'failed'; }

  try {
    await indexUploadedFile({
      buffer, filename, mimeType: 'text/plain', userId, storagePathInBucket: storagePath, folderId,
    }, sb);
    return 'wrote';
  } catch (e) {
    console.error(`  ! index failed ${filename}: ${(e as Error).message}`);
    return 'failed';
  }
}
