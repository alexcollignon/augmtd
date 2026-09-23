'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FORWARD HOST (W3-C — docs/component-map.md §2 item 8, Sep 22)
//
// "Forward is the one prepared verb whose artifact carries no card; it degrades to 'Open →' beside
// reply and invite cards." It carries one now. The kit owns the rendering; this owns the two doors
// and the one rule that matters about them:
//
//   1 · PREPARE READS, EXECUTE SENDS. `/api/items/prepare` is grounded and has NO side effects —
//       it hands back the LITERAL addresses the item itself evidenced (never an invented one) and
//       the subject. `/api/items/execute` is the ONLY place a forward fires, and it fires through
//       THE COMMIT DOOR (claim → fire → record, exactly-once at the send edge).
//   2 · THE CLICK IS THE APPROVAL (THE HUMAN-IN-THE-LOOP LAW). Send ARMS; the second click commits.
//       Nothing reaches a mailbox between the two, and a duplicate that the commit door already
//       recorded comes back as the receipt it is — never as a second send.
//   3 · THE OBJECT IS MOUNTED, NOT REDRAWN. The message being forwarded is THE ONE OBJECT CARD
//       (components/room/source-object.tsx → the kit's `source` kind), folded. The old card drew
//       its own `dangerouslySetInnerHTML` body; what actually goes out has always been composed
//       server-side at the commit door, so that lane was a second thread renderer for nothing.
//   4 · THE RECIPIENTS EDITOR IS THE ONE EDITOR. `AttendeeChips` (components/home/people-chips) —
//       the same typeahead the invite and email cards mount. The local copy this replaced was the
//       fourth recipients-chip editor in the repo (component-map §2 item 10).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { ThreadCard } from '@/components/thread/types';
import { AttendeeChips } from '@/components/home/people-chips';
import { SourceObjectMount } from '@/components/room/source-object';
import { announceDeed } from '@/lib/room/deed-echo';
import type { ItemKind } from '@/components/home/item-detail';
import { handItemKindOf } from '@/lib/prepare/hand';

/** What the prepare door hands back for a forward (lib/home/prepare-action.ts). */
type PreparedForward = { type: 'forward'; to: string[]; subject: string; note: string };

/** THE ONE VOCABULARY of this card. */
export const FORWARD_WORDS = {
  send: 'Forward it',
  armed: 'Confirm forward',
  ready: 'ready to forward',
  sending: 'forwarding…',
  sent: 'forwarded',
  noRecipient: 'Add at least one recipient.',
  prepareFailed: 'Could not prepare the forward — add the recipient below.',
  failed: 'Could not forward the email.',
  sentLine: (to: string[]) =>
    `Forwarded${to.length ? ` to ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}` : ''}.`,
} as const;

export default function ForwardCard({ kind, entityId, taskId, itemLevel, onSent, onCancel, id }: {
  kind: ItemKind;
  entityId: string;
  taskId?: string;
  /** Opened from the item-level palette (no plan step) — the prepare door is told to prepare a
   *  forward for the whole item even without a forward step in the plan. */
  itemLevel?: boolean;
  onSent?: () => void;
  onCancel?: () => void;
  id?: string;
}) {
  const [loading, setLoading] = React.useState(true);
  const [to, setTo] = React.useState<string[]>([]);
  const [subject, setSubject] = React.useState('');
  const [note, setNote] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // W9.1 · THE USER'S HAND WINS: only a USER change arms the save (the pre-fill never does).
  const touchedRef = React.useRef(false);

  // THE READ — grounded, no side effects. The recipient stays empty unless a literal address was
  // evidenced in the item's own text: the card asks for it rather than inventing one.
  React.useEffect(() => {
    let live = true;
    setLoading(true);
    fetch('/api/items/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, entityId, ...(taskId ? { taskId } : {}), ...(itemLevel ? { actionType: 'forward' } : {}) }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('prepare'))))
      .then((d: PreparedForward | { type: string }) => {
        if (!live) return;
        if (d && (d as PreparedForward).type === 'forward') {
          const f = d as PreparedForward;
          setTo(Array.isArray(f.to) ? f.to : []);
          setSubject(f.subject || 'Fwd:');
          setNote(f.note || '');
        }
      })
      .catch(() => { if (live) setError(FORWARD_WORDS.prepareFailed); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [kind, entityId, taskId, itemLevel]);

  // ── THE EDIT DOOR (W9.1): edited recipients / note SAVE onto the prepared forward, stamped as
  // the user's hand — the pass never re-prepares over them; a moved thread only marks them.
  const handKind = handItemKindOf(kind);
  React.useEffect(() => {
    if (!touchedRef.current || sent || handKind !== 'inbox') return;
    const t = setTimeout(() => {
      void fetch('/api/items/prepared', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemKind: handKind, itemId: entityId, kind: 'forward', forward: { to, note } }),
      }).catch(() => { /* the fields stay in the card; the next edit retries */ });
    }, 1200);
    return () => clearTimeout(t);
  }, [to, note, sent, handKind, entityId]);

  // THE DEED — the ONE door, and only ever from the armed second click the kit hands back.
  const send = React.useCallback(async () => {
    if (sending || sent) return;
    if (to.length === 0) { setError(FORWARD_WORDS.noRecipient); return; }
    setSending(true); setError(null);
    try {
      const res = await fetch('/api/items/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, entityId, ...(taskId ? { taskId } : {}), action: { type: 'forward', to, note } }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.ok) {
        // A DUPLICATE IS A RECEIPT, NOT A SECOND SEND: the commit door already recorded this one.
        setSent(true); onSent?.(); announceDeed();
        return;
      }
      setError(typeof data.error === 'string' ? data.error : FORWARD_WORDS.failed);
    } catch {
      setError(FORWARD_WORDS.failed);
    } finally {
      setSending(false);
    }
  }, [entityId, kind, note, onSent, sending, sent, taskId, to]);

  const card: ThreadCard = {
    kind: 'forward',
    ...(id ? { id } : {}),
    state: sent ? 'sent' : to.length === 0 ? 'needs_recipient' : 'ready',
    to,
    // A SENT FORWARD IS A RECORD: the editor stands down and the addresses read as what was mailed.
    ...(sent ? {} : {
      recipientsEditor: (
        <span className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5">
          <AttendeeChips attendees={to} onChange={(next) => { touchedRef.current = true; setTo(next); setError(null); }} />
        </span>
      ),
      onEditNote: (v: string) => { touchedRef.current = true; setNote(v); },
    }),
    ...(subject ? { subject } : {}),
    ...(note ? { note } : {}),
    // THE OBJECT, FOLDED — the ONE object mount, only where the item HAS a thread to show.
    ...(kind === 'email' ? { sourceNode: <SourceObjectMount itemId={entityId} /> } : {}),
    sendLabel: FORWARD_WORDS.send,
    armedLabel: FORWARD_WORDS.armed,
    ...(sent ? {} : { onSend: () => void send() }),
    ...(onCancel && !sent ? { onCancel } : {}),
    receipt: sent ? FORWARD_WORDS.sentLine(to)
      : sending ? FORWARD_WORDS.sending
      : to.length > 0 ? FORWARD_WORDS.ready : undefined,
    ...(error ? { error } : {}),
    ...(sending ? { busy: true } : {}),
    ...(loading ? { loading: true } : {}),
  };

  return <ThreadCardView card={card} />;
}
