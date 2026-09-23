// Invite fixtures for W7.4 (INVITES ARE EVENTS) — shared by tests/unit/ics.test.ts and
// scripts/smoke-invites-as-events.ts. Generic fakes only (Acme / Sam / Jordan), .test domains.

const CRLF = '\r\n';
const join = (lines: string[]) => lines.join(CRLF) + CRLF;

/** A Google-Calendar-shaped REQUEST: IANA TZID + VTIMEZONE, a FOLDED description, an escaped
 *  comma in the summary, CN-named attendees, PARTSTAT, the organizer also an attendee. */
export const GOOGLE_REQUEST = join([
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Lisbon',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:WET',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Lisbon:20261115T100000',
  'DTEND;TZID=Europe/Lisbon:20261115T113000',
  'DTSTAMP:20260920T090000Z',
  'ORGANIZER;CN=Sam Rivera:mailto:sam.rivera@acme.test',
  'UID:7kq2abc9fixture0001@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Sam Rivera;X-NUM-GUESTS=0:mailto:sam.rivera@acme.test',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=jordan@example.test;X-NUM-GUESTS=0:mailto:jordan@example.test',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=OPT-PARTICIPANT;PARTSTAT=TENTATIVE;CN="Lee, Morgan":mailto:morgan.lee@acme.test',
  'DESCRIPTION:Quarterly review\\, part one. Agenda:\\n1. Numbers\\n2. Plan for the',
  '  next quarter',
  'LOCATION:Acme HQ\\, Room 4',
  'SEQUENCE:2',
  'STATUS:CONFIRMED',
  'SUMMARY:[TBC] Acme @ HQ\\, quarterly review',
  'TRANSP:OPAQUE',
  'END:VEVENT',
  'END:VCALENDAR',
]);

/** An Exchange/Outlook-shaped REQUEST: a WINDOWS TZID resolved through its VTIMEZONE (the name is
 *  also in the Windows map), an Exchange hex UID, LF-only line endings (some relays normalise). */
export const OUTLOOK_UID = '040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5D90100000000000000001000000011223344556677889900AABBCCDDEEFF';
export const OUTLOOK_REQUEST = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'ORGANIZER;CN=Sam Rivera:mailto:sam.rivera@acme.test',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Jordan Probe:mailto:jordan@example.test',
  'DESCRIPTION;LANGUAGE=en-US:Let us align.\\n',
  `UID:${OUTLOOK_UID}`,
  'SUMMARY;LANGUAGE=en-US:Acme sync',
  'DTSTART;TZID=W. Europe Standard Time:20260707T140000',
  'DTEND;TZID=W. Europe Standard Time:20260707T143000',
  'CLASS:PUBLIC',
  'PRIORITY:5',
  'DTSTAMP:20260701T080000Z',
  'TRANSP:OPAQUE',
  'STATUS:CONFIRMED',
  'SEQUENCE:0',
  'LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\n');

/** The same zone, but through a TZID NOT in any map — only the VTIMEZONE rules can place it. */
export const VTIMEZONE_ONLY = OUTLOOK_REQUEST
  .replace(/W\. Europe Standard Time/g, 'Custom Zone Fixture');

/** A weekly series (RRULE) plus one moved occurrence (RECURRENCE-ID) — the master speaks. */
export const RECURRING_REQUEST = join([
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:series-fixture-42@acme.test',
  'DTSTART:20261006T090000Z',
  'DURATION:PT45M',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'SUMMARY:Weekly Acme standup',
  'ORGANIZER:mailto:sam.rivera@acme.test',
  'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:jordan@example.test',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:series-fixture-42@acme.test',
  'RECURRENCE-ID:20261013T090000Z',
  'DTSTART:20261013T100000Z',
  'DTEND:20261013T104500Z',
  'SUMMARY:Weekly Acme standup (moved)',
  'END:VEVENT',
  'END:VCALENDAR',
]);

/** A cancellation. */
export const CANCEL = join([
  'BEGIN:VCALENDAR',
  'METHOD:CANCEL',
  'BEGIN:VEVENT',
  'UID:7kq2abc9fixture0001@google.com',
  'SEQUENCE:3',
  'STATUS:CANCELLED',
  'DTSTART:20261115T100000Z',
  'DTEND:20261115T113000Z',
  'SUMMARY:[TBC] Acme @ HQ',
  'ORGANIZER;CN=Sam Rivera:mailto:sam.rivera@acme.test',
  'END:VEVENT',
  'END:VCALENDAR',
]);

/** An all-day offsite (VALUE=DATE). */
export const ALL_DAY = join([
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:allday-fixture@acme.test',
  'DTSTART;VALUE=DATE:20261201',
  'DTEND;VALUE=DATE:20261203',
  'SUMMARY:Acme offsite',
  'END:VEVENT',
  'END:VCALENDAR',
]);

/** A floating time (no Z, no TZID). */
export const FLOATING = join([
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:floating-fixture@acme.test',
  'DTSTART:20261110T150000',
  'DTEND:20261110T160000',
  'SUMMARY:Call',
  'END:VEVENT',
  'END:VCALENDAR',
]);

/** No UID — not an invite. */
export const NO_UID = join(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:x', 'DTSTART:20261110T150000Z', 'END:VEVENT', 'END:VCALENDAR']);

/** A Graph eventMessage with its event expanded (what Outlook serves instead of an .ics). */
export const GRAPH_EVENT_MESSAGE = {
  '@odata.type': '#microsoft.graph.eventMessageRequest',
  id: 'AAMkAG-message-fixture',
  meetingMessageType: 'meetingRequest',
  event: {
    id: 'AAMkAG-event-fixture',
    iCalUId: OUTLOOK_UID,
    subject: 'Acme sync',
    isAllDay: false,
    isCancelled: false,
    type: 'singleInstance',
    start: { dateTime: '2026-07-07T12:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-07-07T12:30:00.0000000', timeZone: 'UTC' },
    location: { displayName: 'Microsoft Teams Meeting' },
    organizer: { emailAddress: { name: 'Sam Rivera', address: 'sam.rivera@acme.test' } },
    attendees: [
      { type: 'required', status: { response: 'none' }, emailAddress: { name: 'Jordan Probe', address: 'jordan@example.test' } },
      { type: 'optional', status: { response: 'accepted' }, emailAddress: { name: 'Morgan Lee', address: 'morgan.lee@acme.test' } },
    ],
  },
};

/** How Exchange stores a Google-born meeting's UID: the GlobalObjectId with the external UID embedded
 *  after the "vCal-Uid" marker. Built here from the GOOGLE_REQUEST UID. */
export function exchangeEmbeddedUid(uid: string): string {
  const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();
  const data = hex('vCal-Uid') + '01000000' + hex(uid) + '00';
  const size = (data.length / 2).toString(16).padStart(8, '0').match(/../g)!.reverse().join('').toUpperCase();
  return '040000008200E00074C5B7101A82E008' + '00000000' + '0000000000000000' + '0000000000000000' + size + data;
}
