// ════════════════════════════════════════════════════════════════════════════════════════════════
// W15.2 · SCHEDULED IS NOT OVERDUE (owner walk, Sep 24).
//
// A commitment whose deed IS a booked future event ("Join the call … 30 minutes later", the event on
// the calendar for next Wednesday 11:00, the brief saying "you're all set") read "Due Thu · You owe…"
// and sat among the day's work. Nothing was owed today: the work was booked. The machine now names
// that truth — `scheduled` ("scheduled — Wed, Sep 30, 11:00") — derived AT READ from truth that
// already exists, zero AI:
//
//   · THE BOOKED EVENT — a non-cancelled `calendar_events` row the item's counterparty sits in (an
//     attendee who did not decline, or the organizer), on an obligation whose deed is a MEETING (the
//     judged verb is `schedule`, or the obligation's own words are meeting-shaped). The same key the
//     evidence calendar lane and the prepare pass's already-booked floor use — the counterparty in the
//     event — never a guess across the calendar.
//   · THE REVISIT DATE — a judged verdict that says "come back after <date>" on live work.
//
// Once the event has PASSED (and it came after the obligation arose), the item is no longer
// scheduled: the meeting was held, so it LOOKS DONE (W11.2 — confirm Done / Not yet).
//
// CLIENT-SAFE BY CONSTRUCTION (zero imports): the word's one home is here, the machine's STATE_WORDS
// reads it, and client printers (the room header, the Home row) may compose it without dragging the
// server graph (the client-safe module law).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** THE WORD (a spec change lives here — lib/work/machine.ts STATE_WORDS.scheduled reads it). */
export const SCHEDULED_WORD = 'scheduled';

/** How far ahead a booking may stand and still be "this work's" booking (a stated bound). */
export const SCHEDULED_HORIZON_DAYS = 60;
/** How recently a meeting must have ended to make the work LOOK done at read (older → the settle
 *  sweep's own looks-done record speaks, if any). */
export const HELD_WINDOW_DAYS = 14;

/** "scheduled — Wed, Sep 30, 11:00" — the served word with its when. Pure. */
export function scheduledWordOf(when: string | null | undefined): string {
  const w = String(when ?? '').trim();
  return w ? `${SCHEDULED_WORD} — ${w}` : SCHEDULED_WORD;
}

/** Is a served state word the scheduled word (with or without its when)? Pure. */
export function isScheduledWord(word: string | null | undefined): boolean {
  const w = String(word ?? '').trim().toLowerCase();
  return w === SCHEDULED_WORD || w.startsWith(`${SCHEDULED_WORD} — `);
}

/** The when, in the event's own zone (the user's calendar zone), else UTC. Date-only for a revisit
 *  date or an all-day event. Pure; never throws. */
export function scheduledWhenOf(iso: string | null | undefined, tz?: string | null, dateOnly = false): string | null {
  const raw = String(iso ?? '').trim();
  if (!raw) return null;
  const onlyDate = dateOnly || /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const t = Date.parse(onlyDate && raw.length === 10 ? `${raw}T12:00:00Z` : raw);
  if (!Number.isFinite(t)) return null;
  const zone = onlyDate && raw.length === 10 ? 'UTC' : (tz || 'UTC');
  const fmt = (timeZone: string) => {
    const day = new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone });
    if (onlyDate) return day;
    const time = new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
    return `${day}, ${time}`;
  };
  try { return fmt(zone); } catch { return fmt('UTC'); }
}

// ── THE MEETING-SHAPED OBLIGATION ────────────────────────────────────────────────────────────────
// The deed IS a meeting: the obligation's own words say call/meet/join/demo/… (the four corpus
// languages), or the judge's verb is `schedule`. A booking with the counterparty on an obligation
// to SEND something is not that obligation's deed — it never schedules it.
const MEETING_WORDS = /(?<![\p{L}\p{N}])(call|calls|meet|meeting|meetings|join|joining|catch[- ]?up|demo|walk-?through|session|sync|interview|appointment|visit|webinar|workshop|zoom|teams call|video call|phone call|kick-?off|onboarding call|review call|appel|réunion|reunion|rendez-vous|rdv|visio|treffen|termin|gespräch|besprechung|reunião|chamada|videochamada|encontro)(?![\p{L}\p{N}])/iu;

export function meetingShaped(text: string | null | undefined): boolean {
  return MEETING_WORDS.test(String(text ?? ''));
}

// ── THE BOOKED EVENT ─────────────────────────────────────────────────────────────────────────────
export type CalendarRowLike = {
  id: string;
  start_time: string | null;
  end_time?: string | null;
  title?: string | null;
  attendees?: unknown;
  organizer?: unknown;
  status?: string | null;
  timezone?: string | null;
  is_all_day?: boolean | null;
};

/** What the matcher needs of an item — its counterparty (addresses + names), its own words, the
 *  judged verb, and when the obligation arose. */
export type BookingFacts = {
  addresses: string[];
  names: string[];
  text: string;
  verdictWork: string | null;
  afterISO: string | null;
};

export type BookedEvent = { id: string; start: string; end: string | null; title: string; tz: string | null; allDay: boolean };

const EMAIL_IN = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** Every address a raw who/attendee value carries, lower-cased ("Name <a@b>", {email}, strings). */
export function addressesIn(raw: unknown): string[] {
  const out = new Set<string>();
  const list = Array.isArray(raw) ? raw : [raw];
  for (const a of list) {
    const s = typeof a === 'string' ? a : String((a as { email?: unknown; address?: unknown } | null)?.email ?? (a as { address?: unknown } | null)?.address ?? '');
    const m = EMAIL_IN.exec(s);
    if (m) out.add(m[0].toLowerCase());
  }
  return [...out];
}

/** A person's display name from a who value ("Sam Lee <sam@acme.test>" → "sam lee"), lower-cased;
 *  null for a bare address or a single token (a first name alone is too weak a key). */
export function nameKeyOf(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (!s || EMAIL_IN.test(s)) return null;
  const n = s.toLowerCase().replace(/\s+/g, ' ');
  return n.split(' ').length >= 2 ? n : null;
}

const partyOf = (a: unknown): { address: string | null; name: string | null; declined: boolean } => {
  const o = (a ?? {}) as { email?: unknown; name?: unknown; displayName?: unknown; status?: unknown; responseStatus?: unknown };
  const address = addressesIn(typeof a === 'string' ? a : o.email ?? '')[0] ?? null;
  const name = nameKeyOf(typeof a === 'string' ? a : (o.name ?? o.displayName ?? ''));
  const declined = String(o.status ?? o.responseStatus ?? '').toLowerCase() === 'declined';
  return { address, name, declined };
};

// ── W16 · A NAME-ONLY COUNTERPARTY (owner walk, Sep 24 — "Join call with <A> and <B> …", the
// counterparty stored as NAMES, the booked event's attendees carrying ADDRESSES only: the booking was
// on the calendar, accepted, and the page still said "Due" and proposed a new invite). A stored name
// may hold several people ("A Person and B Person", "A, B & C"): each is its own key. A name key
// matches an attendee with no display name through the attendee's OWN ADDRESS — its local part names
// both the first and the last name ("anna.schmidt", "anna_schmidt", "annaschmidt", "schmidt.anna") or
// is the initial + last name ("aschmidt", "a.schmidt"). Deterministic, zero IO; a single token is never
// a key (too weak), so a first name alone still matches nothing. ──
const NAME_SEPARATORS = /\s*(?:,|;|&|\+|\/|\band\b|\bund\b|\bet\b|\be\b|\by\b)\s*/i;
/** Every person-name key a stored who value carries (split on and/und/et/e/y/,/&). Pure. */
export function nameKeysOf(raw: unknown): string[] {
  const whole = String(raw ?? '').replace(/<[^>]*>/g, ' ');
  const out = new Set<string>();
  for (const part of whole.split(NAME_SEPARATORS)) { const k = nameKeyOf(part); if (k) out.add(k); }
  return [...out];
}
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
/** Does this address's local part name this person (a ≥2-token name key)? Pure. */
export function addressNamesPerson(address: string | null | undefined, nameKey: string): boolean {
  const local = String(address ?? '').split('@')[0] ?? '';
  const parts = nameKey.split(' ').map(fold).filter((t) => t.length >= 2);
  if (parts.length < 2 || !local) return false;
  const first = parts[0], last = parts[parts.length - 1];
  const flat = fold(local);
  if (flat.includes(first) && flat.includes(last)) return true;
  return flat === `${first[0]}${last}` || flat === `${last}${first[0]}`;
}

/** Does the counterparty sit in this event (an attendee who did not decline, or the organizer)? */
export function counterpartyInEvent(ev: CalendarRowLike, facts: Pick<BookingFacts, 'addresses' | 'names'>): boolean {
  const want = new Set(facts.addresses.map((a) => a.toLowerCase()));
  // W16: a stored "A Person and B Person" is two keys, each matched by name or by the attendee's address.
  const names = new Set(facts.names.flatMap((n) => [n.toLowerCase(), ...nameKeysOf(n)]));
  if (!want.size && !names.size) return false;
  for (const a of Array.isArray(ev.attendees) ? ev.attendees : []) {
    const p = partyOf(a);
    if (p.declined) continue;
    if ((p.address && want.has(p.address)) || (p.name && names.has(p.name))) return true;
    if (p.address && [...names].some((n) => addressNamesPerson(p.address, n))) return true;
  }
  const org = addressesIn(typeof ev.organizer === 'string' ? ev.organizer : (ev.organizer as { email?: unknown } | null)?.email ?? '')[0];
  return !!org && want.has(org);
}

/**
 * THE MATCHER — pure. The soonest UPCOMING booking (not yet ended, inside the horizon) and the most
 * recent HELD one (ended inside the held window, after the obligation arose). Only for a
 * meeting-shaped obligation with a counterparty key.
 */
export function bookedEventFor(
  facts: BookingFacts, events: readonly CalendarRowLike[], nowISO: string,
): { upcoming: BookedEvent | null; held: BookedEvent | null } {
  const none = { upcoming: null, held: null };
  if (!facts.addresses.length && !facts.names.length) return none;
  if (facts.verdictWork !== 'schedule' && !meetingShaped(facts.text)) return none;
  const now = Date.parse(nowISO);
  if (!Number.isFinite(now)) return none;
  const horizon = now + SCHEDULED_HORIZON_DAYS * 86_400_000;
  const heldFloor = now - HELD_WINDOW_DAYS * 86_400_000;
  const after = facts.afterISO ? Date.parse(facts.afterISO) : NaN;
  let upcoming: BookedEvent | null = null;
  let held: BookedEvent | null = null;
  for (const ev of events) {
    if (String(ev.status ?? '').toLowerCase() === 'cancelled') continue;
    const s = Date.parse(String(ev.start_time ?? ''));
    if (!Number.isFinite(s)) continue;
    const e = ev.end_time ? Date.parse(ev.end_time) : s;
    const end = Number.isFinite(e) ? e : s;
    if (!counterpartyInEvent(ev, facts)) continue;
    const shaped: BookedEvent = { id: String(ev.id), start: String(ev.start_time), end: ev.end_time ?? null, title: String(ev.title ?? ''), tz: ev.timezone ?? null, allDay: !!ev.is_all_day };
    if (end >= now) {
      if (s <= horizon && (!upcoming || s < Date.parse(upcoming.start))) upcoming = shaped;
    } else if (end >= heldFloor && (!Number.isFinite(after) || s >= after)) {
      if (!held || s > Date.parse(held.start)) held = shaped;
    }
  }
  return { upcoming, held };
}

/**
 * THE SEAT FACTS of a scheduled row (lib/home/attention.ts reads them): it never takes a seat before
 * its event's day, and it never reads overdue or due — a booked meeting is not a missed deadline.
 * `todayStr` is the caller's day (YYYY-MM-DD, the same clock its due words use). Pure.
 */
export function scheduledSeatOf(scheduledAt: string | null | undefined, todayStr: string): {
  scheduledFor?: string; scheduledToday?: boolean; overdue?: false; dueToday?: false;
} {
  const at = String(scheduledAt ?? '').trim();
  if (!at) return {};
  return { scheduledFor: at, scheduledToday: at.slice(0, 10) <= todayStr, overdue: false, dueToday: false };
}
