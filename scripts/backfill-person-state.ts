// One-time backfill of the Person Brain (Step 1). For each user with contacts, assemble + synthesize a
// person_state row per real correspondent (skips automated senders). Sig-gated on re-run (unchanged = no AI).
// DRY-RUN by default — prints what it WOULD synthesize; pass --apply to write. Optional --user=<uuid>.
// Mirrors scripts/backfill-initiative-canonical.ts. Run AFTER applying 20260720_person_state.sql.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchPeopleCorpus, assemblePersonLedger, synthesizePerson, resolvePersonSeed, isRealPerson } from '../lib/people/brain';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const PREVIEW = process.argv.includes('--preview'); // synthesize + print the STATE, but do NOT write (no table needed)
const ONE_USER = process.argv.find((a) => a.startsWith('--user='))?.slice('--user='.length) || null;
const CAP = Number(process.argv.find((a) => a.startsWith('--cap='))?.slice('--cap='.length) || 40); // per-user cap (cost guard)

(async () => {
  let userIds: string[];
  if (ONE_USER) userIds = [ONE_USER];
  else {
    const { data } = await sb.from('relationship_graph').select('user_id').limit(20000);
    userIds = [...new Set((data ?? []).map((r: any) => r.user_id))];
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${userIds.length} user(s), cap ${CAP}/user\n`);

  let totPeople = 0, totAssembled = 0, totWritten = 0, totSkippedAuto = 0;

  for (const uid of userIds) {
    const corpus = await fetchPeopleCorpus(sb, uid);
    // Rank contacts by interaction frequency → backfill the most-important people first, cap the tail.
    const contacts = [...corpus.contacts].filter((c) => c.email).sort((a, b) => b.frequency - a.frequency).slice(0, CAP);
    let assembled = 0, written = 0, skippedAuto = 0;
    for (const c of contacts) {
      totPeople++;
      if (!isRealPerson(c.email, c.name)) { skippedAuto++; totSkippedAuto++; continue; }
      const seed = resolvePersonSeed(corpus, c.email);
      if (!seed) continue;
      const a = assemblePersonLedger(corpus, seed);
      if (!a) continue;
      assembled++; totAssembled++;
      if (!APPLY && !PREVIEW) {
        console.log(`  [dry] ${(a.displayName || a.key).padEnd(28)} events:${a.ledger.length} quiet:${a.quietDays ?? '—'} init:${a.initiatives.length}${a.isInternal ? ' [internal]' : ''}`);
        continue;
      }
      const { state, nextTouch } = await synthesizePerson(sb, uid, a);
      if (PREVIEW) {
        if (!state) { console.log(`  [no-state] ${a.displayName || a.key}`); continue; }
        console.log(`  ${(a.displayName || a.key).slice(0, 24).padEnd(24)} ${state.momentum.padEnd(15)} ${state.relationship.padEnd(9)} "${state.summary}"`);
        if (state.whoOwes.you.length) console.log(`      you owe: ${state.whoOwes.you.join(' · ')}`);
        if (state.whoOwes.them.length) console.log(`      they owe: ${state.whoOwes.them.join(' · ')}`);
        if (nextTouch) console.log(`      → next: ${nextTouch.title} (${nextTouch.reason})`);
        written++; totWritten++;
        continue;
      }
      if (!state) { console.log(`  [skip-synth] ${a.displayName || a.key} — no state`); continue; }
      await sb.from('person_state').upsert({
        user_id: uid, person_key: a.key, display_name: a.displayName, emails: a.emails, org: a.org,
        is_internal: a.isInternal, initiatives: a.initiatives, state, next_touch: nextTouch,
        quiet_days: a.quietDays, people_sig: a.sig, last_touch_at: a.lastTouchAt, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,person_key' });
      written++; totWritten++;
      console.log(`  ✓ ${(a.displayName || a.key).padEnd(28)} ${state.momentum.padEnd(14)} "${state.summary}"${nextTouch ? `  → ${nextTouch.title}` : ''}`);
    }
    console.log(`user ${uid.slice(0, 8)} — contacts:${contacts.length} assembled:${assembled} written:${written} skipped(auto):${skippedAuto}\n`);
  }

  console.log('════ TOTALS ════');
  console.log(`people considered: ${totPeople}  assembled: ${totAssembled}  ${APPLY ? `written: ${totWritten}` : '(dry-run — no writes)'}  skipped(automated): ${totSkippedAuto}`);
  if (!APPLY) console.log('Re-run with --apply to synthesize + write. Add --user=<uuid> to scope, --cap=N per user.');
})();
