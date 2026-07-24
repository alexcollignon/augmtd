// G2 SWEEP (work-surface plan) — consolidate EXISTING sibling commitments that are fragments of one
// motion (extracted before G1's obligation-level rule): same source, same resolved counterparty,
// same direction, all still open → ONE reasoned judgment; merge = keeper gets the motion description
// + the parts as its item-plan steps, the others are dismissed with resolved_reason 'consolidated'
// (reversible via restore). Dry-run by default; `--apply` writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '../lib/ai/factory';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';
import { PLAN_VERSION } from '../lib/home/capability-map';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: profs } = await sb.from('profiles').select('id');
  for (const p of (profs ?? []) as Array<{ id: string }>) {
    const uid = p.id;
    const persons = await getPersonEntities(sb, uid);
    const { data: open } = await sb.from('commitments')
      .select('id, description, counterparty, direction, source, source_id, due_date, created_at')
      .eq('user_id', uid).eq('status', 'open').limit(600);
    const rows = (open ?? []) as Array<{ id: string; description: string; counterparty: string | null; direction: string; source: string; source_id: string | null; due_date: string | null; created_at: string }>;
    if (rows.length < 2) continue;

    // Group 1: same source_id + same resolved counterparty + same direction.
    // Group 2 (cross-source): same DEAL (entity link) + same counterparty + direction — the observed
    // case is an email fragment + a meeting fragment of one motion. The judge keeps real separates apart.
    const { data: links } = await sb.from('entity_links').select('item_id, entity_id')
      .eq('user_id', uid).eq('item_kind', 'commitment').in('item_id', rows.map((r) => r.id)).not('entity_id', 'is', null);
    const entOf = new Map(((links ?? []) as Array<{ item_id: string; entity_id: string }>).map((l) => [l.item_id, l.entity_id]));
    const groups = new Map<string, typeof rows>();
    for (const c of rows) {
      const canon = c.counterparty ? (resolveIdentity(persons, c.counterparty).canonical ?? c.counterparty).toLowerCase().trim() : null;
      if (c.source_id && canon) {
        const k1 = `src·${c.source_id}·${c.direction}·${canon}`;
        (groups.get(k1) ?? groups.set(k1, [] as never).get(k1)!).push(c);
      }
      // Entity pass keys by DEAL + direction only — a null counterparty just means the extractor
      // couldn't name it; the conservative judge is the gate against over-grouping.
      const eid = entOf.get(c.id);
      if (eid) {
        const k2 = `ent·${eid}·${c.direction}`;
        const arr = groups.get(k2) ?? groups.set(k2, [] as never).get(k2)!;
        if (arr.length < 5) arr.push(c);
      }
    }
    // A row may appear in both groupings — once merged, it can't merge again.
    const consumed = new Set<string>();
    let mergedGroups = 0, folded = 0;
    for (const gRaw of [...groups.values()]) {
      const g = gRaw.filter((c) => !consumed.has(c.id));
      if (g.length < 2) continue;
      const listTxt = g.map((c, n) => `${n}. ${c.description}`).join('\n');
      const { client: ai, model } = await getAIClient(uid, 'classification', sb);
      let verdict: { merge?: boolean; description?: string; steps?: string[] } = {};
      try {
        const res = await aiCreate(ai, {
          model, max_tokens: 300, temperature: 0,
          messages: [{ role: 'user', content:
            `These open tasks came from ONE ${g[0].source} with the SAME counterparty:\n${listTxt}\n\n` +
            `Are they parts of a SINGLE motion — one thing you'd mark done ONCE (e.g. one reply covering all of them)? ` +
            `Merge ONLY if clearly one deliverable/motion; genuinely separate obligations stay separate.\n` +
            `JSON only: {"merge":true,"description":"<the one motion>","steps":["<part>", "..."]} or {"merge":false}` }],
        });
        verdict = JSON.parse((res.choices?.[0]?.message?.content ?? '{}').replace(/^```(json)?|```$/gm, '').trim());
      } catch { continue; }
      if (verdict.merge !== true || !verdict.description?.trim()) continue;
      mergedGroups++;
      g.forEach((c) => consumed.add(c.id));
      const keeper = [...g].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      const others = g.filter((c) => c.id !== keeper.id);
      const due = g.map((c) => c.due_date).filter(Boolean).sort()[0] ?? null;
      console.log(`  ${APPLY ? 'MERGE' : 'would merge'} [${uid.slice(0, 8)}] ${g.length} → "${verdict.description.slice(0, 60)}" (+${(verdict.steps ?? []).length} steps)`);
      if (!APPLY) continue;
      await sb.from('commitments').update({ description: verdict.description.trim().slice(0, 500), due_date: due, updated_at: new Date().toISOString() }).eq('id', keeper.id);
      for (const o of others) {
        await sb.from('commitments').update({ status: 'dismissed', resolved_reason: 'consolidated', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', o.id);
        folded++;
      }
      const steps = (Array.isArray(verdict.steps) ? verdict.steps : []).slice(0, 5);
      if (steps.length >= 2) {
        await sb.from('item_plans').upsert({
          user_id: uid, kind: 'commitment', entity_id: keeper.id,
          tasks: steps.map((s, i) => ({ id: `g2-${i}`, text: String(s).slice(0, 120), actor: 'you', done: false })),
          version: PLAN_VERSION, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,kind,entity_id' });
      }
    }
    if (mergedGroups) console.log(`══ ${uid.slice(0, 8)} — groups merged:${mergedGroups} · fragments folded:${folded}${APPLY ? ' (APPLIED)' : ' (dry-run)'}`);
  }
  process.exit(0);
})();
