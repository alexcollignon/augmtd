import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { classifyItem } from '@/lib/inbox/classify-item';
import { getCampaignSignature } from '@/lib/inbox/campaign-echo';
import { noiseOf } from '@/lib/prepare/noise-floor';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const U = process.argv[2] || '08fe4449-e5eb-431d-9156-02e9324e5903';

async function main() {
  const sig = await getCampaignSignature(sb, U);
  const { data: turns } = await sb.from('room_turns')
    .select('room_key, text, created_at, archived_at').eq('user_id', U)
    .like('dedupe_key', 'prep:%').order('created_at', { ascending: false }).limit(400);
  const live = (turns ?? []).filter((t: any) => !t.archived_at);
  const ids = [...new Set(live.map((t: any) => String(t.room_key).split(':')[1]).filter(Boolean))];
  const { data: items } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, source_data, status')
    .eq('user_id', U).in('id', ids.slice(0, 300));
  const byId = new Map((items ?? []).map((i: any) => [i.id, i]));
  let floored = 0, total = 0;
  const ex: string[] = [];
  for (const t of live) {
    const it: any = byId.get(String(t.room_key).split(':')[1]);
    if (!it) continue;
    total++;
    const n = noiseOf(it, sig);
    if (n.noise) {
      floored++;
      if (ex.length < 14) ex.push(`  · [${n.via}] "${String(it.work_title).slice(0, 58)}" (status ${it.status}, posture ${classifyItem(it as never, [])}) — ${String(t.text).slice(0, 62)}`);
    }
  }
  console.log(`LIVE prep narrations with a readable item: ${total}; the floor would have refused ${floored}`);
  ex.forEach((l) => console.log(l));
}
main();
