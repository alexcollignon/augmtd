// ONE BRAIN — recognition re-architecture backfill. Corrects the same-topic cross-deal over-merge by
// RE-RUNNING THE REAL PIPELINE on derived items: delete each derived commitment's (possibly topic-guessed)
// link, then recognizeItem() — which now (a) inherits the parent's entity structurally, recognizing the
// parent inline if needed. No bespoke provenance logic here; the fix lives in recognize.ts, this just
// re-applies it. Idempotent. Usage: npx tsx scripts/fix-provenance-links.ts [--apply] [--user=<id>]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { recognizeItem } from '../lib/entities/recognize';
import { itemFromCommitment } from '../lib/entities/sources';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const only = process.argv.find((a) => a.startsWith('--user='))?.slice(7);

(async () => {
  const { data: conns } = await sb.from('connections').select('user_id');
  let users = [...new Set((conns ?? []).map((c: { user_id: string }) => c.user_id))];
  if (only) users = users.filter((u) => u === only);
  const nameCache = new Map<string, string>();
  const nameOf = async (eid: string | null) => { if (!eid) return '(none)'; if (!nameCache.has(eid)) { const { data } = await sb.from('work_entities').select('name').eq('id', eid).maybeSingle(); nameCache.set(eid, (data as any)?.name ?? eid.slice(0, 8)); } return nameCache.get(eid)!; };
  let totalMoved = 0, totalAI = 0;
  for (const uid of users) {
    const { data: commits } = await sb.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at').eq('user_id', uid).not('source_id', 'is', null);
    const rows = ((commits ?? []) as any[]).filter((c) => ['meeting', 'email', 'inbox'].includes(c.source));
    const before = new Map((((await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).eq('item_kind', 'commitment')).data) ?? []).map((l: any) => [l.item_id, l.entity_id]));
    const t0 = Date.now();
    let moved = 0, shown = 0;
    for (const c of rows) {
      const prevEid = before.get(c.id) ?? null;
      if (APPLY) {
        await sb.from('entity_links').delete().eq('user_id', uid).eq('item_kind', 'commitment').eq('item_id', c.id);
        const r = await recognizeItem(sb, uid, itemFromCommitment(c));
        if ((r.entityId ?? null) !== prevEid) { moved++; if (shown++ < 5) console.log(`  [${uid.slice(0, 8)}] "${c.description.slice(0, 38)}" ${await nameOf(prevEid)} → ${await nameOf(r.entityId)} (${r.via})`); }
      }
    }
    totalMoved += moved;
    console.log(`user ${uid.slice(0, 8)} — derived:${rows.length} · moved:${moved} · ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  console.log(`\nTOTAL moved:${totalMoved}`);
  if (!APPLY) console.log('Dry-run (no deletes/re-recognition). Re-run with --apply.');
})();
