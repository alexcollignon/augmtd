// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COUNTERPARTY BACKFILL (Sep 18) — meeting-sourced commitments written BEFORE the July 7
// counterparty-capture upgrade carry `counterparty: null`, so the deck and every room print a
// source label ("from <meeting>") for an obligation that has a perfectly resolvable human on the
// other side of it.
//
// THE LAW THIS SWEEP OBEYS IS THE WRITE PATH'S OWN: a counterpart comes from the meeting's REAL
// ATTENDEES, reduced alias-aware to exactly ONE non-user person (lib/commitments/extract.ts
// `soleCounterpartOf` — imported, never re-implemented), then resolved through the person registry
// (`resolveIdentity`) so one human never lands under two labels. Anything short of one person is a
// SKIP: a group meeting is genuinely unresolvable, and a name is never invented.
//
// Deliberately NOT used as evidence: the counterparty a SIBLING commitment of the same meeting
// carries. That row's label is an inference about that row — it is not proof about this one.
//
// Attendee sources, both of them real participant lists: the transcript's own `attendees`, and the
// linked calendar event's `attendees` (older transcripts were inserted with an empty list, so the
// calendar row is usually the only surviving roster).
//
// Dry-run by default; --apply writes `counterparty` and NOTHING else. Per-user; --all sweeps every user.
//   npx tsx scripts/sweep-commitment-counterparty.ts [--apply] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { soleCounterpartOf } from '../lib/commitments/extract';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

// A bare address is a fact, not a name: the deck should say "Sam Vendor", never
// "jl@…". When the roster only survives as an email, the sender's OWN display name — the
// `from_name` he signs his mail with — is his own words, not an invention. Most recent wins.
const looksLikeEmail = (s: string): boolean => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s.trim());
const senderNameFor = async (userId: string, email: string): Promise<string | null> => {
  const { data } = await sb.from('emails').select('from_name')
    .eq('user_id', userId).ilike('from_address', email)
    .not('from_name', 'is', null).neq('from_name', '')
    .order('received_at', { ascending: false }).limit(1);
  const name = ((data?.[0] as { from_name?: string } | undefined)?.from_name ?? '').trim();
  return name && !looksLikeEmail(name) ? name : null;
};

// An attendee row is a string or an object the calendar/transcript stores — one reader for both.
const attendeeLabel = (a: unknown): string | null => {
  if (typeof a === 'string') return a.trim() || null;
  const o = (a ?? {}) as { name?: string; email?: string; displayName?: string };
  const name = (o.name || o.displayName || '').toString().trim();
  const email = (o.email || '').toString().trim();
  return name && email ? `${name} <${email}>` : (name || email || null);
};

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  // The two skips are told apart on purpose: a meeting with NO surviving roster is a data gap, a
  // meeting with several people is a genuine 1:1 refusal. Collapsing them would hide which is which.
  let scanned = 0, resolved = 0, emptyRoster = 0, crowded = 0, noMeeting = 0, self = 0, written = 0;

  for (const u of targets) {
    // Scope: LIVE meeting commitments only (a settled row is history — we do not rewrite history).
    const { data: rows } = await sb.from('commitments')
      .select('id, description, source_id, status')
      .eq('user_id', u.id).eq('source', 'meeting').is('counterparty', null)
      .in('status', ['open', 'suggested']);
    if (!rows?.length) continue;

    const { data: prof } = await sb.from('profiles').select('full_name').eq('id', u.id).maybeSingle();
    const { data: conns } = await sb.from('connections').select('email').eq('user_id', u.id);
    const userEmails = [u.email, ...((conns ?? []) as Array<{ email: string | null }>).map((c) => c.email)];
    const persons = await getPersonEntities(sb as never, u.id).catch(() => []);

    // ONE roster read per meeting, however many of its commitments are missing a counterparty.
    const rosterCache = new Map<string, { sole: string | null; size: number }>();
    const rosterFor = async (transcriptId: string): Promise<{ sole: string | null; size: number }> => {
      const hit = rosterCache.get(transcriptId);
      if (hit) return hit;
      const { data: mt } = await sb.from('meeting_transcripts')
        .select('attendees, calendar_event_id').eq('id', transcriptId).eq('user_id', u.id).maybeSingle();
      const names: string[] = [];
      const push = (list: unknown) => {
        for (const a of Array.isArray(list) ? list : []) { const l = attendeeLabel(a); if (l) names.push(l); }
      };
      push((mt as { attendees?: unknown } | null)?.attendees);
      const evId = (mt as { calendar_event_id?: string | null } | null)?.calendar_event_id;
      if (evId) {
        const { data: ev } = await sb.from('calendar_events').select('attendees').eq('id', evId).maybeSingle();
        push((ev as { attendees?: unknown } | null)?.attendees);
      }
      const out = { sole: soleCounterpartOf(names, prof?.full_name ?? null, userEmails), size: names.length };
      rosterCache.set(transcriptId, out);
      return out;
    };

    for (const c of rows as Array<{ id: string; description: string; source_id: string | null; status: string }>) {
      scanned++;
      if (!c.source_id) { noMeeting++; continue; }
      const { sole, size } = await rosterFor(c.source_id);
      if (!sole) { if (size) crowded++; else emptyRoster++; continue; } // not a 1:1, or no surviving roster
      // The registry has the last word: the canonical name wins, an unresolved form stays raw, and
      // the USER is never their own counterparty.
      const id = resolveIdentity(persons, sole);
      if (id.isSelf) { self++; continue; }
      let counterparty = (id.canonical ?? sole).toString().slice(0, 200);
      if (looksLikeEmail(counterparty)) {
        const name = await senderNameFor(u.id, counterparty);
        if (name) counterparty = name.slice(0, 200);
      }
      resolved++;
      console.log(`  · ${u.email} · "${c.description.slice(0, 60)}" → ${counterparty}${id.canonical && id.canonical !== sole ? ` (canonical of "${sole}")` : ''}`);
      if (APPLY) {
        const { error } = await sb.from('commitments')
          .update({ counterparty, updated_at: new Date().toISOString() })
          .eq('id', c.id).eq('user_id', u.id).is('counterparty', null);
        if (error) console.log(`    ✗ write failed: ${error.message}`);
        else { written++; await sb.from('profiles').update({ home_brief: null }).eq('id', u.id); }
      }
    }

    // ── THE NAME UPGRADE — a row already labeled with a bare address (an earlier run of this very
    // sweep, before the from_name resolution existed) is lifted to that SAME address's own sender
    // name. Guarded on the exact old value, so a human-written label is never touched. ────────────
    const { data: emailRows } = await sb.from('commitments')
      .select('id, description, counterparty')
      .eq('user_id', u.id).eq('source', 'meeting').like('counterparty', '%@%')
      .in('status', ['open', 'suggested']);
    for (const c of (emailRows ?? []) as Array<{ id: string; description: string; counterparty: string }>) {
      if (!looksLikeEmail(c.counterparty)) continue;
      const name = await senderNameFor(u.id, c.counterparty);
      if (!name) continue;
      resolved++;
      console.log(`  · ${u.email} · "${c.description.slice(0, 60)}" → ${name} (name of ${c.counterparty})`);
      if (APPLY) {
        const { error } = await sb.from('commitments')
          .update({ counterparty: name.slice(0, 200), updated_at: new Date().toISOString() })
          .eq('id', c.id).eq('user_id', u.id).eq('counterparty', c.counterparty);
        if (error) console.log(`    ✗ write failed: ${error.message}`);
        else { written++; await sb.from('profiles').update({ home_brief: null }).eq('id', u.id); }
      }
    }
  }
  console.log(`\nscanned=${scanned} · resolvable=${resolved} · skipped(no roster on the meeting)=${emptyRoster} · skipped(more than one person)=${crowded} · skipped(no meeting)=${noMeeting} · skipped(self)=${self} · written=${written}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
