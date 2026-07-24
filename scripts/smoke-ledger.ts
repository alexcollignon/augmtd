// THE LEDGER (Living-Home L1) — cross-user smoke. Read-only (skipReconcile). Asserts the ledger's
// invariants over REAL data, and prints each user's partitioned DAILY REPORT as plain text (the one line
// grammar) — the eye-test for "does this read like a chief-of-staff daily summary".
//   • enrichment: entity anchors resolve to real names; priority ∈ [0,100]; blockedOn only ever a real
//     counterparty on waiting items; triage only on fresh entities.
//   • partition: lanes disjoint + exhaustive over open items; done-today only resolved today; questions
//     all carry WHO; automated items never gain an overdue boost.
//   • determinism: two builds produce identical partitions.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildWorkItems, priorityOf } from '../lib/work-items/model';
import { partitionDailyReport, reportLine } from '../lib/work-items/report';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const todayStr = new Date().toISOString().slice(0, 10);

(async () => {
  const { data: ents } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative').limit(5000);
  const users = [...new Set((ents ?? []).map((e: any) => e.user_id as string))];

  // Pure priority unit checks (no data needed).
  check('priorityOf: overdue boost', priorityOf({ entityWeight: 50, explicit: '2000-01-01', state: 'todo', automated: false, todayStr }) === 90);
  check('priorityOf: automated never overdue-boosted', priorityOf({ entityWeight: 50, explicit: '2000-01-01', state: 'todo', automated: true, todayStr }) === 50);
  check('priorityOf: waiting dampened', priorityOf({ entityWeight: 50, explicit: null, state: 'waiting', automated: false, todayStr }) === 40);
  check('priorityOf: clamped to [0,100]', priorityOf({ entityWeight: 95, explicit: '2000-01-01', state: 'todo', automated: false, todayStr }) === 100);

  for (const uid of users) {
    const u = uid.slice(0, 8);
    const items = await buildWorkItems(sb, uid, { todayStr, includeCalendar: true, includeOutbound: false, skipReconcile: true });
    const rep = partitionDailyReport(items, todayStr);

    // ── invariants ──
    const linked = items.filter((w) => w.entity);
    check(`${u}: entity anchors resolve (linked=${linked.length}/${items.length})`, linked.every((w) => w.entity!.name.length > 0));
    check(`${u}: priority in [0,100]`, items.every((w) => w.priority >= 0 && w.priority <= 100));
    check(`${u}: blockedOn only on waiting + is the counterparty`, items.every((w) => !w.blockedOn || (w.state === 'waiting' && w.blockedOn === w.who)));
    const openIds = new Set(items.filter((w) => w.kind !== 'event' && w.state !== 'done' && w.state !== 'dismissed').map((w) => w.id));
    const laneIds = [...rep.needsYou, ...rep.openQuestions, ...rep.triage, ...rep.stale].map((w) => w.id);
    check(`${u}: lanes disjoint + exhaustive (open=${openIds.size})`, new Set(laneIds).size === laneIds.length && laneIds.length === openIds.size && laneIds.every((id) => openIds.has(id)));
    check(`${u}: done-today only resolved today`, rep.doneToday.every((w) => String(w.at).slice(0, 10) === todayStr));
    check(`${u}: questions all carry WHO`, rep.openQuestions.every((w) => !!w.blockedOn));
    check(`${u}: needsYou sorted by priority desc`, rep.needsYou.every((w, i) => i === 0 || rep.needsYou[i - 1].priority >= w.priority));
    // Gap fixes (L3-data): no self-block; ancient items fold into the stale tail, never lead.
    const { data: selfP } = await sb.from('profiles').select('email').eq('id', uid).maybeSingle();
    const selfEmail = String(selfP?.email || '').toLowerCase();
    check(`${u}: never blocked on yourself`, !selfEmail || items.every((w) => !w.blockedOn || !w.blockedOn.toLowerCase().includes(selfEmail)));
    const monthAgo = new Date(Date.parse(todayStr) - 31 * 86_400_000).toISOString().slice(0, 10);
    check(`${u}: month-old overdue never leads (stale=${rep.counts.stale})`, rep.needsYou.every((w) => !w.when.explicit || w.when.explicit >= monthAgo));
    // Determinism — a second build partitions identically.
    const rep2 = partitionDailyReport(await buildWorkItems(sb, uid, { todayStr, includeCalendar: true, includeOutbound: false, skipReconcile: true }), todayStr);
    check(`${u}: deterministic`, JSON.stringify(rep.counts) === JSON.stringify(rep2.counts) && rep2.needsYou.map((w) => w.id).join() === rep.needsYou.map((w) => w.id).join());

    // ── the EYE TEST — the report as plain text (one line grammar) ──
    console.log(`\n════ ${u} — DAILY REPORT (${todayStr}) ════`);
    if (rep.meetingsToday.length) console.log(`  Today's meetings (${rep.meetingsToday.length}): ${rep.meetingsToday.slice(0, 3).map((w) => w.title.slice(0, 40)).join(' · ')}${rep.meetingsToday.length > 3 ? ' · …' : ''}`);
    if (rep.doneToday.length) { console.log(`  Done today (${rep.counts.done}):`); rep.doneToday.slice(0, 5).forEach((w) => console.log(`    ✓ ${reportLine(w, todayStr)}${w.actor === 'team' ? '  [team]' : ''}`)); }
    console.log(`  Needs you (${rep.counts.open}${rep.counts.automatedOpen ? ` · ${rep.counts.automatedOpen} automated` : ''}):`);
    rep.needsYou.slice(0, 8).forEach((w) => console.log(`    • [P${w.priority}] ${reportLine(w, todayStr)}`));
    if (rep.needsYou.length > 8) console.log(`    … ${rep.needsYou.length - 8} more`);
    if (rep.openQuestions.length) { console.log(`  Open questions (${rep.counts.questions}):`); rep.openQuestions.slice(0, 5).forEach((w) => console.log(`    ? ${reportLine(w, todayStr)}`)); }
    if (rep.triage.length) { console.log(`  New & unsorted (${rep.counts.triage}):`); rep.triage.slice(0, 4).forEach((w) => console.log(`    ○ ${reportLine(w, todayStr)}`)); }
  }

  console.log('\n════ LEDGER GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
