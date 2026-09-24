// ─── TEMP SMOKE: THE FULL WORKSHOP PACK through the real seed path + the two heals ───────────
// Never committed. All 4 folders (~79 PDFs) on a throwaway company → seedKnowledgeForUser on
// the probe host (fresh — the purge removed it; resolveProbeUser recreates): full-count assert,
// per-file chunk assert, clean-name assert, idempotent re-seed, THE STUCK-ROW HEAL (chunkless
// row with text → re-indexed), THE RENAME HEAL (ugly path-name → manifest basename).
//
// Run:   npx tsx --env-file=.env.local scripts/tmp-seed-full-smoke.ts
// Clean: npx tsx --env-file=.env.local scripts/tmp-seed-full-smoke.ts --clean
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { resolveProbeUser } from './probe-user';

const PACK = '/Users/alexandrecollignon/Downloads/AUGMTD_Participant_Data_Pack';
const CO_SLUG = 'tmp-seed-full-smoke';

function packTree(): Array<{ folder: string; file: string; abs: string }> {
  const out: Array<{ folder: string; file: string; abs: string }> = [];
  for (const d of readdirSync(PACK)) {
    const dir = join(PACK, d);
    if (d.startsWith('.') || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (f.startsWith('.')) continue;
      out.push({ folder: d, file: f, abs: join(dir, f) });
    }
  }
  return out;
}

async function cleanAll(sb: SupabaseClient, uid: string) {
  const tree = packTree();
  const folders = [...new Set(tree.map((t) => t.folder))];
  for (const name of folders) {
    const { data: folder } = await sb.from('drive_folders').select('id').eq('user_id', uid).ilike('name', name).maybeSingle();
    if (!folder) continue;
    const { data: kf } = await sb.from('knowledge_files').select('id, storage_path').eq('user_id', uid).eq('folder_id', folder.id);
    for (const f of kf ?? []) {
      if (f.storage_path) await sb.storage.from('drive-uploads').remove([f.storage_path]).catch(() => {});
      await sb.from('knowledge_chunks').delete().eq('file_id', f.id);
    }
    await sb.from('knowledge_files').delete().eq('user_id', uid).eq('folder_id', folder.id);
    await sb.from('drive_folders').delete().eq('id', folder.id);
  }
  const { data: co } = await sb.from('companies').select('id').eq('slug', CO_SLUG).maybeSingle();
  if (co) {
    for (const name of folders) {
      await sb.storage.from('seed-kits').remove(tree.filter((t) => t.folder === name).map((t) => `${co.id}/${t.folder}/${t.file}`)).catch(() => {});
    }
    await sb.from('companies').delete().eq('id', co.id);
  }
  console.log('cleaned');
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const uid = await resolveProbeUser(sb);
  if (process.argv.includes('--clean')) { await cleanAll(sb, uid); return; }
  await cleanAll(sb, uid);

  const tree = packTree();
  const folders = [...new Set(tree.map((t) => t.folder))];
  console.log(`pack: ${tree.length} files across ${folders.length} folders`);
  const fails: string[] = [];
  const ok = (cond: boolean, label: string) => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`); if (!cond) fails.push(label); };

  // ── 1. The kit, exactly as the (fixed) admin door produces it: clean basenames. ──
  const { data: co } = await sb.from('companies').insert({
    name: 'Tmp Seed Full Smoke Co', slug: CO_SLUG, plan: 'starter', type: 'internal', status: 'active',
    join_code: `TMPFUL${Math.floor(Math.random() * 900 + 100)}`,
  }).select('id, settings').single();
  if (!co) { console.error('company insert failed'); process.exit(1); }
  await sb.storage.createBucket('seed-kits', { public: false }).catch(() => {});
  const manifest: Array<{ name: string; files: Array<{ name: string; path: string; mime: string; size: number }> }> = [];
  for (const name of folders) {
    const files: Array<{ name: string; path: string; mime: string; size: number }> = [];
    for (const t of tree.filter((x) => x.folder === name)) {
      const buf = readFileSync(t.abs);
      const path = `${co.id}/${t.folder}/${t.file}`;
      const { error } = await sb.storage.from('seed-kits').upload(path, buf, { contentType: 'application/pdf', upsert: true });
      if (error) { console.error('kit upload failed:', t.file, error.message); process.exit(1); }
      files.push({ name: t.file, path, mime: 'application/pdf', size: buf.length });
    }
    manifest.push({ name, files });
  }
  await sb.from('companies').update({
    settings: { ...(co.settings ?? {}), seed_kit: { folders: manifest, updated_at: new Date().toISOString() } },
  }).eq('id', co.id);
  console.log(`kit staged: ${tree.length} files, ${folders.length} folders`);

  // ── 2. The full seed (concurrency 3) + timing, with a live throughput sampler. ──
  const { seedKnowledgeForUser } = await import('../lib/workspace/seed-kb');
  const t0 = Date.now();
  const sampler = setInterval(() => {
    void sb.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('user_id', uid)
      .then(({ count }) => console.error(`    [${Math.round((Date.now() - t0) / 1000)}s] ${count ?? 0}/${tree.length} rows`));
  }, 15000);
  const r1 = await seedKnowledgeForUser(sb, co.id, uid);
  clearInterval(sampler);
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`seed #1 → ${JSON.stringify(r1)} in ${secs}s (~${(secs / tree.length).toFixed(1)}s/file)`);
  ok(r1.files === tree.length && r1.failed === 0, `all ${tree.length} files indexed, zero failures`);
  ok(secs < 280, `fits the join route's 300s budget (${secs}s)`);

  // ── 3. Truth per file: folder, chunks, clean names. ──
  const rows: Array<{ id: string; filename: string }> = [];
  for (const name of folders) {
    const { data: folder } = await sb.from('drive_folders').select('id').eq('user_id', uid).ilike('name', name).maybeSingle();
    const { data: kf } = await sb.from('knowledge_files').select('id, filename').eq('user_id', uid).eq('folder_id', folder?.id ?? '-');
    const want = tree.filter((t) => t.folder === name).length;
    ok((kf ?? []).length === want, `${name}: ${(kf ?? []).length}/${want} rows`);
    rows.push(...((kf ?? []) as Array<{ id: string; filename: string }>));
  }
  ok(rows.every((r) => !r.filename.includes('/')), 'every filename is a clean basename');
  let chunkless = 0;
  for (const r of rows) {
    const { count } = await sb.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('file_id', r.id);
    if (!count) { chunkless++; console.log(`    · no chunks: ${r.filename}`); }
  }
  ok(chunkless === 0, 'every file chunked');

  // ── 4. Idempotent re-seed (should be seconds). ──
  const t1 = Date.now();
  const r2 = await seedKnowledgeForUser(sb, co.id, uid);
  ok(r2.files === 0 && r2.skipped === tree.length, `re-seed skips all (${JSON.stringify(r2)}, ${Math.round((Date.now() - t1) / 1000)}s)`);

  // ── 5. THE STUCK-ROW HEAL: text present, chunks gone → must re-index, not skip forever. ──
  const victims = rows.slice(0, 2);
  for (const v of victims) await sb.from('knowledge_chunks').delete().eq('file_id', v.id);
  const r3 = await seedKnowledgeForUser(sb, co.id, uid);
  ok(r3.files === victims.length, `stuck rows re-indexed (${JSON.stringify(r3)})`);
  let healed = 0;
  for (const v of victims) {
    const { data: nf } = await sb.from('knowledge_files').select('id').eq('user_id', uid).eq('filename', v.filename).maybeSingle();
    const { count } = await sb.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('file_id', nf?.id ?? '-');
    if (count) healed++;
  }
  ok(healed === victims.length, 'healed rows have chunks again');

  // ── 6. THE RENAME HEAL: an ugly path-name row gets the manifest's basename back on re-seed. ──
  const target = rows[3];
  await sb.from('knowledge_files').update({ filename: `AUGMTD_Participant_Data_Pack/x/${target.filename}` }).eq('id', target.id);
  await seedKnowledgeForUser(sb, co.id, uid);
  const { data: renamed } = await sb.from('knowledge_files').select('filename').eq('id', target.id).maybeSingle();
  ok(renamed?.filename === target.filename, `rename healed ("${renamed?.filename}")`);

  console.log(fails.length ? `\nRESULT: ${fails.length} FAILURE(S)` : '\nRESULT: ALL GREEN');
  console.log('(clean with --clean)');
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
