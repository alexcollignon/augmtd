// READ-ONLY cross-user smoke for the Step 2 extension — renderWorldContext (coworker chat: "your world")
// + the brief's person-state map (does a must-respond sender resolve to a Person-Brain verdict?). No writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { renderWorldContext } from '../lib/context/brain-context';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const emailOf = (s?: string | null): string | null => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

(async () => {
  const { data: psUsers } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((psUsers ?? []).map((r: any) => r.user_id))];

  let totMustRespond = 0, totMatched = 0, worldShown = 0;

  for (const uid of userIds) {
    // 1) Coworker-chat "your world" block.
    const world = await renderWorldContext(sb, uid);
    if (world) {
      worldShown++;
      if (worldShown <= 2) console.log(`\n─── user ${uid.slice(0, 8)} · renderWorldContext ───\n` + world.split('\n').slice(0, 10).map((l) => '  ' + l).join('\n'));
    }

    // 2) Brief person-state map: recent needs-reply items → do their senders resolve to a Person-Brain verdict?
    const { data: items } = await sb.from('inbox_items').select('source_data, rule_type').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(120);
    const mr = ((items ?? []) as any[]).filter((it) => it.rule_type === 'needs_reply' || it.source_data?.understanding?.relevance === 'reply');
    const keys = [...new Set(mr.map((it) => emailOf(it.source_data?.from_address || it.source_data?.from)).filter(Boolean) as string[])];
    if (keys.length) {
      const { data: ps } = await sb.from('person_state').select('person_key, state').eq('user_id', uid).in('person_key', keys);
      const withState = new Set(((ps ?? []) as any[]).filter((r) => r.state?.summary).map((r) => r.person_key));
      const matched = keys.filter((k) => withState.has(k)).length;
      totMustRespond += keys.length; totMatched += matched;
      console.log(`user ${uid.slice(0, 8)} — must-respond senders:${keys.length} with a Person-Brain verdict:${matched} (${keys.length ? Math.round(100*matched/keys.length) : 0}%)  · world-block:${world ? 'yes' : 'no'}`);
    } else {
      console.log(`user ${uid.slice(0, 8)} — no must-respond senders in the window  · world-block:${world ? 'yes' : 'no'}`);
    }
  }

  console.log('\n════ TOTALS ════');
  console.log(`renderWorldContext produced a block for ${worldShown}/${userIds.length} users`);
  console.log(`brief must-respond senders: ${totMustRespond}  ·  resolved to a Person-Brain verdict (angle grounded): ${totMatched} (${totMustRespond ? Math.round(100*totMatched/totMustRespond) : 0}%)`);
})();
