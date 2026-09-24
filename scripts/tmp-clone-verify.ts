// Verify the cloned "AHK Member companies" KB on each target: file count, chunk count, both
// manifests present, and a GERMAN semantic query scoped to the target returns member profiles.
//   npx tsx --env-file=.env.local scripts/tmp-clone-verify.ts
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { searchKnowledgeChunks } from '../lib/knowledge/search';

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const FOLDER_NAME = 'AHK Member companies';
const TARGETS: [string, string][] = [
  ['thorsten', '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7'],
  ['dummy', 'de4e8824-9795-4876-995c-c0740b8f07ee'],
];

(async () => {
  for (const [label, uid] of TARGETS) {
    console.log(`\n═══ ${label} · ${uid}`);
    const { data: folders } = await sb.from('drive_folders').select('id, name').eq('user_id', uid);
    const folder = (folders ?? []).find((f: any) => f.name?.toLowerCase() === FOLDER_NAME.toLowerCase());
    if (!folder) { console.log('  FOLDER MISSING'); continue; }
    const folderId = (folder as any).id;
    const { count: files } = await sb.from('knowledge_files').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).eq('folder_id', folderId);
    console.log(`  files in folder: ${files}`);

    const fileRows = await fetchAllRows<{ id: string }>((from, to) =>
      sb.from('knowledge_files').select('id').eq('user_id', uid).eq('folder_id', folderId).order('id').range(from, to));
    let chunks = 0;
    for (let i = 0; i < fileRows.length; i += 200) {
      const { count } = await sb.from('knowledge_chunks').select('id', { count: 'exact', head: true })
        .in('file_id', fileRows.slice(i, i + 200).map((f) => f.id));
      chunks += count ?? 0;
    }
    console.log(`  chunks across folder: ${chunks}`);

    const { data: pm } = await sb.from('item_plans').select('id, entity_id').eq('user_id', uid)
      .eq('kind', 'profile_manifest').eq('entity_id', FOLDER_NAME).maybeSingle();
    const { data: mm } = await sb.from('item_plans').select('id').eq('user_id', uid)
      .eq('kind', 'tender_member_manifest').eq('entity_id', 'me').maybeSingle();
    console.log(`  profile_manifest: ${pm ? 'present' : 'MISSING'} | tender_member_manifest: ${mm ? 'present' : 'MISSING'}`);

    // scoped German semantic query
    const fileIds = new Set(fileRows.map((f) => f.id));
    const hits = await searchKnowledgeChunks(uid, 'Softwareentwicklung Lissabon', 60, sb, 0.15);
    const inFolder = hits.filter((h) => fileIds.has(h.fileId));
    console.log(`  semantic "Softwareentwicklung Lissabon": ${inFolder.length} in-folder hits (of ${hits.length} total)`);
    for (const h of inFolder.slice(0, 5)) console.log(`    • ${h.filename} (sim ${h.similarity?.toFixed?.(3) ?? '?'})`);
  }
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
