// ONE BRAIN — DEEP-DIVE PLAN smoke (3a). Proves plans are now ENTITY-ANCHORED, not blind per-item guesses:
// for real linked items whose entity carries a next move, (1) buildItemContext must contain the entity's
// [THE WIDER WORK] block + THE ONE NEXT MOVE line, and (2) a LIVE generateItemPlan must produce steps that
// advance that move (the projection). Real AI calls — the only way to prove a plan prompt (the documented
// item-plan lesson). Cross-user, bounded.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildItemContext } from '../lib/home/item-context';
import { generateItemPlan } from '../lib/home/item-plan';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];

(async () => {
  let totChecked = 0, totWiderWork = 0, totWithMoveLine = 0, totAligned = 0;
  for (const uid of USERS) {
    // Linked items whose ENTITY has a next move — the projection cases.
    const { data: ents } = await sb.from('work_entities').select('id, name, next_move').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').not('next_move', 'is', null);
    const entById = new Map((ents ?? []).map((e: any) => [e.id, e]));
    const { data: links } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).eq('item_kind', 'inbox_item').in('entity_id', [...entById.keys()]).not('entity_id', 'is', null).limit(60);
    // Live (unresolved) items only.
    const ids = (links ?? []).map((l: any) => l.item_id);
    const { data: items } = await sb.from('inbox_items').select('id, status, rule_type, source_data').in('id', ids.slice(0, 60));
    const live = ((items ?? []) as any[]).filter((it) => it.status !== 'completed' && it.status !== 'dismissed').slice(0, 3); // cost cap: 3/user
    for (const it of live) {
      totChecked++;
      const link = (links ?? []).find((l: any) => l.item_id === it.id) as any;
      const ent = entById.get(link.entity_id) as any;
      const ctx = await buildItemContext(sb, uid, 'email', it.id);
      const hasBlock = !!ctx?.text.includes('[THE WIDER WORK');
      const hasMove = !!ctx?.text.includes('THE ONE NEXT MOVE');
      if (hasBlock) totWiderWork++;
      if (hasMove) totWithMoveLine++;
      // LIVE plan generation with the anchored context.
      const rel = it.source_data?.understanding?.relevance ?? null;
      const plan = await generateItemPlan(sb, uid, { kind: 'email', entityId: it.id, context: ctx?.text ?? '', relevance: rel });
      const steps = (plan.tasks ?? []).map((t: any) => t.text).join(' | ');
      // Alignment: does the plan share meaningful words with the entity's move? (rough signal + eyeball print)
      const moveWords = String(ent.next_move?.title ?? '').toLowerCase().split(/\W+/).filter((w: string) => w.length > 3);
      const aligned = moveWords.some((w: string) => steps.toLowerCase().includes(w));
      if (aligned) totAligned++;
      console.log(`\n  entity "${ent.name.slice(0, 30)}" — move: "${ent.next_move?.title ?? '—'}"`);
      console.log(`   ctx: widerWork=${hasBlock ? '✓' : '✗'} moveLine=${hasMove ? '✓' : '✗'} · plan steps: ${steps.slice(0, 150)}`);
    }
    console.log(`user ${uid.slice(0, 8)} done`);
  }
  console.log(`\n════ ENTITY-ANCHORED PLANS ════`);
  console.log(`items: ${totChecked} · context carries the wider work: ${totWiderWork} · carries THE move: ${totWithMoveLine} · plan lexically aligned with the move: ${totAligned}`);
})();
