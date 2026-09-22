// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVENT CONTRACT (Wave 2 — docs/component-map.md §6: the event card + calendar verbs)
//
// REASONED SELECTION, DETERMINISTIC RENDERING. A calendar event is the first object whose card
// offers verbs that depend on WHO the user is to it and WHEN it is — so this file is where the
// gen-UI rule becomes code:
//
//   · CODE computes the verbs an event PERMITS (`validEventVerbs`) from facts it holds — the
//     user's seat (organizer / invitee), their current response, whether it has passed. Pure.
//   · the MODEL may only SELECT among them and fill their arguments (`EventProposal`). A verb the
//     facts do not permit is dropped by `sanitizeProposal` — an invented verb renders NOTHING,
//     never a dead button.
//   · the CARD renders the sanitized result. The click is the approval (THE HUMAN-IN-THE-LOOP LAW):
//     saying "decline it" PREPARES the card with Decline armed; nothing reaches the provider until
//     the user confirms on the card, and every confirm goes through the ONE deeds module.
//
// PURE and leaf: zero IO, zero React, imported by both halves.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const EVENT_VERBS = ['accept', 'tentative', 'decline', 'reschedule', 'cancel'] as const;
export type EventVerb = typeof EVENT_VERBS[number];

export type EventResponse = 'accepted' | 'tentative' | 'declined' | 'needsAction';

/** The user's seat at the event — derived from the organizer address vs the user's own addresses,
 *  never from a title or a guess. `unknown` permits NOTHING outward-facing. */
export type EventSeat = 'organizer' | 'invitee' | 'solo' | 'unknown';

/** The facts the verb ladder reads. Everything here is something the synced row already holds. */
export type EventFacts = {
  seat: EventSeat;
  myResponse: EventResponse | null;
  /** Has the event's END passed, by the user's clock? A past event permits no verb. */
  passed: boolean;
  allDay: boolean;
  /** A provider row we can write to (a connection + a provider event id). False = read-only. */
  writable: boolean;
};

export type EventSpec = {
  /** calendar_events.id — for the deeds door. NEVER rendered. */
  id: string;
  title: string;
  /** Composed by code in the user's zone from the schedule window's own pairing ("Tue 23 Sep"). */
  dayLabel: string;
  /** "14:00–15:00" or "all day". */
  timeLabel: string;
  startISO: string;
  endISO: string;
  /** Display names (or addresses when nameless) of the OTHER attendees, capped by the server. */
  attendees: string[];
  moreAttendees?: number;
  location?: string | null;
  facts: EventFacts;
  /** The verbs this event permits, in display order — `validEventVerbs(facts)`, served so the
   *  client never re-derives the ladder. */
  verbs: EventVerb[];
  /** The sanitized selection, when the turn proposed one. */
  proposal?: EventProposal | null;
};

/** What the model (or a fast-path parser) may propose: ONE armed verb + its arguments. */
export type EventProposal = {
  verb: EventVerb;
  /** reschedule only — the proposed new window, already through THE ANCHOR LAW server-side. */
  newStartISO?: string;
  newEndISO?: string;
  /** The label code composed for the new window ("Thu 25 Sep · 10:00–10:30"). Never model prose. */
  newLabel?: string;
  /** decline / cancel — an optional one-line note to the other side, user-editable on the card. */
  note?: string;
};

/** Verbs that notify other people and cannot be taken back — confirm-gated AND commit-door-claimed. */
export const OUTWARD_VERBS: readonly EventVerb[] = ['reschedule', 'cancel', 'decline', 'accept', 'tentative'];
/** Verbs with no undo at all (an RSVP can be re-answered; a cancel or a move cannot be unsent). */
export const IRREVERSIBLE_VERBS: readonly EventVerb[] = ['reschedule', 'cancel'];

/** THE VERB LADDER. Pure; fail-closed — anything unknown permits nothing. */
export function validEventVerbs(f: EventFacts): EventVerb[] {
  if (!f || !f.writable || f.passed) return [];
  if (f.seat === 'organizer' || f.seat === 'solo') return ['reschedule', 'cancel'];
  if (f.seat === 'invitee') {
    const all: EventVerb[] = ['accept', 'tentative', 'decline'];
    const mine: Record<string, EventVerb> = { accepted: 'accept', tentative: 'tentative', declined: 'decline' };
    const current = f.myResponse ? mine[f.myResponse] : undefined;
    return all.filter((v) => v !== current);
  }
  return [];
}

/** An invented, unpermitted or malformed proposal becomes `null` — renders nothing. Pure. */
export function sanitizeProposal(
  p: unknown, facts: EventFacts, opts: { now: Date } = { now: new Date() },
): EventProposal | null {
  const x = p as EventProposal | null;
  if (!x || typeof x.verb !== 'string') return null;
  if (!validEventVerbs(facts).includes(x.verb as EventVerb)) return null;
  if (x.verb === 'reschedule') {
    const s = x.newStartISO ? Date.parse(x.newStartISO) : NaN;
    const e = x.newEndISO ? Date.parse(x.newEndISO) : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || s <= opts.now.getTime()) return null;
    return { verb: 'reschedule', newStartISO: x.newStartISO, newEndISO: x.newEndISO,
      ...(typeof x.newLabel === 'string' ? { newLabel: x.newLabel } : {}) };
  }
  const note = typeof x.note === 'string' ? x.note.trim().slice(0, 280) : '';
  return { verb: x.verb, ...(note ? { note } : {}) };
}

export const EVENT_VERB_WORDS: Record<EventVerb, { label: string; armed: string; done: string }> = {
  accept:     { label: 'Accept',     armed: 'Confirm accept',     done: 'Accepted' },
  tentative:  { label: 'Maybe',      armed: 'Confirm maybe',      done: 'Marked as maybe' },
  decline:    { label: 'Decline',    armed: 'Confirm decline',    done: 'Declined' },
  reschedule: { label: 'Reschedule', armed: 'Confirm new time',   done: 'Moved' },
  cancel:     { label: 'Cancel',     armed: 'Confirm cancel',     done: 'Cancelled' },
};

export function isEventSpec(v: unknown): v is EventSpec {
  const s = v as EventSpec | null;
  return !!s && typeof s.id === 'string' && typeof s.title === 'string'
    && typeof s.startISO === 'string' && typeof s.endISO === 'string'
    && !!s.facts && Array.isArray(s.verbs) && s.verbs.every((x) => (EVENT_VERBS as readonly string[]).includes(x));
}
