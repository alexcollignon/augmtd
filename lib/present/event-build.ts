// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVENT BUILDER (Wave 2, Sep 22 — docs/component-map.md §4 + §6; the contract is
// lib/present/event.ts).
//
// ONE calendar event, read once, rendered as the card's `EventSpec`: the facts the verb ladder
// needs, the labels a person reads, and NOTHING the client has to re-derive.
//
// THE LAWS THIS FILE KEEPS:
//   • CODE COMPUTES THE VERBS. `facts` here → `validEventVerbs(facts)` there. The model may select
//     among them and fill arguments; it may never mint one (`sanitizeProposal` drops the rest).
//   • THE SEAT IS DERIVED FROM ADDRESSES, never from a title, a guess or the model. The organizer
//     address against the user's OWN addresses decides it; an event we cannot place is `unknown`,
//     and `unknown` permits nothing.
//   • WEEKDAYS AND CLOCKS ARE CODE'S OUTPUT (THE ANCHOR LAW): every label is computed in the user's
//     zone through the schedule window's own pairing (`weekdayOf` + `dayChip`) — this file never
//     derives a weekday from a date or a date from a weekday.
//   • AMBIGUITY IS A REFUSAL BY LISTING. `findEventByAsk` resolves deterministically or hands back
//     the candidates; it never guesses which meeting the user meant.
//   • ZERO AI. Everything here is a read plus arithmetic.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validEventVerbs, EVENT_VERBS,
  type EventFacts, type EventResponse, type EventSeat, type EventSpec, type EventVerb,
} from '@/lib/present/event';
import { dayChip } from '@/lib/present/build';
import { userTimezone, weekdayOf } from '@/lib/calendar/schedule-window';
import { zonedTimeToUtc } from '@/lib/prepare/free-slots';
import { attendeeAddress, attendeeDisplayName, EVENT_WRITE_COLUMNS, type EventWriteRow } from '@/lib/calendar/event-writes';
// THE DISTINCTIVE-TOKEN LAW, ONE IMPLEMENTATION (lib/workflows/case-step.ts): a shared generic
// word proves nothing about identity, and containment is word-bounded — a substring is not a name.
import { distinctiveTokens, namesStatedIn } from '@/lib/workflows/case-step';

const DAY_MS = 86_400_000;
const DEFAULT_MINUTES = 60;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** How many other attendees the card names before it counts the rest. */
export const EVENT_ATTENDEE_CAP = 6;
/** How far ahead `findEventByAsk` looks when the ask names no day. */
export const ASK_WINDOW_DAYS = 14;

// ── the user's own addresses ─────────────────────────────────────────────────────────────────────

/** Every address that IS the user here: their login email and every connected mailbox. Read through
 *  whatever client the caller holds (a user client sees its own rows; the auth email comes from the
 *  session or from `profiles`), so this never needs the service role. */
export async function ownAddresses(client: SupabaseClient, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const add = (v: unknown) => { const s = String(v ?? '').trim().toLowerCase(); if (s.includes('@')) out.add(s); };
  try {
    const { data } = await client.from('connections')
      .select('provider_account_id, metadata, status').eq('user_id', userId);
    for (const c of (data ?? []) as Array<{ provider_account_id: string | null; metadata: { email?: string } | null }>) {
      add(c.provider_account_id);
      add(c.metadata?.email);
    }
  } catch { /* an unreadable connection list narrows the seat, never breaks the card */ }
  try {
    const { data } = await client.from('profiles').select('email').eq('id', userId).maybeSingle();
    add((data as { email?: string } | null)?.email);
  } catch { /* ignore */ }
  try {
    const { data } = await client.auth.getUser();
    add(data?.user?.email);
  } catch { /* a service-role client has no session — the two reads above already answered */ }
  return out;
}

// ── the row ──────────────────────────────────────────────────────────────────────────────────────

/** ONE read, user-scoped, EXPLICIT columns (the silent-column law). Null = not this user's event —
 *  indistinguishable from one that never existed, by design. */
export async function readEventRow(
  client: SupabaseClient, userId: string, calendarEventId: string,
): Promise<EventWriteRow | null> {
  try {
    const { data, error } = await client.from('calendar_events')
      .select(EVENT_WRITE_COLUMNS)
      .eq('id', calendarEventId).eq('user_id', userId).maybeSingle();
    if (error || !data) return null;
    return data as unknown as EventWriteRow;
  } catch { return null; }
}

// ── instants ─────────────────────────────────────────────────────────────────────────────────────

const isAllDayRow = (row: Pick<EventWriteRow, 'is_all_day' | 'start_time' | 'end_time'>): boolean =>
  row.is_all_day === true
  || (DATE_ONLY_RE.test(String(row.start_time ?? '')) && (!row.end_time || DATE_ONLY_RE.test(String(row.end_time))));

/** The event's real window in ms. An all-day row's bare dates are read as the user's own midnights
 *  (the all-day law: a date string carries no zone, so it cannot shift); a missing end is one hour
 *  (timed) or one day (all-day) — the same assumptions the slot picker makes. */
export function eventWindowMs(row: EventWriteRow, tz: string): { startMs: number; endMs: number; allDay: boolean } {
  const allDay = isAllDayRow(row);
  if (allDay) {
    const fromDay = dayPartOf(row.start_time, row.timezone || tz);
    const toDayExclRaw = row.end_time ? dayPartOf(row.end_time, row.timezone || tz) : '';
    const toDayExcl = !toDayExclRaw || toDayExclRaw <= fromDay ? addDays(fromDay, 1) : toDayExclRaw;
    return { startMs: zonedMidnight(fromDay, tz), endMs: zonedMidnight(toDayExcl, tz), allDay: true };
  }
  const startMs = Date.parse(String(row.start_time));
  const parsedEnd = row.end_time ? Date.parse(String(row.end_time)) : NaN;
  const endMs = Number.isNaN(parsedEnd) ? startMs + DEFAULT_MINUTES * 60_000 : parsedEnd;
  return { startMs, endMs, allDay: false };
}

const addDays = (dayStr: string, n: number): string =>
  new Date(Date.parse(`${dayStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const dayPartOf = (v: string | null | undefined, tz: string): string => {
  const raw = String(v ?? '');
  if (DATE_ONLY_RE.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return '';
  return dayIn(ms, tz);
};

const dayIn = (ms: number, tz: string): string => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
};

const clockIn = (ms: number, tz: string): string => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(11, 16); }
};

/** Midnight of a calendar date in `tz` — THE ONE zone conversion the calendar lane already owns
 *  (`lib/prepare/free-slots.ts`, the same function the schedule window builds its days on). */
const zonedMidnight = (dayStr: string, tz: string): number =>
  dayStr ? zonedTimeToUtc(dayStr, '00:00', tz) : NaN;

// ── the seat ─────────────────────────────────────────────────────────────────────────────────────

const RESPONSE_MAP: Record<string, EventResponse> = {
  accepted: 'accepted',
  tentative: 'tentative', tentativelyaccepted: 'tentative',
  declined: 'declined',
  needsaction: 'needsAction', notresponded: 'needsAction', none: 'needsAction', organizer: 'needsAction',
};

/** Map whatever the provider wrote onto the contract's four words. An unknown value is `needsAction`
 *  — the state that PERMITS the most verbs is also the honest default for "we don't know". */
export function responseOf(a: Record<string, unknown> | null | undefined): EventResponse | null {
  if (!a) return null;
  const raw = String(a.status ?? a.responseStatus ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!raw) return null;
  return RESPONSE_MAP[raw] ?? 'needsAction';
}

/**
 * THE SEAT LADDER, pure and testable:
 *   organizer address is ours          → 'organizer'
 *   we are on the attendee list        → 'invitee'
 *   nobody is on it and nobody owns it → 'solo'  (a block the user put in their own calendar)
 *   anything else                      → 'unknown' (someone else's event in our table; no verbs)
 */
export function seatOf(
  row: Pick<EventWriteRow, 'organizer' | 'attendees'>, mine: Set<string>,
): { seat: EventSeat; myResponse: EventResponse | null } {
  const organizer = String(row.organizer ?? '').trim().toLowerCase();
  const attendees = row.attendees ?? [];
  const isMine = (a: Record<string, unknown> | null | undefined) => mine.has(attendeeAddress(a)) || a?.self === true;
  const selfEntry = attendees.find(isMine) ?? null;
  const myResponse = responseOf(selfEntry);
  if (organizer && mine.has(organizer)) return { seat: 'organizer', myResponse };
  // SOLO BEFORE INVITEE (found by the gate): an event with no organizer on record whose only
  // attendee is the user is the user's OWN block — reading it as an invitation would offer them
  // RSVP buttons for answering themselves. `every` on an empty list is true, which is exactly the
  // no-attendees case.
  if (!organizer && attendees.every(isMine)) return { seat: 'solo', myResponse: attendees.length ? myResponse : null };
  if (selfEntry) return { seat: 'invitee', myResponse };
  return { seat: 'unknown', myResponse };
}

// ── the spec ─────────────────────────────────────────────────────────────────────────────────────

// ── THE NAME LADDER (Sep 22, found on the owner's walk) ─────────────────────────────────────────
//
// A real calendar row's attendees carry an address and NOTHING ELSE — both providers omit
// `displayName` for most guests — so the card read "with <address> and <address> and others" and the
// framing sentence said it out loud. AN ADDRESS IS NEVER A PERSON'S NAME on a surface a human reads.
//
// Four rungs, deterministic, zero AI, each falling through on absence OR error:
//   1. the attendee's OWN name, when the provider gave one (and it is not just the address again);
//   2. THE PERSON REGISTRY — the one brain already knows this human by alias (lib/entities/people.ts
//      `getPersonEntities` + `findPersonEntity`, ONE memoised read per user, never one per attendee);
//   3. the most recent `from_name` this address has signed mail with (the sweep's own idiom), read
//      for every address in ONE batched query;
//   4. the LOCAL PART, humanised ("sam.rivera" → "Sam Rivera"). Never the address itself.

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

/** Rung 4 — "sam.rivera-b2" → "Sam Rivera". Splits on separators and digit runs, Title Cases what
 *  is left, and falls back to the whole local part rather than to the address. Pure. */
export function humanizeAddress(address: string): string {
  const local = String(address ?? '').split('@')[0] ?? '';
  const words = local
    .replace(/\d+/g, ' ')
    .split(/[._\-+]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.join(' ') || (local ? local.charAt(0).toUpperCase() + local.slice(1) : '');
}

/**
 * Rungs 2 + 3, BATCHED: one memoised person-registry read plus one `emails` read for the whole
 * attendee set. Returns address → name for whatever it could resolve; an unresolved address is
 * simply absent and the caller humanises it. Never throws.
 */
export async function resolveAttendeeNames(
  client: SupabaseClient, userId: string, addresses: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(addresses.map((a) => String(a ?? '').trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return out;

  // 2 — the person registry (the one brain's own identity answer; already per-user memoised).
  try {
    const { getPersonEntities, findPersonEntity } = await import('@/lib/entities/people');
    const people = await getPersonEntities(client, userId);
    for (const addr of wanted) {
      const p = findPersonEntity(people, addr, null);
      const name = (p?.name ?? '').trim();
      if (name && !EMAIL_SHAPE.test(name)) out.set(addr, name);
    }
  } catch { /* the registry is a rung, never a requirement */ }

  // 3 — the name this address has signed mail with, most recent first. ONE query for the whole set;
  // matched on the stored address lowercased (a mixed-case stored row simply falls to rung 4).
  const missing = wanted.filter((a) => !out.has(a));
  if (missing.length) {
    try {
      const { data } = await client.from('emails')
        .select('from_address, from_name, received_at')
        .eq('user_id', userId).in('from_address', missing)
        .not('from_name', 'is', null)
        .order('received_at', { ascending: false, nullsFirst: false })
        .limit(400);
      for (const r of (data ?? []) as Array<{ from_address: string | null; from_name: string | null }>) {
        const addr = String(r.from_address ?? '').trim().toLowerCase();
        const name = String(r.from_name ?? '').trim();
        if (!addr || out.has(addr) || !name || EMAIL_SHAPE.test(name)) continue;
        out.set(addr, name);   // ordered newest-first, so the first hit per address wins
      }
    } catch { /* same — a rung, never a requirement */ }
  }
  return out;
}

/** The OTHER people on the event, as a person reads them — through the name ladder above, never as
 *  a raw address. Capped, and a cap is never silent (`moreAttendees` carries the rest). Pure: the
 *  lookups happen once, in the caller, and arrive as `names`. */
export function otherAttendees(
  row: Pick<EventWriteRow, 'attendees'>, mine: Set<string>, names?: Map<string, string>,
): { attendees: string[]; more: number } {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const a of (row.attendees ?? [])) {
    const addr = attendeeAddress(a);
    if (a?.self === true || (addr && mine.has(addr))) continue;
    const own = attendeeDisplayName(a);
    const label = (own && !EMAIL_SHAPE.test(own) ? own : '')
      || (addr ? names?.get(addr) : '')
      || (addr ? humanizeAddress(addr) : '');
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    all.push(label);
  }
  return { attendees: all.slice(0, EVENT_ATTENDEE_CAP), more: Math.max(0, all.length - EVENT_ATTENDEE_CAP) };
}

/**
 * Build ONE event's card spec. `null` when the row is not this user's, or when it cannot be read —
 * a half-built card is a promise the product can't keep.
 */
export async function buildEvent(
  client: SupabaseClient, userId: string, calendarEventId: string,
  opts: { now?: Date; tz?: string; mine?: Set<string>; row?: EventWriteRow | null } = {},
): Promise<EventSpec | null> {
  const row = opts.row ?? await readEventRow(client, userId, calendarEventId);
  if (!row) return null;
  const tz = opts.tz ?? await userTimezone(client, userId);
  const mine = opts.mine ?? await ownAddresses(client, userId);
  // THE NAME LADDER's two lookups happen ONCE here, for this event's whole guest list.
  const names = await resolveAttendeeNames(
    client, userId,
    (row.attendees ?? []).map(attendeeAddress).filter((a) => a && !mine.has(a)),
  ).catch(() => new Map<string, string>());
  return composeEventSpec(row, { tz, mine, names, now: opts.now ?? new Date(), writable: await isWritable(client, userId, row) });
}

/** A provider row we can write to: it carries a connection AND a provider event id, and that
 *  connection still exists for this user. No connection = a read-only row = no verbs. */
async function isWritable(client: SupabaseClient, userId: string, row: EventWriteRow): Promise<boolean> {
  if (!row.connection_id || !row.event_id) return false;
  try {
    const { data } = await client.from('connections').select('id')
      .eq('id', row.connection_id).eq('user_id', userId).maybeSingle();
    return !!data;
  } catch { return false; }
}

/** PURE: row + facts → the spec. Every label is computed here, in the user's zone. */
export function composeEventSpec(
  row: EventWriteRow,
  ctx: { tz: string; mine: Set<string>; now: Date; writable: boolean; names?: Map<string, string> },
): EventSpec {
  const { startMs, endMs, allDay } = eventWindowMs(row, ctx.tz);
  const { seat, myResponse } = seatOf(row, ctx.mine);
  const facts: EventFacts = {
    seat,
    myResponse,
    passed: Number.isFinite(endMs) ? endMs < ctx.now.getTime() : false,
    allDay,
    // A CANCELLED event permits nothing: there is nothing left to accept, move or cancel.
    writable: ctx.writable && String(row.status ?? 'confirmed') !== 'cancelled',
  };
  const dayStr = Number.isFinite(startMs) ? dayIn(startMs, ctx.tz) : '';
  const { attendees, more } = otherAttendees(row, ctx.mine, ctx.names);
  return {
    id: String(row.id),
    title: String(row.title || '(untitled)').replace(/\s+/g, ' ').trim(),
    dayLabel: dayStr ? dayChip({ dayStr, weekday: weekdayOf(dayStr) }) : '',
    timeLabel: allDay ? 'all day' : `${clockIn(startMs, ctx.tz)}–${clockIn(endMs, ctx.tz)}`,
    startISO: Number.isFinite(startMs) ? new Date(startMs).toISOString() : '',
    endISO: Number.isFinite(endMs) ? new Date(endMs).toISOString() : '',
    attendees,
    ...(more ? { moreAttendees: more } : {}),
    location: row.location ?? null,
    facts,
    verbs: validEventVerbs(facts),
  };
}

// ── THE ASK → ONE EVENT ──────────────────────────────────────────────────────────────────────────

export type EventMatch =
  | { kind: 'one'; id: string; row: EventWriteRow }
  | { kind: 'many'; candidates: Array<{ id: string; title: string; dayLabel: string; timeLabel: string }> }
  | { kind: 'none' };

/** A confident single match needs a real score AND daylight over the runner-up — the reply-target
 *  ladder's own bar (lib/converse/hands.ts), because the consequence here is the same class: acting
 *  on the wrong object in the user's life. */
// A single DISTINCTIVE title token ("the retro") is already a real signal — the tokens are
// generic-word-filtered before they count, so the bar is about distinctiveness, not volume (the
// reply ladder's own lesson: a named sender with one open thread must clear the bar on the name
// alone). What separates one answer from a refusal is therefore the MARGIN, not the floor: two
// meetings sharing exactly the words the user said are a refusal by listing, not a coin flip.
const MIN_SCORE = 2;
const MARGIN = 2;
const LIST_CAP = 4;

const WEEKDAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

/** The clock times the ask names, as minutes-from-midnight. "3pm" · "15:00" · "3.30pm" · "15h".
 *  Deliberately narrow: a shape we cannot read with certainty contributes NOTHING rather than a
 *  guessed hour. */
export function clockTimesIn(text: string): number[] {
  const out: number[] = [];
  const t = String(text ?? '').toLowerCase();
  for (const m of t.matchAll(/\b(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?\b/g)) {
    const hasMeridiem = !!m[3];
    const hasMinutes = m[2] !== undefined;
    if (!hasMeridiem && !hasMinutes) continue;          // a bare number is not a clock
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (!Number.isFinite(h) || h > 24 || min > 59) continue;
    if (hasMeridiem) {
      if (h > 12) continue;
      if (m[3] === 'pm' && h !== 12) h += 12;
      if (m[3] === 'am' && h === 12) h = 0;
    }
    out.push(h * 60 + min);
  }
  return [...new Set(out)];
}

/** The calendar DAY the ask names, in the user's zone — or null when it names none.
 *  Deterministic and narrow (an explicit date · today/tomorrow · a weekday name); anything else
 *  leaves the window at its default, which is a wider search, never a wrong one. */
export function dayStatedIn(text: string, opts: { now: Date; tz: string }): string | null {
  const t = String(text ?? '').toLowerCase();
  const explicit = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (explicit) return explicit[1];
  const today = dayIn(opts.now.getTime(), opts.tz);
  if (/\btomorrow\b|\bamanh[ãa]\b|\bmorgen\b/.test(t)) return addDays(today, 1);
  if (/\btoday\b|\bhoje\b|\bheute\b/.test(t)) return today;
  for (const [word, idx] of Object.entries(WEEKDAY_WORDS)) {
    if (!new RegExp(`\\b${word}\\b`).test(t)) continue;
    // The NEXT date carrying that weekday, today included — computed, never derived by the model.
    for (let i = 0; i <= 7; i++) {
      const cand = addDays(today, i);
      if (weekdayOf(cand).toLowerCase().startsWith(word.slice(0, 3))) return cand;
    }
  }
  return null;
}

/**
 * Resolve the user's words to ONE of their calendar events. Deterministic, zero AI.
 * Ambiguity is a REFUSAL BY LISTING — two plausible meetings come back as two candidates, never as
 * a coin flip about which one to act on.
 */
export async function findEventByAsk(
  client: SupabaseClient, userId: string, text: string, now: Date = new Date(),
  opts: { tz?: string; mine?: Set<string> } = {},
): Promise<EventMatch> {
  const tz = opts.tz ?? await userTimezone(client, userId);
  const mine = opts.mine ?? await ownAddresses(client, userId);
  const statedDay = dayStatedIn(text, { now, tz });
  const fromDay = statedDay ?? dayIn(now.getTime(), tz);
  const toDay = statedDay ?? addDays(fromDay, ASK_WINDOW_DAYS);
  const windowStart = zonedMidnight(fromDay, tz);
  const windowEnd = zonedMidnight(addDays(toDay, 1), tz);

  let rows: EventWriteRow[] = [];
  try {
    const { data } = await client.from('calendar_events')
      .select(EVENT_WRITE_COLUMNS)
      .eq('user_id', userId).eq('status', 'confirmed')
      // Bounded by START (cheap), with a lookback so an in-progress multi-day block is still a
      // candidate — THE OVERLAP LAW, the same one the schedule window keeps.
      .gte('start_time', new Date(windowStart - 14 * DAY_MS).toISOString())
      .lte('start_time', new Date(windowEnd).toISOString())
      .order('start_time', { ascending: true }).limit(200);
    rows = (data ?? []) as unknown as EventWriteRow[];
  } catch { return { kind: 'none' }; }

  const clocks = clockTimesIn(text);
  const scored = rows.map((row) => {
    const { startMs, endMs } = eventWindowMs(row, tz);
    if (!Number.isFinite(startMs) || endMs <= windowStart || startMs >= windowEnd) return null;
    let score = 0;
    // WHO — a person the ask names, matched on the attendee's own name/address tokens.
    const people = (row.attendees ?? []).map((a) => `${attendeeDisplayName(a)} ${attendeeAddress(a).split('@')[0]}`).join(' ');
    score += tokenHits(text, people) * 3;
    // WHAT — the title's distinctive tokens.
    score += tokenHits(text, String(row.title ?? '')) * 2;
    // WHEN — a clock the ask stated that this event actually starts at.
    if (clocks.length) {
      const [hh, mm] = clockIn(startMs, tz).split(':').map(Number);
      if (clocks.includes(hh * 60 + mm)) score += 3;
    }
    // …and the day, when the user named one (every survivor is in-window, so this only separates
    // a named DAY from a default fortnight).
    if (statedDay && dayIn(startMs, tz) === statedDay) score += 2;
    return { row, score };
  }).filter((x): x is { row: EventWriteRow; score: number } => !!x && x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { kind: 'none' };
  const [best, second] = scored;
  if (best.score >= MIN_SCORE && (!second || best.score - second.score >= MARGIN)) {
    return { kind: 'one', id: String(best.row.id), row: best.row };
  }
  const plausible = scored.filter((s) => s.score >= MIN_SCORE).slice(0, LIST_CAP);
  if (plausible.length >= 2) {
    return {
      kind: 'many',
      candidates: plausible.map((p) => {
        const spec = composeEventSpec(p.row, { tz, mine, now, writable: false });
        return { id: spec.id, title: spec.title, dayLabel: spec.dayLabel, timeLabel: spec.timeLabel };
      }),
    };
  }
  return { kind: 'none' };
}

/** How many of `subject`'s distinctive tokens the ask actually STATES, word-bounded. ONE
 *  implementation of the law (`namesStatedIn` per token) — a substring is never a name, and a
 *  generic work-word proves nothing. */
function tokenHits(ask: string, subject: string): number {
  const toks = distinctiveTokens(subject);
  if (!toks.length) return 0;
  return toks.filter((t) => namesStatedIn(ask, t)).length;
}

// ── THE VERB THE USER SAID ───────────────────────────────────────────────────────────────────────

/** Verb words in the languages the platform speaks. The ladder decides what is PERMITTED; this
 *  decides what the user actually ASKED FOR — and nothing is ever armed on a verb they did not say
 *  (the deterministic floor the explicit-send law established for mail). */
const VERB_WORDS: Array<{ verb: EventVerb; re: RegExp }> = [
  { verb: 'decline', re: /\b(decline|declin\w*|reject|say no to|turn down|recusar|recuso|absagen|ablehnen|refuser)\b/i },
  { verb: 'tentative', re: /\b(tentative|maybe|provisional|talvez|vielleicht|peut-être)\b/i },
  { verb: 'accept', re: /\b(accept|aceit\w*|confirm(?:\s+(?:the|my|this))?|say yes to|zusagen|annehmen|accepter)\b/i },
  { verb: 'reschedule', re: /\b(reschedule|re-?schedule|move (?:it|the|my|this)|push (?:it|the|my|this)|shift (?:it|the|my)|remarcar|adiar|verschieben|reporter|décaler)\b/i },
  { verb: 'cancel', re: /\b(cancel|call off|cancelar|absagen|annuler|streichen)\b/i },
];

/** The verbs the user's OWN words name, in contract order. Pure. */
export function verbsStatedIn(text: string): EventVerb[] {
  const t = String(text ?? '');
  const hit = new Set<EventVerb>();
  for (const { verb, re } of VERB_WORDS) if (re.test(t)) hit.add(verb);
  return EVENT_VERBS.filter((v) => hit.has(v));
}

/**
 * THE ANCHOR LAW ON A RESCHEDULE: a proposed new time is RESOLVED BY CODE from the user's own
 * words — never taken from the model's arithmetic. The day comes from `dayStatedIn` (explicit date ·
 * today/tomorrow · a weekday, resolved forward), the clock from `clockTimesIn`, the duration from
 * the event itself. Nothing stated → `null`, and the card asks for a time instead of arming a move.
 */
export function resolveProposedWindow(
  userText: string, opts: { now: Date; tz: string; durationMs: number },
): { startISO: string; endISO: string; label: string } | null {
  const day = dayStatedIn(userText, { now: opts.now, tz: opts.tz });
  const clocks = clockTimesIn(userText);
  if (!day || !clocks.length) return null;
  const minutes = clocks[0];
  const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const startMs = zonedTimeToUtc(day, hhmm, opts.tz);
  if (!Number.isFinite(startMs) || startMs <= opts.now.getTime()) return null;
  const durationMs = Number.isFinite(opts.durationMs) && opts.durationMs > 0 ? opts.durationMs : DEFAULT_MINUTES * 60_000;
  const endMs = startMs + durationMs;
  return {
    startISO: new Date(startMs).toISOString(),
    endISO: new Date(endMs).toISOString(),
    // The label is CODE's pairing, so the card can never print a weekday the date does not carry.
    label: `${dayChip({ dayStr: day, weekday: weekdayOf(day) })} · ${clockIn(startMs, opts.tz)}–${clockIn(endMs, opts.tz)}`,
  };
}

// ── THE FRAMING SENTENCE (code's, never the model's) ─────────────────────────────────────────────

const VERB_FRAME: Record<EventVerb, string> = {
  accept: 'Accept', tentative: 'Maybe', decline: 'Decline', reschedule: 'Reschedule', cancel: 'Cancel',
};

/**
 * ONE sentence, composed from the spec's own facts — the card carries the detail. Arithmetic and
 * the contract's words only: no model prose reaches a bubble through this lane.
 */
export function eventFraming(spec: EventSpec): string {
  const when = [spec.dayLabel, spec.facts.allDay ? '' : spec.timeLabel].filter(Boolean).join(' · ');
  const who = spec.attendees.length
    ? ` with ${spec.attendees.slice(0, 2).join(' and ')}${spec.attendees.length > 2 || spec.moreAttendees ? ' and others' : ''}`
    : '';
  const head = `${spec.title}${who} — ${when || 'no time on file'}`;
  if (spec.proposal) {
    const v = VERB_FRAME[spec.proposal.verb];
    const at = spec.proposal.verb === 'reschedule' && spec.proposal.newLabel ? ` to ${spec.proposal.newLabel}` : '';
    return `${head}. ${v}${at} is ready to confirm.`;
  }
  if (spec.facts.passed) return `${head}. That one has already happened.`;
  if (!spec.verbs.length) return `${head}. Nothing on it is mine to change from here.`;
  return `${head}. ${spec.verbs.map((v) => VERB_FRAME[v]).join(' · ')} — your call.`;
}
