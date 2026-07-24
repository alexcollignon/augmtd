// THE IDENTITY HEAL SWEEP (orchestrated-loop O1d) — one-time repair of commitments written before
// write-time resolution existed. For every user: ensure the SELF entity (O1a), then walk OPEN
// commitments and resolve each counterparty through the registry:
//   • resolves to SELF  → structurally invalid: 'awaiting' flips to 'you_owe'; counterparty → null
//   • resolves to a person → canonicalize the label (one human, one name)
//   • unresolved → untouched (honest)
// Dry-run by default; `--apply` writes. Read-only diagnostics per user either way.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { ensureSelfEntity } from '../lib/entities/self';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: profs } = await sb.from('profiles').select('id, email');
  for (const p of (profs ?? []) as Array<{ id: string; email: string | null }>) {
    const uid = p.id;
    const self = await ensureSelfEntity(sb, uid);
    if (!self) continue; // no identity forms (empty account)

    const persons = await getPersonEntities(sb, uid);
    const { data: open } = await sb.from('commitments')
      .select('id, description, direction, counterparty').eq('user_id', uid).eq('status', 'open').limit(1000);
    const rows = (open ?? []) as Array<{ id: string; description: string; direction: string; counterparty: string | null }>;
    if (!rows.length) continue;

    let selfFixed = 0, canonicalized = 0;
    for (const c of rows) {
      if (!c.counterparty) continue;
      const id = resolveIdentity(persons, c.counterparty);
      if (id.isSelf) {
        selfFixed++;
        console.log(`  ${APPLY ? 'FIX' : 'would fix'} [self] "${c.description.slice(0, 50)}" · counterparty "${c.counterparty}" → null, ${c.direction} → you_owe`);
        if (APPLY) await sb.from('commitments').update({ counterparty: null, direction: 'you_owe' }).eq('id', c.id);
      } else if (id.canonical && id.canonical !== c.counterparty) {
        canonicalized++;
        console.log(`  ${APPLY ? 'FIX' : 'would fix'} [name] "${c.counterparty}" → "${id.canonical}" on "${c.description.slice(0, 40)}"`);
        if (APPLY) await sb.from('commitments').update({ counterparty: id.canonical }).eq('id', c.id);
      }
    }
    console.log(`══ ${uid.slice(0, 8)} — self entity "${self.name}" (${self.aliases.length} aliases) · ${rows.length} open · self-counterparty ${selfFixed} · canonicalized ${canonicalized}${APPLY ? ' (APPLIED)' : ' (dry-run)'}`);
  }
  process.exit(0);
})();
