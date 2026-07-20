// READ-ONLY cross-user smoke for THE VERDICT (lib/brains/verdict.ts) — the one judgment authority. Proves
// the deck's "Important" lens now orders by the brain verdict (relationship + momentum + owed-loops), the
// SAME function every surface will read. Runs personVerdict over real must-respond senders → the order. Also
// checks weight range + that a partner-you-owe outranks a vendor. No writes, no AI.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { personVerdict, type PersonRow } from '../lib/brains/verdict';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const emailOf = (s?: string | null) => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

(async () => {
  const { data: psUsers } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((psUsers ?? []).map((r: any) => r.user_id))];

  let totWeighted = 0, minW = 100, maxW = 0, slippingCount = 0;

  for (const uid of userIds) {
    const { data: items } = await sb.from('inbox_items').select('source_data, rule_type').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(150);
    const mr = ((items ?? []) as any[]).filter((it) => it.rule_type === 'needs_reply' || it.source_data?.understanding?.relevance === 'reply');
    const keyToWho = new Map<string, string>();
    for (const it of mr) { const k = emailOf(it.source_data?.from_address || it.source_data?.from); if (k && !keyToWho.has(k)) keyToWho.set(k, it.source_data?.from_name || k); }
    const keys = [...keyToWho.keys()];
    if (!keys.length) continue;
    const { data: ps } = await sb.from('person_state').select('person_key, state, next_touch, quiet_days').eq('user_id', uid).in('person_key', keys);
    const ranked = ((ps ?? []) as any[])
      .map((r) => ({ who: keyToWho.get(r.person_key) || r.person_key, rel: r.state?.relationship, mo: r.state?.momentum, v: personVerdict(r as PersonRow) }))
      .filter((x) => x.v.weight > 0)
      .sort((a, b) => b.v.weight - a.v.weight);
    if (!ranked.length) continue;

    console.log(`\nuser ${uid.slice(0, 8)} — "Important" order (by verdict weight):`);
    for (const x of ranked.slice(0, 6)) {
      totWeighted++; minW = Math.min(minW, x.v.weight); maxW = Math.max(maxW, x.v.weight); if (x.v.slipping) slippingCount++;
      console.log(`  ${String(x.v.weight).padStart(3)}  ${(x.who).slice(0, 22).padEnd(22)} ${(x.rel || '—').padEnd(9)} ${x.mo}${x.v.slipping ? '  ⚠ slipping' : ''}`);
    }
  }

  console.log('\n════ TOTALS ════');
  console.log(`weighted must-respond people: ${totWeighted}  ·  weight range: ${minW}–${maxW}  ·  slipping: ${slippingCount}`);
  console.log('Sanity: partner/you_owe should sit near the top; vendor/waiting near the bottom.');
})();
