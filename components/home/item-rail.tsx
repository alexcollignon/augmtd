'use client';

import Link from 'next/link';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONVERSATIONAL RAIL (just-works P1.5b) — the deep-dive's right column talks like a colleague,
// not a data card. The opening narration is the entity's OWN judged state (zero AI at render — the
// brain already authored it); every mention is a live CHIP (✉ thread, meeting, file, coworker avatar
// with one-tap hand-off). One composer at the bottom is the whole channel: a correction reworks the
// draft + writes entity memory, a question gets a grounded answer, and "have <coworker> do X" routes
// a real delegation — all via /api/items/steer.
//
// VISUAL LANGUAGE (Phase 2d — docs/threads-plan.md): the rendering runs through THE ONE THREAD
// COMPONENT (components/thread/). The room's composed brief is THE PINNED MESSAGE wearing the CoS
// seat's face; the offers are composer chips; turns derive into the three grammars; every rich
// component the rail already had is MOUNTED WHOLE through the kit's card slot. A thread kind is
// configuration, never a fork — the project room and the loose deep-dive are the same component
// with different data. The engine seams below (persistence · hydrate · steer · fold rules) are
// untouched by the port.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentIcon } from '@heroicons/react/24/outline';
import { WorkerMentionInput } from '@/components/workers/worker-mention-input';
import { ThreadShell, ThreadCardView } from '@/components/thread';
import type { ThreadCard, ThreadItem } from '@/components/thread';
// W16 · THE ITEM PAGE IS A FEW KIT WIDGETS — the ONE composition every item door renders through.
import { composeItemPage, itemPageItems, type ItemArtifactKind, type ItemArtifactsMounted } from '@/components/thread/item-page';
import { useCosSeat } from '@/hooks/use-cos-seat';
import { moveTargetId, mergedArtifactKey, stageOfArtifactKey } from '@/lib/room/presentation';
// THE DECISION'S ONE HOST (W3-C, Sep 22) — the kit's `decision` card with the steer door behind
// it. `components/work/decision-card.tsx` (the hand-drawn one) is gone.
import DecisionCard, { type DecisionSpec, type DecisionOutcome } from '@/components/home/decision-card';
// THE ONE OBJECT CARD's host mount — the room shows WHAT IT IS TALKING ABOUT (THE OPENING
// CONTRACT, clause 1): one read of the thread door, one kit card, one viewer, every seat.
import { SourceObjectMount, MeetingSourceMount, EmailSourceMount, type MeetingSourceFacts, type EmailSourceFacts } from '@/components/room/source-object';
import { panelPlan } from '@/lib/room/render-plan';
import { offerLineFor } from '@/lib/room/cta-law';
import { roomKeyForDoor, targetOwnedByDoor, cardMayBindTarget, objectIdForDoor, idsNamedByCard, type Door } from '@/lib/room/door';
// THE OPENING'S SPEECH LAWS, imported — the pre-compose stitch obeys exactly what the composed
// brief obeys (ONE copy of each law; a hand-written second version is how the excerpt law rotted).
import { collapseSelfVoice } from '@/lib/room/self-voice';
import { askBaseOf } from '@/lib/room/ask-base';
import { nameOncePerSentence } from '@/lib/room/opening-discipline';
import { fallbackOpeningLine, prepareNoneLine } from '@/lib/room/opening-fallback';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
// W8.4 · NO RAW ISO ON SCREEN — the ONE short-date grammar.
import { fmtMonthDay } from '@/lib/utils/format-date';
// THE FRESHNESS FLOOR IS ONE NUMBER, IMPORTED — never restated at a second site.
import { ROOM_CACHE_MAX_AGE_MS } from '@/lib/room/no-mutation';
// ONE KEY PRODUCER, shared with the warm that fills the envelope this mount reads.
import { roomTurnsKey } from '@/lib/room/warm-room';
import { WorkflowDraftCard, type WorkflowDraft } from '@/components/workflows/workflow-draft-card';
// THE ASK AND THE GATE ARE HOSTED, NEVER DRAWN (W3-A, Sep 22 — docs/component-map.md §2a): this
// room mounts the two hosts, which mount the kit's `input` / `approval` cards. The go-ahead law
// (lib/room/go-ahead.ts) and the resume/proceed doors (lib/deeds/gate-doors.ts) live inside them.
import InputCard from '@/components/home/input-card';
import ApprovalCard from '@/components/home/approval-card';
// THE PRESENTED OBJECT IS THE SAME CARD EVERYWHERE (W4-C, Sep 22 — docs/component-map.md §6): the
// room mounts the SAME two hosts the Home chat and the coworker DM mount. A room that reads the
// user's own objects shows them; it does not describe them in prose a second time.
import CollectionCard, { type CollectionPointer } from '@/components/home/collection-card';
import EventCard, { type EventPointer } from '@/components/home/event-card';
import { isCollectionKind, isCollectionSpec, type CollectionSpec } from '@/lib/present/collection';
import { isEventSpec, type EventProposal, type EventSpec } from '@/lib/present/event';
// THE CONFIRM CARD (stabilization W0.3b): the same ONE host the Home chat mounts.
import ChangeCard, { type ChangePointer } from '@/components/home/change-card';
import { isChangeSpec, type ChangeSpec } from '@/lib/present/change';
import { useLiveRefresh } from '@/components/workflows/use-live-refresh';
import { announceDeed, DEED_EVENT } from '@/lib/room/deed-echo';
// HISTORY LEAVES THE STREAM — the record's seat is the ONE drawer, at every door.
import type { RoomHistoryLine } from '@/components/room/filed-drawer';

// 'entity' = the PROJECT DOOR (P7c-c2): the same rail inside the project room — id is the entity
// id, steer/ingest run in entity scope, the Overview chip hides (you're already there).
type RailKind = 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness' | 'entity';

export type RailView = {
  // The open item — what the rail's opening message narrates FIRST (P5b: item-anchored, never generic).
  anchor?: { who: string | null; ask: string | null; prepared: string | null } | null;
  /** THE ONE RESPONDER for a LOOSE room (no entity) — composed server-side; the anchor stitch
   *  is only the fallback until the first compose lands. Linked rooms carry it on entity.*. */
  brief?: string | null;
  /** Q6 · `offer` marks a move whose object is NOT staged: the room speaks it as the CoS's offer
   *  (`offerText`), never as a primary action button (lib/room/cta-law). */
  move?: { label: string; ref: string | null; offer?: boolean; offerText?: string } | null;
  offers?: Array<{ label: string; say: string }>;
  /** THE GROUND LAW — "narration expires with the brief": the loose brief's composition time.
   *  Engine narration older than it folds under "earlier (N)" (the brief IS its digest). */
  briefAt?: string | null;
  /** W3.5 (a) — THE BRIEF BEFORE THE PAINT: the server's compose outran its budget; the loader
   *  re-checks once and the arrival lands as `lateBrief`, rendered as an APPENDED message beneath
   *  the opening (never a swap of what the reader opened on). */
  briefPending?: boolean;
  briefStaleVersion?: boolean;
  lateBrief?: { text: string; at: string | null } | null;
  /** W3.5 (d) — THE MOOT ASK BY CODE: dedupe keys of asks the machine read as moot; the room hides
   *  the same turns the header ignored (one claim). */
  mootAskKeys?: string[];
  gap: string | null;
  /** THE MACHINE's single state for an ITEM door (served by GET /api/items/view) — the item page's
   *  one action widget is chosen from it (W16). Absent on the project door. */
  machineState?: { state: string; word?: string | null; line?: string | null; eventId?: string | null } | null;
  entity: {
    id: string; name: string;
    tracked?: boolean; // T4 — accepted (project) vs merely recognized (quiet context)
    summary: string | null; momentum: string | null; nextMove: string | null; nextMoveHref?: string | null;
    whoOwesYou: string[]; whoOwesThem: string[];
    suggestedWorker?: { id: string; name: string; role: string } | null;
    /** THE ONE RESPONDER — the room's whole opening from one reasoned pass over the one grounding
     *  (served last-good; null until first compose → the stitched fields fall back). */
    brief?: string | null;
    move?: { label: string; ref: string | null; offer?: boolean; offerText?: string } | null;
    offers?: Array<{ label: string; say: string }>;
    /** THE GROUND LAW — the entity brief's composition time (see RailView.briefAt). */
    briefAt?: string | null;
  } | null;
  siblings: {
    threads: Array<{ id: string; subject: string; who: string | null; at: string | null; current: boolean }>;
    meetings: Array<{ id: string; title: string; at: string | null }>;
    commitments: Array<{ id: string; description: string; who: string | null }>;
    files: Array<{ id: string; filename: string }>;
  };
};

/** A tappable offer inside a narration turn (W3) — the word is the deed:
 *  'prepare' fires THE ONE preparation engine for the item; 'say' posts the text through the
 *  one conversation core (hand-offs ride the existing steer path). */
export type TurnAction = { label: string } & (
  | { act: 'prepare'; itemKind: 'inbox' | 'commitment'; itemId: string }
  | { act: 'say'; text: string }
  | { act: 'adopt'; targetId: string; sourceId: string }
  /** THE EXCHANGE (Aug 4): a direction pick — lands as the USER'S turn, redrafts through the one
   *  steer path with its own item scope (works from the project room's rail too). */
  );

type Turn =
  | { role: 'user'; text: string }
  | { role: 'system'; text: string; key?: string; actions?: TurnAction[]; refs?: Array<{ label: string; href: string | null }>; files?: Array<{ id: string; filename: string; source: string }>; author?: { name: string; role?: string | null };
      /** FIX 3 — a coworker's ASK renders as an inline checklist (input_checklist component): the
       *  concrete things they need from the principal. Rows wire to the 📎 ingest funnel. */
      checklist?: string[];
      /** W13.6 · THE BASE IS OFFERED — the current version the missing new work goes into (the ask
       *  turn's `component.state.base`); the ask card prints it as its meta line. */
      base?: string[];
      /** W3 — the durable turn's id (the ask-lifecycle actions key on it) + the proceeded stamp
       *  (the user already said "go ahead" — the button hides, the checklist stays as record). */
      turnId?: string; proceeded?: boolean;
      /** UX arc — the turn's dedupe key: the structural handle folding rules key on (a `prep:*`
       *  narration collapses into the artifact card it narrates; never content-matching). */
      dkey?: string;
      /** THE GROUND LAW — when the durable turn was written (server ISO). The narration-expiry
       *  fold compares it to the brief's composition time; absent (this session's own writes) =
       *  newer than any brief, so it never folds. */
      at?: string;
      /** THE SPEC CARD (Arc 2): a proposed standing task awaiting the user's explicit confirm —
       *  the card IS the commit surface (saying prepared it; confirming creates it). */
      standingSpec?: { name: string; deliverable: string; cadenceLabel: string; ownerName: string; firstRun?: string | null; status: string; workflowId?: string | null };
      /** THE ONE CREATION CARD (Aug 10): a drafted workflow (any trigger type incl. reactions)
       *  reviewing inline — Confirm fires the one create door. */
      workflowDraft?: WorkflowDraft;
      /** THE APPROVAL ASK (production arc step 2): a run parked at its approval step — Approve
       *  resumes it (the guarded send fires through the normal path), Hold back ends it. */
      approval?: { runId: string; name: string; instruction?: string; preview?: string; decided?: 'approved' | 'rejected' };
      /** THE COLLECTION CARD IN A ROOM (W4-C, Sep 22): a set of the user's own objects the room's
       *  converse door just read. A LIVE turn carries the served `spec`; a REHYDRATED one carries
       *  the POINTER only and the host re-reads through `GET /api/collections` — the rows are
       *  exactly what a frozen copy would lie about. */
      collection?: { collectionId: string; spec?: CollectionSpec; pointer?: CollectionPointer };
      /** THE EVENT CARD IN A ROOM (W4-C): one meeting with the verbs ITS state permits. Same two
       *  shapes, and the same reason, sharper: a stored verb ladder goes stale the moment the
       *  organizer moves the meeting. */
      event?: { eventId: string; spec?: EventSpec; pointer?: EventPointer };
      /** THE CONFIRM CARD IN A ROOM (stabilization W0.3b): a prepared state change awaiting the
       *  click. A LIVE turn carries the served `spec`; a REHYDRATED one the POINTER, re-read
       *  through `GET /api/changes/[id]` — a change applied elsewhere never re-offers Apply. */
      change?: { changeId: string; spec?: ChangeSpec; pointer?: ChangePointer } };

// THE ROOM (P7c-c1 → one-room R1): the conversation is PER-DEAL, not per-item — navigating between
// a deal's artifacts keeps the chat. The module store is now only the LIVE RENDER CACHE; the durable
// record is `room_turns` (every write POSTs, mounts hydrate from GET — a reload keeps the story).
const _dealTurns = new Map<string, Turn[]>();

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE RESET GENERATION (owner walk, Sep 15: "clicking new chat isn't doing what I thought it would,
// resetting the conversation. and although it resets…").
//
// It DID reset — and then un-reset itself. The dev log had the whole story in two lines: a 5.5s
// `POST /api/items/steer` landing AROUND the `DELETE /api/room/turns?scope=chat`. The reset cleared
// the module store, the stamped envelope and re-read the room; then the answer to a question asked
// BEFORE the reset arrived and appended itself into the emptied store, its user turn having already
// persisted server-side. The conversation the reader had just cleared spoke again.
//
// A cancelled request is not a request that can be recalled — the fix is that its RESULT must not
// be believed. Every room carries a generation number; a reset bumps it BEFORE it archives
// anything; every turn-producing async op captures the generation it started in and, on arrival,
// DROPS everything it was going to render or persist if the room has moved on since. This is the
// stageNonce idiom, applied to the conversation itself.
//
// The second half is server-side: a durable write that the op fired before it was dropped (the
// user turn's fire-and-forget POST) can outlive the archive query by milliseconds and come back
// live on the next read. So a dropped op SWEEPS — one more archive of the chat lane, fired only on
// an actual race, through the same door the reset used. Never a second mechanism.
// ══════════════════════════════════════════════════════════════════════════════════════════════
const _resetGen = new Map<string, number>();
const genOf = (roomKey: string): number => _resetGen.get(roomKey) ?? 0;
const bumpGen = (roomKey: string): void => { _resetGen.set(roomKey, genOf(roomKey) + 1); };

// THE STANDING PROPOSAL'S SPEECH WINDOW (Sep 7) — how long a bring-in proposal may STAND in the
// timeline before membership review belongs to the drawer alone. A proposal is speech; an
// unanswered one is inventory.
const PROPOSAL_STANDS_MS = 48 * 60 * 60 * 1000;

// R1 — fire-and-forget persistence to the ONE turns table (non-fatal; the in-memory store still
// renders this session if the write fails or the migration isn't applied yet).
function persistTurn(roomKey: string, t: Turn): void {
  try {
    fetch('/api/room/turns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomKey, role: t.role, text: t.text,
        refs: t.role === 'system' ? t.refs : undefined,
        dedupeKey: t.role === 'system' ? t.key : undefined,
      }),
    }).catch(() => {});
  } catch { /* SSR-safe */ }
}

/** Push a narration turn into a deal's conversation from OUTSIDE the rail (5A.5 — the room's
 *  CTA-focus continuation). Writes the module store + the DURABLE room_turns row + notifies any
 *  mounted rail via a window event (the rail re-reads its roomKey store on it). Deterministic — no AI.
 *  W3: an opts.key DEDUPES — any prior turn with the same key is dropped before appending, so a
 *  re-clicked CTA re-surfaces its one line instead of stuttering duplicates. opts.actions render
 *  as tappable offers ("Draft it now" / "Hand to …"). */
export function pushDealTurn(entityId: string, text: string, opts?: { key?: string; actions?: TurnAction[]; role?: 'user' | 'system';
  /** THE EXCHANGE (Aug 4): interaction scaffolding (an offer awaiting a pick, a "drafting…" ack)
   *  renders live but never persists — the durable story is the PICK and the RESULT, not the
   *  furniture around them (a reloaded offer with dead buttons is noise, not history). */
  ephemeral?: boolean }): void {
  const turns = _dealTurns.get(entityId) ?? [];
  const kept = opts?.key ? turns.filter((t) => t.role !== 'system' || t.key !== opts.key) : turns;
  const turn: Turn = opts?.role === 'user'
    ? { role: 'user', text }
    : { role: 'system', text, key: opts?.key, actions: opts?.actions };
  _dealTurns.set(entityId, [...kept, turn]);
  if (!opts?.ephemeral) persistTurn(entityId, turn);
  try { window.dispatchEvent(new CustomEvent('aug:deal-turn', { detail: { entityId } })); } catch { /* SSR-safe */ }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ONE READING OF A SERVED TURN (Sep 8). The server row → `Turn` mapping used to live inline in the
// fetch's `.then`, which was fine while the fetch was the only way turns arrived. The conversation
// now ALSO hydrates from a cached envelope (the warm fills it on hover), and a second reading of the
// same payload is how two surfaces start disagreeing about the same row — so the mapping is lifted
// here and BOTH doors enter through it. The envelope stores RAW ROWS for exactly this reason.
// ══════════════════════════════════════════════════════════════════════════════════════════════
type ServerTurnRow = {
  id?: string; key?: string; role: 'user' | 'system'; text: string; createdAt?: string;
  refs?: Array<{ label: string; href: string | null }>;
  author?: { name: string; role?: string | null } | null;
  component?: { key?: string; refId?: string; state?: { targetId?: string; options?: Array<{ label: string; sourceId: string }>; items?: string[]; proceeded?: boolean;
    /** THE PRESENTED POINTER (W4-C) — `lib/present/pointer.ts` writes both of these shapes. */
    kind?: string; params?: Record<string, string | number | boolean>; eventId?: string; proposal?: EventProposal } } | null;
};

function mapServerTurns(rows: ServerTurnRow[]): Turn[] {
  return rows.map((t) => {
    const turn: Turn = { role: t.role, text: t.text, refs: t.refs ?? undefined, author: t.author ?? undefined } as Turn;
    if (turn.role === 'system' && t.key) turn.dkey = t.key;
    // THE GROUND LAW: the durable write time — the narration-expiry fold's only input.
    if (turn.role === 'system' && t.createdAt) turn.at = String(t.createdAt);
    // THE STANDING PROPOSAL AGES INTO THE DRAWER (owner walk, Sep 7 — ONE AGENDA PER ROOM): a
    // bring-in proposal is SPEECH, so it speaks once and stays live for a couple of days; an
    // unanswered one is INVENTORY, and membership review already has exactly one home — the
    // drawer's Tasks tab, beside the list it changes. Past the window the options stop rendering
    // here (the turn folds into "earlier" with every other piece of history) and the drawer serves
    // them from the SAME durable turn.
    if (turn.role === 'system' && t.component?.key === 'founding_proposal' && t.component.state?.targetId) {
      const tid = t.component.state.targetId;
      const bornAt = t.createdAt ? Date.parse(String(t.createdAt)) : NaN;
      const stillSpeech = !Number.isFinite(bornAt) || Date.now() - bornAt < PROPOSAL_STANDS_MS;
      if (stillSpeech) {
        turn.actions = (t.component.state.options ?? []).map((o) => ({ label: o.label, act: 'adopt' as const, targetId: tid, sourceId: o.sourceId }));
      }
      turn.key = 'founding-proposal';
    }
    // FIX 3 — a coworker's ASK: the input checklist re-renders on every load until an ingest
    // clears it (the ingest route strips the component; the text stays as history).
    if (turn.role === 'system' && t.component?.key === 'input_checklist' && Array.isArray(t.component.state?.items)) {
      turn.checklist = t.component.state.items.map((m) => String(m)).filter(Boolean);
      { const b = askBaseOf(t.component.state); if (b.length) turn.base = b; }
      turn.turnId = t.id;
      turn.proceeded = !!t.component.state?.proceeded;
    }
    // THE SPEC CARD (Arc 2): the durable proposal re-renders until confirmed (the confirm route
    // flips the stored component in place; the card then reads as the record).
    if (turn.role === 'system' && t.component?.key === 'approval' && (t.component.state as { runId?: string } | undefined)?.runId) {
      const st = t.component.state as unknown as { runId: string; name?: string; instruction?: string; preview?: string };
      turn.approval = { runId: String(st.runId), name: String(st.name ?? 'this run'), instruction: st.instruction || undefined, preview: st.preview || undefined };
      turn.turnId = t.id;
    }
    // THE COLLECTION CARD comes back as a POINTER and nothing else (W4-C): the stored component
    // carries `{kind, params}` and the host re-derives the rows through the ONE re-read door. A
    // set of live objects is exactly the thing a frozen copy would lie about.
    if (turn.role === 'system' && t.component?.key === 'collection_card' && t.component.refId
      && isCollectionKind(t.component.state?.kind)) {
      turn.collection = {
        collectionId: String(t.component.refId),
        pointer: {
          kind: t.component.state.kind as CollectionSpec['kind'],
          ...(t.component.state.params && typeof t.component.state.params === 'object'
            ? { params: t.component.state.params } : {}),
        },
      };
    }
    // …and THE EVENT CARD, for the sharper version of the same reason: the verbs a reloaded card
    // offers are the ones the event permits NOW, never the ones it permitted when it was spoken.
    if (turn.role === 'system' && t.component?.key === 'event_card'
      && (typeof t.component.refId === 'string' || typeof t.component.state?.eventId === 'string')) {
      const evId = String(t.component.refId ?? t.component.state?.eventId);
      turn.event = {
        eventId: evId,
        pointer: {
          eventId: evId,
          ...(t.component.state?.proposal && typeof t.component.state.proposal === 'object'
            ? { proposal: t.component.state.proposal } : {}),
        },
      };
    }
    // …and THE CONFIRM CARD, as a POINTER and nothing else: the change's id, re-read through its
    // own door on every open, so a settled change never comes back offering Apply.
    if (turn.role === 'system' && t.component?.key === 'change_card' && typeof t.component.refId === 'string') {
      turn.change = { changeId: t.component.refId, pointer: { changeId: t.component.refId } };
    }
    if (turn.role === 'system' && t.component?.key === 'standing_spec' && t.component.state) {
      const st = t.component.state as unknown as { name?: string; deliverable?: string; cadenceLabel?: string; ownerName?: string; firstRun?: string | null; status?: string; workflowId?: string | null };
      if (st.name) {
        turn.standingSpec = { name: String(st.name), deliverable: String(st.deliverable ?? ''), cadenceLabel: String(st.cadenceLabel ?? ''), ownerName: String(st.ownerName ?? 'a coworker'), firstRun: st.firstRun ?? null, status: String(st.status ?? 'pending'), workflowId: st.workflowId ?? null };
        turn.turnId = t.id;
      }
    }
    return turn;
  });
}

/** Drop a keyed live turn (an ephemeral offer/ack whose moment has passed). */
export function dropDealTurn(entityId: string, key: string): void {
  const turns = _dealTurns.get(entityId) ?? [];
  _dealTurns.set(entityId, turns.filter((t) => t.role !== 'system' || t.key !== key));
  try { window.dispatchEvent(new CustomEvent('aug:deal-turn', { detail: { entityId } })); } catch { /* SSR-safe */ }
}

// The hand-off chip's coworker comes SERVED on the view (entity.suggestedWorker — the ONE routing
// brain, lib/prepare/route-suggestion.ts). The old client-side keyword match is deleted (W2).



// A sender's SPOKEN name: first-name a person, keep an ORGANIZATION whole ("M Condomínios Lda"
// must never become "M" — found live, Aug 3). Structural: legal-form/functional tokens mark an
// org; a person is 2–4 plain word tokens.
const ORG_TOKEN = /^(lda|ltda|ltd|llc|gmbh|inc|s\.?a\.?u?|corp|plc|srl|sl|bv|ag|oy|ab|as|kk|co|group|holdings?|team|support|service|services|billing|noreply|no-reply|info|admin|office|geral|contact|hello|hq)[.,]?$/i;
function spokenName(raw: string): string {
  const name = raw.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (!name) return name;
  const toks = name.split(/\s+/);
  const looksOrg = toks.some((t) => ORG_TOKEN.test(t)) || /@/.test(name) || toks.length === 1 && name === name.toUpperCase();
  return looksOrg ? name : toks[0];
}

// (echoesAnchor — the stitched fallback's dedup between the stored next_move and the anchor ask —
//  died with the stitched fallback: W3.5 (a), registry precedence #1.)

/** ONE PRODUCER for a mounted card's DOM handle — the wrapper writes it, the pinned CTA reads it
 *  (two spellings of one id can only ever agree by luck — the fake-warm lesson, applied here). */
const cardDomId = (artifactKey: string) => `aug-card-${artifactKey}`;

function Chip({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition-colors max-w-full ${onClick ? 'hover:border-indigo-200 hover:text-indigo-600 cursor-pointer' : 'cursor-default'}`}
    >
      {icon}<span className="truncate">{label}</span>
    </button>
  );
}

export function ItemRail({ kind, id, view, pending = false, onDraft, decision: decisionIn, artifacts: artifactsIn, onOpenHref, onStage, onHistory, sourceItemId, sourceMeeting, sourceEmail, onOpenThread, gate, sourceEvent }: {
  kind: RailKind; id: string; view: RailView;
  /** THE STRUCTURAL FRAME (UX arc): true while the view is still loading — the rail mounts its
   *  shell (header, turns, composer) immediately and shows a quiet shimmer instead of anchor
   *  claims; it must never assert anything (like "isn't tied to a project") it can't know yet. */
  pending?: boolean;
  onDraft?: (draft: string) => void;
  /** One-room R2 — the judged DECISION mounts INLINE in the stream (surface:'inline' per the
   *  registry), as the kit's `decision` card through its ONE host (W3-C, Sep 22: the host owns the
   *  steer door, so neither caller re-types the fetch it used to hand down as `onChoose`).
   *  Q5 · A DECISION SHOWS ITS OBJECT: `object` is the thing being decided (resolved by
   *  lib/room/decision-object from the door's OWN prepared artifacts). The card renders it as its
   *  head and, with none, says so — and recommends nothing. */
  decision?: (DecisionSpec & {
    /** The user's word, the moment they confirm — the caller seats it as their own turn. */
    onChosen?: (label: string) => void;
    /** What the door answered — the caller applies it to its own lane (draft, narration). */
    onResolved?: (label: string, outcome: DecisionOutcome) => void;
    /** "Leave it with me" — clears the card without acting. */
    onDismiss?: () => void;
  }) | null;
  /** One-room R2 → the PREPARED-ACTION GRAMMAR (Aug 4): EVERY prepared thing — reply draft,
   *  calendar invite, forward — is an ARTIFACT CARD in the conversation that summons its own
   *  stage (onOpen). The words and the deed are ONE element (law 8).
   *  A COMPONENT IS A TURN: `anchorKey` (a turn dedupe-key, e.g. `prep:<itemId>`) seats the card
   *  at its CHRONOLOGICAL moment in the stream — the engine's narration turn BECOMES the card.
   *  A card whose anchor turn isn't visible appends at the stream's end (never pinned, never
   *  floating above later conversation — the invite must not trail questions asked after it).
   *  THE CARD CONTRACT (Sep 8): an artifact whose kind HAS a kit card carries it as `node` — the
   *  stream mounts the real, interactive card (the invite is the first) instead of the generic
   *  "Open →" row, and the generic row is then structurally absent for that artifact. */
  /** `showsSource` — THE ONE DECLARATION that suppresses the source object card (THE OPENING
   *  CONTRACT, clause 1): a mounted card that ALREADY renders the inbound's own words. Today none
   *  do (the EmailCard is the outbound reply's editor; the InviteCard is the invite) — so the
   *  default is false and the object mounts ABOVE them. A future card that quotes the thread sets
   *  it and the object stands down, without this room guessing from a key name. */
  artifacts?: Array<{ key: string; label: string; by?: string | null; onOpen: () => void; anchorKey?: string; node?: React.ReactNode; showsSource?: boolean;
    /** W16 · which ARTIFACT this card renders on an item page (a prepared kind, a document, a frame,
     *  the looks-done evidence…). The item door's ONE table (components/thread/item-page.ts) maps it to
     *  its kit widget and picks at most one, by the machine's state. */
    artifactKind?: ItemArtifactKind }> | null;
  /** THE ONE-NAVIGATION LAW (Aug 4): inside a room, a rail link must open IN the room (the host's
   *  focus/summoned-stage opener), never page-navigate away — clicking Clara's draft from the EG
   *  Bank room dumped the user on a separate item page. Return true = handled; false = fall
   *  through to normal navigation (non-item hrefs). */
  onOpenHref?: (href: string) => boolean;
  /** THE PARITY LAW (Aug 4): a chat verb whose review lives on a stage ("forward this to Rita")
   *  summons it through the host. Absent → the rail falls back to navigation. */
  onStage?: (stage: 'forward' | 'invite' | 'reply', itemId: string) => boolean;
  /** HISTORY LEAVES THE STREAM (owner, Sep 14, twice: "the 'earlier' things… looks odd"). The room
   *  still decides WHAT is history — the same brief-watermark rules, untouched — but the record no
   *  longer sits in the conversation behind a handle. The rail REPORTS it and the host files it in
   *  the ONE drawer (components/room/filed-drawer.tsx → RoomHistorySection), read-only, beside
   *  everything else this work has filed. One seam, both doors: no door-local fork. */
  onHistory?: (lines: RoomHistoryLine[]) => void;
  /** THE OPENING CONTRACT (clause 2): the INBOX-BACKED item this room's opening is about, when the
   *  host knows it (a project room's focused mail). The loose email door needs no prop — its own
   *  `id` IS the item — and a project room with a mail MOVE falls back to the move's target, so no
   *  new server plumbing exists at either door. */
  sourceItemId?: string | null;
  /** W7.3 · A MEETING-BORN COMMITMENT'S SOURCE: the meeting itself, served by the door. It takes the
   *  object card's ONE seat when the door has no mail object — the promise shows where it was made. */
  sourceMeeting?: MeetingSourceFacts | null;
  /** W11.1 · AN EMAIL-BORN COMMITMENT'S SOURCE IS ITS OWN MESSAGE (`commitments.source_id`, served
   *  by lib/commitments/source.ts emailSourceOf) — never the thread's newest tail. On a commitment
   *  door the thread object card never mounts; this card takes the seat, and its one door opens the
   *  thread ("Later in this conversation →"). Absent while loading → nothing (the in-flight rule). */
  sourceEmail?: EmailSourceFacts | null;
  /** W8.4 · ONE CARD, ONE DOOR — the object card's "Thread →" opens the thread WHERE THE HOST READS
   *  IT: the deep-dive raises its ONE drawer on the thread section (the same door the reply card's
   *  "Thread →" uses). Absent (the project room) → the room's own in-room focus (onOpenHref), never a
   *  separate page hop. */
  onOpenThread?: (itemId: string) => void;
  /** W16 · A PARKED RUN'S GATE owns this item (a handoff: the approval card, or an input station) —
   *  mounted as the page's ONE action widget in the thread. Not prepared work, so the settled gate
   *  (a handoff is judged none) never drops it; its own card settles in place when answered. */
  gate?: { kind: 'gate' | 'input_gate'; node: React.ReactNode } | null;
  /** W16 · a meeting with a calendar event on file: its source widget is the kit's EVENT widget
   *  (time · attendees · join) instead of the source card. */
  sourceEvent?: React.ReactNode | null;
}) {
  // ══ W15.2 · SETTLED ITEMS DROP THEIR ACTION CARDS (one gate for every card kind) ════════════════
  // When THE MACHINE says this item's work is settled (closed, or judged owed-nothing), no prepared
  // card and no decision mounts in its room — a Send on settled work is a claim about work that does
  // not exist. The conversation and the drawer's history stay readable. A project room (no item
  // machine on its view) is untouched.
  const itemSettled = view.machineState?.state === 'settled';
  const artifacts = itemSettled ? [] : artifactsIn;
  const decision = itemSettled ? null : decisionIn;
  const router = useRouter();
  const ent = view.entity;
  const sib = view.siblings;
  const inRoom = kind === 'entity';
  // ══ ONE OBJECT, ONE DOOR (stabilization W7.2 — lib/room/door.ts) ═════════════════════════════
  // This rail speaks for the object in its title. THE DOOR decides three things below, in code:
  // the room key it converses under, WHOSE opening it pins (the entity door's composition on the
  // entity door, the item's own on an item door — never the linked entity's), and what it may
  // point at (a MOVE, an object card or a bound card must target something this door OWNS).
  const door: Door = inRoom
    ? { kind: 'entity', id }
    : { kind: 'item', itemKind: kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox', id };
  // THE OPENING IS THE DOOR'S OWN. The server strips the entity's voice from an item door's payload;
  // this read is the belt for a payload cached before it did (a stale LS blob carrying the entity's
  // brief under an item's key must not speak here either).
  const opening = inRoom
    ? { brief: ent?.brief ?? null, move: ent?.move ?? null, offers: ent?.offers ?? [], at: ent?.briefAt ?? null }
    : { brief: view.brief ?? null, move: view.move ?? null, offers: view.offers ?? [], at: view.briefAt ?? null };
  // ONE DEED ONE OBJECT — derived from THE PRESENTATION LAW (lib/room/presentation, the one
  // composition every pane consumes): the responder block promotes the matched artifact into
  // the action card; the stream suppresses its duplicate; the truth pane yields (its host reads
  // the same law).
  // THE MOVE YIELDS TO A RENDERED DECISION (render-plan.ts showMove — law 7, one CTA row):
  // suppressed AT THE SOURCE so every derivation downstream (the merged action card, the
  // stream's duplicate-suppression, the click target) agrees — nulling it only at render left
  // mergedArtKey excluding an artifact whose card no longer existed.
  const decisionIsPrimary = !!(decision && decision.options.length >= 2);
  // A MOVE TARGETS WHAT THIS DOOR OWNS (W7.2): on an ITEM door a move whose ref names another
  // object — the shape a brief cached under an entity key leaves behind — does not render at all
  // (an unlinked move would still stand as an obligation about someone else's mail). The entity
  // door's ref was validated against its own board server-side: that board IS what it owns.
  const composedMove = opening.brief && !decisionIsPrimary ? opening.move : null;
  const respMove = composedMove && (inRoom || !composedMove.ref || targetOwnedByDoor(door, moveTargetId(composedMove.ref), {
    cardIds: (artifacts ?? []).flatMap((a) => idsNamedByCard(a)),
  })) ? composedMove : null;
  const respMoveTargetId = moveTargetId(respMove?.ref ?? null);
  // THE CARD IS THE CTA (Sep 8, the interactive-card wave): the merge law folds a covered artifact
  // into the pinned card as a TEXT LINE — right for an "Open →" row, wrong for a card that IS the
  // workspace (the reply and the invite would lose their fields to a sentence). An artifact that
  // carries its own card is therefore never merged away: it renders in the stream, and the move's
  // CTA falls back to summoning its stage.
  const mergedArtKey = mergedArtifactKey(respMove, (artifacts ?? []).filter((a) => !a.node));
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE CTA IS A DOOR TO THE CARD, NEVER A SECOND MACHINE (owner walk, Sep 14 — a live project room).
  //
  // "Everything should flow in the conversation thread… why isn't this using the email component we
  // did? is it because it's a project?" It was: the project room served its prepared reply as a
  // bare row, so the pinned CTA had nothing in the thread to point at and fell through to the OLD
  // two-pane stage — the raw thread with a Reply/Forward toolbar one click, a floating composer
  // overlay the next (state, not the URL, decided which).
  //
  // With the card contract reaching this room the deliverable IS in the thread, so the move's CTA
  // does the one thing left to do: it takes the reader TO the card. Same click, same result, every
  // time — no stage, no overlay, no second rendering of a deed that already has one.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const mountedCards = (artifacts ?? []).filter((a) => !!a.node);
  // THE MOVE'S OWN SHAPE — read off the ref's kind, the one thing the board states about the deed.
  // An `inbox:` move is a MAIL deed: its editor is the email card, and the composer overlay is the
  // machine this law exists to keep unreachable.
  const moveIsMail = (respMove?.ref ?? '').startsWith('inbox:');
  const cardForMove = (() => {
    if (respMoveTargetId) {
      const exact = mountedCards.find((a) =>
        (a.anchorKey ?? '').includes(respMoveTargetId) || a.key.includes(respMoveTargetId)) ?? null;
      if (exact) return exact;
      // THE BOARD CAN LOSE A ROW; THE DOOR MUST NOT LOSE ITS CARD (found live, Sep 18 — a data
      // eviction). A VALIDATED ref that matches no mounted card used to die here and drop the click
      // onto the stage fallback below — the one behaviour this law forbids. The same rule that
      // already covers an unbound ref covers a ref whose row went missing: with exactly ONE card of
      // the move's own kind in the thread there is no guess to make, so the door leads to it. Two
      // cards of a kind and it stays null — code never guesses between two.
      // A BOUND CARD IS THIS DOOR'S OWN (W7.2 — lib/room/door.ts cardMayBindTarget): the one card
      // must NAME the target, or carry no id on an ITEM door (whose cards are its own by
      // construction). On the entity door a nameless sole card is never bound to a member's ref —
      // the latent guess this rule closes.
      const ofKind = mountedCards.filter((a) => (stageOfArtifactKey(a.key) === 'reply') === moveIsMail);
      return ofKind.length === 1 && cardMayBindTarget(door, ofKind[0], respMoveTargetId) ? ofKind[0] : null;
    }
    // A MOVE WITHOUT A VALIDATED REF STILL HAS ONE OBJECT (Sep 14): the composed move names the
    // deed in words but the board couldn't bind its ref, and the room mounts EXACTLY ONE card. That
    // card was chosen by the room's own agenda rule — it IS what the CTA is about — so the door
    // still leads to it rather than dying inert or falling through to a stage. With two cards there
    // is no single object and the CTA keeps its old behaviour: code never guesses between two.
    return mountedCards.length === 1 ? mountedCards[0] : null;
  })();
  // ONE-NAVIGATION LAW: every rail link goes through here — the host's in-room opener first
  // (focus/summoned stage), page navigation only when unhandled.
  const go = (href: string) => { if (onOpenHref?.(href)) return; router.push(href); };
  // R1 — the ONE room-key convention: the entity id for the entity door; `<kind>:<id>` for every
  // item door (inbox | commitment | meeting — matches lib/room/turns.ts `looseRoomKey`).
  // ONE OBJECT, ONE DOOR: the key is the DOOR's, never the linked entity's (`ent?.id` used to win
  // here — the item door then read and wrote a machine container's conversation).
  const roomKey = roomKeyForDoor(door);
  const [turns, setTurnsRaw] = useState<Turn[]>(() => _dealTurns.get(roomKey) ?? []);
  const setTurns = (updater: (prev: Turn[]) => Turn[]) => {
    setTurnsRaw((prev) => { const next = updater(prev); _dealTurns.set(roomKey, next); return next; });
  };
  // Same-deal navigation remounts the rail — restore the deal's conversation. External pushes
  // (pushDealTurn) land live via the window event.
  useEffect(() => { setTurnsRaw(_dealTurns.get(roomKey) ?? []); }, [roomKey]);
  // R1 — HYDRATE from the durable record: the server's turns are the story (engine narrations
  // wrote there while this tab was closed). The in-memory cache wins only when it's AHEAD of the
  // server (turns added this session whose fire-and-forget write may still be in flight).
  // ── THE REOPEN DELTA IS RETIRED FROM THE ROOM (owner walk, Sep 14: the clipped "Since you were
  // here — <half a sentence in the room's own language>" line "is confusing, maybe doesn't need
  // to be here"). It spoke a
  // machine-clipped echo of turns the reader was about to read one line below — and when the news
  // was a narration the room already renders, the room said the same thing twice.
  // WHAT DIES IS THE SPOKEN LINE, NOT THE MARKER: the read marker, its stamp at the serving seam
  // and the sidebar's honest hand-raise badge are untouched (T11.1–T11.11) — the project still
  // raises its hand; it just no longer narrates the raise to someone who has already answered it.
  const announcedFor = useRef<string | null>(null);
  // THE LIVE THREAD (owner walk, Sep 8 — the stale room). The hydrate below is re-runnable: a deed
  // this client just fired and the gentle background beat both bump this nonce, and the merge below
  // (server truth wins, this session's in-flight writes survive) does the rest. New turns APPEND —
  // the no-mutation law's own first allowance.
  const [turnsNonce, setTurnsNonce] = useState(0);
  useEffect(() => {
    const onDeed = () => setTurnsNonce((n) => n + 1);
    window.addEventListener(DEED_EVENT, onDeed);
    return () => window.removeEventListener(DEED_EVENT, onDeed);
  }, []);
  // LIVE = this room has a story or a standing move, i.e. the engine can still speak into it. A
  // never-used room beats zero times; the primitive's hidden-tab skip and tick cap do the rest.
  useLiveRefresh(turns.length > 0 || !!respMove, () => setTurnsNonce((n) => n + 1),
    { everyMs: 20_000, maxTicks: 45 });
  // ── THE CONVERSATION HYDRATES (Sep 8, the second half of the white void) ──────────────────────
  // The turns fetch fires only after mount, strictly AFTER /room returned — a waterfall whose
  // second leg the reader watched as an empty column beneath a painted brief. The room's other two
  // payloads have had a stamped LS envelope since the instant-load doctrine; its conversation never
  // did. Now it does, and the WARM fills the same key on hover (lib/room/warm-room.ts
  // `roomTurnsKey` — ONE producer, imported by both sides; a warm writing a key the mount never
  // reads is the fake-warm class).
  //
  // The doctrine's own rules hold: the freshness floor is IMPORTED, never restated; hydration is
  // hasContent-gated so an empty envelope can never paint "no conversation" over a room that has
  // one; the live response still merges with SERVER TRUTH WINS INCLUDING DELETIONS below; and the
  // delta line is NOT hydrated — the frozen-marker law keeps its single source, the atomic served
  // pair. The module store wins when it holds this session's own turns (an in-flight write must
  // never be overwritten by a cache older than it).
  useEffect(() => {
    if ((_dealTurns.get(roomKey) ?? []).length) return;
    try {
      const env = loadLS<{ turns?: ServerTurnRow[] }>(roomTurnsKey(roomKey), { maxAgeMs: ROOM_CACHE_MAX_AGE_MS });
      const rows = Array.isArray(env?.turns) ? env!.turns! : [];
      if (!rows.length) return;                       // never an empty paint
      const hydrated = mapServerTurns(rows);
      _dealTurns.set(roomKey, hydrated);
      setTurnsRaw(hydrated);
    } catch { /* private mode — the fetch below is the floor */ }
  }, [roomKey]);
  // TURNS KEYED ONCE (W3.7 ROOM SPEED): while the host's view is still PENDING the room key is only
  // a guess — `<kind>:<id>` — and flips to the entity id the moment the view names the deal, so the
  // conversation used to be fetched TWICE per open (the loose key, then the real one). The fetch now
  // waits for the key the view resolves; the stamped envelope above still paints meanwhile.
  useEffect(() => {
    if (pending) return;
    let alive = true;
    fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !Array.isArray(d?.turns)) return;
        if (announcedFor.current !== roomKey) {
          announcedFor.current = roomKey;
          // The serve just stamped the marker — tell the shell so the sidebar's hand-raise badge
          // for this room reads the new truth (the ONE existing refresh event; no new mechanic).
          try { window.dispatchEvent(new CustomEvent('aug:conversation-changed')); } catch { /* SSR */ }
        }
        const server: Turn[] = mapServerTurns(d.turns as ServerTurnRow[]);
        // THE ENVELOPE THE WARM FILLS (Sep 8): the RAW rows are cached, so a hydrate re-enters the
        // SAME mapper above rather than a second reading of the same payload. TURNS ONLY — the
        // served marker is read by the sidebar's badge, never by this room's render.
        try { saveLS(roomTurnsKey(roomKey), { turns: d.turns }); } catch { /* private mode */ }
        setTurnsRaw((local) => {
          // SERVER TRUTH WINS — INCLUDING DELETIONS (found live, Aug 14: apply-verdict deleted a
          // ghost narration at 08:45 but the room kept showing it at 10:36 — "local wins when
          // LONGER" resurrected the module-store copy from an earlier visit all session; a
          // deletion makes the server SHORTER by design). Local survives ONLY for this session's
          // own in-flight writes: turns with no server timestamp yet (the fire-and-forget POST
          // may still be landing) that the server response doesn't already contain.
          const seen = new Set(server.map((t) => `${t.role}|${t.text}`));
          const serverKeys = new Set(server.map((t) => (t.role === 'system' ? t.dkey : undefined)).filter(Boolean) as string[]);
          const inFlight = local.filter((t) =>
            !(t.role === 'system' && t.at) && !seen.has(`${t.role}|${t.text}`)
            && !(t.role === 'system' && t.key && serverKeys.has(t.key)));
          const next = [...server, ...inFlight];
          _dealTurns.set(roomKey, next);
          return next;
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [roomKey, turnsNonce, pending]);
  useEffect(() => {
    const onTurn = (ev: Event) => { if ((ev as CustomEvent).detail?.entityId === roomKey) setTurnsRaw(_dealTurns.get(roomKey) ?? []); };
    window.addEventListener('aug:deal-turn', onTurn);
    return () => window.removeEventListener('aug:deal-turn', onTurn);
  }, [roomKey]);
  // A NEW CHAT SESSION (owner, Sep 14) — the room's header archived the ad-hoc exchange server-side;
  // the conversation drops its live cache (and the stamped envelope, which would otherwise re-paint
  // the archived turns on the next mount) and re-reads. The room's standing record comes back with
  // that read: only the talk was archived.
  useEffect(() => {
    const onReset = (ev: Event) => {
      if ((ev as CustomEvent).detail?.roomKey !== roomKey) return;
      // FIRST, ALWAYS: the generation moves before a single byte is cleared, so anything already in
      // flight is stale from this instant on — including a response that lands in the same tick.
      bumpGen(roomKey);
      _dealTurns.set(roomKey, []);
      setTurnsRaw([]);
      try { saveLS(roomTurnsKey(roomKey), { turns: [] }); } catch { /* private mode */ }
      setTurnsNonce((n) => n + 1);
    };
    window.addEventListener('aug:room-chat-reset', onReset);
    return () => window.removeEventListener('aug:room-chat-reset', onReset);
  }, [roomKey]);
  // (History folds — the room reads ONE thing. The expand/collapse state now lives in the kit's
  //  timeline, which owns the `fold` divider; the room still decides WHAT is history.)
  const [busy, setBusy] = useState(false);
  // THE CTA'S DESTINATION IS A REAL ELEMENT (Sep 14): the card mounts inside the kit's timeline, so
  // the door needs one stable handle to scroll to. The id is derived from the artifact key (ONE
  // producer, used by the wrapper and by the door) and the brief mark is a one-shot ring — it says
  // "this is the thing I meant", then gets out of the way.
  const [pulseCard, setPulseCard] = useState<string | null>(null);
  const focusCard = (key: string) => {
    setPulseCard(key);
    requestAnimationFrame(() => {
      document.getElementById(cardDomId(key))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => setPulseCard((cur) => (cur === key ? null : cur)), 1600);
  };
  // THE CONTINUOUS WORK RECORD (owner, Aug 13 — "there is no new session of reality"): a room's
  // conversation IS the work record — judgments, preparations, decisions, dialogue, one unbroken
  // ledger. It is never sessioned and never cleared from here; FOLDING ("earlier (N)") is the
  // only compression. Navigation across rooms lives in the sidebar's All conversations.
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // An ask's "Point me to it" opens the ONE composer with a lead-in and the caret in it — answering
  // an ask happens IN the conversation (the kit's input-card grammar), never in a second widget.
  const [composerPrefill, setComposerPrefill] = useState<string | null>(null);
  // THE CoS SEAT (docs/threads-plan.md — the identity law): the room's composed brief, its lifted
  // ask and the narrator's own turns wear the seat-holder's face. Read through the ONE client hook
  // (hooks/use-cos-seat.ts → /api/workers/cos-seat → the ONE resolver) — no name or headshot is
  // chosen here, so a re-branded roster reseats the voice without code.
  const seat = useCosSeat();
  const seatId = seat?.agentId ?? 'cos';
  const seatName = seat?.name ?? 'Your assistant';
  const seatLabel = seat ? 'chief of staff' : undefined;

  // The kit owns the scroller now — pin to the newest turn through it.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('.overflow-y-auto');
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  // (The hand-off affordance now arrives as one of the responder's OFFERS — the routing brain's
  // suggestion rides the grounding; no dedicated chip.)

  // R1 — every conversational write goes through here: render + durable persist in one motion.
  const addTurn = (t: Turn) => { setTurns((prev) => [...prev, t]); persistTurn(roomKey, t); };

  // ══ THE CoS OPENS (owner walk, Sep 15: "although it resets, I think conversation should always
  // lead with a message from the agent/cos") ═══════════════════════════════════════════════════
  //
  // A room that has been reset is not a room with nothing to say — it is a colleague waiting. So
  // whenever the live conversation holds NO word of the reader's, the seat speaks one short line
  // and hands the turn back.
  //
  // DESIGN CHOICE — A DETERMINISTIC DERIVATION, NOT A SECOND COMPOSED CALL. The room's position is
  // ALREADY composed and already on screen, pinned one bubble above this one; paying a model to
  // say it again would buy a cache key, a signature, a latency and — the real cost — a SECOND VOICE
  // that can disagree with the first (experience-spec law 1: one fact, one home). So the opener is
  // derived in code from the state the room already serves, and it obeys one rule: IT NEVER
  // RESTATES THE PINNED CARD. With a position standing, the opener is purely the invitation. With
  // nothing composed (a young room, a version bump), it carries the summary's own first sentence so
  // the conversation is never mute. Zero spend, zero latency, nothing to invalidate.
  //
  // It is EPHEMERAL until engaged (the pushDealTurn({ephemeral}) idiom): it renders, it is never
  // written, and `send` persists it exactly once if the reader actually answers — so N resets can
  // never stack N greetings in the record.
  const openerText = (() => {
    if (!inRoom) return null;                              // the project door's own grammar
    if (turns.some((t) => t.role === 'user')) return null;  // the exchange has started — step aside
    const name = ent?.name?.trim();
    const pinned = opening.brief;
    const sum = (ent?.summary ?? '').trim();
    // ── A ROOM WITH A RECORD IS NEVER GREETED AS A NEW ONE (owner, Sep 18 — a two-month-old
    // project answered "Fresh start on <project>") ────────────────────────────────────────────────
    // The greeting was derived from the LIVE conversation alone, and a reset ARCHIVES turns: the
    // record was intact, filed, one drawer away — and the seat introduced itself as if the work had
    // begun this minute. The reader's own history is not something the room may forget out loud.
    //
    // DERIVED FROM WHAT THE ROOM ALREADY HOLDS (no second fetch, no new fact): a composed brief, a
    // brief watermark, a synthesized summary and any standing narration each exist only because
    // this work has a past. Only a room with none of them is genuinely new.
    const hasRecord = !!pinned || !!opening.at || !!sum || turns.length > 0;
    const invite = hasRecord
      ? (name ? `Picking ${name} back up — what do you want to look at?` : 'Picking this back up — what do you want to look at?')
      : (name ? `Fresh start on ${name}. What do you want to pick up?` : 'Fresh start. What do you want to pick up?');
    // ── THE OPENER NEVER STANDS AS A SECOND GREETER (THE OPENING CONTRACT, clause 5 — owner walk,
    // Sep 19) ────────────────────────────────────────────────────────────────────────────────────
    // With a position pinned one bubble above, "Picking <X> back up" is the room naming its own
    // subject a second time, in a second bubble, under a second copy of the same face. Wave B's
    // grouping merged the faces; the RESTATEMENT is a words problem, and it is solved by saying
    // less: with a brief standing, the opener is PURELY the invitation — no preamble, no subject.
    // And when that brief already ends by asking something, the turn is ALREADY back with the
    // reader: a question under a question is the machine talking to itself, so nothing renders.
    if (pinned) return /\?\s*$/.test(pinned.trim()) ? null : 'What do you want to pick up?';
    const firstSentence = sum ? (sum.match(/^[\s\S]{0,220}?[.!?](?=\s|$)/)?.[0] ?? null) : null;
    if (firstSentence) return `${firstSentence} What do you want to pick up?`;
    return name ? invite : null;
  })();
  const openerRef = useRef<string | null>(null);
  openerRef.current = openerText;

  // THE RESET GENERATION, at the two seams every async op needs (see the module note above):
  //   `stale(gen)`  — has this room been reset since the op started?
  //   `dropStale()` — the whole landing behaviour for a stale op: render nothing, persist nothing,
  //                   and sweep whatever the op already wrote into the archive the reset created.
  const stale = (gen: number) => genOf(roomKey) !== gen;
  const dropStale = (): true => {
    void fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}&scope=chat`, { method: 'DELETE' })
      .then(() => { setTurnsNonce((n) => n + 1); })
      .catch(() => {});
    return true;
  };

  // W3: a narration turn's tappable offer. 'prepare' fires THE ONE preparation engine (the grounded
  // result is narrated; 'aug:prepared' tells the room to refresh its board); 'say' rides the one
  // conversation core (hand-offs go through the existing steer path).
  const runAction = async (a: TurnAction) => {
    if (busy) return;
    if (a.act === 'say') { await send(a.text); return; }
    // (THE DIRECTION PICK retired Sep 8 with THE EMAIL CARD: reply directions are the card's own
    // top-edge tabs now — one selector, in the card, instead of chips in the conversation beside a
    // card that had none. The redraft still rides the one steer path, from the card.)
    if (a.act === 'adopt') {
      const gen = genOf(roomKey);
      setBusy(true);
      try {
        const res = await fetch('/api/entities/adopt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId: a.targetId, sourceId: a.sourceId }),
        });
        const d = await res.json().catch(() => ({}));
        if (stale(gen)) { dropStale(); return; }   // the room was reset while this was in flight
        if (!res.ok) setTurns((prev) => [...prev, { role: 'system', text: d.error || "I couldn't bring that in just now." }]);
        else {
          // The server rewrote the durable proposal + narrated the result — re-read the room.
          const r = await fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
          if (Array.isArray(r?.turns)) { /* the hydrate effect path re-maps on next event; do it inline */ }
          try { window.dispatchEvent(new CustomEvent('aug:prepared', { detail: {} })); } catch { /* SSR-safe */ }
          try { window.dispatchEvent(new CustomEvent('aug:deal-turn', { detail: { entityId: roomKey } })); } catch { /* SSR-safe */ }
          setTurns((prev) => prev.map((t) => (t.role === 'system' && t.key === 'founding-proposal'
            ? { ...t, actions: t.actions?.filter((x) => !(x.act === 'adopt' && x.sourceId === a.sourceId)) }
            : t)));
          setTurns((prev) => [...prev, { role: 'system', text: `Brought it in — ${d.total ?? ''} items now on ${d.keptName ?? 'this project'}.` }]);
        }
      } catch {
        setTurns((prev) => [...prev, { role: 'system', text: "I couldn't bring that in just now." }]);
      } finally { setBusy(false); }
      return;
    }
    const gen = genOf(roomKey);
    setBusy(true);
    try {
      const res = await fetch('/api/items/prepare-now', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: a.itemKind, id: a.itemId }),
      });
      const d = await res.json().catch(() => ({}));
      if (stale(gen)) { dropStale(); return; }     // the room was reset while this was in flight
      const by = d.worker ? String(d.worker).split(' ')[0] : null; // O3: the work always has a name
      const say = !res.ok ? "I couldn't prepare that just now."
        : d.did === 'draft' ? `${by ? `${by} drafted it` : 'Drafted'} — it’s ready below. Send it as-is or tell me what to change.`
          : d.did === 'nudge' ? `${by ? `${by} drafted the nudge` : 'Nudge drafted'} — it’s on the task.`
            : d.did === 'docsend' ? `${by ? `${by} found the file and drafted the send` : 'Found the file and drafted the send'} — it’s ready below.`
              : d.did === 'delegated' ? `${String(d.worker || 'A coworker').split(' ')[0]} is on it — the work lands here when it’s ready.`
                // W8.4 · NO INTERNAL TEXT: `reason` can carry the judge's own reasoning — a log line,
                // never the colleague's reply. The room speaks the house line for its class.
                : prepareNoneLine(d.reason);
      addTurn({ role: 'system', text: say });
      if (res.ok && d.did && d.did !== 'none') { try { window.dispatchEvent(new CustomEvent('aug:prepared', { detail: {} })); } catch { /* SSR-safe */ } }
    } catch {
      addTurn({ role: 'system', text: "I couldn't prepare that just now." });
    } finally { setBusy(false); }
  };

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    const gen = genOf(roomKey);
    // THE OPENER BECOMES HISTORY THE MOMENT IT IS ANSWERED (see THE CoS OPENS, below): it renders
    // as speech and persists only here, on the first real reply — so a room that is reset twice
    // never stacks two greetings, and a conversation that actually happened reads whole.
    if (openerRef.current) {
      const o = openerRef.current;
      openerRef.current = null;
      await fetch('/api/room/turns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomKey, role: 'system', text: o }),
      }).catch(() => {});
      if (stale(gen)) { dropStale(); return; }
    }
    addTurn({ role: 'user', text: t });
    setBusy(true);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, text: t }),
      });
      const d = await res.json().catch(() => ({}));
      // THE RESET WINS (Sep 15): a "New chat" between the ask and its answer means this answer
      // belongs to a conversation that no longer exists. Render nothing, keep nothing, sweep.
      if (stale(gen)) { dropStale(); return; }
      if (!res.ok) {
        // A FAILURE IS NOT HISTORY (owner walk, Sep 14 — a canned utterance must never strand as a
        // red bubble): the apology RENDERS, it is never written to the room's durable record, so a
        // reload shows the room as it stands rather than a permanent monument to one bad minute.
        setTurns((prev) => [...prev, { role: 'system', text: d.error || "That didn't go through — try again in a moment." }]);
      } else {
        // The ONE conversation core's uniform turn: `say` is the reply; refs/files are chips; a
        // reworked draft re-seeds the composer. (P6b — the rail owns zero logic.)
        if (d.draft && onDraft) onDraft(d.draft);
        // THE PARITY LAW (Aug 4): a chat-approved SEND fires the one existing send door from the
        // client (route + exactly-once hash + outcome log — never a second send path), and a
        // stage verb summons its stage. The outcome lands as a visible turn either way.
        if (d.commit?.kind === 'send_reply' && d.commit.itemId && d.commit.body) {
          addTurn({ role: 'system', text: String(d.say || 'Sending it now…') });
          const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const html = String(d.commit.body).replace(/\r\n/g, '\n').split(/\n{2,}/)
            .map((p: string) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
          try {
            const sres = await fetch(`/api/inbox/${d.commit.itemId}/send-reply`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ customMessage: html, aiDraft: d.commit.body }),
            });
            if (stale(gen)) { dropStale(); setBusy(false); return; }
            addTurn({ role: 'system', text: sres.ok ? 'Sent — on its way.' : "Couldn't send — open the draft and send from there." });
            if (sres.ok) announceDeed(); // a DEED, not a preparation — the room re-authors its opening
          } catch { addTurn({ role: 'system', text: "Couldn't send — open the draft and send from there." }); }
          setBusy(false); return;
        }
        if (d.openStage?.stage && d.openStage.itemId) {
          const handled = onStage?.(d.openStage.stage, d.openStage.itemId);
          if (!handled) go(`/item/${d.openStage.itemId}?kind=email`); // the stage lives on the item view
        }
        // ARTIFACTS-INTO-ORIGIN (Aug 9): a dispatched deliverable rides back as a chip on THIS
        // turn — the room that asked holds the door to the document, never a bare pointer.
        const artRef = d.artifact?.id && d.artifact?.threadId
          ? [{ label: `📄 ${String(d.artifact.title ?? 'Document').slice(0, 60)}`, href: `/home?chat=worker:${encodeURIComponent(String(d.artifact.threadId))}:${encodeURIComponent(String(d.delegated?.agentId ?? ''))}` }]
          : [];
        setTurns((prev) => [...prev, {
          role: 'system',
          // Refs render as chips below — the raw [L4]/[F2] markers must never sit in the prose.
          text: String(d.say || d.answer || 'Done.').replace(/\s*\[[LF]?\d+(?:\s*,\s*[LF]?\d+)*\]/g, ''),
          refs: [...artRef, ...(Array.isArray(d.refs) ? d.refs.map((r: { label?: string; href?: string | null }) => ({ label: String(r.label ?? ''), href: r.href ?? null })) : [])],
          files: Array.isArray(d.files) ? d.files : undefined,
          ...(d.workflowDraft ? { workflowDraft: d.workflowDraft as WorkflowDraft } : {}),
          // THE PRESENTED OBJECT PAINTS AT ONCE (W4-C): the served spec rides the answer, so the
          // live card needs no round-trip. The DURABLE copy is the component turn the steer door
          // wrote server-side — the next open re-reads it as a pointer.
          ...(d.collection && isCollectionSpec(d.collection.spec)
            ? { collection: { collectionId: String(d.collection.id), spec: d.collection.spec as CollectionSpec } } : {}),
          ...(d.event && isEventSpec(d.event.spec)
            ? { event: { eventId: String(d.event.spec.id), spec: d.event.spec as EventSpec } } : {}),
          // THE CONFIRM CARD paints at once from the served spec; the durable copy is the
          // component turn the steer door wrote, re-read as a pointer on the next open.
          ...(d.change && isChangeSpec(d.change.spec)
            ? { change: { changeId: String(d.change.spec.id), spec: d.change.spec as ChangeSpec } } : {}),
        }]);
      }
    } catch {
      // Same law as the !ok branch above: render it, never record it.
      setTurns((prev) => [...prev, { role: 'system', text: "That didn't go through — try again in a moment." }]);
    } finally { setBusy(false); }
  };

  // 📎 — the ingest funnel: the file lands in the per-item deliverable pool (ONE write, every reader
  // — steps, coworkers, find_file — sees it); the rail only narrates what happened.
  const attach = async (f: File) => {
    if (busy) return;
    const gen = genOf(roomKey);
    addTurn({ role: 'user', text: `Attached: ${f.name}` });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f); fd.append('kind', kind); fd.append('id', id);
      const res = await fetch('/api/items/ingest', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (stale(gen)) { dropStale(); return; }     // the room was reset while this was in flight
      if (!res.ok) addTurn({ role: 'system', text: d.error || "I couldn't read that file." });
      else setTurns((prev) => [...prev, {
        role: 'system',
        text: d.satisfiedStep
          ? `Got it — that covers "${d.satisfiedStep}". It's folded into this work now.`
          : `Got it — I've folded ${d.filename} into this work. Anything running here can read it now.`,
      }]);
    } catch {
      addTurn({ role: 'system', text: "I couldn't read that file." });
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  // ── THE RECORD LEAVES THE STREAM (owner, Sep 14, said twice: "the 'earlier' things I'm not sure
  // it makes sense… I'm not sure where to fit it or what value it brings but looks odd") ─────────
  //
  // Until now the room's past sat in the conversation behind an "earlier (N)" handle at the TOP of
  // the stream (the Aug 14 seat), and expanding it produced a wall of grey legacy narration above
  // the room's own opening. THE STREAM SHOWS THE PRESENT: the pinned message, the live exchange,
  // the cards, the composer. The record did not stop mattering — its SEAT was wrong, and it is now
  // the ONE drawer (`onHistory` below → RoomHistorySection), read-only like every other filed fact.
  //
  // NOTHING UNDERNEATH MOVED: the fold rules below still decide WHAT is history (the brief
  // watermark, the dead-ask rule, the orphan-prep fold, the aged anticipation/proposal rules), and
  // what is PRESENT — a live ask, a card, a coworker's speech, the last turns — stays in the stream
  // exactly as before. Only the folded PAST changed address, and it changed address at BOTH doors
  // at once, because this computation was always shared. ──
  // The lifted engine ask lives in the brief above — never twice on screen (law 1).
  // THE MOOT ASK BY CODE (W3.5 (d), lib/room/ask-mootness — the machine's read, served as
  // `mootAskKeys`): an ask the header ignored is not shown as live here either. ONE claim per room.
  const mootAskKeys = new Set(view.mootAskKeys ?? []);
  const isMootAsk = (t: Turn) => t.role === 'system' && !!t.dkey && mootAskKeys.has(t.dkey);
  const liftedAsk = turns.find((t): t is Extract<Turn, { role: 'system' }> => t.role === 'system' && !t.author?.name && !!t.checklist?.length && !!t.turnId && !isMootAsk(t));
  const stream = turns.filter((t) => t !== liftedAsk && !isMootAsk(t));
  // A SETTLED ask's remnant ("To finish this I need…" with its checklist stripped) is
  // history, not news — it folds into "earlier" always, never the default read (law 6).
  const isDeadAsk = (t: Turn) => t.role === 'system' && !!t.dkey && /^(requires:|delegate:)/.test(t.dkey) && !t.checklist?.length;
  // NARRATION EXPIRES WITH THE BRIEF (THE GROUND LAW, experience-spec Aug 13): the composed
  // brief IS the digest of the history it was written over — so ANY engine narration older
  // than the composition folds into "earlier (N)". Only the muted event-line grammar expires:
  // never the user's words, never a coworker's own speech, never a LIVE component.
  // NARRATION HAS ITS OWN CLOCK (owner walk, Sep 8 — root cause C3, and the RECORDED class biting
  // again: "fold rules must not depend on brief presence"). `briefAt` is null on every version bump
  // — the cached brief mismatches, nothing serves an `at`, and this rule switched OFF exactly in the
  // window where the room is most likely to be carrying stale narration. A narration older than the
  // grace window is history whether or not a brief exists to digest it.
  const foldBriefAt = opening.at;
  const NARRATION_GRACE_MS = 48 * 60 * 60 * 1000;
  const narrationAged = (at: string, graceMs: number) => {
    const ms = Date.parse(at);
    return Number.isFinite(ms) && Date.now() - ms > graceMs;
  };
  const isExpiredNarration = (t: Turn) => t.role === 'system'
    && !t.author?.name && !t.checklist?.length && !t.actions?.length
    && !t.standingSpec && !t.workflowDraft && !t.approval
    && !!t.at
    && (foldBriefAt ? t.at < foldBriefAt : narrationAged(t.at, NARRATION_GRACE_MS));
  // THE ORPHAN-PREP FOLD (found live, Aug 14 — the ghost line): a `prep:*` narration whose
  // artifact no longer exists must NEVER stand alone — with its card present it seats AS the
  // card; without one it is history. Holds even with the brief absent (a version bump
  // invalidates every cached brief, and brief-keyed fold rules switch off exactly then).
  // AN ANTICIPATION IS A PREP NARRATION (owner walk, Sep 8 — root cause C4): `anticipate:meeting:*`
  // turns sat OUTSIDE every retirement rule, so a Sep 1 prep for a Sep 2 meeting still stood on
  // Sep 8 saying "due today (Sep 2)". They join the prep class here (and at the render), and —
  // because an anticipation's subject is IMMINENT by construction when it is written — one that has
  // outlived its own horizon folds regardless of whether a card still backs it.
  const artifactAnchorKeys = new Set((artifacts ?? []).map((a) => a.anchorKey).filter(Boolean));
  const isOrphanPrep = (t: Turn) => t.role === 'system' && !!t.dkey
    && /^(prep:|meeting-prep:|anticipate:)/.test(t.dkey) && !artifactAnchorKeys.has(t.dkey);
  const ANTICIPATION_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
  const isAgedAnticipation = (t: Turn) => t.role === 'system' && !!t.dkey
    && /^anticipate:/.test(t.dkey) && !!t.at && narrationAged(t.at, ANTICIPATION_LIFE_MS);
  // THE AGED PROPOSAL (Sep 7): a bring-in turn whose options no longer render — because it is past
  // its speech window, or because every option was taken — is not news. It folds into "earlier"
  // like any other record; the deed lives in the drawer's membership block.
  const isAgedProposal = (t: Turn) => t.role === 'system' && t.dkey === 'founding-proposal' && !t.actions?.length;
  const fresh = stream.filter((t) => !isDeadAsk(t) && !isExpiredNarration(t) && !isOrphanPrep(t)
    && !isAgedProposal(t) && !isAgedAnticipation(t));
  // HISTORY FOLDS (law: the user reads ONE thing) — the newest 3 turns show; everything older
  // waits in the drawer — the ONLY compression the continuous record has.
  // W16 · ON AN ITEM PAGE the stream carries only the reader's OWN exchange (from their first word
  // on); every engine narration is the record, filed in the drawer's History. The project door keeps
  // its newest-three tail.
  const firstUserTurn = turns.findIndex((t) => t.role === 'user');
  const itemExchange = firstUserTurn < 0 ? [] : turns.slice(firstUserTurn).filter((t) => stream.includes(t)).slice(-4);
  const visibleTail = inRoom ? fresh.slice(-3) : itemExchange;
  const visibleSet = new Set(visibleTail);
  const historyTurns = stream.filter((t) => !visibleSet.has(t));

  // THE RECORD IS REPORTED, NEVER RENDERED HERE. Signature-keyed so the report fires when the
  // record actually changes (the array is rebuilt every render — a reference dep would loop), and
  // the host's callback is read through a ref so a host that re-creates its handler never re-fires.
  const historyLines: RoomHistoryLine[] = historyTurns.map((t, i) => ({
    id: `hist-${i}`,
    role: t.role === 'user' ? 'user' : 'system',
    who: t.role === 'system' ? t.author?.name ?? null : null,
    text: t.text,
    at: t.role === 'system' ? t.at ?? null : null,
  }));
  const historySig = historyLines.map((l) => `${l.role}|${l.at ?? ''}|${l.text.slice(0, 60)}`).join('~');
  const onHistoryRef = useRef(onHistory);
  onHistoryRef.current = onHistory;
  const historyLinesRef = useRef(historyLines);
  historyLinesRef.current = historyLines;
  useEffect(() => {
    onHistoryRef.current?.(historyLinesRef.current);
  }, [historySig]);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE PORT (Phase 2d — docs/threads-plan.md): the room's conversation renders through THE ONE
  // THREAD COMPONENT. Every engine seam above is untouched — turn persistence, the hydrate merge
  // (SERVER TRUTH WINS INCLUDING DELETIONS), the steer/send path, supersession, the fold rules.
  // What moves is the SEAT MAP:
  //   · the composed brief + THE MOVE   → THE PINNED MESSAGE, wearing the CoS seat's face
  //   · the offers                      → composer chips (a click is literally a word)
  //   · user turns                      → user_bubble
  //   · a coworker's own speech         → actor_bubble with THEIR face (the one-narrator law)
  //   · engine narration (authorless)   → event_line: faceless BY GRAMMAR (deltas, not events)
  //   · component turns · artifact cards→ `custom`/`deliverable` cards, MOUNTED WHOLE, seated at
  //                                       their anchor turn's chronological moment (anchorKey)
  //   · the history fold                → the timeline's `fold` divider
  // A port is a MOUNT, never a rewrite: every rich render below is the markup the rail already had.
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  // ── THE ASK IS THE ONE HOST NOW (W3-A, Sep 22 — docs/component-map.md §2a) ─────────────────────
  // This file used to carry `checklistBlock` + `proceedChip` + `proceedEngineAsk`: the rows, the
  // never-blocking door and the /api/room/asks fetch, hand-drawn beside three other copies of the
  // same object. All three are gone. The room mounts `components/home/input-card.tsx`, which mounts
  // the kit's `input` card — one rendering of an ask, on every surface, with the go-ahead law
  // (lib/room/go-ahead.ts) applied in exactly one place and the door fired through the one deed
  // module (lib/deeds/gate-doors.ts).
  //
  // THE CHAT FEEL SURVIVES INTACT (owner walk, Sep 7): the kit's input card IS the neutral bordered
  // card this room adopted — quiet rows, quiet chips, the go-ahead as a quiet indigo TEXT link.
  // No amber, no orange: the room's only accent is still the pinned CTA.
  // THE SAID-IT OFFER (W4-B, Sep 22): the reader's most recent line in this room. When it plainly
  // could BE the fact an ask is missing, the ask's row offers to use it — a click, never a guess
  // (the ask-direction floor: our ask, their words, their click). The host decides whether any
  // offer is warranted; this only hands over what was last said.
  const lastUserText = (() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') return turns[i].text ?? null;
    return null;
  })();
  const askCard = (
    a: Pick<Extract<Turn, { role: 'system' }>, 'turnId' | 'checklist' | 'proceeded' | 'author' | 'refs' | 'base'> & { text?: string },
    key: string,
  ) => (
    <div className="mt-1.5">
      <InputCard
        id={key}
        held={busy}
        spec={{
          shape: 'engine',
          ...(a.turnId ? { turnId: a.turnId } : {}),
          ask: a.text ?? '',
          items: a.checklist ?? [],
          ...(a.base?.length ? { base: a.base } : {}),
          context: askContext(a),
          ...(a.proceeded ? { proceeded: true } : {}),
          onAttach: () => fileRef.current?.click(),
          onPointToIt: () => setComposerPrefill('It’s in '),
          ...(lastUserText ? { recentUserText: lastUserText } : {}),
          // WHOSE ASK IT IS decides what the go-ahead does: a coworker's is answered by SPEAKING to
          // them; the engine's own stamps the lifecycle through the asks door.
          ...(a.author?.name
            ? { onSpeak: (t: string) => void send(t), speakerFirstName: a.author.name.split(' ')[0] }
            : {}),
        }}
        // The room's local record keeps up with the deed: a proceeded ask stops offering the door.
        onSettled={() => {
          const tid = a.turnId;
          if (tid) setTurns((prev) => prev.map((x) => (x.role === 'system' && x.turnId === tid ? { ...x, proceeded: true } : x)));
        }}
      />
    </div>
  );

  // ── THE PINNED BRIEF (the room's composed opening as its FIRST message) ───────────────────────
  // THE ONE-VOICE BRIEF: when the responder has spoken, the paragraph IS the opening. The stitched
  // fields (anchor · summary · debts) are ONLY the fallback until the first compose lands — and
  // they ride the SAME pinned seat, so there is never a second prose opening anywhere.
  const composed = opening.brief;
  // ══ THE ASK LINE SPEAKS THE COUNTERPARTY'S OWN ASK (THE OPENING CONTRACT, clauses 2+3 — the
  // owner's Sep 19 walk) ═══════════════════════════════════════════════════════════════════════
  //
  // This stitch is the pre-compose opening (and the one that paints first on every cold open), and
  // the walk found three lies in its one sentence:
  //
  //   · "Sam is asking you to decide whether to engage with Sam's collaboration proposal" — the
  //     counterparty named TWICE, and a frame that is not theirs at all. Deciding is OUR reading of
  //     what arrived; the anchor's `ask` is the understanding's verb-first line, which is sometimes
  //     the counterparty's actual request ("send the signed form") and sometimes the machine's own
  //     disposition ("decide whether to…"). Fusing the second into "X is asking you to…" puts our
  //     words in their mouth. So the machine-framed shapes are DETECTED and attributed to the
  //     machine, with the counterparty kept as what they actually are: the sender.
  //   · "Clara drafted a reply below" — the speaker narrating herself, with nothing below. THE ONE
  //     LAW, imported: the claim survives only while its card is MOUNTED in this stream, and the
  //     seat's own name collapses to "I" through lib/room/self-voice.
  //
  // FIXED HERE, NOT IN THE JUDGE: the verdict's words are cached per item and JUDGE_VERSION was
  // bumped this same day — re-judging the world twice over a framing question is spend for a
  // sentence the composition layer already owns. The judge keeps saying what the work IS; this
  // seat decides whose mouth it comes out of.
  const anchorLine = (() => {
    const a = view.anchor;
    const who = a?.who ? spokenName(a.who) : null;
    // THE CLAIM RENDERS OR IT IS NOT MADE: "below" is true only while the card is in this stream.
    const replyMounted = mountedCards.some((c) => c.key === 'reply');
    const prep = a?.prepared && replyMounted
      ? collapseSelfVoice(
          a.prepared === 'draft' ? 'I drafted a reply below' : `${a.prepared.split(' ')[0]} drafted a reply below`,
          seat?.name ?? null)
      : null;
    // W8.4 · THE ONE FALLBACK LADDER (lib/room/opening-fallback.ts): their seat and our frame never
    // fused, the item's own ask in a colleague's words ("Still open: …", never "This needs you to
    // <title>"), and NO membership claim at all — the header's connection line is membership's
    // only voice, so the untied-work claim (made from absence) can never sit under a "connects to …" chip.
    const line = fallbackOpeningLine({ who, ask: a?.ask ?? null, preparedClause: prep });
    // A person is introduced once per sentence; the second mention is "they"/"their".
    return line ? nameOncePerSentence(line, [who]) : null;
  })();
  // ══ THE FALLBACK IS ONE VOICE (W3.5 (a); registry precedence #1: "the stitched field-assembly
  // fallback is dead"). Found live: with no composed brief the pinned seat spoke as THREE authors
  // — the anchor line (the understanding's ask), a grey entity-summary line (the state synthesis in
  // the team's voice), and "You owe:" / "They owe:" debt lines — one fact, three homes. When no
  // composition speaks, the seat says ONE thing: the item's own ask (a project room: its summary or
  // the welcome line) — or nothing (W8.4: the quiet seat, never a claim made from absence).
  const openingText = composed ?? (inRoom
    ? (ent?.summary ?? (turns.length === 0
      ? `This is the room for ${ent?.name ?? 'this work'} — ask anything, correct me, or hand work off. I hold everything on it.`
      : null))
    : anchorLine);
  // THE STRUCTURAL FRAME: the frame is up before the view — a quiet shimmer, never a claim.
  const showShimmer = !inRoom && pending && !ent && !view.anchor?.ask && !view.brief;

  // ═══ THE MOVE + THE OFFERS (the one responder): ONE primary action (the single most
  // consequential next thing, board-validated) in the pinned CTA row + the offers as composer
  // chips, each of which literally SPEAKS through the composer (clicks are utterances). ═══
  // THE MOVE YIELDS TO ANY MOUNTED CARD (W3.5 (b); registry precedence #10): the rail states the
  // fact (a kit card for the move's target is in this stream), the ONE placement table decides.
  const plan = panelPlan({ hasDecision: decisionIsPrimary, moveCardMounted: !!cardForMove });
  const resp = composed ? { move: plan.showMove ? respMove : null, offers: plan.showOffers ? opening.offers : [] } : null;
  // ONE DEED, ONE OBJECT: when the MOVE's target IS a prepared artifact on this rail, the two
  // renderers MERGE — the object rides IN the pinned card (its label + byline), the move's label is
  // the CTA, and the artifact never renders a second time in the stream.
  const mergedArt = mergedArtKey ? (artifacts ?? []).find((a) => a.key === mergedArtKey) ?? null : null;
  const refHref = (ref: string | null): string | null => {
    if (!ref) return null;
    const [k, i] = ref.split(':');
    return k === 'inbox' ? `/item/${i}` : k === 'commit' ? `/item/${i}?kind=commitment` : null;
  };
  const moveHref = refHref(resp?.move?.ref ?? null);
  const selfTarget = !inRoom && !!moveHref && moveHref.includes(`/item/${id}`);
  const moveClick = resp?.move
    ? () => {
        // THE CARD FIRST: when the move's own deliverable is rendered in this thread, the CTA is
        // that card's door — it scrolls to it and marks it, and nothing else fires.
        if (cardForMove) { focusCard(cardForMove.key); return; }
        // The merged card's click carries the STAGE INTENT — Open lands on the prepared thing (the
        // host raises the stage), never the bare thread.
        if (mergedArt && respMoveTargetId && onStage?.(stageOfArtifactKey(mergedArt.key), respMoveTargetId)) return;
        // ── THE FALLBACK NEVER RAISES A REPLY COMPOSER (Sep 18) ──────────────────────────────────
        // The two branches below were the ladder's last rungs, and both ended in the old split-screen
        // stage: a self-targeting move asked the host for a 'reply' stage outright, and a mail move
        // whose card had been evicted from the board navigated into a door that raises one. The law
        // above says a mail deed flows in the thread and its card IS the editor — so when that card
        // is absent the door goes no deeper than the THREAD (the same place the card's own
        // "Thread →" lands), and with nowhere left to go the seat SAYS SO rather than renting a
        // second editor for a draft the board no longer holds.
        // Forward and invite keep their stages: their cards are not in the thread yet.
        if (moveIsMail) {
          if (moveHref && !selfTarget) { go(moveHref); return; }
          pushDealTurn(roomKey,
            "That prepared work isn't on the board right now — there's nothing to open yet. Ask me to prepare it again and it'll land here as a card.",
            { key: 'move-without-card', ephemeral: true });
          return;
        }
        if (selfTarget) { if (!onStage?.('reply', id)) { /* the stage host isn't mounted — nothing to do */ } return; }
        if (moveHref) go(moveHref);
      }
    : null;
  // ══ Q6 · A CTA REVIEWS WORK DONE (attention-plan PART III) ═════════════════════════════════════
  // A primary button promises that something was PREPARED and the user's part is to review it. The
  // walk found "Next: Confirm Sep 14 call status, send material, lock call time" standing as one —
  // a to-do list in button costume, composed weeks earlier by the state synthesis.
  //
  // The composed move is floored at composition (lib/room/brief.ts consults the board, binds an
  // unbound move to the room's SOLE staged entry, and marks an unstaged move `offer`).
  // THE PRE-COMPOSE FALLBACK ("Next: <the entity's stored next_move>") IS DEAD (W3.5 (a); registry
  // precedence #1): it never passed a composer, its target was the room itself, and it stood as an
  // inert CTA under the reader. The seat carries a composed move or none.
  // THE CoS's OFFER LINE — what stands in the CTA's place when the deed is not staged — and NEVER
  // beside a mounted prepared card (W3.5 (c): a ready artifact is never demoted to "say the word";
  // the card IS the deed's surface). One predicate, lib/room/cta-law.
  const ctaOffer: string | null = offerLineFor(resp?.move, { cardMounted: mountedCards.length > 0 || !!mergedArt });
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE MOVE IS THE KIT'S `proposal` CARD (W4-A, Sep 22 — docs/component-map.md §2).
  //
  // It used to be a bare `ThreadAction` pushed into the pinned bubble's action row, with the object
  // it was about printed as a loose sentence one line above it — a deed and its object rendered by
  // two different mechanisms in one bubble, and the only room object with no kind of its own.
  //
  // NOTHING ABOUT THE LAW MOVED: the target is still model-picked and CODE-VALIDATED against the
  // board (`respMoveTargetId` ← `moveTargetId`), the click ladder is still `moveClick` (the card
  // first, then the merged stage, then the thread), an unvalidated move still renders its WORDS
  // with no door (a CTA that goes nowhere is never a button), and the demoted move still speaks as
  // the CoS's offer SENTENCE rather than wearing a button costume (`ctaOffer`, untouched).
  //
  // THE OFFERS' SEAT STAYS EMPTY BY LAW (owner walk, Sep 14 — "I think I had told you to remove the
  // chips here too"): the card CAN carry them and the composer door is wired (`onSay`), but the
  // room passes none. A room states ONE thing.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const moveCard: ThreadCard | null = (() => {
    if (resp?.move && !resp.move.offer) {
      // A CARD IN THE THREAD IS A LIVE DESTINATION (Sep 14) — the CTA is clickable whenever it has
      // somewhere real to go, and its own card counts first.
      const live = (cardForMove || moveHref || selfTarget || mergedArt) && moveClick;
      return {
        kind: 'proposal', id: 'move',
        // ONE DEED, ONE OBJECT: the merged artifact rides IN the card it is the deed for.
        ...(mergedArt ? { title: mergedArt.label } : {}),
        ...(mergedArt?.by ? { detail: `by ${mergedArt.by.split(' ')[0]}` } : {}),
        confirmLabel: resp.move.label,
        ...(live ? { onConfirm: moveClick! } : {}),
        onSay: (say: string) => { void send(say); },
        ...(busy ? { busy: true } : {}),
      };
    }
    // (No pre-compose fallback card — a stored next_move never renders as a deed: W3.5 (a).)
    return null;
  })();
  // (No chip-row seat any more — see THE CHIPS ARE RETIRED FROM THE ROOM, at the composer below.
  //  `resp.offers` stays served and deduped at composition; the room renders none of them.)

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ONE AGENDA PER ROOM, ENFORCED AT THE RENDER (owner walk, Sep 8: "its confusing having 2
  // deliveries from clara, multiple CTAs").
  //
  // The engine's live ask was already LIFTED out of the history stream — but it was lifted into a
  // SECOND bubble of its own, wearing the same seat's face, carrying its own answer doors, sitting
  // directly beneath the pinned brief's CTA. Two messages from the same mind, two agendas, on a
  // page whose whole law is that a room states ONE thing.
  //
  // So the lift completes: while the composed brief stands pinned, the ask does not stand beside
  // it — its checklist folds INTO the pinned card, beneath the position that speaks it (the brief's
  // COHERENCE rule already names the gap in its own words; the rows carry the concrete items). ONE
  // pinned message, ONE primary CTA, the ask's quiet answer doors under it.
  //
  // THE DEED MOVES, NEVER ORPHANS: this mounts the SAME ask host with the SAME handlers —
  // attach, point-me-to-it and go-ahead all keep working, just in one seat instead of two.
  //
  // ⚠️ THE LAW WAS DOOR-BLIND; ITS CONDITION WAS NOT (owner, Sep 14: "not sure you're walking the
  // changes through projects AND single loose task items… all changes should be applied across the
  // board"). The fold was gated on a COMPOSED brief — and a loose item's pinned seat very often
  // speaks WITHOUT one: the pre-compose fallback still paints the anchor line and pushes a
  // "Next: …" CTA. So on /item the reader met exactly the double this law exists to kill — a pinned
  // move CTA, and an ask card with its own Attach / Point-me row standing below it.
  //
  // The test is now the one fact that actually decides whether a second agenda would exist: DOES
  // THE PINNED SEAT ALREADY SPEAK? (a position, or a CTA of its own). If it does, the ask folds
  // into it at EVERY door; if it doesn't, the ask IS the room's voice and keeps its own bubble —
  // the law is "one agenda", never "hide the ask". Without a composed brief the ask's own sentence
  // rides into the pinned card with its rows, because nothing above it names the gap.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const pinnedSpeaks = !!(composed || openingText || moveCard || ctaOffer);
  const foldedAsk = pinnedSpeaks && liftedAsk?.checklist?.length ? liftedAsk : null;

  // WHAT THE WORK ITSELF IS CALLED — the context the go-ahead test judges a missing item against:
  // the ask's own item ref (every ask carries it), the room's stated move, and the item anchor's
  // ask. If the gap's own words are in there, the gap IS the deliverable and there is nothing to
  // proceed with (lib/room/go-ahead.ts).
  // (It reads ONE field of the turn, so it takes one field — the ask host is handed the same narrow
  // shape at all three seats, and a seat cannot accidentally widen what the test judges against.)
  const askContext = (t: Pick<Extract<Turn, { role: 'system' }>, 'refs'>): Array<string | null | undefined> => [
    ...((t.refs ?? []).map((r) => r.label)),
    // The entity's own next move is the ENTITY door's context, never an item door's (W7.2).
    resp?.move?.label ?? (inRoom ? ent?.nextMove ?? null : null),
    view.anchor?.ask ?? null,
  ];

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE OPENING IS SPEAK → SHOW → OFFER (docs/threads-plan.md, THE OPENING CONTRACT, clauses 1+2).
  //
  // "No ask, decision, or brief serves without its object in reach." The walk found the room asking
  // the reader to act on a request it never showed them — and a decision card saying nothing was
  // attached while the decision's object was the inbound message sitting one fetch away.
  //
  // WHICH OBJECT: the loose email door's own item; a project room's focused mail (the host's prop);
  // failing that, a mail MOVE's own target, which the room already validated client-side. No new
  // server plumbing at either door.
  //
  // NEVER TWO RENDERINGS OF ONE THREAD (the owner's second constraint, enforced twice):
  //  · if a card for that same item already RENDERS THE INBOUND'S OWN WORDS (`showsSource`), the
  //    object card does not mount — the reader never meets two excerpts of one conversation;
  //
  //    ⚠️ THE TEST WAS "IS A CARD MOUNTED", AND IT HID THE COMMONEST DOOR (owner walk, Sep 19).
  //    An item with a prepared draft mounts the EmailCard — and the EmailCard is the REPLY: its
  //    to/subject/body are the words going OUT. It never shows the message being answered. So the
  //    one state where showing the inbound matters most — "here is what they asked, here is what
  //    I'd send" — was exactly the state that suppressed it. The suppression now keys on the one
  //    fact that decides it (does that card carry the source's words?), which today is never true,
  //    so the object card mounts ABOVE the reply: the inbound you are answering, then the answer.

  //  · and it mounts at exactly ONE seat per stream, by priority: the DECISION (the ask that needs
  //    it most) → the PINNED opening (which is also where a folded ask lives) → the lifted ask's
  //    own bubble. Every one of those seats is within a screen of the others; three copies of one
  //    message would be the same noise this law exists to remove.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE OBJECT IS THE DOOR'S OWN SOURCE (W7.2 — lib/room/door.ts objectIdForDoor): an item door
  // never takes the MOVE's target as its source — that fallback is how another item's raw email
  // mounted under a commitment's title. The entity door, with nothing focused, may still fall back
  // to its mail move's target: a member it owns.
  const objectItemId = objectIdForDoor(door, { sourceItemId, moveRef: respMove?.ref ?? null });
  const objectAlreadyMounted = !!objectItemId
    && mountedCards.some((a) => !!a.showsSource
      && ((a.anchorKey ?? '').includes(objectItemId) || a.key.includes(objectItemId)));
  // W11.1 · A COMMITMENT'S OBJECT IS ITS OWN SOURCE MESSAGE: the thread's object card (whose door
  // serves the NEWEST tail) never stands for a commitment — the message the promise came from does.
  const commitmentDoor = kind === 'commitment';
  const objectCard = (commitmentDoor && sourceEmail) ? (
    <EmailSourceMount source={sourceEmail}
      // The one door: the host's drawer (the deep-dive's Source section, which carries the rest of
      // the conversation) — else the thread's own item. No door, no label (no lying doors).
      onOpen={onOpenThread ? () => onOpenThread(objectItemId ?? '') : objectItemId ? () => go(`/item/${objectItemId}`) : undefined} />
  ) : (objectItemId && !objectAlreadyMounted && !commitmentDoor) ? (
    <SourceObjectMount itemId={objectItemId}
      // W8.4 · ONE CARD, ONE DOOR: the host's drawer (the deep-dive) — else the room's own focus.
      onOpenThread={() => (onOpenThread ? onOpenThread(objectItemId) : go(`/item/${objectItemId}`))} />
  ) : (!objectItemId && door.kind === 'item' && sourceMeeting) ? (
    // THE ONE NOTE ADDRESS: /meetings/<calendarEventId ?? transcriptId> — served as `addressId`.
    <MeetingSourceMount meeting={sourceMeeting} onOpen={() => go(`/meetings/${sourceMeeting.addressId}`)} />
  ) : null;
  // A decision that ALREADY shows a prepared object keeps it (that is the work being approved) —
  // the source then takes the next seat down, where it is the material, not the deliverable.
  const decisionSeatsObject = !!objectCard && decisionIsPrimary && !decision?.object;
  const askSeatsObject = !!objectCard && !decisionSeatsObject && !!liftedAsk && !foldedAsk;
  const pinnedSeatsObject = !!objectCard && !decisionSeatsObject && !askSeatsObject;

  // ONE AUTHOR PER OPENING (W3.5 follow-up, W3.7): `view.gap` is the PLAN's suggestion line — a
  // second author. Beside a composed brief it restated the gap in other words (the COHERENCE rule
  // already has the composer name it), so it renders ONLY when no composed brief speaks.
  const gapLine = composed ? null : (view.gap ?? null);
  const pinnedNode = (showShimmer || gapLine || moveCard || mergedArt || foldedAsk || ctaOffer || pinnedSeatsObject) ? (
    <div className="space-y-1.5">
      {showShimmer && (
        <div className="space-y-1.5 py-0.5" aria-hidden>
          <div className="h-3 w-4/5 rounded bg-neutral-100 animate-pulse" />
          <div className="h-3 w-3/5 rounded bg-neutral-100 animate-pulse" />
        </div>
      )}
      {/* ══ ONE TYPE SCALE PER BUBBLE (THE OPENING CONTRACT, clause 5 — owner: "not a fan") ══════
          These lines used to render at 12.5px in three colours under a 13px pinned sentence. Four
          treatments for one voice reads as four voices. They are ONE SIZE (the bubble's own 13px)
          and THE BUBBLE'S OWN TONE (text-neutral-800 — the kit's bubble text, W3.5 (e): a muted
          second tone was still a second colour inside one bubble); hierarchy is SPACING only. */}
      {/* The gap — one plain ask, same channel (never a step list). */}
      {/* ONE ACCENT PER ROOM: the gap is a SENTENCE, not a warning — amber here was a second focus
          point competing with the pinned CTA (owner walk, Sep 7). */}
      {gapLine && <p className="text-[13px] leading-[1.5] text-neutral-800">{gapLine}</p>}
      {/* Q6 · THE OFFER IN THE CTA'S SEAT: nothing is staged, so the room offers to shape it —
          in the speaker's own first person, sayable, and never dressed as a button. */}
      {ctaOffer && <p className="text-[13px] leading-[1.5] text-neutral-800">{ctaOffer}</p>}
      {/* SHOW, between the speech and the offer: the thing the position is ABOUT — the source
          object, in the ONE object card, directly under the words that ask about it. */}
      {pinnedSeatsObject && <div className="pt-0.5">{objectCard}</div>}
      {/* THE MOVE, AS THE KIT'S `proposal` CARD (W4-A) — the ONE primary deed, carrying the object
          it is the deed for. The merged artifact used to print here as a loose sentence, one line
          above a button in the pinned ACTION row; it rides IN the card now (ONE DEED ONE OBJECT). */}
      {moveCard && <div className="pt-0.5"><ThreadCardView card={moveCard} /></div>}
      {/* …and when no move stands, a merged artifact still says what is on the board. */}
      {!moveCard && mergedArt && (
        <p className="text-[13px] leading-[1.5] text-neutral-800">
          <span className="font-medium">{mergedArt.label}</span>
          {mergedArt.by && <span className="ml-1.5 font-medium text-indigo-500">by {mergedArt.by.split(' ')[0]}</span>}
        </p>
      )}
      {/* The live ask, folded under the position that speaks it — one agenda, one seat. With a
          composed brief the position already names the gap in its own words (the COHERENCE rule),
          so only the rows ride; without one the ask's own sentence comes with them, because
          nothing above it has said what is missing. */}
      {foldedAsk && !composed && foldedAsk.text && (
        <p className="text-[13px] leading-[1.5] text-neutral-800">{foldedAsk.text}</p>
      )}
      {foldedAsk && askCard({ ...foldedAsk, text: '' }, 'folded-ask')}
    </div>
  ) : undefined;

  // ── THE ARTIFACT CARDS ───────────────────────────────────────────────────────────────────────
  // ONE DEED ONE OBJECT: the artifact promoted into the pinned card never renders again below.
  const streamArts = (artifacts ?? []).filter((a) => a.key !== mergedArtKey);
  const visibleDkeys = new Set(visibleTail.map((t) => (t.role === 'system' ? t.dkey : undefined)).filter(Boolean) as string[]);
  const anchoredByKey = new Map<string, NonNullable<typeof artifacts>>();
  for (const a of streamArts) {
    if (a.anchorKey && visibleDkeys.has(a.anchorKey)) {
      anchoredByKey.set(a.anchorKey, [...(anchoredByKey.get(a.anchorKey) ?? []), a]);
    }
  }
  const endArtifacts = streamArts.filter((a) => !(a.anchorKey && visibleDkeys.has(a.anchorKey)));
  const artCard = (art: NonNullable<typeof artifacts>[number]): ThreadCard => (
    // A kind with its own kit card renders AS that card, here in the stream — the card IS the
    // workspace (the stage survives for the deep 20%). Everything else stays the quiet Open row.
    art.node
      ? {
          kind: 'custom', id: `card-${art.key}`,
          // The mounted card wears the one DOM handle the pinned CTA scrolls to (and, for that one
          // beat, the mark that says "this is what I meant"). Presentation only — the card itself
          // is untouched, so every producer's card keeps its own behaviour.
          node: (
            <div
              id={cardDomId(art.key)}
              className={`scroll-mt-8 rounded-2xl transition-shadow duration-300 ${pulseCard === art.key ? 'ring-2 ring-indigo-300 ring-offset-2' : ''}`}
            >{art.node}</div>
          ),
        }
      : { kind: 'deliverable', id: `card-${art.key}`, title: art.label, icon: 'document', openLabel: 'Open →', onOpen: art.onOpen }
  );

  // ── THE RICH TURN BODY, MOUNTED WHOLE ────────────────────────────────────────────────────────
  // Component turns (asks · workflow drafts · the spec card · the approval gate · offered routes)
  // and their refs/files keep the renders the rail already had; the kit seats them as ONE custom
  // card on the speaking bubble.
  const turnExtras = (t: Extract<Turn, { role: 'system' }>): React.ReactNode => {
    const shownRefs = (t.refs ?? []).filter((r) => inRoom || !r.href?.includes(`/item/${id}`));
    const has = !!(t.checklist?.length || t.workflowDraft || t.standingSpec || t.approval || t.collection || t.event || t.change || t.actions?.length || shownRefs.length || t.files?.length);
    if (!has) return null;
    return (
      <div className="min-w-0 space-y-1.5 text-[13px] text-neutral-800 leading-relaxed">
        {/* A coworker's ASK as an inline checklist: each row a concrete thing they need. Attach
            opens the one ingest funnel; answering in the composer is equally valid. NEVER BLOCKING. */}
        {t.checklist && t.checklist.length > 0 && askCard({ ...t, text: '' }, `ask-${t.turnId ?? t.dkey ?? 'x'}`)}
        {/* THE ONE CREATION CARD: a drafted workflow reviews inline; Confirm fires the one door. */}
        {t.workflowDraft && <div className="mt-1.5"><WorkflowDraftCard draft={t.workflowDraft} /></div>}
        {/* THE COLLECTION — the SAME one card for every set of the user's own objects, on every
            surface. A live turn hands over the served spec; a rehydrated one hands over the
            pointer and the host re-reads. "Ask about it" speaks through THIS room's composer
            (clicks are words — the utterance lands as the reader's own turn). */}
        {t.collection && (
          <div className="mt-1.5">
            <CollectionCard
              {...(t.collection.spec ? { spec: t.collection.spec } : {})}
              {...(t.collection.pointer ? { pointer: t.collection.pointer } : {})}
              onAsk={(text) => setComposerPrefill(text)}
            />
          </div>
        )}
        {/* THE EVENT — ONE card for one calendar event, with exactly the verbs its own state
            permits. Every confirm goes through the ONE deeds door; nothing here has fired. */}
        {t.event && (
          <div className="mt-1.5">
            <EventCard
              {...(t.event.spec
                ? { spec: t.event.spec, ...(t.event.pointer ? { pointer: t.event.pointer } : {}) }
                : { pointer: t.event.pointer ?? { eventId: t.event.eventId } })}
            />
          </div>
        )}
        {/* THE CONFIRM CARD — ONE host for a prepared state change (a standing instruction, a
            remembered fact, a run). Apply and Dismiss go through the change's own doors. */}
        {t.change && (
          <div className="mt-1.5">
            <ChangeCard
              {...(t.change.spec
                ? { spec: t.change.spec, ...(t.change.pointer ? { pointer: t.change.pointer } : {}) }
                : { pointer: t.change.pointer ?? { changeId: t.change.changeId } })}
            />
          </div>
        )}
        {/* THE SPEC CARD: the standing-task proposal — explicit fields, ONE Confirm. Saying prepared
            it; only this click creates anything. Confirmed → the card flips in place as the record. */}
        {t.standingSpec && (
          <div className="mt-1.5 rounded-xl border border-neutral-200 px-3.5 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-neutral-800 truncate">{t.standingSpec.name}</span>
              {t.standingSpec.status === 'confirmed' && (
                <span className="flex-shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">✓ standing</span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-neutral-500">{t.standingSpec.deliverable}</p>
            <p className="mt-1 text-[11.5px] text-neutral-400">
              {t.standingSpec.cadenceLabel} · {t.standingSpec.ownerName.split(' ')[0]} owns it{t.standingSpec.firstRun && fmtMonthDay(String(t.standingSpec.firstRun)) ? ` · first run ${fmtMonthDay(String(t.standingSpec.firstRun))}` : ''}
              {/* Studio DEMOTED to the method editor: a deep-dive behind the standing object. */}
              {t.standingSpec.status === 'confirmed' && t.standingSpec.workflowId && (
                <> · <a href={`/studio?workflow=${t.standingSpec.workflowId}`} className="text-neutral-400 underline decoration-neutral-300 hover:text-indigo-600 transition-colors">method</a></>
              )}
            </p>
            {t.standingSpec.status === 'pending' && t.dkey && (
              <button
                onClick={async () => {
                  const dk = t.dkey!;
                  const res = await fetch('/api/tasks/standing', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roomKey, dedupeKey: dk }),
                  }).catch(() => null);
                  const d = res?.ok ? await res.json().catch(() => null) : null;
                  if (d?.ok) {
                    setTurns((prev) => prev.map((x) => (x.role === 'system' && x.dkey === dk && x.standingSpec
                      ? { ...x, standingSpec: { ...x.standingSpec, status: 'confirmed', firstRun: d.firstRun ?? x.standingSpec.firstRun } } : x)));
                  }
                }}
                disabled={busy}
                className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >Confirm — start it</button>
            )}
          </div>
        )}
        {/* THE APPROVAL CARD IS THE ONE HOST (W3-A, Sep 22). This was a hand-drawn gate with its own
            two inline `fetch`es, its own three chip words and a rollback that silently put the
            question back when the run had in fact already moved on. It is now
            components/home/approval-card.tsx — the same card the deep-dive mounts, wearing the one
            gate vocabulary and firing the one resume door. The rail keeps only what it owns: the
            turn's record of what was decided. */}
        {t.approval && (
          <div className="mt-1.5">
            <ApprovalCard
              id={`approval-${t.approval.runId}`}
              spec={{
                runId: t.approval.runId,
                title: t.approval.name,
                ...(t.approval.instruction ? { meta: t.approval.instruction } : {}),
                // The room's compact seat is served a CLIPPED preview string, not the run's bytes —
                // it shows it as the plain excerpt it is and leaves the full object to the gate's
                // own surfaces (no second opinion about what markdown means).
                ...(t.approval.preview ? { preview: { text: t.approval.preview, truncated: false } } : {}),
              }}
              outcome={t.approval.decided ?? null}
              onDecided={(outcome) => {
                const runId = t.approval!.runId;
                setTurns((prev) => prev.map((x) => (x.role === 'system' && x.approval?.runId === runId
                  ? { ...x, approval: { ...x.approval!, decided: outcome === 'rejected' ? 'rejected' as const : 'approved' as const } } : x)));
              }}
            />
          </div>
        )}
        {/* O5: the commit line is a DECISION, not buttons. ≥2 routes → the numbered options idiom
            (the brain's judged route first, "Leave it with me" always last). */}
        {t.actions && t.actions.length >= 2 && (
          <div className="rounded-xl border border-neutral-200 overflow-hidden">
            {t.actions.map((a, j) => (
              <button
                key={j} onClick={() => runAction(a)} disabled={busy}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12.5px] text-neutral-700 hover:bg-indigo-50/60 transition-colors disabled:opacity-50 border-b border-neutral-100"
              >
                <span className="flex-shrink-0 w-5 h-5 rounded-md bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center">{j + 1}</span>
                <span className={j === 0 ? 'font-medium text-neutral-800' : ''}>{a.label}</span>
              </button>
            ))}
            <button
              onClick={() => setTurns((prev) => prev.map((x) => x === t ? { ...x, actions: undefined } : x))} disabled={busy}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12.5px] text-neutral-400 hover:bg-neutral-50 transition-colors"
            >
              <span className="flex-shrink-0 w-5 h-5 rounded-md bg-neutral-100 text-neutral-400 text-[11px] font-semibold flex items-center justify-center">{t.actions.length + 1}</span>
              Leave it with me
            </button>
          </div>
        )}
        {t.actions && t.actions.length === 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => runAction(t.actions![0])} disabled={busy}
              className="rounded-full border border-indigo-200 bg-indigo-50/50 px-2.5 py-1 text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
            >{t.actions[0].label}</button>
          </div>
        )}
        {/* The item ref disambiguates a SHARED deal room; inside the item's OWN room it is
            self-referential noise. A quiet inline LINK, never a pill (the word is the deed). */}
        {shownRefs.length > 0 && (
          <p className="text-[12.5px] text-neutral-500">
            {shownRefs.map((r, j) => (
              r.href
                ? <Link key={j} href={r.href} onClick={(e) => { if (onOpenHref?.(r.href!)) e.preventDefault(); }} className="mr-2 underline decoration-neutral-200 underline-offset-2 hover:text-indigo-500 transition-colors">{r.label}</Link>
                : <span key={j} className="mr-2">{r.label}</span>
            ))}
          </p>
        )}
        {t.files && t.files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {t.files.map((f, j) => (
              <Chip key={j} icon={<DocumentIcon className="w-3 h-3 flex-shrink-0" />} label={f.filename} />
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── THE TIMELINE, DERIVED ────────────────────────────────────────────────────────────────────
  const items: ThreadItem[] = [];

  // ══ W16 · THE ITEM PAGE IS A FEW KIT WIDGETS (law `the-item-page-is-a-few-widgets`) ═════════════
  // An ITEM door is: Clara's ONE sentence · the SOURCE widget · AT MOST ONE action widget chosen by
  // THE MACHINE's single state (components/thread/item-page.ts composeItemPage — one composition for
  // every item kind) · then only the reader's own exchange. No MOVE card, no offer line, no gap line,
  // no folded ask, no engine narration in the stream (it is filed in the drawer's History). A widget
  // is offered only when this page actually MOUNTS its card — a withdrawn target has no card, so it
  // has no widget and no button (the dead "Review reply draft" class is structurally gone).
  const itemPage = inRoom ? null : (() => {
    const byArtifact = (k: ItemArtifactKind) => (artifacts ?? []).find((a) => a.artifactKind === k && !!a.node) ?? null;
    // WHAT THIS PAGE HAS MOUNTED, by artifact kind — the table only ever picks from this.
    const mounted: ItemArtifactsMounted = {};
    for (const a of artifacts ?? []) if (a.artifactKind && a.node) mounted[a.artifactKind] = true;
    if (liftedAsk?.checklist?.length) mounted.ask = true;
    if (decisionIsPrimary) mounted.decision = true;
    if (gate?.node) mounted[gate.kind] = true;
    // W16 · a booked meeting (the machine's `scheduled` over a calendar event) mounts the event itself.
    if (view.machineState?.eventId) mounted.booked_event = true;
    const plan = composeItemPage({
      machine: view.machineState ?? null, gateOpen: !!gate?.node, mounted,
      brief: composed ?? null, who: view.anchor?.who ? spokenName(view.anchor.who) : null,
      ask: view.anchor?.ask ?? null, title: null,
      source: sourceEvent ? 'event' : objectCard ? 'source' : null,
    });
    const own = plan.artifact && !['ask', 'decision', 'gate', 'input_gate', 'booked_event'].includes(plan.artifact) ? byArtifact(plan.artifact) : null;
    return { plan, card: own };
  })();
  if (itemPage) {
    const { plan, card } = itemPage;
    // CLARA — one sentence, the SOURCE widget directly under it (the thing the sentence is about),
    // then THE ONE ACTION WIDGET with its deed inside it (components/thread/item-page.ts itemPageItems).
    const actionNode: React.ReactNode = (plan.artifact === 'gate' || plan.artifact === 'input_gate') && gate?.node ? gate.node
      : plan.artifact === 'booked_event' && view.machineState?.eventId ? <EventCard pointer={{ eventId: view.machineState.eventId }} />
      : plan.artifact === 'ask' && liftedAsk ? askCard({ ...liftedAsk, text: '' }, 'item-ask')
      : plan.artifact === 'decision' && decision ? (
        <DecisionCard spec={decision}
          {...(decision.onChosen ? { onChosen: decision.onChosen } : {})}
          {...(decision.onResolved ? { onResolved: decision.onResolved } : {})}
          {...(decision.onDismiss ? { onDismiss: decision.onDismiss } : {})} />
      ) : card?.node ? (
        <div id={cardDomId(card.key)} className="scroll-mt-8 rounded-2xl">{card.node}</div>
      ) : null;
    items.push(...itemPageItems(plan, {
      seat: { id: seatId, name: seatName, ...(seatLabel ? { roleLabel: seatLabel } : {}) },
      shimmer: showShimmer ? (
        <div className="space-y-1.5 py-0.5" aria-hidden>
          <div className="h-3 w-4/5 rounded bg-neutral-100 animate-pulse" />
        </div>
      ) : null,
      source: sourceEvent ? <div className="pt-0.5">{sourceEvent}</div> : objectCard ? <div className="pt-0.5">{objectCard}</div> : null,
      action: actionNode ? { node: actionNode, by: card?.by ?? null } : null,
    }));
    // THE READER'S OWN EXCHANGE — from their first word on (answers, and what an answer presents).
    itemExchange.forEach((t, i) => {
      const key = `x${i}`;
      if (t.role === 'user') { items.push({ type: 'user_bubble', id: key, text: t.text }); return; }
      const extras = turnExtras(t);
      items.push({
        type: 'actor_bubble', id: key,
        actorId: t.author?.role ?? t.author?.name ?? seatId,
        actorName: t.author?.name ? t.author.name.split(' ')[0] : seatName,
        ...(t.author?.name ? {} : { actorRoleLabel: seatLabel }),
        ...(t.text ? { text: t.text } : {}),
        ...(extras ? { cards: [{ kind: 'custom' as const, id: `${key}-extras`, node: extras }] } : {}),
      });
    });
  }

  // THE OPENING IS A MESSAGE (owner walk, Sep 14: "this can just look like a message, so remove
  // border and the 'pinned' label"). The seat and the behaviour are unchanged — it opens the room,
  // it never folds, it carries the ONE CTA row and the folded ask; only its chrome is gone (the
  // kit's `Pinned` now renders in the actor-bubble grammar), and it no longer labels its own
  // mechanism at the reader.
  if (!itemPage) items.push({
    type: 'pinned', id: 'brief', actorId: seatId, actorName: seatName, actorRoleLabel: seatLabel,
    ...(openingText ? { text: openingText } : {}),
    ...(pinnedNode ? { node: pinnedNode } : {}),
    // (No `actions` here any more — the ONE primary deed is the `proposal` card inside the node.)
  });

  // THE LATE BRIEF ARRIVES AS AN APPEND (W3.5 (a); registry precedence #1: "if composition genuinely
  // cannot land in time, the brief arrives as an appended turn, never a swap"). The opening the
  // reader met stays exactly as painted; the composed words land beneath it as a new message.
  // (W16: an item page speaks ONE sentence — the late brief is the next open's material, never a second bubble.)
  const lateBrief = !itemPage && !composed && view.lateBrief?.text ? view.lateBrief.text : null;
  if (lateBrief) {
    items.push({
      type: 'actor_bubble', id: 'late-brief', actorId: seatId, actorName: seatName,
      actorRoleLabel: seatLabel, text: lateBrief,
    });
  }

  // THE CoS OPENS — the invitation, in the seat's own first-person voice, directly under the
  // position it deliberately does not repeat. Ephemeral: it exists for as long as the reader has
  // said nothing, and `send` writes it into the record the moment they answer.
  if (openerText) {
    items.push({
      type: 'actor_bubble', id: 'opener', actorId: seatId, actorName: seatName,
      actorRoleLabel: seatLabel, text: openerText,
    });
  }

  // (THE REOPEN DELTA'S SEAT IS EMPTY BY LAW — owner, Sep 14. See the retirement note at the
  //  hydrate seam: the marker and the sidebar's hand-raise stand; the spoken line does not.)

  // (THE HISTORY SEAT IS EMPTY BY LAW — owner, Sep 14. The record used to render here, above the
  //  opening, behind an "earlier (N)" handle. It is filed in the ONE drawer now: `historyLines` is
  //  reported to the host, the host mounts RoomHistorySection, and the stream carries only the
  //  present. No fold handle is pushed at either door — a handle that opens nothing is chrome
  //  announcing a mechanism, and there is nothing behind it here any more.)

  // THE LIVING BRIEF'S ASK: the ENGINE's live ask is part of the room's standing position — lifted
  // OUT of the history stream and spoken by the seat, with its ONE CTA row. It dies with its work
  // (the component settles server-side) — never a second copy below.
  // ONE AGENDA PER ROOM (Sep 8): when a composed brief stands, the ask has ALREADY spoken inside
  // the pinned card (`foldedAsk`) — a bubble here would be the second delivery with the second CTA
  // row the owner walked into. This seat is the ask's home only while no composed position exists.
  if (!itemPage && liftedAsk && !foldedAsk) {
    items.push({
      type: 'actor_bubble', id: 'lifted-ask', actorId: seatId, actorName: seatName,
      actorRoleLabel: seatLabel, text: liftedAsk.text,
      cards: [
        // SHOW, WITH THE ASK (clause 2): an ask about an inbox-backed item carries the message it
        // is asking about — the reader is never asked to act on something they must remember.
        ...(askSeatsObject ? [{ kind: 'custom' as const, id: 'lifted-ask-object', node: objectCard }] : []),
        { kind: 'custom' as const, id: 'lifted-ask-card', node: askCard({ ...liftedAsk, text: '' }, 'lifted-ask') },
      ],
    });
  }

  // INLINE COMPONENTS: the judged DECISION renders as a conversation card, SEATED ABOVE the MOVE —
  // on a decide item the choice comes first; the reply's content depends on it.
  if (!itemPage && decision && decision.options.length >= 2) {
    items.push({
      type: 'actor_bubble', id: 'decision', actorId: seatId, actorName: seatName, actorRoleLabel: seatLabel,
      cards: [{
        kind: 'custom', id: 'decision-card',
        node: (
          <DecisionCard
            // Q5 · the object rides INTO the one card — the ask and the thing asked about on the
            // same surface, in the handle grammar (never the document inlined).
            spec={decision}
            // …and with NO prepared object, the SOURCE one (clause 2): the machine pulls the thing
            // being decided — the inbound message — instead of the card telling the reader to ask.
            {...(decisionSeatsObject && !decision.object ? { objectNode: objectCard } : {})}
            {...(decision.onChosen ? { onChosen: decision.onChosen } : {})}
            {...(decision.onResolved ? { onResolved: decision.onResolved } : {})}
            {...(decision.onDismiss ? { onDismiss: decision.onDismiss } : {})}
          />
        ),
      }],
    });
  }

  // THE FRESH TAIL — three grammars, derived STRUCTURALLY from each turn (never styled per call
  // site): user bubble · a coworker's own first-person speech (their face) · the narrator's muted
  // EVENT LINE. A `prep:*` narration FOLDS entirely when its artifact card is on the rail.
  if (!itemPage) visibleTail.forEach((t, i) => {
    const key = `t${i}`;
    if (t.role === 'user') { items.push({ type: 'user_bubble', id: key, text: t.text }); return; }
    // A COMPONENT IS A TURN: the anchor turn IS the card — its moment in the story, its words
    // folded into the label. The card's byline is the face that speaks it.
    if (t.dkey && anchoredByKey.has(t.dkey)) {
      const arts = anchoredByKey.get(t.dkey)!;
      const by = arts.find((a) => a.by)?.by ?? null;
      items.push({
        type: 'actor_bubble', id: key,
        actorId: by ?? seatId, actorName: by ? by.split(' ')[0] : seatName,
        ...(by ? {} : { actorRoleLabel: seatLabel }),
        cards: arts.map(artCard),
      });
      return;
    }
    // ONE PREP CLASS at the render too (Sep 8): `anticipate:` narrations are prep narrations.
    if ((((artifacts?.length ?? 0) > 0) || composed) && t.dkey && /^(prep:|meeting-prep:|anticipate:)/.test(t.dkey)) return;
    // A component turn is never narration — it carries a live affordance, so it speaks with a face.
    const hasComponent = !!(t.checklist?.length || t.actions?.length || t.standingSpec || t.workflowDraft || t.approval || t.collection || t.event || t.change || t.key === 'founding-proposal');
    if (!t.author?.name && !hasComponent) {
      // THE EVENT LINE — the narrator's muted one-liner: system, NO author, NO affordance. Its
      // refs survive as quiet inline words (law 8 — the P2d wall, closed kit-side same day),
      // filtered by the same self-target rule as bubble refs and routed through the ONE
      // navigation door (onOpenHref before router).
      const lineRefs = (t.refs ?? [])
        .filter((r) => r.href && (inRoom || !r.href.includes(`/item/${id}`)))
        .map((r) => ({ label: r.label, onClick: () => go(r.href as string) }));
      items.push({ type: 'event_line', id: key, text: t.text, ...(lineRefs.length ? { refs: lineRefs } : {}) });
      return;
    }
    const extras = turnExtras(t);
    items.push({
      type: 'actor_bubble', id: key,
      actorId: t.author?.role ?? t.author?.name ?? seatId,
      actorName: t.author?.name ? t.author.name.split(' ')[0] : seatName,
      ...(t.author?.name ? {} : { actorRoleLabel: seatLabel }),
      ...(t.text ? { text: t.text } : {}),
      ...(extras ? { cards: [{ kind: 'custom' as const, id: `${key}-extras`, node: extras }] } : {}),
    });
  });

  // Cards without a visible anchor turn — the stream's end (never above later talk).
  if (!itemPage) endArtifacts.forEach((art, i) => {
    items.push({
      type: 'actor_bubble', id: `end-${art.key}-${i}`,
      actorId: art.by ?? seatId, actorName: art.by ? art.by.split(' ')[0] : seatName,
      ...(art.by ? {} : { actorRoleLabel: seatLabel }),
      cards: [artCard(art)],
    });
  });

  // HEAVY WORK IN FLIGHT — the avatar carries the state; one quiet line, no spinner in the stream.
  if (busy) items.push({ type: 'working_line', id: 'working', actorId: seatId, actorName: seatName, line: 'Working on it…' });

  // THE ONE COMPOSER (the rail fold): the SAME WorkerMentionInput as the Home floor and the worker
  // surfaces — @ picks Coworkers/Tasks/Documents, attach feeds the room's INGEST FUNNEL, Enter
  // sends through the one steer core. It takes the kit's composer SEAT whole; the geometry is the
  // kit's, what sits in it is the room's.
  //
  // THE CHIPS ARE RETIRED FROM THE ROOM (owner walk, Sep 14: "I think I had told you to remove the
  // chips here too" — the SAME call the calm Home took on Sep 13). A room already states ONE thing
  // in the pinned brief with ONE CTA; a menu of openers above the composer was a second agenda in
  // the reader's line of sight, and the one it offered (confirm a meeting) had nothing to
  // do with the work the brief was asking for. The offers' machinery is NOT deleted — the brief
  // still composes and serves them (their own dedupe law, T10.1, keeps standing) for consumers
  // that want them; what dies is the chip ROW in the room, and the composer is the only door.
  const composerBlock = (
    <div className="flex w-full flex-col gap-2.5">
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <WorkerMentionInput
          frameless
          onSubmit={(t, mentions) => {
            const cw = mentions.find((m) => m.type === 'coworker');
            const hints = mentions.filter((m) => m.type !== 'coworker').map((m) => m.label);
            let out = cw ? `${cw.label.split(' ')[0]}, ${t}` : t;
            if (hints.length) out += ` (about: ${hints.join('; ')})`;
            void send(out);
          }}
          disabled={busy}
          placeholder="Ask, correct, or hand off…"
          prefill={composerPrefill}
          onPrefillConsumed={() => setComposerPrefill(null)}
          onAttach={(files) => { void (async () => { for (const f of files) await attach(f); })(); }}
        />
      </div>
    </div>
  );

  return (
    <div ref={scrollRef} className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden min-h-0">
      {/* ONE CHROME BAND PER ROOM (owner walk, Sep 10: "confusing to have 2 elements… like a header
          and then the conversation" · "this header part seems redundant?").
          This row used to carry the room's name a second time, one line under the room's OWN 52px
          header — inside the project room it was already suppressed for exactly that reason, and on
          the item door it was the same duplication with a weaker word ("About this"). It is gone at
          BOTH doors: the ONE header carries the name, the faces, the filing chip AND the project
          door (ItemRoomFrame's `room.project`), so nothing this band held is lost — the law is the
          band count, never the kind. The rail is the conversation and nothing else. */}

      {/* The hidden file input stays — the checklist asks' attach buttons share it. */}
      <input ref={fileRef} type="file" className="hidden"
        accept=".pdf,.docx,.txt,.csv,.xlsx,.pptx"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); }} />

      {/* THE ONE THREAD COMPONENT — a project thread inside the room, a loose room's thread on the
          deep-dive. The kind is CONFIGURATION (placeholder + defaults), never a fork; the embedded
          variant is the same data in a narrower host. */}
      <ThreadShell
        kind={inRoom ? 'project' : 'item'}
        className="min-h-0 !bg-white"
        items={items}
        composerNode={composerBlock}
      />
    </div>
  );
}
