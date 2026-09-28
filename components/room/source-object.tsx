'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OBJECT'S ONE MOUNT (docs/threads-plan.md — THE OPENING CONTRACT, clause 1).
//
// The kit owns the RENDERING (components/thread/source-object-card.tsx); this owns the READ and the
// VIEWER, because the kit is presentational by construction. Every seat that must show what it is
// talking about — a decision's object, a room's opening, an ask — mounts THIS, and therefore shows
// the same card, from the same door, with the same excerpt law behind it.
//
// THE READ IS THE DECK'S OWN (lib/inbox/thread-door.ts): lazy, cached per item for the session,
// in-flight shared. A surface that has already warmed a thread (the triage deck, one card ahead)
// hands this mount an instant first paint.
//
// THE IN-FLIGHT RULE (amended W15.1): show what is served at once. With nothing read yet the mount
// stands the kit's SKELETON at exactly the card's max height (SOURCE_CARD_MAX_PX) — the card that
// replaces it can never be taller, so a host's actions below are never shoved down on arrival.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThreadCardView } from '@/components/thread';
// W18.A · THE ONE EMAIL CARD — the header's "to" line and the open conversation, composed HERE from
// what the one reader already served (pure helpers; the kit prints).
import { recipientsLine, threadMessagesOf, type RawThreadMessage } from '@/components/thread/source-text';
// W15.1 · THE ONE THREAD COMPONENT's loading frame — the card's own max height, no layout shift.
import { SourceObjectSkeleton } from '@/components/thread/source-object-card';
import type { ThreadCard } from '@/components/thread/types';
import EventCard from '@/components/home/event-card';
import { AttachmentLightbox, type LightboxFile } from '@/components/ui/attachment-lightbox';
import { loadThreadDoor, loadThreadRaw, peekThreadDoor, type ThreadDoorData, type ThreadRawPayload } from '@/lib/inbox/thread-door';
import type { InviteCardFacts } from '@/lib/present/invite-object';

// ── INVITES ARE EVENTS (W7.4) ────────────────────────────────────────────────────────────────────
// An invitation's object is its MEETING, rendered by the kit's EVENT card — never the raw invite mail
// ("…You have been invited… YesNoMaybe… Sent by Google"). Two sources, both served by the door:
//   · `invite.spec` — the linked calendar row's live spec (THE ONE event host; RSVP verbs only when the
//     user is an invitee — narrowed server-side, lib/present/invite-object.ts);
//   · `invite.card` — no row exists (beyond the sync horizon, or cancelled): the invite's OWN facts,
//     composed by code, with NO verbs. No event to act on ⇒ no deed.
// The mail stays one click away ("View email"), in the same mount, through the same card it always was.

/** The kit card for an invite with no calendar row — facts only, one honest quiet line. */
export function inviteKitCard(itemId: string, c: InviteCardFacts): ThreadCard {
  const who = [
    c.organizer ? `from ${c.organizer}` : '',
    c.attendees.length ? `with ${c.attendees.join(', ')}${c.moreAttendees ? ` +${c.moreAttendees}` : ''}` : '',
  ].filter(Boolean).join(' · ');
  const quietLine = c.cancelled ? 'Cancelled by the organiser.'
    : c.passed ? 'This one’s in the past.'
      : 'Not on your synced calendar — nothing to answer from here.';
  return {
    kind: 'event', id: `invite-${itemId}`,
    title: c.title,
    ...(c.dayLabel ? { dayLabel: c.dayLabel } : {}),
    ...(c.timeLabel ? { timeLabel: c.timeLabel } : {}),
    ...(who ? { attendeesLine: who } : {}),
    ...(c.location ? { location: c.location } : {}),
    ...(c.recurring ? { standing: 'repeats' } : {}),
    verbs: [],
    quietLine,
  };
}

/** The date label the card prints — composed HERE (the kit reads no clock). */
function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── A MEETING-BORN COMMITMENT'S SOURCE IS ITS MEETING (W7.3) ─────────────────────────────────────
// W7.2 made the item door's object card its OWN source; a commitment born in a meeting had none, so
// the room showed nothing of where the promise came from. The meeting renders as the kit's existing
// `source` kind (`source: 'meeting'` — no new visual language): title · date · who was there · the
// summary's first words (clipped server-side by THE ONE CLIPPER, the cut declared) · "Open meeting →".
/** The served shape (lib/commitments/source.ts `MeetingSource`) — the payload is the contract. */
export type MeetingSourceFacts = { id: string; addressId: string; title: string; startISO: string | null; attendees: string[]; excerpt: string | null };

/** The pure producer: served facts → the kit's `source` card. The byline names who was there. */
export function meetingSourceCard(m: MeetingSourceFacts, onOpen?: () => void): ThreadCard {
  const shown = m.attendees.slice(0, 3);
  const more = m.attendees.length - shown.length;
  const who = shown.length ? `with ${shown.join(', ')}${more > 0 ? ` +${more}` : ''}` : null;
  return {
    kind: 'source', id: `source-meeting-${m.id}`, source: 'meeting',
    who, when: whenLabel(m.startISO), title: m.title,
    ...(m.excerpt ? { excerpt: m.excerpt } : {}),
    ...(onOpen ? { onOpen, openLabel: 'Open meeting →' } : {}),
  };
}

export function MeetingSourceMount({ meeting, onOpen }: { meeting: MeetingSourceFacts; onOpen?: () => void }) {
  return <ThreadCardView card={meetingSourceCard(meeting, onOpen)} />;
}

// ── A COMMITMENT'S SOURCE IS ITS OWN MESSAGE (stabilization W11.1 · ONE OBJECT, ONE DOOR) ─────────
// Found live (owner walk, Sep 23): an email-born commitment's card showed the thread's LATEST message
// (weeks after the promise) — SourceObjectMount reads the thread door, whose tail is the newest. The
// commitment's object is the ONE message it was extracted from (`commitments.source_id`, read by
// lib/commitments/source.ts emailSourceOf and served on the commitment's payload); the rest of the
// conversation is one click away — the card's ONE door, "Open thread" (W15.1 · one label).
/** The served shape (lib/commitments/source.ts `EmailSource`) — the payload is the contract. */
export type EmailSourceFacts = { id: string; threadId: string | null; subject: string | null; from: string | null; receivedAt: string | null; excerpt: string | null;
  /** W15.4 · why this item exists, in the source's own words ("You wrote: “…”") — lib/commitments/source.ts sourceQuoteOf. */
  quote?: string | null };

/** W18.A · what an email source card may carry beyond its facts — each only when served. */
export type EmailSourceExtras = {
  quote?: string | null;
  /** The sender's address (muted beside the name) — from the conversation the host already read. */
  fromAddress?: string | null;
  /** The composed recipients line (source-text.ts recipientsLine). */
  to?: string | null;
  /** THE ONE DOOR: the conversation, unfolded in place (never a navigation). */
  thread?: SourceThreadFacts | null;
};
type SourceThreadFacts = NonNullable<Extract<ThreadCard, { kind: 'source' }>['thread']>;

/** The pure producer: served facts → the kit's `source` card (the message's own words). The door's
 *  words are the kit's (OPEN_THREAD_LABEL) and its act is the kit's (the in-place expansion) — a host
 *  passes the conversation, never a label and never a navigation. `quote` is the kit's optional
 *  highlighted line (W15.4 supplies the user's own promise). */
export function emailSourceCard(m: EmailSourceFacts, x: EmailSourceExtras = {}): ThreadCard {
  return {
    kind: 'source', id: `source-email-${m.id}`, source: 'email',
    who: m.from, when: whenLabel(m.receivedAt),
    ...(m.subject ? { title: m.subject } : {}),
    ...(m.excerpt ? { excerpt: m.excerpt } : {}),
    ...(x.quote ? { quote: x.quote } : {}),
    ...(x.fromAddress ? { fromAddress: x.fromAddress } : {}),
    ...(x.to ? { to: x.to } : {}),
    ...(x.thread ? { thread: x.thread } : {}),
  };
}

// ── W18.A · THE CONVERSATION, READ THROUGH THE ONE DOOR ──────────────────────────────────────────
// The open card needs the WHOLE conversation: the door's raw payload (lib/inbox/thread-door.ts
// loadThreadRaw — one read per item, cached, in-flight shared with the narrowed door data). `eager`
// = read now (the item's own thread mount, whose door data rides the same flight); otherwise the read
// starts only when the reader opens the thread — or at once when this session already holds it.
function useConversation(threadItemId: string | null | undefined, eager: boolean) {
  const [raw, setRaw] = useState<ThreadRawPayload | null>(null);
  useEffect(() => {
    setRaw(null);
    if (!threadItemId) return;
    let live = true;
    if (eager || peekThreadDoor(threadItemId)) void loadThreadRaw(threadItemId).then((d) => { if (live) setRaw(d); });
    return () => { live = false; };
  }, [threadItemId, eager]);
  const onExpand = useCallback(() => {
    if (!threadItemId || raw) return;
    void loadThreadRaw(threadItemId).then((d) => setRaw(d ?? { messages: [] }));
  }, [threadItemId, raw]);
  const rawMessages: RawThreadMessage[] = Array.isArray(raw?.messages) ? (raw!.messages as RawThreadMessage[]) : [];
  const messages = useMemo(() => (raw ? threadMessagesOf(rawMessages, whenLabel) : null), [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rawMessages, messages, onExpand };
}

/** The served recipients of one raw message, as the header's "to" line. */
function toLineOf(m: RawThreadMessage | undefined): string | null {
  const r = m as (RawThreadMessage & { to_addresses?: string[] | null; cc_addresses?: string[] | null }) | undefined;
  return r ? recipientsLine(r.to_addresses ?? null, r.cc_addresses ?? null) : null;
}

export function EmailSourceMount({ source, quote, threadItemId }: {
  source: EmailSourceFacts;
  quote?: string | null;
  /** W18.A · the inbox item that holds the source message's THREAD — the key of the one thread door.
   *  Present → "Open thread" unfolds the conversation in place, scrolled to THIS message. */
  threadItemId?: string | null;
}) {
  const conv = useConversation(threadItemId, false);
  // The source message's own header facts, once the conversation has been read (never guessed).
  const own = conv.rawMessages.find((m) => m.id === source.id);
  const fromAddress = own?.from?.trim() || null;
  const card = emailSourceCard(source, {
    quote: quote ?? source.quote ?? null,
    fromAddress, to: toLineOf(own),
    thread: threadItemId ? { messages: conv.messages, highlightId: source.id, onExpand: conv.onExpand } : null,
  });
  return <ThreadCardView key={source.id} card={card} />;
}

// ── THE THREAD'S OWN MOUNT (W15.1 · ONE THREAD COMPONENT) ────────────────────────────────────────
// The door's tail renders through the kit's ONE source card: the newest message's own words, the
// older served one folded to a line, "+N earlier" for the rest of the conversation (the door's own
// count), a fixed max height, and ONE door label. While the door is being read the mount stands a
// skeleton of exactly the card's max height (THE IN-FLIGHT RULE, amended W15.1: a stable frame
// beats a card that arrives and shoves the host's actions down).
export function SourceObjectMount({ itemId, quote, highlightId }: {
  /** The inbox item whose thread IS the object under the ask. */
  itemId: string;
  /** The kit's optional highlighted line, above the message. */
  quote?: string | null;
  /** W18.A · the message the item came from, marked in the open conversation (default: the newest). */
  highlightId?: string | null;
}) {
  const [data, setData] = useState<ThreadDoorData | null>(() => peekThreadDoor(itemId));
  // THE ONE VIEWER: one index into the WHOLE context, so ‹ › are honest (T25.9b).
  const [openAt, setOpenAt] = useState<number | null>(null);
  // W18.A · THE ONE DOOR IS THE CONVERSATION, IN PLACE — the same flight as the door data above.
  const conv = useConversation(itemId, true);

  useEffect(() => {
    let live = true;
    setData(peekThreadDoor(itemId));
    setOpenAt(null);
    void loadThreadDoor(itemId).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [itemId]);

  const files: LightboxFile[] = useMemo(
    () => (data?.files ?? []).map((f) => ({ name: f.name, mime: f.mime ?? null, size: f.size ?? null, ref: f.ref ?? null })),
    [data],
  );

  const [showMail, setShowMail] = useState(false);
  useEffect(() => { setShowMail(false); }, [itemId]);

  if (!data) return <SourceObjectSkeleton />;
  const who = data.fromName?.trim() || data.fromAddress?.trim() || null;
  const toLine = toLineOf(conv.rawMessages[conv.rawMessages.length - 1]);
  const invite = data.invite;
  const isInvite = !!(invite && (invite.spec || invite.card));

  const mail = (
    <>
      <ThreadCardView key={itemId} card={{
        kind: 'source', id: `source-${itemId}`, source: 'email',
        who, when: whenLabel(data.receivedAt),
        // W18.A · THE EMAIL HEADER — the sender's address and the newest message's recipients, as the
        // door served them (absent → no row).
        ...(data.fromAddress ? { fromAddress: data.fromAddress } : {}),
        ...(toLine ? { to: toLine } : {}),
        ...(data.subject ? { title: data.subject } : {}),
        messages: data.tail.map((m) => ({ id: m.id, author: m.author, body: m.body, when: whenLabel(m.at) })),
        // "+N earlier" — the conversation beyond the served tail, counted by the door (never guessed).
        ...(data.count > data.tail.length ? { earlierCount: data.count - data.tail.length } : {}),
        ...(quote ? { quote } : {}),
        files: files.map((f, i) => ({ name: f.name, size: f.size ?? null, onOpen: () => setOpenAt(i) })),
        // W18.A · THE ONE DOOR: "Open thread" / "+N earlier" unfold the whole conversation here.
        thread: { messages: conv.messages, highlightId: highlightId ?? null, onExpand: conv.onExpand },
      }} />
      {openAt !== null && files.length > 0 && (
        <AttachmentLightbox files={files} index={openAt} onIndex={setOpenAt} onClose={() => setOpenAt(null)} />
      )}
    </>
  );

  if (!isInvite) return mail;

  return (
    <div className="flex w-full flex-col gap-2">
      {invite!.card && (invite!.cancelled || !invite!.spec)
        ? <ThreadCardView card={inviteKitCard(itemId, invite!.card)} />
        : <EventCard spec={invite!.spec!} />}
      <button type="button" onClick={() => setShowMail((v) => !v)}
        className="aug-focus self-start text-[12px] font-medium text-indigo-600 transition-colors hover:text-indigo-700">
        {showMail ? 'Hide email' : 'View email'}
      </button>
      {showMail && mail}
    </div>
  );
}
