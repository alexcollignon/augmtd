// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVENT CARD GATE (permanent — Wave 2, Sep 22; docs/component-map.md §4 + §6).
//
// "A law is only alive while a gate enforces it." This suite holds the promises of the calendar
// verbs becoming a card:
//
//   E1 · THE VERB LADDER IS CODE'S — the full truth table over seat × response × passed × writable.
//        Pure. An `unknown` seat permits NOTHING; a passed or unwritable event permits nothing.
//   E2 · AN INVENTED VERB RENDERS NOTHING — `sanitizeProposal` refuses a verb the facts do not
//        permit, a past reschedule, an inverted window, and a malformed proposal.
//   E3 · THE SPEC IS DERIVED, NOT DESCRIBED — seat from addresses, labels computed in the user's
//        zone, `passed` from the clock, `writable` false without a connection. Live, on the probe.
//   E4 · AMBIGUITY IS A REFUSAL BY LISTING — `findEventByAsk` resolves one by time + distinctive
//        token, and hands back candidates rather than guessing when two fit. Live.
//   E5 · THE ANCHOR LAW ON A NEW TIME — a reschedule's window is resolved BY CODE from the user's
//        own words; a verb nobody said arms nothing.
//   E6 · THE DEEDS DOOR — the client's word is never trusted (facts re-derived, 409 on an
//        unpermitted verb), the commit door is claimed BEFORE the provider is touched and RELEASED
//        on failure, and nothing in the refusal lane can reach a provider (asserted with the network
//        stubbed in-process).
//   E7 · EXACTLY-ONCE — a second claim on the same key returns the FIRST result. Live.
//   E8 · THE REGISTRY + THE DOORS — parity gates, the presentation/presents declarations, and the
//        POINTER law on both persisting surfaces.
//
// NOTHING IS SENT. No RSVP, no reschedule, no cancel, no provider call of any kind: the live lane
// seeds fixtures on the SHARED PROBE HOST against a connection with no tokens, so every write path
// fails closed and is asserted AS a refusal. All fixtures are swept in the finally.
//
// Run: set -a; source .env.local; set +a; npx tsx scripts/smoke-events.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser, PROBE_EMAIL } from './probe-user';
import {
  validEventVerbs, sanitizeProposal, EVENT_VERBS, EVENT_VERB_WORDS, isEventSpec,
  OUTWARD_VERBS, IRREVERSIBLE_VERBS,
  type EventFacts, type EventSeat, type EventResponse, type EventVerb,
} from '../lib/present/event';
import {
  composeEventSpec, buildEvent, findEventByAsk, ownAddresses, readEventRow, seatOf, responseOf,
  otherAttendees, eventWindowMs, clockTimesIn, dayStatedIn, verbsStatedIn, resolveProposedWindow,
  eventFraming, humanizeAddress, EVENT_ATTENDEE_CAP,
} from '../lib/present/event-build';
import { armProposal, prepareEventActionDefinition, executePrepareEventAction } from '../lib/tools/prepare-event-action';
import { loadEventWriteTarget, isWriteTargetError, attendeesWithResponse, attendeeAddressesOf } from '../lib/calendar/event-writes';
import { zonedTimeToUtc } from '../lib/prepare/free-slots';

const ROOT = join(__dirname, '..');
const src = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
/** Code only — a law NAMED in a header must neither satisfy a gate nor trip one. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TZ = 'Europe/Lisbon';
const PREFIX = 'SMOKE-EVT';
const DAY_MS = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const facts = (f: Partial<EventFacts>): EventFacts =>
  ({ seat: 'invitee', myResponse: null, passed: false, allDay: false, writable: true, ...f });

async function main() {
  console.log('\n════ THE EVENT CARD GATE ════');

  // ══ E1 · THE VERB LADDER IS CODE'S ═════════════════════════════════════════════════════════
  console.log('\nE1 — THE VERB LADDER (pure truth table: seat × response × passed × writable):');
  {
    const seats: EventSeat[] = ['organizer', 'invitee', 'solo', 'unknown'];
    const responses: Array<EventResponse | null> = [null, 'needsAction', 'accepted', 'tentative', 'declined'];

    gate('E1 · an ORGANIZER may reschedule and cancel, and may never RSVP to their own event',
      seats.filter((s) => s === 'organizer').every(() =>
        JSON.stringify(validEventVerbs(facts({ seat: 'organizer' }))) === JSON.stringify(['reschedule', 'cancel'])));

    gate('E1 · a SOLO block wears the organizer\'s verbs (it is the user\'s own time)',
      JSON.stringify(validEventVerbs(facts({ seat: 'solo' }))) === JSON.stringify(['reschedule', 'cancel']));

    gate('E1 · an UNKNOWN seat permits NOTHING (fail closed — we cannot place the user on it)',
      responses.every((r) => validEventVerbs(facts({ seat: 'unknown', myResponse: r })).length === 0));

    // The invitee ladder drops the answer the user has already given: re-declining a declined
    // invitation is not an action, it is a no-op wearing a button.
    const invitee = (r: EventResponse | null) => validEventVerbs(facts({ seat: 'invitee', myResponse: r }));
    gate('E1 · an INVITEE sees the three RSVP verbs, minus the one they already gave',
      JSON.stringify(invitee(null)) === JSON.stringify(['accept', 'tentative', 'decline'])
      && JSON.stringify(invitee('needsAction')) === JSON.stringify(['accept', 'tentative', 'decline'])
      && JSON.stringify(invitee('accepted')) === JSON.stringify(['tentative', 'decline'])
      && JSON.stringify(invitee('tentative')) === JSON.stringify(['accept', 'decline'])
      && JSON.stringify(invitee('declined')) === JSON.stringify(['accept', 'tentative']));

    gate('E1 · an INVITEE may never reschedule or cancel someone else\'s meeting',
      responses.every((r) => {
        const v = invitee(r);
        return !v.includes('reschedule') && !v.includes('cancel');
      }));

    gate('E1 · a PASSED event permits nothing, whatever the seat (there is nothing left to change)',
      seats.every((s) => responses.every((r) => validEventVerbs(facts({ seat: s, myResponse: r, passed: true })).length === 0)));

    gate('E1 · an UNWRITABLE row permits nothing (no connection / no provider id = read-only)',
      seats.every((s) => validEventVerbs(facts({ seat: s, writable: false })).length === 0));

    gate('E1 · the ladder never emits a verb outside the contract, on ANY combination',
      seats.every((s) => responses.every((r) => [true, false].every((p) => [true, false].every((w) =>
        validEventVerbs(facts({ seat: s, myResponse: r, passed: p, writable: w }))
          .every((v) => (EVENT_VERBS as readonly string[]).includes(v)))))));

    gate('E1 · malformed facts permit nothing rather than throwing',
      validEventVerbs(null as unknown as EventFacts).length === 0
      && validEventVerbs({} as EventFacts).length === 0);

    gate('E1 · every verb has WORDS, and the irreversible ones are a subset of the outward ones',
      EVENT_VERBS.every((v) => !!EVENT_VERB_WORDS[v]?.label && !!EVENT_VERB_WORDS[v]?.armed && !!EVENT_VERB_WORDS[v]?.done)
      && IRREVERSIBLE_VERBS.every((v) => (OUTWARD_VERBS as readonly string[]).includes(v)));
  }

  // ══ E2 · AN INVENTED VERB RENDERS NOTHING ══════════════════════════════════════════════════
  console.log('\nE2 — sanitizeProposal (the model may SELECT, never MINT):');
  {
    const now = new Date('2026-09-22T09:00:00Z');
    const inviteeFacts = facts({ seat: 'invitee', myResponse: 'needsAction' });
    const organizerFacts = facts({ seat: 'organizer' });

    gate('E2 · a verb the facts do not permit becomes null (an invitee cannot cancel)',
      sanitizeProposal({ verb: 'cancel' }, inviteeFacts, { now }) === null
      && sanitizeProposal({ verb: 'accept' }, organizerFacts, { now }) === null);

    gate('E2 · an INVENTED verb becomes null',
      sanitizeProposal({ verb: 'propose_new_time' } as never, inviteeFacts, { now }) === null
      && sanitizeProposal({ verb: '' } as never, inviteeFacts, { now }) === null
      && sanitizeProposal(null, inviteeFacts, { now }) === null
      && sanitizeProposal({ note: 'sorry' } as never, inviteeFacts, { now }) === null);

    gate('E2 · a PAST reschedule is refused (a meeting cannot be moved into yesterday)',
      sanitizeProposal({ verb: 'reschedule', newStartISO: '2026-09-21T10:00:00Z', newEndISO: '2026-09-21T11:00:00Z' },
        organizerFacts, { now }) === null);

    gate('E2 · an inverted or zero-length window is refused (end must be after start)',
      sanitizeProposal({ verb: 'reschedule', newStartISO: '2026-09-25T11:00:00Z', newEndISO: '2026-09-25T10:00:00Z' }, organizerFacts, { now }) === null
      && sanitizeProposal({ verb: 'reschedule', newStartISO: '2026-09-25T11:00:00Z', newEndISO: '2026-09-25T11:00:00Z' }, organizerFacts, { now }) === null
      && sanitizeProposal({ verb: 'reschedule' }, organizerFacts, { now }) === null
      && sanitizeProposal({ verb: 'reschedule', newStartISO: 'not-a-date', newEndISO: 'nor-this' }, organizerFacts, { now }) === null);

    const ok = sanitizeProposal({ verb: 'reschedule', newStartISO: '2026-09-25T10:00:00Z', newEndISO: '2026-09-25T10:30:00Z', newLabel: 'Fri 25 Sep · 11:00–11:30' }, organizerFacts, { now });
    gate('E2 · a PERMITTED, future, well-formed reschedule survives with its code-written label',
      !!ok && ok.verb === 'reschedule' && ok.newStartISO === '2026-09-25T10:00:00Z' && ok.newLabel === 'Fri 25 Sep · 11:00–11:30');

    const noted = sanitizeProposal({ verb: 'decline', note: `  ${'x'.repeat(400)}  ` }, inviteeFacts, { now });
    gate('E2 · a note is trimmed and capped; an RSVP proposal never carries a time',
      !!noted && noted.note!.length === 280 && noted.newStartISO === undefined);
  }

  // ══ E5 · THE ANCHOR LAW + THE VERB FLOOR (pure) ════════════════════════════════════════════
  console.log('\nE5 — THE ANCHOR LAW ON A NEW TIME + the verb-the-user-said floor:');
  {
    // Sep 22 2026 is a Tuesday — every expectation below is stated against that real calendar.
    const now = new Date(zonedTimeToUtc('2026-09-22', '09:00', TZ));

    gate('E5 · the clock reader takes real shapes and REFUSES a bare number',
      JSON.stringify(clockTimesIn('move it to 3pm')) === JSON.stringify([15 * 60])
      && JSON.stringify(clockTimesIn('at 15:00')) === JSON.stringify([15 * 60])
      && JSON.stringify(clockTimesIn('at 10.30am')) === JSON.stringify([10 * 60 + 30])
      && clockTimesIn('move the 3 people meeting').length === 0);

    gate('E5 · the day reader resolves today/tomorrow/a weekday in the USER\'S zone, and an explicit date verbatim',
      dayStatedIn('cancel tomorrow\'s sync', { now, tz: TZ }) === '2026-09-23'
      && dayStatedIn('what is on today', { now, tz: TZ }) === '2026-09-22'
      && dayStatedIn('move it to Thursday', { now, tz: TZ }) === '2026-09-24'
      && dayStatedIn('move it to 2026-10-05', { now, tz: TZ }) === '2026-10-05'
      && dayStatedIn('move it later', { now, tz: TZ }) === null);

    const win = resolveProposedWindow('move my call with Sam to Thursday 10am', { now, tz: TZ, durationMs: 30 * 60_000 });
    gate('E5 · "Thursday 10am" resolves BY CODE to the right instant, duration kept, label computed',
      !!win && win.startISO === new Date(zonedTimeToUtc('2026-09-24', '10:00', TZ)).toISOString()
      && win.endISO === new Date(zonedTimeToUtc('2026-09-24', '10:30', TZ)).toISOString()
      && /^Thu 24 Sep · 10:00–10:30$/.test(win.label), win?.label);

    gate('E5 · a day with no clock, or a clock with no day, resolves NOTHING (the card asks instead of guessing)',
      resolveProposedWindow('move it to Thursday', { now, tz: TZ, durationMs: 60_000 }) === null
      && resolveProposedWindow('move it to 10am', { now, tz: TZ, durationMs: 60_000 }) === null
      && resolveProposedWindow('move it', { now, tz: TZ, durationMs: 60_000 }) === null);

    gate('E5 · a resolved time in the PAST is refused (yesterday 10am is not a proposal)',
      resolveProposedWindow('move it to today 07:00', { now, tz: TZ, durationMs: 60_000 }) === null);

    gate('E5 · the verb floor reads the USER\'S OWN WORDS, in the languages the product speaks',
      JSON.stringify(verbsStatedIn('decline the 3pm')) === JSON.stringify(['decline'])
      && JSON.stringify(verbsStatedIn('cancel tomorrow\'s sync')) === JSON.stringify(['cancel'])
      && JSON.stringify(verbsStatedIn('move my call with Sam to Thursday')) === JSON.stringify(['reschedule'])
      && JSON.stringify(verbsStatedIn('recusar o convite')) === JSON.stringify(['decline'])
      && verbsStatedIn('what is my 3pm with Sam?').length === 0);

    const spec = {
      id: 'x', title: 'Weekly', dayLabel: 'Thu 24 Sep', timeLabel: '09:00–09:30',
      startISO: new Date(zonedTimeToUtc('2026-09-24', '09:00', TZ)).toISOString(),
      endISO: new Date(zonedTimeToUtc('2026-09-24', '09:30', TZ)).toISOString(),
      attendees: [], facts: facts({ seat: 'organizer' }), verbs: validEventVerbs(facts({ seat: 'organizer' })),
    };
    const row = { is_all_day: false, start_time: spec.startISO, end_time: spec.endISO, timezone: TZ } as never;

    gate('E5 · NOTHING IS ARMED unless the user\'s own words named the verb',
      armProposal(spec, { asked: 'cancel', userText: "what's my weekly on Thursday?", now, tz: TZ, row }) === null);

    gate('E5 · the model may pick among the verbs the USER said — never introduce one',
      armProposal(spec, { asked: 'cancel', userText: 'cancel the weekly', now, tz: TZ, row })?.verb === 'cancel'
      // asked for a verb the user never said → falls back to their single stated verb
      && armProposal(spec, { asked: 'reschedule', userText: 'cancel the weekly', now, tz: TZ, row })?.verb === 'cancel');

    const moved = armProposal(spec, { asked: 'reschedule', userText: 'move the weekly to Thursday 10am', now, tz: TZ, row });
    gate('E5 · an armed reschedule carries CODE\'s window and CODE\'s label, sized by the event itself',
      !!moved && moved.verb === 'reschedule'
      && moved.newStartISO === new Date(zonedTimeToUtc('2026-09-24', '10:00', TZ)).toISOString()
      && moved.newEndISO === new Date(zonedTimeToUtc('2026-09-24', '10:30', TZ)).toISOString());

    gate('E5 · a reschedule with no resolvable time arms NOTHING (never a card with an empty move)',
      armProposal(spec, { asked: 'reschedule', userText: 'move the weekly', now, tz: TZ, row }) === null);
  }

  // ══ E3/E4 · LIVE, on the shared probe host ═════════════════════════════════════════════════
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('\n⚠️  no Supabase env — the live lanes (E3/E4/E6-live/E7) are SKIPPED');
  } else {
    const sb = createClient(url, key);
    const uid = await resolveProbeUser(sb);
    const D = (n: number) => addDays(new Date().toISOString().slice(0, 10), n);
    const OTHER = 'jordan@example-partner.test';
    const OTHER2 = 'sam@example-client.test';
    const wipe = async () => {
      await sb.from('calendar_events').delete().eq('user_id', uid).like('title', `${PREFIX}%`);
      await sb.from('connections').delete().eq('user_id', uid).like('provider_account_id', `${PREFIX}%`);
      await sb.from('work_entities').delete().eq('user_id', uid).eq('kind', 'person').like('summary', `${PREFIX}%`);
      await sb.from('emails').delete().eq('user_id', uid).eq('thread_id', `${PREFIX}-ladder`);
    };
    await wipe();

    // A connection with NO TOKENS — the fixture's whole point: every write path through it fails
    // closed, so this suite can prove the refusals without a provider existing.
    const { data: conn } = await sb.from('connections').insert({
      user_id: uid, provider: 'gmail', provider_account_id: `${PREFIX}-probe@augmtd-internal.test`,
      status: 'inactive', metadata: {}, last_sync: null, sync_status: 'pending',
    }).select('id').maybeSingle();
    const connId = (conn as { id?: string } | null)?.id ?? null;

    const base = { user_id: uid, calendar_id: 'primary', provider: 'gmail', timezone: TZ, status: 'confirmed' };
    const rows = [
      // (a) AN INVITATION from someone else, unanswered, tomorrow at 15:00.
      { ...base, event_id: `${PREFIX}-invite`, title: `${PREFIX} Pricing review`, is_all_day: false,
        connection_id: connId, organizer: OTHER,
        attendees: [{ email: OTHER, name: 'Jordan' }, { email: PROBE_EMAIL, status: 'needsAction', self: true }],
        start_time: new Date(zonedTimeToUtc(D(1), '15:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc(D(1), '16:00', TZ)).toISOString() },
      // (b) AN EVENT THE USER ORGANIZES, with one distinctive counterpart, in three days at 11:00.
      { ...base, event_id: `${PREFIX}-mine`, title: `${PREFIX} Onboarding walkthrough`, is_all_day: false,
        connection_id: connId, organizer: PROBE_EMAIL,
        attendees: [{ email: PROBE_EMAIL, self: true, status: 'accepted' }, { email: OTHER2, name: 'Sam' }],
        start_time: new Date(zonedTimeToUtc(D(3), '11:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc(D(3), '12:00', TZ)).toISOString() },
      // (c) A PASSED event — yesterday. Permits nothing.
      { ...base, event_id: `${PREFIX}-past`, title: `${PREFIX} Retro`, is_all_day: false,
        connection_id: connId, organizer: PROBE_EMAIL, attendees: [{ email: PROBE_EMAIL, self: true }],
        start_time: new Date(zonedTimeToUtc(D(-1), '10:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc(D(-1), '11:00', TZ)).toISOString() },
      // (d) A ROW WITH NO CONNECTION — read-only by construction.
      { ...base, event_id: `${PREFIX}-orphan`, title: `${PREFIX} Imported block`, is_all_day: false,
        connection_id: null, organizer: PROBE_EMAIL, attendees: [],
        start_time: new Date(zonedTimeToUtc(D(2), '09:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc(D(2), '09:30', TZ)).toISOString() },
      // (e) TWO EVENTS SHARING A DAY AND A TOKEN — the ambiguity fixture.
      { ...base, event_id: `${PREFIX}-amb1`, title: `${PREFIX} Pricing review follow-up`, is_all_day: false,
        connection_id: connId, organizer: OTHER, attendees: [{ email: OTHER, name: 'Jordan' }, { email: PROBE_EMAIL, self: true }],
        start_time: new Date(zonedTimeToUtc(D(1), '17:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc(D(1), '18:00', TZ)).toISOString() },
      // (g) THE NAME-LADDER FIXTURE — three attendees, NONE carrying a display name (the shape a
      // real provider row actually has). One is known to the person registry, one has signed mail,
      // one is unknown to everything: the three rungs, in one event.
      { ...base, event_id: `${PREFIX}-nameless`, title: `${PREFIX} Partner sync`, is_all_day: false,
        connection_id: connId, organizer: 'priya@example-partner.test',
        attendees: [
          { email: 'priya@example-partner.test' },
          { email: 'wren@example-partner.test' },
          { email: 'dana.okonkwo@example-partner.test' },
          { email: PROBE_EMAIL, self: true, status: 'needsAction' },
        ],
        start_time: new Date(zonedTimeToUtc(D(4), '10:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc(D(4), '10:30', TZ)).toISOString() },
      // (f) AN ALL-DAY BLOCK the user put in their own calendar (the solo seat).
      { ...base, event_id: `${PREFIX}-away`, title: `${PREFIX} Offsite`, is_all_day: true,
        connection_id: connId, organizer: null, attendees: [],
        start_time: `${D(5)}T00:00:00.000Z`, end_time: `${D(7)}T00:00:00.000Z` },
    ];
    // THE LADDER'S OTHER TWO SOURCES — seeded BEFORE any build, because the person registry is
    // memoised per user for a minute: a registry warmed by an earlier read would never see this row.
    await sb.from('work_entities').insert({
      user_id: uid, kind: 'person', name: 'Priya Raman', status: 'active',
      aliases: ['priya@example-partner.test'], summary: `${PREFIX} fixture person`,
    });
    await sb.from('emails').insert({
      user_id: uid, message_id: `<${PREFIX}-ladder-${Date.now()}@probe.test>`, thread_id: `${PREFIX}-ladder`,
      from_address: 'wren@example-partner.test', from_name: 'Wren Halloway',
      subject: `${PREFIX} ladder fixture`, body: 'Fixture mail — the name ladder\'s third rung.',
      received_at: new Date().toISOString(), is_from_user: false,
    });

    const { error: seedErr } = await sb.from('calendar_events').insert(rows);
    if (seedErr) { console.log(`\n⚠️  fixture seed failed (${seedErr.message}) — live lanes SKIPPED`); }

    try {
      if (!seedErr) {
        const idOf = async (eventId: string): Promise<string> => {
          const { data } = await sb.from('calendar_events').select('id').eq('user_id', uid).eq('event_id', eventId).maybeSingle();
          return String((data as { id?: string } | null)?.id ?? '');
        };
        const inviteId = await idOf(`${PREFIX}-invite`);
        const mineId = await idOf(`${PREFIX}-mine`);
        const pastId = await idOf(`${PREFIX}-past`);
        const orphanId = await idOf(`${PREFIX}-orphan`);
        const awayId = await idOf(`${PREFIX}-away`);
        const namelessId = await idOf(`${PREFIX}-nameless`);

        console.log('\nE3 — THE SPEC IS DERIVED (live, on the probe host):');
        const mine = await ownAddresses(sb, uid);
        gate('E3 · the user\'s own addresses include their login and their connected mailbox',
          mine.has(PROBE_EMAIL.toLowerCase()) && mine.has(`${PREFIX}-probe@augmtd-internal.test`.toLowerCase()),
          [...mine].join(','));

        const invite = await buildEvent(sb, uid, inviteId, { tz: TZ, mine });
        gate('E3 · an invitation from someone else reads as INVITEE, unanswered, with the three RSVP verbs',
          !!invite && isEventSpec(invite) && invite.facts.seat === 'invitee'
          && invite.facts.myResponse === 'needsAction' && invite.facts.writable === true
          && JSON.stringify(invite.verbs) === JSON.stringify(['accept', 'tentative', 'decline']),
          `${invite?.facts.seat}/${invite?.facts.myResponse}/${invite?.verbs.join(',')}`);

        gate('E3 · the labels are CODE\'s, in the user\'s zone — weekday paired with its own date, clocks clamped to the event',
          !!invite && invite.timeLabel === '15:00–16:00'
          && new RegExp(`^${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].join('|')} \\d{1,2} [A-Z][a-z]{2}$`).test(invite.dayLabel),
          `${invite?.dayLabel} ${invite?.timeLabel}`);

        gate('E3 · the card names the OTHER people and never the user themselves',
          !!invite && invite.attendees.length === 1 && /Jordan/.test(invite.attendees[0])
          && !invite.attendees.some((a) => a.toLowerCase().includes(PROBE_EMAIL.toLowerCase())));

        // ── THE NAME LADDER (Sep 22, the owner's walk: a real event read "with <address> and
        // <address> and others" — both providers omit displayName for most guests).
        console.log('\nE3b — THE NAME LADDER (an address is NEVER rendered as a person):');
        const nameless = await buildEvent(sb, uid, namelessId, { tz: TZ, mine });
        gate('E3b · rung 2 — a PERSON ENTITY the one brain already knows by alias names its attendee',
          !!nameless && nameless.attendees.includes('Priya Raman'), nameless?.attendees.join(' · '));

        gate('E3b · rung 3 — an address that has signed mail is named by its most recent from_name',
          !!nameless && nameless.attendees.includes('Wren Halloway'), nameless?.attendees.join(' · '));

        gate('E3b · rung 4 — an unknown address is HUMANISED from its local part, never shown raw',
          !!nameless && nameless.attendees.includes('Dana Okonkwo'), nameless?.attendees.join(' · '));

        gate('E3b · NO attendee string in a built spec contains "@" — on any event this suite builds',
          [invite, nameless, await buildEvent(sb, uid, mineId, { tz: TZ, mine })]
            .every((s) => !!s && s.attendees.every((a) => !a.includes('@'))),
          nameless?.attendees.join(' · '));

        gate('E3b · …and the FRAMING sentence inherits it (the walk\'s actual symptom)',
          !!nameless && !eventFraming(nameless).includes('@'), eventFraming(nameless!).slice(0, 90));

        const own = await buildEvent(sb, uid, mineId, { tz: TZ, mine });
        gate('E3 · an event the user organizes reads as ORGANIZER, with move + cancel and no RSVP',
          !!own && own.facts.seat === 'organizer'
          && JSON.stringify(own.verbs) === JSON.stringify(['reschedule', 'cancel']));

        const past = await buildEvent(sb, uid, pastId, { tz: TZ, mine });
        gate('E3 · a PASSED event carries the fact and offers nothing',
          !!past && past.facts.passed === true && past.verbs.length === 0);

        const orphan = await buildEvent(sb, uid, orphanId, { tz: TZ, mine });
        gate('E3 · a row with NO CONNECTION is not writable and therefore carries no verbs',
          !!orphan && orphan.facts.writable === false && orphan.verbs.length === 0);

        const away = await buildEvent(sb, uid, awayId, { tz: TZ, mine });
        gate('E3 · an all-day block the user owns reads SOLO, says "all day", and spans its own days',
          !!away && away.facts.allDay === true && away.timeLabel === 'all day'
          && away.facts.seat === 'solo'
          && JSON.stringify(away.verbs) === JSON.stringify(['reschedule', 'cancel']),
          `${away?.facts.seat}/${away?.timeLabel}`);

        gate('E3 · a stranger\'s id is indistinguishable from a missing one (user-scoped read)',
          (await buildEvent(sb, uid, '00000000-0000-0000-0000-000000000000', { tz: TZ, mine })) === null
          && (await readEventRow(sb, uid, '00000000-0000-0000-0000-000000000000')) === null);

        gate('E3 · the framing sentence is code\'s: it names the meeting, the time and the choices — and no uuid',
          !!invite && !invite.id.includes(' ') && !eventFraming(invite).includes(invite.id)
          && /Decline/.test(eventFraming(invite))
          && /already happened/.test(eventFraming(past!)));

        console.log('\nE4 — THE ASK RESOLVES ONE EVENT, OR REFUSES BY LISTING (live):');
        const one = await findEventByAsk(sb, uid, 'move the onboarding walkthrough with Sam', new Date(), { tz: TZ, mine });
        gate('E4 · a distinctive token + a named person resolves exactly ONE event',
          one.kind === 'one' && one.id === mineId, one.kind);

        const many = await findEventByAsk(sb, uid, 'decline the pricing review', new Date(), { tz: TZ, mine });
        gate('E4 · TWO plausible meetings come back as candidates — never a guess',
          many.kind === 'many' && many.candidates.length >= 2
          && many.candidates.every((c) => !!c.title && !!c.dayLabel), many.kind);

        const byClock = await findEventByAsk(sb, uid, "what's my 3pm with Jordan tomorrow?", new Date(), { tz: TZ, mine });
        gate('E4 · a stated clock + day separates the 15:00 invitation from its 17:00 sibling',
          byClock.kind === 'one' && byClock.id === inviteId, byClock.kind);

        const none = await findEventByAsk(sb, uid, 'cancel the quarterly board meeting', new Date(), { tz: TZ, mine });
        gate('E4 · an ask that matches nothing resolves to NONE (never the nearest event)', none.kind === 'none', none.kind);

        console.log('\nE6 — THE PREPARER PREPARES AND NOTHING ELSE (live, with the network stubbed):');
        const realFetch = global.fetch;
        let fetched: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).fetch = async (input: any, ...rest: any[]) => {
          const u = typeof input === 'string' ? input : String(input?.url ?? input);
          fetched.push(u);
          return realFetch(input, ...rest);
        };
        try {
          const prepared = await executePrepareEventAction(sb, uid, {
            which: 'the onboarding walkthrough with Sam', verb: 'cancel',
            userText: 'cancel the onboarding walkthrough with Sam',
          });
          gate('E6 · "cancel X" PREPARES the card with cancel armed — and the deed has not happened',
            !!prepared.present && prepared.present.spec.id === mineId
            && prepared.present.spec.proposal?.verb === 'cancel'
            && /ready to confirm/.test(prepared.modelText));

          const stillThere = await readEventRow(sb, uid, mineId);
          gate('E6 · the event is untouched by the preparation (the row still stands, unchanged)',
            !!stillThere && stillThere.status === 'confirmed');

          gate('E6 · the preparer reached NO calendar provider',
            !fetched.some((u) => /googleapis|graph\.microsoft/.test(u)), fetched.slice(0, 3).join(' '));

          fetched = [];
          const target = await loadEventWriteTarget(sb, uid, mineId);
          gate('E6 · a connection with NO TOKENS refuses the write BEFORE any provider call (fail closed)',
            isWriteTargetError(target) && target.error === 'no_tokens' && target.status === 400
            && !fetched.some((u) => /googleapis|graph\.microsoft/.test(u)),
            isWriteTargetError(target) ? target.error : 'loaded');

          gate('E6 · an event with no connection at all refuses the write too',
            (() => { return true; })()
            && isWriteTargetError(await loadEventWriteTarget(sb, uid, orphanId)));

          const askOnly = await executePrepareEventAction(sb, uid, {
            which: 'the onboarding walkthrough with Sam',
            userText: "what's the onboarding walkthrough with Sam?",
          });
          gate('E6 · a question about a meeting shows the card with NOTHING armed',
            !!askOnly.present && !askOnly.present.spec.proposal);

          const ambiguous = await executePrepareEventAction(sb, uid, {
            which: 'the pricing review', userText: 'decline the pricing review',
          });
          gate('E6 · an ambiguous ask answers by LISTING and renders NO card',
            !ambiguous.present && /Which one\?$/.test(ambiguous.modelText), ambiguous.modelText.slice(0, 80));
        } finally { global.fetch = realFetch; }

        console.log('\nE7 — EXACTLY-ONCE AT THE DEEDS DOOR (live commit-door claim):');
        {
          const { claimCommit, recordCommitResult } = await import('../lib/work/commit-door');
          const key = `event_deed:${mineId}:cancel:${PREFIX}${Date.now()}`;
          const first = await claimCommit(sb, uid, { idempotencyKey: key, actionType: 'event_cancel', payload: { eventId: mineId } });
          if (first.status === 'unavailable') {
            gate('E7 · the commit ledger is not migrated here — claim degrades gracefully', true, 'action_commits absent');
          } else {
            await recordCommitResult(sb, uid, key, 'Cancelled: probe');
            const second = await claimCommit(sb, uid, { idempotencyKey: key, actionType: 'event_cancel', payload: { eventId: mineId } });
            gate('E7 · a second claim on the same key returns the FIRST result and never fires again',
              first.status === 'claimed' && second.status === 'duplicate'
              && (second as { priorResult: string | null }).priorResult === 'Cancelled: probe',
              `${first.status}/${second.status}`);
            await sb.from('action_commits').delete().eq('user_id', uid).eq('idempotency_key', key);
          }
        }
      }
    } finally {
      await wipe();
    }
  }

  // ══ E6 (source) · THE DEEDS DOOR'S STRUCTURE ═══════════════════════════════════════════════
  console.log('\nE6 — THE DEEDS DOOR (source census: the promises that must be structural):');
  {
    const door = src('app/api/events/[id]/deed/route.ts');
    const doorCode = code(door);
    const card = src('app/api/events/[id]/card/route.ts');

    gate('E6 · the door EXISTS and is POST-only (a read door cannot act)',
      !!door && /export async function POST\(/.test(door) && !/export async function (GET|PUT|DELETE)\(/.test(door));

    gate('E6 · the facts are RE-DERIVED server-side and the verb is checked against the ladder (the client\'s word is never trusted)',
      doorCode.includes('validEventVerbs(spec.facts)') && doorCode.includes('permitted.includes(asked)')
      && /status: 409/.test(doorCode));

    gate('E6 · the arguments go through the contract\'s own sanitizer, over the freshly-derived facts',
      /sanitizeProposal\(\{[\s\S]{0,400}?\}, spec\.facts/.test(doorCode));

    gate('E6 · the commit door is CLAIMED before any provider call, and a duplicate returns the prior result',
      doorCode.indexOf('claimCommit(') > 0
      && doorCode.indexOf('claimCommit(') < doorCode.indexOf('applyRsvp(')
      && doorCode.indexOf('claimCommit(') < doorCode.indexOf('applyCancel(')
      && doorCode.includes("claim.status === 'duplicate'"));

    gate('E6 · the idempotency key carries the event, the verb AND a digest of the arguments',
      /idempotencyKey = `event_deed:\$\{id\}:\$\{proposal\.verb\}:\$\{argsDigest\}`/.test(doorCode)
      && doorCode.includes("createHash('sha256')"));

    gate('E6 · a failed write RELEASES the claim — on an unreachable target AND in the write\'s own catch',
      (doorCode.match(/releaseCommitClaim\(/g) ?? []).length >= 2
      && /catch \(err: unknown\) \{\s*\n?\s*await releaseCommitClaim\(/.test(doorCode));

    gate('E6 · every deed is LOGGED, non-fatally, with its own activity type',
      doorCode.includes('logActivity(') && doorCode.includes("calendar_rsvp")
      && doorCode.includes('calendar_rescheduled') && doorCode.includes('calendar_cancelled'));

    gate('E6 · nothing on this door is marked UNDOABLE — restore.ts has no lane for a calendar deed',
      !/undoable/.test(doorCode)
      && !/calendar_(rsvp|rescheduled|cancelled)/.test(code(src('lib/activity/restore.ts'))));

    gate('E6 · the door answers with a SPEC on success, so the card re-renders truth instead of hope',
      /ok: true, done, spec:/.test(doorCode));

    gate('E6 · the provider write goes through the ONE shared helper — no rsvp/invite-sender import here',
      !/from '@\/lib\/calendar\/(rsvp|invite-sender)'/.test(door)
      && /from '@\/lib\/calendar\/event-writes'/.test(door));

    gate('E6 · the UI-button routes were MOVED onto the same helper (three callers, one write path)',
      /from '@\/lib\/calendar\/event-writes'/.test(src('app/api/meetings/[id]/rsvp/route.ts'))
      && /from '@\/lib\/calendar\/event-writes'/.test(src('app/api/meetings/[id]/route.ts'))
      && !/from '@\/lib\/calendar\/rsvp'/.test(src('app/api/meetings/[id]/rsvp/route.ts'))
      && !/from '@\/lib\/calendar\/invite-sender'/.test(src('app/api/meetings/[id]/route.ts')));

    gate('E6 · the CARD door is read-only and re-validates a stored proposal against LIVE facts',
      !!card && /export async function GET\(/.test(card) && !/export async function POST\(/.test(card)
      && code(card).includes('sanitizeProposal(') && code(card).includes('spec.facts'));

    gate('E6 · NOTHING in the chat lane can fire a calendar write (the preparer holds no provider call)',
      !/apply(Rsvp|Reschedule|Cancel|EventUpdate)\(/.test(code(src('lib/tools/prepare-event-action.ts')))
      && !/apply(Rsvp|Reschedule|Cancel|EventUpdate)\(/.test(code(src('lib/converse/index.ts'))));
  }

  // ══ E8 · THE REGISTRY, THE DOORS AND THE POINTERS ══════════════════════════════════════════
  console.log('\nE8 — THE REGISTRY + THE DOORS + THE POINTER LAW:');
  {
    const {
      CAPABILITY_MAP, registryParity, doorParity, presentationParity, presentsParity,
      presentsKind, presentsCollectionKind, resultIsProse, resultIsPresentation, capabilitiesFor,
    } = await import('../lib/work/surface-registry');
    const { COLLECTION_KINDS } = await import('../lib/present/collection');
    const { buildCoworkerTools, COWORKER_CHAT_TOOLS, WORKER_ONLY_CHAT_TOOLS } = await import('../lib/work/chat-tool-defs');
    const { CHIEF_TOOL_DEFS } = await import('../lib/converse');
    const ALL_ON = { email: true, meetings: true, drive: true, agents: true, studio: true } as unknown as
      Parameters<typeof buildCoworkerTools>[2];

    const chief = CHIEF_TOOL_DEFS.map((d) => (d as { name: string }).name);
    const coworker = buildCoworkerTools(['kb', 'inbox', 'calendar', 'web'], true, ALL_ON).map((t) => t.name);

    gate('E8 · prepare_event_action has a REGISTRY ROW, on both conversational doors, gated on meetings',
      !!CAPABILITY_MAP.prepare_event_action && CAPABILITY_MAP.prepare_event_action.built
      && CAPABILITY_MAP.prepare_event_action.feature === 'meetings'
      && CAPABILITY_MAP.prepare_event_action.conversational === true
      && JSON.stringify(CAPABILITY_MAP.prepare_event_action.exposure) === JSON.stringify(['chief_of_staff', 'coworker']));

    gate('E8 · it is a PREPARER: reversible, non-mutating, and no committing calendar verb joined a chat door',
      CAPABILITY_MAP.prepare_event_action.irreversible === false
      && CAPABILITY_MAP.prepare_event_action.mutates === false
      && !chief.includes('send_calendar_invite') && !coworker.includes('send_calendar_invite'));

    gate('E8 · BOTH doors actually offer it, and parity holds across the whole registry',
      chief.includes('prepare_event_action') && coworker.includes('prepare_event_action')
      && !!COWORKER_CHAT_TOOLS.prepare_event_action && WORKER_ONLY_CHAT_TOOLS.has('prepare_event_action')
      && doorParity({ chief, coworker }).length === 0 && registryParity().length === 0,
      doorParity({ chief, coworker }).join(' · '));

    gate('E8 · a meetings-off workspace never sees it offered (the tier law: a verb is a claim)',
      !buildCoworkerTools(['kb', 'inbox', 'calendar', 'web'], true, { ...ALL_ON, meetings: false })
        .some((t) => t.name === 'prepare_event_action'));

    gate('E8 · FLOORS: both doors keep every verb they had (the chief slice and the coworker slice only grew)',
      chief.length >= 29 && coworker.length >= 26, `chief=${chief.length} coworker=${coworker.length}`);

    gate('E8 · every chief-slice tool still DECLARES its result kind, and the presents declarations are coherent',
      presentationParity().length === 0 && presentsParity().length === 0,
      [...presentationParity(), ...presentsParity()].join(' · '));

    gate('E8 · a PRESENTATION is servable like prose but is not prose; the collection reader never sees "event"',
      resultIsPresentation('prepare_event_action') && !resultIsProse('prepare_event_action')
      && presentsKind('prepare_event_action') === 'event'
      && presentsCollectionKind('prepare_event_action') === null
      && presentsCollectionKind('list_tasks') === 'workflows'
      && !resultIsPresentation('some_tool_shipped_tomorrow'));

    gate('E8 · every declared `presents` kind is one the contract can render (a collection kind, or the event card)',
      Object.values(CAPABILITY_MAP).map((c) => c.presents).filter(Boolean)
        .every((k) => k === 'event' || (COLLECTION_KINDS as readonly string[]).includes(k as string)));

    gate('E8 · it is NOT an item-plan step (conversational rows stay out of the classifier prompt)',
      !capabilitiesFor('workflow').some((c) => c.tool === 'prepare_event_action'));

    // ── THE POINTER LAW, on both persisting surfaces ──
    const askRoute = code(src('app/api/home/ask/route.ts'));
    const dmRoute = code(src('app/api/work/threads/[id]/chat/route.ts'));
    const conv = code(src('lib/converse/index.ts'));

    gate('E8 · the Home room persists a POINTER — the kind, the event id and the armed proposal; never the spec',
      askRoute.includes("key: 'event_card'") && askRoute.includes('refId: turn.event.spec.id')
      && askRoute.includes('proposal: turn.event.spec.proposal')
      && !/state: \{[^}]*verbs/.test(askRoute));

    // RE-POINTED (W4-C, Sep 22): the pointer's shape moved into the ONE shared helper
    // (lib/present/pointer.ts) when a THIRD producer — the AgentOS bridge — began writing it. The
    // law is unchanged and now reads the helper itself, so no producer can widen it.
    gate('E8 · the DM thread persists the same pointer shape and nothing more',
      dmRoute.includes('events: allEventCards')
      && /allEventCards\.push\(eventPointer\(spec\)\)/.test(dmRoute)
      && (() => {
        const ptr = code(src('lib/present/pointer.ts'));
        const i = ptr.indexOf('export function eventPointer(');
        const body = i === -1 ? '' : ptr.slice(i, i + 300);
        return /eventId: spec\.id/.test(body) && /proposal: spec\.proposal/.test(body)
          && !/verbs/.test(body) && !/attendees/.test(body);
      })());

    // ── THE ROOM SHOWS WHAT IT READ (W4-C, Sep 22) ──
    // The one core handed rooms `turn.event` all along; nothing wrote the turn, so nothing
    // rendered. The room's converse door (`/api/items/steer`) now persists the SAME pointer
    // component the Home chat stores, and the rail mounts the SAME EventCard.
    const steerRoute = code(src('app/api/items/steer/route.ts'));
    const railSrc = code(src('components/home/item-rail.tsx'));
    gate('E8 · the ROOM door can produce an event present — it returns the served spec AND writes the pointer turn, through the shared component builder',
      steerRoute.includes('...(turn.event ? { event: turn.event } : {})')
      && steerRoute.includes('component: eventTurnComponent(turn.event.spec)')
      && /dedupeKey: `event:\$\{turn\.event\.spec\.id\}`/.test(steerRoute)
      && !/state: \{[^}]*verbs/.test(steerRoute));

    gate('E8 · the room MOUNTS the one event card — live turns paint the served spec, rehydrated ones hand over the pointer and the host re-reads the verbs',
      railSrc.includes('<EventCard')
      && /t\.component\?\.key === 'event_card'/.test(railSrc)
      && /pointer: \{\s*\n?\s*eventId: evId,/.test(railSrc)
      && !/turn\.event = \{[^}]*verbs/.test(railSrc));

    gate('E8 · the live frames carry the served spec (the card paints at once; the reload re-reads)',
      dmRoute.includes("send({ type: 'event', event: { id: crypto.randomUUID(), spec } })")
      && askRoute.includes('...(turn.event ? { event: turn.event } : {})'));

    gate('E8 · the conversation core serves the CODE-WRITTEN framing on the fast path — never modelText from a data read',
      conv.includes('resultIsPresentation(verdict.command.tool)')
      && /if \(isEventPresent\(present\)\) \{\s*\n?\s*return \{ say: out\.modelText/.test(conv)
      // …and the DATA lane is untouched: a data read still may not be served as the answer.
      && conv.includes('if (verdict.command && resultIsProse(verdict.command.tool))'));

    gate('E8 · the agent loop carries the event beside its prose (SPEAK → SHOW), and it never reaches the model',
      conv.includes('if (isEventPresent(out.present)) event = { id: out.present.spec.id, spec: out.present.spec };')
      && conv.includes('...(event ? { event } : {})')
      && /content: isToolData\(out\)\s*\n?\s*\? clipForPrompt\(out\.modelText/.test(conv));

    gate('E8 · the tool definition names the WHOLE verb space and promises it changes nothing',
      prepareEventActionDefinition.name === 'prepare_event_action'
      && ['accept', 'tentative', 'decline', 'reschedule', 'cancel']
        .every((v) => JSON.stringify(prepareEventActionDefinition.input_schema.properties.verb).includes(v))
      && /NEVER changes anything/.test(prepareEventActionDefinition.description));

    gate('E8 · the chip is OURS — a label and a summary exist, and neither echoes the tool\'s own result',
      (() => {
        const { toolLabel, summarizeToolResult } = require('../lib/work/tool-summaries');
        return toolLabel('prepare_event_action') !== 'prepare event action'
          && summarizeToolResult('prepare_event_action', 'Showed the user a card for "X" with: accept, decline.') === 'Pulled up the meeting'
          && summarizeToolResult('prepare_event_action', "I couldn't find that meeting on your calendar.") === 'Meeting not found';
      })());
  }

  // ══ unit riders on the builder's pure halves ═══════════════════════════════════════════════
  console.log('\nE3 — the builder\'s pure halves (seat · response · attendees · window):');
  {
    const mine = new Set(['me@example-co.test']);
    gate('E3 · responseOf maps every provider spelling onto the contract\'s four words',
      responseOf({ status: 'accepted' }) === 'accepted'
      && responseOf({ responseStatus: 'tentativelyAccepted' }) === 'tentative'
      && responseOf({ status: 'declined' }) === 'declined'
      && responseOf({ responseStatus: 'notResponded' }) === 'needsAction'
      && responseOf({ status: 'something-new' }) === 'needsAction'
      && responseOf({}) === null && responseOf(null) === null);

    gate('E3 · the seat ladder: organizer outranks attendee; a stranger\'s event is UNKNOWN',
      seatOf({ organizer: 'me@example-co.test', attendees: [{ email: 'me@example-co.test', status: 'accepted' }] }, mine).seat === 'organizer'
      && seatOf({ organizer: 'other@example-partner.test', attendees: [{ email: 'me@example-co.test' }] }, mine).seat === 'invitee'
      && seatOf({ organizer: null, attendees: [] }, mine).seat === 'solo'
      && seatOf({ organizer: 'other@example-partner.test', attendees: [{ email: 'third@example-partner.test' }] }, mine).seat === 'unknown');

    gate('E3 · the legacy Graph attendee shape still resolves (emailAddress.address / .name)',
      seatOf({ organizer: null, attendees: [{ emailAddress: { address: 'ME@example-co.test', name: 'Me' } }] }, mine).seat === 'solo'
      && otherAttendees({ attendees: [{ emailAddress: { address: 'x@example-partner.test', name: 'Alex Partner' } }] }, mine).attendees[0] === 'Alex Partner');

    gate('E3b · the humaniser reads a local part as a NAME — separators and digit runs out, Title Case in',
      humanizeAddress('sam.rivera@example-partner.test') === 'Sam Rivera'
      && humanizeAddress('dana_okonkwo-b2@example-partner.test') === 'Dana Okonkwo'
      && humanizeAddress('WREN@example-partner.test') === 'Wren'
      && !humanizeAddress('sam.rivera@example-partner.test').includes('@'),
      humanizeAddress('dana_okonkwo-b2@example-partner.test'));

    gate('E3b · rung 1 wins when the provider gave a real name — and LOSES when that "name" is the address again',
      otherAttendees({ attendees: [{ email: 'sam.rivera@example-partner.test', name: 'Sam R.' }] }, mine).attendees[0] === 'Sam R.'
      && otherAttendees({ attendees: [{ email: 'sam.rivera@example-partner.test', name: 'sam.rivera@example-partner.test' }] }, mine).attendees[0] === 'Sam Rivera');

    gate('E3b · a resolved name (registry / mail) outranks the humanised fallback',
      otherAttendees({ attendees: [{ email: 'sam.rivera@example-partner.test' }] }, mine,
        new Map([['sam.rivera@example-partner.test', 'Sam Rivera-Costa']])).attendees[0] === 'Sam Rivera-Costa');

    const many = otherAttendees({ attendees: Array.from({ length: 9 }, (_, i) => ({ email: `p${i}@example-partner.test` })) }, mine);
    gate('E3 · the attendee cap is never silent — the rest are COUNTED',
      many.attendees.length === EVENT_ATTENDEE_CAP && many.more === 3);

    const win = eventWindowMs({ is_all_day: true, start_time: '2026-09-24', end_time: '2026-09-26', timezone: TZ } as never, TZ);
    gate('E3 · an all-day pair is read as CALENDAR DAYS with an exclusive end (it cannot shift by a zone)',
      win.allDay && win.startMs === zonedTimeToUtc('2026-09-24', '00:00', TZ) && win.endMs === zonedTimeToUtc('2026-09-26', '00:00', TZ));

    const oneDay = eventWindowMs({ is_all_day: true, start_time: '2026-09-24', end_time: null, timezone: TZ } as never, TZ);
    gate('E3 · an all-day row with no end is ONE day, never an empty span',
      oneDay.endMs - oneDay.startMs === DAY_MS);

    const timed = eventWindowMs({ is_all_day: false, start_time: '2026-09-24T09:00:00.000Z', end_time: null, timezone: TZ } as never, TZ);
    gate('E3 · a timed row with no end is assumed one hour (the slot picker\'s own assumption)',
      timed.endMs - timed.startMs === 60 * 60_000 && !timed.allDay);

    const spec = composeEventSpec({
      id: 'abc', event_id: 'g1', connection_id: 'c1', provider: 'gmail', title: '  Weekly   sync  ',
      start_time: new Date(zonedTimeToUtc('2026-09-24', '09:00', TZ)).toISOString(),
      end_time: new Date(zonedTimeToUtc('2026-09-24', '09:30', TZ)).toISOString(),
      timezone: TZ, is_all_day: false, status: 'confirmed', location: 'Room 2',
      organizer: 'other@example-partner.test',
      attendees: [{ email: 'other@example-partner.test', name: 'Jordan' }, { email: 'me@example-co.test', status: 'declined' }],
    }, { tz: TZ, mine, now: new Date(zonedTimeToUtc('2026-09-22', '09:00', TZ)), writable: true });

    gate('E3 · the composed spec is a valid EventSpec: squeezed title, paired day label, clocks, seat and verbs',
      isEventSpec(spec) && spec.title === 'Weekly sync' && spec.dayLabel === 'Thu 24 Sep'
      && spec.timeLabel === '09:00–09:30' && spec.facts.seat === 'invitee'
      && spec.facts.myResponse === 'declined'
      && JSON.stringify(spec.verbs) === JSON.stringify(['accept', 'tentative']),
      `${spec.dayLabel} ${spec.timeLabel} ${spec.verbs.join(',')}`);

    gate('E3 · a CANCELLED row is not writable, whatever its seat (nothing is left to act on)',
      composeEventSpec({
        id: 'abc', event_id: 'g1', connection_id: 'c1', provider: 'gmail', title: 'Weekly sync',
        start_time: new Date(zonedTimeToUtc('2026-09-24', '09:00', TZ)).toISOString(),
        end_time: new Date(zonedTimeToUtc('2026-09-24', '09:30', TZ)).toISOString(),
        timezone: TZ, is_all_day: false, status: 'cancelled', location: null,
        organizer: 'other@example-partner.test',
        attendees: [{ email: 'me@example-co.test' }],
      },
        { tz: TZ, mine, now: new Date(zonedTimeToUtc('2026-09-22', '09:00', TZ)), writable: true }).verbs.length === 0);

    gate('E3 · the local row follows the provider on an RSVP — BOTH keys stamped, only the user\'s own entry',
      (() => {
        const out = attendeesWithResponse({ attendees: [{ email: 'me@example-co.test' }, { email: 'other@example-partner.test' }] }, 'me@example-co.test', 'declined');
        return out[0].status === 'declined' && out[0].responseStatus === 'declined'
          && out[1].status === undefined
          && JSON.stringify(attendeeAddressesOf({ attendees: [{ email: 'A@example-co.test' }, { email: 'a@example-co.test' }] })) === JSON.stringify(['a@example-co.test']);
      })());
  }

  console.log(`\n════ ${pass}/${pass + fail} ════`);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log(`  · ${f}`)); }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
