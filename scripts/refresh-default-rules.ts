// RULES REFRESH — bring every connection's DEFAULT-sourced rules up to the current canonical set.
// User-created/edited rules (source !== 'default') are NEVER touched. Fixes duplicate seedings
// (two seeding races left one account evaluating a doubled rule set) and propagates any future
// default-catalogue change uniformly. Same row shape as the API's own seeding (toRow).
// Dry-run by default; `--apply` writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { defaultRulesForProvider } from '../lib/inbox/rules/defaults';
import type { InboxRule } from '../lib/inbox/rules/types';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

function toRow(r: InboxRule, userId: string, connectionId: string) {
  return {
    user_id: userId, connection_id: connectionId,
    name: r.name, enabled: r.enabled, priority: r.priority, trigger: r.trigger,
    match_mode: r.match_mode, conditions: r.conditions, ai_match: r.ai_match, outcome: r.outcome, source: r.source,
  };
}

(async () => {
  const { data: conns } = await sb.from('connections')
    .select('id, user_id, provider, provider_account_id').eq('status', 'active').in('provider', ['gmail', 'outlook']);
  for (const c of (conns ?? []) as Array<{ id: string; user_id: string; provider: string; provider_account_id: string }>) {
    const { data: existing } = await sb.from('inbox_rules').select('id, name, source').eq('connection_id', c.id);
    const defaults = (existing ?? []).filter((r) => r.source === 'default');
    const custom = (existing ?? []).filter((r) => r.source !== 'default');
    const target = defaultRulesForProvider(c.provider);
    console.log(`${c.user_id.slice(0, 8)} · ${c.provider_account_id} — stored defaults: ${defaults.length} (target ${target.length}) · custom kept: ${custom.length}${defaults.length > target.length ? ' ⚠ DUPLICATED' : ''}`);
    if (!APPLY) continue;
    if (defaults.length) await sb.from('inbox_rules').delete().eq('connection_id', c.id).eq('source', 'default');
    await sb.from('inbox_rules').insert(target.map((r) => toRow(r, c.user_id, c.id)));
  }
  // Orphaned rules (connection deleted) — report only.
  const { data: all } = await sb.from('inbox_rules').select('id, connection_id');
  const liveConns = new Set((conns ?? []).map((c) => c.id));
  const orphans = (all ?? []).filter((r) => r.connection_id && !liveConns.has(r.connection_id));
  if (orphans.length) {
    console.log(`orphaned rules (dead connections): ${orphans.length}${APPLY ? ' — deleting' : ''}`);
    if (APPLY) await sb.from('inbox_rules').delete().in('id', orphans.map((o) => o.id));
  }
  console.log(APPLY ? 'done' : 'dry-run done (re-run with --apply)');
})();
