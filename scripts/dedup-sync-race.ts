// ONE-TIME DEDUP of the initial-sync race's residue (fixed at the cause by claimSync — this cleans
// what the race already created): exact-duplicate work_entities (same user+kind+name — two parallel
// first syncs founded the same entity twice before either link landed) and duplicate inbox_items
// (same user + message_id — the per-user email dedup raced). Keeper = the OLDEST row; the duplicate's
// entity_links repoint to the keeper (skipping items already linked); aliases/people merge into the
// keeper. Dry-run by default; `--apply` writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  // ── 1. Duplicate entities ──
  const { data: ents } = await sb.from('work_entities')
    .select('id, user_id, kind, name, aliases, people, created_at').order('created_at', { ascending: true }).limit(3000);
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const e of (ents ?? []) as Array<Record<string, unknown>>) {
    const k = `${e.user_id}|${e.kind}|${String(e.name).trim().toLowerCase()}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  let entDupes = 0;
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const keeper = g[0]; // oldest
    for (const dupe of g.slice(1)) {
      entDupes++;
      console.log(`${APPLY ? 'MERGE' : 'would merge'} entity "${keeper.name}" (${String(dupe.id).slice(0, 8)} → ${String(keeper.id).slice(0, 8)}) · user ${String(keeper.user_id).slice(0, 8)}`);
      if (!APPLY) continue;
      // Repoint the duplicate's links — skip items the keeper already links (item unique per kind+id).
      const { data: dupeLinks } = await sb.from('entity_links').select('item_kind, item_id').eq('entity_id', dupe.id as string);
      const { data: keeperLinks } = await sb.from('entity_links').select('item_kind, item_id').eq('entity_id', keeper.id as string);
      const seen = new Set((keeperLinks ?? []).map((l) => `${l.item_kind}|${l.item_id}`));
      for (const l of dupeLinks ?? []) {
        if (seen.has(`${l.item_kind}|${l.item_id}`)) {
          await sb.from('entity_links').delete().eq('entity_id', dupe.id as string).eq('item_kind', l.item_kind).eq('item_id', l.item_id);
        } else {
          await sb.from('entity_links').update({ entity_id: keeper.id as string }).eq('entity_id', dupe.id as string).eq('item_kind', l.item_kind).eq('item_id', l.item_id);
        }
      }
      // Merge aliases + people fingerprints into the keeper.
      const aliases = [...new Set([...(keeper.aliases as string[] ?? []), ...(dupe.aliases as string[] ?? [])])];
      const people = [...new Set([...(keeper.people as string[] ?? []), ...(dupe.people as string[] ?? [])])];
      await sb.from('work_entities').update({ aliases, people, updated_at: new Date().toISOString() }).eq('id', keeper.id as string);
      // Re-home room turns keyed to the duplicate's entity room.
      await sb.from('room_turns').update({ room_key: keeper.id as string }).eq('room_key', dupe.id as string).then(() => {}, () => {});
      await sb.from('work_entities').delete().eq('id', dupe.id as string);
    }
  }

  // ── 2. Duplicate inbox items (same user + message_id, both live) ──
  const { data: items } = await sb.from('inbox_items')
    .select('id, user_id, status, work_title, source_data, created_at')
    .eq('status', 'pending').eq('source', 'email').order('created_at', { ascending: true }).limit(5000);
  const byMsg = new Map<string, Array<Record<string, unknown>>>();
  for (const it of (items ?? []) as Array<Record<string, unknown>>) {
    const mid = ((it.source_data as Record<string, unknown>)?.message_id as string) ?? null;
    if (!mid) continue;
    const k = `${it.user_id}|${mid}`;
    (byMsg.get(k) ?? byMsg.set(k, []).get(k)!).push(it);
  }
  let itemDupes = 0;
  for (const [, g] of byMsg) {
    if (g.length < 2) continue;
    const keeper = g[0];
    for (const dupe of g.slice(1)) {
      itemDupes++;
      console.log(`${APPLY ? 'DELETE' : 'would delete'} duplicate item "${String(dupe.work_title).slice(0, 50)}" (${String(dupe.id).slice(0, 8)}, keeper ${String(keeper.id).slice(0, 8)}) · user ${String(keeper.user_id).slice(0, 8)}`);
      if (!APPLY) continue;
      await sb.from('entity_links').delete().eq('item_kind', 'inbox_item').eq('item_id', dupe.id as string).then(() => {}, () => {});
      await sb.from('item_plans').delete().eq('entity_id', `inbox:${dupe.id}`).then(() => {}, () => {});
      await sb.from('inbox_items').delete().eq('id', dupe.id as string);
    }
  }
  console.log(`${APPLY ? 'done' : 'dry-run'} — ${entDupes} duplicate entit${entDupes === 1 ? 'y' : 'ies'}, ${itemDupes} duplicate item(s)`);
})();
