'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASK HOST (W3-A — docs/component-map.md §2a, Sep 22)
//
// ONE OBJECT, ONE RENDERING — and the census found that "the ask" is really TWO objects that four
// copies never distinguished by name:
//
//   THE ENGINE ASK     a room turn (`component.key = 'input_checklist'`): a coworker or the
//                      preparation engine naming the concrete things it is missing. Answered by
//                      attaching, by answering in the composer, or by the never-blocking go-ahead
//                      (/api/room/asks) — and NEVER blocking (the July law).
//   THE INPUT STATION  a parked workflow run's `input` step: material only this person has.
//                      Answered by the ONE shared supply form through the ONE resume door.
//
// They wear one card because a reader meets them in the same seat and owes them the same thing;
// they keep different doors because they are different objects. `shape` is the only fork, and it is
// DATA — a host prop, never a second component.
//
// The host pattern is the collection/event one: it owns the doors, it is optimistic and rolls back,
// a conflict is a FACT not a retry, and one quiet line carries a failure (never a toast storm).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { ThreadCard } from '@/components/thread/types';
import { GateStandingLine } from '@/components/workflows/gate-pieces';
import InputSupplyForm, { type SupplyAccepts, type SupplyOutcome } from '@/components/workflows/input-supply-form';
import type { AskRowDoors } from '@/components/thread/ask-rows';
import { proceedAsk, supplyAskText } from '@/lib/deeds/gate-doors';
import { askAllowsGoAhead, askItemShape, goAheadLabel, saidItLabels } from '@/lib/room/go-ahead';
import { baseOfferLine } from '@/lib/room/ask-base';
import { GATE_OUTCOME_WORDS, GATE_SETTLED_ELSEWHERE } from '@/lib/workflows/process-state';

/** THE ENGINE ASK — the room's own turn. */
export type EngineAskSpec = {
  shape: 'engine';
  /** The durable turn id: the lifecycle actions key on it. Absent ⇒ no go-ahead door can exist. */
  turnId?: string | null;
  /** The ask's own sentence. */
  ask: string;
  /** The concrete missing things — the judged labels. */
  items: string[];
  /** W13.6 · THE BASE IS OFFERED — the current version the new work goes into (never the answer):
   *  printed as the card's meta line, "Current version (to update): <file>". */
  base?: string[];
  /** Whatever names the work, for the go-ahead test (lib/room/go-ahead.ts). */
  context: Array<string | null | undefined>;
  /** Already answered by a go-ahead somewhere else (the served `proceeded` stamp). */
  proceeded?: boolean;
  /** The room's own attach funnel and composer prefill. A door the surface does not own is simply
   *  not handed over, and the chip does not render (no lying doors). */
  onAttach?: () => void;
  onPointToIt?: () => void;
  /**
   * WHOSE ASK IT IS decides what the go-ahead DOES. The engine's own ask stamps the lifecycle
   * through /api/room/asks; a COWORKER's ask is answered by SPEAKING to them, because a person
   * asked it and a person answers it. `onSpeak` present ⇒ the spoken path; absent ⇒ the stamp.
   */
  onSpeak?: (text: string) => void;
  speakerFirstName?: string | null;
  /**
   * THE SAID-IT OFFER (W4-B) — the reader's most recent line in this room's composer. When it
   * plainly COULD be the fact the ask is missing, the row offers "Use this as <label> ✓" and the
   * CLICK is the deed. It is never consumed automatically: THE ASK-DIRECTION FLOOR cuts both ways —
   * our ask, their words, their click. A surface that does not track the composer passes nothing
   * and no offer exists.
   */
  recentUserText?: string | null;
};

/** THE INPUT STATION — a parked run. */
export type StationAskSpec = {
  shape: 'station';
  runId: string | null;
  ask: string;
  accepts?: SupplyAccepts;
  meta?: string | null;
  steps?: { done: number; total: number } | null;
  /** The folded "already in this run" trail, mounted by the surface that was served it. */
  contextNode?: React.ReactNode;
};

export type AskSpec = EngineAskSpec | StationAskSpec;

export default function InputCard({ spec, open = true, onSettled, id, held = false }: {
  spec: AskSpec;
  /** Is the ask still answerable? A surface that knows its commitment closed passes false. */
  open?: boolean;
  onSettled?: (outcome: SupplyOutcome | 'proceeded') => void;
  id?: string;
  /** The SURFACE is mid-deed (the room is sending): the card's doors wait, exactly as they did
   *  when the room drew the ask itself — the host cannot know the room's send state on its own. */
  held?: boolean;
}) {
  const [settledAs, setSettledAs] = React.useState<SupplyOutcome | 'proceeded' | null>(null);
  const [elsewhere, setElsewhere] = React.useState<string | null>(null);
  const [ownBusy, setBusy] = React.useState(false);
  const busy = ownBusy || held;
  const [error, setError] = React.useState<string | null>(null);

  const settle = React.useCallback((o: SupplyOutcome | 'proceeded') => {
    setSettledAs(o);
    onSettled?.(o);
  }, [onSettled]);

  // ── THE GO-AHEAD (engine asks only) ───────────────────────────────────────────────────────────
  const proceed = React.useCallback(async (turnId: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    const res = await proceedAsk(turnId);
    setBusy(false);
    if (res.ok) { settle('proceeded'); return; }
    if (res.reason === 'conflict') { setElsewhere(res.message ?? GATE_SETTLED_ELSEWHERE); return; }
    // A DEAD CLICK IS A BUG (Sep 14): a failure used to do nothing at all — the button stayed, the
    // room stayed silent, and the reader had no way to know. It says so now, on the card itself.
    setError('That didn’t go through — try it again in a moment.');
  }, [busy, settle]);

  // ── THE TYPE-IT DOOR (W4-B, Sep 22) ───────────────────────────────────────────────────────────
  // One missing thing, answered by typing the fact. The owner's words: "banking details for example
  // could just be typed if IBAN only? … typing short info easier than finding attachment, but
  // keeping options open." So every row keeps all three doors and only their ORDER moves.
  //
  // The host owns the deed (the kit draws the field, this file posts it) and the optimistic record:
  // the supplied row wears its receipt immediately, and when the LAST row is covered the card
  // settles as 'supplied' — the same word the station's own supply settles under.
  const [supplied, setSupplied] = React.useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<Record<string, string>>({});

  // Answers TRUE only when the fact actually landed — the row keeps the reader's text otherwise.
  const supply = React.useCallback(async (turnId: string, label: string, text: string, total: number): Promise<boolean> => {
    setRowBusy(label);
    setRowError((p) => { const n = { ...p }; delete n[label]; return n; });
    const res = await supplyAskText(turnId, label, text);
    setRowBusy(null);
    if (res.ok) {
      const next = { ...supplied, [label]: text.replace(/\s+/g, ' ').slice(0, 160) };
      setSupplied(next);
      // THE LAST ROW SETTLES THE ASK — the server settles it; the card says so without a refetch.
      // (Computed out here, never inside the updater: a settle is a side effect, not a reducer.)
      if (Object.keys(next).length >= total) settle('supplied');
      return true;
    }
    // A CONFLICT IS A FACT: the ask was answered elsewhere (its room, another tab, an attach).
    if (res.reason === 'conflict') { setElsewhere(res.message ?? GATE_SETTLED_ELSEWHERE); return true; }
    setRowError((p) => ({
      ...p,
      // The server's own sentence beats ours wherever it has one ("longer than this door takes").
      [label]: (res.reason === 'failed' && res.message) || 'That didn’t go through — try it again in a moment.',
    }));
    return false;
  }, [settle, supplied]);

  // A GO-AHEAD DOES NOT CLOSE AN ASK. It withdraws the never-blocking DOOR (it has been used) and
  // nothing else: the missing things are still missing, and attaching one later is still the best
  // thing that can happen. Only a station's own deed — or a closed item — settles the card.
  const wentAhead = settledAs === 'proceeded' || (spec.shape === 'engine' && !!spec.proceeded);
  const settled = settledAs === 'supplied' || settledAs === 'held' || !!elsewhere || !open;

  const settledLine = elsewhere
    ?? (settledAs === 'supplied' ? GATE_OUTCOME_WORDS.supplied.line
      : settledAs === 'held' ? GATE_OUTCOME_WORDS.rejected.line
      : GATE_SETTLED_ELSEWHERE);

  const base = {
    kind: 'input' as const,
    ...(id ? { id } : {}),
    state: settled ? ('settled' as const) : busy ? ('busy' as const) : ('open' as const),
    ask: spec.ask,
    settledLine,
    ...(error ? { error } : {}),
  };

  let card: ThreadCard;
  if (spec.shape === 'station') {
    card = {
      ...base,
      ...(spec.meta ? { meta: spec.meta } : {}),
      ...(!settled && spec.steps
        ? { standingNode: <GateStandingLine done={spec.steps.done} total={spec.steps.total || spec.steps.done} mode="input" /> }
        : {}),
      ...(spec.contextNode ? { contextNode: spec.contextNode } : {}),
      // THE DEED IS THE ONE SHARED FORM — the kit draws no paste box, and this host does not
      // either. `runId: null` (a stale cache that knows the source but not the run) renders
      // nothing inside the form rather than a door that cannot post.
      ...(!settled
        ? {
          supplyNode: (
            <InputSupplyForm
              runId={spec.runId}
              accepts={spec.accepts ?? 'both'}
              onSettled={(o) => settle(o)}
            />
          ),
        }
        : {}),
    };
  } else {
    // THE DOOR RENDERS ONLY WHERE PROCEEDING PRODUCES THE WORK (lib/room/go-ahead.ts, owner walk
    // Sep 14) — ONE test, ONE label producer, and this is now its ONE caller among the ask seats.
    const canProceed = !settled && !wentAhead && askAllowsGoAhead(spec.items, spec.context);
    const speak = spec.onSpeak;
    const turnId = spec.turnId;
    // A coworker's go-ahead is PLAIN SPEECH a person would actually say — never an engine
    // instruction pasted into the user's own bubble.
    const spoken = `${spec.speakerFirstName ? `${spec.speakerFirstName}, g` : 'G'}o ahead without it — use what you have and tell me what’s missing.`;
    const onProceed = !canProceed ? undefined
      : speak ? () => speak(spoken)
        : turnId ? () => void proceed(turnId)
          : undefined;
    // ── THE DOORS, PER ROW ──────────────────────────────────────────────────────────────────────
    // Which door LEADS is a code-owned, deterministic read of the label itself (askItemShape): a
    // fact is typed, a document is attached — and BOTH doors are on BOTH rows either way. With no
    // turnId there is nothing to post a typed fact to, so Type it simply is not offered (no lying
    // doors) and the row keeps the two it always had.
    // THE SAID-IT OFFER rides the same door: when the reader has already typed the fact into the
    // composer, the row offers to use it. A click, never a guess.
    const offer = new Set(spec.recentUserText ? saidItLabels(spec.items, spec.recentUserText) : []);
    const said = String(spec.recentUserText ?? '').replace(/\s+/g, ' ').trim();
    const rowDoors: Array<AskRowDoors | null> = spec.items.map((label) => ({
      lead: askItemShape(label),
      ...(spec.onAttach ? { onAttach: spec.onAttach } : {}),
      ...(spec.onPointToIt ? { onPointToIt: spec.onPointToIt } : {}),
      ...(turnId && !settled
        ? { onType: (text: string) => supply(turnId, label, text, spec.items.length) }
        : {}),
      ...(supplied[label] ? { supplied: supplied[label] } : {}),
      ...(rowBusy === label || busy ? { busy: true } : {}),
      ...(rowError[label] ? { error: rowError[label] } : {}),
      ...(turnId && offer.has(label) && !supplied[label]
        // The label rides verbatim but for its first letter — an acronym keeps its case ("the
        // IBAN"), which a blanket toLowerCase would have destroyed mid-sentence.
        ? { saidIt: { label: `Use this as ${label.charAt(0).toLowerCase()}${label.slice(1)} ✓`, text: said, onUse: () => void supply(turnId, label, said, spec.items.length) } }
        : {}),
    }));
    const baseLineText = baseOfferLine(spec.base ?? []);
    card = {
      ...base,
      items: spec.items,
      ...(baseLineText ? { meta: baseLineText } : {}),
      // ONE DEED ONE DOOR: with rows carrying their own doors, the card-level chips would be a
      // second Attach for the same deed. An ask with no rows at all keeps them.
      ...(spec.items.length
        ? { rowDoors }
        : {
          ...(spec.onAttach ? { onAttach: spec.onAttach } : {}),
          ...(spec.onPointToIt ? { onPaste: spec.onPointToIt, pasteLabel: 'Point me to it' } : {}),
        }),
      ...(onProceed ? { onProceed, proceedLabel: goAheadLabel(spec.items) } : {}),
    };
  }

  return <ThreadCardView card={card} />;
}
