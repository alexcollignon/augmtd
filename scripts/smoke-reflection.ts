// PHASE A — REFLECTION smoke (cross-user, on the live shadow store). Dry-run first (verdicts only),
// then commit, then verify the store: links repointed, aliases absorbed, no orphan links.
// The Soboplac granularity question ("Jean-Marie chat" vs "SOBOPLAC agent") gets its reasoned answer here.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { reflectEntities } from '../lib/entities/reflect';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];
const COMMIT = process.argv.includes('--commit');

(async () => {
  for (const uid of USERS) {
    console.log(`\n════ user ${uid.slice(0, 8)} — reflection ${COMMIT ? 'COMMIT' : 'dry-run'} ════`);
    const verdicts = await reflectEntities(sb, uid, { commit: COMMIT });
    for (const v of verdicts) {
      console.log(`  ${v.verdict === 'merge' ? '⇐ MERGE   ' : '≠ separate'} (sim ${v.similarity.toFixed(2)}) "${v.a}"  vs  "${v.b}" — ${v.reason}`);
    }
    if (!verdicts.length) console.log('  (no adjacent pairs above the floor)');

    if (COMMIT) {
      // Verify store integrity: no links pointing at deleted entities; aliases absorbed.
      const { data: ents } = await sb.from('work_entities').select('id, name, aliases').eq('user_id', uid).eq('kind', 'initiative');
      const ids = new Set((ents ?? []).map((e: any) => e.id));
      const { data: links } = await sb.from('entity_links').select('entity_id').eq('user_id', uid).not('entity_id', 'is', null);
      const orphans = (links ?? []).filter((l: any) => !ids.has(l.entity_id)).length;
      const withAliases = (ents ?? []).filter((e: any) => (e.aliases ?? []).length > 0);
      console.log(`  store: ${ids.size} entities · orphan links: ${orphans === 0 ? '0 ✓' : orphans + ' ✗'} · aliased: ${withAliases.map((e: any) => `"${e.name}" aka {${e.aliases.join(' | ')}}`).join(' ; ') || 'none'}`);
    }
  }
})();
