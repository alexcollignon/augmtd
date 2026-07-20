// PHASE B — chronological entity BACKFILL (the backfill IS the system: each user's corpus replayed
// oldest→newest through the SAME recognizeItem pipeline — the memory "remembers its history"). Writes to
// the shadow store (work_entities/entity_links); nothing user-facing reads it yet. Reports per-path
// TIMINGS (the "natural and fast" proof: linked/refused = one lookup; structural = zero AI; only genuinely
// new matter pays a judgment) + real cost from the ai_usage_events ledger.
// Usage: npx tsx scripts/backfill-entities.ts [--cap=120]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { recognizeItem } from '../lib/entities/recognize';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const CAP = Number(process.argv.find((a) => a.startsWith('--cap='))?.slice(6) || 120);

(async () => {
  const startedAt = new Date().toISOString();
  // ALL users with email connections (idempotent — already-membered items skip at ~85ms).
  const { data: conns } = await sb.from('connections').select('user_id');
  const USERS = [...new Set((conns ?? []).map((c: { user_id: string }) => c.user_id))];
  for (const uid of USERS) {
    // ALL FOUR SOURCES, merged into ONE chronological stream (oldest→newest — the memory's spine):
    // work-ish emails + meetings + commitments (thread_id → mostly STRUCTURAL, zero AI) + calendar events.
    const [{ data: items }, { data: mtgs }, { data: commits }, { data: cal }] = await Promise.all([
      sb.from('inbox_items').select('id, work_title, source_data, created_at')
        .eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(1200),
      sb.from('meeting_transcripts').select('id, title, summary, attendees, start_time, created_at')
        .eq('user_id', uid).order('start_time', { ascending: false }).limit(40),
      sb.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(80),
      sb.from('calendar_events').select('id, title, attendees, status, is_all_day, start_time, created_at')
        .eq('user_id', uid).eq('status', 'confirmed').order('start_time', { ascending: false }).limit(60),
    ]);
    const { itemFromInbox, itemFromMeeting, itemFromCommitment, itemFromCalendar } = await import('../lib/entities/sources');
    const emailItems = ((items ?? []) as any[]).filter((it) => {
      const sd = it.source_data ?? {}; const rel = sd.understanding?.relevance;
      return rel === 'reply' || rel === 'action' || !!sd.understanding?.initiative;
    }).slice(0, CAP).map(itemFromInbox);
    const otherItems = [
      ...((mtgs ?? []) as any[]).filter((m) => m.summary).map(itemFromMeeting),
      ...((commits ?? []) as any[]).map(itemFromCommitment),
      ...((cal ?? []) as any[]).filter((e) => !e.is_all_day && e.title).map(itemFromCalendar),
    ];
    const replay = [...emailItems, ...otherItems]
      .filter((x) => x.title)
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

    const t: Record<string, { n: number; ms: number }> = { skip: { n: 0, ms: 0 }, structural: { n: 0, ms: 0 }, judged: { n: 0, ms: 0 }, refused: { n: 0, ms: 0 } };
    const byKind: Record<string, Record<string, number>> = {};
    let founded = 0;
    for (const item of replay) {
      const t0 = Date.now();
      const r = await recognizeItem(sb, uid, item);
      const ms = Date.now() - t0;
      // Classify the path by cost signature: an already-seen item returns in one lookup (~<150ms).
      const path = ms < 200 ? 'skip' : r.via === 'structural' ? 'structural' : r.via === 'none' ? 'refused' : 'judged';
      t[path].n++; t[path].ms += ms;
      (byKind[item.kind] ??= {})[path] = ((byKind[item.kind] ??= {})[path] ?? 0) + 1;
      if (r.founded) founded++;
    }

    const [{ count: entCount }, { data: links }, { data: usage }] = await Promise.all([
      sb.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', uid) as any,
      sb.from('entity_links').select('via').eq('user_id', uid) as any,
      sb.from('ai_usage_events').select('cost_eur, source').eq('user_id', uid).gte('created_at', startedAt).in('source', ['brain_synthesis', 'kb_indexing']) as any,
    ]);
    const viaCounts = (links ?? []).reduce((m: Record<string, number>, l: any) => { m[l.via] = (m[l.via] ?? 0) + 1; return m; }, {});
    const cost = (usage ?? []).reduce((s: number, u: any) => s + Number(u.cost_eur || 0), 0);
    const avg = (k: string) => (t[k].n ? Math.round(t[k].ms / t[k].n) : 0);
    console.log(`\n════ user ${uid.slice(0, 8)} — replayed ${replay.length} (cap ${CAP}) ════`);
    console.log(`  paths: skip:${t.skip.n} (${avg('skip')}ms) · structural:${t.structural.n} (${avg('structural')}ms) · judged:${t.judged.n} (${avg('judged')}ms) · refused:${t.refused.n} (${avg('refused')}ms) · founded:${founded}`);
    for (const [k, m] of Object.entries(byKind)) console.log(`    ${k}: ${JSON.stringify(m)}`);
    console.log(`  store: ${entCount} entities · links: ${JSON.stringify(viaCounts)} · backfill AI cost: €${cost.toFixed(4)}`);
  }
})();
