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
// THE IN-FLIGHT RULE: show what is served, never a spinner-only hole. With nothing read yet and
// nothing handed in, the mount renders NOTHING and fills in when the door answers — an empty
// bordered frame that later grows content is a layout lie; a card that arrives is not.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { ThreadCardView } from '@/components/thread';
import type { ThreadCard } from '@/components/thread/types';
import EventCard from '@/components/home/event-card';
import { AttachmentLightbox, type LightboxFile } from '@/components/ui/attachment-lightbox';
import { loadThreadDoor, peekThreadDoor, type ThreadDoorData } from '@/lib/inbox/thread-door';
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
// conversation is one click away — "Later in this conversation →" opens the thread drawer.
/** The served shape (lib/commitments/source.ts `EmailSource`) — the payload is the contract. */
export type EmailSourceFacts = { id: string; threadId: string | null; subject: string | null; from: string | null; receivedAt: string | null; excerpt: string | null };

/** The door label — one wording, so the gate asserts the mapping and not a scattered literal. */
export const LATER_IN_CONVERSATION_LABEL = 'Later in this conversation →';

/** The pure producer: served facts → the kit's `source` card (the message's own words). */
export function emailSourceCard(m: EmailSourceFacts, onOpen?: () => void): ThreadCard {
  return {
    kind: 'source', id: `source-email-${m.id}`, source: 'email',
    who: m.from, when: whenLabel(m.receivedAt),
    ...(m.subject ? { title: m.subject } : {}),
    ...(m.excerpt ? { excerpt: m.excerpt } : {}),
    ...(onOpen ? { onOpen, openLabel: LATER_IN_CONVERSATION_LABEL } : {}),
  };
}

export function EmailSourceMount({ source, onOpen }: { source: EmailSourceFacts; onOpen?: () => void }) {
  return <ThreadCardView card={emailSourceCard(source, onOpen)} />;
}

export function SourceObjectMount({ itemId, onOpenThread, openLabel }: {
  /** The inbox item whose thread IS the object under the ask. */
  itemId: string;
  /** The one door — the host's own (a room focuses; the deep-dive raises its drawer). */
  onOpenThread?: () => void;
  openLabel?: string;
}) {
  const [data, setData] = useState<ThreadDoorData | null>(() => peekThreadDoor(itemId));
  // THE ONE VIEWER: one index into the WHOLE context, so ‹ › are honest (T25.9b).
  const [openAt, setOpenAt] = useState<number | null>(null);

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

  if (!data) return null;
  const who = data.fromName?.trim() || data.fromAddress?.trim() || null;
  const invite = data.invite;
  const isInvite = !!(invite && (invite.spec || invite.card));

  const mail = (
    <>
      <ThreadCardView card={{
        kind: 'source', id: `source-${itemId}`, source: 'email',
        who, when: whenLabel(data.receivedAt),
        ...(data.subject ? { title: data.subject } : {}),
        messages: data.tail.map((m) => ({ id: m.id, author: m.author, body: m.body })),
        files: files.map((f, i) => ({ name: f.name, size: f.size ?? null, onOpen: () => setOpenAt(i) })),
        ...(onOpenThread ? { onOpen: onOpenThread, openLabel: openLabel ?? 'Thread →' } : {}),
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
