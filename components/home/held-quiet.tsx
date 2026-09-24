'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HELD-QUIET LEDGER — the surface of law A3, re-cut to Q2's GRADIENT (docs/attention-plan.md).
//
// "Suppression is a POSTURE WITH RECEIPTS, never a dismissal." The old door said "Everything else",
// which reads as a guilt backlog — a pile the reader failed to get to. This page states the AGENT'S
// OWN ACT: I ingested everything, I held these, here is the account, and anything can come back.
//
// Q2 · HELD ≠ HANDLED (Sep 17). One flat account of 4,939 things was the next failure along — the
// owner's words, "it's 0 to 100, no in-between". The same one partition now reads as THREE BANDS,
// top to bottom in the order a person needs them:
//   1 · WAITING — alive, real, held only because today's five were fuller. The page is TITLED for
//       this band ("When you're ready") and the Home's door speaks only its number. A
//       calendar-adjacent row leads it, worded by its adjacency — the old "Brought forward" section
//       dissolved into this band, because a promoted wall is still a wall.
//   2 · WATCHED — copied in, or somebody else owes the move. One line, one count, folded. No verbs:
//       nothing here is owed by the reader.
//   3 · HANDLED — the big number, at the BOTTOM, where reassurance belongs: the classes with their
//       counts, consequences and verbs, under the graduation sentence that says what happens to them
//       on their own (Q3).
// The bands are SERVED (`bands` on the payload), computed by the same pure pass that files the
// classes; this page re-partitions nothing.
//
// THE VOCABULARY IS THE CALM HOME'S, unchanged: 11px semibold caps headers in neutral-400, 13px
// quiet rows, no cards, no borders inside a group, urgency is a WORD in grey and never colour. A
// ledger that shouts is a second inbox, which is exactly what this arc exists to reverse.
//
// EVERY WORD IS SERVED OR DETERMINISTIC. The class labels, the consequence-of-waiting sentences and
// the per-member why-held lines are composed SERVER-side by `lib/home/attention.ts` (zero AI, from
// verdicts and floors that already exist); the CoS's one-sentence intro and the receipts footer are
// composed HERE from the route's own real counts — never authored, never a model, never a claim the
// numbers don't back.
//
// "BRING FORWARD" v1 IS THE ITEM'S OWN DOOR (this wave): the verb navigates to the thing. Turning it
// into a posture-mutating deed is W2's bulk-deed door, which carries its own preview + commit + undo
// — a one-click mutation with no commit door would be the opposite of this page's whole point.
//
// EVERY ROW HAS HANDS (owner walk, Sep 18 — "held quiet is still a massive list, with no way of
// dismissing any, or mark done, as we had… not helpful at any stage"). The ledger accounted for
// everything and could ACT on almost nothing: only a whole class could be archived in bulk, and a
// single row's only affordance was to come back. A page that can only hand work back is a wall with
// receipts. So every WAITING and WATCHED member row now wears the deck's OWN hover rail — Done ·
// Dismiss · Add to project, then the row's own door — through `useRowActions`, which means the very
// endpoints the deck's rows have always used (`/api/inbox/<id>/complete|dismiss` for a mail row,
// `PATCH /api/commitments/<id>` for a commitment row) and the very same "…· Undo" restore toast.
// NO NEW MUTATION DOOR EXISTS FOR THIS PAGE, by construction: the rail is the row kit's, unmodified.
// The HANDLED band keeps its own grammar — those rows already carry their class's bulk verb, and a
// per-row deed beside a bulk deed would be two ways to do one thing.
//
// WATCHED GETS THE RAIL TOO. The band's earlier note ("nothing here is owed by the reader, so
// nothing here gets a verb") was about not IMPLYING debt — a hover-only, colourless verb implies
// none, and "I don't need to watch this" is exactly the deed a watched row invites.
//
// THE CLASS'S OWN VERB (A7, wired Sep 17): each class whose `deed` is a real bulk verb carries that
// verb as ONE QUIET WORD at the row's right edge — never a button block, never colour. Clicking it
// PREVIEWS (POST /api/deeds/prepare) and mounts the bulk-deed card directly beneath the row: THE
// CARD IS THE CONFIRMATION, and its own button is the only commit door on this page. Opening a class
// turns its members into a pickable set (a checkbox each, one select-all line) so the verb can act
// on a subset — the ids ride the SAME preview door, and there is no second path to a commit.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import BulkDeedCard from '@/components/home/bulk-deed-card';
// THE ROW KIT — the deck's OWN doors, not a second set (the RowControls precedent). A ledger row
// acts through exactly the endpoints the deck's rows always did.
import { useRowActions, RowControls, RowHoverRail, exitCls } from '@/components/work/work-row';
import { showUndoToast } from '@/lib/activity/undo-toast';
import type { DoItem, DoSource } from '@/lib/home/agenda';
// THE CLIENT-SAFE IMPORT: the deed's pure words, never the engine (the server-graph law).
import { BULK_VERBS, deedBoundFor, type BulkDeed, type BulkVerb } from '@/lib/deeds/words';
// THE SENTENCES live apart for the same reason the deed's words do: pure, client-safe, and
// assertable by a CLI gate that cannot import a component. Re-exported so this page stays the one
// import for anything rendering the ledger.
import { heldIntro, heldReceipts } from '@/lib/home/held-words';
// Q9 · THE TRIAGE DECK — the SECOND RENDER of the waiting band (never a second derivation of it).
import { TriageDeck, type TriageRow } from '@/components/triage/triage-deck';
// THE LIST'S SHAPE (W5b): the fold, the honest footer, and which handed rows the list reads.
import { foldHeldRows, foldCountWord, heldFooter, listHanded, type HeldFold } from '@/lib/home/held-list';
// W8.3 · the pure bulk-label law (client-safe, gate-assertable) and the band's declared bound.
import { bulkVerbLabel, bulkScopeLine, HELD_BAND_ROWS_BOUND as HELD_ROWS_PER_BAND } from '@/lib/deeds/held-words-bulk';
import { warmDeckContexts } from '@/lib/triage/deck-context-door';
// The stamped-cache idiom: the reader's choice of shape sticks, and a stale blob cannot claim one.
import { loadLS, saveLS } from '@/lib/utils/local-cache';

export { heldIntro, heldReceipts };

/** A served band row. The four ledger fields, plus Q9's THREE CARD ESSENTIALS — served on the row
 *  by `lib/home/attention.ts` (`HeldBandRow`), never fetched per card and never derived here. */
export type HeldMemberOut = {
  itemId: string; subject: string; why: string; dueDate: string | null; cls?: string;
  from?: string | null; excerpt?: string | null; prepared?: string | null;
};
export type HeldClassOut = {
  id: string; label: string; consequence: string; deed: string;
  count: number; members: HeldMemberOut[]; hasMore: boolean;
};
/** Q2's THREE BANDS, exactly as the route serves them. The client reads; it never re-partitions. */
export type HeldBandsOut = {
  waiting: { id: 'waiting'; title: string; sentence: string; count: number; urgent: number; rows: HeldMemberOut[]; hasMore: boolean };
  watched: { id: 'watched'; title: string; sentence: string; count: number; rows: HeldMemberOut[]; hasMore: boolean };
  handled: { id: 'handled'; title: string; sentence: string; count: number; classes: HeldClassOut[]; graduation: string };
};
export type HeldLedger = {
  total: number; classes: HeldClassOut[];
  bands?: HeldBandsOut;
  budget?: number; servedCount?: number; poolRead?: number; poolSaturated?: boolean;
  /** A WARM paint, not this visit's read: the hook stamps it when the ledger came off the local
   *  cache. The account is real (it was served), it is simply not yet confirmed for this visit —
   *  so the deck opens on it and says its stack is still being counted. Cleared by the live read. */
  warm?: boolean;
  /** How old the server's own last-good payload was, when it served one (receipts, never chrome). */
  cachedAgeMs?: number;
  /** The SERVED day — the triage deck's ← LATER composes its whens from this, never from a clock
   *  of its own (a deck built at 23:58 in the wrong zone would otherwise offer a dead "tomorrow"). */
  today?: string;
  /** Q3's receipt — rows that filed themselves this month, counted from the activity log. */
  filedThisMonth?: number;
};

/** A row the DECK itself held back that the inbox ledger structurally cannot account for (its pool
 *  is pending inbox mail — a commitment, a slipping deal or a priority card lives elsewhere). The
 *  Home hands these in already worded, in its own whisper vocabulary, so this page invents nothing.
 *
 *  `source` RIDES ALONG so the row's verbs reach ITS OWN door: a commitment settles through
 *  `PATCH /api/commitments/<id>`, never the inbox routes. A deal has no per-row door at all (its
 *  dismissal is a session posture the Home owns), so it wears no verbs rather than a lying one. */
export type DeckHeldRow = {
  id: string; href: string; line: string; why: string;
  source: 'commitment' | 'deal' | 'reply' | 'notice';
  /** THE CARD'S OWN FACTS, from the brief the Home already holds (owner walk, Sep 18 — "the card
   *  is too bare"). Absent where the Home genuinely has no such fact: a deck row carries no mail
   *  body, so it shows who + why-held honestly rather than an empty labelled space. */
  who?: string | null;
  dueDate?: string | null;
  /** The prepared RECEIPT as a word ("drafted"), never an artifact token — the Home promises a
   *  chip here, not a renderer. */
  preparedWord?: string | null;
  /** THE CARD'S OWN FACTS (W3.6 · lib/triage/deck-context.ts `cardFacts`): the raw ask as the
   *  card's title (its header already shows the who) and the subline without the receipt (the
   *  chip carries it — one receipt). The LIST keeps `line` + `why`. */
  cardTitle?: string | null;
  cardWhy?: string | null;
  /** The tracked project the row belongs to — served, never said twice. */
  project?: string | null;
  /** THE ONE READER's live prepared kind, as the brief served it. */
  preparedKind?: string | null;
};

/** The item's own door — the same address every deck row opens (one fact, one home). */
const itemHref = (id: string) => `/item/${id}?kind=email`;

/** THE ZONE HEADER — the calm home's own. */
function Header({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400">{children}</h2>
  );
}

/** THE LEDGER'S POOL IS PENDING MAIL (lib/deeds/held-members.ts), so a band member is an inbox
 *  item and `reply` is the lane token `useRowActions` routes on — the inbox complete/dismiss doors.
 *  Nothing here invents a kind: a row whose kind the ledger cannot know never reaches this map. */
const memberItem = (m: HeldMemberOut): DoItem => ({
  source: 'reply', key: m.itemId, entityId: m.itemId, href: itemHref(m.itemId),
  primary: null, ask: m.subject, dueDate: m.dueDate ?? null,
});
/** A deck-handed row keeps ITS OWN kind, so its verbs reach its own door. */
const deckItem = (r: DeckHeldRow): DoItem => ({
  source: r.source as DoSource, key: r.id, entityId: r.id, href: r.href,
  primary: null, ask: r.line, initiative: r.project ?? null,
});

/** ONE LEDGER ROW — a held thing, its why, and the deck's own hover rail.
 *
 *  At rest it is a pure line (the calm vocabulary: 13px, no colour, no chrome). On hover the rail
 *  slides in over the row's right edge — Done · Dismiss · Add to project from the row kit, then the
 *  way back — so the sentence never reflows and no target moves mid-hover (the hover-rail law).
 *  The deed is OPTIMISTIC: `useRowActions` exits the row the moment it fires and the house
 *  "…· Undo" toast carries the reversal through `/api/restore`, which on success re-reads the
 *  account (an undone row must return to the ledger, not merely stop being hidden). */
function HeldRow({ item, line, why, onRestored }: {
  item: DoItem; line: string; why: string; onRestored?: () => void;
}) {
  const undo = (entityType: 'inbox_item' | 'commitment') => (message: string, entityId: string) =>
    showUndoToast({ message, entityType, entityId, onUndo: () => onRestored?.() });
  const { removed, exiting, busy, done, drop, open, prefetch } = useRowActions(item, {
    onUndoInbox: undo('inbox_item'), onUndoCommitment: undo('commitment'),
  });
  if (removed) return null;
  // A DEAL HAS NO PER-ROW DOOR — its ✓ would hit nothing and its ✕ belongs to the Home's session
  // posture. It keeps the way back and nothing it cannot keep.
  const actionable = item.source !== 'deal';
  return (
    <div onMouseEnter={prefetch} onFocus={prefetch} onMouseDown={prefetch} onTouchStart={prefetch}
      className={`group relative flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 transition-colors hover:bg-white ${exitCls(exiting)}`}>
      <div role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="min-w-0 flex-1 cursor-pointer truncate text-[13px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
        {line}
        {why && <span className="text-neutral-400"> — {why}</span>}
      </div>
      <RowHoverRail>
        <RowControls item={item} busy={busy} done={done} drop={drop} readonly={!actionable} />
        {/* THE WAY BACK, DEMOTED TO THE RAIL'S LAST POSITION (owner walk, Sep 18): it used to be the
            row's only affordance and sat at the edge alone. It is still here, still one click. */}
        <button onClick={(e) => { e.stopPropagation(); open(); }}
          className="text-[12px] font-medium text-indigo-600 whitespace-nowrap">Bring forward</button>
      </RowHoverRail>
    </div>
  );
}

/** ONE FOLD — the lead row, and when it stands for several, a quiet count that opens the rest in
 *  place (W5b). Every member keeps its own row and its own hands: a fold groups, it never hides a
 *  deed. */
function HeldFoldRows({ fold, onRestored }: {
  fold: HeldFold<{ id: string; item: DoItem; line: string; why: string }>; onRestored?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { lead, members } = fold;
  const more = foldCountWord(members.length);
  return (
    <div className="flex flex-col">
      <HeldRow item={lead.item} line={lead.line} why={lead.why} onRestored={onRestored} />
      {more && (
        <button onClick={() => setOpen((v) => !v)}
          className="-mt-1 self-start px-3 pb-1 text-left text-[12px] text-neutral-300 transition-colors hover:text-indigo-600">
          {open ? 'Hide the others' : more}
        </button>
      )}
      {more && open && (
        <div className="flex flex-col pl-[22px]">
          {members.slice(1).map((r) => (
            <HeldRow key={r.id} item={r.item} line={r.line} why={r.why} onRestored={onRestored} />
          ))}
        </div>
      )}
    </div>
  );
}

/** THE CLASS'S VERB, as a WORD. A7 gives each class its natural verb; this page gives it the
 *  quietest possible seat — 12px, neutral, indigo only on hover, and it PREVIEWS rather than acts.
 *  `surface` (brought_forward's deed) is a navigation, not a bulk verb, so it never renders here. */
const VERB_WORD: Record<BulkVerb, string> = {
  archive: 'Archive', trash: 'Move to trash', unsubscribe: 'Unsubscribe', expire: 'Close',
};
const verbOf = (deed: string): BulkVerb | null =>
  (BULK_VERBS as readonly string[]).includes(deed) ? (deed as BulkVerb) : null;

/** ONE FOLDED CLASS — name · count on the left, the consequence-of-waiting sentence right-aligned,
 *  the class's own verb at the edge. Expanding shows its members (pickable when the class carries a
 *  verb); ONE class is open at a time (a ledger with six open classes is the wall this page
 *  replaced). A prepared deed's card mounts DIRECTLY BENEATH this row — the card is the
 *  confirmation, and committing happens inside it, at its own one door. */
function ClassRow({ c, open, onToggle, deed, busy, error, picked, onPick, onPickAll, onVerb, onDeedDone }: {
  c: HeldClassOut; open: boolean; onToggle: () => void;
  deed: BulkDeed | null; busy: boolean; error: string | null;
  picked: Set<string>;
  onPick: (itemId: string) => void;
  onPickAll: (all: boolean) => void;
  onVerb: () => void;
  onDeedDone: () => void;
}) {
  const verb = verbOf(c.deed);
  const pickable = !!verb && open;
  const allPicked = picked.size > 0 && c.members.every((m) => picked.has(m.itemId));
  // THE VERB SAYS WHAT IT WILL ACT ON — the whole class, or exactly the ones picked. It never moves
  // anything: the next thing the reader sees is the preview card. AND IT NEVER PROMISES MORE THAN A
  // DEED CAN HOLD — W8.3: nor LESS than the truth about the group. "Archive 200" beside "Notices ·
  // 1,223" read as the group's size; the label now says it is the newest 200 OF the group.
  // W8.6: the deed acts on the WHOLE group to its verb's own bound ("Archive all 1,223").
  const verbLabel = verb ? bulkVerbLabel(VERB_WORD[verb], c.count, picked.size, deedBoundFor(verb)) : null;

  return (
    <div className="flex flex-col">
      <div className="group flex w-full items-center gap-2.5 rounded-[10px] px-3 py-1.5 transition-colors hover:bg-white">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronDownIcon className={`w-3 h-3 flex-shrink-0 text-neutral-300 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`} />
          <span className="flex-shrink-0 text-[13px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
            {c.label}
            <span className="text-neutral-400"> · {c.count}</span>
          </span>
          <span className="flex-1" />
          <span className="hidden sm:block min-w-0 flex-shrink truncate text-[12px] text-neutral-400">{c.consequence}</span>
        </button>
        {verbLabel && !deed && (
          <button onClick={onVerb} disabled={busy}
            className="flex-shrink-0 text-[12px] text-neutral-300 transition-colors hover:text-indigo-600 disabled:text-neutral-200">
            {busy ? 'Working out what that would do…' : verbLabel}
          </button>
        )}
      </div>
      {/* The consequence never disappears on a narrow column — it moves under the name instead of
          being truncated away (a class whose account is invisible is an unaccounted-for class). */}
      <p className="sm:hidden px-3 pb-1 text-[12px] text-neutral-400">{c.consequence}</p>

      {/* THE PREVIEW, IN PLACE. The card carries what will happen, to how many, the undo note and
          the ONE commit door; this page adds no second way to commit. */}
      {error && <p className="px-3 pb-1 text-[12px] text-rose-600">{error}</p>}
      {deed && (
        <div className="px-3 py-2">
          <BulkDeedCard deedId={deed.id} deed={deed} onDone={onDeedDone}
            scopeLine={picked.size > 0 ? null : bulkScopeLine(deed.items.length, c.count)} />
        </div>
      )}

      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="flex flex-col pb-1 pl-[22px]">
            {pickable && c.members.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-1 text-[12px] text-neutral-400 hover:text-neutral-600">
                <input type="checkbox" checked={allPicked} onChange={(e) => onPickAll(e.target.checked)}
                  className="h-3 w-3 flex-shrink-0 accent-indigo-600" />
                <span>{allPicked ? 'None' : `All ${c.members.length} shown`}</span>
              </label>
            )}
            {c.members.map((m) => (
              <div key={m.itemId} className="group flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 transition-colors hover:bg-white">
                {pickable && (
                  <input type="checkbox" checked={picked.has(m.itemId)} onChange={() => onPick(m.itemId)}
                    aria-label={`Select ${m.subject}`}
                    className="h-3 w-3 flex-shrink-0 accent-indigo-600" />
                )}
                <Link href={itemHref(m.itemId)} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
                    {m.subject}
                    <span className="text-neutral-400"> — {m.why}</span>
                  </span>
                  <span className="flex-shrink-0 text-[12px] text-neutral-300 group-hover:text-indigo-600 transition-colors">Bring forward</span>
                </Link>
              </div>
            ))}
            {c.hasMore && (
              <p className="px-3 py-1.5 text-[12px] text-neutral-300">
                showing {c.members.length} of {c.count}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Q9 · THE DECK IS THE DEFAULT, THE LIST IS A CHOICE ──────────────────────────────────────────
// "'When you're ready · N →' opens INTO the deck (a quiet 'view as list' toggle keeps the ledger;
// Watched/Handled bands stay list-shaped below either view)." The choice is the reader's and it
// STICKS — stamped through the house cache idiom, so the next visit opens where they left it. The
// Home's door line does not change at all: it still opens ?view=held, which now hosts either shape.
const VIEW_KEY = 'aug-triage-view-v1';
type WaitingShape = 'deck' | 'list';
const loadShape = (): WaitingShape => (loadLS<WaitingShape>(VIEW_KEY) === 'list' ? 'list' : 'deck');

export function HeldQuietView({ ledger, deckHeld, warmHeld = [], servedDay = null, fromHome = false, onBack, onRefresh }: {
  ledger: HeldLedger | null; deckHeld: DeckHeldRow[];
  /** THE WARM STACK — held rows the Home already holds (its own brief, hydrated from the stamped
   *  localStorage cache before the first paint). The deck opens on these; the ledger's read EXTENDS
   *  the same stack in place. Never a second derivation: these ARE the server's `heldBack` atoms,
   *  in the server's own order. */
  warmHeld?: DeckHeldRow[];
  /** THE SERVED DAY the Home was given (brief `today`). The deck's whens are dates and this page
   *  owns no clock, so the warm stack opens on the BRIEF's day and the ledger's own day replaces it
   *  the moment the account lands. Absent → no deck (a ← LATER that invents a day is worse). */
  servedDay?: string | null;
  /** THE RECORDED ORIGIN (owner walk, Sep 21 — Close left the reader on the ledger they never
   *  asked for). `true` = the Home's own "When you're ready" door opened this lens, so the deck's
   *  Close returns WHERE THEY CAME FROM (components/ui/back-link.tsx, Aug 25). `false` = the
   *  address itself named the lens (a deep link, a soft nav), and Close stays on the page the
   *  address asked for. It is an ORIGIN, recorded at the door — never a guess from history length. */
  fromHome?: boolean;
  onBack: () => void;
  /** Re-read the account after a deed runs — archived members must leave the list honestly. */
  onRefresh?: () => void;
}) {
  const [openClass, setOpenClass] = useState<string | null>(null);
  // THE SHAPE reads from LS in an EFFECT, never a useState initializer (this lens renders inside an
  // SSR'd route — a warm cache read at mount time is a hydration mismatch).
  const [shape, setShape] = useState<WaitingShape>('deck');
  const [receipt, setReceipt] = useState<string | null>(null);
  // ── THE EXIT IS SESSION-LOCAL, AND IT IS NEVER PERSISTED ──────────────────────────────────────
  // Closing the deck (the ← Close line, or Esc) ends THIS session and nothing more: it does not
  // change what the door opens into next time, and it is written to no store. An Esc pressed in a
  // PREVIOUS visit must never exit the next deliberate one — which is also why this page holds no
  // effect that calls `onBack`: the way out of the lens is the reader's own click, always. (The
  // shape toggle is the only thing that sticks, and it is a choice about how to READ the band.)
  // Sep 21: Close may now hand the reader back to the Home — that is still the reader's own deed,
  // routed by the RECORDED ORIGIN below, and it is written to no store either.
  const [exited, setExited] = useState(false);
  // ── CLOSE RETURNS WHERE YOU CAME FROM (owner walk, Sep 21) ────────────────────────────────────
  // The door on the Home opens INTO the deck, so ← Close (and Esc) there means "back to the Home"
  // — it left the reader standing on a ledger they never chose. But "View as list" → "One at a
  // time" is a deliberate choice made ON this page, and closing THAT returns to the page it was
  // chosen from. One recorded origin decides, at the moment the deck was entered: the Home's door
  // (`fromHome`, recorded by the door itself) unless the reader picked cards from the ledger.
  const [deckFromList, setDeckFromList] = useState(false);
  const closeReturnsHome = fromHome && !deckFromList;
  useEffect(() => { setShape(loadShape()); }, []);
  const chooseShape = useCallback((s: WaitingShape) => {
    setShape(s); setExited(false); setReceipt(null); saveLS(VIEW_KEY, s);
    // Choosing the cards FROM the ledger re-homes the way out: Close goes back to the list.
    if (s === 'deck') setDeckFromList(true);
  }, []);
  const [watchedOpen, setWatchedOpen] = useState(false);
  /** Q9v2 · 2: while the deck has the room, the rest of the account is one word away — never gone. */
  const [restOpen, setRestOpen] = useState(false);
  // ── THE DEED STATE, per class. A prepared deed is a STORED fact on the server; this holds only
  //    the pointer to it, so nothing about what will happen lives in client state.
  const [deeds, setDeeds] = useState<Record<string, BulkDeed>>({});
  const [busyClass, setBusyClass] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});

  const pickedOf = useCallback((id: string) => picked[id] ?? new Set<string>(), [picked]);

  /** THE ONE PREVIEW DOOR. The whole class rides as a `classKey` (the server derives its membership
   *  through the same function this ledger was read from); a picked subset rides as `itemIds`.
   *  Neither shape can commit anything — the card's own button is the only commit door. */
  const prepare = useCallback(async (c: HeldClassOut) => {
    const verb = verbOf(c.deed);
    if (!verb) return;
    setBusyClass(c.id);
    setErrors((e) => ({ ...e, [c.id]: '' }));
    const chosen = [...pickedOf(c.id)];
    try {
      const res = await fetch('/api/deeds/prepare', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chosen.length ? { verb, itemIds: chosen } : { verb, classKey: c.id }),
      });
      const json = await res.json();
      if (json?.deed) setDeeds((d) => ({ ...d, [c.id]: json.deed as BulkDeed }));
      else setErrors((e) => ({ ...e, [c.id]: String(json?.error ?? 'that could not be prepared') }));
    } catch {
      setErrors((e) => ({ ...e, [c.id]: 'that could not be prepared' }));
    } finally {
      setBusyClass((v) => (v === c.id ? null : v));
    }
  }, [pickedOf]);

  /** A COMMITTED DEED CHANGES THE ACCOUNT — re-read it, so what was archived leaves the list rather
   *  than sitting there as a row the ledger no longer holds. The card itself stays, wearing its
   *  receipt: the record of what just happened is the last thing to disappear. */
  const onDeedDone = useCallback((classId: string) => {
    setPicked((p) => ({ ...p, [classId]: new Set<string>() }));
    onRefresh?.();
  }, [onRefresh]);

  // ── BAND 1 · WAITING. The deck's own non-mail held rows lead (they are already worded in the
  //    Home's vocabulary), then the ledger's waiting rows — brought-forward first, as served. The
  //    old separate "Brought forward" section is GONE: adjacency is a reason a row leads its band,
  //    never a band of its own (a promoted wall is the wall this page replaced, one level down).
  const bands = ledger?.bands ?? null;
  // THE HOME'S OWN HELD ROWS lead: the ledger cannot see a commitment or a deal at all (its pool is
  // pending mail), and the WARM rows are the opening of the stack while the account is read.
  const handed = [...deckHeld, ...warmHeld];
  // THE FOUNDING CONTEXT, WARMED FOR THE WHOLE HANDED SET (W3.6): one coalesced read for every
  // handed commitment, so each card's own ask joins the same request (no N+1).
  const handedCommitKey = handed.filter((d) => d.source === 'commitment').map((d) => d.id).join(',');
  useEffect(() => {
    if (handedCommitKey) warmDeckContexts(handedCommitKey.split(','));
  }, [handedCommitKey]);
  // ONE LIST, TWO RENDERS. `triage` is the SAME row with the card's served essentials attached —
  // the deck is handed exactly this array, in exactly this order, and sorts nothing.
  type WaitingRow = { id: string; item: DoItem; line: string; why: string; triage: TriageRow };
  // ONE ROW BUILDER, TWO HANDED SETS (W5b): the deck opens on the warm stack; the LIST, once the
  // ledger has landed, reads the ledger alone (lib/home/held-list.ts `listHanded`) — a warm row the
  // ledger filed elsewhere was rendered AND uncounted ("showing 92 of 91").
  const rowsOf = (handedSet: DeckHeldRow[]): WaitingRow[] => {
    const handedIds = new Set(handedSet.map((d) => d.id));
    return [
    ...handedSet.map((d) => ({
      id: d.id, item: deckItem(d), line: d.line, why: d.why,
      // A handed row carries what the HOME has: its counterparty, its due date, its prepared word
      // and kind, its project. Its FOUNDING CONTEXT (the thread or the meeting, the judge's reason)
      // is read by the card through the deck-context door — one batched read for the whole handed
      // set (W3.6), warmed below — never baked into this row (the queue freezes rows by id).
      triage: {
        id: d.id, item: deckItem(d), who: d.who ?? null, title: d.cardTitle ?? d.line, why: d.cardWhy ?? d.why,
        excerpt: null, dueDate: d.dueDate ?? null, prepared: d.preparedKind ?? null,
        preparedWord: d.preparedWord ?? null, cls: null,
      } as TriageRow,
    })),
    ...(bands?.waiting.rows ?? []).filter((m) => !handedIds.has(m.itemId))
      .map((m) => ({
        id: m.itemId, item: memberItem(m), line: m.subject, why: m.why,
        triage: {
          id: m.itemId, item: memberItem(m), who: m.from ?? null, title: m.subject, why: m.why,
          excerpt: m.excerpt ?? null, dueDate: m.dueDate, prepared: m.prepared ?? null,
          cls: (m.cls ?? null) as TriageRow['cls'],
        } as TriageRow,
      })),
    ];
  };
  const incomingRows: WaitingRow[] = rowsOf(handed);
  const listRows: WaitingRow[] = rowsOf(listHanded(deckHeld, warmHeld, !!bands));
  // W8.3 · ONE COUNT, ONE READER. The header, the intro, the deck's counter and the list's footer all
  // speak THIS number — the ledger's waiting band plus the deck's own non-mail rows — and the deck is
  // handed exactly the rows it counts once the account has landed (the deck settles its own stack).
  const waitingCount = (bands?.waiting.count ?? 0) + deckHeld.length;
  const folded = bands?.handled.classes ?? ledger?.classes ?? [];
  // ── THE DECK OPENS INSTANTLY (owner, live Sep 18: "not opening" — 20–30s of "Reading the
  //    account…" over a bare list before card one) ────────────────────────────────────────────────
  // The ledger read is a whole-pool derivation; the deck is a cursor over rows. Those are not the
  // same wait, so they no longer share one. THE STACK IS WHATEVER THE CLIENT ALREADY HOLDS — the
  // Home's own held-back rows, plus a warm cached account — and the full read EXTENDS it in place
  // through `mergeQueue`, which appends and never reorders. The card the reader is on cannot move.
  //
  // The queue is the DECK'S stack alone: in list shape, or once the session is over, the list is
  // the account as read RIGHT NOW (rows a deed removed must leave it — the merge is append-only by
  // design, which is exactly right under a live cursor and exactly wrong for a settled list).
  const deckMode = shape === 'deck' && !exited;
  // THE STACK'S STATE LIVES IN THE DECK NOW (W8.3): it merges while the account is being read and
  // SETTLES to the account once it is complete — the only party that knows the cursor keeps the stack.
  const deckComplete = !!ledger && !ledger.warm;
  const waitingRows = deckMode ? (deckComplete ? listRows : incomingRows) : listRows;
  // ONE CONVERSATION, ONE OBLIGATION on the list (W5b): same who + same subject fold under ONE row
  // with its count; every member stays one click away with its own hands. The deck is unfolded —
  // each card is its own decision.
  const listFolds = foldHeldRows(waitingRows, (r) => ({ who: r.triage.who, subject: r.triage.title }));
  // THE FOOTER NEVER SAYS FEWER THAN IT SHOWS — every member of every fold is a shown item — and
  // (W8.3) a footer that says fewer names WHY: the band's declared bound, never a bare "N of M".
  const waitingFooter = heldFooter(waitingRows.length, waitingCount, HELD_ROWS_PER_BAND + deckHeld.length);
  // THE DECK NEEDS A SERVED DAY (its whens are dates) — the ledger's own, else the BRIEF's, which
  // is the same server clock one route earlier. No served day at all → the deck's own chrome with a
  // quiet card holding the place, never the bare list flashing up underneath it.
  const deckDay = ledger?.today ?? servedDay ?? null;
  const deckShown = deckMode && !!deckDay;
  // THE STACK IS COMPLETE only when THIS visit's read has landed (`deckComplete`, above): a warm
  // paint is a real account, but not yet the whole of one, so the deck states what it has.
  // ── Q9v2 · 2 · TRUE FOCUS ─────────────────────────────────────────────────────────────────────
  // "Entering the deck takes the room." The owner's walk read the page as hard to follow because
  // the card sat inside a full ledger page — a title, an intro paragraph, a band header with its
  // own sentence, and two more bands below. In deck mode all of that COLLAPSES behind the deck's
  // one header line, the column narrows to the card's own width, and the rest of the account stays
  // REACHABLE by one quiet word (and returns whole the moment the deck is closed). Nothing is
  // unmounted and nothing is lost: this is a fold, not a different page.
  const focus = deckShown;

  return (
    <div className={`mx-auto w-full pb-16 ${focus ? 'max-w-[640px] pt-6' : 'max-w-[720px] pt-2'}`}>
      {!focus && (
        <>
          <button onClick={onBack}
            className="group inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-neutral-400 hover:text-indigo-600 transition-colors">
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            <span>Home</span>
          </button>
          <h1 className="mt-3 px-3 text-[24px] font-semibold tracking-[-0.02em] text-neutral-900 leading-tight">When you&rsquo;re ready</h1>
          {/* THE INTRO IS THE ACCOUNT'S, AND ONLY THE ACCOUNT'S (owner walk, Sep 18 — "still not
              instant enough": the page opened on "Reading the account…" as its headline sentence,
              which reads as a page that has nothing. With cards already in hand, the read is a
              CORNER FACT (it rides the deck's own counter, "counting the rest…"), not the thing the
              page says first; with nothing at all in hand it is still the honest sentence. */}
          {ledger ? (
            <p className="mt-2 px-3 text-[13px] leading-relaxed text-neutral-500">
              {heldIntro(ledger, deckHeld.length)}
            </p>
          ) : handed.length === 0 ? (
            <p className="mt-2 px-3 text-[13px] leading-relaxed text-neutral-500">Reading the account…</p>
          ) : null}
        </>
      )}

      {/* THE SESSION'S RECEIPT — pure-composed by lib/triage/words.ts from the deck's own tally,
          shown where the band it just cleared stands. It says nothing when nothing was decided. */}
      {receipt && <p className="mt-6 px-3 text-[13px] text-neutral-500">{receipt}</p>}

      {/* THE BAND RENDERS THE MOMENT THE DOOR OPENS. With rows in hand it is the deck; with none yet
          it is the deck's own chrome around a quiet card. What it is never is the bare list waiting
          for a derivation — that flash is the bug this whole wave exists to end. */}
      {(waitingRows.length > 0 || (deckMode && !ledger)) && (
        <section className={`flex flex-col gap-1 ${focus ? 'mt-0' : 'mt-8'}`}>
          {/* IN FOCUS MODE THE DECK'S OWN HEADER LINE IS THE ONLY CHROME — the band name, what is
              left, Close and the shape toggle, all on one row inside the deck. This header and its
              sentence are exactly what Q9v2 folds away. */}
          {!focus && (
            <>
              <div className="flex items-baseline gap-2 pr-3">
                {/* THE HEADER'S NUMBER IS ONLY EVER ONE IT HAS. Before the account lands there is no
                    total to speak, so the header speaks the band's name alone rather than a count
                    that would jump the moment the read returns. */}
                <Header>{bands ? `${bands.waiting.title} · ${waitingCount}` : 'Waiting'}</Header>
                {/* THE QUIET TOGGLE — one word, no segmented control, no colour until hover. */}
                <button onClick={() => chooseShape(shape === 'deck' ? 'list' : 'deck')}
                  className="ml-auto flex-shrink-0 text-[12px] text-neutral-300 transition-colors hover:text-indigo-600">
                  {shape === 'deck' ? 'View as list' : 'One at a time'}
                </button>
              </div>
              {bands?.waiting.sentence && <p className="px-3 text-[12px] text-neutral-400">{bands.waiting.sentence}</p>}
            </>
          )}

          {deckMode && !deckShown ? (
            // THE PLACE-HOLDING CARD — the deck's own shape, in the deck's own chrome, while the
            // first served day is still on its way. It claims nothing: no count, no verbs, no rows.
            <div className="mt-2 px-3">
              <div className="rounded-2xl border border-neutral-200/70 bg-white px-5 py-6">
                <div className="h-3 w-28 animate-pulse rounded bg-neutral-100" />
                <div className="mt-3 h-3.5 w-3/4 animate-pulse rounded bg-neutral-100" />
                <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
              </div>
            </div>
          ) : deckShown ? (
            // THE DECK — a SECOND RENDER of these exact rows, in this exact order. It is handed the
            // list; it never reads one. `today` is the SERVED day: with no served day there is no
            // deck at all (a ← LATER that invents its own clock is worse than a list).
            <div className="px-1">
              <TriageDeck rows={waitingRows.map((r) => r.triage)} today={deckDay!}
                complete={deckComplete}
                onExit={(r) => {
                  // THE ORIGIN DECIDES, and it was recorded at the door. Home-opened → Home.
                  if (closeReturnsHome) { onBack(); return; }
                  setReceipt(r || null); setExited(true);
                }}
                onViewAsList={() => chooseShape('list')}
                onRefresh={onRefresh} />
            </div>
          ) : (
            <>
              <div className="mt-0.5 flex flex-col">
                {listFolds.map((g) => (
                  <HeldFoldRows key={g.key} fold={g} onRestored={onRefresh} />
                ))}
              </div>
              {waitingFooter && (
                <p className="px-3 pt-0.5 text-[12px] text-neutral-300">{waitingFooter}</p>
              )}
            </>
          )}
        </section>
      )}

      {/* ── THE REST OF THE ACCOUNT, FOLDED WHILE THE DECK HAS THE ROOM (Q9v2 · 2) ────────────────
          Watched, Handled and the receipts line are the ledger's reassurance half — exactly the
          prose that made the card hard to find. In deck mode they collapse behind one quiet word
          and come back whole on Close. The fold is a LAYOUT change with a guarded transition: a
          reader who asked for stillness gets the layout and no fade. */}
      {focus && (
        <button onClick={() => setRestOpen((v) => !v)}
          className="mt-8 px-3 text-left text-[12px] text-neutral-300 transition-colors hover:text-indigo-600">
          {restOpen ? 'Hide the rest of the account' : 'The rest of the account'}
        </button>
      )}
      <div className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
        focus && !restOpen ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
      }`}>
      <div className="overflow-hidden min-h-0">

      {/* ── BAND 2 · WATCHED. State, not work: ONE line and a count, and the rows only if asked for.
          Nothing here is OWED by the reader — which is why the band still makes no claim on them —
          but "I don't need to watch this" is a real deed, so the rows wear the same hover rail. */}
      {!!bands && bands.watched.count > 0 && (
        <section className="mt-8 flex flex-col gap-1">
          <button onClick={() => setWatchedOpen((v) => !v)}
            className="group flex w-full items-center gap-2 px-3 text-left">
            <ChevronDownIcon className={`w-3 h-3 flex-shrink-0 text-neutral-300 transition-transform duration-200 ${watchedOpen ? 'rotate-0' : '-rotate-90'}`} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400">
              {`${bands.watched.title} · ${bands.watched.count}`}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-400">— {bands.watched.sentence}</span>
          </button>
          <div className={`grid transition-all duration-200 ease-out ${watchedOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
            <div className="overflow-hidden min-h-0">
              <div className="flex flex-col pb-1 pl-[22px]">
                {bands.watched.rows.map((m) => (
                  <HeldRow key={m.itemId} item={memberItem(m)} line={m.subject} why={m.why} onRestored={onRefresh} />
                ))}
                {bands.watched.hasMore && (
                  <p className="px-3 py-1.5 text-[12px] text-neutral-300">
                    {heldFooter(bands.watched.rows.length, bands.watched.count, HELD_ROWS_PER_BAND)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── BAND 3 · HANDLED. The big number, at the bottom, where reassurance belongs. */}
      {folded.length > 0 && (
        <section className="mt-8 flex flex-col gap-1">
          <Header>{bands ? `${bands.handled.title} · ${bands.handled.count.toLocaleString()}` : 'Held back'}</Header>
          {bands?.handled.graduation && (
            <p className="px-3 text-[12px] text-neutral-400">{bands.handled.graduation}</p>
          )}
          <div className="mt-0.5 flex flex-col">
            {folded.map((c) => (
              <ClassRow key={c.id} c={c} open={openClass === c.id}
                onToggle={() => setOpenClass((v) => (v === c.id ? null : c.id))}
                deed={deeds[c.id] ?? null}
                busy={busyClass === c.id}
                error={errors[c.id] || null}
                picked={pickedOf(c.id)}
                onPick={(itemId) => setPicked((p) => {
                  const next = new Set(p[c.id] ?? []);
                  if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
                  return { ...p, [c.id]: next };
                })}
                onPickAll={(all) => setPicked((p) => ({
                  ...p, [c.id]: all ? new Set(c.members.map((m) => m.itemId)) : new Set<string>(),
                }))}
                onVerb={() => void prepare(c)}
                onDeedDone={() => onDeedDone(c.id)} />
            ))}
          </div>
        </section>
      )}

      {ledger && (
        <p className="mt-8 px-3 text-[12px] text-neutral-300">{heldReceipts(ledger)}</p>
      )}

      </div>
      </div>
    </div>
  );
}

// ── THE WARM PAINT (the house instant-load doctrine, finally reaching this lens) ────────────────
// HYDRATE LAST-KNOWN → PAINT → BACKGROUND REFRESH → SAVE. The account's derivation costs seconds;
// the reader clicked a door. So the last served account paints first, out of the stamped local
// cache, and this visit's read replaces it when it lands.
//
// THE FRESHNESS IS DEMANDED, not assumed (the stamped-cache law): this is an ACTION surface — rows
// here carry Done and Dismiss — so a blob too old to trust is REJECTED rather than shown and
// retracted. Three minutes is also what keeps the SERVED DAY safe: the deck composes its whens from
// `ledger.today`, and a cache that can only be three minutes old can only be today's.
const HELD_LS_KEY = 'aug-held-ledger-v1';
const HELD_LS_MAX_AGE_MS = 3 * 60_000;

/** THE FETCH — hydrates warm, then reads live. The one thing that moves it afterwards is the
 *  reader's own deed: `reload` asks for a FRESH read (the server derives in place and restores its
 *  own last-good), because an account that still lists thirty messages it just archived is not an
 *  account. */
export function useHeldLedger(enabled: boolean): { ledger: HeldLedger | null; reload: () => void } {
  const [ledger, setLedger] = useState<HeldLedger | null>(null);
  const load = useCallback(async (fresh?: boolean) => {
    try {
      const res = await fetch(`/api/home/held${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as HeldLedger;
      if (!next || typeof next !== 'object') return;
      setLedger(next);
      saveLS(HELD_LS_KEY, next);
    } catch { /* the ledger never breaks the Home — the intro simply stays honest about loading */ }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    // The hydrate lives in an EFFECT, never a useState initializer — this lens renders inside an
    // SSR'd route, and a warm read at mount time is a hydration mismatch.
    const warm = loadLS<HeldLedger>(HELD_LS_KEY, { maxAgeMs: HELD_LS_MAX_AGE_MS });
    // …and it never overwrites a LIVE account with a cached one (a re-open mid-session).
    if (warm) setLedger((cur) => (cur ? cur : { ...warm, warm: true }));
    void load();
  }, [enabled, load]);
  return useMemo(() => ({ ledger, reload: () => void load(true) }), [ledger, load]);
}
