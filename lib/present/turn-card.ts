// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CARD IS A TURN — IN EVERY CHAT (stabilization W20.B · invariant 8 A CLAIM RENDERS).
//
// THE INCIDENT (owner walk, Sep 28): on an item page the reader typed "can you send an invite for
// it?"; the one conversation core PREPARED the invite (its row exists) and said "Here's the invite.
// Review it and send when it looks right." — and no card rendered. The item door
// (app/api/items/steer) was a second, thinner copy of the Home door's "a card is a turn" switch: it
// wrote card turns for three kinds and dropped invite / email draft / bulk deed on the floor, never
// forwarded them in its JSON, and the room's rail neither painted nor re-hydrated them.
//
// THE LAW, as one module both doors and both chat surfaces read:
//   · ONE TABLE of the card-bearing fields the core returns (`CARD_TURN_FIELDS`) → the durable
//     component key each is stored under (`CARD_COMPONENT_KEY`). The SERVER half (`cardTurnOf`,
//     `cardPayloadOf`) writes and forwards exactly these; the CLIENT half (`chatCardsOfComponent`,
//     `chatCardsOfPayload`) reads exactly these back. A new card kind is a row here, or a build
//     error — never a door that silently drops it (the inverse gate: scripts/smoke-chat-cards.ts).
//   · A CLAIM WITHOUT A CARD DOES NOT SERVE (`claimFloorSay`): an answer that says it produced an
//     artifact ("Here's the invite…", "I've drafted the reply…") while the turn carries no card and
//     no inline body is re-worded to the honest line — the one answer door applies it to every chat.
//   · THE WORK SHOWS (`CARD_PROGRESS`): the per-tool live labels for the card-producing tools and
//     the kit widget each one is making, so a room's in-flight line says what is being made and
//     reserves the card's own shape (components/thread/preparing-slot.tsx).
//
// PURE and client-safe: type-only imports from the core; the pointer helpers are leaf modules.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { ConverseTurn } from '@/lib/converse';
import type { ItemActionWidget } from '@/components/thread/item-page';
import type { PreparedInviteLike } from '@/lib/prepare/invite-card';
import type { StandaloneEmailDraft } from '@/lib/prepare/email-card';
import type { BulkDeed } from '@/lib/deeds/words';
import { collectionHasRows, isCollectionKind, isCollectionSpec, type CollectionSpec } from '@/lib/present/collection';
import { isEventSpec, type EventProposal, type EventSpec } from '@/lib/present/event';
import { changeTurnComponent, isChangeSpec, type ChangeSpec } from '@/lib/present/change';
import { collectionTurnComponent, eventTurnComponent } from '@/lib/present/pointer';

// ── THE ONE TABLE ─────────────────────────────────────────────────────────────────────────────

/** Every card-bearing field of a ConverseTurn, in PRECEDENCE order (one card per turn). */
export const CARD_TURN_FIELDS = ['invite', 'bulkDeed', 'collection', 'event', 'change', 'emailDraft'] as const;
export type CardTurnField = typeof CARD_TURN_FIELDS[number];

/** The durable component key each field is stored under in `room_turns.component`. */
export const CARD_COMPONENT_KEY: Record<CardTurnField, string> = {
  invite: 'invite_card',
  bulkDeed: 'bulk_deed_card',
  collection: 'collection_card',
  event: 'event_card',
  change: 'change_card',
  emailDraft: 'email_draft_card',
};

type CardFields = Partial<Pick<ConverseTurn, CardTurnField>>;
export type TurnComponent = { key: string; refId: string; state?: Record<string, unknown> };
export type CardTurn = { field: CardTurnField; component: TurnComponent; dedupeKey: string };

/** THE FLOORS every door applies before it writes or forwards (mutates, returns the turn):
 *  AN EMPTY SET IS NOT A CARD (W19.2a) — a zero-row collection is dropped. */
export function normalizeTurnCards<T extends CardFields>(turn: T): T {
  if (turn.collection && !collectionHasRows(turn.collection.spec)) turn.collection = null;
  return turn;
}

/** SERVER · the ONE durable card of a turn (precedence = table order), or null. */
export function cardTurnOf(turn: CardFields): CardTurn | null {
  for (const field of CARD_TURN_FIELDS) {
    const v = turn[field];
    if (!v) continue;
    switch (field) {
      case 'invite': {
        const iv = v as NonNullable<ConverseTurn['invite']>;
        return { field, dedupeKey: `invite:${iv.id}`, component: { key: CARD_COMPONENT_KEY.invite, refId: iv.id, state: { invite: iv.invite } } };
      }
      case 'bulkDeed': {
        // A POINTER only: the deed row carries its own committed state.
        const bd = v as NonNullable<ConverseTurn['bulkDeed']>;
        return { field, dedupeKey: `bulk:${bd.id}`, component: { key: CARD_COMPONENT_KEY.bulkDeed, refId: bd.id } };
      }
      case 'collection': {
        const c = v as NonNullable<ConverseTurn['collection']>;
        if (!collectionHasRows(c.spec)) continue;
        return { field, dedupeKey: `collection:${c.id}`, component: collectionTurnComponent(c.id, c.spec) as TurnComponent };
      }
      case 'event': {
        const e = v as NonNullable<ConverseTurn['event']>;
        return { field, dedupeKey: `event:${e.spec.id}`, component: eventTurnComponent(e.spec) as TurnComponent };
      }
      case 'change': {
        const ch = v as NonNullable<ConverseTurn['change']>;
        return { field, dedupeKey: `change:${ch.spec.id}`, component: changeTurnComponent(ch.spec) as TurnComponent };
      }
      case 'emailDraft': {
        // A matched item rides as a POINTER; a standalone draft carries its first-paint payload.
        const ed = v as NonNullable<ConverseTurn['emailDraft']>;
        return {
          field, dedupeKey: `email:${ed.id}`,
          component: { key: CARD_COMPONENT_KEY.emailDraft, refId: ed.id,
            state: { ...(ed.itemId ? { itemId: ed.itemId } : {}), ...(ed.draft ? { draft: ed.draft } : {}) } },
        };
      }
    }
  }
  return null;
}

/** SERVER · the card fields a door forwards in its response (live paint) — every one it holds. */
export function cardPayloadOf(turn: CardFields): CardFields {
  const out: CardFields = {};
  for (const field of CARD_TURN_FIELDS) {
    const v = turn[field];
    if (v) (out as Record<string, unknown>)[field] = v;
  }
  return out;
}

// ── THE CLIENT HALF: one shape both chat surfaces render ─────────────────────────────────────

/** The cards a chat turn carries — the SAME shape in the Home chat and the item rooms. A LIVE turn
 *  carries the served spec/payload (paints at once); a REHYDRATED one carries the POINTER and the
 *  card's own host re-reads its truth. */
export type ChatCards = {
  invites?: Array<{ inviteId: string; invite: PreparedInviteLike }>;
  bulkDeeds?: Array<{ deedId: string; deed?: BulkDeed }>;
  emailDrafts?: Array<{ emailId: string; itemId?: string; draft?: StandaloneEmailDraft }>;
  collections?: Array<{ collectionId: string; spec?: CollectionSpec; pointer?: { kind: CollectionSpec['kind']; params?: Record<string, string | number | boolean> } }>;
  events?: Array<{ eventId: string; spec?: EventSpec; pointer?: { eventId: string; proposal?: EventProposal | null } }>;
  changes?: Array<{ changeId: string; spec?: ChangeSpec; pointer?: { changeId: string } }>;
};

export const hasChatCards = (c: ChatCards | null | undefined): boolean =>
  !!c && Object.values(c).some((v) => Array.isArray(v) && v.length > 0);

type StoredComponent = { key?: string; refId?: string; state?: Record<string, unknown> | null } | null | undefined;

/** CLIENT · a stored turn's component → its cards (the ONE hydrator). Unknown keys → {}. */
export function chatCardsOfComponent(c: StoredComponent): ChatCards {
  if (!c?.key) return {};
  const st = (c.state ?? {}) as Record<string, unknown>;
  const ref = typeof c.refId === 'string' ? c.refId : null;
  switch (c.key) {
    case CARD_COMPONENT_KEY.invite:
      return ref ? { invites: [{ inviteId: ref, invite: (st.invite ?? {}) as PreparedInviteLike }] } : {};
    case CARD_COMPONENT_KEY.bulkDeed:
      return ref ? { bulkDeeds: [{ deedId: ref }] } : {};
    case CARD_COMPONENT_KEY.collection:
      return ref && isCollectionKind(st.kind)
        ? { collections: [{ collectionId: ref, pointer: {
            kind: st.kind as CollectionSpec['kind'],
            ...(st.params && typeof st.params === 'object' ? { params: st.params as Record<string, string | number | boolean> } : {}),
          } }] }
        : {};
    case CARD_COMPONENT_KEY.event: {
      const evId = ref ?? (typeof st.eventId === 'string' ? st.eventId : null);
      return evId
        ? { events: [{ eventId: evId, pointer: { eventId: evId,
            ...(st.proposal && typeof st.proposal === 'object' ? { proposal: st.proposal as EventProposal } : {}) } }] }
        : {};
    }
    case CARD_COMPONENT_KEY.change:
      return ref ? { changes: [{ changeId: ref, pointer: { changeId: ref } }] } : {};
    case CARD_COMPONENT_KEY.emailDraft:
      return ref ? { emailDrafts: [{ emailId: ref,
        ...(typeof st.itemId === 'string' ? { itemId: st.itemId } : {}),
        ...(st.draft && typeof st.draft === 'object' ? { draft: st.draft as StandaloneEmailDraft } : {}) }] } : {};
    default:
      return {};
  }
}

/** CLIENT · a door's served payload → its cards (the live paint). */
export function chatCardsOfPayload(d: Record<string, unknown> | null | undefined): ChatCards {
  if (!d) return {};
  const out: ChatCards = {};
  const iv = d.invite as { id?: string; invite?: PreparedInviteLike } | undefined;
  if (iv?.id) out.invites = [{ inviteId: String(iv.id), invite: (iv.invite ?? {}) as PreparedInviteLike }];
  const bd = d.bulkDeed as { id?: string; deed?: BulkDeed } | undefined;
  if (bd?.id) out.bulkDeeds = [{ deedId: String(bd.id), ...(bd.deed ? { deed: bd.deed } : {}) }];
  const ed = d.emailDraft as { id?: string; itemId?: string; draft?: StandaloneEmailDraft } | undefined;
  if (ed?.id && (ed.itemId || ed.draft)) {
    out.emailDrafts = [{ emailId: String(ed.id), ...(ed.itemId ? { itemId: String(ed.itemId) } : {}), ...(ed.draft ? { draft: ed.draft } : {}) }];
  }
  const col = d.collection as { id?: string; spec?: unknown } | undefined;
  if (col?.id && isCollectionSpec(col.spec)) out.collections = [{ collectionId: String(col.id), spec: col.spec }];
  const ev = d.event as { id?: string; spec?: unknown } | undefined;
  if (ev && isEventSpec(ev.spec)) out.events = [{ eventId: String(ev.id ?? ev.spec.id), spec: ev.spec }];
  const ch = d.change as { id?: string; spec?: unknown } | undefined;
  if (ch && isChangeSpec(ch.spec)) out.changes = [{ changeId: String(ch.spec.id), spec: ch.spec }];
  return out;
}

// ── THE WORK SHOWS: the card-producing tools' live labels + the widget each is making ──────────

/** The ONE table of the card-producing tools' progress words (lib/converse's TOOL_PROGRESS spreads
 *  it) and the kit widget whose shape the in-flight slot wears. */
export const CARD_PROGRESS: Record<string, { label: string; widget: ItemActionWidget }> = {
  prepare_calendar_invite: { label: 'Putting the invite together…', widget: 'invite' },
  draft_reply: { label: 'Writing the reply…', widget: 'email' },
  prepare_event_action: { label: 'Pulling up that meeting…', widget: 'event' },
  prepare_bulk_deed: { label: 'Working out exactly what that would do…', widget: 'confirm' },
};

/** The widget a live progress label is making, or null (a read, a search — no card promised). */
export function widgetOfProgress(label: string | null | undefined): ItemActionWidget | null {
  if (!label) return null;
  for (const v of Object.values(CARD_PROGRESS)) if (v.label === label) return v.widget;
  return null;
}

// ── A CLAIM WITHOUT A CARD DOES NOT SERVE ─────────────────────────────────────────────────────

const ART = '(?:calendar |meeting |updated |revised |new |draft(?:ed)? |follow-up )?(?:invite|invitation|draft|reply|e-?mail|message|nudge|forward|document|deck|report)';
/** Narrow by design (the floor doctrine): presentational "here's the X" and first-person "I've
 *  drafted/prepared the X" shapes, and "the X is ready/below". Negations never match. */
export const ARTIFACT_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  new RegExp(`\\bhere(?:['’]s| is)\\s+(?:the|an?|your|my)\\s+${ART}\\b`, 'i'),
  new RegExp(`\\bI(?:['’]ve| have)\\s+(?:just\\s+)?(?:prepared|drafted|written|set up|put together|created|lined up)\\s+(?:the|an?|your)\\s+${ART}\\b`, 'i'),
  new RegExp(`\\b(?:the|your)\\s+${ART}\\s+is\\s+(?:ready|below|prepared|set up)\\b`, 'i'),
];

/** The claim phrase, or null. */
export function artifactClaimIn(say: string | null | undefined): string | null {
  const s = String(say ?? '');
  for (const re of ARTIFACT_CLAIM_PATTERNS) { const m = re.exec(s); if (m) return m[0]; }
  return null;
}

/** Does the turn carry something a surface renders as the produced work (a card, a re-seeded draft,
 *  a deliverable, a commit the client fires, a stage it raises)? */
export function turnHasSurface(turn: Partial<ConverseTurn>): boolean {
  if (CARD_TURN_FIELDS.some((f) => !!turn[f])) return true;
  return !!(turn.workflowDraft || turn.artifact || turn.artifacts?.length || turn.draft || turn.commit || turn.openStage || turn.files?.length);
}

/** An answer that CARRIES its artifact inline (the body after the claim) renders it as text. */
function carriesBodyInline(say: string, claim: string): boolean {
  const at = say.indexOf(claim);
  const after = at >= 0 ? say.slice(at + claim.length) : '';
  return /\n\s*\n/.test(after) && after.replace(/\s+/g, ' ').trim().length >= 120;
}

/** The honest line a claim with nothing behind it becomes. */
export const CLAIM_WITHOUT_CARD_LINE = "I couldn't put that together just now, so there's nothing to review yet — ask me again and I'll prepare it.";

/** THE FLOOR at the one answer door: the say as served. A claim with no card, no surface and no
 *  inline body is replaced by the honest line; everything else passes untouched. Pure. */
export function claimFloorSay(turn: Partial<ConverseTurn> & { say: string }): string {
  const claim = artifactClaimIn(turn.say);
  if (!claim || turnHasSurface(turn) || carriesBodyInline(turn.say, claim)) return turn.say;
  return CLAIM_WITHOUT_CARD_LINE;
}
