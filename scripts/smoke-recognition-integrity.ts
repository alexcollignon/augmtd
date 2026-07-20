// ONE BRAIN — RECOGNITION INTEGRITY (trust gate). Two invariants, cross-user, cross-project, must be ZERO:
//   1. PROVENANCE CONSISTENCY — every derived commitment sits in the SAME entity as its source meeting/email.
//      (A violation = the same-topic cross-deal over-merge that put iScore's GPU commitment into Galp.)
//   2. NO ORPHAN SCATTER — a meeting's commitments never split across multiple entities.
// Prints the Galp entity for eyeball. Read-only.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: conns } = await sb.from('connections').select('user_id');
  const users = [...new Set((conns ?? []).map((c: { user_id: string }) => c.user_id))];
  let totalViol = 0, totalChecked = 0, totalScatter = 0;
  for (const uid of users) {
    const { data: commits } = await sb.from('commitments').select('id, description, source, source_id').eq('user_id', uid).not('source_id', 'is', null);
    const rows = ((commits ?? []) as any[]).filter((c) => ['meeting', 'email', 'inbox'].includes(c.source));
    const kindOf = (s: string) => (s === 'meeting' ? 'meeting' : 'inbox_item');
    const cIds = rows.map((c) => c.id);
    const pIds = [...new Set(rows.map((c) => c.source_id))];
    const { data: cl } = cIds.length ? await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).eq('item_kind', 'commitment').in('item_id', cIds) : { data: [] };
    const commitE = new Map((cl ?? []).map((l: any) => [l.item_id, l.entity_id]));
    const { data: ml } = pIds.length ? await sb.from('entity_links').select('item_kind, item_id, entity_id').eq('user_id', uid).in('item_id', pIds) : { data: [] };
    const parentE = new Map((ml ?? []).filter((l: any) => l.entity_id).map((l: any) => [l.item_kind + ':' + l.item_id, l.entity_id]));

    let viol = 0, checked = 0;
    const meetingChildren = new Map<string, Set<string>>();
    for (const c of rows) {
      const pk = kindOf(c.source) + ':' + c.source_id;
      const pe = parentE.get(pk);
      const ce = commitE.get(c.id) ?? null;
      if (c.source === 'meeting' && ce) { (meetingChildren.get(c.source_id) ?? meetingChildren.set(c.source_id, new Set()).get(c.source_id)!).add(ce); }
      if (!pe) continue; // parent unrecognized/none — not a provenance violation (no truth to compare)
      checked++;
      if (ce !== pe) { viol++; if (viol <= 4) console.log(`  ✗ [${uid.slice(0, 8)}] "${c.description.slice(0, 40)}" in ${(ce||'none').slice(0,8)} but parent in ${pe.slice(0,8)}`); }
    }
    const scatter = [...meetingChildren.values()].filter((s) => s.size > 1).length;
    totalViol += viol; totalChecked += checked; totalScatter += scatter;
    console.log(`user ${uid.slice(0, 8)} — checked:${checked} · provenance violations:${viol} · meetings scattered across entities:${scatter}`);
  }
  console.log(`\n${totalViol === 0 && totalScatter === 0 ? '✓ CLEAN' : '✗ VIOLATIONS'} — provenance violations:${totalViol}/${totalChecked} · scattered meetings:${totalScatter}`);
})();
