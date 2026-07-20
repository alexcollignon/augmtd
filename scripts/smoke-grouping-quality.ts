// PHASE B — CORRECTED apples-to-apples grouping-quality measure. The first instrument ("does this group
// contain distinct topics?") was TOO STRICT: it flagged facet-diversity within ONE coherent body of work
// (a subscription's billing + setup emails) as "lumped" — inflating BOTH the label baseline and the entity
// number. The corrected question is the one a human asks: "would these be filed under ONE body of work,
// or does the group MIX genuinely different matters (different deals/clients/subscriptions/affairs)?"
// Runs the SAME judge over BOTH systems' multi-item groups for the SAME users → a true comparison.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { aiCall } from '../lib/ai/call';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];
const MAX_GROUPS = 12;

async function judgeGroup(uid: string, name: string, titles: string[]): Promise<{ mixed: boolean; reason: string }> {
  const res = await aiCall<{ verdict?: string; reason?: string }>({
    userId: uid, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 180, source: 'brain_synthesis',
    prompt: `A person's work items are grouped under: "${name}".\n${titles.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
      `Would a person file ALL of these under that ONE body of work? Different facets of one matter (billing + setup of one subscription; several steps of one deal; sessions of one program) = ONE. ` +
      `Only answer "mixed" if the group MIXES genuinely different matters — different deals, different clients, different subscriptions, unrelated affairs.\n` +
      `JSON only: {"verdict":"one"|"mixed","reason":"<=12 words"}`,
  });
  const p = res.json ?? {};
  return { mixed: p.verdict === 'mixed', reason: String(p.reason || '') };
}

(async () => {
  let eMixed = 0, eTotal = 0, lMixed = 0, lTotal = 0;
  for (const uid of USERS) {
    // ── ENTITY groups (multi-item) ──
    const { data: ents } = await sb.from('work_entities').select('id, name').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active');
    const { data: links } = await sb.from('entity_links').select('entity_id, item_id').eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null);
    const idsAll = (links ?? []).map((l: any) => l.item_id);
    const { data: items } = await sb.from('inbox_items').select('id, work_title, source_data').in('id', idsAll.slice(0, 900));
    const itemById = new Map((items ?? []).map((i: any) => [i.id, i]));
    const entGroups = new Map<string, string[]>();
    for (const l of (links ?? []) as any[]) {
      const e = (ents ?? []).find((x: any) => x.id === l.entity_id); const it = itemById.get(l.item_id);
      if (!e || !it) continue;
      (entGroups.get((e as any).name) ?? entGroups.set((e as any).name, []).get((e as any).name)!).push(String(it.work_title || ''));
    }
    // ── LABEL groups (multi-item, SAME item pool so the comparison is fair) ──
    const labelGroups = new Map<string, string[]>();
    for (const it of (items ?? []) as any[]) {
      const lab = it.source_data?.understanding?.initiative;
      if (lab) (labelGroups.get(lab) ?? labelGroups.set(lab, []).get(lab)!).push(String(it.work_title || ''));
    }

    for (const [kind, groups, bump] of [['ENTITY', entGroups, (m: boolean) => { eTotal++; if (m) eMixed++; }], ['LABEL', labelGroups, (m: boolean) => { lTotal++; if (m) lMixed++; }]] as const) {
      const multi = [...groups.entries()].filter(([, t]) => t.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, MAX_GROUPS);
      for (const [name, titles] of multi) {
        const { mixed, reason } = await judgeGroup(uid, name, titles);
        (bump as (m: boolean) => void)(mixed);
        if (mixed) console.log(`  [${kind}] MIXED "${name}" (${titles.length}): ${reason}`);
      }
    }
    console.log(`user ${uid.slice(0, 8)} done`);
  }
  console.log('\n════ CORRECTED GROUPING QUALITY (same judge, same items, both systems) ════');
  console.log(`ENTITIES: ${eMixed}/${eTotal} groups mix different matters (${eTotal ? Math.round(100 * eMixed / eTotal) : 0}%)`);
  console.log(`LABELS:   ${lMixed}/${lTotal} groups mix different matters (${lTotal ? Math.round(100 * lMixed / lTotal) : 0}%)`);
})();
