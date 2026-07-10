// ADDITIVE backfill of `understanding.initiative` on existing pending email items. Computes the initiative
// and MERGES it into the stored understanding, preserving role/relevance/bulk/language EXACTLY — so the
// Home (which reads those) is byte-for-byte unaffected. New emails get initiative live via computeUnderstanding.
//
//   npx tsx scripts/backfill-initiative.ts                # dry-run
//   npx tsx scripts/backfill-initiative.ts --apply
//   npx tsx scripts/backfill-initiative.ts --apply --limit=100

import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeUnderstanding } from '../lib/ai/email-processor';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
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
  console.log(`[backfill-initiative] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} (additive: merges initiative only)`);
  const userAddrs = await addrs();
  const { data: all } = await sb.from('inbox_items')
    .select('id, work_title, source_data').eq('user_id', USER).eq('source', 'email').eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(100000);
  let items = (all ?? []).filter((it: any) => coerceUnderstanding(it.source_data?.understanding) && (it.source_data?.from || it.source_data?.from_address));
  if (LIMIT !== Infinity) items = items.slice(0, LIMIT);
  console.log(`[backfill-initiative] ${items.length} items with a stored understanding`);

  let written = 0, withInit = 0, failed = 0, roleChanged = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(async (it: any) => {
      const sd = it.source_data ?? {};
      const existing = coerceUnderstanding(sd.understanding)!;
      try {
        const fresh = await computeUnderstanding({
          id: sd.email_id || it.id, user_id: USER, message_id: sd.message_id || '',
          from_address: sd.from || sd.from_address || '', from_name: sd.from_name || '',
          subject: sd.subject || '', body: sd.body || '', received_at: sd.received_at || new Date().toISOString(),
          recipient_position: sd.is_cc_only ? 'cc' : 'to', recipient_email: userAddrs[0],
          to_addresses: sd.to || [], cc_addresses: sd.cc || [], user_addresses: userAddrs,
        } as any, sb);
        const initiative = fresh?.initiative ?? null;
        if (initiative) withInit++;
        // ADDITIVE MERGE — keep existing role/relevance/bulk/language; only set initiative.
        const merged = { ...existing, initiative };
        if (APPLY) {
          const { error } = await sb.from('inbox_items').update({ source_data: { ...sd, understanding: merged } }).eq('id', it.id).eq('user_id', USER);
          if (error) { failed++; console.error('  x', it.id, error.message); } else written++;
        }
      } catch (e) { failed++; console.warn('  x', (e as Error).message); }
    }));
    if ((i / BATCH) % 10 === 0) console.log(`  … ${Math.min(i + BATCH, items.length)}/${items.length}`);
  }
  console.log(`\n[backfill-initiative] written=${written} withInitiative=${withInit} failed=${failed} ${APPLY ? '' : '(dry-run)'}`);
  console.log(`  (role/relevance/bulk/language preserved — only initiative merged)`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
