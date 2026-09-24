// TEMP — verify the Emirates NBD workshop workspace state after the owner's cleanup. Never committed.
// Run: npx tsx --env-file=.env.local scripts/tmp-verify-enbd.ts [--clean-member-debris]
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: co } = await sb.from('companies').select('id, name, slug, settings').eq('slug', 'emirates-nbd').maybeSingle();
  if (!co) { console.log('No emirates-nbd company found.'); return; }

  const kit = (co.settings as Record<string, unknown> | null)?.seed_kit as { folders?: Array<{ name: string; files: unknown[] }> } | undefined;
  console.log(`kit manifest: ${kit?.folders?.length ? kit.folders.map((f) => `${f.name}(${f.files.length})`).join(', ') : 'EMPTY ✓'}`);

  const { data: kitObjs } = await sb.storage.from('seed-kits').list(co.id, { limit: 100 });
  let storageCount = 0;
  for (const o of kitObjs ?? []) {
    const { data: inner } = await sb.storage.from('seed-kits').list(`${co.id}/${o.name}`, { limit: 200 });
    storageCount += (inner ?? []).length;
  }
  console.log(`kit storage under ${co.id}/: ${storageCount === 0 && !(kitObjs ?? []).length ? 'EMPTY ✓' : `${(kitObjs ?? []).length} dirs / ${storageCount} files ✗`}`);

  const { data: members } = await sb.from('company_members').select('user_id, status').eq('company_id', co.id);
  console.log(`members: ${(members ?? []).length}`);
  for (const m of members ?? []) {
    const { data: prof } = await sb.from('profiles').select('email, full_name').eq('id', m.user_id).maybeSingle();
    const { data: kf } = await sb.from('knowledge_files').select('id, filename, folder_id').eq('user_id', m.user_id);
    const { data: folders } = await sb.from('drive_folders').select('id, name').eq('user_id', m.user_id);
    console.log(`  · ${prof?.email ?? m.user_id} (${m.status}) — ${(kf ?? []).length} kb files, ${(folders ?? []).length} folders`);
    for (const f of (kf ?? []).slice(0, 10)) {
      const { count } = await sb.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('file_id', f.id);
      console.log(`      - ${f.filename.length > 70 ? f.filename.slice(0, 67) + '…' : f.filename} (${count ?? 0} chunks)`);
    }
    if (process.argv.includes('--clean-member-debris') && (kf ?? []).length) {
      for (const f of kf ?? []) {
        const { data: row } = await sb.from('knowledge_files').select('storage_path').eq('id', f.id).maybeSingle();
        if (row?.storage_path) await sb.storage.from('drive-uploads').remove([row.storage_path]).catch(() => {});
        await sb.from('knowledge_chunks').delete().eq('file_id', f.id);
        await sb.from('knowledge_files').delete().eq('id', f.id);
      }
      for (const fo of folders ?? []) await sb.from('drive_folders').delete().eq('id', fo.id);
      console.log(`      → cleaned ${(kf ?? []).length} files + ${(folders ?? []).length} folders`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
