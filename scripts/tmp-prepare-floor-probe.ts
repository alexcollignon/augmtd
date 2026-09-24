// TEMPORARY probe (untracked) — why do campaign/misaddressed items reach the prepare lanes?
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getCampaignSignature, isCampaignEcho } from '@/lib/inbox/campaign-echo';
import { classifyItem } from '@/lib/inbox/classify-item';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const U = process.argv[2] || '08fe4449-e5eb-431d-9156-02e9324e5903';

async function main() {
  const sig = await getCampaignSignature(sb, U);
  console.log('signature:', { tokens: sig.tokens, templates: sig.templates.slice(0, 6), sentRead: sig.sentRead });

  // 1. prep:* narrations
  const { data: turns } = await sb.from('room_turns')
    .select('id, room_key, dedupe_key, text, created_at, archived_at')
    .eq('user_id', U).like('dedupe_key', 'prep:%')
    .order('created_at', { ascending: false }).limit(400);
  const live = (turns ?? []).filter((t: any) => !t.archived_at);
  console.log(`\nprep:* narrations: ${(turns ?? []).length} total, ${live.length} live`);

  // 2. their anchor items + echo status
  const ids = [...new Set(live.map((t: any) => String(t.room_key).split(':')[1]).filter(Boolean))];
  const { data: items } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data')
    .eq('user_id', U).in('id', ids.slice(0, 300));
  const byId = new Map((items ?? []).map((i: any) => [i.id, i]));

  let echoes = 0;
  const ex: string[] = [];
  for (const t of live) {
    const id = String(t.room_key).split(':')[1];
    const it: any = byId.get(id);
    if (!it) continue;
    if (isCampaignEcho(it, sig)) {
      echoes++;
      if (ex.length < 8) ex.push(`  · "${(it.source_data?.subject ?? it.work_title ?? '').slice(0, 70)}" — posture=${classifyItem(it as never, [])} — narr: ${String(t.text).slice(0, 80)}`);
    }
  }
  console.log(`  of which ECHO-anchored: ${echoes}`);
  ex.forEach((l) => console.log(l));

  // 3. judgments on echo items
  const { data: allItems } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data')
    .eq('user_id', U).eq('status', 'pending').limit(2000);
  const echoItems = (allItems ?? []).filter((i: any) => isCampaignEcho(i, sig));
  console.log(`\npending items: ${(allItems ?? []).length}; echo pending: ${echoItems.length}`);
  const keys = echoItems.map((i: any) => `inbox:${i.id}`);
  const verdicts: any[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const { data } = await sb.from('item_plans').select('entity_id, tasks, updated_at')
      .eq('user_id', U).eq('kind', 'judgment').in('entity_id', keys.slice(i, i + 100));
    verdicts.push(...(data ?? []));
  }
  const tally: Record<string, number> = {};
  for (const v of verdicts) {
    const w = v.tasks?.verdict?.work ?? '?';
    tally[w] = (tally[w] ?? 0) + 1;
  }
  console.log('verdict.work over echo items:', tally, `(judged ${verdicts.length}/${echoItems.length})`);
  for (const v of verdicts.filter((x) => x.tasks?.verdict?.work && x.tasks.verdict.work !== 'none').slice(0, 6)) {
    const it: any = (allItems ?? []).find((i: any) => `inbox:${i.id}` === v.entity_id);
    console.log(`  · [${v.tasks.verdict.work}] "${(it?.source_data?.subject ?? '').slice(0, 60)}" judged ${String(v.updated_at).slice(0, 10)} — ${String(v.tasks.verdict.reason ?? '').slice(0, 110)}`);
  }

  // 4. drafts standing on echo items
  const drafted = echoItems.filter((i: any) => i.source_data?.draft?.body);
  console.log(`\nechoes carrying a prepared draft: ${drafted.length}`);
  drafted.slice(0, 6).forEach((i: any) => console.log(`  · "${(i.source_data?.subject ?? '').slice(0, 70)}" prepared_by=${i.source_data?.prepared_by?.worker ?? '-'}`));
}
main();
