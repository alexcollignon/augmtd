// ════════════════════════════════════════════════════════════════════════════════════════════════
// CENSUS — W20.C THE ONE ANCHOR: which OPEN items are served `looks_done` today from a HELD booked
// meeting (the machine's read-time rung, lib/work/machine.ts) that FAILS the new rules — a meeting
// before the CURRENT ask arose (lib/work/obligation-anchor `obligationAnchorOf`) or before the meeting
// date the ask names (`statedMeetingDateOf` → `heldMeetingSettles`), gated by the ONE relevance gate
// (`gateBooked` → lib/evidence/looks-done.ts `looksDoneScopeOf`).
//
// READ-ONLY: SELECTs only, ZERO writes, ZERO AI. The fix is read-time — nothing to backfill; this only
// reports how many rows the new rules take down. Prints a count + item ids (no names, no titles).
//
// Run: npx tsx scripts/census-held-booking.ts [--user <uuid>]   (default: the owner's account)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { readPlans } from '../lib/store/item-plans';
import { bookingFactsOf, gateBooked, sourcePartiesFor } from '../lib/work/machine';
import { bookedEventFor, meetingShaped, HELD_WINDOW_DAYS, type CalendarRowLike } from '../lib/work/scheduled';

const argv = process.argv.slice(2);
const val = (f: string): string | null => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const USER = val('--user') ?? '08fe4449-e5eb-431d-9156-02e9324e5903';
type Row = Record<string, unknown>;

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('census-held-booking: no Supabase env (.env.local) — nothing read.'); return; }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const nowISO = new Date().toISOString();
  const lo = new Date(Date.now() - (HELD_WINDOW_DAYS + 1) * 86_400_000).toISOString();

  const [items, commits, events, judgments, looks] = await Promise.all([
    fetchAllRows<Row>((from, to) => sb.from('inbox_items').select('id, status, source, source_data, created_at, last_activity_at, work_title')
      .eq('user_id', USER).eq('status', 'pending').order('id', { ascending: true }).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('commitments').select('id, status, description, counterparty, created_at, due_date, source, source_id')
      .eq('user_id', USER).in('status', ['pending', 'active', 'open']).order('id', { ascending: true }).range(from, to)),
    fetchAllRows<CalendarRowLike>((from, to) => sb.from('calendar_events').select('id, start_time, end_time, title, attendees, organizer, status, timezone, is_all_day')
      .eq('user_id', USER).gte('start_time', lo).lte('start_time', nowISO).order('start_time', { ascending: true }).order('id', { ascending: true }).range(from, to) as never),
    readPlans(sb as never, USER, 'judgment'),
    readPlans(sb as never, USER, 'looks_done'),
  ]);
  const verdictOf = new Map<string, { work?: string } | null>();
  for (const j of judgments) verdictOf.set(j.key, ((j.tasks ?? null) as { verdict?: { work?: string } } | null)?.verdict ?? null);
  const refusedOf = new Map<string, string[]>();
  for (const l of looks) refusedOf.set(l.key, ((l.tasks ?? null) as { refusedBookings?: string[] } | null)?.refusedBookings ?? []);
  const shapedCommits = commits.filter((c) => String(c.source ?? '') === 'email');
  const parties = shapedCommits.length ? await sourcePartiesFor(sb as never, USER, shapedCommits) : new Map<string, string[]>();

  const hits: Array<{ key: string; heldEventId: string; reason: string; refused: boolean }> = [];
  let oldHeld = 0;
  const rows: Array<{ kind: 'inbox' | 'commitment'; row: Row }> = [
    ...items.map((row) => ({ kind: 'inbox' as const, row })), ...commits.map((row) => ({ kind: 'commitment' as const, row })),
  ];
  for (const { kind, row } of rows) {
    const key = `${kind}:${String(row.id)}`;
    const v = (verdictOf.get(key) ?? null) as never;
    if ((v as { work?: string } | null)?.work === 'none') continue;
    const f = bookingFactsOf(kind, row as never, v, kind === 'commitment' ? parties.get(String(row.source_id ?? '')) ?? [] : []);
    if (!f) continue;
    // THE OLD READ (pre-W20.C): anchored on the row's birth, no stated-date bound, no gate.
    const sd = (row.source_data ?? {}) as { received_at?: unknown };
    const oldAfter = String(row.created_at ?? (kind === 'inbox' ? sd.received_at : '') ?? '') || null;
    const before = bookedEventFor({ ...f, afterISO: oldAfter, meetingDate: null }, events, nowISO);
    const refused = (refusedOf.get(key) ?? []).includes(before.held?.id ?? '');
    if (!before.held || before.upcoming) continue;
    if (!refused) oldHeld++;
    const after = gateBooked(bookedEventFor(f, events, nowISO), f);
    if (after?.held && after.held.id === before.held.id) continue;
    const s = before.held.start;
    const reason = f.afterISO && s < f.afterISO ? `held ${s.slice(0, 10)} before the anchor ${f.afterISO.slice(0, 10)}`
      : f.meetingDate ? `held ${s.slice(0, 10)} before the named date ${f.meetingDate}` : 'gate refused';
    hits.push({ key, heldEventId: before.held.id, reason, refused });
  }
  console.log(`census-held-booking (read-only, zero AI) · user ${USER.slice(0, 8)}…`);
  console.log(`  open items read: ${items.length} inbox · ${commits.length} commitments · ${events.length} past events in the held window`);
  console.log(`  meeting-shaped items with a counterparty: ${rows.filter(({ kind, row }) => bookingFactsOf(kind, row as never, (verdictOf.get(`${kind}:${String(row.id)}`) ?? null) as never) || meetingShaped(String(row.description ?? ''))).length}`);
  console.log(`  served looks_done from a held booking under the OLD read: ${oldHeld}`);
  const live = hits.filter((h) => !h.refused);
  console.log(`  of which FAIL the W20.C rules (taken down at read, no backfill): ${live.length}`);
  for (const h of live) console.log(`    ${h.key}  event ${h.heldEventId.slice(0, 8)}…  — ${h.reason}`);
  const kept = hits.filter((h) => h.refused);
  console.log(`  already down by the user's "Keep open" (and ALSO failing the new rules): ${kept.length}`);
  for (const h of kept) console.log(`    ${h.key}  event ${h.heldEventId.slice(0, 8)}…  — ${h.reason}`);
}

main().catch((e) => { console.error('census-held-booking failed:', e instanceof Error ? e.message : e); process.exit(1); });
