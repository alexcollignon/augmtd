/** Diagnose (read-only) item_plans persistence + Home brief liveness. Usage: npx tsx scripts/diag-home-live.ts */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Real user
  const { data: prof } = await sb.from('profiles').select('id, email, home_brief').ilike('email', '%alextcollignon%').maybeSingle();
  const uid = prof?.id;
  console.log('USER:', prof?.email, uid);

  // 1) item_plans persistence
  const { count: planCount } = await sb.from('item_plans').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  const { data: recentPlans } = await sb.from('item_plans').select('kind, entity_id, updated_at').eq('user_id', uid).order('updated_at', { ascending: false }).limit(5);
  console.log('\n=== item_plans rows for user:', planCount);
  recentPlans?.forEach(p => console.log('  ', p.kind, p.entity_id, p.updated_at));

  // 2) brief cache staleness
  const hb = prof?.home_brief as { sig?: string; generatedAt?: string; ts?: string } | null;
  console.log('\n=== home_brief cache:');
  console.log('  sig:', hb?.sig?.slice(0, 120));
  console.log('  generatedAt/ts:', hb?.generatedAt || hb?.ts || '(none)');
  console.log('  keys:', hb ? Object.keys(hb) : '(null cache)');

  // 3) newest inbox items vs cache time — are fresh emails synced + would they surface?
  const { data: newest } = await sb.from('inbox_items')
    .select('created_at, last_activity_at, work_state, rule_type, status, source_data')
    .eq('user_id', uid).order('created_at', { ascending: false }).limit(8);
  console.log('\n=== newest 8 inbox_items:');
  newest?.forEach(i => {
    const sd = i.source_data as { subject?: string; from_name?: string; labeled?: boolean } | null;
    console.log(`  ${i.created_at?.slice(5,16)} ws=${i.work_state} rule=${i.rule_type} st=${i.status} lbl=${sd?.labeled} | ${(sd?.subject||'').slice(0,45)} <${sd?.from_name||''}>`);
  });
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
