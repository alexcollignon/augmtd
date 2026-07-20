// PHASE B — ENTITIES vs LABELS at scale (the apples-to-apples baseline re-measure). Two parts:
//   1. DETERMINISTIC comparison (no AI): merges (entities unifying ≥2 old labels) and splits (old labels
//      separated into ≥2 entities), from the stored links + each item's old label.
//   2. THE BASELINE RE-RUN: the SAME "lumping judge" Phase 0 ran on labels (50% lumped distinct topics),
//      now run on multi-item ENTITIES. Success = the lumped rate drops sharply.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { aiCall } from '../lib/ai/call';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];

(async () => {
  let totEnts = 0, totMulti = 0, totLumped = 0, totMerges = 0, totSplits = 0;
  for (const uid of USERS) {
    const { data: ents } = await sb.from('work_entities').select('id, name').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active');
    const { data: links } = await sb.from('entity_links').select('entity_id, item_id').eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null);
    const itemIds = (links ?? []).map((l: any) => l.item_id);
    const { data: items } = await sb.from('inbox_items').select('id, work_title, source_data').in('id', itemIds.slice(0, 800));
    const itemById = new Map((items ?? []).map((i: any) => [i.id, i]));
    const byEntity = new Map<string, { name: string; titles: string[]; oldLabels: Set<string> }>();
    for (const e of (ents ?? []) as any[]) byEntity.set(e.id, { name: e.name, titles: [], oldLabels: new Set() });
    const labelToEntities = new Map<string, Set<string>>();
    for (const l of (links ?? []) as any[]) {
      const ent = byEntity.get(l.entity_id); const it = itemById.get(l.item_id);
      if (!ent || !it) continue;
      ent.titles.push(String(it.work_title || ''));
      const old = it.source_data?.understanding?.initiative;
      if (old) { ent.oldLabels.add(old); (labelToEntities.get(old) ?? labelToEntities.set(old, new Set()).get(old)!).add(ent.name); }
    }

    // 1. Deterministic: merges + splits vs the label system.
    const merges = [...byEntity.values()].filter((e) => e.oldLabels.size >= 2);
    const splits = [...labelToEntities.entries()].filter(([, s]) => s.size >= 2);
    totMerges += merges.length; totSplits += splits.length;

    // 2. The Phase-0 lumping judge, on ENTITIES with ≥3 items (same prompt shape as the label baseline).
    const multi = [...byEntity.values()].filter((e) => e.titles.length >= 3);
    let lumped = 0;
    for (const e of multi.slice(0, 12)) {
      const subs = e.titles.slice(0, 8);
      const res = await aiCall<{ distinct_topics?: number; verdict?: string; reason?: string }>({
        userId: uid, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 200, source: 'brain_synthesis',
        prompt: `These email subjects are ALL grouped as one body of work: "${e.name}".\n${subs.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nDo they all belong to ONE body of work, or does this group lump together 2+ DISTINCT topics/deals? Judge by CONTENT. JSON only: {"distinct_topics": <int>, "verdict": "one"|"lumped", "reason": "<=12 words"}`,
      });
      const p = res.json ?? {};
      if (p.verdict === 'lumped' || (p.distinct_topics ?? 1) >= 2) { lumped++; console.log(`  LUMPED "${e.name}": ${p.reason ?? ''}`); }
    }
    totEnts += (ents ?? []).length; totMulti += Math.min(multi.length, 12); totLumped += lumped;
    console.log(`user ${uid.slice(0, 8)} — entities:${(ents ?? []).length} · merges(≥2 old labels unified):${merges.length} · splits(old label separated):${splits.length} · lumped:${lumped}/${Math.min(multi.length, 12)}`);
  }
  console.log('\n════ ENTITIES vs the 50% LABEL BASELINE ════');
  console.log(`entities: ${totEnts} · synonym MERGES achieved: ${totMerges} · over-merge SPLITS achieved: ${totSplits}`);
  console.log(`LUMPING RATE on multi-item groups: entities ${totMulti ? Math.round(100 * totLumped / totMulti) : 0}% (${totLumped}/${totMulti})  vs  labels 50% (Phase-0 baseline)`);
})();
