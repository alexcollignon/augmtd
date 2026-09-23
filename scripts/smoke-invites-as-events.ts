// ════════════════════════════════════════════════════════════════════════════════════════════════
// INVITES ARE EVENTS + EXTRACTION DIRECTION — THE GATE (stabilization W7.4). ZERO AI, ZERO DB.
//
// Tier 1 — the pure cores on fixtures (tests/fixtures/invites.ts — Google + Outlook shapes, a
// recurring series, a cancellation, Graph's eventMessage): the ICS parse, THE UID LINK (identity
// only — driven through a recording fake client, so the gate proves which filters the link asks),
// the invite object (RSVP verbs only for an invitee of a live row; no row ⇒ no verbs; a heuristic
// legacy link is never trusted), and THE DIRECTION FLOOR.
// Tier 2 — source floors: the organizer+next-start heuristic is GONE from the sync; every sync lane
// (main · recovery · fast path) links by identity; the calendar sync stores Outlook's iCalUId; the
// room's object mount branches to the kit's EVENT card and keeps the mail one click away; the
// extraction asks for the doer and the retired description-keyword backstop is gone.
// Run: npx tsx scripts/smoke-invites-as-events.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { parseIcs, inviteFromGraphEventMessage, inviteIsCancelled, sameMeetingUid } from '../lib/calendar/ics';
import { linkInviteToEvent, pickOccurrence, compactInvite } from '../lib/calendar/invite-link';
import { composeInviteCard, inviteSpecOf, storedInviteOf, buildInviteObject } from '../lib/present/invite-object';
import { readInviteObject } from '../lib/inbox/thread-door';
import { directionFloor } from '../lib/commitments/direction';
import type { EventSpec } from '../lib/present/event';
import {
  GOOGLE_REQUEST, OUTLOOK_REQUEST, OUTLOOK_UID, RECURRING_REQUEST, CANCEL, GRAPH_EVENT_MESSAGE, exchangeEmbeddedUid,
} from '../tests/fixtures/invites';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) => src(p).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const j = (v: unknown) => JSON.stringify(v);

// ── a recording fake Supabase client (no network) ─────────────────────────────────────────────
type Filter = [string, string, unknown];
type Table = Record<string, unknown>[];
function fakeClient(tables: Record<string, Table>) {
  const log: Array<{ table: string; filters: Filter[] }> = [];
  const matches = (row: Record<string, unknown>, f: Filter): boolean => {
    const [op, col, val] = f;
    const path = col.split('->>');
    let v: unknown = row;
    if (path.length === 2) v = (row[path[0]] as Record<string, unknown> | null)?.[path[1]];
    else v = row[col];
    if (op === 'eq') return v === val;
    if (op === 'ilike') {
      const re = new RegExp('^' + String(val).split(/(?<!\\)%/).map((s) => s.replace(/\\([%_\\])/g, '$1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
      return re.test(String(v ?? ''));
    }
    if (op === 'in') return (val as unknown[]).includes(v);
    return true;
  };
  const build = (table: string) => {
    const filters: Filter[] = [];
    log.push({ table, filters });
    const run = () => (tables[table] ?? []).filter((r) => filters.every((f) => matches(r, f)))
      .map((r) => ({ ...r, gcal_uid: (r.metadata as Record<string, unknown> | undefined)?.iCalUID ?? null, ocal_uid: (r.metadata as Record<string, unknown> | undefined)?.iCalUId ?? null, orig_start: null }));
    const q: Record<string, unknown> = {
      select: () => q, order: () => q, limit: () => q, not: () => q, range: () => q,
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return q; },
      ilike: (c: string, v: unknown) => { filters.push(['ilike', c, v]); return q; },
      in: (c: string, v: unknown) => { filters.push(['in', c, v]); return q; },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return q;
  };
  return {
    log,
    client: { from: (t: string) => build(t), auth: { getUser: async () => ({ data: { user: null } }) } } as never,
  };
}

(async () => {
  // ── TIER 1 · THE ICS PARSE ───────────────────────────────────────────────────────────────────
  console.log('THE INVITE, READ BY ITS OWN IDENTITY:');
  const g = parseIcs(GOOGLE_REQUEST);
  ok('Google shape: UID · METHOD · SEQUENCE · TZID→UTC · escaped text · CN people',
    g?.uid === '7kq2abc9fixture0001@google.com' && g.method === 'REQUEST' && g.sequence === 2
    && g.startISO === '2026-11-15T10:00:00.000Z' && g.summary === '[TBC] Acme @ HQ, quarterly review'
    && g.organizer?.name === 'Sam Rivera' && g.attendees.length === 3, j(g));
  const o = parseIcs(OUTLOOK_REQUEST);
  ok('Outlook shape: Windows TZID (CEST) → 12:00Z · the Exchange hex UID kept verbatim',
    o?.uid === OUTLOOK_UID && o.startISO === '2026-07-07T12:00:00.000Z' && o.endISO === '2026-07-07T12:30:00.000Z', j(o));
  const r = parseIcs(RECURRING_REQUEST);
  ok('recurring: the MASTER speaks (RRULE kept, no RECURRENCE-ID), DURATION gives the end',
    r?.recurring === true && r.recurrenceId === null && r.endISO === '2026-10-06T09:45:00.000Z', j(r));
  const cx = parseIcs(CANCEL);
  ok('cancel: METHOD:CANCEL + STATUS:CANCELLED read as cancelled', !!cx && inviteIsCancelled(cx));
  const gm = inviteFromGraphEventMessage(GRAPH_EVENT_MESSAGE);
  ok('Graph eventMessage maps to the SAME shape, carrying the provider event id',
    gm?.uid === OUTLOOK_UID && gm.method === 'REQUEST' && gm.providerEventId === 'AAMkAG-event-fixture' && gm.startISO === '2026-07-07T12:00:00.000Z', j(gm));
  ok('an Exchange id embedding a Google UID is the same meeting; strangers are not',
    sameMeetingUid(exchangeEmbeddedUid(g!.uid), g!.uid) && !sameMeetingUid('a@google.com', 'b@google.com'));

  // ── TIER 1 · THE UID LINK (identity only) ────────────────────────────────────────────────────
  console.log('THE LINK IS AN IDENTITY, NEVER A HEURISTIC:');
  const now = new Date('2026-09-23T12:00:00Z');
  // The live incident, as data: the SAME organizer's next confirmed future event is an unrelated
  // check-in — the heuristic's pick. The invite's own UID row lies further out.
  const decoy = { id: 'ev-decoy', user_id: 'u1', provider: 'gmail', connection_id: 'c1', event_id: 'g-decoy', organizer: 'sam.rivera@acme.test',
    start_time: '2026-10-01T09:00:00Z', end_time: '2026-10-01T09:30:00Z', status: 'confirmed', metadata: { iCalUID: 'checkin-unrelated@google.com' } };
  const truth = { id: 'ev-truth', user_id: 'u1', provider: 'gmail', connection_id: 'c1', event_id: 'g-truth', organizer: 'sam.rivera@acme.test',
    start_time: '2026-11-15T10:00:00Z', end_time: '2026-11-15T11:30:00Z', status: 'confirmed', metadata: { iCalUID: g!.uid } };
  const outlookRow = { id: 'ev-outlook', user_id: 'u1', provider: 'outlook', connection_id: 'c2', event_id: 'AAMkAG-event-fixture',
    start_time: '2026-07-07T12:00:00', end_time: '2026-07-07T12:30:00', status: 'confirmed', metadata: { iCalUId: OUTLOOK_UID } };
  const embeddedRow = { id: 'ev-embedded', user_id: 'u1', provider: 'outlook', connection_id: 'c2', event_id: 'o-emb',
    start_time: '2026-11-15T10:00:00', end_time: '2026-11-15T11:30:00', status: 'confirmed', metadata: { iCalUId: exchangeEmbeddedUid(g!.uid) } };
  const f1 = fakeClient({ calendar_events: [decoy, truth] });
  const l1 = await linkInviteToEvent(f1.client, 'u1', g, { now, connectionId: 'c1' });
  ok('the invite links to ITS OWN row (the organizer\'s next event is the decoy, never picked)', l1 === 'ev-truth', String(l1));
  const asked = f1.log.flatMap((q) => q.filters.map((x) => x[1]));
  ok('the link asks ONLY identity filters — never organizer, never a start-time ordering',
    !asked.includes('organizer') && !asked.includes('start_time') && asked.includes('metadata->>iCalUID'), j(asked));
  const f2 = fakeClient({ calendar_events: [decoy] });
  ok('no identity match → NO link (beyond the horizon is null, never the nearest thing)',
    (await linkInviteToEvent(f2.client, 'u1', g, { now })) === null);
  const f3 = fakeClient({ calendar_events: [outlookRow, decoy] });
  ok('Graph\'s own event pointer links directly', (await linkInviteToEvent(f3.client, 'u1', gm, { now })) === 'ev-outlook');
  const f4 = fakeClient({ calendar_events: [embeddedRow] });
  ok('a Google .ics finds the Outlook row that embeds its UID', (await linkInviteToEvent(f4.client, 'u1', g, { now })) === 'ev-embedded');
  // A containment NOMINEE that is not the same meeting is refused in code.
  const lookalike = { ...embeddedRow, id: 'ev-lookalike', metadata: { iCalUId: exchangeEmbeddedUid(`${g!.uid}.extra`) } };
  const f5 = fakeClient({ calendar_events: [lookalike] });
  ok('a containment look-alike (a longer UID) is NOT the meeting', (await linkInviteToEvent(f5.client, 'u1', g, { now })) === null);
  ok('a series: the occurrence at the invite\'s own start is picked; else the next one ahead',
    pickOccurrence([
      { id: 'a', event_id: 'x', connection_id: 'c', provider: 'gmail', start_time: '2026-10-06T09:00:00Z', end_time: '2026-10-06T09:45:00Z', status: 'confirmed', gcal_uid: 's', ocal_uid: null, orig_start: null },
      { id: 'b', event_id: 'y', connection_id: 'c', provider: 'gmail', start_time: '2026-10-13T10:00:00Z', end_time: '2026-10-13T10:45:00Z', status: 'confirmed', gcal_uid: 's', ocal_uid: null, orig_start: { dateTime: '2026-10-13T09:00:00Z' } },
    ], { recurrenceId: '2026-10-13T09:00:00.000Z', startISO: null, startDate: null }, { now })?.id === 'b'
    && pickOccurrence([
      { id: 'p', event_id: 'x', connection_id: 'c', provider: 'gmail', start_time: '2026-09-01T09:00:00Z', end_time: '2026-09-01T09:45:00Z', status: 'confirmed', gcal_uid: 's', ocal_uid: null, orig_start: null },
      { id: 'n', event_id: 'y', connection_id: 'c', provider: 'gmail', start_time: '2026-09-29T09:00:00Z', end_time: '2026-09-29T09:45:00Z', status: 'confirmed', gcal_uid: 's', ocal_uid: null, orig_start: null },
    ], { recurrenceId: null, startISO: '2026-08-04T09:00:00.000Z', startDate: null }, { now })?.id === 'n');
  ok('compactInvite caps what an item keeps', (compactInvite({ ...g!, attendees: Array.from({ length: 80 }, (_, i) => ({ address: `p${i}@acme.test`, name: null, partstat: null, role: null })) })?.attendees.length ?? 0) === 40);

  // ── TIER 1 · THE INVITE OBJECT — no deed without an event row ──────────────────────────────
  console.log('THE INVITE RENDERS AS ITS MEETING (and never offers a fake deed):');
  const mine = new Set(['jordan@example.test']);
  const card = composeInviteCard(g!, { tz: 'Europe/Lisbon', mine, now });
  ok('no row: title / when / where / organiser / guests all composed by code',
    card.title === '[TBC] Acme @ HQ, quarterly review' && /15/.test(card.dayLabel) && card.timeLabel === '10:00–11:30'
    && card.location === 'Acme HQ, Room 4' && card.organizer === 'Sam Rivera' && card.attendees.join('|') === 'Lee, Morgan', j(card));
  ok('…the user is never their own guest; the facts card has no verb field at all',
    !card.attendees.some((a) => /jordan/i.test(a)) && !('verbs' in card));
  const base: EventSpec = {
    id: 'ev-truth', title: 't', dayLabel: 'Sun 15 Nov', timeLabel: '10:00–11:30', startISO: '2026-11-15T10:00:00.000Z', endISO: '2026-11-15T11:30:00.000Z',
    attendees: [], facts: { seat: 'invitee', myResponse: 'needsAction', passed: false, allDay: false, writable: true },
    verbs: ['accept', 'tentative', 'decline'], noteVerbs: ['decline'],
  };
  ok('a live row + the user an INVITEE → exactly the RSVP verbs', j(inviteSpecOf(base, g!).verbs) === j(['accept', 'tentative', 'decline']));
  ok('organiser seat → NO verbs on the invite object (no reschedule/cancel from an invite)',
    inviteSpecOf({ ...base, facts: { ...base.facts, seat: 'organizer' }, verbs: ['reschedule', 'cancel'] }, g!).verbs.length === 0);
  ok('a cancellation → NO verbs, whatever the row permits', inviteSpecOf(base, cx!).verbs.length === 0 && inviteSpecOf(base, cx!).noteVerbs?.length === 0);
  ok('a legacy item (heuristic calendar_event_id, no parsed invite) is NOT an invite object',
    storedInviteOf({ calendar_event_id: 'ev-decoy' }) === null
    && (await buildInviteObject(fakeClient({}).client, 'u1', { calendar_event_id: 'ev-decoy' })) === null);
  const noRow = await buildInviteObject(fakeClient({ calendar_events: [] }).client, 'u1', { invite: g, calendar_event_id: 'ev-missing' }, { now });
  ok('a linked id whose row cannot be read degrades to the facts card — spec null, no verbs',
    !!noRow && noRow.spec === null && !!noRow.card, j(noRow));
  ok('the thread door keeps an invite object only whole (malformed → mail)',
    readInviteObject({ spec: { id: 'x' }, card: null }) === null && readInviteObject({ card: card, spec: null })?.card?.title === card.title
    && readInviteObject(null) === null);

  // ── TIER 1 · THE DIRECTION FLOOR ───────────────────────────────────────────────────────────
  console.log('THE DIRECTION FLOOR (who DOES it):');
  const user = { name: 'Jordan Probe', aliases: ['jordan@example.test'] };
  const cp = 'Sam Rivera <sam.rivera@acme.test>';
  ok('the live incident: "Contact <cp> to schedule demo" / "Send <cp> educational material" → you_owe',
    directionFloor({ direction: 'awaiting', description: 'Contact Sam to schedule demo', counterparty: cp }, user).direction === 'you_owe'
    && directionFloor({ direction: 'awaiting', description: 'Send Sam educational material', counterparty: cp }, user).direction === 'you_owe');
  ok('the doer is trusted and code-verified: the user in any form → you_owe; the counterparty → awaiting',
    directionFloor({ direction: 'awaiting', description: 'Schedule the demo', counterparty: cp, doer: 'jordan@example.test' }, user).direction === 'you_owe'
    && directionFloor({ direction: 'you_owe', description: 'Process the refund', counterparty: cp, doer: 'Sam Rivera' }, user).direction === 'awaiting');
  ok('the counterparty as a SOURCE ("from Sam") is not the object — awaiting stands',
    directionFloor({ direction: 'awaiting', description: 'Receive the signed contract from Sam', counterparty: cp }, user).direction === 'awaiting');

  // ── TIER 2 · SOURCE FLOORS ───────────────────────────────────────────────────────────────────
  console.log('SOURCE FLOORS:');
  const sync = code('lib/email-sync/sync-emails.ts');
  ok('the organizer + next-start heuristic is GONE from the sync',
    !/\.ilike\('organizer'/.test(sync) && !/Linked email to calendar_event/.test(sync));
  ok('every sync lane links by identity (main · recovery · fast path)',
    (sync.match(/await resolveInviteLink\(/g) ?? []).length >= 3 && /linkInviteToEvent\(/.test(sync));
  ok('the invite\'s facts ride the item on BOTH item writes and the fast path',
    (sync.match(/invite: _inviteStored/g) ?? []).length >= 2 && /invite: _fastInviteStored/.test(sync));
  ok('a pointer never names another recipient\'s calendar (link only for the connection owner)',
    /const calendarEventId = isCurrentUser \? _linkedEventId : null;/.test(sync));
  const link = code('lib/calendar/invite-link.ts');
  ok('the link module never reads organizer or orders by start to choose a meeting',
    !/organizer/.test(link) && !/order\('start_time'/.test(link) && /sameMeetingUid/.test(link));
  ok('the calendar sync stores Outlook\'s iCalUId (Google keeps the whole event)',
    /'iCalUId'/.test(code('lib/calendar/sync-calendar.ts')));
  ok('Gmail keeps the filename-less text/calendar part; Outlook carries the eventMessage type',
    /calendar_part/.test(code('lib/google/gmail.ts')) && /odata_type/.test(code('lib/microsoft/outlook.ts')));
  const mount = code('components/room/source-object.tsx');
  ok('the object mount branches: invite → the kit EVENT card (live spec or facts), mail one click away',
    /import EventCard from '@\/components\/home\/event-card'/.test(mount) && /<EventCard spec=/.test(mount)
    && /kind: 'event'/.test(mount) && /verbs: \[\]/.test(mount) && /View email/.test(mount));
  ok('the thread door serves the invite object', /buildInviteObject\(/.test(code('app/api/inbox/[id]/thread/route.ts')));
  const ext = code('lib/commitments/extract.ts');
  ok('the extraction asks for the DOER and the writer applies THE DIRECTION FLOOR',
    /"doer"/.test(ext) && (ext.match(/directionFloor\(/g) ?? []).length >= 2 && /doer: isUser \? 'user'/.test(ext));
  ok('the description-keyword backstop is retired (it flipped every user-sent deed)', !/FIRST_PERSON_PROMISE/.test(ext));
  ok('both repair scripts exist and are dry-run by default',
    /--apply requires --fetch and --yes/.test(src('scripts/repair-invite-links.ts'))
    && /--apply requires --yes/.test(src('scripts/repair-commitment-direction.ts')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
