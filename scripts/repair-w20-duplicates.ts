// ════════════════════════════════════════════════════════════════════════════════════════════════
// W20 · ONE FACT, ONE HOME — the attendance + same-message duplicate census. GUARDED; DRY-RUN BY DEFAULT.
//
// Two row classes minted before the W20 floors:
//   • ATTENDANCE — open commitments whose title IS attending a meeting ("Attend the scheduled call —
//     Oct 12"): a calendar fact, never a debt. The write door now drops them
//     (lib/commitments/extraction-truth.ts `isAttendanceObligation`).
//   • SAME-MESSAGE AWAITING DUPLICATES — open awaiting commitments extracted from the very message an
//     open, visible inbox row stands on. These already FOLD AT READ (lib/home/dedupe-deck.ts
//     `isDupOfVisible`, the one dedupe the deck and the timeline share) — no write is needed for them
//     to leave the page; they are counted so the owner sees the class.
//
//   DRY RUN (default, zero AI, zero writes — every write refused by the guard): counts + ids, no titles.
//   --apply --yes   dismiss the ATTENDANCE rows only — a conditional flip (still open), resolved_reason
//                   'attendance_not_debt', a REVERSIBLE commitment_dismissed activity row (/api/restore
//                   reopens it). Same-message duplicates are never written (the read fold owns them).
//
//   npx tsx scripts/repair-w20-duplicates.ts [--user <uuid>] [--apply --yes]
//
// Default user: the owner's account (the walk that found the class). NO SILENT CAPS: listings page
// through fetchAllRows.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { isAttendanceObligation } from '../lib/commitments/extraction-truth';
import { isDupOfVisible, visibleObligationsFromItems } from '../lib/home/dedupe-deck';
import { guardClient } from './repair-unquoted-promises';

export const ATTENDANCE_REASON = 'attendance_not_debt';
const OWNER = '08fe4449-e5eb-431d-9156-02e9324e5903';

type Commit = { id: string; description: string | null; direction: string | null; status: string; source: string | null; source_id: string | null; thread_id: string | null };
type Inbox = { id: string; work_title: string | null; work_state: string | null; rule_type: string | null; type_override: string | null; status: string | null; source_id: string | null; source_meeting_transcript_id: string | null; subject: string | null; thread_id: string | null; from_address: string | null; from_alt: string | null };

async function main() {
  const argv = process.argv.slice(2);
  const val = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] ?? null : null);
  const APPLY = argv.includes('--apply'), YES = argv.includes('--yes');
  const USER = val('--user') ?? OWNER;
  if (APPLY && !YES) { console.log('--apply needs --yes (owner-gated write)'); process.exit(1); }

  const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const refused: string[] = [];
  const sb = APPLY ? raw : guardClient(raw, refused);

  const commits = await fetchAllRows<Commit>((from, to) => sb.from('commitments')
    .select('id, description, direction, status, source, source_id, thread_id')
    .eq('user_id', USER).in('status', ['open', 'suggested'])
    .order('id', { ascending: true }).range(from, to), { maxRows: 50_000 });

  const attendance = commits.filter((c) => isAttendanceObligation(c.description));

  // Same-message pairs: the visible inbox rows standing on the awaiting rows' own messages.
  const awaiting = commits.filter((c) => c.direction === 'awaiting' && c.source_id);
  const srcIds = [...new Set(awaiting.map((c) => c.source_id!))];
  const inbox: Inbox[] = [];
  for (let i = 0; i < srcIds.length; i += 100) {
    const { data, error } = await sb.from('inbox_items')
      .select('id, work_title, work_state, rule_type, type_override, status, source_id, source_meeting_transcript_id, subject:source_data->>subject, thread_id:source_data->>thread_id, from_address:source_data->>from_address, from_alt:source_data->>from')
      .eq('user_id', USER).eq('status', 'pending').in('source_id', srcIds.slice(i, i + 100));
    if (error) { console.log(`✗ inbox read: ${error.message}`); process.exit(1); }
    inbox.push(...((data ?? []) as unknown as Inbox[]));
  }
  const visible = visibleObligationsFromItems(inbox.map((r) => ({
    ...r, source_data: { subject: r.subject, thread_id: r.thread_id, from_address: r.from_address, from: r.from_alt },
  })));
  const sameMessage = awaiting.filter((c) => visible.some((v) => v.sourceId === c.source_id) && isDupOfVisible(c as never, visible));

  console.log(`user ${USER.slice(0, 8)} · open/suggested commitments scanned=${commits.length}`);
  console.log(`ATTENDANCE (calendar facts minted as debts): ${attendance.length}${attendance.length ? ` · ${attendance.map((c) => c.id).join(', ')}` : ''}`);
  console.log(`SAME-MESSAGE AWAITING DUPLICATES (fold at read; no write): ${sameMessage.length}${sameMessage.length ? ` · ${sameMessage.map((c) => c.id).join(', ')}` : ''}`);
  const both = attendance.filter((a) => sameMessage.some((s) => s.id === a.id)).length;
  if (both) console.log(`  (${both} row(s) are in both classes)`);

  if (!APPLY) {
    console.log(`DRY RUN — zero writes${refused.length ? ` (refused: ${refused.join(', ')})` : ''}. Pass --apply --yes to dismiss the attendance rows (reversible).`);
    return;
  }
  let dismissed = 0;
  const { logActivity } = await import('../lib/activity/log');
  for (const c of attendance) {
    const nowIso = new Date().toISOString();
    const { data, error } = await sb.from('commitments')
      .update({ status: 'dismissed', resolved_reason: ATTENDANCE_REASON, resolved_at: nowIso, updated_at: nowIso })
      .eq('id', c.id).eq('user_id', USER).eq('status', c.status).select('id');
    if (error) { console.log(`  ✗ ${c.id}: ${error.message}`); continue; }
    if (!data?.length) continue;
    dismissed++;
    // UNDOABLE: commitment_dismissed is a REVERSIBLE type — /api/restore reopens the row.
    await logActivity(raw, USER, {
      type: 'commitment_dismissed', title: `A meeting is a calendar event, not a task: ${c.description ?? ''}`,
      entityType: 'commitment', entityId: c.id,
      metadata: { reason: ATTENDANCE_REASON, auto: true, via: 'repair-w20-duplicates' },
    });
    await import('../lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(raw as never, USER, 'commitment', c.id)).catch(() => 0);
  }
  if (dismissed) await import('../lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(raw as never, USER)).catch(() => {});
  console.log(`dismissed=${dismissed} (reversible, resolved_reason '${ATTENDANCE_REASON}')`);
}

if (process.argv[1]?.endsWith('repair-w20-duplicates.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
