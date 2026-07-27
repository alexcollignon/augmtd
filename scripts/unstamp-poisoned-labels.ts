// ONE-TIME UNSTAMP (the Canva-invoice bug's residue). The old pair-applier returned success on an
// EMPTY label set, so fresh transactional mail (no understanding, no bulk headers) was stamped
// `labeled: true` with zero labels — and the sweep (whose work-list is unstamped items) skipped it
// forever. This resets the stamp on exactly that class: PENDING items stamped labeled whose label
// pair still resolves to NOTHING — the fixed sweep then completes their kind and labels them.
// Dry-run by default; `--apply` writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { labelNamesFor } from '../lib/inbox/rules/write-back';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: profs } = await sb.from('profiles').select('id');
  let total = 0;
  for (const p of (profs ?? []) as Array<{ id: string }>) {
    const { data: items } = await sb.from('inbox_items')
      .select('id, work_title, work_state, rule_type, source_data')
      .eq('user_id', p.id).eq('status', 'pending').eq('source', 'email')
      .filter('source_data->>labeled', 'eq', 'true').limit(500);
    let n = 0;
    for (const it of (items ?? []) as Array<Record<string, unknown>>) {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const ruleType = it.rule_type && it.rule_type !== 'none' ? (it.rule_type as string) : null;
      const bulk = ((sd.gmail_labels ?? []) as string[]).includes('CATEGORY_PROMOTIONS') || sd.has_unsubscribe === true;
      const { kindName, postureName } = labelNamesFor(sd, ruleType, it.work_state as string | null, { bulk, noise: it.work_state === 'noise' });
      if (kindName || postureName) continue; // something resolvable — the stamp is legitimate
      n++;
      if (APPLY) {
        const { labeled: _l, ...rest } = sd;
        await sb.from('inbox_items').update({ source_data: rest }).eq('id', it.id as string);
      }
    }
    if (n) { console.log(`${p.id.slice(0, 8)} · ${APPLY ? 'unstamped' : 'would unstamp'} ${n}`); total += n; }
  }
  console.log(`${APPLY ? 'done' : 'dry-run'} — ${total} poisoned stamp(s)`);
})();
