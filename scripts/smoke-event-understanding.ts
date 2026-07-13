// READ-ONLY Phase-1 smoke: run computeEventUnderstanding over a user's REAL calendar events against the
// initiative map built from their emails/commitments. Proves: Layer-0 filter (canceled/blank/solo excluded),
// the "prefer joining resolution" rule (noisy titles resolve via person-bridge to the email key), ambiguous
// deferral, and agnosticism (two tenants). No writes.
//
//   npx tsx scripts/smoke-event-understanding.ts

import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildInitiativeMap } from '../lib/projects/initiative-resolver';
import { computeEventUnderstanding } from '../lib/calendar/event-understanding';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { id: '08fe4449-e5eb-431d-9156-02e9324e5903', who: 'Alexandre' },
  { id: 'ae306f38-f312-4bf3-aef4-562331a07fab', who: 'Rene' },
];

async function addrs(userId: string): Promise<string[]> {
  const set = new Set<string>();
  const { data: prof } = await sb.from('profiles').select('email').eq('id', userId).maybeSingle();
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  const { data: conns } = await sb.from('connections').select('metadata, provider_account_id').eq('user_id', userId);
  for (const c of (conns ?? []) as any[]) { const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase(); if (e) set.add(e); }
  return [...set];
}

async function run(userId: string, who: string) {
  const [map, userAddrs] = await Promise.all([buildInitiativeMap(sb, userId), addrs(userId)]);
  const { data: events } = await sb.from('calendar_events')
    .select('title, attendees, status, is_all_day, recurring_event_id, start_time')
    .eq('user_id', userId).order('start_time', { ascending: false }).limit(400);
  const evs = (events ?? []) as any[];

  const via: Record<string, number> = { 'topic-join': 0, person: 0, 'topic-new': 0, ambiguous: 0, loose: 0 };
  const excl: Record<string, number> = { canceled: 0, blank: 0, solo: 0 };
  const ex: Record<string, string[]> = { 'topic-join': [], person: [], 'topic-new': [], ambiguous: [], loose: [] };

  for (const e of evs) {
    const u = computeEventUnderstanding(e, userAddrs, map);
    if (!u.isWork) { excl[u.excludeReason || 'solo']++; continue; }
    via[u.via]++;
    const t = String(e.title || '').slice(0, 40);
    const line = u.via === 'ambiguous' ? `${t} → {${u.candidates.slice(0, 4).join(', ')}}`
      : u.initiativeKey ? `${t} → [${u.initiativeKey}]` : t;
    if (ex[u.via].length < 6) ex[u.via].push(line);
  }

  console.log(`\n═══ ${who} ═══  topics=${map.byKey.size}`);
  console.log(`  WORK events by resolution: topic-join=${via['topic-join']} person=${via.person} topic-new=${via['topic-new']} ambiguous=${via.ambiguous} loose=${via.loose}`);
  console.log(`  excluded (Layer-0 filter): canceled=${excl.canceled} blank=${excl.blank} solo/personal=${excl.solo}`);
  const joined = via['topic-join'] + via.person;
  const total = joined + via['topic-new'] + via.ambiguous + via.loose;
  console.log(`  → ${joined}/${total} work events JOINED a known initiative (${total ? Math.round((joined / total) * 100) : 0}%)`);
  for (const k of ['topic-join', 'person', 'topic-new', 'ambiguous', 'loose'] as const) {
    if (ex[k].length) { console.log(`   ${k}:`); for (const l of ex[k]) console.log('     -', l); }
  }
}

(async () => {
  for (const u of USERS) await run(u.id, u.who);
  console.log('\n(read-only — no writes)');
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
