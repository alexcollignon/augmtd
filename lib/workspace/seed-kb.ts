import type { SupabaseClient } from '@supabase/supabase-js';

// THE COMPANY SEED KIT — the documents every member of a workspace arrives with.
// A superadmin curates folders of files per company (manifest on companies.settings.seed_kit,
// bytes in the private `seed-kits` bucket); this module plants that kit in ONE user's personal
// knowledge base, folders included. Called on join (the new member) and from the admin's
// "Seed existing members" door (the people who joined before the kit existed).
//
// IDEMPOTENT BY CONTENT: a file whose sha256 is already indexed for this user is skipped before
// any upload or AI work, so re-running the kit on a whole workspace is cheap and safe.
// NEVER THROWS — a kit is an arrival gift, never a reason a join or a sweep fails.

export const SEED_KIT_BUCKET = 'seed-kits';
const KB_BUCKET = 'drive-uploads';

export interface SeedKitFile {
  name: string;
  path: string;
  mime: string;
  size: number;
}

export interface SeedKitFolder {
  name: string;
  files: SeedKitFile[];
}

export interface SeedKit {
  folders: SeedKitFolder[];
  updated_at: string;
}

/** Reads the manifest off a company's settings, defensively (any shape drift → an empty kit). */
export function readSeedKit(settings: unknown): SeedKit | null {
  const s = (settings ?? {}) as Record<string, unknown>;
  const kit = s.seed_kit as SeedKit | undefined;
  if (!kit || !Array.isArray(kit.folders)) return null;
  const folders = kit.folders
    .filter(f => f && typeof f.name === 'string' && Array.isArray(f.files))
    .map(f => ({ name: f.name, files: f.files.filter(x => x && typeof x.path === 'string' && typeof x.name === 'string') }));
  return { folders, updated_at: typeof kit.updated_at === 'string' ? kit.updated_at : '' };
}

/** Find-or-create the user's Drive folder by name (case-insensitive — one "01_HR" per user). */
async function ensureFolder(admin: SupabaseClient, userId: string, name: string): Promise<string | null> {
  try {
    const { data: existing } = await admin
      .from('drive_folders')
      .select('id, name')
      .eq('user_id', userId);
    const hit = (existing ?? []).find((f: { name: string }) => f.name?.toLowerCase() === name.toLowerCase());
    if (hit) return (hit as { id: string }).id;

    const { data, error } = await admin
      .from('drive_folders')
      .insert({ user_id: userId, name })
      .select('id')
      .single();
    if (error || !data) {
      console.error('[seed-kb] folder create failed:', name, error?.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.error('[seed-kb] folder resolution failed:', name, e);
    return null;
  }
}

/**
 * Plant the company's seed kit in one user's knowledge base.
 * Files run in a SMALL concurrency pool (3): indexing does real AI work per file (extract →
 * summary → embeddings, ~4s each) — a 79-file pack was ~5½ minutes sequential, which outlives
 * a route budget and reads as "stuck" on the Knowledge page; three lanes lands it in ~2.
 * Each file individually guarded so one bad document never costs the rest of the kit.
 */
const SEED_CONCURRENCY = 3;

export async function seedKnowledgeForUser(
  admin: SupabaseClient,
  companyId: string,
  userId: string
): Promise<{ files: number; skipped: number; failed: number }> {
  const out = { files: 0, skipped: 0, failed: 0 };
  try {
    const { data: company } = await admin
      .from('companies')
      .select('id, settings')
      .eq('id', companyId)
      .maybeSingle();
    const kit = readSeedKit(company?.settings);
    // The cheap no-op — this runs on EVERY join, most workspaces have no kit.
    if (!kit || kit.folders.length === 0) return out;

    const { createHash, randomUUID } = await import('crypto');
    const { indexUploadedFile } = await import('@/lib/knowledge/indexer');

    // The KB bucket is normally provisioned by the presign route — a user seeded before their
    // first manual upload must not fail on its absence ("already exists" is fine).
    await admin.storage.createBucket(KB_BUCKET, { public: false }).catch(() => {});

    const seedOne = async (file: SeedKitFile, folderId: string | null): Promise<void> => {
      try {
        const { data: blob, error: dlErr } = await admin.storage.from(SEED_KIT_BUCKET).download(file.path);
        if (dlErr || !blob) {
          console.error('[seed-kb] download failed:', file.path, dlErr?.message);
          out.failed++;
          return;
        }
        const buffer = Buffer.from(await blob.arrayBuffer());

        // FAST-SKIP by content: the per-user (user_id, content_hash) index makes the whole
        // kit idempotent — a re-apply costs one hash and one lookup per file, no AI at all.
        // THE RENAME HEAL: the skip is CONTENT-based, so a kit whose display names were fixed
        // (the relative-path-as-filename bug) would skip the bytes and strand the old names —
        // when the existing row's name or folder differs from the manifest's, repair in place.
        // THE STUCK-ROW HEAL (found live: a route-budget kill between the file-level write and
        // chunking left a row with a content_hash and NO chunks — and BOTH dedupe doors, this
        // fast-skip and indexUploadedFile's own, would skip it FOREVER): a row that extracted
        // real text but holds zero chunks is incomplete — delete it and re-index fresh. A row
        // whose extraction legitimately produced nothing is complete-as-is (never a re-index
        // loop on every apply).
        const contentHash = createHash('sha256').update(buffer).digest('hex');
        const { data: already } = await admin
          .from('knowledge_files')
          .select('id, filename, folder_id, extracted_text')
          .eq('user_id', userId)
          .eq('content_hash', contentHash)
          .maybeSingle();
        if (already) {
          const hasText = typeof already.extracted_text === 'string' && already.extracted_text.trim().length > 10;
          let chunkCount = 0;
          if (hasText) {
            const { count } = await admin.from('knowledge_chunks')
              .select('id', { count: 'exact', head: true }).eq('file_id', already.id);
            chunkCount = count ?? 0;
          }
          if (hasText && chunkCount === 0) {
            await admin.from('knowledge_files').delete().eq('id', already.id).then(() => {}, () => {});
            // fall through — re-index fresh below
          } else {
            const patch: Record<string, unknown> = {};
            if (already.filename !== file.name) patch.filename = file.name;
            if (folderId && already.folder_id !== folderId) patch.folder_id = folderId;
            if (Object.keys(patch).length) {
              await admin.from('knowledge_files').update(patch).eq('id', already.id)
                .then(() => {}, () => {});
            }
            out.skipped++;
            return;
          }
        }

        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
        const storagePath = `${userId}/${randomUUID()}${ext}`;
        const { error: upErr } = await admin.storage
          .from(KB_BUCKET)
          .upload(storagePath, buffer, { contentType: file.mime, upsert: true });
        if (upErr) {
          console.error('[seed-kb] KB upload failed:', file.name, upErr.message);
          out.failed++;
          return;
        }

        await indexUploadedFile({
          buffer,
          filename: file.name,
          mimeType: file.mime,
          userId,
          storagePathInBucket: storagePath,
          ...(folderId ? { folderId } : {}),
        }, admin);
        out.files++;
      } catch (e) {
        console.error('[seed-kb] file failed:', file.name, e);
        out.failed++;
      }
    };

    for (const folder of kit.folders) {
      if (!folder.files.length) continue;
      const folderId = await ensureFolder(admin, userId, folder.name);
      // The pool: N lanes pulling from one queue — order within a folder is irrelevant,
      // per-file guards make a lane's failure invisible to its siblings.
      const queue = folder.files.slice();
      await Promise.all(Array.from({ length: Math.min(SEED_CONCURRENCY, queue.length) }, async () => {
        for (let f = queue.shift(); f; f = queue.shift()) await seedOne(f, folderId);
      }));
    }
  } catch (e) {
    console.error('[seed-kb] seeding failed for user', userId, e);
  }
  return out;
}
