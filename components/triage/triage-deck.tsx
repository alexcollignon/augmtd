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
// 1 · THE FRAME OWNS THE VERBS, THE CARD OWNS THE CONTENT. Two large pills fixed ABOVE the stack
//     (← Dismiss · Done →), two quiet companions beside them (↑ Keep · ⏎ Open), a demoted Later
//     chip and an Undo pill that exists only when there is something to undo. NOTHING verb-shaped
//     renders inside the card — `TriageCard` below holds no deed, no door and no verb table at all.
// 2 · TRUE FOCUS. The card is ~640px, centred, and the surrounding prose collapses (the lens owns
//     that half — this file owns the one header line: Close · the band · what is left · view as
//     list).
// 3 · THE CARD IS THE THING ITSELF. Who it is from, what kind of thing it is, and then THE ACTUAL
//     CONTENT: for a mail row the thread's tail, lazily read through THE EXISTING THREAD DOOR
//     (`GET /api/inbox/<id>/thread`), clipped by THE ONE CLIPPER, cached for the session and
//     PREFETCHED one card ahead; for anything else the founding context it was already handed.
//     At the bottom, the reply slot: a prepared draft rendered read-only where one stands, else a
//     quiet line that talks to Clara about THIS item through the item's OWN conversation door.
//
// ── THE INVARIANT, UNCHANGED ────────────────────────────────────────────────────────────────────
// NOTHING EVER FLOWS BACK TO THE TOP BY ITSELF, and nothing in this file can send anything: the
// reply slot never commits (it speaks), the draft preview never commits (it shows), and the only
// route to a commit is ⏎ OPEN — the item's own room, its own door, the person's own keystroke.
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
  TRIAGE_SOURCE_WORD, TRIAGE_THREADED, TRIAGE_STEER_KIND,
  laterOptions, whenWords, triageReceipt, triageEnd, initialOf, verbsOfRank,
  type TriageTally, type TriageVerb, type TriageMessage,
} from '@/lib/triage/words';
// THE ONE THREAD-DOOR READER (lib/inbox/thread-door.ts) — shared with the room's object card, so
// the tail a deck warms is the tail a room shows, read once.
import { loadThreadTail, peekThreadDoor } from '@/lib/inbox/thread-door';
// THE HONEST COUNTER — a stack still being extended may not state a total (lib/triage/queue.ts).
import { queueCount } from '@/lib/triage/queue';

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
  /** The prepared artifact's kind, when one stands ('reply_draft' | 'invite'). A row handed over by
   *  the Home carries none: it may say a prepared WORD (below) but it never promises a renderer. */
  prepared: string | null;
  /** The prepared RECEIPT as a word ("drafted", "ready to send") — a chip, never a mount. */
  preparedWord?: string | null;
  /** The held class — the subject of a posture, when one is keepable. */
  cls: HeldClassId | null;
};

type Decided = { row: TriageRow; verb: TriageVerb; undoable: boolean };

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

/** THE PREPARED DRAFT'S OWN WORDS, for the read-only preview in the slot. Asked for ONLY where the
 *  serve already said a reply draft stands (`row.prepared === 'reply_draft'`), so this is the
 *  door's instant serve of a stored draft — never a generation the deck triggered. */
const _draftCache = new Map<string, string>();
function loadDraft(itemId: string): Promise<string> {
  const had = _draftCache.get(itemId);
  if (had !== undefined) return Promise.resolve(had);
  return fetch(`/api/inbox/${itemId}/draft`, { method: 'POST' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => String(d?.draft ?? ''))
    .catch(() => '')
    .then((t) => { _draftCache.set(itemId, t); return t; });
}

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
function TriageCard({ row, onOpen }: {
  row: TriageRow;
  /** The ONE navigation a card may ask for: the reply slot's "open it to send" pointer. It is the
   *  frame's ⏎ OPEN, handed down — never a second door. */
  onOpen: () => void;
}) {
  const [tail, setTail] = useState<TriageMessage[] | null>(() => peekThreadDoor(row.id)?.tail ?? null);
  const [draft, setDraft] = useState<string | null>(() => _draftCache.get(row.id) ?? null);
  const threaded = TRIAGE_THREADED.includes(row.item.source);

  // LAZY, ON THE CARD IN HAND. The cache makes a revisit free; a stale component that resolves
  // after the reader has moved on writes to nothing (the guard below).
  useEffect(() => {
    if (!threaded) { setTail(null); return; }
    let live = true;
    void loadTail(row.id).then((t) => { if (live) setTail(t); });
    return () => { live = false; };
  }, [row.id, threaded]);

  useEffect(() => {
    if (row.prepared !== 'reply_draft') { setDraft(null); return; }
    let live = true;
    void loadDraft(row.id).then((t) => { if (live) setDraft(t); });
    return () => { live = false; };
  }, [row.id, row.prepared]);

  const sourceWord = TRIAGE_SOURCE_WORD[row.item.source] ?? null;
  // THE CONTEXTUAL CHIP — the prepared state where one was served, else the held class's own word.
  // It never invents a state: a row with neither wears nothing.
  const chip = row.preparedWord ?? (row.prepared === 'reply_draft' ? 'draft ready'
    : row.prepared === 'invite' ? 'invite ready' : null);

  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200/70 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {/* ── TOP · WHO, WHAT KIND, WHEN ────────────────────────────────────────────────────────────
          An initial-avatar, the counterparty, the row's own kind, and the stated date at the edge
          with the contextual chip. Every one of them is ABSENT when the row does not have it — a
          labelled empty space is worse than a shorter card. */}
      <div className="flex items-center gap-2.5 px-5 pt-4">
        <span aria-hidden className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[12px] font-medium text-neutral-500">
          {initialOf(row.who ?? row.title)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          {row.who && <span className="truncate text-[13px] font-medium text-neutral-800">{row.who}</span>}
          <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
            {sourceWord && <span>{sourceWord}</span>}
            {sourceWord && row.dueDate && <span aria-hidden>·</span>}
            {row.dueDate && <span>{whenWords(row.dueDate)}</span>}
          </span>
        </div>
        {chip && (
          <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-500">{chip}</span>
        )}
      </div>

      <p className="mt-2.5 px-5 text-[15px] font-medium leading-snug text-neutral-900">{row.title}</p>
      {/* THE WHY-HELD CLAUSE — the ledger's own served sentence, not a second account of it. */}
      {row.why && <p className="mt-1 px-5 text-[12px] text-neutral-400">{row.why}</p>}

      {/* ── MIDDLE · THE THING ITSELF ─────────────────────────────────────────────────────────────
          For a mail row the thread's tail, author-named, each message's own words clipped by the
          one clipper. While it is being read the card shows what it already has (the served first
          words) rather than a hole — and if the read comes back empty, that served excerpt IS the
          content. There is never dead vertical space and never a spinner where substance exists. */}
      <div className="mt-3 flex flex-col gap-3 px-5">
        {threaded && tail && tail.length > 0 ? tail.map((m) => (
          <div key={m.id} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-neutral-400">{m.author}</span>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">{m.body}</p>
          </div>
        )) : row.excerpt ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-500">{row.excerpt}</p>
        ) : null}
      </div>

      {/* ── BOTTOM · THE REPLY SLOT ───────────────────────────────────────────────────────────────
          A prepared draft renders IN it, read-only: review at speed. The slot NEVER sends — there
          is no send door in this file at all; the pointer is ⏎ Open, where the commit already
          lives. With no draft, the slot is a quiet line that talks to Clara about THIS item. */}
      <ReplySlot row={row} draft={draft} onOpen={onOpen} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REPLY SLOT. Two states, one law: IT NEVER SENDS.
//   · A PREPARED DRAFT renders as itself, read-only, under a "ready to send" line whose only
//     affordance is the room (⏎ Open) — the same commit door every other surface uses.
//   · OTHERWISE it is a composer that speaks to Clara ABOUT this item, through the item's own
//     conversation door (`POST /api/items/steer`, the same door the room's composer posts to, with
//     the item's own kind). The answer renders in place; the deck does not advance, because asking
//     a question is not a verdict.
// THE DECK WRITES NO ROOM TURN OF ITS OWN: the room key of an item is resolved SERVER-side (an item
// linked to an entity lives in that entity's room), and a client that guessed it would write the
// exchange into the wrong room. The item's own door is the whole of what this slot touches.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function ReplySlot({ row, draft, onOpen }: { row: TriageRow; draft: string | null; onOpen: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const steerKind = TRIAGE_STEER_KIND[row.item.source] ?? null;

  const ask = useCallback(async () => {
    const t = text.trim();
    if (!t || busy || !steerKind) return;
    setBusy(true); setSaid(null);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: steerKind, id: row.id, text: t }),
      });
      const d = await res.json().catch(() => ({}));
      setSaid(res.ok ? String(d.say ?? d.answer ?? 'Noted.') : String(d.error ?? "That didn't go through — try again in a moment."));
      if (res.ok) setText('');
    } catch {
      setSaid("That didn't go through — try again in a moment.");
    } finally { setBusy(false); }
  }, [busy, row.id, steerKind, text]);

  if (draft) {
    return (
      <div className="mt-4 border-t border-neutral-100 px-5 py-3">
        <p className="text-[11px] font-medium text-indigo-500">ready to send</p>
        <p className="mt-1.5 max-h-52 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">{draft}</p>
        <button type="button" onClick={onOpen}
          className="mt-2 text-[12px] font-medium text-neutral-400 transition-colors hover:text-indigo-600">
          Open it to send or change it →
        </button>
      </div>
    );
  }
  // A row with no honest item kind gets NO slot rather than one that would post to the wrong door.
  if (!steerKind) return <div className="pb-4" />;
  return (
    <div className="mt-4 border-t border-neutral-100 px-5 py-3">
      {said && <p className="mb-2 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">{said}</p>}
      <div className="flex items-center gap-2">
        <input value={text} disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void ask(); } }}
          placeholder={busy ? 'Clara is reading it…' : 'Ask or tell Clara about this…'}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-700 outline-none placeholder:text-neutral-300 disabled:opacity-60" />
        {text.trim() && !busy && (
          <button type="button" onClick={() => void ask()}
            className="flex-shrink-0 text-[12px] font-medium text-indigo-600">Ask</button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATION — one row's frame. It owns the doors, the keyboard and the pills; the card below it
// owns the content. The pills sit ABOVE the stack, fixed, in the frame's own row.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function TriageStation({ row, today, canUndo, onUndo, exiting, under, onDecided, onCount }: {
  row: TriageRow;
  /** The served day the whens are composed from — this component owns no clock. */
  today: string;
  canUndo: boolean;
  onUndo: () => void;
  /** The verdict the card is leaving on — the ONLY thing that moves. The pill bar is fixed. */
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
  const { busy, done, drop, open: openRoom } = useRowActions(row.item, {
    onUndoInbox: undo('inbox_item'), onUndoCommitment: undo('commitment'),
  });

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
  //    not in it. Typing inside the card's own fields (a date, the reply slot) never steers. ──────
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
      {/* ══ THE PILL BAR — FIXED ABOVE THE STACK. The two deeds that clear are the big pair; Keep
          and Open are quiet beside them; Later is a chip; Undo exists only when there is something
          to undo. Nothing verb-shaped renders below this bar. ════════════════════════════════ */}
      <div className="flex flex-col gap-2">
        <div className="flex items-stretch gap-2">
          {primary.map((v) => (
            <PrimaryPill key={v.verb} v={v} busy={busy}
              onClick={v.verb === 'done' ? doDone : doDismiss} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
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
          <span className="ml-auto pl-2 text-[11px] text-neutral-300">{TRIAGE_HINTS}</span>
        </div>

        {/* L'S WHENS. Two keystroke-cheap days and one real date; every one of them IS a date. */}
        {laterOpen && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="text-[12px] text-neutral-400">Bring it back</span>
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
          <div className="flex flex-wrap items-center gap-3 pt-0.5">
            <span className="min-w-0 flex-1 text-[12px] text-neutral-500">{offer.offer.ask}</span>
            <button onClick={() => void keepDoingThis()} className="text-[12px] font-medium text-indigo-600">Always</button>
            <button onClick={() => onDecided({ row, verb: 'dismiss', undoable: true })}
              className="text-[12px] text-neutral-400 hover:text-neutral-600">Just this one</button>
          </div>
        )}
        {postureNote && <p className="text-[12px] text-neutral-500">{postureNote}</p>}
        {note && <p className="text-[12px] text-rose-600">{note}</p>}
      </div>

      {/* THE STACK, PEEKING. Two hairline shoulders behind the card say how much is under it
          without rendering a second row of content — the card is the only thing that can be read.
          Only THIS block moves on a verdict; the pill bar above never does. */}
      <div className={`relative transition-all duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
        exiting ? `opacity-0 ${CARD_EXIT[exiting]}` : 'opacity-100'
      }`}>
        <div aria-hidden className="pointer-events-none absolute inset-x-3 -bottom-1.5 h-3 rounded-b-2xl border border-t-0 border-neutral-200/70 bg-white" />
        {under && (
          <div aria-hidden className="pointer-events-none absolute inset-x-6 -bottom-3 h-3 rounded-b-2xl border border-t-0 border-neutral-200/50 bg-white" />
        )}
        <div className="relative">
          <TriageCard row={row} onOpen={openRoom} />
        </div>
      </div>
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

  const row = rows[cursor] ?? null;
  const left = Math.max(0, rows.length - cursor);

  // ── THE NEXT CARD IS READ WHILE THIS ONE IS BEING READ. One card ahead, no further: a deck is a
  //    cursor, not a crawler, and a prefetch that ran down sixty threads would be the whole-pool
  //    read this surface exists to avoid. ──────────────────────────────────────────────────────────
  const next = rows[cursor + 1] ?? null;
  useEffect(() => {
    if (next && TRIAGE_THREADED.includes(next.item.source)) void loadTail(next.id);
  }, [next]);

  // ── THE END OF A STACK STILL BEING COUNTED is not the end of the band. A receipt here would
  //    claim a session finished over rows the account had not handed over yet. ──────────────────
  if (!row && !complete) {
    return (
      <div className="rounded-2xl border border-neutral-200/70 bg-white px-5 py-6">
        <p className="text-[13px] text-neutral-400">Counting the rest of the account…</p>
      </div>
    );
  }

  // ── THE END OF THE STACK — the receipt, in place, before the ledger returns. ───────────────────
  if (!row) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-neutral-200/70 bg-white px-5 py-6">
        <p className="text-[14px] text-neutral-700">{triageEnd(tallyNow())}</p>
        <button onClick={leave} className="text-[12px] font-medium text-indigo-600">Back to the account →</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ══ THE ONE HEADER LINE (Q9v2 · 2). Close, the band and what is left, the shape toggle —
          and nothing else. The page's title, intro and band prose collapse behind this. ═══════ */}
      <div className="flex items-center gap-2 px-1">
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
            View as list
          </button>
        )}
      </div>

      {/* THE FRAME AND ITS STACK — the station owns the pills (fixed) and the card (which moves). */}
      <TriageStation key={row.id} row={row} today={today}
        canUndo={undoDepth > 0} onUndo={() => void undoLast()}
        exiting={exiting} under={left > 1}
        onDecided={advance} onCount={count} />
    </div>
  );
}

export default TriageDeck;
