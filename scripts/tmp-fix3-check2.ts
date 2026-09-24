import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { classifyItem } from '@/lib/inbox/classify-item';
import { getCampaignSignature, isCampaignEcho } from '@/lib/inbox/campaign-echo';
import { rePromotesToDeck, noticeIsDemoted, type DeckFloors } from '@/lib/home/deck-floors';
import { noiseOf } from '@/lib/prepare/noise-floor';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const U = process.argv[2] || '08fe4449-e5eb-431d-9156-02e9324e5903';

async function main() {
  const sig = await getCampaignSignature(sb, U);
  const { data } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, source_data, status')
    .eq('user_id', U).eq('status', 'pending').limit(2000);
  const rows = (data ?? []) as any[];
  const floors: DeckFloors = { judgedNone: new Set<string>(), isEcho: (it) => isCampaignEcho(it as never, sig) };

  const hits = rows.filter((r) => /wrong recipient|misaddress|financial offer/i.test(String(r.work_title ?? '')));
  console.log(`"wrong recipient"-class rows: ${hits.length}`);
  for (const r of hits.slice(0, 8)) {
    const n = noiseOf(r, sig);
    console.log(`  · "${String(r.work_title).slice(0, 60)}" posture=${classifyItem(r as never, [])} deckEligible=${rePromotesToDeck(r, classifyItem(r as never, []), floors) && !noticeIsDemoted(r, floors)} floor=${n.noise ? n.via : 'no'}`);
  }

  const key = rows.find((r) => /OpenAI API key leaked/i.test(String(r.work_title ?? '')));
  if (key) {
    const p = classifyItem(key as never, []);
    console.log(`\nOpenAI-key row: posture=${p} deckEligible=${rePromotesToDeck(key, p, floors) && !noticeIsDemoted(key, floors)} floor=${noiseOf(key, sig).via} understanding=${JSON.stringify(key.source_data?.understanding ?? null).slice(0, 160)}`);
  }
}
main();
