'use client';
// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT'S CARDS, ONE RENDERER (stabilization W20.B · A CLAIM RENDERS IN EVERY CHAT).
//
// The Home chat and the item rooms both render a chat turn's cards through THIS function — the same
// kit hosts, in the same order, from the same shape (`ChatCards`, lib/present/turn-card.ts, whose
// hydrator/payload readers are the other half). The rooms used to carry their own renders for three
// kinds and none for the invite, the email draft or the bulk deed, so "Here's the invite" stood over
// nothing. One rendering per kind: a new card kind is a row in the table and a case here.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import { EmailCard } from '@/components/home/email-card';
import { InviteCard } from '@/components/home/invite-card';
import BulkDeedCard from '@/components/home/bulk-deed-card';
import CollectionCard from '@/components/home/collection-card';
import EventCard from '@/components/home/event-card';
import ChangeCard from '@/components/home/change-card';
import type { ChatCards } from '@/lib/present/turn-card';

export type ChatCardOpts = {
  /** "Ask about it" on a collection speaks through the surface's ONE composer (clicks are words). */
  onAsk?: (text: string) => void;
  /** The invite's "suggest another time" focuses the surface's composer. */
  onSuggestAnother?: () => void;
};

/** THE ONE RENDERER — every card a chat turn carries, as mountable nodes with stable ids. */
export function chatCardNodes(c: ChatCards | null | undefined, keyPrefix: string, opts: ChatCardOpts = {}): Array<{ id: string; node: React.ReactNode }> {
  const out: Array<{ id: string; node: React.ReactNode }> = [];
  if (!c) return out;
  // THE EMAIL CARD — a matched item reads that item's own prepared reply; a standalone draft carries
  // its payload and sends through its own commit door. Neither an item nor a payload → nothing.
  (c.emailDrafts ?? []).filter((ed) => ed.itemId || ed.draft).forEach((ed, j) => out.push({
    id: `${keyPrefix}-mail-${j}`,
    node: ed.itemId
      ? <EmailCard item={{ id: ed.itemId }} />
      : <EmailCard standalone={{ emailId: ed.emailId, draft: ed.draft! }} />,
  }));
  // THE INVITE CARD — its Send goes through the chat lane's commit door; nothing is sent until then.
  (c.invites ?? []).forEach((iv, j) => out.push({
    id: `${keyPrefix}-invite-${j}`,
    node: <InviteCard chat={iv} onSuggestAnother={opts.onSuggestAnother} />,
  }));
  // THE BULK DEED — its one button is the one commit door.
  (c.bulkDeeds ?? []).forEach((bd, j) => out.push({
    id: `${keyPrefix}-bulk-${j}`,
    node: <BulkDeedCard deedId={bd.deedId} deed={bd.deed} />,
  }));
  // THE COLLECTION — a live turn hands over the served spec; a rehydrated one the pointer.
  (c.collections ?? []).forEach((col, j) => out.push({
    id: `${keyPrefix}-coll-${j}`,
    node: (
      <CollectionCard
        {...(col.spec ? { spec: col.spec } : {})}
        {...(col.pointer ? { pointer: col.pointer } : {})}
        {...(opts.onAsk ? { onAsk: opts.onAsk } : {})}
      />
    ),
  }));
  // THE EVENT — exactly the verbs its own state permits; every confirm goes through the deeds door.
  (c.events ?? []).forEach((ev, j) => out.push({
    id: `${keyPrefix}-event-${j}`,
    node: (
      <EventCard
        {...(ev.spec
          ? { spec: ev.spec, ...(ev.pointer ? { pointer: ev.pointer } : {}) }
          : { pointer: ev.pointer ?? { eventId: ev.eventId } })}
      />
    ),
  }));
  // THE CONFIRM CARD — Apply and Dismiss go through the change's own doors; nothing has applied.
  (c.changes ?? []).forEach((ch, j) => out.push({
    id: `${keyPrefix}-change-${j}`,
    node: (
      <ChangeCard
        {...(ch.spec
          ? { spec: ch.spec, ...(ch.pointer ? { pointer: ch.pointer } : {}) }
          : { pointer: ch.pointer ?? { changeId: ch.changeId } })}
      />
    ),
  }));
  return out;
}
