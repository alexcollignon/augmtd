// ONE BRAIN — re-recognize meetings under the SHARPENED judge (a 1:1/recurring sync is a CHANNEL, not a
// project — attach to the deal it advances, or 'none', never a person-named "X x Y" project). Deletes each
// meeting's link + re-runs the REAL pipeline (people-first recall now surfaces the deal the attendees tie
// to). Then re-run scripts/fix-provenance-links.ts so commitments follow their re-recognized meeting.
// Usage: npx tsx scripts/re-recognize-meetings.ts [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { recognizeItem } from '../lib/entities/recognize';
import { itemFromMeeting } from '../lib/entities/sources';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: conns } = await sb.from('connections').select('user_id');
  const users = [...new Set((conns ?? []).map((c: { user_id: string }) => c.user_id))];
  const nameCache = new Map<string, string>();
  const nameOf = async (eid: string | null) => { if (!eid) return '(none)'; if (!nameCache.has(eid)) { const { data } = await sb.from('work_entities').select('name').eq('id', eid).maybeSingle(); nameCache.set(eid, (data as any)?.name ?? eid.slice(0, 8)); } return nameCache.get(eid)!; };
  for (const uid of users) {
    const { data: mtgs } = await sb.from('meeting_transcripts').select('id, title, summary, attendees, start_time, created_at').eq('user_id', uid);
    const before = new Map((((await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).eq('item_kind', 'meeting')).data) ?? []).map((l: any) => [l.item_id, l.entity_id]));
    let moved = 0, toNone = 0, shown = 0;
    for (const m of (mtgs ?? []) as any[]) {
      if (!m.summary) continue;
      const prev = before.get(m.id) ?? null;
      if (APPLY) {
        await sb.from('entity_links').delete().eq('user_id', uid).eq('item_kind', 'meeting').eq('item_id', m.id);
        const r = await recognizeItem(sb, uid, itemFromMeeting(m));
        if ((r.entityId ?? null) !== prev) { moved++; if (r.entityId === null) toNone++; if (shown++ < 6) console.log(`  [${uid.slice(0, 8)}] "${(m.title||'').slice(0, 26)}" ${await nameOf(prev)} → ${await nameOf(r.entityId)} (${r.via})`); }
      }
    }
    console.log(`user ${uid.slice(0, 8)} — meetings:${(mtgs ?? []).length} · moved:${moved} · →none:${toNone}`);
  }
  if (!APPLY) console.log('Dry-run.');
})();
