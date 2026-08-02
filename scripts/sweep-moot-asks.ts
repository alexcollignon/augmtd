// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MOOT-ASK SWEEP (Aug 2 — experience-spec law 3 backfill): settles every LIVE input-checklist
// ask whose owning work has already resolved (the STC room carried two dead asks for a report
// delivered days earlier). Same mechanic as the live doors: component strips, text stays.
// Dry-run default; --apply commits. --all sweeps every user.
//   npx tsx scripts/sweep-moot-asks.ts [--apply] [--all] [--user email]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { settleAsksForItem } from '../lib/room/turns';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  let live = 0, moot = 0, settled = 0;

  for (const u of targets) {
    const { data: turns } = await sb.from('room_turns').select('id, dedupe_key, room_key, text')
      .eq('user_id', u.id).filter('component->>key', 'eq', 'input_checklist').limit(500);
    for (const t of turns ?? []) {
      live++;
      const dk = String(t.dedupe_key ?? '');
      const m = /^requires:(.+)$/.exec(dk) ?? /^delegate:([^:]+):/.exec(dk);
      if (!m) continue;
      const id = m[1];
      // The owning work: an inbox item or a commitment — resolved either way = the ask is moot.
      const { data: it } = await sb.from('inbox_items').select('id, status').eq('id', id).eq('user_id', u.id).maybeSingle();
      const { data: c } = it ? { data: null } : await sb.from('commitments').select('id, status').eq('id', id).eq('user_id', u.id).maybeSingle();
      const kind = it ? 'inbox_item' as const : c ? 'commitment' as const : null;
      const status = it?.status ?? c?.status ?? null;
      if (!kind) continue;
      const resolved = status === 'completed' || status === 'dismissed' || status === 'done';
      if (!resolved) continue;
      moot++;
      console.log(`  ${u.email} · [${kind} ${String(status)}] "${String(t.text).replace(/\s+/g, ' ').slice(0, 70)}"`);
      if (APPLY) settled += await settleAsksForItem(sb, u.id, kind, id);
    }
  }
  console.log(`\nlive asks=${live} · moot=${moot} · settled=${settled}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
