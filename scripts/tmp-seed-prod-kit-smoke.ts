// TEMP — seed the PROBE from the REAL Emirates NBD kit (the prod-uploaded halved pack) using the
// FIXED local seeding lib: counts, chunks, clean names, timing. --clean removes the probe rows.
// Never committed. Run: npx tsx --env-file=.env.local scripts/tmp-seed-prod-kit-smoke.ts [--clean]
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';

async function cleanProbe(sb: SupabaseClient, uid: string, folderNames: string[]) {
  for (const name of folderNames) {
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
  console.log('probe cleaned');
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const uid = await resolveProbeUser(sb);
  const { data: co } = await sb.from('companies').select('id, settings').eq('slug', 'emirates-nbd').maybeSingle();
  if (!co) { console.error('no emirates-nbd'); process.exit(1); }
  const kit = (co.settings as Record<string, unknown>).seed_kit as { folders: Array<{ name: string; files: Array<{ name: string }> }> };
  const folderNames = kit.folders.map((f) => f.name);
  const total = kit.folders.reduce((n, f) => n + f.files.length, 0);
  if (process.argv.includes('--clean')) { await cleanProbe(sb, uid, folderNames); return; }
  await cleanProbe(sb, uid, folderNames);

  console.log(`kit: ${total} files across ${folderNames.length} folders`);
  const fails: string[] = [];
  const ok = (cond: boolean, label: string) => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`); if (!cond) fails.push(label); };

  const { seedKnowledgeForUser } = await import('../lib/workspace/seed-kb');
  const t0 = Date.now();
  const r1 = await seedKnowledgeForUser(sb, co.id, uid);
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`seed → ${JSON.stringify(r1)} in ${secs}s (~${(secs / Math.max(1, total)).toFixed(1)}s/file)`);
  ok(r1.files === total && r1.failed === 0, `all ${total} files indexed, zero failures`);
  ok(secs < 280, `fits the join route's 300s budget (${secs}s)`);

  let rows = 0; let chunkless = 0; let ugly = 0;
  for (const name of folderNames) {
    const { data: folder } = await sb.from('drive_folders').select('id').eq('user_id', uid).ilike('name', name).maybeSingle();
    const { data: kf } = await sb.from('knowledge_files').select('id, filename').eq('user_id', uid).eq('folder_id', folder?.id ?? '-');
    rows += (kf ?? []).length;
    for (const f of kf ?? []) {
      if (f.filename.includes('/')) { ugly++; console.log('    · path-name:', f.filename); }
      const { count } = await sb.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('file_id', f.id);
      if (!count) { chunkless++; console.log('    · no chunks:', f.filename); }
    }
  }
  ok(rows === total, `rows in folders: ${rows}/${total}`);
  ok(ugly === 0, 'every filename is a clean basename');
  ok(chunkless === 0, 'every file chunked');

  const r2 = await seedKnowledgeForUser(sb, co.id, uid);
  ok(r2.files === 0 && r2.skipped === total, `re-seed skips all (${JSON.stringify(r2)})`);

  console.log(fails.length ? `\nRESULT: ${fails.length} FAILURE(S)` : '\nRESULT: ALL GREEN');
  console.log('(probe rows left for eyeballing — clean with --clean)');
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
