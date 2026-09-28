// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W20.C THE ONE ANCHOR (invariant 7 EVIDENCE SETTLES + invariant 14 TIME TRUTH; owner walk
// Sep 28: "You met on Sep 21 · Mark done" on an item about an Oct 12 call).
//
//   A · OUTCOME — the REAL machine (bookingFactsOf → bookedEventFor → gateBooked → deriveState) on the
//       owner-walk shape: born Sep 16, re-pointed to a Sep 27 message asking for an Oct 12 call, a
//       Sep 21 meeting with the counterparty → NOT looks done; a meeting after the anchor on/after the
//       asked date → looks done, scoped `held_meeting`.
//   B · OUTCOME — the settle door's looks-done writer passes the SAME gate (looksDoneScopeOf).
//   C · SOURCE — ONE anchor: every anchoring site in lib/work · lib/evidence · lib/room reads
//       `obligationAnchorOf`; the helper is a zero-import leaf; both machine booking paths gate.
//   D · SOURCE — "Keep open" records the held booking with its TRUE scope and time, never a
//       fabricated same_conversation.
//
// Zero AI, zero DB, zero network. Run: npx tsx scripts/smoke-obligation-anchor.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { obligationAnchorOf, statedMeetingDateOf, heldMeetingSettles } from '../lib/work/obligation-anchor';
import { bookedEventFor, type CalendarRowLike } from '../lib/work/scheduled';
import { bookingFactsOf, deriveState, gateBooked } from '../lib/work/machine';
import { looksDoneScopeOf, looksDoneEvidenceOf } from '../lib/evidence/looks-done';
import type { Evidence } from '../lib/evidence/match';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
};
const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const REPOINTED = {
  created_at: '2026-09-16T08:00:00Z',
  last_activity_at: '2026-09-27T09:00:00Z',
  work_title: 'Confirm implementation call',
  source_data: {
    from_address: 'sam@acme.test', from_name: 'Sam Lee', subject: 'Implementation', received_at: '2026-09-27T09:00:00Z',
    understanding: { role: 'addressed', relevance: 'reply', ask: 'Confirm the implementation call on Oct 12', deadline: '2026-10-12' },
  },
};
const ev = (id: string, start: string, end: string, attendees: unknown[] = [{ email: 'sam@acme.test' }]): CalendarRowLike =>
  ({ id, start_time: start, end_time: end, title: 'Acme sync', attendees, status: 'confirmed', timezone: 'UTC' });
const verdict = { work: 'reply' };
const stateAt = (nowISO: string, events: CalendarRowLike[], row = REPOINTED) => {
  const facts = bookingFactsOf('inbox', row, verdict)!;
  const booked = gateBooked(bookedEventFor(facts, events, nowISO), facts);
  return { facts, booked, st: deriveState({ open: true, verdict, judgedAt: null, prepared: [], liveAsk: false, sentStamp: false, booked, nowISO }) };
};

console.log('A · THE MACHINE READS THE CURRENT ASK');
{
  const { facts, booked, st } = stateAt('2026-10-01T12:00:00Z', [ev('sep21', '2026-09-21T10:00:00Z', '2026-09-21T10:30:00Z')]);
  ok('A1 the anchor is the CURRENT ask (the re-pointed Sep 27 message), not the Sep 16 birth', facts.afterISO === '2026-09-27T09:00:00Z', facts.afterISO);
  ok('A2 the ask names a future meeting date (Oct 12)', facts.meetingDate === '2026-10-12', facts.meetingDate);
  ok('A3 THE OWNER-WALK SHAPE: a Sep 21 meeting with the counterparty does NOT make the Oct 12 ask look done',
    booked?.held === null && st.state !== 'looks_done' && !st.heldEventId, { held: booked?.held, state: st.state });
  const old = bookedEventFor({ ...facts, afterISO: REPOINTED.created_at, meetingDate: null }, [ev('sep21', '2026-09-21T10:00:00Z', '2026-09-21T10:30:00Z')], '2026-10-01T12:00:00Z');
  ok('A4 (the regression) the pre-W20 birth anchor would have served it', old.held?.id === 'sep21');
}
{
  const { booked, st } = stateAt('2026-10-13T12:00:00Z', [ev('oct12', '2026-10-12T09:30:00Z', '2026-10-12T10:00:00Z')]);
  ok('A5 a meeting after the anchor ON the asked date looks done, scoped held_meeting, with its own start',
    st.state === 'looks_done' && st.heldEventId === 'oct12' && st.heldScope === 'held_meeting' && st.heldAt === '2026-10-12T09:30:00Z'
    && booked?.held?.scope === 'held_meeting' && /^You met on Oct 12$/.test(st.looksDoneLine ?? ''), st);
}
{
  const { st } = stateAt('2026-10-01T12:00:00Z', [ev('sep30', '2026-09-30T10:00:00Z', '2026-09-30T10:30:00Z')]);
  ok('A6 a meeting after the anchor but BEFORE the asked date does not', st.state !== 'looks_done', st.state);
  const { st: other } = stateAt('2026-10-13T12:00:00Z', [ev('oct12x', '2026-10-12T09:30:00Z', '2026-10-12T10:00:00Z', [{ email: 'someone@else.test' }])]);
  ok('A7 an Oct 12 meeting WITHOUT the counterparty does not', other.state !== 'looks_done', other.state);
  const byRow = { ...REPOINTED, source_data: { ...REPOINTED.source_data, understanding: { ...REPOINTED.source_data.understanding, ask: 'Book a call by Oct 2', deadline: '2026-10-02' } } };
  const { st: bound } = stateAt('2026-10-01T12:00:00Z', [ev('sep30', '2026-09-30T10:00:00Z', '2026-09-30T10:30:00Z')], byRow);
  ok('A8 a "by <date>" ask is a bound, not the meeting date — a meeting before it (after the anchor) still looks done', bound.state === 'looks_done', bound.state);
  ok('A9 the rule, pure: anchor bound · date bound (zone-graced) · no anchor bounds nothing',
    !heldMeetingSettles('2026-09-21T10:00:00Z', '2026-09-27T09:00:00Z', null) && heldMeetingSettles('2026-10-11T12:00:00Z', '2026-09-27T09:00:00Z', '2026-10-12')
    && !heldMeetingSettles('2026-10-11T08:00:00Z', '2026-09-27T09:00:00Z', '2026-10-12') && heldMeetingSettles('2026-09-01T00:00:00Z', null, null)
    && statedMeetingDateOf('2026-09-20', '2026-09-27T09:00:00Z', 'call on Sep 20') === null);
  ok('A10 the anchor: inbox = latest message clock (created_at only as the no-clock fallback); commitment = created_at',
    obligationAnchorOf('inbox', { ...REPOINTED, last_activity_at: '2026-09-20T00:00:00Z' }) === '2026-09-27T09:00:00Z'
    && obligationAnchorOf('inbox', { created_at: '2026-09-16T08:00:00Z', source_data: {} }) === '2026-09-16T08:00:00Z'
    && obligationAnchorOf('commitment', { created_at: '2026-09-16T08:00:00Z', last_activity_at: '2026-09-30T00:00:00Z' }) === '2026-09-16T08:00:00Z');
}

console.log('B · THE SETTLE DOOR PASSES THE SAME GATE');
{
  const held = (at: string, key: 'object' | 'person') => ({ type: 'calendar', id: `e-${at}`, at, title: 'Acme sync', key, status: 'held', deed: 'meeting_held', source: 'calendar' } as unknown as Evidence);
  const opts = { meetingShaped: true, anchorISO: '2026-09-27T09:00:00Z', meetingDate: '2026-10-12' };
  ok('B1 looksDoneScopeOf refuses a held meeting before the named date — on the person key AND on the object key',
    looksDoneScopeOf(held('2026-09-21T10:00:00Z', 'person'), opts) === null && looksDoneScopeOf(held('2026-09-21T10:00:00Z', 'object'), opts) === null);
  ok('B2 …and admits the asked-date meeting (held_meeting) · looksDoneEvidenceOf reads through it',
    looksDoneScopeOf(held('2026-10-12T09:30:00Z', 'person'), opts) === 'held_meeting'
    && looksDoneEvidenceOf([held('2026-09-21T10:00:00Z', 'person')], 'unclear', 'user', opts) === null
    && looksDoneEvidenceOf([held('2026-10-12T09:30:00Z', 'person')], 'unclear', 'user', opts)?.scope === 'held_meeting');
  const settle = src('lib/work/evidence-settle.ts');
  ok('B3 the one settle door hands noteLooksDone the anchor + the named meeting date',
    /anchorISO: work\.afterISO,\s*meetingDate: statedMeetingDateOf\(statedDate, work\.afterISO/.test(settle));
  const ld = src('lib/evidence/looks-done.ts');
  ok('B4 looksDoneEvidenceOf has no private scope rule — it maps looksDoneScopeOf; the held rule is heldMeetingSettles',
    /evidence\.map\(\(e\) => \(\{ e, scope: looksDoneScopeOf\(e, opts\) \}\)\)/.test(ld) && /if \(!heldMeetingSettles\(e\.at, opts\.anchorISO/.test(ld));
}

console.log('C · ONE ANCHOR, EVERY SITE');
{
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
  for (const d of ['lib/work', 'lib/evidence', 'lib/room']) walk(d);
  const PASS_THROUGH = /^(obligationAnchorOf\(|anchor\b|evAfterISO\b|w\.afterISO\b|work\.afterISO\b|''$)/;
  const offenders: string[] = [];
  let sites = 0;
  for (const f of files) {
    const lines = src(f).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const m of line.matchAll(/\b(?:ev)?[aA]fterISO\??\s*[:=]\s*([^,;}]+)/g)) {
        const rhs = m[1].trim();
        if (/^string\b/.test(rhs)) continue; // a type declaration
        sites++;
        if (!PASS_THROUGH.test(rhs)) offenders.push(`${f}:${i + 1} ${rhs.slice(0, 60)}`);
      }
    });
  }
  ok(`C1 every afterISO anchoring site (${sites}) reads obligationAnchorOf or passes it through`, offenders.length === 0 && sites >= 12, offenders);
  const direct = files.flatMap((f) => (src(f).match(/obligationAnchorOf\('(inbox|commitment)'/g) ?? []).map(() => f));
  const need = ['lib/work/machine.ts', 'lib/work/evidence-nominator.ts', 'lib/work/evidence-settle.ts', 'lib/work/evidence-sweep.ts', 'lib/work/judge.ts', 'lib/room/grounding.ts'];
  ok('C2 the machine, nominator, settle door, sweep, judge and the room grounding all anchor through the helper', need.every((n) => direct.includes(n)), need.filter((n) => !direct.includes(n)));
  const leaf = src('lib/work/obligation-anchor.ts');
  ok('C3 the helper is a pure, zero-import, client-safe leaf', !/^\s*import\s/m.test(leaf) && /export function obligationAnchorOf/.test(leaf));
  const machine = src('lib/work/machine.ts');
  ok('C4 BOTH machine booking paths (one item · the batch) pass the held booking through gateBooked → looksDoneScopeOf',
    (machine.match(/gateBooked\(bookedEventFor\(/g) ?? []).length === 2 && /const scope = looksDoneScopeOf\(/.test(machine));
  ok('C5 no birth-clock anchor survives in the booking facts (created_at ?? received_at)', !/created_at \?\? sd\.received_at/.test(machine));
  const sched = src('lib/work/scheduled.ts');
  ok('C6 the matcher bounds a held event by the shared rule (heldMeetingSettles), importing only the pure leaf',
    /heldMeetingSettles\(String\(ev\.start_time\), facts\.afterISO, facts\.meetingDate/.test(sched)
    && (sched.match(/^import .*$/gm) ?? []).every((l) => /from '\.\/obligation-anchor'/.test(l)));
}

console.log('D · "KEEP OPEN" IS TRUTHFUL');
{
  const ld = src('lib/evidence/looks-done.ts');
  const refuse = ld.slice(ld.indexOf('export async function refuseLooksDone'));
  ok('D1 the held-booking refusal records the scope the gate gave it (default held_meeting) — never a fabricated same_conversation',
    /scope: st\.heldScope \?\? 'held_meeting'/.test(refuse) && !/scope: 'same_conversation'/.test(refuse));
  ok('D2 …and the event\'s own start and title, not the click time', /at: st\.heldAt \?\? now/.test(refuse) && /title: st\.heldTitle \?\? ''/.test(refuse));
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
