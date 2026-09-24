// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLONE the owner's already-synced "AHK Member companies" knowledge base to a target account.
// PURE DB + STORAGE COPY — no AHK portal fetch, no classification/enrichment, NO re-embedding.
// Embeddings (knowledge_files.embedding + knowledge_chunks.embedding) are copied VERBATIM: the
// platform runs ONE Bedrock/Cohere EU embedding space, so a copied vector is valid for the target.
//
//   npx tsx --env-file=.env.local scripts/tmp-clone-member-kb.ts [--apply] [--target <uuid>]
//
// Dry-run default. Idempotent: a target already holding a full folder at source count is skipped;
// per-file resumability is keyed on (user_id, content_hash) so a mid-run interruption re-runs safely.
// Additive + reversible: only inserts rows/blobs the target did not have.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { getOrCreateUploadSource } from '../lib/knowledge/indexer';

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SRC = '08fe4449-e5eb-431d-9156-02e9324e5903';
const SRC_FOLDER = 'cb6a203a-1a0a-4e5a-a4f6-f4a6016996a9';
const FOLDER_NAME = 'AHK Member companies';
const KB_BUCKET = 'drive-uploads';
const BATCH = 100;

const TARGETS: Record<string, string> = {
  thorsten: '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7',
  dummy: 'de4e8824-9795-4876-995c-c0740b8f07ee',
};

const APPLY = process.argv.includes('--apply');
const targetArg = (() => {
  const i = process.argv.indexOf('--target');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ── source file shape we carry (all columns except the generated fts) ──────────────────────────────
interface SrcFile {
  id: string;
  provider_file_id: string | null;
  filename: string;
  mime_type: string | null;
  extracted_text: string | null;
  embedding: string | null;
  size_bytes: number | null;
  last_modified_at: string | null;
  indexed_at: string | null;
  summary: string | null;
  content_hash: string | null;
  origin: string | null;
  storage_path: string | null;
}
const FILE_COLS =
  'id,provider_file_id,filename,mime_type,extracted_text,embedding,size_bytes,last_modified_at,indexed_at,summary,content_hash,origin,storage_path';

interface SrcChunk {
  id: string;
  file_id: string;
  chunk_index: number;
  heading: string | null;
  content: string | null;
  context_header: string | null;
  embedding: string | null;
  created_at: string | null;
}
const CHUNK_COLS = 'id,file_id,chunk_index,heading,content,context_header,embedding,created_at';

function extOf(path: string | null): string {
  if (!path) return '.md';
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i) : '.md';
}

// ── find-or-create the target's "AHK Member companies" drive folder ─────────────────────────────────
async function ensureFolder(userId: string): Promise<string> {
  const { data: folders } = await sb.from('drive_folders').select('id, name').eq('user_id', userId);
  const hit = (folders ?? []).find((f: { name: string }) => f.name?.toLowerCase() === FOLDER_NAME.toLowerCase());
  if (hit) return (hit as { id: string }).id;
  if (!APPLY) return '(new-folder-dry-run)';
  const { data, error } = await sb.from('drive_folders')
    .insert({ user_id: userId, name: FOLDER_NAME }).select('id').single();
  if (error || !data) throw new Error(`folder create failed: ${error?.message}`);
  return data.id as string;
}

async function cloneManifests(userId: string): Promise<number> {
  let n = 0;
  for (const kind of ['profile_manifest', 'tender_member_manifest']) {
    const { data: src } = await sb.from('item_plans').select('kind,entity_id,tasks,version')
      .eq('user_id', SRC).eq('kind', kind).maybeSingle();
    if (!src) { console.log(`  manifest ${kind}: MISSING on source — skipped`); continue; }
    const s = src as { kind: string; entity_id: string; tasks: unknown; version: number | null };
    const { data: existing } = await sb.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', s.kind).eq('entity_id', s.entity_id).maybeSingle();
    if (existing) { console.log(`  manifest ${kind}: already present — skipped`); continue; }
    if (!APPLY) { console.log(`  manifest ${kind}: would clone (entity_id="${s.entity_id}")`); n++; continue; }
    const { error } = await sb.from('item_plans').insert({
      id: randomUUID(), user_id: userId, kind: s.kind, entity_id: s.entity_id,
      tasks: s.tasks as never, version: s.version ?? 1,
    });
    if (error) throw new Error(`manifest ${kind} clone failed: ${error.message}`);
    console.log(`  manifest ${kind}: cloned (entity_id="${s.entity_id}")`);
    n++;
  }
  return n;
}

async function cloneTarget(label: string, userId: string) {
  console.log(`\n═══ TARGET ${label} · ${userId} — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const ledger = { folder: '', files: 0, filesSkipped: 0, chunks: 0, chunksSkipped: 0, blobs: 0, manifests: 0 };

  const folderId = await ensureFolder(userId);
  ledger.folder = folderId;
  console.log(`  folder: ${folderId}`);

  // idempotency: full folder already at source count → skip the file/chunk loop
  const { count: existingCount } = await sb.from('knowledge_files').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('folder_id', folderId.startsWith('(') ? '00000000-0000-0000-0000-000000000000' : folderId);
  if ((existingCount ?? 0) >= 1002) {
    console.log(`  folder already holds ${existingCount} files (>= source 1002) — file clone SKIPPED`);
    ledger.manifests = await cloneManifests(userId);
    console.log(`  LEDGER ${label}:`, JSON.stringify(ledger));
    return;
  }

  // the target's own upload knowledge_source (find-or-create the indexer's way)
  let sourceId = '(new-source-dry-run)';
  if (APPLY) sourceId = await getOrCreateUploadSource(userId, sb);
  console.log(`  upload source_id: ${sourceId}`);

  // all source files
  const files = await fetchAllRows<SrcFile>((from, to) =>
    sb.from('knowledge_files').select(FILE_COLS)
      .eq('user_id', SRC).eq('folder_id', SRC_FOLDER).order('id', { ascending: true }).range(from, to));
  console.log(`  source files: ${files.length}`);

  let verified = false;
  const oldToNew = new Map<string, string>(); // source file id → target file id (for chunk remap)

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const inserts: Record<string, unknown>[] = [];

    for (const f of batch) {
      // resumability: does the target already hold this content?
      const { data: already } = await sb.from('knowledge_files').select('id')
        .eq('user_id', userId).eq('content_hash', f.content_hash ?? '__none__').maybeSingle();
      if (already) {
        oldToNew.set(f.id, (already as { id: string }).id);
        ledger.filesSkipped++;
        continue;
      }
      const newId = randomUUID();
      const newPath = `${userId}/${newId}${extOf(f.storage_path)}`;
      oldToNew.set(f.id, newId);

      if (APPLY) {
        // storage: download the source blob, re-upload under the target's own path
        const { data: blob, error: dlErr } = await sb.storage.from(KB_BUCKET).download(f.storage_path!);
        if (dlErr || !blob) throw new Error(`blob download failed (${f.storage_path}): ${dlErr?.message}`);
        const buffer = Buffer.from(await blob.arrayBuffer());
        const { error: upErr } = await sb.storage.from(KB_BUCKET)
          .upload(newPath, buffer, { contentType: f.mime_type ?? 'text/plain', upsert: true });
        if (upErr) throw new Error(`blob upload failed (${newPath}): ${upErr.message}`);
        ledger.blobs++;
      }

      inserts.push({
        id: newId, user_id: userId, source_id: APPLY ? sourceId : null,
        provider_file_id: newPath, filename: f.filename, mime_type: f.mime_type,
        extracted_text: f.extracted_text, embedding: f.embedding, size_bytes: f.size_bytes,
        last_modified_at: f.last_modified_at, indexed_at: f.indexed_at, summary: f.summary,
        folder_id: APPLY ? folderId : null, storage_path: newPath, content_hash: f.content_hash,
        project_id: null, origin: f.origin, entity_id: null,
      });
    }

    if (APPLY && inserts.length) {
      const { error } = await sb.from('knowledge_files').insert(inserts as never);
      if (error) throw new Error(`file batch insert failed: ${error.message}`);
      ledger.files += inserts.length;

      // verify ONE round-tripped row before continuing the mass loop
      if (!verified) {
        const probeId = inserts[0].id as string;
        const { data: rt } = await sb.from('knowledge_files')
          .select('extracted_text, embedding, storage_path').eq('id', probeId).maybeSingle();
        const okText = typeof (rt as any)?.extracted_text === 'string' && (rt as any).extracted_text.length > 0;
        const okEmb = typeof (rt as any)?.embedding === 'string' && (rt as any).embedding.length > 100;
        const { data: rtBlob } = await sb.storage.from(KB_BUCKET).download((rt as any).storage_path);
        if (!okText || !okEmb || !rtBlob) {
          throw new Error(`round-trip verify FAILED (text=${okText} emb=${okEmb} blob=${!!rtBlob}) — aborting`);
        }
        console.log(`  ✓ round-trip verify OK (text len=${(rt as any).extracted_text.length}, emb len=${(rt as any).embedding.length}, blob=${(await rtBlob.arrayBuffer()).byteLength}b)`);
        verified = true;
      }
    } else if (!APPLY) {
      ledger.files += inserts.length;
    }

    // ── chunks for this batch of files ──
    const batchFileIds = batch.map((f) => f.id);
    const srcChunks = await fetchAllRows<SrcChunk>((from, to) =>
      sb.from('knowledge_chunks').select(CHUNK_COLS).in('file_id', batchFileIds).order('id', { ascending: true }).range(from, to));
    const chunkInserts: Record<string, unknown>[] = [];
    // group source chunks by file, so we can skip a target file that already has chunks
    const byFile = new Map<string, SrcChunk[]>();
    for (const c of srcChunks) { const arr = byFile.get(c.file_id) ?? []; arr.push(c); byFile.set(c.file_id, arr); }

    for (const [oldFileId, chunks] of byFile) {
      const newFileId = oldToNew.get(oldFileId);
      if (!newFileId || newFileId.startsWith('(')) { ledger.chunks += chunks.length; continue; }
      if (APPLY) {
        const { count: haveChunks } = await sb.from('knowledge_chunks')
          .select('id', { count: 'exact', head: true }).eq('file_id', newFileId);
        if ((haveChunks ?? 0) > 0) { ledger.chunksSkipped += chunks.length; continue; }
      }
      for (const c of chunks) {
        chunkInserts.push({
          id: randomUUID(), file_id: APPLY ? newFileId : null, user_id: userId,
          chunk_index: c.chunk_index, heading: c.heading, content: c.content,
          context_header: c.context_header, embedding: c.embedding, created_at: c.created_at,
        });
      }
    }
    if (APPLY && chunkInserts.length) {
      for (let j = 0; j < chunkInserts.length; j += BATCH) {
        const { error } = await sb.from('knowledge_chunks').insert(chunkInserts.slice(j, j + BATCH) as never);
        if (error) throw new Error(`chunk batch insert failed: ${error.message}`);
      }
      ledger.chunks += chunkInserts.length;
    } else if (!APPLY) {
      ledger.chunks += chunkInserts.length;
    }

    process.stdout.write(`\r  progress: ${Math.min(i + BATCH, files.length)}/${files.length} files`);
  }
  process.stdout.write('\n');

  ledger.manifests = await cloneManifests(userId);
  console.log(`  LEDGER ${label}:`, JSON.stringify(ledger));
}

(async () => {
  // PREFLIGHT — if the source folder or its manifests are missing, STOP.
  const { data: srcFolder } = await sb.from('drive_folders').select('id').eq('id', SRC_FOLDER).maybeSingle();
  if (!srcFolder) throw new Error('SOURCE FOLDER MISSING — refusing to run');
  const { count: srcCount } = await sb.from('knowledge_files').select('id', { count: 'exact', head: true })
    .eq('user_id', SRC).eq('folder_id', SRC_FOLDER);
  if ((srcCount ?? 0) !== 1002) console.warn(`⚠️  source file count is ${srcCount}, expected 1002 — proceeding with actual`);
  const { data: pm } = await sb.from('item_plans').select('id').eq('user_id', SRC).eq('kind', 'profile_manifest').maybeSingle();
  if (!pm) throw new Error('SOURCE profile_manifest MISSING — refusing to run');

  const chosen = targetArg
    ? Object.entries(TARGETS).filter(([, uid]) => uid === targetArg || uid.startsWith(targetArg))
    : Object.entries(TARGETS);
  if (!chosen.length) throw new Error(`--target ${targetArg} matched no known target`);

  console.log(`Clone "${FOLDER_NAME}" from ${SRC.slice(0, 8)} (${srcCount} files) → ${chosen.map(([l]) => l).join(', ')}`);
  for (const [label, uid] of chosen) await cloneTarget(label, uid);
  console.log(`\n${APPLY ? 'DONE (applied)' : 'DRY RUN complete — nothing written'}`);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
