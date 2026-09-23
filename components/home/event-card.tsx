'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVENT CARD'S HOST (docs/component-map.md §6, Wave 2 — the event card + calendar verbs)
//
// The kit renders; this file DOES. It is the collection card's sibling, built on the same three
// separations and one more that only a card with OUTWARD verbs needs:
//
//   1 · IT RE-READS. A persisted card is a POINTER (`{eventId, proposal?}`) — on rehydrate the
//       event comes back from `GET /api/events/<id>/card`, never from a stored snapshot. An RSVP
//       answered in the calendar app itself must not find this card still offering to answer it.
//   2 · IT NEVER DERIVES A VERB. `spec.verbs` IS the permitted set — computed by the ladder in
//       lib/present/event.ts from the user's seat, their current response and the clock. This file
//       imports no `validEventVerbs`; it renders what it was served, in the order it was served.
//       (A model's SELECTION among them arrives sanitized as `spec.proposal` and arms exactly one.)
//   3 · EVERY DEED IS THE ONE DOOR. `POST /api/events/<id>/deed` — one module, one activity log,
//       one commit-door claim. This file mints no provider call of its own.
//   4 · THE CLICK IS THE APPROVAL (THE HUMAN-IN-THE-LOOP LAW). Saying "decline it" PREPARES the
//       card with Decline armed; nothing reaches a provider until the user confirms here.
//
// Failure is honest: a 409 (the verb stopped being permitted while the card stood) RE-READS and
// says so in one quiet line — the card corrects itself rather than retrying a deed the event no
// longer allows. Any other failure restores the row and speaks once. No toasts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { EventCardVerb, EventVerbArgs, ThreadCard } from '@/components/thread/types';
import {
  EVENT_VERB_WORDS, IRREVERSIBLE_VERBS, isEventSpec,
  type EventProposal, type EventResponse, type EventSpec, type EventVerb,
} from '@/lib/present/event';

/** What a persisted card carries: the event's id and the turn's sanitized selection. Nothing else
 *  — every fact about the event is re-read, because every fact about it can change elsewhere. */
export type EventPointer = { eventId: string; proposal?: EventProposal | null };

/** THE ONE STANDING WORD — where the USER stands, said once. Display only: it decides no verb
 *  (the ladder already did that, server-side, from the same fact). */
const STANDING_WORD: Record<EventResponse, string> = {
  accepted: 'accepted', tentative: 'maybe', declined: 'declined', needsAction: 'no reply yet',
};

/** What an irreversible verb COSTS, said where it can still be stopped. Keyed by the contract's
 *  own `IRREVERSIBLE_VERBS` — a verb absent from that list gets no line, by construction. */
const CONSEQUENCE: Partial<Record<EventVerb, string>> = {
  reschedule: 'Everyone invited gets the update.',
  cancel: 'Everyone invited gets the cancellation.',
};

/** THE NOTE IS DELIVERED OR NOT OFFERED (W0.4): the verbs that carry an editable one-line note are
 *  the SERVED `spec.noteVerbs` — the ones this event's provider actually delivers a note on. A card
 *  never offers a box whose words would go nowhere (a Google cancel has no message channel). */
const NO_NOTE: readonly EventVerb[] = [];

/** THE RE-READ IS BOUNDED (W0.4): at most this many attempts per event id per mount. */
const REREAD_MAX_ATTEMPTS = 2;

const pad = (n: number) => String(n).padStart(2, '0');

/** The picker's starting values — THE EVENT'S OWN window, never today and never a guess. */
function pickerDefaultsOf(spec: Pick<EventSpec, 'startISO' | 'endISO'>): { date: string; time: string; durationMin: number } {
  const s = new Date(spec.startISO);
  const e = new Date(spec.endISO);
  const mins = Number.isFinite(e.getTime()) && Number.isFinite(s.getTime())
    ? Math.max(15, Math.round((e.getTime() - s.getTime()) / 60000)) : 30;
  if (!Number.isFinite(s.getTime())) return { date: '', time: '', durationMin: 30 };
  return {
    date: `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`,
    time: `${pad(s.getHours())}:${pad(s.getMinutes())}`,
    durationMin: mins,
  };
}

/** A picked WALL TIME becomes the deed's arguments here — the kit composed no ISO and read no
 *  clock; it handed back the three fields the user touched. */
function windowFromPick(pick: { date: string; time: string; durationMin: number }):
  { newStartISO: string; newEndISO: string } | null {
  if (!pick.date || !pick.time) return null;
  const start = new Date(`${pick.date}T${pick.time}`);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start.getTime() + Math.max(5, pick.durationMin) * 60000);
  return { newStartISO: start.toISOString(), newEndISO: end.toISOString() };
}

export default function EventCard({ spec: seed, pointer }: {
  /** The served spec — a live turn paints from it at once (no round-trip for a fresh answer). */
  spec?: EventSpec;
  /** The pointer a rehydrated turn carries; the event is re-read through its own door. */
  pointer?: EventPointer;
}) {
  const [spec, setSpec] = React.useState<EventSpec | null>(
    seed && isEventSpec(seed) ? seed : null,
  );
  const [failed, setFailed] = React.useState(false);
  const [busyVerb, setBusyVerb] = React.useState<EventVerb | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const eventId = spec?.id ?? pointer?.eventId ?? null;
  // THE POINTER'S IDENTITY IS ITS ID (W0.4): hosts rebuild the pointer object on every parent
  // render (a streaming turn re-renders many times a second) — keying the re-read on the object
  // re-fetched per render. The primitive is the only identity that means "a different event".
  const pointerEventId = pointer?.eventId ?? null;
  const attempts = React.useRef<{ id: string | null; n: number }>({ id: null, n: 0 });

  /** THE RE-READ — the one door, used on mount and again whenever the event outran the card. */
  const reread = React.useCallback(async (id: string): Promise<EventSpec | null> => {
    try {
      const res = await fetch(`/api/events/${id}/card`);
      const json = await res.json().catch(() => null);
      // THE GUARD RUNS ON EVERY MOUNT: a malformed spec renders nothing, never a broken card.
      if (res.ok && isEventSpec(json?.spec)) return json.spec as EventSpec;
    } catch { /* honest failure below */ }
    return null;
  }, []);

  React.useEffect(() => {
    if (spec || failed || !pointerEventId) return;
    if (attempts.current.id !== pointerEventId) attempts.current = { id: pointerEventId, n: 0 };
    if (attempts.current.n >= REREAD_MAX_ATTEMPTS) { setFailed(true); return; }
    attempts.current.n += 1;
    let live = true;
    (async () => {
      const next = await reread(pointerEventId);
      if (!live) return;
      if (next) setSpec(next); else setFailed(true);
    })();
    return () => { live = false; };
  }, [pointerEventId, reread, spec, failed]);

  // THE PICKER'S SEED IS STABLE (W0.4): the kit resets its picker whenever `pickerDefaults` changes
  // IDENTITY, so a fresh object per render wiped the user's half-typed time mid-stream. The seed is
  // rebuilt only when the event itself (id · start · end) changes.
  const specId = spec?.id ?? null;
  const specStart = spec?.startISO ?? '';
  const specEnd = spec?.endISO ?? '';
  const pickerDefaults = React.useMemo(
    () => (specId ? pickerDefaultsOf({ startISO: specStart, endISO: specEnd }) : null),
    [specId, specStart, specEnd],
  );

  // ── THE DEED — the ONE door, and only ever from the user's own confirming click ───────────────
  const commit = React.useCallback(async (verb: EventVerb, args: EventVerbArgs) => {
    if (!spec) return;
    setBusyVerb(verb); setError(null);
    const win = args.pick ? windowFromPick(args.pick) : null;
    try {
      const res = await fetch(`/api/events/${spec.id}/deed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verb,
          // A PROPOSED window rides as the proposal composed it; a PICKED one as the user set it.
          ...(verb === 'reschedule'
            ? (win ?? (spec.proposal?.newStartISO && spec.proposal.newEndISO
              ? { newStartISO: spec.proposal.newStartISO, newEndISO: spec.proposal.newEndISO } : {}))
            : {}),
          ...(args.note ? { note: args.note } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409) {
        // THE VERB VANISHED HONESTLY — the event moved (answered elsewhere, cancelled, passed).
        // The card corrects itself from the truth rather than retrying a deed it may not do.
        // The SERVER'S OWN SENTENCE wins where it has one (in flight · a recurring series).
        const fresh = await reread(spec.id);
        setBusyVerb(null);
        if (fresh) setSpec(fresh);
        const said = typeof json?.reason === 'string' ? json.reason.trim() : '';
        if (said) { setError(said); return; }
        setError('That’s no longer possible — this event has changed since the card was drawn.');
        return;
      }
      if (!res.ok || json?.ok !== true || !isEventSpec(json?.spec)) throw new Error('deed');
      const next = json.spec as EventSpec;
      setSpec(next); setBusyVerb(null);
      // THE DONE WORD IS THE SERVER'S FACT: a move says where it landed, in the labels code
      // composed for the NEW window — never a label the card kept from before the deed.
      setDone(verb === 'reschedule'
        ? `Moved to ${[next.dayLabel, next.timeLabel].filter(Boolean).join(' · ')}`.trim()
        : EVENT_VERB_WORDS[verb].done);
    } catch {
      setBusyVerb(null);
      setError('That didn’t go through — try again.');
    }
  }, [reread, spec]);

  if (!spec) {
    // The turn's own words are already on screen, so a card still reading shows NOTHING rather
    // than a skeleton of facts it has not read. Only a genuine failure speaks, and quietly.
    return failed ? <div className="text-[12px] text-neutral-400">That event could not be read just now.</div> : null;
  }

  // THE PERMITTED SET, AS SERVED — `spec.verbs` in the ladder's order, worded by the contract.
  // Nothing here filters, reorders or invents; a verb missing from the set has no button.
  const notable = spec.noteVerbs ?? NO_NOTE;
  const verbs: EventCardVerb[] = spec.verbs.map((v) => ({
    id: v,
    label: EVENT_VERB_WORDS[v].label,
    armedLabel: EVENT_VERB_WORDS[v].armed,
    ...(IRREVERSIBLE_VERBS.includes(v) && CONSEQUENCE[v] ? { consequence: CONSEQUENCE[v]! } : {}),
    ...(notable.includes(v) ? { notable: true } : {}),
    ...(v === 'reschedule' ? { needsWindow: true } : {}),
    ...(busyVerb === v ? { busy: true } : {}),
    onConfirm: (args: EventVerbArgs) => void commit(v, args),
  }));

  // THE PROPOSAL ARMS ONE VERB, and only one the facts still permit. A served spec carries its
  // own; a rehydrated turn's pointer carries the one its turn proposed — honored only while it is
  // still in the served set (the card never resurrects a verb the ladder has since withdrawn).
  const selected = spec.proposal
    ?? (pointer?.proposal && spec.verbs.includes(pointer.proposal.verb) ? pointer.proposal : null);
  // THE NOTE IS DELIVERED OR NOT OFFERED (W0.4): a proposal's note survives only on a verb whose
  // provider carries it — otherwise the card would prefill words that go nowhere.
  const proposal = selected && selected.note && !notable.includes(selected.verb)
    ? { ...selected, note: undefined }
    : selected;

  const others = spec.attendees ?? [];
  const attendeesLine = others.length
    ? `with ${others.join(', ')}${spec.moreAttendees ? ` +${spec.moreAttendees}` : ''}`
    : undefined;

  const standing = spec.facts.seat === 'organizer' || spec.facts.seat === 'solo'
    ? 'you organise'
    : spec.facts.seat === 'invitee' && spec.facts.myResponse
      ? STANDING_WORD[spec.facts.myResponse]
      : spec.facts.seat === 'invitee' ? STANDING_WORD.needsAction : null;

  // WHY THERE IS NOTHING TO DO, said plainly — the ladder's two structural silences.
  const quietLine = spec.verbs.length === 0
    ? (spec.facts.passed ? 'This one’s in the past.' : !spec.facts.writable ? 'Read-only calendar.' : null)
    : null;

  const card: ThreadCard = {
    kind: 'event',
    id: `event-${spec.id}`,
    title: spec.title,
    ...(spec.dayLabel ? { dayLabel: spec.dayLabel } : {}),
    ...(spec.timeLabel ? { timeLabel: spec.timeLabel } : {}),
    ...(attendeesLine ? { attendeesLine } : {}),
    ...(spec.location ? { location: spec.location } : {}),
    ...(standing ? { standing } : {}),
    verbs,
    ...(proposal && !done ? { armedVerbId: proposal.verb } : {}),
    ...(proposal?.newLabel ? { proposedLabel: proposal.newLabel } : {}),
    ...(proposal?.note ? { note: proposal.note } : {}),
    ...(pickerDefaults ? { pickerDefaults } : {}),
    ...(done ? { done } : {}),
    ...(quietLine ? { quietLine } : {}),
    ...(error ? { error } : {}),
  };

  return <ThreadCardView card={card} />;
}
