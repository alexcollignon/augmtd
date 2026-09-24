import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getCampaignSignature } from '@/lib/inbox/campaign-echo';
import { noiseOf } from '@/lib/prepare/noise-floor';
import { ensureLooseRoomBrief, readRoomResponse } from '@/lib/room/brief';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const U = process.argv[2] || '08fe4449-e5eb-431d-9156-02e9324e5903';

async function main() {
  const sig = await getCampaignSignature(sb, U);
  const { data } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, source_data, status')
    .eq('user_id', U).eq('status', 'pending').limit(2000);
  const echoes = (data ?? []).filter((r: any) => noiseOf(r, sig).noise && noiseOf(r, sig).via === 'echo');
  console.log(`echo rows available: ${echoes.length}`);
  for (const it of echoes.slice(0, 2) as any[]) {
    const roomKey = `inbox:${it.id}`;
    const before = await readRoomResponse(sb, U, roomKey);
    console.log(`\n──── ${it.work_title} [${roomKey}] ────`);
    console.log(`BEFORE (cached, v10 or none): ${before ? `${before.text}\n   MOVE: ${before.move?.label ?? '—'} → ${before.move?.ref ?? 'unlinked'}` : '(no v11 brief cached — version bump invalidated it)'}`);
    await ensureLooseRoomBrief(sb, U, roomKey, {
      title: it.work_title, who: it.source_data?.from_name ?? null,
      ask: it.source_data?.understanding?.ask ?? null, prepared: it.source_data?.draft ? 'draft' : null,
    });
    const after = await readRoomResponse(sb, U, roomKey);
    console.log(`AFTER  (v11): ${after ? `${after.text}\n   MOVE: ${after.move ? `${after.move.label} → ${after.move.ref ?? 'unlinked'}` : '(none — a move may not point at noise)'}\n   OFFERS: ${after.offers.map((o) => o.label).join(' · ') || '—'}` : '(compose produced nothing)'}`);
  }
}
main();
