'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECISION HOST (W3-C — docs/component-map.md §2 item 7, Sep 22)
//
// ONE OBJECT, ONE RENDERING. The judged decision was "the only interactive room card with NO kit
// kind" — a hand-drawn component in components/work/, mounted by the rail, while its DEED was
// hand-copied into TWO callers (the item deep-dive and the project room) that each re-typed the
// same steer fetch, the same fallback sentence and the same draft handling. That file is gone; the
// kit owns the rendering and this owns the door.
//
// It does exactly what a host may do and the kit may not (the approval/input/event host pattern):
//
//   1 · IT USES THE ONE DOOR. `/api/items/steer` with the decision's contract — THE FORWARD-MOTION
//       LAW, unchanged: the choice travels WITH its trade-off and its why, so the core executes the
//       consequence rather than re-interpreting its own menu label.
//   2 · IT IS OPTIMISTIC, AND IT ROLLS BACK. The confirming click settles the card at once
//       ("Chosen: …"); only a genuine transport/server failure puts the routes back, with one quiet
//       line above them.
//   3 · A REFUSAL IS A FACT, NOT A ROLLBACK. A 409 (the item moved on — resolved, re-judged,
//       decided in another tab) leaves the card SETTLED and says the honest sentence: the decision
//       really is closed, and we do not claim to know how.
//   4 · IT OWNS THE RECOMMENDATION RULE. `mayRecommend` (lib/room/decision-object) is read HERE:
//       with no object on the page nothing is marked, and the kit only prints the mark it is given.
//       W17: and nothing is SAID about the absence — the card is its options (no filler line).
//
// The caller keeps what only it can do: seat the user's word as a turn (`onChosen`) and apply the
// consequence to its own lane (`onResolved` — the fresh draft, the room's narration).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { DecisionOption, ThreadCard } from '@/components/thread/types';
import { mayRecommend, type DecisionObject } from '@/lib/room/decision-object';

/** THE ONE VOCABULARY of this card — no surface types a status word of its own. */
export const DECISION_WORDS = {
  confirm: 'Go with this',
  dismiss: 'Leave it with me',
  chosen: (label: string) => `Chosen: ${label}`,
  /** The 409 sentence: the decision closed, and we do not claim to know how. */
  settledElsewhere: 'This was already settled elsewhere.',
  failed: 'That didn’t land — try again.',
  /** What the core says back when it answered but said nothing of its own. */
  wentThrough: 'Done.',
  withDraft: 'On it — the draft is on the right, updated for that.',
} as const;

/** The whole content of a decision, exactly as both doors already hold it. Nothing is computed
 *  here that the surface does not already have: a fact it lacks simply has no line. */
export type DecisionSpec = {
  /** The item lane the steer door answers on. */
  itemKind: string;
  itemId: string;
  /** The judge's one-line reason — why this is a decision. */
  title?: string | null;
  /** The routes, in the judged/brief order, with their trade-offs. */
  options: Array<{ label: string; tradeoff?: string | null }>;
  /** The brief's grounded pick + why. SUPPRESSED when no object stands (the structural rule). */
  recommendation?: { label: string; why?: string | null } | null;
  /** The PREPARED object, resolved by lib/room/decision-object from the door's own artifacts. */
  object?: DecisionObject | null;
  /** The object's one deed: review it. */
  onOpenObject?: () => void;
};

/** What the door answered, handed back so the caller can apply it to its own lane. */
export type DecisionOutcome = { ok: boolean; draft?: string | null; say: string };

/** The recommended-route match, on the SAME structural form the hand-drawn card used: a prefix
 *  comparison, so no verb vocabulary in any language is needed to find the marked option. */
const isRec = (label: string, rec?: { label: string } | null) =>
  !!rec?.label && label.toLowerCase().startsWith(rec.label.toLowerCase().slice(0, 24));

/** The why, clamped at a word boundary — the render's backstop to the generation cap. */
const clampWhy = (why: string): string =>
  why.length <= 220 ? why : `${why.slice(0, Math.max(120, why.slice(0, 220).lastIndexOf(' ')))}…`;

export default function DecisionCard({ spec, objectNode, onChosen, onResolved, onDismiss, id }: {
  spec: DecisionSpec;
  /**
   * THE SOURCE object, when no PREPARED one stands (THE OPENING CONTRACT, clause 2): the host room
   * mounts THE ONE OBJECT CARD so the ask and the thing asked about are on one surface. It does NOT
   * make anything recommendable — a source under the ask is the material, not our work to approve.
   */
  objectNode?: React.ReactNode;
  /** The user's word, the moment they confirm — the caller seats it as their own turn. */
  onChosen?: (label: string) => void;
  /** What the door answered — the caller applies it (the fresh draft, its room's narration). */
  onResolved?: (label: string, outcome: DecisionOutcome) => void;
  /** "Leave it with me" — clears the card without acting. */
  onDismiss?: () => void;
  id?: string;
}) {
  const [chosen, setChosen] = React.useState<string | null>(null);
  /** Set ONLY by a refusal the server owns: the decision closed, and it is not ours to reopen. */
  const [elsewhere, setElsewhere] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const confirm = React.useCallback(async (label: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setChosen(label);                                   // optimistic
    onChosen?.(label);
    const opt = spec.options.find((o) => o.label === label);
    let res: Response | null = null;
    try {
      res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // THE FORWARD-MOTION LAW: the choice travels WITH its contract.
        body: JSON.stringify({
          kind: spec.itemKind, id: spec.itemId, text: label,
          decision: {
            option: label,
            tradeoff: opt?.tradeoff ?? null,
            why: isRec(label, spec.recommendation) ? spec.recommendation?.why ?? null : null,
          },
        }),
      });
    } catch { res = null; }
    setBusy(false);
    if (res && res.status === 409) {
      // THE REFUSAL IS NOT A ROLLBACK: the decision really is closed. Stay settled, and say so.
      setChosen(null);
      setElsewhere(DECISION_WORDS.settledElsewhere);
      onResolved?.(label, { ok: false, say: DECISION_WORDS.settledElsewhere });
      return;
    }
    const data = res && res.ok ? await res.json().catch(() => ({} as Record<string, unknown>)) : null;
    if (!data) {
      setChosen(null);                                  // rollback — the question stands again
      setError(DECISION_WORDS.failed);
      return;
    }
    const draft = typeof data.draft === 'string' ? data.draft : null;
    const say = String(data.say || data.answer
      || (draft ? DECISION_WORDS.withDraft : DECISION_WORDS.wentThrough));
    onResolved?.(label, { ok: true, draft, say });
  }, [busy, onChosen, onResolved, spec]);

  // RULE 2, IN CODE: with no PREPARED object on the page the card recommends NOTHING — no marked
  // route, no "recommended" chip. Approving what you cannot see is never the path we point at.
  const recommends = mayRecommend(spec.object);
  const options: DecisionOption[] = spec.options.map((o, i) => {
    const rec = recommends && isRec(o.label, spec.recommendation);
    return {
      id: `opt-${i}`,
      label: o.label,
      ...(o.tradeoff ? { consequence: o.tradeoff } : {}),
      ...(rec ? { recommended: true } : {}),
      ...(rec && spec.recommendation?.why ? { why: clampWhy(spec.recommendation.why) } : {}),
    };
  });

  const settled = !!chosen || !!elsewhere;
  // THE OBJECT'S ONE RENDERING: the prepared object rides the kit's `source` card in the handle
  // grammar (title · byline · a taste · one door), and the SOURCE one arrives already mounted.
  const preparedNode = spec.object ? (
    <ThreadCardView card={{
      kind: 'source', id: `decision-object-${spec.object.id}`, source: 'document',
      ...(spec.object.by ? { who: spec.object.by } : {}),
      title: spec.object.title,
      ...(spec.object.preview ? { excerpt: spec.object.preview } : {}),
      ...(spec.onOpenObject ? { onOpen: spec.onOpenObject, openLabel: 'Review →' } : {}),
    }} />
  ) : null;

  const card: ThreadCard = {
    kind: 'decision',
    ...(id ? { id } : {}),
    state: settled ? 'settled' : busy ? 'busy' : 'open',
    ...(spec.title ? { question: spec.title } : {}),
    // W17 · NO FILLER: with no object the card is its options — never a line about what is absent.
    ...(preparedNode ? { objectNode: preparedNode }
      : objectNode ? { objectNode }
      : {}),
    options,
    confirmLabel: DECISION_WORDS.confirm,
    onConfirm: (label: string) => void confirm(label),
    dismissLabel: DECISION_WORDS.dismiss,
    ...(onDismiss ? { onDismiss } : {}),
    settledLine: elsewhere ?? (chosen ? DECISION_WORDS.chosen(chosen) : undefined),
    ...(error ? { error } : {}),
  };

  return <ThreadCardView card={card} />;
}
