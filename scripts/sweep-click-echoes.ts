// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CLICK-ECHO SWEEP (Aug 3 — the CTA-is-the-deed law, laws 5+8): the rail's next-move CTA used
// to persist "Opening the next move — …" as a room turn on every click. A click is not history —
// the writer is gone (item-rail.tsx); this drains the stored remnants. Text-anchored on the exact
// narration prefix (the entity-room's grounded focus narrations share the cta: key space and must
// survive — they carry real offers).
// Dry-run default; --apply commits. --all sweeps every user.
//   npx tsx scripts/sweep-click-echoes.ts [--apply] [--all] [--user email]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  let found = 0, removed = 0;
  for (const u of targets) {
    const { data: turns } = await sb.from('room_turns')
      .select('id, room_key, text').eq('user_id', u.id)
      .like('text', 'Opening the next move —%').limit(500);
    for (const t of turns ?? []) {
      found++;
      console.log(`  ${u.email} · [${String(t.room_key).slice(0, 12)}…] "${String(t.text).slice(0, 70)}"`);
      if (APPLY) {
        const { error } = await sb.from('room_turns').delete().eq('id', t.id).eq('user_id', u.id);
        if (!error) removed++;
      }
    }
  }
  console.log(`\nclick-echo turns found=${found} · removed=${removed}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
