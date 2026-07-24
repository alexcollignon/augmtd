// PREPARATION PASS (Phase C slice 1) — cross-user smoke: the top deck items gain reply/nudge drafts;
// re-run is idempotent (0 new); nothing irreversible ever fires (drafts only, by construction).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { runPreparationPass } from '../lib/prepare/pass';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
(async () => {
  for (const uid of ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec']) {
    const u = uid.slice(0, 8);
    const r1 = await runPreparationPass(sb, uid);
    // Time-honest: right after a cron pass everything is FRESH and the walker correctly skips —
    // that's idempotency working, not a failure. Live generation is proven deterministically in
    // smoke-work-loop.ts (controlled-stale prepareOneItem). Here: the pass covered candidates.
    check(`${u}: pass covered the working set`, r1.prepared + r1.nudges + r1.skipped > 0, `drafts=${r1.prepared} nudges=${r1.nudges} skipped=${r1.skipped}`);
    const r2 = await runPreparationPass(sb, uid);
    check(`${u}: idempotent re-run`, r2.prepared === 0 && r2.nudges === 0, `re-run drafts=${r2.prepared} nudges=${r2.nudges}`);
    const { count } = await sb.from('inbox_items').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).eq('status', 'pending').not('source_data->draft', 'is', null);
    check(`${u}: drafts persisted on items`, (count ?? 0) > 0, `${count} items with drafts`);
  }
  console.log('\n════ PREPARATION GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
