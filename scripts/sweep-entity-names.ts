// THE NAMING-FLOOR REPAIR (Sep 21). Entities founded before the floor (lib/entities/entity-name)
// can wear a message header as their name — "Re: About the <thing> workshop?" — and a wide,
// punctuated name matches far more text than the work it denotes: that is how a conversation about
// something else was offered an unrelated project to file itself into.
//
// Scope is deliberately narrow and reversible in judgment terms:
//   • UNTRACKED, machine-founded entities only — a TRACKED project's name is a human decision and
//     outranks the machine (THE PINNING LAW). A human may keep any name they like.
//   • the proposal is the deterministic floor's own output; nothing is invented, nothing is judged.
//   • aliases are left untouched (identity forms the brain already recalls by), and the OLD name is
//     appended as an alias on --apply so nothing the registry could already match is lost.
//
// Usage: npx tsx -r dotenv/config scripts/sweep-entity-names.ts (--user <id> | --all) [--apply]
//        dotenv_config_path=.env.local                          (dry-run by default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { cleanEntityName, isSubjectShapedName } from '../lib/entities/entity-name';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv[process.argv.indexOf('--user') + 1];
const USER = process.argv.includes('--user') ? userArg : null;
if (!ALL && (!USER || !/^[0-9a-f-]{36}$/.test(USER))) {
  console.error('usage: sweep-entity-names.ts (--user <user_id> | --all) [--apply]');
  process.exit(1);
}

type Row = { id: string; user_id: string; name: string; aliases: string[] | null; tracked: boolean | null; status: string | null };

(async () => {
  console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} naming floor · ${ALL ? 'all users' : `user ${USER!.slice(0, 8)}`}\n`);
  let q = sb.from('work_entities').select('id, user_id, name, aliases, tracked, status')
    .eq('kind', 'initiative').neq('tracked', true);
  if (!ALL) q = q.eq('user_id', USER!);
  const { data, error } = await q.limit(5000);
  if (error) { console.error('read failed:', error.message); process.exit(1); }

  const rows = (data ?? []) as Row[];
  const byUser = new Map<string, number>();
  let proposed = 0; let applied = 0;

  for (const r of rows) {
    if (!isSubjectShapedName(r.name)) continue;
    const next = cleanEntityName(r.name);
    if (!next || next === r.name) continue;
    proposed++;
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + 1);
    console.log(`  [${r.user_id.slice(0, 8)}] "${r.name.slice(0, 70)}"\n        → "${next}"`);
    if (APPLY) {
      const aliases = [...new Set([...(Array.isArray(r.aliases) ? r.aliases : []), r.name])].slice(0, 12);
      const { error: uerr } = await sb.from('work_entities')
        .update({ name: next, aliases, updated_at: new Date().toISOString() })
        .eq('id', r.id).eq('user_id', r.user_id).neq('tracked', true);
      if (uerr) console.log(`        ! update failed: ${uerr.message}`);
      else applied++;
    }
  }

  console.log(`\nscanned ${rows.length} untracked entit${rows.length === 1 ? 'y' : 'ies'} across ${new Set(rows.map((r) => r.user_id)).size} user(s)`);
  console.log(`${APPLY ? `RENAMED: ${applied}` : `WOULD RENAME: ${proposed}`} subject-shaped name(s)${APPLY ? '' : ' — re-run with --apply.'}`);
  for (const [u, n] of [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${u.slice(0, 8)}: ${n}`);
})();
