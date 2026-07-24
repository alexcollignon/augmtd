// P5 CLEANUP (projecthood-plan) — collapse existing cross-meeting near-duplicate OPEN commitments.
// Clusters by shared context (same counterparty, alias-aware, or same initiative), keeps the OLDEST
// (first captured), dismisses the rest with resolved_reason 'duplicate'. Reversible (status flip).
// Usage: npx tsx scripts/dedup-entity-commitments.ts [--apply] [--user <uid>]   (dry-run default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { isNearDuplicate } from '../lib/commitments/extract';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const onlyUser = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

const normParty = (s: string | null) => (s || '').toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z@ ]/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  const { data: users } = await sb.from('commitments').select('user_id').eq('status', 'open').limit(3000);
  const uids = [...new Set((users ?? []).map((r) => r.user_id as string))].filter((u) => !onlyUser || u === onlyUser);
  for (const uid of uids) {
    const { data: rows } = await sb.from('commitments')
      .select('id, description, counterparty, initiative, created_at').eq('user_id', uid).eq('status', 'open')
      .order('created_at', { ascending: true }).limit(600);
    const open = (rows ?? []) as Array<{ id: string; description: string; counterparty: string | null; initiative: string | null; created_at: string }>;
    const kept: typeof open = [];
    const dupes: Array<{ id: string; description: string; of: string }> = [];
    for (const c of open) {
      const hit = kept.find((k) => {
        if (!isNearDuplicate(c.description, k.description, 0.5)) return false;
        const sameParty = !!c.counterparty && !!k.counterparty && normParty(c.counterparty) === normParty(k.counterparty);
        const sameInit = !!c.initiative && !!k.initiative && c.initiative.toLowerCase().trim() === k.initiative.toLowerCase().trim();
        return sameParty || sameInit;
      });
      if (hit) dupes.push({ id: c.id, description: c.description, of: hit.description });
      else kept.push(c);
    }
    console.log(`\n══ ${uid.slice(0, 8)} — ${open.length} open, ${dupes.length} duplicates ══`);
    for (const d of dupes.slice(0, 10)) console.log(`  ✕ "${d.description.slice(0, 56)}"  ≈  "${d.of.slice(0, 48)}"`);
    if (dupes.length > 10) console.log(`  … +${dupes.length - 10} more`);
    if (APPLY && dupes.length) {
      await sb.from('commitments').update({ status: 'dismissed', resolved_reason: 'duplicate', resolved_at: new Date().toISOString() })
        .in('id', dupes.map((d) => d.id)).eq('user_id', uid);
      console.log(`  applied — ${dupes.length} dismissed as duplicates`);
    }
  }
  if (!APPLY) console.log('\n(dry run — pass --apply to commit)');
  process.exit(0);
})();
