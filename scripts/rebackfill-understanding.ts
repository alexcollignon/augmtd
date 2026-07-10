// RE-backfill `source_data.understanding` on ALL pending email items with the recalibrated prompt.
// Unlike scripts/backfill-understanding.ts (idempotent — skips items that already have one), this
// OVERWRITES, because the `action` bar changed and stored verdicts are stale. Calls computeUnderstanding
// (Haiku, classification tier) DIRECTLY — no flaky/expensive Kimi planning pass. Preserves the rest of
// source_data. Parallel batches. Dry-run by default; --apply to write.
//
//   npx tsx scripts/rebackfill-understanding.ts                 # dry-run (sample only)
//   npx tsx scripts/rebackfill-understanding.ts --apply         # write all
//   npx tsx scripts/rebackfill-understanding.ts --apply --limit=100

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeUnderstanding } from '../lib/ai/email-processor';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const BATCH = 8;
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function addrs(): Promise<string[]> {
  const set = new Set<string>();
  const { data: prof } = await supabase.from('profiles').select('email').eq('id', USER).maybeSingle();
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  const { data: conns } = await supabase.from('connections').select('metadata, provider_account_id').eq('user_id', USER);
  for (const c of (conns ?? []) as any[]) { const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase(); if (e) set.add(e); }
  return [...set];
}

async function main() {
  console.log(`[rebackfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} limit=${LIMIT}`);
  const userAddrs = await addrs();
  const { data: all } = await supabase.from('inbox_items')
    .select('id, work_title, source_data')
    .eq('user_id', USER).eq('source', 'email').eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(100000);
  let items = (all ?? []) as any[];
  items = items.filter((it) => it.source_data?.from || it.source_data?.from_address);
  if (LIMIT !== Infinity) items = items.slice(0, LIMIT);
  console.log(`[rebackfill] ${items.length} items to recompute`);

  const before: Record<string, number> = {}, after: Record<string, number> = {};
  let written = 0, failed = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(async (it) => {
      const sd = it.source_data ?? {};
      const prev = sd.understanding?.relevance || 'none';
      before[prev] = (before[prev] || 0) + 1;
      try {
        const u = await computeUnderstanding({
          id: sd.email_id || it.id, user_id: USER, message_id: sd.message_id || '',
          from_address: sd.from || sd.from_address || '', from_name: sd.from_name || '',
          subject: sd.subject || '', body: sd.body || '', received_at: sd.received_at || new Date().toISOString(),
          recipient_position: sd.is_cc_only ? 'cc' : 'to', recipient_email: userAddrs[0],
          to_addresses: sd.to || [], cc_addresses: sd.cc || [], user_addresses: userAddrs, user_name: undefined,
        } as any, supabase);
        if (!u) { failed++; after['none'] = (after['none'] || 0) + 1; return; }
        after[u.relevance] = (after[u.relevance] || 0) + 1;
        if (APPLY) {
          const { error } = await supabase.from('inbox_items')
            .update({ source_data: { ...sd, understanding: u } })
            .eq('id', it.id).eq('user_id', USER);
          if (error) { failed++; console.error('  x', it.id, error.message); } else written++;
        }
      } catch (e) { failed++; console.warn('  x', (e as Error).message); }
    }));
    if ((i / BATCH) % 10 === 0) console.log(`  … ${Math.min(i + BATCH, items.length)}/${items.length}`);
  }
  console.log(`\n[rebackfill] before:`, before);
  console.log(`[rebackfill] after :`, after);
  console.log(`[rebackfill] written=${written} failed=${failed} ${APPLY ? '' : '(dry-run)'}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
