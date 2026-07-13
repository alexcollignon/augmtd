// ADDITIVE backfill of the new understanding signals (deadline / ownership / effort / confidence) onto
// existing pending email items. Re-runs computeUnderstanding but MERGES ONLY the new fields — role /
// relevance / bulk / initiative / language are preserved byte-for-byte, so the Home (which reads those)
// is unaffected. New emails get these live via computeUnderstanding.
//
//   npx tsx scripts/backfill-signals.ts            # dry-run
//   npx tsx scripts/backfill-signals.ts --apply

import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeUnderstanding } from '../lib/ai/email-processor';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const APPLY = process.argv.includes('--apply');
const BATCH = 8;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function addrs(): Promise<string[]> {
  const set = new Set<string>();
  const { data: prof } = await sb.from('profiles').select('email').eq('id', USER).maybeSingle();
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  const { data: conns } = await sb.from('connections').select('metadata, provider_account_id').eq('user_id', USER);
  for (const c of (conns ?? []) as any[]) { const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase(); if (e) set.add(e); }
  return [...set];
}

async function main() {
  console.log(`[backfill-signals] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} (additive: deadline/ownership/effort/confidence only)`);
  const userAddrs = await addrs();
  const { data: all } = await sb.from('inbox_items')
    .select('id, source_data').eq('user_id', USER).eq('source', 'email').eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(100000);
  const items = (all ?? []).filter((it: any) => coerceUnderstanding(it.source_data?.understanding) && (it.source_data?.from || it.source_data?.from_address));
  console.log(`[backfill-signals] ${items.length} items`);

  let written = 0, withDeadline = 0, withEffort = 0, failed = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    await Promise.all(items.slice(i, i + BATCH).map(async (it: any) => {
      const sd = it.source_data ?? {};
      const existing = coerceUnderstanding(sd.understanding)!;
      try {
        const f = await computeUnderstanding({
          id: sd.email_id || it.id, user_id: USER, message_id: sd.message_id || '',
          from_address: sd.from || sd.from_address || '', from_name: sd.from_name || '',
          subject: sd.subject || '', body: sd.body || '', received_at: sd.received_at || new Date().toISOString(),
          recipient_position: sd.is_cc_only ? 'cc' : 'to', recipient_email: userAddrs[0],
          to_addresses: sd.to || [], cc_addresses: sd.cc || [], user_addresses: userAddrs,
        } as any, sb);
        if (!f) { failed++; return; }
        if (f.deadline) withDeadline++;
        if (f.effort) withEffort++;
        // ADDITIVE MERGE — keep existing role/relevance/bulk/initiative/language; add only the new signals.
        const merged = { ...existing, deadline: f.deadline ?? null, ownership: f.ownership, effort: f.effort, confidence: f.confidence };
        if (APPLY) {
          const { error } = await sb.from('inbox_items').update({ source_data: { ...sd, understanding: merged } }).eq('id', it.id).eq('user_id', USER);
          if (error) { failed++; console.error('  x', it.id, error.message); } else written++;
        }
      } catch (e) { failed++; console.warn('  x', (e as Error).message); }
    }));
    if ((i / BATCH) % 12 === 0) console.log(`  … ${Math.min(i + BATCH, items.length)}/${items.length}`);
  }
  console.log(`\n[backfill-signals] written=${written} withDeadline=${withDeadline} withEffort=${withEffort} failed=${failed} ${APPLY ? '' : '(dry-run)'}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
