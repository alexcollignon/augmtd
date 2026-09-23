// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SELF-PARTY SWEEP (stabilization W3.4 · THE SELF-PARTY LAW). DETERMINISTIC — ZERO AI.
//
// The repair half of the write door's law: a LIVE commitment whose counterparty — or whose title's
// "with X" — names the USER THEMSELF ("Schedule a call with <the user>", counterparty null). The
// ONE predicate the write door asks (`repairSelfParty` / `denotesUser`, lib/commitments/extraction-
// truth.ts) re-derives the counterparty from the SOURCE's other party — the received email's
// sender, the sent email's first recipient, a 1:1 meeting's sole counterpart (`soleCounterpartOf`)
// — and rewrites the title from their side. When no other party can be derived, the title is kept
// and the counterparty is never the user.
//
// Dry-run by default (prints before → after). --apply writes description/counterparty/direction,
// guarded on the exact old description (owner-gated). --user <email> or --all is required.
//   npx tsx scripts/sweep-self-counterparty.ts [--apply] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { repairSelfParty, selfPartyInTitle, denotesUser, partyDisplay, type UserForms } from '../lib/commitments/extraction-truth';
import { soleCounterpartOf } from '../lib/commitments/extract';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';
import { userAddresses } from '../lib/inbox/ensure-mail-kind';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

type Row = { id: string; description: string; counterparty: string | null; direction: string; source: string; source_id: string | null };
const label = (a: unknown): string | null => {
  if (typeof a === 'string') return a.trim() || null;
  const o = (a ?? {}) as { name?: string; email?: string; displayName?: string };
  const n = (o.name || o.displayName || '').trim(), e = (o.email || '').trim();
  return n && e ? `${n} <${e}>` : (n || e || null);
};

(async () => {
  if (!ALL && !userArg) { console.log('usage: --user <email> | --all  [--apply]'); process.exit(1); }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === userArg);
  let scanned = 0, found = 0, rederived = 0, written = 0;

  for (const u of targets) {
    const { data } = await sb.from('commitments')
      .select('id, description, counterparty, direction, source, source_id')
      .eq('user_id', u.id).in('status', ['open', 'suggested']).limit(3000);
    const rows = (data ?? []) as Row[];
    if (!rows.length) continue;
    const { data: prof } = await sb.from('profiles').select('full_name').eq('id', u.id).maybeSingle();
    const addrs = await userAddresses(sb, u.id);
    const persons = await getPersonEntities(sb as never, u.id).catch(() => []);
    const selfP = persons.find((p) => p.state?.self === true);
    const user: UserForms = {
      name: (prof?.full_name as string | null) || selfP?.name || null,
      aliases: [...(selfP?.aliases ?? []), ...addrs, ...(u.email ? [u.email] : [])],
    };

    const otherOf = async (r: Row): Promise<string | null> => {
      if (!r.source_id) return null;
      if (r.source === 'email') {
        const { data: e } = await sb.from('emails').select('from_address, from_name, to_addresses, is_from_user')
          .eq('user_id', u.id).eq('id', r.source_id).maybeSingle();
        if (!e) return null;
        if (e.is_from_user) return ((e.to_addresses as string[] | null) ?? [])[0] ?? null;
        return e.from_name ? `${e.from_name} <${e.from_address}>` : (e.from_address as string | null);
      }
      if (r.source === 'meeting') {
        const { data: mt } = await sb.from('meeting_transcripts').select('attendees, calendar_event_id')
          .eq('user_id', u.id).eq('id', r.source_id).maybeSingle();
        const names: string[] = [];
        for (const a of Array.isArray(mt?.attendees) ? mt!.attendees : []) { const l = label(a); if (l) names.push(l); }
        if (mt?.calendar_event_id) {
          const { data: ev } = await sb.from('calendar_events').select('attendees').eq('id', mt.calendar_event_id).maybeSingle();
          for (const a of Array.isArray(ev?.attendees) ? ev!.attendees : []) { const l = label(a); if (l) names.push(l); }
        }
        return soleCounterpartOf(names, user.name ?? null, addrs);
      }
      return null;
    };

    for (const r of rows) {
      scanned++;
      // Detection is the write door's own two questions: the field names the user, or (on the
      // user's own debt) the title's "with X" does.
      const named = (!!r.counterparty && denotesUser(r.counterparty, user))
        || (r.direction !== 'awaiting' && !!selfPartyInTitle(r.description, user));
      if (!named) continue;
      found++;
      const other = await otherOf(r);
      const fix = repairSelfParty({ description: r.description, counterparty: r.counterparty, direction: r.direction }, user, other);
      // The registry has the last word on the label (the write door's own resolution).
      if (fix.counterparty) fix.counterparty = resolveIdentity(persons, fix.counterparty).canonical ?? partyDisplay(fix.counterparty) ?? fix.counterparty;
      if (fix.counterparty) rederived++;
      if (!fix.changed) { console.log(`  · ${u.email} · "${r.description.slice(0, 70)}" — names the user, no other party derivable (left as is)`); continue; }
      console.log(`  · ${u.email} · "${r.description.slice(0, 70)}" [${r.direction} · ${r.counterparty ?? '∅'}]`);
      console.log(`      → "${fix.description.slice(0, 70)}" [${fix.direction} · ${fix.counterparty ?? '∅'}]${other ? '' : ' (no other party derivable — title kept)'}`);
      if (APPLY) {
        const { error } = await sb.from('commitments').update({
          description: fix.description.slice(0, 500), counterparty: fix.counterparty, direction: fix.direction ?? r.direction,
          updated_at: new Date().toISOString(),
        }).eq('id', r.id).eq('user_id', u.id).eq('description', r.description);
        if (error) console.log(`    ✗ write failed: ${error.message}`); else written++;
      }
    }
    if (APPLY && written) await sb.from('profiles').update({ home_brief: null }).eq('id', u.id);
  }
  console.log(`\nscanned=${scanned} · self-party rows=${found} · other party re-derived=${rederived} · written=${written}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
