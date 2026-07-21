// ONE BRAIN — registry hygiene backfill. Two reasoned passes across every user with entity memory:
//   1. REFLECTION (reflect.ts) — merge duplicate entities (one body of work remembered twice).
//   2. RECONCILE (reconcile-registry.ts) — clean canonical names, fix categories, archive pure channels.
// Both are reasoned (the brain, not string rules) and idempotent. Dry-run default; --apply commits.
// Usage: npx tsx scripts/reconcile-registry.ts [--apply] [--user <id>]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { reflectEntities } from '../lib/entities/reflect';
import { reconcileRegistry } from '../lib/entities/reconcile-registry';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const only = (() => { const i = process.argv.indexOf('--user'); return i >= 0 ? process.argv[i + 1] : null; })();

(async () => {
  // Users who actually have initiative memory.
  const { data: ents } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative').limit(5000);
  let users = [...new Set((ents ?? []).map((e: any) => e.user_id as string))];
  if (only) users = users.filter((u) => u === only);

  for (const uid of users) {
    console.log(`\n════ ${uid.slice(0, 8)} ════`);

    // 1. REFLECTION — merge duplicates first (so reconcile names the survivors, not the dupes).
    let mergeRounds = 0, merged = 0;
    for (let round = 0; round < 4; round++) {
      const verdicts = await reflectEntities(sb, uid, { commit: APPLY });
      const m = verdicts.filter((v) => v.verdict === 'merge');
      m.forEach((v) => console.log(`  merge: "${v.a}" + "${v.b}" → ${v.reason}`));
      merged += m.length; mergeRounds++;
      if (!APPLY || m.length === 0) break; // dry-run reports one round; committed loops until stable
    }

    // 2. RECONCILE — canonical names, categories, archive channels.
    const verdicts = await reconcileRegistry(sb, uid, { commit: APPLY });
    const archived = verdicts.filter((v) => v.action === 'archive');
    const renamed = verdicts.filter((v) => v.renamed);
    const recat = verdicts.filter((v) => v.action === 'keep' && v.category);
    for (const v of archived) console.log(`  archive (channel): "${v.currentName}" — ${v.reason}`);
    for (const v of renamed) console.log(`  rename: "${v.currentName}" → "${v.canonicalName}" [${v.category ?? '—'}] — ${v.reason}`);
    console.log(`  · reflected ${merged} merge(s) over ${mergeRounds} round(s) · ${verdicts.length} entities · ${renamed.length} renamed · ${archived.length} archived · ${recat.length} categorised`);
  }
  console.log(APPLY ? '\n✓ applied.' : '\nDry-run. Re-run with --apply to commit.');
})();
