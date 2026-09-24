import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SRC = '08fe4449-e5eb-431d-9156-02e9324e5903';
const SRC_FOLDER = 'cb6a203a-1a0a-4e5a-a4f6-f4a6016996a9';
const THORSTEN = '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7';
const DUMMY = 'de4e8824-9795-4876-995c-c0740b8f07ee';

(async () => {
  // 1. source folder + file count
  const { data: srcFolder } = await sb.from('drive_folders').select('*').eq('id', SRC_FOLDER).maybeSingle();
  console.log('SRC folder row:', JSON.stringify(srcFolder));
  const { count: srcFiles } = await sb.from('knowledge_files').select('id', { count: 'exact', head: true })
    .eq('user_id', SRC).eq('folder_id', SRC_FOLDER);
  console.log('SRC file count:', srcFiles);

  // 2. sample knowledge_files columns
  const { data: sampleFile } = await sb.from('knowledge_files').select('*')
    .eq('user_id', SRC).eq('folder_id', SRC_FOLDER).limit(1).maybeSingle();
  if (sampleFile) {
    console.log('knowledge_files columns:', Object.keys(sampleFile).join(','));
    const emb = (sampleFile as any).embedding;
    console.log('  sample filename:', (sampleFile as any).filename);
    console.log('  storage_path:', (sampleFile as any).storage_path);
    console.log('  provider_file_id:', (sampleFile as any).provider_file_id);
    console.log('  origin:', (sampleFile as any).origin, '| mime:', (sampleFile as any).mime_type);
    console.log('  embedding type:', typeof emb, '| len:', typeof emb === 'string' ? emb.length : Array.isArray(emb) ? emb.length : 'n/a');
    console.log('  extracted_text len:', ((sampleFile as any).extracted_text ?? '').length);
    // chunks for this file
    const { data: chunks, count: chunkCount } = await sb.from('knowledge_chunks').select('*', { count: 'exact' })
      .eq('file_id', (sampleFile as any).id);
    console.log('  chunks for sample file:', chunkCount);
    if (chunks && chunks[0]) {
      console.log('knowledge_chunks columns:', Object.keys(chunks[0]).join(','));
      const c0: any = chunks[0];
      console.log('  chunk emb type:', typeof c0.embedding, '| user_id:', c0.user_id, '| chunk_index:', c0.chunk_index);
    }
  }

  // 3. total chunks across the folder's files
  const { data: allFiles } = await sb.from('knowledge_files').select('id')
    .eq('user_id', SRC).eq('folder_id', SRC_FOLDER).order('id').limit(2000);
  const fileIds = (allFiles ?? []).map((f: any) => f.id);
  console.log('total src files fetched for chunk count:', fileIds.length);
  let totalChunks = 0;
  for (let i = 0; i < fileIds.length; i += 200) {
    const { count } = await sb.from('knowledge_chunks').select('id', { count: 'exact', head: true })
      .in('file_id', fileIds.slice(i, i + 200));
    totalChunks += count ?? 0;
  }
  console.log('SRC total chunks across folder:', totalChunks);

  // 4. item_plans manifest rows for source
  const { data: plans } = await sb.from('item_plans').select('id, kind, entity_id, updated_at')
    .eq('user_id', SRC).in('kind', ['tender_member_manifest', 'profile_manifest', 'match_seen']);
  console.log('SRC item_plans (manifest/seen):', JSON.stringify(plans));

  // 5. targets: folders named AHK Member companies
  for (const [label, uid] of [['THORSTEN', THORSTEN], ['DUMMY', DUMMY]] as const) {
    const { data: folders } = await sb.from('drive_folders').select('id, name').eq('user_id', uid);
    const match = (folders ?? []).find((f: any) => f.name?.toLowerCase() === 'ahk member companies');
    console.log(`${label} folder 'AHK Member companies':`, match ? JSON.stringify(match) : 'NONE', `| total folders: ${folders?.length}`);
    if (match) {
      const { count } = await sb.from('knowledge_files').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).eq('folder_id', (match as any).id);
      console.log(`  ${label} existing files in folder:`, count);
    }
    // Max coworker
    const { data: max } = await sb.from('custom_agents').select('id, name, worker_role, is_worker')
      .eq('user_id', uid).eq('worker_role', 'research_analyst').eq('is_worker', true);
    console.log(`  ${label} Max (research_analyst):`, JSON.stringify(max));
    // login email
    const { data: prof } = await sb.from('profiles').select('id, email, full_name').eq('id', uid).maybeSingle();
    console.log(`  ${label} profile:`, JSON.stringify(prof));
    // existing tender workflow
    const { data: wfs } = await sb.from('workflows').select('id, name, status, agent_id').eq('user_id', uid);
    console.log(`  ${label} workflows:`, JSON.stringify(wfs));
  }

  // 6. drive_folders columns
  const { data: dfSample } = await sb.from('drive_folders').select('*').eq('user_id', SRC).limit(1).maybeSingle();
  if (dfSample) console.log('drive_folders columns:', Object.keys(dfSample).join(','));
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
