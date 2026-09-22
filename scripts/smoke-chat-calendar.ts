// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT-CALENDAR GATE (permanent, Sep 18 — the "you're free both weeks" incident).
//
// THE INCIDENT, census-verified on a pilot account: the Home chat was asked to check the calendar
// before replying and answered that two booked weeks were FREE — over twelve confirmed events,
// including a four-day all-day away block — then proposed three slots, two of them INSIDE that
// block, with all three weekday↔date pairs wrong ("Tuesday, September 24"; that date is a Thursday).
// Four root causes, four laws, one gate each:
//
//   G1/G2 THE OVERLAP LAW — a block already IN PROGRESS at the window's start is busy, and a
//         cancelled event never is. (`.gte('start_time', floor)` could not see the away block.)
//   G3    THE CLOCK — the chat lane ran dateless while every other lane carried the date; a dateless
//         model coin-flips every weekday it writes.
//   G4    A PROPOSAL IS PROVEN FREE — the picker proposes against the SAME busy set the block prints.
//   G5    WEEKDAYS ARE ARITHMETIC — code corrects the pairing the model invented, in the answer's
//         own language, and touches nothing it cannot fully parse.
//   G6    A VERB EXISTS AT EVERY REGISTRATION POINT (the seven-point lesson) and the prompt claims
//         only the reach it actually holds — a prompt that overstates its context is an instruction
//         to confabulate.
//   G7    THE VERB'S OUTPUT IS CODE'S — weekday labels, clock times and slots, never the model's.
//   G8    A DELIVERABLE URL IS A DOOR (the report-back linkifier).
//   G9    LIVE — the served answer on the probe host, over a fixture fortnight shaped like the
//         incident: the deterministic halves (weekday pairs, collision arithmetic) are HARD gates.
//   G10   NO BARE SHRUG — the exhaustion tail never returns "I couldn't finish that one." alone.
//
// Fixtures are idempotent (deleted by the 'SMKCAL' title prefix before AND after the run).
// Run: npx tsx --env-file=.env.local scripts/smoke-chat-calendar.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { getScheduleWindow, renderCalendarWindow, userTimezone, weekdayOf } from '../lib/calendar/schedule-window';
import { getTodaySchedule, renderScheduleBlock } from '../lib/calendar/today-schedule';
import { proposeFreeSlots, zonedTimeToUtc } from '../lib/prepare/free-slots';
import { enforceWeekdayDatePairs } from '../lib/utils/weekday-floor';
import { executeCheckCalendar, renderCalendarFreshness } from '../lib/tools/check-calendar';
import { planCalendarPrune, decidePruneBatch } from '../lib/calendar/sync-calendar';
import { linkifyReport } from '../lib/workflows/report-back';
import { converse } from '../lib/converse';
import { REACH_SENTINEL, needsReach, sayInsteadOfSentinel } from '../lib/converse/reach';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TZ = 'Europe/Lisbon';
const PREFIX = 'SMKCAL';
const DAY_MS = 86_400_000;
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const addDays = (dayStr: string, n: number) => new Date(Date.parse(`${dayStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** The suite's OWN weekday arithmetic — never the module under test's (a gate that reuses the
 *  implementation's helper proves only that the helper agrees with itself). */
const trueWeekday = (dayStr: string) => EN_DAYS[new Date(`${dayStr}T12:00:00Z`).getUTCDay()];
const dayIn = (ms: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
// NB the short month can be THREE OR FOUR letters ("25 Sept") depending on the runtime's ICU — the
// suite reads the label the same way the renderer writes it, never by a hand-rolled abbreviation.
const shortLabel = (dayStr: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${dayStr}T12:00:00Z`));
/** The first three letters of a day's short month — the one comparison a free-text parse can trust. */
const monthKey = (dayStr: string) => shortLabel(dayStr).split(' ')[1].slice(0, 3).toLowerCase();

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const uid = await resolveProbeUser(sb);

  // ── THE FIXTURE FORTNIGHT, shaped after the incident ───────────────────────────────────────────
  const today = dayIn(Date.now(), TZ);
  // The first Monday at least three days out, so nothing in the fixture is already in the past.
  let MON = addDays(today, 3);
  for (let i = 0; i < 7 && new Date(`${MON}T12:00:00Z`).getUTCDay() !== 1; i++) MON = addDays(MON, 1);
  const D = (n: number) => addDays(MON, n);

  const BLOCK_TITLE = `${PREFIX} — Acme offsite (away)`;
  const E1_TITLE = `${PREFIX} — Acme review`;
  const E2_TITLE = `${PREFIX} — Sam sync`;
  const CANCELLED_TITLE = `${PREFIX} — cancelled slot`;
  // THE FAR DAY (section R) — a business day ~35 days out, FAR beyond the 14-day snapshot window the
  // toolless question path is handed. Answering it truthfully is impossible from context alone: the
  // lane must REACH. Its title carries a distinctive token nothing else in the account says.
  let FAR = addDays(today, 35);
  for (let i = 0; i < 7 && ![1, 2, 3, 4, 5].includes(new Date(`${FAR}T12:00:00Z`).getUTCDay()); i++) FAR = addDays(FAR, 1);
  const FAR_TOKEN = 'Northwind';
  const FAR_TITLE = `${PREFIX} — ${FAR_TOKEN} board review`;

  // ── THE ALL-DAY FIXTURES (G11, Sep 21) ────────────────────────────────────────────────────────
  // Parked ~90 days beyond the far day so they sit outside every other window this suite reads.
  // An all-day row is stored the way the providers write one: a MIDNIGHT with an EXCLUSIVE end.
  const AD_PREFIX = `${PREFIX} — allday`;
  const A0 = addDays(FAR, 90);
  const AD_MULTI_TITLE = `${AD_PREFIX} multi`;
  const AD_SINGLE_TITLE = `${AD_PREFIX} single`;
  const AD_NIGHT_TITLE = `${PREFIX} — overnight`;
  const AD_DST_TITLE = `${AD_PREFIX} dst`;
  /** The zone's own UTC offset on a given day — the suite computes it itself, never from the module. */
  const offsetOn = (dayStr: string) => zonedTimeToUtc(dayStr, '12:00', TZ) - Date.parse(`${dayStr}T12:00:00Z`);
  /** The first clock change at or after the all-day fixtures — a real DST boundary to span. */
  let DST_DAY: string | null = null;
  for (let i = 1; i < 300 && !DST_DAY; i++) {
    const d = addDays(A0, 12 + i);
    if (offsetOn(d) !== offsetOn(addDays(d, -1))) DST_DAY = d;
  }

  const rows = [
    // (b) THE FOUR-DAY ALL-DAY BLOCK — the shape that produced two of the three bad slots: its
    // start_time predates the window the gate queries, so only an overlap read can see it.
    { event_id: `${PREFIX}-block`, title: BLOCK_TITLE, is_all_day: true, status: 'confirmed',
      start_time: new Date(zonedTimeToUtc(D(0), '00:00', TZ)).toISOString(),
      end_time: new Date(zonedTimeToUtc(D(4), '00:00', TZ)).toISOString() },
    // (d) a timed event 09:00–11:00 on a later day, and (a) its companion the day after.
    { event_id: `${PREFIX}-e1`, title: E1_TITLE, is_all_day: false, status: 'confirmed',
      start_time: new Date(zonedTimeToUtc(D(7), '09:00', TZ)).toISOString(),
      end_time: new Date(zonedTimeToUtc(D(7), '11:00', TZ)).toISOString() },
    { event_id: `${PREFIX}-e2`, title: E2_TITLE, is_all_day: false, status: 'confirmed',
      start_time: new Date(zonedTimeToUtc(D(8), '14:00', TZ)).toISOString(),
      end_time: new Date(zonedTimeToUtc(D(8), '15:00', TZ)).toISOString() },
    // (c) A CANCELLED EVENT on an otherwise-free day — it must block nothing and appear nowhere.
    { event_id: `${PREFIX}-cancel`, title: CANCELLED_TITLE, is_all_day: false, status: 'cancelled',
      start_time: new Date(zonedTimeToUtc(D(9), '10:00', TZ)).toISOString(),
      end_time: new Date(zonedTimeToUtc(D(9), '11:00', TZ)).toISOString() },
    // (e) THE FAR EVENT — beyond every window this suite's non-live gates query; section R only.
    { event_id: `${PREFIX}-far`, title: FAR_TITLE, is_all_day: false, status: 'confirmed',
      start_time: new Date(zonedTimeToUtc(FAR, '10:00', TZ)).toISOString(),
      end_time: new Date(zonedTimeToUtc(FAR, '12:00', TZ)).toISOString() },
  ].map((r) => ({ ...r, user_id: uid, calendar_id: 'primary', provider: 'gmail', timezone: TZ }))
    .concat([
      // (f) THE FOUR-DAY ALL-DAY BLOCK IN PROVIDER SHAPE — UTC midnights, end EXCLUSIVE. Read as an
      // instant this lands a day early west of UTC and a day late east of it; read as calendar days
      // it cannot move at all. Kept to THREE UTC-zoned rows so the fixture's home zone stays Lisbon.
      { event_id: `${PREFIX}-ad-multi`, title: AD_MULTI_TITLE, is_all_day: true, status: 'confirmed',
        start_time: `${A0}T00:00:00.000Z`, end_time: `${addDays(A0, 4)}T00:00:00.000Z`,
        user_id: uid, calendar_id: 'primary', provider: 'gmail', timezone: 'UTC' },
      { event_id: `${PREFIX}-ad-single`, title: AD_SINGLE_TITLE, is_all_day: true, status: 'confirmed',
        start_time: `${addDays(A0, 6)}T00:00:00.000Z`, end_time: `${addDays(A0, 7)}T00:00:00.000Z`,
        user_id: uid, calendar_id: 'primary', provider: 'gmail', timezone: 'UTC' },
      // (g) A TIMED EVENT ACROSS MIDNIGHT — busy on both of its days, by the overlap law.
      { event_id: `${PREFIX}-ad-night`, title: AD_NIGHT_TITLE, is_all_day: false, status: 'confirmed',
        start_time: new Date(zonedTimeToUtc(addDays(A0, 8), '22:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc(addDays(A0, 9), '02:00', TZ)).toISOString(),
        user_id: uid, calendar_id: 'primary', provider: 'gmail', timezone: TZ },
      // (h) AN ALL-DAY BLOCK ACROSS A REAL DST BOUNDARY — the hour that moves must move no days.
      ...(DST_DAY ? [{
        event_id: `${PREFIX}-ad-dst`, title: AD_DST_TITLE, is_all_day: true, status: 'confirmed',
        start_time: `${addDays(DST_DAY, -1)}T00:00:00.000Z`, end_time: `${addDays(DST_DAY, 2)}T00:00:00.000Z`,
        user_id: uid, calendar_id: 'primary', provider: 'gmail', timezone: 'UTC',
      }] : []),
    ]);

  // ── THE MEETINGS FEATURE IS PART OF THE FIXTURE (found live by the R3 gate) ────────────────────
  // check_calendar is gated behind the `meetings` feature at EVERY lane (TOOL_FEATURE) — and the probe
  // user belongs to NO workspace, so `getWorkspaceFeatures` fell back to DEFAULT_FEATURES, where
  // meetings is false. The agent loop therefore had no calendar verb to reach WITH: the valve opened,
  // the escalation arrived tool-less, and the answer confessed a second time. The gate was right; the
  // HOST was unconfigured. So the workspace is fixture too — provisioned with meetings on, torn down
  // in the finally (idempotent: any leftover probe workspace from a killed run is swept first).
  // ⚠️ If the probe ever gains a REAL workspace, this leaves it completely alone and only flips the
  // flag, restoring the original map on the way out.
  const WS_NAME = `${PREFIX} probe workspace`;
  const sweepProbeWorkspace = async () => {
    const { data: stale } = await sb.from('companies').select('id').eq('name', WS_NAME);
    for (const c of (stale ?? []) as { id: string }[]) {
      await sb.from('company_members').delete().eq('company_id', c.id);
      await sb.from('companies').delete().eq('id', c.id);
    }
  };
  const { data: memberRow } = await sb.from('company_members').select('company_id').eq('user_id', uid).eq('status', 'active').maybeSingle();
  let ownedCompanyId: string | null = null;              // ours to delete
  let borrowedCompanyId: string | null = null;           // theirs — only the flag is touched
  let originalFeatures: Record<string, unknown> | null = null;
  if ((memberRow as { company_id?: string } | null)?.company_id) {
    borrowedCompanyId = (memberRow as { company_id: string }).company_id;
    const { data: companyRow } = await sb.from('companies').select('features').eq('id', borrowedCompanyId).maybeSingle();
    originalFeatures = ((companyRow as { features?: Record<string, unknown> } | null)?.features ?? null);
    if (originalFeatures && originalFeatures.meetings !== true) {
      await sb.from('companies').update({ features: { ...originalFeatures, meetings: true } }).eq('id', borrowedCompanyId);
    }
  } else {
    await sweepProbeWorkspace();
    const { data: made } = await sb.from('companies').insert({
      name: WS_NAME, slug: `smkcal-probe-${Date.now()}`, join_code: `SMKCAL${Date.now()}`.slice(0, 16),
      features: { email: true, meetings: true, drive: true, agents: true, studio: true, home: true },
    }).select('id').maybeSingle();
    ownedCompanyId = (made as { id?: string } | null)?.id ?? null;
    if (ownedCompanyId) await sb.from('company_members').insert({ company_id: ownedCompanyId, user_id: uid, role: 'owner', status: 'active' });
  }
  const restoreWorkspace = async () => {
    if (borrowedCompanyId && originalFeatures) await sb.from('companies').update({ features: originalFeatures }).eq('id', borrowedCompanyId);
    if (ownedCompanyId) {
      await sb.from('company_members').delete().eq('company_id', ownedCompanyId);
      await sb.from('companies').delete().eq('id', ownedCompanyId);
    }
  };

  const wipe = () => sb.from('calendar_events').delete().eq('user_id', uid).like('title', `${PREFIX}%`);
  await wipe();
  const { error: seedErr } = await sb.from('calendar_events').insert(rows);
  if (seedErr) throw new Error(`fixture seed failed: ${seedErr.message}`);

  // The window under test STARTS INSIDE the block (its second day) — the in-progress shape.
  const FROM = D(1), TO = D(11);
  const BUSY_DAYS = new Set([D(1), D(2), D(3), D(7), D(8)]);
  const FREE_BUSINESS_DAYS = [D(4), D(10), D(11)];
  /** The fixture's busy truth in raw ms — the cancelled row is deliberately absent. */
  const FIXTURE_BUSY = [
    { s: zonedTimeToUtc(D(0), '00:00', TZ), e: zonedTimeToUtc(D(4), '00:00', TZ) },
    { s: zonedTimeToUtc(D(7), '09:00', TZ), e: zonedTimeToUtc(D(7), '11:00', TZ) },
    { s: zonedTimeToUtc(D(8), '14:00', TZ), e: zonedTimeToUtc(D(8), '15:00', TZ) },
  ];
  const collides = (startMs: number, endMs: number) => FIXTURE_BUSY.some((b) => b.s < endMs && b.e > startMs);

  try {
    console.log(`\nFIXTURE — probe ${uid}, ${TZ}, block ${D(0)}→${D(3)}, window ${FROM}→${TO}, far day ${FAR} (${trueWeekday(FAR)})`);

    // ── G1 — WINDOW TRUTH ────────────────────────────────────────────────────────────────────────
    console.log('\nG1 — WINDOW TRUTH (the overlap law: an in-progress block is busy; a cancelled one never is):');
    const tz = await userTimezone(sb, uid);
    ok('the fixture zone is derived from the events themselves', tz === TZ, tz);
    const win = await getScheduleWindow(sb, uid, { fromDayStr: FROM, toDayStr: TO, tz });
    ok('the window covers exactly the asked days', win.days.length === 11 && win.days[0].dayStr === FROM && win.days[10].dayStr === TO,
      `${win.days.length} days ${win.days[0]?.dayStr}→${win.days[win.days.length - 1]?.dayStr}`);
    const blockDays = win.days.filter((d) => d.busy.some((b) => b.title.startsWith(PREFIX) && b.title.includes('offsite')));
    ok('THE IN-PROGRESS BLOCK is seen on every in-window day it covers (its start predates the window)',
      blockDays.length === 3 && blockDays.every((d) => [D(1), D(2), D(3)].includes(d.dayStr)),
      blockDays.map((d) => d.dayStr).join(','));
    ok('…and it is marked allDay on each of them',
      blockDays.every((d) => d.busy.some((b) => b.allDay && b.title.includes('offsite'))), '');
    ok('…and it does NOT leak into the day after it ends',
      !win.days.find((d) => d.dayStr === D(4))?.busy.length, '');
    ok('A CANCELLED EVENT APPEARS NOWHERE', !win.days.some((d) => d.busy.some((b) => b.title.includes('cancelled'))), '');
    ok('the 09:00–11:00 event lands on its own day at its own clock times',
      win.days.find((d) => d.dayStr === D(7))?.busy.some((b) => b.start === '09:00' && b.end === '11:00' && !b.allDay) === true, '');
    ok('EVERY weekday label verifies against an independent recompute',
      win.days.every((d) => d.weekday === trueWeekday(d.dayStr)),
      win.days.filter((d) => d.weekday !== trueWeekday(d.dayStr)).map((d) => `${d.dayStr}:${d.weekday}`).join(','));
    ok('busy days are exactly the fixture\'s busy days (nothing invented, nothing dropped)',
      win.days.every((d) => (d.busy.length > 0) === BUSY_DAYS.has(d.dayStr)),
      win.days.filter((d) => (d.busy.length > 0) !== BUSY_DAYS.has(d.dayStr)).map((d) => d.dayStr).join(','));

    // ── G2 — RENDER TRUTH ────────────────────────────────────────────────────────────────────────
    console.log('\nG2 — RENDER TRUTH (the block states its own reach; a silent edge reads as "free forever"):');
    const rendered = renderCalendarWindow(win, { tz });
    const header = rendered.split('\n')[0];
    ok('the header names the EXACT reach, both ends, weekday included',
      header.includes(`${trueWeekday(FROM)} ${shortLabel(FROM)}`) && header.includes(`${trueWeekday(TO)} ${shortLabel(TO)}`), header.slice(0, 140));
    ok('…and declares the EDGE (beyond the window the calendar is not visible)',
      /BEYOND THIS WINDOW THE CALENDAR IS NOT VISIBLE/i.test(header), '');
    ok('…and the zone the clock times are in', header.includes(TZ), '');
    const lineFor = (dayStr: string) => rendered.split('\n').find((l) => l.startsWith(`${trueWeekday(dayStr).slice(0, 3)} ${shortLabel(dayStr)} `)) ?? '';
    ok('the in-progress block\'s days read BUSY all day', [D(1), D(2), D(3)].every((d) => /BUSY all day \(/.test(lineFor(d))),
      [D(1), D(2), D(3)].map(lineFor).join(' | '));
    ok('the 09:00–11:00 day prints its real clock window', lineFor(D(7)).includes('09:00–11:00'), lineFor(D(7)));
    ok('THE CANCELLED DAY IS FREE', lineFor(D(9)).endsWith('— free'), lineFor(D(9)));
    ok('every genuinely free day says exactly "free", and no busy day does',
      win.days.every((d) => lineFor(d.dayStr).endsWith('— free') === (d.busy.length === 0)),
      win.days.filter((d) => lineFor(d.dayStr).endsWith('— free') !== (d.busy.length === 0)).map((d) => d.dayStr).join(','));

    // ── G3 — THE CLOCK ───────────────────────────────────────────────────────────────────────────
    console.log('\nG3 — THE CLOCK (the chat lane ran dateless; a dateless model coin-flips every weekday):');
    const sched = await getTodaySchedule(sb, uid);
    const first = renderScheduleBlock(sched).split('\n')[0];
    const todayNum = Number(today.slice(8, 10));
    const todayMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`));
    ok('the first line states TODAY with the correct weekday (recomputed independently)',
      first.startsWith('TODAY is ') && first.includes(trueWeekday(today)), first.slice(0, 120));
    ok('…and the correct DATE in the user\'s zone', first.includes(`${todayNum} ${todayMonth} ${today.slice(0, 4)}`), first.slice(0, 120));
    ok('…and the NOW anchor (earlier events already happened)', /IT IS NOW \d{2}:\d{2}/.test(first), first.slice(0, 120));

    // ── G4 — FREE SLOTS ──────────────────────────────────────────────────────────────────────────
    console.log('\nG4 — FREE SLOTS (a proposal we cannot prove is free is never offered):');
    const slots = await proposeFreeSlots(sb, uid, { tz, todayStr: today, fromDayStr: FROM, toDayStr: TO, count: 15, minutes: 30 });
    ok('the picker proposes something at all inside the fixture fortnight', slots.length >= 1, `${slots.length}`);
    const clashing = slots.filter((s) => collides(Date.parse(s.startISO), Date.parse(s.endISO)));
    ok('ZERO proposals intersect a fixture busy block (the two-slots-inside-the-away-block incident)',
      clashing.length === 0, clashing.map((s) => s.startISO).join(','));
    const slotDays = slots.map((s) => dayIn(Date.parse(s.startISO), tz));
    ok('at least one proposal lands on a genuinely free business day',
      slotDays.some((d) => FREE_BUSINESS_DAYS.includes(d)), slotDays.join(','));
    ok('THE CANCELLED EVENT\'S OWN HOUR IS PROPOSABLE (a declined meeting is not a booking)',
      slots.some((s) => dayIn(Date.parse(s.startISO), tz) === D(9)
        && new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(s.startISO)) === '10:00'),
      slotDays.join(','));
    ok('nothing is proposed on the all-day block\'s days', !slotDays.some((d) => [D(0), D(1), D(2), D(3)].includes(d)), slotDays.join(','));

    // ── G5 — THE WEEKDAY FLOOR ───────────────────────────────────────────────────────────────────
    console.log('\nG5 — THE WEEKDAY FLOOR (the date is the anchor, the weekday the derived fact):');
    const NOW = new Date('2026-09-18T12:00:00Z');     // a Friday; 24 September 2026 is a Thursday
    const wf = (t: string) => enforceWeekdayDatePairs(t, { now: NOW });
    ok('THE INCIDENT\'S OWN SENTENCE is corrected',
      wf('How about Tuesday, September 24 at 10:00?') === 'How about Thursday, September 24 at 10:00?', wf('How about Tuesday, September 24 at 10:00?'));
    ok('a CORRECT pair is left untouched', wf('Let\'s say Friday, 18 September.') === 'Let\'s say Friday, 18 September.', wf('Let\'s say Friday, 18 September.'));
    ok('a PORTUGUESE weekday is corrected IN PORTUGUESE (the floor fixes a fact, never translates)',
      wf('Marquei para terça-feira, 24 September, às 10:00.') === 'Marquei para quinta-feira, 24 September, às 10:00.',
      wf('Marquei para terça-feira, 24 September, às 10:00.'));
    ok('an UNSTATED YEAR rolls forward when the current-year reading already went by',
      wf('Sunday, 1 February works') === 'Monday, 1 February works', wf('Sunday, 1 February works'));
    ok('an IMPOSSIBLE date is not a parsed pair — untouched', wf('Tuesday, 31 September') === 'Tuesday, 31 September', wf('Tuesday, 31 September'));
    ok('a bare weekday with no date is untouched', wf('See you Tuesday, around 10:00.') === 'See you Tuesday, around 10:00.', wf('See you Tuesday, around 10:00.'));
    ok('TWO wrong pairs in one answer are both corrected',
      wf('Either Tuesday, September 24 or Wednesday, September 25.') === 'Either Thursday, September 24 or Friday, September 25.',
      wf('Either Tuesday, September 24 or Wednesday, September 25.'));
    ok('IDEMPOTENT — applying the floor twice equals applying it once',
      wf(wf('How about Tuesday, September 24?')) === wf('How about Tuesday, September 24?'), '');
    ok('a stated year is honoured, not second-guessed',
      wf('Monday, 24 September 2026') === 'Thursday, 24 September 2026', wf('Monday, 24 September 2026'));

    // ── G5b — THE ANCHOR LAW ─────────────────────────────────────────────────────────────────────
    // Sep 21, a live pilot: the user asked for "either thursday or friday"; the model miscounted and
    // wrote "Thursday 25 or Friday 26"; the floor, holding the DATE sacred, rewrote the weekdays to
    // "Friday 25 or Saturday 26" and offered a client a Saturday. The precedence chain is the law:
    // the user's stated weekday outranks the model's derived date; failing that the date anchors;
    // failing that nothing is touched.
    console.log('\nG5b — THE ANCHOR LAW (a weekday the USER stated outranks a date the MODEL derived):');
    // A Monday, so the fixture sentences below read exactly like the incident's week.
    const NOW2 = new Date('2026-09-21T12:00:00Z');
    const ASK = 'answer based on when I am free. Either thursday or friday would be good';
    const wa = (t: string, userText?: string) => enforceWeekdayDatePairs(t, { now: NOW2, userText });
    ok('(a) THE INCIDENT — the user\'s weekdays stand and the DATES move back one',
      wa('Thursday 25 or Friday 26', ASK) === 'Thursday 24 or Friday 25', wa('Thursday 25 or Friday 26', ASK));
    ok('(a) …the same with the month stated once at the end',
      wa('Thursday 25 and Friday 26 September', ASK) === 'Thursday 24 and Friday 25 September',
      wa('Thursday 25 and Friday 26 September', ASK));
    ok('(a) an off-by-MINUS-one moves forward just as readily',
      wa('Thursday 23 September works', ASK) === 'Thursday 24 September works', wa('Thursday 23 September works', ASK));
    ok('(b) THE OLD LAW SURVIVES — the user said nothing, so the date anchors and the weekday moves',
      wa('How about Tuesday, September 24 at 10:00?') === 'How about Thursday, September 24 at 10:00?',
      wa('How about Tuesday, September 24 at 10:00?'));
    ok('(b) …and a weekday the user never mentioned is still corrected against the date',
      wa('Wednesday, 24 September', ASK) === 'Thursday, 24 September', wa('Wednesday, 24 September', ASK));
    ok('(c) THE USER STATED BOTH AND THEY DISAGREE — untouched; the contradiction is theirs to resolve',
      wa('meet Thursday 25 September', 'thursday the 25th works for me') === 'meet Thursday 25 September',
      wa('meet Thursday 25 September', 'thursday the 25th works for me'));
    ok('(d) a PORTUGUESE stated weekday moves the date, in Portuguese prose',
      wa('Marquei para quinta-feira, 25 September.', 'quinta-feira ou sexta-feira') === 'Marquei para quinta-feira, 24 September.',
      wa('Marquei para quinta-feira, 25 September.', 'quinta-feira ou sexta-feira'));
    ok('(d) …and a GERMAN one',
      wa('Donnerstag, 25 September', 'Donnerstag oder Freitag passt') === 'Donnerstag, 24 September',
      wa('Donnerstag, 25 September', 'Donnerstag oder Freitag passt'));
    ok('(d) …and a FRENCH one',
      wa('jeudi 25 September', 'jeudi ou vendredi') === 'jeudi 24 September', wa('jeudi 25 September', 'jeudi ou vendredi'));
    ok('(e) THE MONTHLESS SHAPE parses only when the prose reads like a date…',
      wa('Thursday 25', ASK) === 'Thursday 24', wa('Thursday 25', ASK));
    ok('(e) …and NEVER when the number is plainly not one ("Friday 15 people attended")',
      wa('Friday 15 people attended', ASK) === 'Friday 15 people attended', wa('Friday 15 people attended', ASK));
    ok('(e) …nor when the number could be a clock hour ("Monday 10 works")',
      wa('Monday 10 works', ASK) === 'Monday 10 works', wa('Monday 10 works', ASK));
    ok('(f) A MONTHLESS number too far out is AMBIGUOUS between two months — untouched',
      wa('Thursday 20', ASK) === 'Thursday 20', wa('Thursday 20', ASK));
    ok('(f) …and a monthless correction that would cross a month boundary is refused (a bare number cannot change months)',
      enforceWeekdayDatePairs('Friday 31', { now: new Date('2026-12-28T12:00:00Z'), userText: 'friday please' }) === 'Friday 31',
      enforceWeekdayDatePairs('Friday 31', { now: new Date('2026-12-28T12:00:00Z'), userText: 'friday please' }));
    ok('(g) YEAR ROLLOVER — a late-December correction into the previous month is written in full',
      enforceWeekdayDatePairs('Thursday, 1 January', { now: new Date('2026-12-28T12:00:00Z'), userText: 'thursday works' })
        === 'Thursday, 31 December',
      enforceWeekdayDatePairs('Thursday, 1 January', { now: new Date('2026-12-28T12:00:00Z'), userText: 'thursday works' }));
    ok('(g) …and a STATED year the correction would have to cross is never rewritten — untouched',
      wa('Thursday, 1 January 2027', 'thursday works') === 'Thursday, 1 January 2027', wa('Thursday, 1 January 2027', 'thursday works'));
    ok('(h) an ALREADY-TRUE pair is never touched, with or without the user\'s words',
      wa('Friday, 25 September', ASK) === 'Friday, 25 September' && wa('Friday, 25 September') === 'Friday, 25 September', '');
    ok('(i) text with no digits passes straight through',
      wa('Thursday or Friday both work for me.', ASK) === 'Thursday or Friday both work for me.', '');
    ok('IDEMPOTENT under the anchor law too', wa(wa('Thursday 25 or Friday 26', ASK), ASK) === wa('Thursday 25 or Friday 26', ASK), '');

    // ── G11 — THE ALL-DAY LAW ────────────────────────────────────────────────────────────────────
    // An all-day event is CALENDAR DAYS with an EXCLUSIVE end, not an instant. Read as an instant,
    // its midnight lands on the previous local day west of UTC and bleeds an hour into the next day
    // east of it — the same away block reported a day early in one zone and a day late in another.
    console.log('\nG11 — THE ALL-DAY LAW (days, not instants; the end is exclusive; the viewer\'s zone cannot move it):');
    const adWin = (zone: string, from: string, to: string) => getScheduleWindow(sb, uid, { fromDayStr: from, toDayStr: to, tz: zone });
    const busyDaysOf = (w: Awaited<ReturnType<typeof getScheduleWindow>>, title: string) =>
      w.days.filter((d) => d.busy.some((b) => b.title.startsWith(title))).map((d) => d.dayStr);
    for (const zone of ['America/New_York', 'Pacific/Auckland', TZ]) {
      const w = await adWin(zone, addDays(A0, -2), addDays(A0, 10));
      ok(`a FOUR-DAY all-day block covers exactly its four days in ${zone} (end exclusive, no drift)`,
        busyDaysOf(w, AD_MULTI_TITLE).join(',') === [A0, addDays(A0, 1), addDays(A0, 2), addDays(A0, 3)].join(','),
        busyDaysOf(w, AD_MULTI_TITLE).join(','));
      ok(`…and a ONE-DAY all-day block covers exactly one day in ${zone}`,
        busyDaysOf(w, AD_SINGLE_TITLE).join(',') === addDays(A0, 6), busyDaysOf(w, AD_SINGLE_TITLE).join(','));
      ok(`…and both read as "all day", never as a clock range, in ${zone}`,
        w.days.every((d) => d.busy.filter((b) => b.title.startsWith(AD_PREFIX)).every((b) => b.allDay === true)), '');
    }
    const overnightWin = await adWin(TZ, addDays(A0, 7), addDays(A0, 10));
    ok('a TIMED event spanning midnight is busy on BOTH of its days (the overlap law, unchanged)',
      busyDaysOf(overnightWin, AD_NIGHT_TITLE).join(',') === [addDays(A0, 8), addDays(A0, 9)].join(','),
      busyDaysOf(overnightWin, AD_NIGHT_TITLE).join(','));
    if (DST_DAY) {
      const dstWin = await adWin(TZ, addDays(DST_DAY, -3), addDays(DST_DAY, 3));
      ok('an all-day block ACROSS A DST BOUNDARY still covers exactly the days it names',
        busyDaysOf(dstWin, AD_DST_TITLE).join(',') === [addDays(DST_DAY, -1), DST_DAY, addDays(DST_DAY, 1)].join(','),
        busyDaysOf(dstWin, AD_DST_TITLE).join(','));
    } else {
      ok('a DST boundary was found in the horizon to test against', false, 'no offset change found — the fixture cannot prove the DST case');
    }

    // ── G12 — THE DEPARTURE LAW ──────────────────────────────────────────────────────────────────
    // A deleted event stayed in calendar_events forever: neither provider reports a deletion in a
    // windowed list, and the sync was upsert-only. Absence IS the news — but only a COMPLETE fetch
    // may be read as absence, so the decision is a pure function that refuses by default.
    console.log('\nG12 — THE DEPARTURE LAW (a deletion is news; a partial pull never mass-deletes):');
    const W1 = '2026-09-01T00:00:00.000Z', W2 = '2026-09-30T00:00:00.000Z';
    const PNOW = '2026-09-10T00:00:00.000Z';
    const full = planCalendarPrune({ complete: true, fetchedEventIds: ['a', 'b'], windowStartISO: W1, windowEndISO: W2, nowISO: PNOW });
    ok('a COMPLETE fetch licenses a prune, keeping exactly what came back',
      full.prune && full.keep.has('a') && full.keep.has('b') && full.keep.size === 2, JSON.stringify(full));
    ok('…and it is scoped to the window that was actually fetched',
      full.prune && full.windowStartISO === W1 && full.windowEndISO === W2, '');
    ok('a TRUNCATED fetch prunes NOTHING, and says why',
      planCalendarPrune({ complete: false, fetchedEventIds: ['a'], windowStartISO: W1, windowEndISO: W2, nowISO: PNOW }).prune === false, '');
    // ⚠️ RE-POINTED Sep 21 (review). This gate used to read an empty COMPLETE fetch as "an empty
    // diary is a fact" and assert prune===true. It is indistinguishable from a degraded read (auth
    // expiry, a mis-resolved calendar id, a provider hiccup) — and the wrong reading deletes the
    // whole window. The law is now the stricter one; the gate follows it, never the other way.
    ok('a COMPLETE fetch returning ZERO events prunes NOTHING (a degraded read looks exactly like this)',
      planCalendarPrune({ complete: true, fetchedEventIds: [], windowStartISO: W1, windowEndISO: W2, nowISO: PNOW }).prune === false, '');
    ok('a malformed window prunes nothing (nothing to scope a delete to)',
      planCalendarPrune({ complete: true, fetchedEventIds: [], windowStartISO: W2, windowEndISO: W1, nowISO: PNOW }).prune === false, '');
    // ONLY THE FUTURE DEPARTS — a past event absent from a forward-looking listing is normal, and it
    // may already have been met and transcribed.
    const futureFloor = planCalendarPrune({ complete: true, fetchedEventIds: ['a'], windowStartISO: W1, windowEndISO: W2, nowISO: PNOW });
    ok('the prune floor is NOW when now is inside the window (past rows are never candidates)',
      futureFloor.prune && futureFloor.floorFromISO === PNOW, JSON.stringify(futureFloor));
    const allFuture = planCalendarPrune({ complete: true, fetchedEventIds: ['a'], windowStartISO: W1, windowEndISO: W2, nowISO: '2026-08-01T00:00:00.000Z' });
    ok('…and the window start when the whole window is still ahead',
      allFuture.prune && allFuture.floorFromISO === W1, '');
    ok('a window entirely in the past prunes nothing at all',
      planCalendarPrune({ complete: true, fetchedEventIds: ['a'], windowStartISO: W1, windowEndISO: W2, nowISO: '2026-12-01T00:00:00.000Z' }).prune === false, '');
    // THE PROPORTIONAL FLOOR — being slow to prune is safe; being fast is not.
    ok('a departure batch over half the window is REFUSED, with a reason',
      decidePruneBatch({ goneCount: 20, storedInWindow: 30 }).prune === false
      && /refused/.test(decidePruneBatch({ goneCount: 20, storedInWindow: 30 }).reason), '');
    ok('a normal handful of departures still prunes',
      decidePruneBatch({ goneCount: 3, storedInWindow: 30 }).prune === true, '');
    ok('…and the share floor sleeps on tiny batches (2 of 3 departed is a real deletion)',
      decidePruneBatch({ goneCount: 2, storedInWindow: 3 }).prune === true, '');
    ok('nothing absent ⇒ no prune (and no receipt)',
      decidePruneBatch({ goneCount: 0, storedInWindow: 30 }).prune === false, '');
    const syncSrc = readFileSync('lib/calendar/sync-calendar.ts', 'utf8');
    ok('BOTH providers paginate — a single page is not a complete fetch',
      /pageToken/.test(syncSrc) && /@odata\.nextLink/.test(syncSrc), '');
    ok('BOTH providers run the prune through the ONE decision function, clock included',
      (syncSrc.match(/applyCalendarPrune\(supabase, connection, '(gmail|outlook)'/g) ?? []).length === 2
      && (syncSrc.match(/planCalendarPrune\(\{ complete[^)]*nowISO: new Date\(\)\.toISOString\(\)/g) ?? []).length === 2, '');
    ok('the prune is scoped to user AND connection AND provider AND the FUTURE floor (never a global sweep)',
      /\.eq\('user_id', connection\.user_id\)[\s\S]{0,200}?\.eq\('connection_id', connection\.id\)[\s\S]{0,200}?\.eq\('provider', provider\)[\s\S]{0,200}?\.gte\('start_time', plan\.floorFromISO\)/.test(syncSrc), '');
    // A DEPARTURE TAKES THE EVENT, NEVER THE WORK DERIVED FROM IT. cleanupEventLinks HARD-DELETES
    // inbox_items (meeting action items, email-prep rows) that no later sync recreates.
    ok('the departure path NEVER calls the inbox_items deleter — only the explicit-cancellation path does',
      !/applyCalendarPrune[\s\S]*?^}/m.test(syncSrc)
      || !(syncSrc.slice(syncSrc.indexOf('async function applyCalendarPrune'),
        syncSrc.indexOf('const SYNCED_AT_KEY')).includes('cleanupEventLinks')), '');
    ok('…and cleanupEventLinks is still reached by the cancellation path (the law narrowed, nothing was dropped)',
      /cleanupEventLinks\(userId, \(cancelledRows/.test(syncSrc), '');
    ok('every prune batch leaves a receipt on the user\'s own timeline',
      /logActivity\(supabase, connection\.user_id, \{[\s\S]{0,120}?type: 'calendar_pruned'/.test(syncSrc), '');

    // FRESHNESS IS A FACT, NOT A GUESS — the answer states when the calendar was last read, and a
    // stale window is RE-READ before the answer exists ("my view may need a moment" was the shrug).
    console.log('\nG12b — FRESHNESS IS A FACT (the calendar says when it was last read):');
    ok('a never-read connection says UNKNOWN rather than implying it is current',
      /unknown/.test(renderCalendarFreshness([{ provider: 'gmail', syncedAt: null }])), '');
    ok('a recent read states its age in minutes',
      /LAST READ from the calendar provider: 5 min ago/.test(renderCalendarFreshness([{ provider: 'gmail', syncedAt: new Date(Date.now() - 5 * 60_000).toISOString() }])), '');
    ok('with TWO connections the OLDEST read is the one reported (the weakest link is the truth)',
      /2 h ago/.test(renderCalendarFreshness([
        { provider: 'gmail', syncedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
        { provider: 'outlook', syncedAt: new Date(Date.now() - 60_000).toISOString() },
      ])), '');
    ok('no connections at all ⇒ NO freshness claim (silence beats a manufactured fact)',
      renderCalendarFreshness([]) === '', '');
    const calSrc = readFileSync('lib/tools/check-calendar.ts', 'utf8');
    ok('check_calendar re-reads a stale window BEFORE it renders anything',
      /refreshCalendarIfStale\(supabase, userId[\s\S]{0,120}?\)[\s\S]{0,200}?getScheduleWindow\(/.test(calSrc), '');
    ok('…TIME-BOXED: the chat path never hangs on a provider round-trip (it answers from the stored view and says its age)',
      /Promise\.race\(\[[\s\S]{0,240}?refreshCalendarIfStale\([\s\S]{0,200}?REFRESH_BUDGET_MS/.test(calSrc)
      && /const REFRESH_BUDGET_MS = 8_000;/.test(calSrc), '');
    ok('…and the verb exposes a `refresh` argument for "I just changed it"',
      /refresh: \{ type: 'boolean'/.test(calSrc) && /config\.refresh === true \? 0 : STALE_MS/.test(calSrc), '');

    // ── G6 — REGISTRATION PARITY ─────────────────────────────────────────────────────────────────
    console.log('\nG6 — REGISTRATION PARITY (a verb missing one registration point is a verb that does not exist):');
    const conv = readFileSync('lib/converse/index.ts', 'utf8');
    const caps = readFileSync('lib/workspace/tool-capabilities.ts', 'utf8');
    const reg = readFileSync('lib/work/surface-registry.ts', 'utf8');
    const ask = readFileSync('lib/home/ask.ts', 'utf8');
    ok('CHIEF_TOOL_DEFS carries checkCalendarDefinition',
      /const CHIEF_TOOL_DEFS = \[[^\]]*checkCalendarDefinition/.test(conv), '');
    ok('the loop has a dispatch branch for it', /tool === 'check_calendar'/.test(conv), '');
    ok('…and a progress label (never a bare "Working on it…" for a calendar read)',
      /check_calendar: '[^']+…'/.test(conv), '');
    ok('TOOL_FEATURE gates it behind meetings', /check_calendar: 'meetings'/.test(caps), '');
    ok('CAPABILITY_MAP carries the row', /check_calendar: \{/.test(reg) && /tool: 'check_calendar'/.test(reg), '');
    ok('THE ONE ANSWER DOOR applies the weekday floor at converse\'s outermost return',
      /turn\.say = enforceWeekdayDatePairs\(/.test(conv), '');
    ok('THE PROMPT STOPS OVERCLAIMING — the unqualified whole-context claim is gone',
      !ask.includes('whole working context (emails, meetings, projects, calendar'), '');
    ok('…and states the calendar\'s reach AND its edge instead',
      /TODAY AND THE NEXT 14 DAYS ONLY/.test(ask) && /THE CALENDAR RULE/.test(ask), '');
    ok('the today block speaks the date (runtime, not just source)', renderScheduleBlock(sched).includes('TODAY is'), '');

    // ── G7 — THE EXECUTOR ────────────────────────────────────────────────────────────────────────
    console.log('\nG7 — THE CHECK_CALENDAR EXECUTOR (every line it returns is code\'s output):');
    const out = await executeCheckCalendar({ from_date: FROM, to_date: TO }, uid, sb);
    const dayLines = out.split('\n').filter((l) => /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2,4}\.? — /.test(l));
    ok('it renders one line per asked day', dayLines.length === 11, `${dayLines.length}`);
    ok('every printed weekday label verifies against an independent recompute',
      win.days.every((d) => dayLines.some((l) => l.startsWith(`${trueWeekday(d.dayStr).slice(0, 3)} ${shortLabel(d.dayStr)} —`))),
      dayLines.join(' | ').slice(0, 200));
    ok('the away block reads BUSY all day and the cancelled day reads free',
      /BUSY all day/.test(out) && dayLines.some((l) => l.startsWith(`${trueWeekday(D(9)).slice(0, 3)} ${shortLabel(D(9))} —`) && l.endsWith('free')), '');

    const outSlots = await executeCheckCalendar({ from_date: FROM, to_date: TO, propose_slots: true, duration_minutes: 30, count: 3 }, uid, sb);
    const parsed = [...outSlots.matchAll(/^- ([A-Z][a-z]+) (\d{1,2} [A-Z][a-z]{2,4}\.?), (\d{2}):(\d{2})–(\d{2}):(\d{2})$/gm)];
    ok('the proposals parse in the promised shape (Weekday D Mon, HH:MM–HH:MM)', parsed.length === 3, `${parsed.length} — ${outSlots.slice(-220)}`);
    const byLabel = new Map(win.days.map((d) => [shortLabel(d.dayStr), d.dayStr]));
    ok('every proposal\'s weekday verifies, and NONE collides with the fixture\'s busy set',
      parsed.length > 0 && parsed.every((m) => {
        const dayStr = byLabel.get(m[2]);
        if (!dayStr) return false;
        if (m[1] !== trueWeekday(dayStr)) return false;
        const s = zonedTimeToUtc(dayStr, `${m[3]}:${m[4]}`, TZ);
        const e = zonedTimeToUtc(dayStr, `${m[5]}:${m[6]}`, TZ);
        return !collides(s, e);
      }), parsed.map((m) => m[0]).join(' | '));
    // THE LOOP'S TOOL-RESULT BUDGET: the agent loop pushes each tool result as
    // JSON.stringify(out).slice(0, 1500) — a HEAD-anchored cut, so a block that outgrows it loses its
    // LAST days silently and the model answers about a fortnight it only half saw. The default
    // window must fit with room to spare; if a future header or extra line breaks this, the cap is
    // what has to move, not the honesty of the block.
    const defaultOut = await executeCheckCalendar({ propose_slots: true }, uid, sb);
    ok('the DEFAULT window + its slots fit the loop\'s 1500-char tool-result budget (no silent tail loss)',
      JSON.stringify({ say: defaultOut, refs: [] }).length < 1500, `${JSON.stringify({ say: defaultOut, refs: [] }).length}`);

    const bad = await executeCheckCalendar({ from_date: 'next monday' }, uid, sb);
    ok('a malformed date gets an HONEST refusal naming the shape (never a silent substitution)',
      /YYYY-MM-DD/.test(bad) && !/THE CALENDAR —/.test(bad), bad.slice(0, 120));
    const wide = await executeCheckCalendar({ from_date: FROM, to_date: addDays(FROM, 200) }, uid, sb);
    ok('an over-wide window STATES its clamp', /first 60 days/.test(wide), wide.split('\n').find((l) => /first 60/.test(l)) ?? '');

    // ── G8 — THE LINKIFIER ───────────────────────────────────────────────────────────────────────
    console.log('\nG8 — THE REPORT LINK (a bare deliverable URL is a door, not a string):');
    const link = 'https://app.augmtd.ai/documents/abc123';
    ok('a bare URL becomes a door', linkifyReport(`Done — it's at ${link}`, link) === `Done — it's at [Open it](${link})`, linkifyReport(`Done — it's at ${link}`, link));
    ok('an already-linked URL is untouched', linkifyReport(`Done — [Open it](${link})`, link) === `Done — [Open it](${link})`, '');
    ok('IDEMPOTENT', linkifyReport(linkifyReport(`at ${link}`, link), link) === linkifyReport(`at ${link}`, link), '');
    ok('no link, no rewrite', linkifyReport('Done — it is in your Documents.', null) === 'Done — it is in your Documents.', '');

    // ── G10 — THE BARE SHRUG ─────────────────────────────────────────────────────────────────────
    console.log('\nG10 — NO BARE SHRUG (the exhaustion tail hands the work on; it never just gives up):');
    ok('"I couldn\'t finish that one." exists nowhere in the chat lane',
      !conv.includes("I couldn't finish that one.") && !ask.includes("I couldn't finish that one."), '');

    // ── G9 — LIVE ────────────────────────────────────────────────────────────────────────────────
    // THE DETERMINISTIC HALVES ARE HARD GATES (weekday pairs, collision arithmetic); the phrasing
    // halves are tolerant and get ONE retry between them — a model may ask a clarifying question,
    // which is honest behaviour, not a broken law.
    console.log('\nG9 — LIVE (the served answer, over the incident\'s own fixture shape):');
    let retries = 1;
    /** Every live answer the suite ever served — swept once at the end by R6. */
    const liveAnswers: string[] = [];
    const askChat = async (q: string) => {
      const say = (await converse(sb, uid, { kind: 'global' }, q)).say ?? '';
      liveAnswers.push(say);
      return say;
    };
    const clipq = (s: string) => s.replace(/\s+/g, ' ').slice(0, 260);
    const monthLong = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${D(1)}T12:00:00Z`));
    const askedDay = `${Number(D(1).slice(8, 10))} ${monthLong}`;

    // T1 — "am I free on <a day inside the away block>?"
    let a1 = await askChat(`Am I free on ${askedDay}? Answer in one or two sentences.`);
    const notFree = (t: string) => t.includes(PREFIX) || /\b(busy|not free|aren'?t free|are not free|away|blocked|booked|unavailable|all[- ]day|offsite)\b/i.test(t);
    if (!notFree(a1) && retries > 0) { retries--; a1 = await askChat(`Am I free on ${askedDay}? Answer in one or two sentences.`); }
    console.log(`    T1 » ${clipq(a1)}`);
    ok('T1 — the served answer carries ZERO wrong weekday↔date pairs (hard)', !!a1 && enforceWeekdayDatePairs(a1) === a1, clipq(a1));
    ok('T1 — a day inside the away block is NOT reported free', notFree(a1), clipq(a1));

    // T2 — "suggest three slots" (the incident's second half: two of three sat inside the block)
    const a2 = await askChat('Suggest three slots for a 30-minute call in the next two weeks. Give weekday, date and time for each.');
    console.log(`    T2 » ${clipq(a2)}`);
    ok('T2 — zero wrong weekday↔date pairs (hard)', !!a2 && enforceWeekdayDatePairs(a2) === a2, clipq(a2));
    {
      // Every (date, time) the answer states, checked against the fixture's real busy arithmetic.
      const hits: string[] = [];
      for (const m of a2.matchAll(/(\d{1,2})\s+([A-Z][a-z]{2,8})\b[^.\n]{0,60}?\b(\d{1,2}):(\d{2})/g)) {
        const dayStr = win.days.find((d) => Number(d.dayStr.slice(8, 10)) === Number(m[1])
          && monthKey(d.dayStr) === m[2].slice(0, 3).toLowerCase())?.dayStr;
        if (!dayStr) continue;
        const s = zonedTimeToUtc(dayStr, `${m[3].padStart(2, '0')}:${m[4]}`, TZ);
        if (collides(s, s + 30 * 60_000)) hits.push(`${dayStr} ${m[3]}:${m[4]}`);
      }
      ok('T2 — no proposed (date, time) collides with a fixture busy block (hard)', hits.length === 0, hits.join(','));
    }

    // T3 — the pilot's exact shape: a counterparty offers "either of the next two weeks".
    const email =
      `From: Sam Rivera <sam@acme.example>\nSubject: Catch-up\n\n` +
      `Hi — happy to meet. Either of the next two weeks works on my side; let me know what suits you.`;
    const t3 = `Here is an email I just got:\n\n${email}\n\nPlease check my calendar and tell me what to reply.`;
    let a3 = await askChat(t3);
    // The law is about the SPAN, not about a day: "Friday 25 September is completely free" is TRUE
    // here and must pass. Only a claim that the offered PERIOD itself is open is the incident.
    const SPAN = '(both weeks|either week|the (next )?two weeks|next two weeks|whole (period|fortnight)|either of the next two weeks)';
    const OPEN = '(free|open|clear|available|wide open|no (meetings|commitments))';
    const claimsSpanFree = (t: string) =>
      new RegExp(`${SPAN}[^.!?]{0,50}\\b${OPEN}\\b`, 'i').test(t) || new RegExp(`\\b${OPEN}\\b[^.!?]{0,50}${SPAN}`, 'i').test(t);
    // …and the answer must actually SEE the away block — silence about it is the same failure wearing
    // better manners (the pilot answer was fluent and entirely wrong).
    const seesTheBlock = (t: string) => /\b(offsite|away|blocked|tied up|booked|busy|all[- ]day|out of office)\b/i.test(t);
    if ((claimsSpanFree(a3) || !seesTheBlock(a3)) && retries > 0) { retries--; a3 = await askChat(t3); }
    console.log(`    T3 » ${clipq(a3)}`);
    ok('T3 — zero wrong weekday↔date pairs (hard)', !!a3 && enforceWeekdayDatePairs(a3) === a3, clipq(a3));
    ok('T3 — THE INCIDENT\'S OWN SENTENCE is not served: the offered two weeks are never called free',
      !!a3 && !claimsSpanFree(a3), clipq(a3));
    ok('T3 — …and the four-day away block is SEEN, not silently skipped', seesTheBlock(a3), clipq(a3));

    // ── R — THE REACH GATES ──────────────────────────────────────────────────────────────────────
    // THE DEAD END Wave 1 left standing: a `question` verdict routes to a TOOLLESS completion, so a
    // question whose answer lives outside the handed context could only ever be refused honestly —
    // confinement wearing good manners. THE REACH VALVE is the fix, and its law is that THE MODEL
    // decides: one contract clause in every question prompt, one sentinel token, and code that does
    // nothing but recognise the token it agreed to. R1 guards the shape (no keyword routing sneaking
    // back in), R2 the pure recogniser, R3/R4 the served behaviour, R5 the DM seams, R6 the hygiene.
    console.log('\nR — THE REACH GATES (no lane answers from confinement; the sentinel never serves):');
    const reachSrc = readFileSync('lib/converse/reach.ts', 'utf8');
    const entAsk = readFileSync('lib/entities/ask.ts', 'utf8');

    // R1 — SOURCE SHAPE
    ok('R1 — reach.ts exports the four members of the contract',
      ['REACH_SENTINEL', 'REACH_CONTRACT', 'needsReach', 'sayInsteadOfSentinel']
        .every((n) => new RegExp(`export (const|function) ${n}\\b`).test(reachSrc)), '');
    ok('R1 — ONE contract, imported by the Home ask AND the entity ask (a copied clause is a clause that drifts)',
      /import \{[^}]*REACH_CONTRACT[^}]*\} from '@\/lib\/converse\/reach'/.test(ask)
      && /import \{[^}]*REACH_CONTRACT[^}]*\} from '@\/lib\/converse\/reach'/.test(entAsk), '');
    ok('R1 — …and it rides converse\'s own item sub-path prompt too (all three toolless doors)',
      /\$\{REACH_CONTRACT\}\s*\\n\s*Return ONLY JSON/.test(conv), '');
    ok('R1 — THE SENTINEL NEVER SERVES: the outermost answer door applies sayInsteadOfSentinel',
      /turn\.say = sayInsteadOfSentinel\(turn\.say\)/.test(conv), '');
    {
      // THE MODEL DECIDES: no vocabulary list, no topic regex, nothing in the classifier's prompt.
      const i = conv.indexOf('async function classifyTurn');
      const rest = conv.slice(i + 10);
      const j = rest.search(/\n(async function|function|const [A-Za-z_]+ = async)/);
      const classifyBody = j < 0 ? rest : rest.slice(0, j);
      ok('R1 — classifyTurn carries NO reach routing: the sentinel is absent from its prompt',
        i > 0 && !classifyBody.includes(REACH_SENTINEL), `${classifyBody.length} chars scanned`);
      const escalations = conv.split('\n').map((l, n) => ({ l, n })).filter((r) => /escalateToReach = true/.test(r.l));
      ok('R1 — every escalation is driven by needsReach() alone (no code reads the user\'s words)',
        escalations.length >= 3 && escalations.every((r) => /if \(needsReach\(/.test(r.l)),
        escalations.map((r) => `${r.n + 1}:${r.l.trim()}`).join(' | '));
    }

    // R2 — THE PURE RECOGNISER
    ok('R2 — the bare token is a reach request', needsReach(REACH_SENTINEL) === true, '');
    ok('R2 — …and so is the token with punctuation after it ("NEEDS_REACH." / " — ")',
      needsReach(`${REACH_SENTINEL}.`) && needsReach(` ${REACH_SENTINEL} — `) === true, '');
    ok('R2 — the token followed by a REAL sentence is an answer, not a request',
      needsReach(`${REACH_SENTINEL} you are free on Tuesday.`) === false, '');
    ok('R2 — empty / null is never a reach request',
      !needsReach('') && !needsReach(null) && !needsReach(undefined), '');
    ok('R2 — a bare sentinel becomes an honest line, and the token NEVER survives into it',
      sayInsteadOfSentinel(REACH_SENTINEL) !== REACH_SENTINEL
      && !sayInsteadOfSentinel(REACH_SENTINEL).includes(REACH_SENTINEL)
      && sayInsteadOfSentinel(REACH_SENTINEL).length > 10, sayInsteadOfSentinel(REACH_SENTINEL));
    ok('R2 — token + content keeps the CONTENT and drops only the plumbing',
      sayInsteadOfSentinel(`${REACH_SENTINEL} — you are free on Tuesday.`) === 'you are free on Tuesday.',
      sayInsteadOfSentinel(`${REACH_SENTINEL} — you are free on Tuesday.`));
    ok('R2 — IDEMPOTENT on clean text (the guard touches nothing it did not put there)',
      sayInsteadOfSentinel('You have two meetings on Thursday.') === 'You have two meetings on Thursday.'
      && sayInsteadOfSentinel(sayInsteadOfSentinel(REACH_SENTINEL)) === sayInsteadOfSentinel(REACH_SENTINEL), '');

    // R3 — LIVE, THE DECISIVE ONE: a question about a day the handed context CANNOT contain.
    const farMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${FAR}T12:00:00Z`));
    const farAsked = `${Number(FAR.slice(8, 10))} ${farMonth}`;
    const farQ = `Am I free on ${farAsked}? Just checking before I confirm something.`;
    const knowsFar = (t: string) => t.includes(FAR_TOKEN) || t.includes(PREFIX)
      || /\b(busy|not free|aren'?t free|are not free|booked|blocked|conflict|meeting|unavailable|taken)\b/i.test(t);
    // A CONFESSION IS NOT AN ANSWER — the whole point of the valve is that the lane WENT AND LOOKED.
    // The last three alternatives were added after the first run served exactly that shape ("I don't
    // have visibility to 23 October — that's beyond the 14-day window I can see… I can check if you
    // like"): the gate names every dialect of the confinement it exists to outlaw.
    const confines = (t: string) => /can(?:no|')t see|not visible|beyond (?:my|the) (?:window|reach)|(?:don'?t|do not) have visibility|beyond the \d+-day window|(?:can|could|shall) I check (?:it|that|the full calendar)/i.test(t);
    let r3 = await askChat(farQ);
    let reachRetries = 1;
    if ((!knowsFar(r3) || confines(r3)) && reachRetries > 0) { reachRetries--; r3 = await askChat(farQ); }
    console.log(`    R3 » ${clipq(r3)}`);
    ok('R3 — the served answer carries ZERO wrong weekday↔date pairs (hard)',
      !!r3 && enforceWeekdayDatePairs(r3) === r3, clipq(r3));
    ok('R3 — THE SENTINEL NEVER SERVES: no contract token in the served words (hard)',
      !!r3 && !r3.includes(REACH_SENTINEL), clipq(r3));
    ok('R3 — a day 35 days out — far beyond the snapshot — is NOT reported free: the lane REACHED',
      knowsFar(r3), clipq(r3));
    ok('R3 — …and it did not CONFESS its edge instead of crossing it',
      !!r3 && !confines(r3), clipq(r3));

    // R4 — LIVE: the valve must not have made the fast path escalate everything. A question the
    // handed context DOES cover still answers from it, correctly.
    const nearQ = `Am I free on ${askedDay}? Just checking before I confirm something.`;
    let r4 = await askChat(nearQ);
    if (!notFree(r4) && reachRetries > 0) { reachRetries--; r4 = await askChat(nearQ); }
    console.log(`    R4 » ${clipq(r4)}`);
    ok('R4 — a WITHIN-WINDOW question still carries zero wrong weekday↔date pairs (hard)',
      !!r4 && enforceWeekdayDatePairs(r4) === r4, clipq(r4));
    ok('R4 — …and still tells the truth: the away-block day is not reported free', notFree(r4), clipq(r4));

    // R5 — THE DM SEAMS (the seven-point lesson: a verb missing one registration point does not exist)
    const bridge = readFileSync('lib/work/agentos-bridge.ts', 'utf8');
    const dmRoute = readFileSync('app/api/work/threads/[id]/chat/route.ts', 'utf8');
    const agentosTools = readFileSync('app/api/internal/agentos/tools/route.ts', 'utf8');
    const pyTools = readFileSync('infra/agentos/tools_data.py', 'utf8');
    // RE-POINTED Sep 21 (THE ANCHOR LAW): the floor now takes the USER'S OWN WORDS, and a seam that
    // calls it WITHOUT them is the bug this arc closed — a weekday the user asked for would be
    // silently "corrected" away. The gate therefore demands the userText argument, not just the call.
    ok('R5 — the AgentOS bridge applies the weekday floor to the PERSISTED message, WITH the user\'s words',
      /enforceWeekdayDatePairs\(fullText, \{ userText: message \}\)/.test(bridge) && /from '@\/lib\/utils\/weekday-floor'/.test(bridge), '');
    ok('R5 — the native DM route does the same at its own persist seam',
      /enforceWeekdayDatePairs\(fullAssistantText, \{ userText: content \}\)/.test(dmRoute), '');
    ok('R5 — buildChatTools hands the coworker lane checkCalendarDefinition',
      // RE-POINTED (Sep 21, the door-parity wave): the coworker door's tool list is DERIVED from
      // the capability registry in lib/work/chat-tool-defs.ts — the verb is still on the door, it
      // is simply no longer pushed by hand.
      /buildCoworkerTools\(/.test(dmRoute)
      && /check_calendar: checkCalendarDefinition/.test(readFileSync('lib/work/chat-tool-defs.ts', 'utf8')), '');
    ok('R5 — …and the DM dispatch has a branch to run it', /case 'check_calendar':/.test(dmRoute), '');
    ok('R5 — the internal AgentOS tools route dispatches check_calendar', /case 'check_calendar':/.test(agentosTools), '');
    ok('R5 — the Python tool is registered in DATA_TOOLS (dormant until the box redeploy)',
      /def check_calendar\(/.test(pyTools) && /DATA_TOOLS[\s\S]{0,400}?check_calendar/.test(pyTools), '');
    // THE VALVE NEEDS A VERB ON THE OTHER SIDE: an escalation into a loop whose toolset was filtered
    // empty is a valve that opens onto nothing — the failure is silent (the answer just confesses
    // again, and worse, OFFERS to check something it structurally cannot). Name the dependency.
    {
      const { getWorkspaceFeatures } = await import('../lib/workspace/features');
      const feats = await getWorkspaceFeatures(uid, sb) as unknown as Record<string, boolean>;
      ok('R5 — the RUN-TIME workspace really exposes the calendar verb (meetings on ⇒ the loop holds check_calendar)',
        feats?.meetings === true, JSON.stringify(feats));
    }
    ok('R5 — CAPABILITY_MAP exposes check_calendar to BOTH the chief and the coworker lane',
      /check_calendar: \{[\s\S]{0,400}?exposure: \['chief_of_staff', 'coworker'\]/.test(reg), '');

    // R6 — SENTINEL HYGIENE ACROSS THE BOARD: every live answer this suite ever served.
    const leaked = liveAnswers.filter((a) => a.includes(REACH_SENTINEL));
    ok(`R6 — zero contract tokens across ALL ${liveAnswers.length} live answers the suite served`,
      leaked.length === 0, leaked.map(clipq).join(' || '));

    // ── E — THE EMPTY-CALENDAR TRUTH + THE PHANTOM OFFER ─────────────────────────────────────────
    // AN EMPTY TABLE IS NOT AN EMPTY DIARY. The reach gates exposed the pair: a never-synced account
    // rendered a fortnight of "free" lines (an availability claim manufactured from nothing), and the
    // escalated loop on a calendar-less workspace offered a check it structurally could not perform.
    // Both are the same class — CAPABILITY SHAPES VOCABULARY: what we cannot know we call unknown,
    // and what we cannot do we never offer. E5 is the discriminator that keeps the fix honest in the
    // other direction: a genuinely clear fortnight on a REAL calendar must still read free.
    console.log('\nE — THE EMPTY-CALENDAR TRUTH (an empty table is not an empty diary; no phantom offers):');
    const NOBODY = randomUUID();   // a user with no rows anywhere — the service-role read just returns nothing

    // E1 — the never-synced account renders UNKNOWN, with no day lines at all.
    const emptyWin = await getScheduleWindow(sb, NOBODY, { fromDayStr: FROM, toDayStr: TO, tz });
    const emptyRender = renderCalendarWindow(emptyWin, { tz });
    console.log(`    E1 » ${emptyRender.replace(/\s+/g, ' ').slice(0, 260)}`);
    ok('E1 — a user with ZERO calendar rows reports hasCalendar false', emptyWin.hasCalendar === false, '');
    ok('E1 — …and the block says NO CALENDAR IS SYNCED', /NO CALENDAR IS SYNCED/.test(emptyRender), emptyRender.slice(0, 120));
    ok('E1 — …and states the two prohibitions (never free/busy, never offer a check)',
      /never describe any day or time as free or busy/i.test(emptyRender) && /do not offer to check/i.test(emptyRender), '');
    ok('E1 — …and renders NOT ONE "— free" day line (the fortnight of invented freedom is gone)',
      !/— free/.test(emptyRender), emptyRender.split('\n').filter((l) => /— free/.test(l)).join(' | '));
    ok('E1 — …and no busy day line either: the block is the header ALONE',
      !/BUSY/.test(emptyRender) && emptyRender.split('\n').filter(Boolean).length === 1,
      `${emptyRender.split('\n').filter(Boolean).length} lines`);

    // E2 — THE FLAG NEVER DEGRADES A REAL CALENDAR: the seeded probe renders exactly as G2 expects.
    ok('E2 — the SEEDED probe reports hasCalendar true', win.hasCalendar === true, '');
    ok('E2 — …and its render is the full day-by-day block, never the UNKNOWN header',
      !/NO CALENDAR IS SYNCED/.test(rendered) && rendered.split('\n').filter(Boolean).length === 12,
      `${rendered.split('\n').filter(Boolean).length} lines`);
    ok('E2 — …with every G2 fact intact (busy block, real clock window, free cancelled day)',
      /BUSY all day \(/.test(lineFor(D(1))) && lineFor(D(7)).includes('09:00–11:00') && lineFor(D(9)).endsWith('— free'), '');

    // E3 — a proposal over an empty busy set would offer EVERY slot; it is refused instead.
    const emptySlots = await executeCheckCalendar({ from_date: FROM, to_date: TO, propose_slots: true, count: 3 }, NOBODY, sb);
    console.log(`    E3 » ${emptySlots.replace(/\s+/g, ' ').slice(0, 260)}`);
    ok('E3 — propose_slots on a calendar-less account REFUSES plainly, naming the reason',
      /no calendar is synced/i.test(emptySlots) && /none can be proposed/i.test(emptySlots), emptySlots.slice(0, 160));
    ok('E3 — …and not a single "- <Weekday> …" proposal line is printed',
      !/^- [A-Z][a-z]+ \d{1,2} /m.test(emptySlots), emptySlots.split('\n').filter((l) => /^- /.test(l)).join(' | '));
    ok('E3 — …while the SEEDED account still gets its three real proposals (the refusal is scoped)',
      [...outSlots.matchAll(/^- [A-Z][a-z]+ /gm)].length === 3, '');

    // E4 — SOURCE: the note matches the tools the loop will actually hold.
    const convNow = readFileSync('lib/converse/index.ts', 'utf8');
    const askNow = readFileSync('lib/home/ask.ts', 'utf8');
    ok('E4 — the escalation note CONSULTS the feature map before promising a lookup',
      /reachCalendarHeld[\s\S]{0,400}?getWorkspaceFeatures/.test(convNow), '');
    ok('E4 — …and carries BOTH branches: call check_calendar where the verb exists…',
      /reachCalendarHeld\s*\n?\s*\?[\s\S]{0,300}?calling check_calendar/.test(convNow), '');
    ok('E4 — …and plain honesty where it does not (never guess, never offer to check)',
      /calendar access isn't set up here[\s\S]{0,120}?never/.test(convNow) && /never offer to check it/.test(convNow), '');
    ok('E4 — the Home ask handles a NO CALENDAR IS SYNCED block in its own calendar rule',
      /NO CALENDAR IS SYNCED/.test(askNow) && /never call a day free or busy/.test(askNow), '');

    // E5 — THE DISCRIMINATOR: a real calendar whose asked fortnight happens to be empty. The
    // existence probe is the whole point — without it this window would be indistinguishable from
    // E1's, and a clear diary would be slandered as "no calendar".
    const CLEAR_FROM = addDays(FAR, 3), CLEAR_TO = addDays(FAR, 6);
    const clearWin = await getScheduleWindow(sb, uid, { fromDayStr: CLEAR_FROM, toDayStr: CLEAR_TO, tz });
    const clearRender = renderCalendarWindow(clearWin, { tz });
    ok('E5 — a window with NO events but a real calendar behind it still reports hasCalendar true (the existence probe)',
      clearWin.hasCalendar === true && clearWin.days.every((d) => d.busy.length === 0),
      `${clearWin.hasCalendar} / busy days ${clearWin.days.filter((d) => d.busy.length).map((d) => d.dayStr).join(',')}`);
    ok('E5 — …so its days read "free", NOT "no calendar" — a clear diary is not an absent one',
      !/NO CALENDAR IS SYNCED/.test(clearRender)
      && clearWin.days.every((d) => clearRender.split('\n').some((l) => l.startsWith(`${trueWeekday(d.dayStr).slice(0, 3)} ${shortLabel(d.dayStr)} `) && l.endsWith('— free'))),
      clearRender.replace(/\s+/g, ' ').slice(0, 200));
  } finally {
    await wipe();
    await restoreWorkspace();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
