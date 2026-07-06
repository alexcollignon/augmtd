import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UID = '08fe4449-e5eb-431d-9156-02e9324e5903';

async function snapshot(label: string) {
  const { data: items } = await sb.from('inbox_items')
    .select('id, status, work_state, updated_at, last_activity_at, source_data')
    .eq('user_id', UID).eq('source','email')
    .ilike('source_data->>subject', '%Omantel%')
    .order('created_at', { ascending: false });
  console.log(`\n[${label}] Omantel items:`);
  items?.forEach(i => {
    const sd = i.source_data as any;
    console.log(`  id=${i.id.slice(0,8)} status=${i.status} ws=${i.work_state} sd.received=${sd?.received_at?.slice(5,19)} lastAct=${i.last_activity_at?.slice(5,19)} upd=${i.updated_at?.slice(5,19)}`);
  });
}

async function main() {
  const provider = process.argv[2] || 'outlook';
  const { data: conn } = await sb.from('connections').select('*').eq('user_id', UID).eq('provider', provider).maybeSingle();
  if (!conn) { console.error('no conn'); return; }
  await snapshot('BEFORE');
  console.log(`\n=== Running syncEmailsForConnection(${provider}, {syncWindowDays:3}) ===`);
  const res = await syncEmailsForConnection(conn, sb, { syncWindowDays: 3 });
  console.log('\nRESULT:', JSON.stringify(res));
  await snapshot('AFTER');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
