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
import ForwardCard from '@/components/home/forward-card';
import { LinkedInPostCard } from '@/components/prepared/linkedin-post-card';
import type { ChatCards, DeedItemKind } from '@/lib/present/turn-card';
import { STAGE_VERB_BEHAVIOUR, type StageVerb, type CardDescriptor } from '@/lib/present/behaviour';

/**
 * THE DEED'S ONE INLINE CARD (law `one-component-one-behaviour`, lib/present/behaviour.ts): what a
 * stage verb — reply · forward · invite — mounts, on ANY surface, for ANY object kind. The item
 * room's header verbs, a conversation answer's `openStage`, the project room's prepared rows and the
 * rail's own fallback all call THIS — so a forward is the same card wherever it is asked for, and
 * none of them can raise a split pane or a composer overlay instead.
 */
export function deedCardFor(stage: StageVerb, itemKind: DeedItemKind, itemId: string, opts: { onSent?: () => void } = {}): React.ReactNode {
  if (stage === 'invite') {
    return <InviteCard kind={itemKind === 'commitment' ? 'commitment' : itemKind === 'meeting' ? 'meeting' : 'email'} entityId={itemId} verdictLevel {...(opts.onSent ? { onSent: opts.onSent } : {})} />;
  }
  if (stage === 'forward' && itemKind === 'email') {
    return <ForwardCard kind="email" entityId={itemId} itemLevel {...(opts.onSent ? { onSent: opts.onSent } : {})} />;
  }
  // reply (and a forward asked of an object with no thread — its message is the compose card)
  if (itemKind === 'email') return <EmailCard item={{ id: itemId }} {...(opts.onSent ? { onSent: opts.onSent } : {})} />;
  return <EmailCard compose={{ kind: itemKind, id: itemId }} {...(opts.onSent ? { onSent: opts.onSent } : {})} />;
}

export type ChatCardOpts = {
  /** "Ask about it" on a collection speaks through the surface's ONE composer (clicks are words). */
  onAsk?: (text: string) => void;
  /** The invite's "suggest another time" focuses the surface's composer. */
  onSuggestAnother?: () => void;
};

/** THE ONE RENDERER — every card a chat turn carries, as mountable nodes with stable ids. */
/** A field read off a served payload without trusting its shape (the descriptor is presentation only). */
const str = (o: unknown, k: string): string | null => {
  const v = o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : null;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const firstOf = (o: unknown, k: string): string | null => {
  const v = o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : null;
  return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
};

/** THE ONE RENDERER — every card a chat turn carries, as mountable nodes with stable ids, each with
 *  its DESCRIPTOR (lib/present/behaviour.ts CardDescriptor): what a stack folds to and what a reply
 *  targets. */
export function chatCardNodes(c: ChatCards | null | undefined, keyPrefix: string, opts: ChatCardOpts = {}): Array<{ id: string; node: React.ReactNode; d: CardDescriptor }> {
  const out: Array<{ id: string; node: React.ReactNode; d: CardDescriptor }> = [];
  if (!c) return out;
  // THE EMAIL CARD — a matched item reads that item's own prepared reply; a standalone draft carries
  // its payload and sends through its own commit door. Neither an item nor a payload → nothing.
  (c.emailDrafts ?? []).filter((ed) => ed.itemId || ed.draft || ed.compose).forEach((ed, j) => out.push({
    id: `${keyPrefix}-mail-${j}`,
    d: { id: `${keyPrefix}-mail-${j}`, kind: ed.itemId ? 'reply_draft' : ed.compose ? 'nudge_draft' : 'compose_email', title: str(ed.draft, 'subject'), recipient: firstOf(ed.draft, 'to'),
      ref: ed.itemId ? `inbox:${ed.itemId}` : ed.compose ? `commit:${ed.compose.id}` : ed.emailId },
    node: ed.itemId
      ? <EmailCard item={{ id: ed.itemId }} />
      : ed.compose
        ? <EmailCard compose={ed.compose} />
        : <EmailCard standalone={{ emailId: ed.emailId, draft: ed.draft! }} />,
  }));
  // THE INVITE CARD — its Send goes through the chat lane's commit door; nothing is sent until then.
  (c.invites ?? []).forEach((iv, j) => out.push({
    id: `${keyPrefix}-invite-${j}`,
    d: { id: `${keyPrefix}-invite-${j}`, kind: 'invite', title: str(iv.invite, 'title'), recipient: firstOf(iv.invite, 'attendees'), ref: iv.inviteId },
    node: <InviteCard chat={iv} onSuggestAnother={opts.onSuggestAnother} />,
  }));
  // THE BULK DEED — its one button is the one commit door.
  (c.bulkDeeds ?? []).forEach((bd, j) => out.push({
    id: `${keyPrefix}-bulk-${j}`,
    d: { id: `${keyPrefix}-bulk-${j}`, kind: 'bulk_deed', title: str(bd.deed, 'label') ?? str(bd.deed, 'title'), ref: bd.deedId },
    node: <BulkDeedCard deedId={bd.deedId} deed={bd.deed} />,
  }));
  // THE COLLECTION — a live turn hands over the served spec; a rehydrated one the pointer.
  (c.collections ?? []).forEach((col, j) => out.push({
    id: `${keyPrefix}-coll-${j}`,
    d: { id: `${keyPrefix}-coll-${j}`, kind: 'collection', title: str(col.spec, 'framing'), ref: col.collectionId },
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
    d: { id: `${keyPrefix}-event-${j}`, kind: 'event', title: str(ev.spec, 'title'), ref: ev.eventId },
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
    d: { id: `${keyPrefix}-change-${j}`, kind: 'change', title: str(ch.spec, 'summary') ?? str(ch.spec, 'title'), ref: ch.changeId },
    node: (
      <ChangeCard
        {...(ch.spec
          ? { spec: ch.spec, ...(ch.pointer ? { pointer: ch.pointer } : {}) }
          : { pointer: ch.pointer ?? { changeId: ch.changeId } })}
      />
    ),
  }));
  // A STAGE VERB'S DEED — the inline card itself (never a stage, never a page away).
  (c.stageDeeds ?? []).forEach((sd, j) => out.push({
    id: `${keyPrefix}-stage-${sd.stage}-${j}`,
    d: { id: `${keyPrefix}-stage-${sd.stage}-${j}`, kind: sd.stage === 'reply' ? (sd.itemKind === 'email' ? 'reply_draft' : 'compose_email') : STAGE_VERB_BEHAVIOUR[sd.stage], title: null, ref: sd.itemId },
    node: deedCardFor(sd.stage, sd.itemKind, sd.itemId),
  }));
  // THE LINKEDIN POST — the post as it reads on the feed; its one door is Copy.
  (c.posts ?? []).forEach((p, j) => out.push({
    id: `${keyPrefix}-post-${j}`,
    d: { id: `${keyPrefix}-post-${j}`, kind: 'linkedin_post', title: p.variants[0]?.text ? p.variants[0].text.slice(0, 60) : null, ref: `${keyPrefix}-post-${j}` },
    node: <LinkedInPostCard variants={p.variants} by={p.by ?? null} />,
  }));
  return out;
}
