// READ-ONLY cross-user smoke for the Person Brain (Step 1, S1a). NO writes, NO AI (assembly is the cheap
// deterministic half; synthesis is skipped). Per user: how many contacts ASSEMBLE a ledger (coverage),
// automated senders excluded, is_internal flagged (not dropped), quiet_days never counts a future date, and
// a couple of sample ledgers to eyeball. Proves the deterministic layer before we spend AI on synthesis.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchPeopleCorpus, assemblePersonLedger, resolvePersonSeed, isRealPerson } from '../lib/people/brain';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ONE_USER = process.argv.find((a) => a.startsWith('--user='))?.slice('--user='.length) || null;

(async () => {
  let userIds: string[];
  if (ONE_USER) userIds = [ONE_USER];
  else {
    const { data } = await sb.from('relationship_graph').select('user_id').limit(20000);
    userIds = [...new Set((data ?? []).map((r: any) => r.user_id))];
  }

  let totContacts = 0, totReal = 0, totAssembled = 0, totInternal = 0, futureLeak = 0;
  const nowMs = Date.now();

  for (const uid of userIds) {
    const corpus = await fetchPeopleCorpus(sb, uid);
    const contacts = [...corpus.contacts].filter((c) => c.email).sort((a, b) => b.frequency - a.frequency);
    if (!contacts.length) continue;

    let real = 0, assembled = 0, internal = 0;
    const samples: string[] = [];
    for (const c of contacts) {
      totContacts++;
      if (!isRealPerson(c.email, c.name)) continue;
      real++; totReal++;
      const seed = resolvePersonSeed(corpus, c.email);
      if (!seed) continue;
      const a = assemblePersonLedger(corpus, seed);
      if (!a) continue;
      assembled++; totAssembled++;
      if (a.isInternal) { internal++; totInternal++; }
      // Invariant: quietDays is derived only from PAST touches — a future date must never appear as a touch.
      const future = a.ledger.some((e) => e.kind !== 'commitment' && e.at && new Date(e.at).getTime() > nowMs && a.quietDays === 0);
      if (future) futureLeak++;
      if (samples.length < 3) samples.push(`    ${(a.displayName || a.key).slice(0, 26).padEnd(26)} events:${String(a.ledger.length).padStart(3)} quiet:${a.quietDays ?? '—'} init:${a.initiatives.length}${a.isInternal ? ' [internal]' : ''}  breakdown[in/out/mtg/commit]:${a.ledger.filter(e=>e.kind==='email_in').length}/${a.ledger.filter(e=>e.kind==='email_out').length}/${a.ledger.filter(e=>e.kind==='meeting').length}/${a.ledger.filter(e=>e.kind==='commitment').length}`);
    }
    console.log(`\nuser ${uid.slice(0, 8)} — contacts:${contacts.length} real(non-automated):${real} assembled:${assembled} (${real ? Math.round(100*assembled/real) : 0}%) internal:${internal}`);
    for (const s of samples) console.log(s);
  }

  console.log('\n════ TOTALS ════');
  console.log(`contacts: ${totContacts}  ·  real (non-automated): ${totReal} (${totContacts ? Math.round(100*totReal/totContacts) : 0}%)  ·  assembled a ledger: ${totAssembled} (${totReal ? Math.round(100*totAssembled/totReal) : 0}% of real)`);
  console.log(`internal colleagues flagged (kept, not dropped): ${totInternal}`);
  console.log(`future-date leaked into quiet=0: ${futureLeak} ${futureLeak ? '⚠️ BUG' : '✓ none'}`);
})();
