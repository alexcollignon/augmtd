// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE, READ BY ITS OWN IDENTITY (W7.4 — INVITES ARE EVENTS, docs/stabilization-plan.md).
//
// THE INCIDENT (production, Sep 23): an invitation email was linked to its calendar event by a
// HEURISTIC — "same organizer + the next confirmed future start" — and an October invite came back
// wearing an unrelated August check-in. 36 of 66 linked rows pointed at an event that shared not one
// title token with its invite. An invite CARRIES its identity: every iTIP message (RFC 5546) is a
// VCALENDAR whose VEVENT has a UID, and the calendar row it created carries the SAME UID (Google
// `iCalUID`, Graph `iCalUId`). This file reads that identity; lib/calendar/invite-link.ts joins on it.
//
// WHAT IT READS: METHOD (REQUEST · CANCEL · REPLY …), and from the one VEVENT it names — UID,
// SEQUENCE, SUMMARY, DTSTART/DTEND/DURATION (UTC · TZID · VTIMEZONE rules · floating · all-day),
// LOCATION, ORGANIZER, ATTENDEE (+CN, PARTSTAT, ROLE), RRULE, RECURRENCE-ID, STATUS. Graph's
// eventMessage (Outlook — no .ics part at all for Exchange-born meetings) maps onto the SAME shape
// through `inviteFromGraphEventMessage`, so every consumer reads ONE type.
//
// PURE and leaf: zero IO, zero AI. A malformed calendar answers `null` — never a half-invite.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { zonedTimeToUtc } from '@/lib/prepare/free-slots';

export type InviteAttendee = { address: string; name: string | null; partstat: string | null; role: string | null };

/** ONE invite, whichever door it came through. Every field is a fact the message itself carries. */
export type InviteFacts = {
  /** Where the facts were read: an iCalendar part, or Graph's eventMessage. */
  source: 'ics' | 'graph';
  /** THE IDENTITY. Never empty — an invite without a UID is not parsed at all. */
  uid: string;
  /** REQUEST · CANCEL · REPLY · PUBLISH · COUNTER … upper-cased; null when the part names none. */
  method: string | null;
  sequence: number;
  summary: string | null;
  /** The UTC instants (timed events). Null when the start could not be placed in time. */
  startISO: string | null;
  endISO: string | null;
  allDay: boolean;
  /** All-day only: the calendar dates (end EXCLUSIVE, the iCalendar convention). */
  startDate: string | null;
  endDate: string | null;
  /** A local time with no zone at all — placed in the fallback zone, and SAID so. */
  floating: boolean;
  location: string | null;
  organizer: { address: string; name: string | null } | null;
  attendees: InviteAttendee[];
  recurring: boolean;
  rrule: string | null;
  /** The one occurrence this message speaks for (an exception / a single-instance update). */
  recurrenceId: string | null;
  /** CONFIRMED · TENTATIVE · CANCELLED, when stated. */
  status: string | null;
  /** Graph only: the user's own calendar event id the message points at (calendar_events.event_id). */
  providerEventId?: string | null;
};

/** True when this invite says the meeting is OFF — the method or the event's own status. */
export const inviteIsCancelled = (i: Pick<InviteFacts, 'method' | 'status'> | null | undefined): boolean =>
  !!i && (i.method === 'CANCEL' || i.status === 'CANCELLED');

// ── lines, properties, parameters ────────────────────────────────────────────────────────────────

type Prop = { name: string; params: Record<string, string>; value: string };

/** RFC 5545 §3.1 — a CRLF followed by ONE space or tab continues the previous line. */
export function unfoldIcs(text: string): string[] {
  return String(text ?? '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter(Boolean);
}

/** Split on `sep` outside double quotes. */
function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of s) {
    if (ch === '"') { q = !q; cur += ch; continue; }
    if (ch === sep && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseIcsLine(line: string): Prop | null {
  let q = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === ':' && !q) { colon = i; break; }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = splitOutsideQuotes(head, ';');
  const name = rawName.trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { name, params, value };
}

/** RFC 5545 §3.3.11 TEXT unescaping. */
export function unescapeIcsText(v: string): string {
  return String(v ?? '')
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

// ── the component tree ───────────────────────────────────────────────────────────────────────────

type Comp = { type: string; props: Prop[]; children: Comp[] };

function buildTree(lines: string[]): Comp | null {
  const root: Comp = { type: 'ROOT', props: [], children: [] };
  const stack: Comp[] = [root];
  for (const line of lines) {
    const p = parseIcsLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const c: Comp = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      stack[stack.length - 1].children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].props.push(p);
    }
  }
  return root.children.find((c) => c.type === 'VCALENDAR') ?? null;
}

const prop = (c: Comp, name: string): Prop | undefined => c.props.find((p) => p.name === name);
const props = (c: Comp, name: string): Prop[] => c.props.filter((p) => p.name === name);

// ── time ─────────────────────────────────────────────────────────────────────────────────────────

/** Common Windows zone names Exchange writes into TZID → IANA. A zone absent here falls through to
 *  the VTIMEZONE rules the message itself carries, never to a guess. */
const WINDOWS_ZONES: Record<string, string> = {
  'utc': 'UTC', 'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik',
  'w. europe standard time': 'Europe/Berlin', 'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw', 'romance standard time': 'Europe/Paris',
  'e. europe standard time': 'Europe/Chisinau', 'fle standard time': 'Europe/Kiev',
  'gtb standard time': 'Europe/Bucharest', 'egypt standard time': 'Africa/Cairo',
  'south africa standard time': 'Africa/Johannesburg', 'arabian standard time': 'Asia/Dubai',
  'arab standard time': 'Asia/Riyadh', 'russian standard time': 'Europe/Moscow',
  'india standard time': 'Asia/Kolkata', 'singapore standard time': 'Asia/Singapore',
  'china standard time': 'Asia/Shanghai', 'tokyo standard time': 'Asia/Tokyo',
  'aus eastern standard time': 'Australia/Sydney', 'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago', 'mountain standard time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles', 'e. south america standard time': 'America/Sao_Paulo',
  'gmt': 'UTC', 'z': 'UTC',
};

function validZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** A TZID → an IANA zone we can compute with, or null. Handles quoted, path-prefixed
 *  ("/mozilla.org/…/Europe/Berlin") and Windows-named zones. */
export function ianaZoneOf(tzid: string | null | undefined): string | null {
  const raw = String(tzid ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!raw) return null;
  if (validZone(raw) && raw.includes('/')) return raw;
  if (/^utc$|^gmt$|^z$/i.test(raw)) return 'UTC';
  const segs = raw.split('/').filter(Boolean);
  for (let n = Math.min(3, segs.length); n >= 2; n--) {
    const tail = segs.slice(-n).join('/');
    if (validZone(tail)) return tail;
  }
  const win = WINDOWS_ZONES[raw.toLowerCase()];
  return win ?? null;
}

/** "+0100" · "-0500" · "+013000" → offset ms, or NaN. */
function offsetMs(v: string | undefined): number {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(String(v ?? '').trim());
  if (!m) return NaN;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * ((Number(m[2]) * 60 + Number(m[3])) * 60 + Number(m[4] ?? 0)) * 1000;
}

const BYDAY_RE = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/;
const DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** The nth weekday of a month (n = -1 → last), as a day-of-month. */
function nthWeekday(year: number, month1: number, dow: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
    return 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month1 - 1, lastDay)).getUTCDay();
  return lastDay - ((lastDow - dow + 7) % 7) + (n + 1) * 7;
}

type LocalParts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

const naiveMs = (p: LocalParts): number => Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);

/** The VTIMEZONE's own rule: which observance (STANDARD / DAYLIGHT) holds at a local wall time, and
 *  therefore its TZOFFSETTO. Handles the YEARLY BYMONTH+BYDAY rules every real VTIMEZONE uses. */
function vtimezoneOffset(vtz: Comp, local: LocalParts): number {
  const onsets: Array<{ at: number; off: number }> = [];
  for (const obs of vtz.children.filter((c) => c.type === 'STANDARD' || c.type === 'DAYLIGHT')) {
    const off = offsetMs(prop(obs, 'TZOFFSETTO')?.value);
    const start = parseIcsDateValue(prop(obs, 'DTSTART')?.value ?? '');
    if (!Number.isFinite(off) || !start || start.kind !== 'local') continue;
    const rrule = prop(obs, 'RRULE')?.value ?? '';
    const r = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')).filter((x) => x.length === 2)) as Record<string, string>;
    const bymonth = Number(r.BYMONTH);
    const byday = BYDAY_RE.exec(String(r.BYDAY ?? '').split(',')[0] ?? '');
    if (r.FREQ === 'YEARLY' && bymonth && byday) {
      for (const y of [local.y - 1, local.y]) {
        if (y < start.parts.y) continue;
        const d = nthWeekday(y, bymonth, DOW[byday[2]], byday[1] ? Number(byday[1]) : 1);
        onsets.push({ at: naiveMs({ ...start.parts, y, mo: bymonth, d }), off });
      }
    } else {
      onsets.push({ at: naiveMs(start.parts), off });
    }
  }
  const t = naiveMs(local);
  const before = onsets.filter((o) => o.at <= t).sort((a, b) => b.at - a.at);
  if (before.length) return before[0].off;
  const any = onsets.sort((a, b) => a.at - b.at)[0];
  return any ? any.off : NaN;
}

type ParsedDate =
  | { kind: 'date'; date: string }
  | { kind: 'utc'; ms: number }
  | { kind: 'local'; parts: LocalParts };

function parseIcsDateValue(v: string, valueParam?: string): ParsedDate | null {
  const s = String(v ?? '').trim();
  const dm = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (dm || valueParam === 'DATE') {
    if (!dm) return null;
    return { kind: 'date', date: `${dm[1]}-${dm[2]}-${dm[3]}` };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(s);
  if (!m) return null;
  const parts: LocalParts = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] ?? 0) };
  if (m[7]) return { kind: 'utc', ms: naiveMs(parts) };
  return { kind: 'local', parts };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A local wall time in a zone → a UTC instant. IANA through the shared converter; a VTIMEZONE
 *  through its own rules; nothing → NaN (the caller decides what a floating time means). */
function localToUtc(parts: LocalParts, tzid: string | null, calendar: Comp | null): number {
  const iana = ianaZoneOf(tzid);
  if (iana) {
    const ms = zonedTimeToUtc(`${parts.y}-${pad2(parts.mo)}-${pad2(parts.d)}`, `${pad2(parts.h)}:${pad2(parts.mi)}`, iana);
    return Number.isFinite(ms) ? ms + parts.s * 1000 : NaN;
  }
  if (tzid && calendar) {
    const vtz = calendar.children.find((c) => c.type === 'VTIMEZONE'
      && String(prop(c, 'TZID')?.value ?? '').trim() === String(tzid).trim().replace(/^"(.*)"$/, '$1'));
    if (vtz) {
      const off = vtimezoneOffset(vtz, parts);
      if (Number.isFinite(off)) return naiveMs(parts) - off;
    }
  }
  return NaN;
}

/** ISO-8601 DURATION → ms ("PT1H30M", "P1D", "-PT15M"). */
export function durationMs(v: string | null | undefined): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v ?? '').trim());
  if (!m) return NaN;
  const sign = m[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
  return sign * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

const addDaysStr = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── people ───────────────────────────────────────────────────────────────────────────────────────

function addressOf(v: string): string {
  return String(v ?? '').trim().replace(/^mailto:/i, '').trim().toLowerCase();
}

function personOf(p: Prop): { address: string; name: string | null } | null {
  const address = addressOf(p.value);
  if (!address.includes('@')) return null;
  const cn = (p.params.CN ?? '').trim();
  return { address, name: cn && cn.toLowerCase() !== address ? unescapeIcsText(cn) : null };
}

// ── the parse ────────────────────────────────────────────────────────────────────────────────────

/**
 * Parse ONE iTIP / iCalendar text into the invite it carries. `fallbackTz` places a FLOATING time
 * (no Z, no TZID) — the only time a zone is assumed, and `floating: true` says so. Null when there is
 * no VCALENDAR, no VEVENT or no UID.
 */
export function parseIcs(text: string, opts: { fallbackTz?: string | null } = {}): InviteFacts | null {
  const cal = buildTree(unfoldIcs(text));
  if (!cal) return null;
  const events = cal.children.filter((c) => c.type === 'VEVENT');
  if (!events.length) return null;
  // The MASTER (no RECURRENCE-ID) speaks for the series; a lone exception speaks for itself.
  const ev = events.find((e) => !prop(e, 'RECURRENCE-ID')) ?? events[0];
  const uid = unescapeIcsText(prop(ev, 'UID')?.value ?? '');
  if (!uid) return null;

  const method = (prop(cal, 'METHOD')?.value ?? '').trim().toUpperCase() || null;
  const seqRaw = Number((prop(ev, 'SEQUENCE')?.value ?? '0').trim());
  const summary = unescapeIcsText(prop(ev, 'SUMMARY')?.value ?? '') || null;
  const location = unescapeIcsText(prop(ev, 'LOCATION')?.value ?? '') || null;
  const status = (prop(ev, 'STATUS')?.value ?? '').trim().toUpperCase() || null;
  const rrule = (prop(ev, 'RRULE')?.value ?? '').trim() || null;

  const dtstartP = prop(ev, 'DTSTART');
  const dtendP = prop(ev, 'DTEND');
  const start = dtstartP ? parseIcsDateValue(dtstartP.value, dtstartP.params.VALUE) : null;
  const end = dtendP ? parseIcsDateValue(dtendP.value, dtendP.params.VALUE) : null;
  const dur = durationMs(prop(ev, 'DURATION')?.value);

  let startISO: string | null = null;
  let endISO: string | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  let allDay = false;
  let floating = false;

  const instant = (d: ParsedDate | null, tzid: string | undefined): number => {
    if (!d || d.kind === 'date') return NaN;
    if (d.kind === 'utc') return d.ms;
    const ms = localToUtc(d.parts, tzid ?? null, cal);
    if (Number.isFinite(ms)) return ms;
    if (!tzid) {
      floating = true;
      const fb = opts.fallbackTz && validZone(opts.fallbackTz) ? opts.fallbackTz : 'UTC';
      return localToUtc(d.parts, fb, null);
    }
    return NaN;
  };

  if (start?.kind === 'date') {
    allDay = true;
    startDate = start.date;
    endDate = end?.kind === 'date' && end.date > start.date
      ? end.date
      : addDaysStr(start.date, Number.isFinite(dur) && dur > 0 ? Math.max(1, Math.round(dur / 86_400_000)) : 1);
  } else if (start) {
    const s = instant(start, dtstartP?.params.TZID);
    let e = instant(end, dtendP?.params.TZID);
    if (!Number.isFinite(e) && Number.isFinite(s) && Number.isFinite(dur)) e = s + dur;
    if (Number.isFinite(s)) startISO = new Date(s).toISOString();
    if (Number.isFinite(e) && Number.isFinite(s) && e >= s) endISO = new Date(e).toISOString();
  }

  const ridP = prop(ev, 'RECURRENCE-ID');
  let recurrenceId: string | null = null;
  if (ridP) {
    const rd = parseIcsDateValue(ridP.value, ridP.params.VALUE);
    if (rd?.kind === 'date') recurrenceId = rd.date;
    else {
      const ms = instant(rd, ridP.params.TZID);
      recurrenceId = Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
  }

  const orgP = prop(ev, 'ORGANIZER');
  const organizer = orgP ? personOf(orgP) : null;
  const seen = new Set<string>();
  const attendees: InviteAttendee[] = [];
  for (const a of props(ev, 'ATTENDEE')) {
    const p = personOf(a);
    if (!p || seen.has(p.address)) continue;
    seen.add(p.address);
    attendees.push({ ...p, partstat: (a.params.PARTSTAT ?? '').toUpperCase() || null, role: (a.params.ROLE ?? '').toUpperCase() || null });
  }

  return {
    source: 'ics', uid, method, sequence: Number.isFinite(seqRaw) ? seqRaw : 0, summary,
    startISO, endISO, allDay, startDate, endDate, floating, location,
    organizer, attendees, recurring: !!rrule, rrule, recurrenceId, status,
  };
}

// ── Graph (Outlook) — the eventMessage IS the invite ────────────────────────────────────────────

const GRAPH_METHOD: Record<string, string> = {
  meetingrequest: 'REQUEST', meetingcancelled: 'CANCEL', meetingaccepted: 'REPLY',
  meetingtenativelyaccepted: 'REPLY', meetingtentativelyaccepted: 'REPLY', meetingdeclined: 'REPLY',
};

/** Graph's `{dateTime, timeZone}` → a UTC instant. Graph serves UTC unless asked otherwise; any
 *  named zone goes through the same resolver the .ics path uses. */
function graphInstant(v: { dateTime?: string; timeZone?: string } | null | undefined): number {
  const dt = String(v?.dateTime ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(dt);
  if (!m) return NaN;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(dt)) return Date.parse(dt);
  const parts: LocalParts = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] ?? 0) };
  return localToUtc(parts, v?.timeZone || 'UTC', null);
}

/**
 * Map a Graph eventMessage (fetched with `$expand=microsoft.graph.eventMessage/event`) onto the ONE
 * invite shape. Null when the message carries no event or the event no iCalUId.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inviteFromGraphEventMessage(msg: any): InviteFacts | null {
  const ev = msg?.event;
  const uid = String(ev?.iCalUId ?? '').trim();
  if (!ev || !uid) return null;
  const method = GRAPH_METHOD[String(msg?.meetingMessageType ?? '').toLowerCase()] ?? null;
  const allDay = ev.isAllDay === true;
  const s = graphInstant(ev.start);
  const e = graphInstant(ev.end);
  const day = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const person = (x: any) => {
    const address = addressOf(x?.emailAddress?.address ?? '');
    if (!address.includes('@')) return null;
    const name = String(x?.emailAddress?.name ?? '').trim();
    return { address, name: name && name.toLowerCase() !== address ? name : null };
  };
  const attendees: InviteAttendee[] = [];
  const seen = new Set<string>();
  for (const a of Array.isArray(ev.attendees) ? ev.attendees : []) {
    const p = person(a);
    if (!p || seen.has(p.address)) continue;
    seen.add(p.address);
    const resp = String(a?.status?.response ?? '').toLowerCase();
    attendees.push({
      ...p,
      partstat: resp === 'accepted' ? 'ACCEPTED' : resp === 'declined' ? 'DECLINED'
        : resp === 'tentativelyaccepted' ? 'TENTATIVE' : resp ? 'NEEDS-ACTION' : null,
      role: a?.type === 'optional' ? 'OPT-PARTICIPANT' : a?.type === 'required' ? 'REQ-PARTICIPANT' : null,
    });
  }
  const type = String(ev.type ?? '');
  return {
    source: 'graph', uid, method, sequence: 0,
    summary: String(ev.subject ?? '').trim() || null,
    startISO: !allDay && Number.isFinite(s) ? new Date(s).toISOString() : null,
    endISO: !allDay && Number.isFinite(e) ? new Date(e).toISOString() : null,
    allDay,
    // Graph serves an all-day event as UTC midnights of its own dates.
    startDate: allDay ? String(ev.start?.dateTime ?? '').slice(0, 10) || day(s) : null,
    endDate: allDay ? String(ev.end?.dateTime ?? '').slice(0, 10) || day(e) : null,
    floating: false,
    location: String(ev.location?.displayName ?? '').trim() || null,
    organizer: person(ev.organizer),
    attendees,
    recurring: type === 'seriesMaster' || !!ev.recurrence,
    rrule: null,
    recurrenceId: type === 'occurrence' || type === 'exception'
      ? (Number.isFinite(s) ? new Date(s).toISOString() : null) : null,
    status: ev.isCancelled === true ? 'CANCELLED' : null,
    providerEventId: typeof ev.id === 'string' ? ev.id : null,
  };
}

// ── identity keys ────────────────────────────────────────────────────────────────────────────────

/** The Exchange GlobalObjectId prefix every Outlook iCalUId begins with. */
export const EXCHANGE_UID_PREFIX = '040000008200E00074C5B7101A82E008';
/** "vCal-Uid" in hex — the marker Exchange writes before an EXTERNAL (e.g. Google-born) UID. */
const VCAL_UID_HEX = '7643616C2D556964';

export const hexOf = (s: string): string => Buffer.from(String(s ?? ''), 'utf8').toString('hex').toUpperCase();

/**
 * Every form one meeting's identity can take, normalised for comparison:
 *   · the UID itself (case-folded);
 *   · an Exchange iCalUId that EMBEDS an external UID (`…vCal-Uid\x01\0\0\0<uid>\0`) → that UID —
 *     this is how Outlook stores a Google-born meeting, so a Google .ics and an Outlook row still meet;
 *   · an Exchange iCalUId with its per-occurrence date bytes zeroed → the series identity.
 * Pure.
 */
export function uidKeys(uid: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const raw = String(uid ?? '').trim();
  if (!raw) return out;
  out.add(raw.toLowerCase());
  const up = raw.toUpperCase();
  if (/^[0-9A-F]+$/.test(up) && up.startsWith(EXCHANGE_UID_PREFIX)) {
    const at = up.indexOf(VCAL_UID_HEX);
    if (at >= 0) {
      // marker + 01000000 (a LE 1), then the UID bytes up to a NUL.
      const body = up.slice(at + VCAL_UID_HEX.length + 8);
      let bytes = '';
      for (let i = 0; i + 1 < body.length; i += 2) {
        const b = body.slice(i, i + 2);
        if (b === '00') break;
        bytes += b;
      }
      if (bytes) {
        const inner = Buffer.from(bytes, 'hex').toString('utf8').trim();
        if (inner) out.add(inner.toLowerCase());
      }
    }
    // Bytes 16–19 are the occurrence date (YH YL M D) — zeroed, the id names the whole series.
    out.add(`${up.slice(0, 32)}00000000${up.slice(40)}`.toLowerCase());
  }
  return out;
}

/** Do two identity strings name the same meeting? Pure, symmetric. */
export function sameMeetingUid(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = uidKeys(a);
  if (!ka.size) return false;
  for (const k of uidKeys(b)) if (ka.has(k)) return true;
  return false;
}
