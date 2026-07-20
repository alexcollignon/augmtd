// ONE BRAIN — populate each entity's PEOPLE fingerprint from its linked items (the identity signal recall +
// the judge use to separate same-topic deals). Requires 20260720_work_entities_people.sql. Idempotent.
// Usage: npx tsx scripts/backfill-entity-people.ts [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { normPerson } from '../lib/entities/recognize';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: conns } = await sb.from('connections').select('user_id');
  const users = [...new Set((conns ?? []).map((c: { user_id: string }) => c.user_id))];
  for (const uid of users) {
    const { data: links } = await sb.from('entity_links').select('entity_id, item_kind, item_id').eq('user_id', uid).not('entity_id', 'is', null);
    const byKind = new Map<string, Array<{ e: string; i: string }>>();
    for (const l of (links ?? []) as any[]) (byKind.get(l.item_kind) ?? byKind.set(l.item_kind, []).get(l.item_kind)!).push({ e: l.entity_id, i: l.item_id });
    const people = new Map<string, Set<string>>();
    const add = (e: string, p?: string | null) => { if (!p) return; const n = normPerson(p); if (n.length >= 2) (people.get(e) ?? people.set(e, new Set()).get(e)!).add(n); };
    // inbox → from_name; commitment → counterparty; meeting → attendees
    for (const [kind, ls] of byKind) {
      const ids = ls.map((l) => l.i);
      for (let k = 0; k < ids.length; k += 300) {
        const chunk = ids.slice(k, k + 300);
        if (kind === 'inbox_item') { const { data } = await sb.from('inbox_items').select('id, source_data').in('id', chunk); const m = new Map((data ?? []).map((r: any) => [r.id, r.source_data?.from_name || r.source_data?.from_address])); for (const l of ls) if (chunk.includes(l.i)) add(l.e, m.get(l.i)); }
        else if (kind === 'commitment') { const { data } = await sb.from('commitments').select('id, counterparty').in('id', chunk); const m = new Map((data ?? []).map((r: any) => [r.id, r.counterparty])); for (const l of ls) if (chunk.includes(l.i)) add(l.e, m.get(l.i)); }
        else if (kind === 'meeting') { const { data } = await sb.from('meeting_transcripts').select('id, attendees').in('id', chunk); const m = new Map((data ?? []).map((r: any) => [r.id, r.attendees])); for (const l of ls) if (chunk.includes(l.i)) { const att = m.get(l.i); if (Array.isArray(att)) for (const a of att.slice(0, 8)) add(l.e, typeof a === 'string' ? a : (a?.name || a?.email)); } }
      }
    }
    let wrote = 0, err = false;
    for (const [eid, set] of people) {
      const arr = [...set].slice(0, 24);
      if (APPLY) { const { error } = await sb.from('work_entities').update({ people: arr }).eq('id', eid); if (error) { err = true; break; } }
      wrote++;
    }
    if (err) { console.log(`${uid.slice(0, 8)} — ✗ apply 20260720_work_entities_people.sql first`); continue; }
    console.log(`${uid.slice(0, 8)} — ${wrote} entities fingerprinted${APPLY ? '' : ' (dry)'}`);
  }
  if (!APPLY) console.log('\nDry-run. Apply the migration, then re-run with --apply.');
})();
