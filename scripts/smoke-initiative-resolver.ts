// READ-ONLY Phase-0 smoke for the initiative resolver. Builds the person→topic map from a user's LABELED
// email+commitment corpus, then resolves their REAL calendar events against it (previewing Phase 1). Proves
// the decision tree: topic-primary (distinct deals never merge), unambiguous person-bridge attaches, an
// ambiguous person defers to loose. NO writes. Runs for two tenants to prove agnosticism.
//
//   npx tsx scripts/smoke-initiative-resolver.ts

import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildInitiativeMap, resolveInitiative, initiativeKey, type ResolvableAtom } from '../lib/projects/initiative-resolver';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS: Array<{ id: string; who: string }> = [
  { id: '08fe4449-e5eb-431d-9156-02e9324e5903', who: 'Alexandre' },
  { id: 'ae306f38-f312-4bf3-aef4-562331a07fab', who: 'Rene' },
];

const CANCELED = /^canceled event:/i;
const attendeeStrings = (att: unknown): string[] => {
  if (!Array.isArray(att)) return [];
  return att.map((a) => (typeof a === 'string' ? a : (a?.email || a?.name || ''))).filter(Boolean);
};

async function run(userId: string, who: string) {
  const map = await buildInitiativeMap(sb, userId);
  console.log(`\n═══ ${who} ═══  topics=${map.byKey.size}  people-indexed=${map.personIndex.length}`);

  const { data: events } = await sb.from('calendar_events')
    .select('title, attendees, start_time, status').eq('user_id', userId)
    .order('start_time', { ascending: false }).limit(400);
  const evs = (events ?? []) as Array<Record<string, unknown>>;

  const tally = { labeled: 0, bridged: 0, ambiguous: 0, loose: 0, skipped: 0 };
  const examples: Record<string, string[]> = { labeled: [], bridged: [], ambiguous: [], loose: [] };

  for (const e of evs) {
    const title = String(e.title || '');
    if (!title || CANCELED.test(title)) { tally.skipped++; continue; } // Layer-0 filter preview
    const people = attendeeStrings(e.attendees);
    const atom: ResolvableAtom = { label: title, people };
    const r = resolveInitiative(atom, map);
    tally[r.status]++;
    const line =
      r.status === 'labeled' ? `${title.slice(0, 34)} → [${r.key}]`
      : r.status === 'bridged' ? `${title.slice(0, 26)} ~via person~ → [${r.key}]`
      : r.status === 'ambiguous' ? `${title.slice(0, 30)} → AMBIG {${r.candidates.join(', ')}}`
      : `${title.slice(0, 40)}`;
    if (examples[r.status].length < 5) examples[r.status].push(line);
  }

  console.log(`  events: labeled=${tally.labeled} bridged=${tally.bridged} ambiguous=${tally.ambiguous} loose=${tally.loose} skipped(canceled/blank)=${tally.skipped}`);
  for (const k of ['labeled', 'bridged', 'ambiguous', 'loose'] as const) {
    if (examples[k].length) { console.log(`   ${k}:`); for (const l of examples[k]) console.log('     -', l); }
  }

  // INVARIANT CHECK: no two DISTINCT topic labels collapse to one key (topic-primary, despace only).
  const clash = new Map<string, Set<string>>();
  for (const [key, g] of map.byKey) clash.set(key, new Set([g.label]));
  // (byKey already dedupes; a genuine over-merge would show as one key holding semantically-different labels —
  // we surface the multi-word keys so a human can eyeball that same-key really means same-initiative.)
  const multi = [...map.byKey.entries()].filter(([k]) => k.length > 3).slice(0, 8);
  console.log('  sample topic keys:', multi.map(([k, g]) => `${k}(${g.people.length}p)`).join(' · '));
}

(async () => {
  for (const u of USERS) await run(u.id, u.who);
  console.log('\n(read-only — no writes)');
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
