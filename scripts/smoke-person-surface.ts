// READ-ONLY cross-user smoke for S1b + S1c. Answers the visible question: when a user opens a real inbox
// item, will the "who is this" card be there? — i.e. does the item's sender resolve (exactly as the context
// route keys it: lowercased email, else canonical name) to a durable person_state WITH synthesized state.
// Also checks the S1b live-hook resolution (resolvePersonSeed maps a raw sender → the SAME backfilled key).
// No writes, no AI. Run after the backfill.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { canonicalPerson } from '../lib/projects/identity';
import { fetchPeopleCorpus, resolvePersonSeed } from '../lib/people/brain';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const emailOf = (s?: string | null): string | null => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

(async () => {
  const { data: psUsers } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((psUsers ?? []).map((r: any) => r.user_id))];
  if (!userIds.length) { console.log('No person_state rows — run the backfill first.'); return; }

  let totItems = 0, totWithSender = 0, totCardShows = 0, totResolveMatch = 0, totResolveChecked = 0;

  for (const uid of userIds) {
    // The user's own addresses (never a "who is this" for self).
    const own = new Set<string>();
    const [{ data: prof }, { data: conns }] = await Promise.all([
      sb.from('profiles').select('email').eq('id', uid).maybeSingle() as any,
      sb.from('connections').select('metadata, provider_account_id').eq('user_id', uid) as any,
    ]);
    const pe = emailOf(prof?.email); if (pe) own.add(pe);
    for (const c of (conns ?? []) as any[]) { const e = emailOf(c.metadata?.email || c.provider_account_id); if (e) own.add(e); }

    // The keyset of backfilled person brains that actually HAVE state.
    const { data: states } = await sb.from('person_state').select('person_key, state').eq('user_id', uid);
    const withState = new Set((states ?? []).filter((r: any) => r.state?.summary).map((r: any) => r.person_key));

    // Recent inbox items → the sender the S1c card would resolve.
    const { data: items } = await sb.from('inbox_items').select('source_data').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(80);
    const corpus = await fetchPeopleCorpus(sb, uid); // for the S1b resolution check

    let withSender = 0, cardShows = 0, rMatch = 0, rChecked = 0;
    const samples: string[] = [];
    for (const it of (items ?? []) as any[]) {
      totItems++;
      const sd = it.source_data ?? {};
      const senderEmail = emailOf(sd.from_address || sd.from);
      const senderName = sd.from_name || null;
      if (senderEmail && own.has(senderEmail)) continue; // self / no sender
      const key = (senderEmail || (senderName ? canonicalPerson(senderName) : null) || '').toLowerCase();
      if (!key) continue;
      withSender++; totWithSender++;
      if (withState.has(key)) {
        cardShows++; totCardShows++;
        if (samples.length < 3) { const s = (states ?? []).find((r: any) => r.person_key === key) as any; samples.push(`    ✓ ${(s.state.summary || '').slice(0, 72)}`); }
      }
      // S1b: does the live hook resolve this raw sender to the SAME key the card uses?
      const raw = sd.from_address || sd.from || senderName;
      if (raw) { rChecked++; totResolveChecked++; const seed = resolvePersonSeed(corpus, raw); if (seed && seed.key === key) { rMatch++; totResolveMatch++; } }
    }
    console.log(`\nuser ${uid.slice(0, 8)} — items:${(items ?? []).length} w/sender:${withSender} card-shows:${cardShows} (${withSender ? Math.round(100*cardShows/withSender) : 0}%)  hook-resolve-match:${rChecked ? Math.round(100*rMatch/rChecked) : 0}%`);
    for (const s of samples) console.log(s);
  }

  console.log('\n════ TOTALS ════');
  console.log(`inbox items sampled: ${totItems}  ·  with a resolvable sender: ${totWithSender}`);
  console.log(`"who is this" card will show: ${totCardShows} (${totWithSender ? Math.round(100*totCardShows/totWithSender) : 0}% of sender items)`);
  console.log(`S1b live-hook resolution matches the card key: ${totResolveChecked ? Math.round(100*totResolveMatch/totResolveChecked) : 0}% (${totResolveMatch}/${totResolveChecked})`);
})();
