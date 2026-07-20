// READ-ONLY cross-user smoke for Step 2 — proves the drafter now receives grounded RELATIONSHIP & DEAL
// context. For recent inbox items, run the SAME renderBrainContext the drafter calls (sender + the item's
// initiative) and report how many produce a non-empty block, plus samples to eyeball. No writes, no AI.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { renderBrainContext } from '../lib/context/brain-context';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: psUsers } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((psUsers ?? []).map((r: any) => r.user_id))];

  let totItems = 0, totWithBlock = 0, totPersonOnly = 0, totBoth = 0;
  let shown = 0;

  for (const uid of userIds) {
    const { data: items } = await sb.from('inbox_items').select('source_data').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(60);
    let withBlock = 0;
    for (const it of (items ?? []) as any[]) {
      totItems++;
      const sd = it.source_data ?? {};
      const from = sd.from_address || sd.from || '';
      const initiative = sd.understanding?.initiative ?? null;
      if (!from) continue;
      const block = await renderBrainContext(sb, uid, { personEmail: from, personName: sd.from_name || null, initiative });
      if (!block) continue;
      withBlock++; totWithBlock++;
      const hasInit = block.includes('[THE INITIATIVE');
      if (hasInit) totBoth++; else totPersonOnly++;
      if (shown < 6) {
        shown++;
        console.log('\n' + block.split('\n').map((l) => '   ' + l).join('\n'));
      }
    }
    console.log(`\nuser ${uid.slice(0, 8)} — items:${(items ?? []).length} with-brain-context:${withBlock}`);
  }

  console.log('\n════ TOTALS ════');
  console.log(`inbox items sampled: ${totItems}  ·  produced a brain-context block: ${totWithBlock} (${totItems ? Math.round(100*totWithBlock/totItems) : 0}%)`);
  console.log(`  person + initiative: ${totBoth}  ·  person only: ${totPersonOnly}`);
})();
