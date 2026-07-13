// Phase-3 coverage propagation. For LABEL-LESS pending inbox items + commitments, inherit an initiative
// deterministically from a shared PERSON — but ONLY when that person resolves UNAMBIGUOUSLY to a single
// known initiative (the resolver's 'bridged' verdict). Additive: writes understanding.initiative +
// initiative_via='bridge', preserving every other understanding field. Ambiguous/loose senders are left
// untouched (never guessed). DRY-RUN by default — eyeball the bridges before applying.
//
//   npx tsx scripts/backfill-bridge-initiative.ts              # dry-run (default)
//   npx tsx scripts/backfill-bridge-initiative.ts --apply
//   npx tsx scripts/backfill-bridge-initiative.ts --apply --user <uuid>

import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildInitiativeMap, resolveInitiative } from '../lib/projects/initiative-resolver';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';
import { isAutomatedSender } from '../lib/inbox/automated';

const emailOf = (raw: string): string | null => String(raw || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const userIdx = process.argv.indexOf('--user');
const userArg = userIdx >= 0 ? process.argv[userIdx + 1] : undefined;
const DEFAULT_USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'ae306f38-f312-4bf3-aef4-562331a07fab'];

async function run(userId: string) {
  const map = await buildInitiativeMap(sb, userId);

  // ── Inbox items ──
  const { data: inbox } = await sb.from('inbox_items').select('id, work_title, source_data')
    .eq('user_id', userId).eq('source', 'email').eq('status', 'pending').limit(4000);
  const items = (inbox ?? []) as Array<{ id: string; work_title: string | null; source_data: Record<string, unknown> }>;

  let candidates = 0, bridged = 0, ambiguous = 0, loose = 0, written = 0, excludedAuto = 0;
  const examples: string[] = [];
  for (const it of items) {
    const sd = it.source_data ?? {};
    const u = coerceUnderstanding(sd.understanding);
    if (!u) continue;                      // no valid understanding → skip (nothing to enrich)
    if (u.initiative) continue;            // already has a DIRECT label → topic authoritative, untouched
    const from = (sd.from_address as string) || (sd.from as string) || '';
    const fromName = (sd.from_name as string) || '';
    // Never bridge a marketing/automated item — it's not project material (mirrors cluster.ts).
    if (u.bulk === true || isAutomatedSender(emailOf(from), fromName || null, String(it.work_title || sd.subject || ''))) { excludedAuto++; continue; }
    candidates++;
    const people: string[] = [];
    if (from) people.push(from);
    if (fromName) people.push(fromName);
    const r = resolveInitiative({ label: null, people }, map);
    if (r.status === 'bridged') {
      bridged++;
      if (examples.length < 12) examples.push(`  ${String(it.work_title || sd.subject || '').slice(0, 40)}  ←(${(from || fromName).slice(0, 24)})→  [${r.key}]`);
      if (APPLY) {
        const merged = { ...u, initiative: r.label, initiative_via: 'bridge' as const };
        const { error } = await sb.from('inbox_items').update({ source_data: { ...sd, understanding: merged } }).eq('id', it.id).eq('user_id', userId);
        if (!error) written++;
      }
    } else if (r.status === 'ambiguous') ambiguous++;
    else loose++;
  }

  // ── Commitments ──
  const { data: commits } = await sb.from('commitments').select('id, description, counterparty, initiative')
    .eq('user_id', userId).in('status', ['open', 'pending']).is('initiative', null).limit(1000);
  let cBridged = 0, cWritten = 0;
  for (const c of (commits ?? []) as Array<{ id: string; description: string | null; counterparty: string | null }>) {
    if (!c.counterparty) continue;
    const r = resolveInitiative({ label: null, people: [c.counterparty] }, map);
    if (r.status === 'bridged') {
      cBridged++;
      if (APPLY) { const { error } = await sb.from('commitments').update({ initiative: r.label }).eq('id', c.id).eq('user_id', userId); if (!error) cWritten++; }
    }
  }

  console.log(`\n═══ ${userId.slice(0, 8)} ═══  topics=${map.byKey.size}`);
  console.log(`  inbox label-less candidates: ${candidates} (excluded automated/bulk ${excludedAuto}) → bridged ${bridged}, ambiguous ${ambiguous}, loose ${loose}${APPLY ? ` (wrote ${written})` : ''}`);
  console.log(`  commitments label-less → bridged ${cBridged}${APPLY ? ` (wrote ${cWritten})` : ''}`);
  if (examples.length) { console.log('  sample bridges:'); for (const e of examples) console.log(e); }
}

(async () => {
  console.log(`[backfill-bridge] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  for (const u of (userArg ? [userArg] : DEFAULT_USERS)) await run(u);
  console.log(APPLY ? '\ndone.' : '\n(dry-run — no writes)');
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
