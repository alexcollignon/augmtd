// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORSHIP REPAIR (W7.6 · AUTHORED, NOT FILED). GUARDED; DRY-RUN BY DEFAULT.
//
// Before W7.6 the Sent-folder sync stamped `emails.is_from_user = true` on EVERYTHING in Sent Items —
// including a forwarded meeting request whose `from` is the CLIENT organizer. Readers treat the flag
// as "the user wrote this" (reply resolution, the evidence settle, the self derivation, voice
// learning…). This census runs THE SAME law the sync now uses (lib/email-sync/authorship.ts, via the
// pure plan in lib/email-sync/authorship-repair.ts) over every stored is_from_user row and reports:
//   · misattributed rows per user (from ∉ the user's owned addresses — login + connected mailboxes),
//     with two hold-backs that are never flipped by default: rows of a DISCONNECTED mailbox, and
//     rows whose from display name is the user's own name (a likely unreported send-as alias —
//     --include-possible-aliases flips those too);
//   · the CLOSES those rows caused — inbox items + commitments resolved 'replied' or 'evidence:email'
//     where every closing candidate is misattributed (read-only list).
//
//   npx tsx scripts/repair-authorship.ts [--user <email>] [--include-possible-aliases]
//   npx tsx scripts/repair-authorship.ts --apply --yes            flip the rows: is_from_user=false +
//                                                                  metadata.filed_in_sent/authorship
//   npx tsx scripts/repair-authorship.ts --apply --yes --reopen   ALSO reopen the closes they caused,
//                                                                  through THE ONE restore flip
//                                                                  (lib/activity/reopen.ts — the Undo)
//
// ZERO AI. Output is MASKED (addresses print as shapes; no subjects, no names).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { loadSelfIdentity } from '../lib/entities/self';
import { planAuthorshipRepair, closeCausedByMisattribution, type StoredEmail, type ClosedRow } from '../lib/email-sync/authorship-repair';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const argv = process.argv;
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');
const REOPEN = argv.includes('--reopen');
const INCLUDE_ALIASES = argv.includes('--include-possible-aliases');
const userArg = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;

const mask = (f: string | null | undefined): string => {
  const s = String(f ?? '');
  if (!s.includes('@')) return s ? 'name' : '∅';
  const [l, d] = s.split('@');
  return `${l[0] ?? ''}***@${d?.[0] ?? ''}***.${d?.split('.').pop() ?? ''}`;
};

(async () => {
  if (APPLY && !YES) { console.error('--apply requires --yes (the repair rewrites emails.is_from_user).'); process.exit(2); }
  if (REOPEN && !APPLY) console.log('(--reopen without --apply --yes is a dry run: the closes are listed, nothing reopens)');
  const profiles = await fetchAllRows<{ id: string; email: string | null }>((from, to) =>
    sb.from('profiles').select('id, email').order('id', { ascending: true }).range(from, to));
  const users = userArg ? profiles.filter((p) => (p.email ?? '').toLowerCase() === userArg.toLowerCase()) : profiles;
  if (userArg && !users.length) { console.error(`no profile for ${userArg}`); process.exit(2); }

  const census = {
    users: 0, usersWithFlagged: 0, flaggedRows: 0, misattributed: 0, relayedCalendar: 0, foreignFrom: 0, noFrom: 0,
    heldOrphanConnection: 0, heldPossibleAlias: 0, flippable: 0, usersAffected: 0,
    closesReplied: 0, closesEvidence: 0, closesInbox: 0, closesCommitment: 0, flipped: 0, reopened: 0,
  };

  for (const u of users) {
    census.users++;
    const identity = await loadSelfIdentity(sb, u.id);
    if (!identity.addresses.length) continue; // an unknown identity flips nothing
    const flagged = await fetchAllRows<StoredEmail>((from, to) => sb.from('emails')
      .select('id, from_address, from_name, connection_id, thread_id, received_at, metadata')
      .eq('user_id', u.id).eq('is_from_user', true).order('id', { ascending: true }).range(from, to), { maxRows: 200000 });
    if (!flagged.length) continue;
    census.usersWithFlagged++;
    census.flaggedRows += flagged.length;
    const { data: conns } = await sb.from('connections').select('id').eq('user_id', u.id);
    const plan = planAuthorshipRepair(flagged, {
      ownAddresses: identity.addresses,
      ownNames: identity.aliases.filter((a) => !a.includes('@')),
      liveConnectionIds: ((conns ?? []) as Array<{ id: string }>).map((c) => c.id),
    });
    if (!plan.length) continue;
    census.usersAffected++;
    census.misattributed += plan.length;
    census.relayedCalendar += plan.filter((m) => m.basis === 'relayed_calendar').length;
    census.foreignFrom += plan.filter((m) => m.basis === 'foreign_from').length;
    census.noFrom += plan.filter((m) => m.basis === 'no_from').length;
    census.heldOrphanConnection += plan.filter((m) => m.hold === 'orphan_connection').length;
    census.heldPossibleAlias += plan.filter((m) => m.hold === 'possible_alias').length;
    const flippable = plan.filter((m) => m.hold === null || (INCLUDE_ALIASES && m.hold === 'possible_alias'));
    census.flippable += flippable.length;
    const misSet = new Set(flippable.map((m) => m.id));
    const byId = new Map(flagged.map((e) => [e.id, e]));
    const fromShapes = new Map<string, number>();
    for (const m of plan) { const k = mask(byId.get(m.id)?.from_address); fromShapes.set(k, (fromShapes.get(k) ?? 0) + 1); }
    console.log(`\nuser ${u.id.slice(0, 8)}… · is_from_user rows ${flagged.length} · NOT authored ${plan.length} (flippable ${flippable.length}; held: orphan-connection ${plan.filter((m) => m.hold === 'orphan_connection').length}, possible-alias ${plan.filter((m) => m.hold === 'possible_alias').length})`);
    console.log(`  bases: ${['relayed_calendar', 'foreign_from', 'no_from'].map((b) => `${b} ${plan.filter((m) => m.basis === b).length}`).join(' · ')}`);
    console.log(`  from shapes: ${[...fromShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join(', ')}`);

    // ── the closes these rows caused (read-only unless --apply --yes --reopen) ──
    const flaggedLite = flagged.map((e) => ({ id: e.id, thread_id: e.thread_id ?? null, received_at: e.received_at }));
    const caused: Array<{ kind: 'inbox_item' | 'commitment'; id: string; reason: string }> = [];
    const inboxClosed = await fetchAllRows<{ id: string; created_at: string | null; source_data: Record<string, unknown> | null }>((from, to) => sb.from('inbox_items')
      .select('id, created_at, source_data').eq('user_id', u.id).eq('status', 'completed')
      .in('source_data->>resolved_reason', ['replied', 'evidence:email']).order('id', { ascending: true }).range(from, to));
    for (const it of inboxClosed) {
      const sd = it.source_data ?? {};
      const row: ClosedRow = { id: it.id, thread_id: (sd.thread_id as string) ?? null, created_at: it.created_at, resolved_at: (sd.resolved_at as string) ?? null, resolved_reason: (sd.resolved_reason as string) ?? null };
      if (closeCausedByMisattribution(row, flaggedLite, misSet).caused) caused.push({ kind: 'inbox_item', id: it.id, reason: String(row.resolved_reason) });
    }
    const commitsClosed = await fetchAllRows<ClosedRow>((from, to) => sb.from('commitments')
      .select('id, thread_id, created_at, resolved_at, resolved_reason').eq('user_id', u.id).eq('status', 'done')
      .in('resolved_reason', ['replied', 'evidence:email']).order('id', { ascending: true }).range(from, to));
    for (const c of commitsClosed) {
      if (closeCausedByMisattribution(c, flaggedLite, misSet).caused) caused.push({ kind: 'commitment', id: c.id, reason: String(c.resolved_reason) });
    }
    for (const c of caused) {
      if (c.reason === 'replied') census.closesReplied++; else census.closesEvidence++;
      if (c.kind === 'inbox_item') census.closesInbox++; else census.closesCommitment++;
    }
    if (caused.length) console.log(`  closes caused: ${caused.length} (${caused.map((c) => `${c.kind}:${c.id.slice(0, 8)}…/${c.reason}`).join(', ')})`);

    if (!APPLY) continue;
    for (const m of flippable) {
      const e = byId.get(m.id)!;
      const { error } = await sb.from('emails').update({
        is_from_user: false,
        metadata: { ...(e.metadata ?? {}), filed_in_sent: true, authorship: m.basis, authorship_repaired_at: new Date().toISOString() },
      }).eq('id', m.id).eq('user_id', u.id).eq('is_from_user', true);
      if (error) console.error(`  ✗ flip ${m.id.slice(0, 8)}…: ${error.message}`); else census.flipped++;
    }
    if (!REOPEN) continue;
    const { reopenInboxItem, reopenCommitment } = await import('../lib/activity/reopen');
    for (const c of caused) {
      const r = c.kind === 'inbox_item'
        ? await reopenInboxItem(sb, u.id, c.id, { note: 'authorship_repair' })
        : await reopenCommitment(sb, u.id, c.id, { note: 'authorship_repair' });
      if (!r.ok) console.error(`  ✗ reopen ${c.kind} ${c.id.slice(0, 8)}…: ${r.error}`); else census.reopened++;
    }
    if (caused.length) {
      const { softBustBrief } = await import('../lib/home/bust-brief');
      await softBustBrief(sb, u.id).catch(() => {});
    }
  }
  console.log(`\nCENSUS${APPLY ? ' (APPLIED)' : ' (dry-run)'}:`, census);
})().catch((e) => { console.error(e); process.exit(1); });
