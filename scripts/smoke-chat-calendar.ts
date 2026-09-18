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
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { getScheduleWindow, renderCalendarWindow, userTimezone, weekdayOf } from '../lib/calendar/schedule-window';
import { getTodaySchedule, renderScheduleBlock } from '../lib/calendar/today-schedule';
import { proposeFreeSlots, zonedTimeToUtc } from '../lib/prepare/free-slots';
import { enforceWeekdayDatePairs } from '../lib/utils/weekday-floor';
import { executeCheckCalendar } from '../lib/tools/check-calendar';
import { linkifyReport } from '../lib/workflows/report-back';
import { converse } from '../lib/converse';

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
  ].map((r) => ({ ...r, user_id: uid, calendar_id: 'primary', provider: 'gmail', timezone: TZ }));

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
    console.log(`\nFIXTURE — probe ${uid}, ${TZ}, block ${D(0)}→${D(3)}, window ${FROM}→${TO}`);

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
    const askChat = async (q: string) => (await converse(sb, uid, { kind: 'global' }, q)).say ?? '';
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
  } finally {
    await wipe();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
