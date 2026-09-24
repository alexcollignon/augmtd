'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRIAGE DECK (docs/attention-plan.md PART III — law Q9, RESHAPED BY Q9v2 after the owner's
// Sep-18 afternoon walk: "hard to follow, empty real estate; this [reference] seemed more simple").
//
// Still a MODE OVER THE SERVED WAITING BAND, never a new derivation: the same rows the ledger lists,
// in the same order the server put them in, rendered one at a time instead of sixty at once.
// Nothing here fetches a list, ranks a list, or filters a list. It receives one.
//
// ── THE THREE CORRECTIONS Q9v2 MAKES ────────────────────────────────────────────────────────────
// 1 · THE FRAME OWNS THE VERBS, THE CARD OWNS THE CONTENT. Two large pills (← Dismiss · Done →),
//     two quiet companions beside them (↑ Keep · ⏎ Open), a demoted Later chip and an Undo pill
//     that exists only when there is something to undo. NOTHING verb-shaped renders inside the
//     card — `TriageCard` below holds no deed, no door and no verb table at all.
//     ⚠️ THE VERBS SIT BELOW THE CARD (owner, Sep 21 — "CTA buttons should be below?"). The frame
//     still owns them; only their seat moved. They must not BOUNCE as cards change height.
//     W15.3 · ONE DECISION PER SCREEN (owner walk, Sep 24 — "I don't want the user to scroll for
//     the buttons"): the Sep-21 floor let a tall card, or evidence landing late, push them down.
//     Every card is now THE ONE DECISION CARD (components/triage/decision-frame.tsx): one fixed
//     height that fits the viewport, the evidence scrolling INSIDE it, and the verbs in a pinned
//     fixed-height slot beneath. Nothing is clipped away — it scrolls within the card.
// 2 · TRUE FOCUS. The card is ~640px, centred, and the surrounding prose collapses (the lens owns
//     that half — this file owns the one header line: Close · the band · what is left · view as
//     list).
// 3 · THE CARD IS THE THING ITSELF. Who it is from, what kind of thing it is, and then THE ACTUAL
//     CONTENT: for a mail row the thread's tail, lazily read through THE EXISTING THREAD DOOR
//     (`GET /api/inbox/<id>/thread`), clipped by THE ONE CLIPPER, cached for the session and
//     PREFETCHED one card ahead; for anything else the founding context it was already handed.
//     THE REPLY SLOT IS PARKED (owner call, Sep 21 — the composer is off the cards for now). Both
//     of its states are gone: the composer that spoke to the assistant about the item, and the
//     read-only preview of a stored draft under its own standing line. The PREPARED
//     FACT survives where it always belonged — as the card's own contextual chip ("draft ready"),
//     which is information rather than a composer. Reinstating it is one mount at the card's foot.
//
// ── THE INVARIANT, UNCHANGED ────────────────────────────────────────────────────────────────────
// NOTHING EVER FLOWS BACK TO THE TOP BY ITSELF, and nothing in this file can send anything: there
// is no composer and no draft body in the deck at all, and the only route to a commit is ⏎ OPEN —
// the item's own room, its own door, the person's own keystroke.
//
// ── THE VERBS, AND WHOSE DOOR EACH ONE IS ───────────────────────────────────────────────────────
//   ← DISMISS  the EXISTING dismiss door (`useRowActions`' own `drop` — /api/inbox/<id>/dismiss for
//              mail, PATCH /api/commitments/<id> for a commitment), then THE POSTURE TAIL (A8),
//              offered ONLY where `postureFromDeed` says a standing version is keepable. `↓ NEVER`
//              is retired as an arrow: an "always?" is a property of a dismissal, not a direction.
//   → DONE     the EXISTING undoable resolve door. The outcome fact writes itself at THE ONE
//              RESOLVER; this file adds no writer.
//   ↑ KEEP     writes NOTHING. The row stays in Waiting, undated; the deck advances. (Space too.)
//   ⏎ OPEN     the item's room — where every commit door already lives.
//   L LATER    POST /api/items/later → `parkItem` → THE REVISIT PARK. A when is REQUIRED; the whens
//              are composed by lib/triage/words.ts from a SERVED day.
// Z undoes the last resolving verb through the SAME restore the toast uses. Esc closes.
//
// ── THE VOCABULARY IS THE HOUSE'S ───────────────────────────────────────────────────────────────
// One white card on the calm ground, 13px quiet type, urgency as a WORD and never a colour. The
// motion is a short slide+fade in the verdict's own direction — `motion-reduce:` guarded end to
// end, because a surface you hold a key down on is exactly the one that must not move for a reader
// who asked it not to.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import type { DoItem } from '@/lib/home/agenda';
// THE ROW KIT — the deck's OWN doors, not a second set. Every resolving verb in this file is one of
// these; there is no fetch to a mutation endpoint anywhere below.
import { useRowActions } from '@/components/work/work-row';
import { showUndoToast } from '@/lib/activity/undo-toast';
import { restoreEntity } from '@/lib/activity/restore';
// THE POSTURE TAIL'S OWN LAW, pure and client-safe: it decides whether "always?" may be offered.
import { postureFromDeed } from '@/lib/postures/from-deed';
import type { HeldClassId } from '@/lib/home/attention';
// THE DECK'S PURE WORDS — the receipt, the whens, the verb table, the keyboard map, the tail clip.
import {
  TRIAGE_KEYS, TRIAGE_VERBS, TRIAGE_EXIT_LABEL, TRIAGE_HINTS, TRIAGE_UNDO_LABEL,
  TRIAGE_SOURCE_WORD, TRIAGE_THREADED, TRIAGE_VIEW_ALL,
  laterOptions, triageReceipt, triageEnd, initialOf, verbsOfRank, readyWordOf,
  type TriageTally, type TriageVerb, type TriageMessage,
} from '@/lib/triage/words';
// W16.3 · the card's why-line is printed as a sentence (its words' one home: lib/home/held-words.ts).
import { sentenceCase } from '@/lib/home/held-words';
// THE ONE THREAD-DOOR READER (lib/inbox/thread-door.ts) — shared with the room's object card, so
// the tail a deck warms is the tail a room shows, read once.
import { loadThreadTail, peekThreadDoor } from '@/lib/inbox/thread-door';
// THE SOURCE OF A HANDED COMMITMENT (W3.6 → W16.4) — one batched read for the whole handed set,
// through the one source reader; the card mounts it with THE ITEM PAGE'S OWN mounts.
import { loadDeckContext, peekDeckContext } from '@/lib/triage/deck-context-door';
import type { DeckContext } from '@/lib/triage/deck-context';
import { SourceObjectMount, EmailSourceMount, MeetingSourceMount } from '@/components/room/source-object';
// W15.1 · THE ONE THREAD COMPONENT — the evidence renders through the kit's one source card.
import { SourceObjectCard } from '@/components/thread/source-object-card';
// W15.3 · THE ONE DECISION CARD — one fixed geometry for every kind; the evidence scrolls inside it
// and the verbs sit in a pinned slot outside it.
import {
  DecisionCardFrame, DecisionCardSkeleton, DecisionEvidenceSkeleton, DecisionActionsSlot,
} from '@/components/triage/decision-frame';
// W11.3 · THE MARKER NEVER RENDERS — every excerpt on this card renders through the kit's source
// card (W15.1), whose one render path applies the UI text floor (displayText).
// THE HONEST COUNTER — a stack still being extended may not state a total (lib/triage/queue.ts).
import { queueCount, mergeQueue, settleQueue } from '@/lib/triage/queue';

// ── WHAT A CARD IS MADE OF — all of it SERVED (see HeldBandRow in lib/home/attention.ts). ────────
export type TriageRow = {
  id: string;
  /** The row's own kind, so its verbs reach ITS door (mail vs commitment) — the ledger's own map. */
  item: DoItem;
  /** Counterparty · title · the ledger's why-held clause · the message's own first words. */
  who: string | null;
  title: string;
  why: string;
  excerpt: string | null;
  dueDate: string | null;
  /** W16.3 · the prepared kind the ITEM PAGE would mount as its one widget (components/thread/
   *  item-page.ts receiptKindOfItem) — worded by `readyWordOf`, never mounted here. Null → no pill. */
  prepared: string | null;
  /** Legacy word slot — no longer printed (the pill is worded from `prepared` by one table). */
  preparedWord?: string | null;
  /** The held class — the subject of a posture, when one is keepable. */
  cls: HeldClassId | null;
};

type Decided = { row: TriageRow; verb: TriageVerb; undoable: boolean };

/** THE CARD AREA (W15.3 — supersedes Sep 21's min-height floor). The floor let a tall card push
 *  the verbs down, and let evidence arriving late push them down again mid-read (owner walk, Sep 24:
 *  "I don't want the user to scroll for the buttons"). The card now has ONE fixed height
 *  (`DECISION_CARD_H`, components/triage/decision-frame.tsx) and scrolls inside, so this block is
 *  only the stack's own padding for its shoulders — it never grows. */
const CARD_AREA = 'flex flex-shrink-0 flex-col pb-4';

const CARD_EXIT: Record<TriageVerb, string> = {
  done: 'translate-x-10', dismiss: '-translate-x-10', keep: '-translate-y-8', later: '-translate-x-10', open: '',
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREAD TAIL — READ ONCE, KEPT FOR THE SESSION (Q9v2 · 3)
// The card's substance comes from the door that already serves it. It is read LAZILY (only for the
// card in hand), CACHED per item, and PREFETCHED one card ahead so the next card is already
// substantive when it arrives. An in-flight read is shared rather than repeated. A failure is
// silence, never an error card: the card still says who, what kind, and why it is held.
//
// ⚠️ THE LOADER LEFT THIS FILE (Sep 19, THE OPENING CONTRACT clause 1): the same read now serves a
// decision's object, a room's opening and an ask, so it lives in `lib/inbox/thread-door.ts` and
// this deck is one of its callers. Two caches of one door is two answers to one question.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const loadTail = (itemId: string): Promise<TriageMessage[]> => loadThreadTail(itemId);

// ⚠️ THE DRAFT READ IS PARKED WITH THE SLOT (owner call, Sep 21). The deck no longer opens a stored
// draft's body at all — the prepared fact reaches the reader as the card's own chip, and the words
// live one ⏎ away in the room, which is also the only place they can be sent.

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FRAME'S PILLS. The two deeds that clear are large and plain-worded; the two companions are
// quiet beside them; Later is a chip that opens its whens; Undo appears only when there is
// something to undo. Every one of them reads its label, key and rank from THE ONE TABLE.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const verbOf = (verb: TriageVerb): (typeof TRIAGE_VERBS)[number] =>
  TRIAGE_VERBS.find((v) => v.verb === verb)!;

function PrimaryPill({ v, busy, onClick }: {
  v: (typeof TRIAGE_VERBS)[number]; busy: boolean; onClick: () => void;
}) {
  const leading = v.key === '←';
  return (
    <button type="button" disabled={busy} title={v.hint} aria-label={`${v.label} (${v.key})`}
      onClick={onClick}
      className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-5 text-[14px] font-medium text-neutral-600 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-neutral-300 hover:text-neutral-900 disabled:opacity-50">
      {leading && <span aria-hidden className="text-[13px] text-neutral-300">{v.key}</span>}
      <span>{v.label}</span>
      {!leading && <span aria-hidden className="text-[13px] text-neutral-300">{v.key}</span>}
    </button>
  );
}

function QuietPill({ v, busy, onClick }: {
  v: (typeof TRIAGE_VERBS)[number]; busy: boolean; onClick: () => void;
}) {
  return (
    <button type="button" disabled={busy} title={v.hint} aria-label={`${v.label} (${v.key})`}
      onClick={onClick}
      className="flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-700 disabled:opacity-50">
      <span aria-hidden className="text-[11px] text-neutral-300">{v.key}</span>
      <span>{v.label}</span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── THE CARD ────────────────────────────────────────────────────────────────────────────────────
// PURE CONTENT. It renders WHO, WHAT KIND, the thing itself, and the reply slot — and it holds no
// verb, no deed, no door and no keyboard. The frame above it owns all of those (Q9v2 · 1), which is
// why this component imports neither the row kit nor the verb table.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function TriageCard({ row }: { row: TriageRow }) {
  const sourceWord = TRIAGE_SOURCE_WORD[row.item.source] ?? null;
  // THE PROJECT REFERENCE — served (tracked-only), already filtered so it never repeats the title.
  const project = (row.item.initiative ?? '').trim() || null;
  // THE WHY-HELD CLAUSE — the ledger's own served sentence, and nothing else. W8.3: the judge's
  // reason once rode here ("The stated deadline (2026-08-07) passed 47 days ago…") — the brain talking
  // to itself on screen (THE NO-INTERNAL-TEXT LAW). The deck context no longer carries it at all.
  // W16.3 · THE WHY IS IN THE READER'S WORDS ("Waiting for you", "Due Sep 13", "Sam asked you on
  // Sep 22", "Looks done — confirm") — composed by the one home (lib/home/held-words.ts rowWhyOf) and
  // printed as a sentence here; never the machinery's words.
  const whyLine = sentenceCase(row.why);
  // W16.3 · THE PILL IS THE ITEM PAGE'S WIDGET: `row.prepared` is the kind the item page would mount
  // (components/thread/item-page.ts receiptKindOfItem over the machine's state + the one reader's live
  // kinds), worded by ONE table. A withdrawn draft has no kind here, so the card says nothing.
  const chip = readyWordOf(row.prepared);

  // W15.3 · THE ONE DECISION CARD — every kind of row gets the same fixed-height frame: the head is
  // bounded (its lines clamp), the evidence scrolls INSIDE the card, and the verbs sit outside it.
  return (
    <DecisionCardFrame head={
      <>
        {/* ── TOP · WHO, WHAT KIND, WHEN ──────────────────────────────────────────────────────────
            An initial-avatar, the counterparty, the row's own kind, and the stated date at the edge
            with the contextual chip. Every one of them is ABSENT when the row does not have it — a
            labelled empty space is worse than a shorter card. */}
        <div className="flex items-center gap-2.5 px-5 pt-4">
          <span aria-hidden className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[12px] font-medium text-neutral-500">
            {/* THE AVATAR IS THE WHO'S — never a letter of the title; no who → the neutral glyph. */}
            {initialOf(row.who)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            {row.who && <span className="truncate text-[13px] font-medium text-neutral-800">{row.who}</span>}
            <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              {[sourceWord, project].filter(Boolean).map((t, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>·</span>}
                  <span className={t === project ? 'truncate' : undefined}>{t}</span>
                </span>
              ))}
            </span>
          </div>
          {chip && (
            <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-500">{chip}</span>
          )}
        </div>

        <p className="mt-2.5 line-clamp-2 px-5 text-[15px] font-medium leading-snug text-neutral-900">{row.title}</p>
        {/* THE WHY-HELD CLAUSE — the ledger's own served sentence, not a second account of it. */}
        {whyLine && <p className="mt-1 line-clamp-2 px-5 text-[12px] text-neutral-400">{whyLine}</p>}
        <div className="h-3" aria-hidden />
      </>
    }>
      {/* ── MIDDLE · THE THING ITSELF — THE EVIDENCE MOUNT (W15.3 → W15.1). ONE line, on purpose:
          the compact thread component (components/thread/**) replaces this mount when it lands. The
          frame around it already scrolls, so no renderer mounted here can move the verbs. */}
      <TriageEvidence row={row} />
    </DecisionCardFrame>
  );
}

// ── THE EVIDENCE — THE ITEM PAGE'S OWN SOURCE WIDGET (W15.3 frame · W16.4 one rule, every kind). ──
// Owner walk, Sep 24: a commitment's card showed its thread's NEWEST message ("+97 earlier") while
// its page showed the message the promise came from. The card now mounts exactly what the item page
// mounts, from the same reader — never a second derivation:
//   · an email item      → SourceObjectMount over the item's own thread door (the page's object card);
//   · a commitment       → EmailSourceMount over its OWN source message (lib/commitments/source.ts
//                          emailSourceOf, served batched by the deck-context door) + its quote
//                          (W15.4); the rest of the conversation is its one door, "Open thread";
//   · a meeting-born one → MeetingSourceMount over its meeting (meetingSourceOf).
// While a read is in flight the card shows the served first words, else the evidence skeleton INSIDE
// the scroll region — the card's own height never changes when the read lands. Pure content: no
// verb, no deed, no keyboard (the one door is navigation, never a deed).
function TriageEvidence({ row }: { row: TriageRow }) {
  const router = useRouter();
  const threaded = TRIAGE_THREADED.includes(row.item.source);
  const [tailRead, setTailRead] = useState<boolean>(() => !!peekThreadDoor(row.id));
  const [hasTail, setHasTail] = useState<boolean>(() => (peekThreadDoor(row.id)?.tail.length ?? 0) > 0);

  // LAZY, ON THE CARD IN HAND. The door's cache makes a revisit free (and the mount below reads the
  // same cache); a stale component that resolves after the reader has moved on writes to nothing.
  useEffect(() => {
    if (!threaded) { setHasTail(false); return; }
    let live = true;
    void loadTail(row.id).then((t) => { if (live) { setHasTail(t.length > 0); setTailRead(true); } }, () => { if (live) setTailRead(true); });
    return () => { live = false; };
  }, [row.id, threaded]);

  // A HANDED COMMITMENT'S SOURCE comes through the deck-context door (coalesced across the whole
  // handed set) — the item page's own source facts, read by the one source reader.
  const founded = row.item.source === 'commitment';
  const [ctx, setCtx] = useState<DeckContext | null>(() => (founded ? peekDeckContext(row.id) : null));
  const [ctxRead, setCtxRead] = useState<boolean>(() => !founded || !!peekDeckContext(row.id));
  useEffect(() => {
    if (!founded) { setCtx(null); return; }
    let live = true;
    void loadDeckContext(row.id).then((c) => { if (live) { setCtx(c); setCtxRead(true); } }, () => { if (live) setCtxRead(true); });
    return () => { live = false; };
  }, [row.id, founded]);

  // STILL READING, WITH NOTHING SERVED TO SHOW — the skeleton holds the place inside the frame.
  const reading = (threaded && !tailRead && !row.excerpt) || (founded && !ctxRead && !row.excerpt);
  if (reading) return <DecisionEvidenceSkeleton />;

  return (
    <div className="flex flex-col gap-3 px-5">
      {/* W15.1 · ONE THREAD COMPONENT — every lane is the kit's one source card, mounted through the
          SAME mount the item page uses (components/room/source-object.tsx); no deck markup. */}
      {threaded && hasTail ? (
        <SourceObjectMount itemId={row.id} onOpenThread={() => router.push(row.item.href)} />
      ) : row.excerpt ? (
        <SourceObjectCard card={{ kind: 'source', id: `triage-x-${row.id}`, source: 'email', excerpt: row.excerpt }} />
      ) : founded && ctx ? (
        ctx.email ? (
          <EmailSourceMount source={ctx.email} quote={ctx.quote}
            // THE ONE DOOR — the rest of the conversation lives on the thread's own item.
            onOpen={ctx.inboxItemId ? () => router.push(`/item/${ctx.inboxItemId}?kind=email`) : undefined} />
        ) : ctx.meeting ? (
          // THE ONE NOTE ADDRESS: /meetings/<calendarEventId ?? transcriptId> — served as `addressId`.
          <MeetingSourceMount meeting={ctx.meeting} onOpen={() => router.push(`/meetings/${ctx.meeting!.addressId}`)} />
        ) : null
      ) : null}
      {/* ── BOTTOM · NOTHING (Q9v2 · 3, AMENDED Sep 21) — the reply slot is PARKED by owner call: no
          composer, and no read-only draft body. The prepared fact is the chip in the head; the
          words are one ⏎ away in the room, the only surface that can send them. */}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REPLY SLOT IS GONE (owner call, Sep 21 — the "ask or tell me about this" line comes off the
// cards for now). It held two states and both are retired from this surface: the composer that
// spoke to the assistant about the item through the item's own conversation door, and the
// read-only preview of a stored draft. Neither is lost as a FACT — the card's chip still says a
// draft stands, and the room (⏎ Open) still holds the words and the only door that can send them.
// REINSTATING IT IS ONE MOUNT at the card's foot; the item-kind map that door takes is parked in
// lib/triage/words.ts beside the verbs, so a card can never post to the wrong room.
//
// THE DECK THEREFORE HOLDS NO COMPOSER AT ALL, which makes the "no send-capable component in this
// surface" law strictly stronger than it was: there is now no text input on a card either.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATION — one row's frame. It owns the doors, the keyboard and the pills; the card owns the
// content. The pills sit BELOW the stack (owner, Sep 21) and they do not move when the card does:
// the card area holds a floor and only the card itself wears the exit class.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function TriageStation({ row, today, canUndo, onUndo, exiting, under, onDecided, onCount }: {
  row: TriageRow;
  /** The served day the whens are composed from — this component owns no clock. */
  today: string;
  canUndo: boolean;
  onUndo: () => void;
  /** The verdict the card is leaving on — the ONLY thing that moves. The pill bar beneath it stays. */
  exiting: TriageVerb | null;
  /** Whether anything is under this card (the second shoulder). */
  under: boolean;
  onDecided: (d: Decided) => void;
  onCount: (verb: TriageVerb, postureTaught?: boolean) => void;
}) {
  const [laterOpen, setLaterOpen] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [postureNote, setPostureNote] = useState<string | null>(null);
  const [pendingPosture, setPendingPosture] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busyLater, setBusyLater] = useState(false);

  // THE EXISTING DOORS. `done` and `drop` are the very calls the deck's rows and the ledger's rows
  // make — same endpoints, same optimistic exit, same "…· Undo" toast through /api/restore.
  const undo = (entityType: 'inbox_item' | 'commitment') => (message: string, entityId: string) =>
    showUndoToast({ message, entityType, entityId, onUndo: () => { /* the deck has moved on; the ledger re-reads on exit */ } });
  const { busy, done, drop, open: openRoom, prefetch: warmRoom } = useRowActions(row.item, {
    onUndoInbox: undo('inbox_item'), onUndoCommitment: undo('commitment'),
  });
  // W17 · THE CARD IN HAND IS THE NEXT OPEN: ⏎ Open is one key away, so the room behind this card
  // warms the moment the card stands — through the row kit's one warm path (the polite, zero-AI
  // view warm + the route prefetch; lib/room/warm-client). One card, never the stack.
  useEffect(() => { warmRoom(); }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCommit = row.item.source === 'commitment';

  // THE POSTURE TAIL'S ELIGIBILITY, decided by the postures module — never by a list in this file.
  // A dismissal is archive-shaped, so the standing version of it is the archive verb and no other.
  const offer = useMemo(
    () => (row.cls ? postureFromDeed({ verb: 'archive', classKey: row.cls }) : ({ ok: false } as const)),
    [row.cls],
  );

  // ONE VERDICT PER CARD. The dismissal's tail holds the card on screen after the deed has already
  // fired, so without this a second keystroke into that beat would fire a second deed on a settled
  // row.
  const settled = useRef(false);

  const fire = useCallback((verb: TriageVerb, undoable: boolean) => {
    settled.current = true;
    onCount(verb);
    onDecided({ row, verb, undoable });
  }, [onCount, onDecided, row]);

  // ── → DONE ────────────────────────────────────────────────────────────────────────────────────
  const doDone = useCallback(() => {
    if (busy || settled.current) return;
    done();
    fire('done', true);
  }, [busy, done, fire]);

  // ── ← DISMISS — the archive, then the offer (which the frame holds one beat so the tail can be
  //    answered before the stack advances). Where no posture is keepable there is no beat at all. ─
  const doDismiss = useCallback(() => {
    if (busy || settled.current) return;
    settled.current = true;
    drop();
    onCount('dismiss');
    if (offer.ok) { setPendingPosture(true); return; }
    onDecided({ row, verb: 'dismiss', undoable: true });
  }, [busy, drop, offer.ok, onCount, onDecided, row]);

  const keepDoingThis = useCallback(async () => {
    try {
      const res = await fetch('/api/postures/from-item', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: row.id }),
      });
      const json = await res.json();
      // THE SHOW-BACK IS THE ENGINE'S OWN READING of the rule it wrote — never the sentence we hoped
      // for; a refusal is shown as itself.
      if (json?.ok) { onCount('dismiss', true); setPostureNote(`Kept — ${String(json.understood ?? json.sentence ?? '').trim()}`); }
      else setPostureNote(String(json?.reason ?? 'That could not be kept just now.'));
    } catch { setPostureNote('That could not be kept just now.'); }
    setTimeout(() => onDecided({ row, verb: 'dismiss', undoable: true }), 900);
  }, [onCount, onDecided, row]);

  // ── L · LATER — a when is REQUIRED; the park is the revisit record. ────────────────────────────
  const park = useCallback(async (after: string) => {
    if (busyLater || settled.current) return;
    setBusyLater(true);
    try {
      const res = await fetch('/api/items/later', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: isCommit ? 'commitment' : 'inbox', id: row.id, after }),
      });
      const json = await res.json();
      if (!json?.ok) { setNote(String(json?.reason ?? 'that could not be set aside')); setBusyLater(false); return; }
      setLaterOpen(false);
      fire('later', false); // a park is reversed by parking again, not by /api/restore
    } catch {
      setNote('that could not be set aside');
      setBusyLater(false);
    }
  }, [busyLater, fire, isCommit, row.id]);

  // ── ↑ KEEP — the explicit form of a skip. It WRITES NOTHING: the row stays in Waiting, undated,
  //    and the deck moves on. Nothing about it is restore-shaped, so Z steps back rather than
  //    claiming a reversal. ───────────────────────────────────────────────────────────────────────
  const doKeep = useCallback(() => {
    if (settled.current) return;
    fire('keep', false);
  }, [fire]);

  // ── THE KEYBOARD, read from THE ONE TABLE. Every binding in Q9v2's row, and no binding that is
  //    not in it. Typing inside the frame's own fields (the L date) never steers the deck. ────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const verb = TRIAGE_KEYS[e.key];
      if (!verb || verb === 'undo' || verb === 'exit') return; // the host owns undo and the way out
      e.preventDefault();
      if (verb === 'done') doDone();
      else if (verb === 'dismiss') doDismiss();
      else if (verb === 'keep') doKeep();
      else if (verb === 'later') setLaterOpen((v) => !v);
      else if (verb === 'open') openRoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doDismiss, doDone, doKeep, openRoom]);

  const whens = laterOptions(today);
  const primary = verbsOfRank('primary');

  return (
    <div className="flex flex-col gap-3">
      {/* ══ THE STACK, PEEKING — FIRST, because the thing being judged comes before the judgment
          (owner, Sep 21: "CTA buttons should be below?"). Two hairline shoulders behind the card
          say how much is under it without rendering a second row of content, and the wrapper's
          bottom padding keeps them readable as a STACK now that the verbs sit underneath.
          Only THIS block moves on a verdict; the pill bar below it never does.

          THE FIXED HEIGHT (W15.3) is what keeps the pills from bouncing: every card — short, long,
          or still reading its evidence — is the same box (`DECISION_CARD_H`), and whatever is taller
          than the box scrolls INSIDE it. The two big targets sit in one place for the whole session.
          ════════════════════════════════════════════════════════════════════════════════════════ */}
      <div className={CARD_AREA}>
        <div className={`relative transition-all duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
          exiting ? `opacity-0 ${CARD_EXIT[exiting]}` : 'opacity-100'
        }`}>
          <div aria-hidden className="pointer-events-none absolute inset-x-3 -bottom-1.5 h-3 rounded-b-2xl border border-t-0 border-neutral-200/70 bg-white" />
          {under && (
            <div aria-hidden className="pointer-events-none absolute inset-x-6 -bottom-3 h-3 rounded-b-2xl border border-t-0 border-neutral-200/50 bg-white" />
          )}
          <div className="relative">
            <TriageCard row={row} />
          </div>
        </div>
      </div>

      {/* ══ THE PILL BAR — BELOW THE CARD, and still the FRAME'S (Q9v2 · 1 — only the seat moved).
          The two deeds that clear are the big pair; Keep and Open are quiet beneath them; Later is
          a chip; Undo exists only when there is something to undo. Nothing verb-shaped renders
          inside the card above. W15.3: the bar is PINNED — a fixed-height slot outside the card's
          scroll region; the whens, the posture offer and a refusal open inside it. ══════════════ */}
      <DecisionActionsSlot>
        <div className="flex items-stretch gap-2">
          {primary.map((v) => (
            <PrimaryPill key={v.verb} v={v} busy={busy}
              onClick={v.verb === 'done' ? doDone : doDismiss} />
          ))}
        </div>
        <div className="flex flex-nowrap items-center gap-1">
          <QuietPill v={verbOf('keep')} busy={busy} onClick={doKeep} />
          <QuietPill v={verbOf('open')} busy={busy} onClick={openRoom} />
          <QuietPill v={verbOf('later')} busy={busyLater} onClick={() => setLaterOpen((o) => !o)} />
          {canUndo && (
            <button type="button" onClick={onUndo} title="undo the last one (Z)"
              className="flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-700">
              <span aria-hidden className="text-[11px] text-neutral-300">Z</span>
              <span>{TRIAGE_UNDO_LABEL}</span>
            </button>
          )}
          <span className="hidden truncate sm:inline ml-auto pl-2 text-[11px] text-neutral-300">{TRIAGE_HINTS}</span>
        </div>

        {/* L'S WHENS. Two keystroke-cheap days and one real date; every one of them IS a date. */}
        {laterOpen && (
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
            <span className="flex-shrink-0 text-[12px] text-neutral-400">Bring it back</span>
            {whens.map((w) => (
              <button key={w.id} disabled={busyLater} onClick={() => void park(w.after)}
                className="rounded-lg border border-neutral-200 px-2 py-1 text-[12px] text-neutral-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50">
                {w.label}
              </button>
            ))}
            <input type="date" value={customDate} min={today}
              onChange={(e) => setCustomDate(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && customDate) void park(customDate); }}
              className="rounded-lg border border-neutral-200 px-2 py-1 text-[12px] text-neutral-600 outline-none focus:border-indigo-300" />
            {customDate && (
              <button disabled={busyLater} onClick={() => void park(customDate)}
                className="text-[12px] font-medium text-indigo-600 disabled:opacity-50">Set</button>
            )}
          </div>
        )}

        {/* ← DISMISS'S TAIL — "always?", offered ONLY where the postures module says it is keepable. */}
        {pendingPosture && offer.ok && !postureNote && (
          <div className="flex flex-nowrap items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500" title={offer.offer.ask}>{offer.offer.ask}</span>
            <button onClick={() => void keepDoingThis()} className="text-[12px] font-medium text-indigo-600">Always</button>
            <button onClick={() => onDecided({ row, verb: 'dismiss', undoable: true })}
              className="text-[12px] text-neutral-400 hover:text-neutral-600">Just this one</button>
          </div>
        )}
        {postureNote && <p className="truncate text-[12px] text-neutral-500" title={postureNote}>{postureNote}</p>}
        {note && <p className="truncate text-[12px] text-rose-600">{note}</p>}
      </DecisionActionsSlot>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK — the stack, the transition, the tally, the receipt.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function TriageDeck({ rows, today, complete = true, onExit, onRefresh, onViewAsList }: {
  /** THE SERVED BAND, in the SERVER'S OWN ORDER. This component never sorts, ranks or filters it.
   *  It may GROW between renders (the host extends the stack in place when the full account lands);
   *  growth is append-only by the merge's own law, so the cursor never points at a different card. */
  rows: TriageRow[];
  today: string;
  /** Whether the stack is the WHOLE waiting band yet. While false the deck states what it has and
   *  says the rest is still being counted — it never claims a total it was not handed. */
  complete?: boolean;
  /** Esc / the end of the stack — the host restores the ledger and shows the receipt. */
  onExit: (receipt: string) => void;
  /** A resolving verb changed the account; the ledger re-reads when the deck is done with it. */
  onRefresh?: () => void;
  /** THE ONE HEADER LINE owns the shape toggle too (Q9v2 · 2), so focus mode has exactly one row of
   *  chrome above the stack rather than the page's title, its intro and a band header. */
  onViewAsList?: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [exiting, setExiting] = useState<TriageVerb | null>(null);
  const [tally, setTally] = useState<TriageTally>({ done: 0, dismiss: 0, later: 0, postures: 0, elapsedMs: 0 });
  const startedAt = useRef(Date.now());
  const history = useRef<Decided[]>([]);
  const dirty = useRef(false);
  const [undoDepth, setUndoDepth] = useState(0);

  const tallyNow = useCallback((): TriageTally => ({ ...tally, elapsedMs: Date.now() - startedAt.current }), [tally]);

  const count = useCallback((verb: TriageVerb, postureTaught?: boolean) => {
    if (verb === 'keep' || verb === 'open') return; // a keep decides nothing and claims nothing
    const key: keyof TriageTally = postureTaught ? 'postures' : verb;
    setTally((t) => ({ ...t, [key]: t[key] + 1 }));
    if (verb !== 'later') dirty.current = true;
  }, []);

  const advance = useCallback((d: Decided) => {
    history.current.push(d);
    setUndoDepth(history.current.length);
    setExiting(d.verb);
    setTimeout(() => { setExiting(null); setCursor((c) => c + 1); }, 180);
  }, []);

  const leave = useCallback(() => {
    if (dirty.current) onRefresh?.();
    onExit(triageReceipt(tallyNow()));
  }, [onExit, onRefresh, tallyNow]);

  // ── Z · UNDO — the LAST resolving verb, through the SAME restore the toast fires. A keep and a
  //    park are not restore-shaped (nothing was resolved), so Z steps back to the card instead of
  //    claiming a reversal it did not perform. ────────────────────────────────────────────────────
  const undoLast = useCallback(async () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current.pop();
    setUndoDepth(history.current.length);
    setCursor((c) => Math.max(0, c - 1));
    if (last.verb !== 'keep' && last.verb !== 'open') {
      const key: keyof TriageTally = last.verb;
      setTally((t) => ({ ...t, [key]: Math.max(0, t[key] - 1) }));
    }
    if (last.undoable) {
      await restoreEntity(last.row.item.source === 'commitment' ? 'commitment' : 'inbox_item', last.row.id);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const verb = TRIAGE_KEYS[e.key];
      if (verb === 'exit') { e.preventDefault(); leave(); }
      else if (verb === 'undo') { e.preventDefault(); void undoLast(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leave, undoLast]);

  // ── W8.3 · ONE COUNT — THE STACK IS THE DECK'S OWN, AND IT SETTLES TO THE ACCOUNT ─────────────
  // While the account is still being read the stack only GROWS (mergeQueue — the cursor law). Once
  // it is complete, rows AHEAD of the cursor that the account no longer holds leave the stack
  // (settleQueue): a warm row the ledger filed elsewhere was a card the header never counted
  // ("88 here" under "Waiting · 84"). The rows at and behind the cursor never move.
  const stackRef = useRef<TriageRow[]>([]);
  const stack = complete ? settleQueue(stackRef.current, rows, cursor) : mergeQueue(stackRef.current, rows);
  stackRef.current = stack;
  const row = stack[cursor] ?? null;
  const left = Math.max(0, stack.length - cursor);

  // ── THE NEXT CARD IS READ WHILE THIS ONE IS BEING READ. One card ahead, no further: a deck is a
  //    cursor, not a crawler, and a prefetch that ran down sixty threads would be the whole-pool
  //    read this surface exists to avoid. ──────────────────────────────────────────────────────────
  const next = stack[cursor + 1] ?? null;
  // W17: a handed COMMITMENT's evidence is its source (the deck-context door), not a thread tail —
  // read it one card ahead too, or the next commitment card lands on its skeleton.
  useEffect(() => {
    if (next && TRIAGE_THREADED.includes(next.item.source)) void loadTail(next.id);
    else if (next && next.item.source === 'commitment') void loadDeckContext(next.id);
  }, [next]);

  // ══ THE ONE HEADER LINE (Q9v2 · 2). Close, the band and what is left, the shape toggle — and
  //    nothing else. The page's title, intro and band prose collapse behind this. W15.3: it stands
  //    over EVERY state of the deck (a card, the counting skeleton, the end) at one fixed height, so
  //    the card below it never lands in a different place. ══════════════════════════════════════
  const header = (
    <div className="flex h-5 items-center gap-2 px-1">
      <button onClick={leave}
        className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-indigo-600">
        <ArrowLeftIcon className="w-3.5 h-3.5" /><span>{TRIAGE_EXIT_LABEL}</span>
      </button>
      <span className="text-[11px] text-neutral-300" aria-hidden>·</span>
      <span className="text-[12px] text-neutral-400">When you&rsquo;re ready</span>
      <span className="text-[11px] text-neutral-300">{queueCount(left, complete)}</span>
      {onViewAsList && (
        <button onClick={onViewAsList}
          className="ml-auto flex-shrink-0 text-[12px] text-neutral-300 transition-colors hover:text-indigo-600">
          {TRIAGE_VIEW_ALL}
        </button>
      )}
    </div>
  );

  // ── THE END OF A STACK STILL BEING COUNTED is not the end of the band. A receipt here would
  //    claim a session finished over rows the account had not handed over yet.
  //    W15.3: it stands in THE SAME FRAME as a card, at the same height — a skeleton, never a strip.
  if (!row && !complete) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className={CARD_AREA}><DecisionCardSkeleton message="Counting the rest of the account…" /></div>
      </div>
    );
  }

  // ── THE END OF THE STACK — the receipt, in place, before the ledger returns (the same frame). ──
  if (!row) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className={CARD_AREA}>
          <DecisionCardFrame>
            <div className="flex flex-col items-start gap-3 px-5 pt-6">
              <p className="text-[14px] text-neutral-700">{triageEnd(tallyNow())}</p>
              <button onClick={leave} className="text-[12px] font-medium text-indigo-600">Back to the account →</button>
            </div>
          </DecisionCardFrame>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}

      {/* THE FRAME AND ITS STACK — the station owns the pills (pinned) and the card (which moves). */}
      <TriageStation key={row.id} row={row} today={today}
        canUndo={undoDepth > 0} onUndo={() => void undoLast()}
        exiting={exiting} under={left > 1}
        onDecided={advance} onCount={count} />
    </div>
  );
}

/** THE DECK BEFORE IT HAS A DAY (W15.3) — the lens's place-holder, in the deck's own geometry: the
 *  header line's height, the card area, the frame's skeleton. It claims nothing (no count, no verbs,
 *  no rows), and when the deck arrives the card stands exactly where this one stood. */
export function TriageDeckSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <div className="h-5" aria-hidden />
      <div className={CARD_AREA}><DecisionCardSkeleton /></div>
    </div>
  );
}

export default TriageDeck;
