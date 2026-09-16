'use client';

import { useEffect, useState } from 'react';
import { announceDeed } from '@/lib/room/deed-echo';
import { ThreadCardView, type ThreadCard } from '@/components/thread';
import { AttendeeChips } from '@/components/home/people-chips';
import {
  inviteCardOf, INVITE_OPEN_OPTION, type InviteSlot, type PreparedInviteLike,
} from '@/lib/prepare/invite-card';
import type { ItemPlanKind } from '@/lib/home/item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE CARD'S HOST (docs/threads-plan.md — THE CARD CONTRACT, Sep 8).
//
// The kit renders; this file DOES. It is the successor of item-detail's `InvitePreviewCard`, which
// retires with it: the donor's mechanics — the /api/items/prepare pre-fill, the editable fields,
// the approve-before-commit send through /api/items/execute (the ONE commit door, exactly-once via
// the commit ledger) — survive byte-for-byte; only the presentation moved to the kit's `invite`
// card, so the same card renders in the thread, in the stage, and wherever a producer lands one.
//
// Laws honoured here:
//  · FILLED FROM THE ONE GROUNDING — the facts come from the preparer that the pass and the room
//    brief already read; this host never scrapes the item itself.
//  · OPTIONS ARE REASONED, THEN CODE-VALIDATED — the alternatives arrive already verified against
//    the item's own words (`statedSlot`); picking one only re-points the fields at a slot that
//    already passed. THE OPEN ROW is the escape hatch, and it carries its own time field.
//  · THE COMMIT IS THE DOOR — Send routes to /api/items/execute and nowhere else. The card moves
//    WHERE you approve, never WHETHER.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type PreparedInviteResponse = PreparedInviteLike & { type: 'calendar_invite' };

function isoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function localInputToISO(v: string): string {
  if (!v) return '';
  const d = new Date(v); // parsed as local wall-clock
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
const plus30 = (iso: string) => new Date(new Date(iso).getTime() + 30 * 60000).toISOString();

export function InviteCard({ kind, entityId, taskId, verdictLevel, chat, onSent, onSuggestAnother }: {
  /** THE ITEM LANE — the card belongs to a judged item; its payload is prepared on demand and its
   *  Send commits through /api/items/execute (which also stamps the item's artifact spent). */
  kind?: ItemPlanKind;
  entityId?: string;
  taskId?: string;
  /** THE CHAT LANE (threads plan — EVERY THREAD, EVERY PRODUCER): the same card, born from a plain
   *  prompt in a thread. The payload arrives already prepared (no prepare fetch) and Send commits
   *  through /api/invites/send, which re-reads the STORED payload by this id. TWO DOORS, ONE
   *  EXECUTOR — the stores differ (an item vs the chat_invite row), the send does not. */
  chat?: { inviteId: string; invite: PreparedInviteLike };
  /** W1 — mounted by the judged `schedule` VERDICT (no plan step): hint the prepare endpoint. */
  verdictLevel?: boolean;
  onSent?: () => void;
  /** THE OPEN ROW also focuses the host's composer, where "how about Thursday?" is just words. */
  onSuggestAnother?: () => void;
}) {
  const [loading, setLoading] = useState(!chat);
  const [title, setTitle] = useState('');
  const [startISO, setStartISO] = useState('');
  const [endISO, setEndISO] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [proposed, setProposed] = useState(false);
  const [alternatives, setAlternatives] = useState<InviteSlot[]>([]);
  const [picked, setPicked] = useState<string | null>(null);   // the selector's current row id
  const [customLocal, setCustomLocal] = useState('');           // the open row's own time field
  const [editingAttendees, setEditingAttendees] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // THE CHAT LANE's pre-fill: the payload came WITH the turn (the preparer already ran when the
  // card was spoken) — seed the fields once, fetch nothing.
  useEffect(() => {
    if (!chat) return;
    const inv = chat.invite;
    setTitle(inv.title || '');
    setStartISO(inv.startISO || '');
    setEndISO(inv.endISO || '');
    setAttendees(Array.isArray(inv.attendees) ? inv.attendees : []);
    setDescription(inv.description || '');
    setTimezone(inv.timezone || 'UTC');
    setProposed(inv.proposed === true);
    setAlternatives((Array.isArray(inv.alternatives) ? inv.alternatives : [])
      .concat(inv.startISO ? [{ startISO: inv.startISO, endISO: inv.endISO || '', note: 'the prepared time' }] : []));
    setPicked(inv.startISO || null);
    setLoading(false);
    // Keyed on the invite's ID, never the object: a parent re-render must not wipe the edits the
    // user is making in the card (the no-mutation law, at component scale).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.inviteId]);

  // THE ITEM LANE's pre-fill, from the grounded preparer (prepare has NO side effects).
  useEffect(() => {
    if (chat || !entityId || !kind) return;
    let alive = true;
    setLoading(true);
    fetch('/api/items/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, entityId, taskId, ...(verdictLevel ? { actionType: 'calendar_invite' } : {}) }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PreparedInviteResponse | { type: string }) => {
        if (!alive) return;
        if (d && (d as PreparedInviteResponse).type === 'calendar_invite') {
          const inv = d as PreparedInviteResponse;
          setTitle(inv.title || '');
          setStartISO(inv.startISO || '');
          setEndISO(inv.endISO || '');
          setAttendees(Array.isArray(inv.attendees) ? inv.attendees : []);
          setDescription(inv.description || '');
          setTimezone(inv.timezone || 'UTC');
          setProposed(inv.proposed === true);
          // The verified alternatives, MINUS whichever slot is currently filled in — so the
          // originally prepared slot keeps its row after the user picks another one.
          setAlternatives((Array.isArray(inv.alternatives) ? inv.alternatives : [])
            .concat(inv.startISO ? [{ startISO: inv.startISO, endISO: inv.endISO || '', note: 'the prepared time' }] : []));
          setPicked(inv.startISO || null);
        }
      })
      .catch(() => { if (alive) setErr('Could not prepare the invite — pick a time below.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.inviteId, kind, entityId, taskId, verdictLevel]);

  // THE MAPPER — one derivation, shared with every other mount. `alternatives` holds every
  // verified slot; the one currently filled in is excluded, so the prepared time keeps a row of
  // its own after the user picks another (a chosen alternative must never erase the original).
  const props = inviteCardOf({
    title, startISO, endISO, attendees, description, timezone, proposed,
    alternatives: alternatives.filter((a) => a.startISO !== startISO),
  });

  const pickOption = (id: string) => {
    setErr(null);
    setPicked(id);
    if (id === INVITE_OPEN_OPTION) { onSuggestAnother?.(); return; }
    const alt = alternatives.find((a) => a.startISO === id);
    if (alt) { setStartISO(alt.startISO); setEndISO(alt.endISO || plus30(alt.startISO)); setProposed(false); }
  };

  const pickTime = (localValue: string) => {
    setCustomLocal(localValue);
    const iso = localInputToISO(localValue);
    if (!iso) return;
    setStartISO(iso);
    setEndISO(plus30(iso));
    setProposed(false);
  };

  const send = async () => {
    if (sending || sent) return;
    if (!title.trim()) { setErr('Add a title.'); return; }
    if (!startISO || !endISO) { setErr('Pick a time before it can send.'); return; }
    if (attendees.length === 0) { setErr('Add at least one attendee.'); return; }
    setSending(true); setErr(null);
    try {
      // ONE DEED, THE DOOR THAT OWNS ITS STORE: a chat-born card's payload lives in the
      // chat_invite row, so its commit door reads THAT row; an item-born card's lives on the item.
      // Both doors call the same executor through the same commit ledger (exactly-once).
      const res = chat
        ? await fetch('/api/invites/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inviteId: chat.inviteId,
              edits: { title: title.trim(), startISO, endISO, attendees, description },
            }),
          })
        : await fetch('/api/items/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, entityId, taskId,
          action: { type: 'calendar_invite', title: title.trim(), startISO, endISO, attendees, description, timezone },
        }),
      });
      // THE SAME-CLIENT ECHO (Sep 8): a sent invite used to be invisible to the room mounted
      // around this card — no event, no refetch, so the pinned brief kept asking for it.
      if (res.ok) { setSent(true); onSent?.(); announceDeed(); }
      else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not send the invite.');
      }
    } catch { setErr('Could not send the invite.'); }
    finally { setSending(false); }
  };

  if (loading) {
    return <div className="w-full max-w-[480px] rounded-xl border border-neutral-200/80 bg-white p-4"><div className="h-24 animate-pulse rounded-lg bg-neutral-100" /></div>;
  }

  const card: ThreadCard = {
    kind: 'invite',
    id: `invite-${chat?.inviteId ?? entityId ?? 'card'}`,
    ...props,
    // The picked row wins over the mapper's default (the prepared slot).
    selectedOptionId: picked ?? props.selectedOptionId,
    // THE WORKING STATE, the same idiom the email card wears (owner, Sep 9): the moment a commit is
    // in flight the invite pulses and its commit row stands down — no click leaves the card mute.
    busy: sending,
    ...(sent ? {} : {
      onPickOption: pickOption,
      onPickTime: pickTime,
      pickedTimeValue: customLocal || isoToLocalInput(startISO),
      onEdit: (field, value) => {
        if (field === 'title') setTitle(value ?? '');
        else if (field === 'description') setDescription(value ?? '');
        else setEditingAttendees((v) => !v);
      },
      ...(editingAttendees ? {
        attendeesEditor: (
          <span className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5">
            <AttendeeChips attendees={attendees} onChange={setAttendees} />
          </span>
        ),
      } : {}),
      // TRUTH BEFORE PRESENTATION at the commit row too: with no grounded time there is nothing
      // to send, so the card carries NO Send — it asks for the time and waits (the board's
      // second state). Picking or typing one arms the commit in place.
      ...(props.state === 'ready' ? { onSend: send, sendLabel: sending ? 'Sending…' : 'Send invite', sendDisabled: sending } : {}),
    }),
    error: err ?? undefined,
    // THE RECEIPT — a word only a system that already worked can print.
    receipt: sent ? 'sent' : sending ? 'sending…' : props.state === 'ready' ? 'ready' : undefined,
  };

  return <ThreadCardView card={card} />;
}
