// ONE BRAIN — BLOCKER D: fold the `projects` table into TRACKED ENTITIES. For each project row:
//   • resolve its entity — MEMBERSHIP vote (its member items' entity_links) → name/alias match → else
//     FOUND a new entity named after the project (a user-declared body of work deserves a row).
//   • active → tracked=true; done/archived → the entity keeps its own status unless the project's is
//     terminal and the entity is active-but-stale (we do NOT force-close a живой entity).
//   • goals/rules copy onto the entity (requires migration 20260722_work_entities_goals.sql — warns if absent).
// Idempotent (re-runnable). Usage: npx tsx scripts/migrate-projects-to-entities.ts [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

(async () => {
  const { data: projects } = await sb.from('projects').select('id, user_id, name, description, goals, rules, status');
  const rows = (projects ?? []) as Array<{ id: string; user_id: string; name: string; description: string | null; goals: unknown; rules: unknown; status: string }>;
  let goalsColumn = true;
  for (const p of rows) {
    // 1. membership vote
    const [{ data: mi }, { data: mc }] = await Promise.all([
      sb.from('inbox_items').select('id').eq('user_id', p.user_id).eq('project_id', p.id) as never as Promise<{ data: Array<{ id: string }> }>,
      sb.from('commitments').select('id').eq('user_id', p.user_id).eq('project_id', p.id) as never as Promise<{ data: Array<{ id: string }> }>,
    ]);
    const memberIds = [...(mi ?? []), ...(mc ?? [])].map((x) => x.id);
    let entityId: string | null = null;
    if (memberIds.length) {
      const { data: links } = await sb.from('entity_links').select('entity_id').eq('user_id', p.user_id).in('item_kind', ['inbox_item', 'commitment']).in('item_id', memberIds).not('entity_id', 'is', null);
      const votes = new Map<string, number>();
      for (const l of (links ?? []) as Array<{ entity_id: string }>) votes.set(l.entity_id, (votes.get(l.entity_id) ?? 0) + 1);
      const [best, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      if (best && (n as number) >= 2) entityId = best as string;
    }
    // 2. name/alias match
    if (!entityId) {
      const { data: ents } = await sb.from('work_entities').select('id, name, aliases').eq('user_id', p.user_id).eq('kind', 'initiative');
      const hit = ((ents ?? []) as Array<{ id: string; name: string; aliases: unknown }>).find((e) =>
        nk(e.name) === nk(p.name) || (Array.isArray(e.aliases) && (e.aliases as string[]).some((a) => nk(a) === nk(p.name))));
      if (hit) entityId = hit.id;
    }
    // 3. else FOUND
    let founded = false;
    if (!entityId && APPLY) {
      const { data: created } = await sb.from('work_entities').insert({
        user_id: p.user_id, kind: 'initiative', name: p.name, summary: p.description,
        aliases: [p.name], tracked: false, status: 'active',
      }).select('id').single();
      entityId = (created?.id as string) ?? null;
      founded = true;
    }
    if (!entityId) { console.log(`  [dry] "${p.name}" → would FOUND a new entity`); continue; }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (p.status === 'active') patch.tracked = true;
    if (p.status === 'done' || p.status === 'archived') {
      // only settle the status if the entity isn't visibly alive
      const { data: e } = await sb.from('work_entities').select('status, state').eq('id', entityId).single();
      const mom = ((e?.state ?? null) as { momentum?: string } | null)?.momentum;
      if (e?.status === 'active' && mom !== 'needs_you' && mom !== 'active') patch.status = p.status;
    }
    const goals = Array.isArray(p.goals) ? p.goals : [];
    const rules = Array.isArray(p.rules) ? p.rules : [];
    if (goals.length || rules.length) { patch.goals = goals; patch.rules = rules; }

    if (!APPLY) { console.log(`  [dry] "${p.name}" (${p.status}) → entity ${entityId.slice(0, 8)}${founded ? ' (new)' : ''} · tracked:${!!patch.tracked} · goals:${goals.length} rules:${rules.length}`); continue; }
    const { error } = await sb.from('work_entities').update(patch).eq('id', entityId).eq('user_id', p.user_id);
    if (error && (goals.length || rules.length) && /goals|rules|column/i.test(error.message)) {
      goalsColumn = false;
      delete patch.goals; delete patch.rules;
      await sb.from('work_entities').update(patch).eq('id', entityId).eq('user_id', p.user_id);
    }
    console.log(`  ✓ "${p.name}" (${p.status}) → entity ${entityId.slice(0, 8)}${founded ? ' (FOUNDED)' : ''} · tracked:${!!patch.tracked}`);
  }
  if (!goalsColumn) console.log('\n⚠️  goals/rules NOT copied — apply 20260722_work_entities_goals.sql and re-run.');
  if (!APPLY) console.log('\nDry-run. Re-run with --apply.');
})();
